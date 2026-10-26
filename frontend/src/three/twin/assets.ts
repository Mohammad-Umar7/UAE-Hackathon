/**
 * GLB asset kits for instanced rendering.
 *
 * The Blender pipeline exports every asset as <root>/LOD0..2/<meshes + UPPER_SNAKE empties>, then
 * glTF-Transform quantises vertices (KHR_mesh_quantization) and compresses them with meshopt.
 * For instancing we want geometry in a stable "part space": each primitive is dequantised to
 * Float32, its node transform (incl. the dequantisation scale/offset) is baked in, and primitives
 * that share a part and a material are merged. A part is the asset root ("body") unless a rule
 * names a pivot node (propellers, jet-bridge sections), so the runtime can animate it.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface KitPrim {
  part: string;
  mat: string; // contract material name, plus "#wheel" for spinning wheel primitives
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface Kit {
  key: string;
  lods: KitPrim[][];
  empties: Record<string, THREE.Vector3>; // LOD0 empties in root space
  parts: Record<string, THREE.Matrix4>; // LOD0 part pivots in root space
  bbox: THREE.Box3; // LOD0 "body" bounds in root space
  axleZ: [number, number]; // min/max axle z (aircraft: nose gear ≈ 0, main gear aft)
}

export type PartRule = (nodeName: string) => string | null;
export type MaterialFactory = (src: THREE.Material, mat: string, kitKey: string) => THREE.Material;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const kits = new Map<string, Promise<Kit>>();

function bake(src: THREE.BufferGeometry, m: THREE.Matrix4, axleM: THREE.Matrix4 | null): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv", "_axle"]) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a || (name === "_axle" && !axleM)) continue;
    const n = a.count, k = a.itemSize;
    const arr = new Float32Array(n * k);
    for (let i = 0; i < n; i++) {
      arr[i * k] = a.getX(i);
      if (k > 1) arr[i * k + 1] = a.getY(i);
      if (k > 2) arr[i * k + 2] = a.getZ(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  g.applyMatrix4(m);
  const ax = g.getAttribute("_axle") as THREE.BufferAttribute | undefined;
  if (ax && axleM) ax.applyMatrix4(axleM);
  return g;
}

export function loadKit(url: string, key: string, opts: { partRule?: PartRule; material: MaterialFactory; wheels?: boolean }): Promise<Kit> {
  const cacheKey = `${key}@${url}`;
  if (!kits.has(cacheKey)) kits.set(cacheKey, build(url, key, opts));
  return kits.get(cacheKey)!;
}

async function build(url: string, key: string, opts: { partRule?: PartRule; material: MaterialFactory; wheels?: boolean }): Promise<Kit> {
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const root = scene.children.length === 1 ? scene.children[0] : scene;
  const rootInv = root.matrixWorld.clone().invert();
  const lodNodes = [0, 1, 2].map((i) => root.children.find((c) => c.name === `LOD${i}`) ?? null);
  if (!lodNodes[0]) lodNodes[0] = root;
  const mats = new Map<string, THREE.Material>();
  const material = (src: THREE.Material, mat: string) => {
    if (!mats.has(mat)) mats.set(mat, opts.material(src, mat, key));
    return mats.get(mat)!;
  };
  const kit: Kit = { key, lods: [], empties: {}, parts: {}, bbox: new THREE.Box3(), axleZ: [0, 0] };
  const tmp = new THREE.Matrix4();
  lodNodes.forEach((lod, li) => {
    if (!lod) return;
    const groups = new Map<string, { part: string; mat: string; src: THREE.Material; geos: THREE.BufferGeometry[] }>();
    lod.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) {
        if (li === 0 && o !== lod && /^[A-Z][A-Z0-9_]+$/.test(o.name) && !o.children.some((c) => (c as THREE.Mesh).isMesh)) {
          kit.empties[o.name] = new THREE.Vector3().setFromMatrixPosition(tmp.multiplyMatrices(rootInv, o.matrixWorld));
        }
        return;
      }
      // part pivot: nearest ancestor (or self) a rule names; otherwise the asset root
      let pivot: THREE.Object3D = root;
      let part = "body";
      for (let a: THREE.Object3D | null = mesh; a && a !== lod; a = a.parent) {
        const p = opts.partRule?.(a.name) ?? null;
        if (p) { pivot = a; part = p; break; }
      }
      if (li === 0 && part !== "body" && !kit.parts[part]) kit.parts[part] = new THREE.Matrix4().multiplyMatrices(rootInv, pivot.matrixWorld);
      const pivotInv = pivot.matrixWorld.clone().invert();
      const m = new THREE.Matrix4().multiplyMatrices(pivotInv, mesh.matrixWorld);
      const srcMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // multi-primitive nodes load as a Group of meshes, so the node name may sit on the parent
      const isWheel = Boolean(opts.wheels) && [mesh.name, mesh.parent?.name ?? ""].some((n) => n.startsWith("Wheels"));
      // _AXLE is stored in the node's original local space = its parent LOD group's space
      const axleM = isWheel ? new THREE.Matrix4().multiplyMatrices(pivotInv, lod.matrixWorld) : null;
      const geo = bake(mesh.geometry, m, axleM);
      const srcMat = srcMats[0];
      const matName = (srcMat.name || "M_Default") + (isWheel ? "#wheel" : "");
      const gk = `${part}|${matName}`;
      if (!groups.has(gk)) groups.set(gk, { part, mat: matName, src: srcMat, geos: [] });
      groups.get(gk)!.geos.push(geo);
    });
    const prims: KitPrim[] = [];
    for (const gr of groups.values()) {
      const merged = gr.geos.length === 1 ? gr.geos[0] : mergeGeometries(gr.geos, false);
      const list = merged ? [merged] : gr.geos;
      for (const geometry of list) {
        geometry.computeBoundingSphere();
        prims.push({ part: gr.part, mat: gr.mat, geometry, material: material(gr.src, gr.mat) });
      }
    }
    kit.lods[li] = prims;
  });
  for (let i = 1; i < 3; i++) if (!kit.lods[i]) kit.lods[i] = kit.lods[i - 1];
  for (const p of kit.lods[0]) {
    if (p.part !== "body") continue;
    p.geometry.computeBoundingBox();
    kit.bbox.union(p.geometry.boundingBox!);
    const ax = p.geometry.getAttribute("_axle");
    if (ax) for (let i = 0; i < ax.count; i++) { const z = ax.getZ(i); kit.axleZ[0] = Math.min(kit.axleZ[0], z); kit.axleZ[1] = Math.max(kit.axleZ[1], z); }
  }
  return kit;
}
