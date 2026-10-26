/**
 * Instanced rendering of asset kits: one InstancedMesh per (LOD, part, material) primitive.
 * Each frame the caller resets, pushes instances (part matrices, optional per-instance colour
 * and attributes) and commits; only the used ranges are uploaded.
 */

import * as THREE from "three";
import type { Kit, KitPrim } from "./assets";
import { DECAL_ROWS, logoAtlas, titleAtlas } from "./textures";

interface Entry {
  prim: KitPrim;
  mesh: THREE.InstancedMesh;
  n: number;
  prevN: number;
  attrs: Record<string, THREE.InstancedBufferAttribute>;
}

export interface KitOptions {
  capacity: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  tint?: (mat: string) => boolean;
  attrs?: (prim: KitPrim) => string[];
}

const WHITE = new THREE.Color(1, 1, 1);

export class InstancedKit {
  readonly group = new THREE.Group();
  private byLod: Entry[][] = [];

  constructor(public kit: Kit, private opts: KitOptions) {
    this.group.name = `kit:${kit.key}`;
    kit.lods.forEach((prims, li) => {
      const entries: Entry[] = [];
      for (const prim of prims) {
        const geo = new THREE.BufferGeometry();
        for (const [k, a] of Object.entries(prim.geometry.attributes)) geo.setAttribute(k, a);
        geo.setIndex(prim.geometry.index);
        geo.boundingSphere = prim.geometry.boundingSphere;
        const attrs: Record<string, THREE.InstancedBufferAttribute> = {};
        for (const name of opts.attrs?.(prim) ?? []) {
          attrs[name] = new THREE.InstancedBufferAttribute(new Float32Array(opts.capacity), 1);
          attrs[name].setUsage(THREE.DynamicDrawUsage);
          geo.setAttribute(name, attrs[name]);
        }
        const mesh = new THREE.InstancedMesh(geo, prim.material, opts.capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (opts.tint?.(prim.mat)) {
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(opts.capacity * 3).fill(1), 3);
          mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        }
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = Boolean(opts.castShadow) && li < 2;
        mesh.receiveShadow = Boolean(opts.receiveShadow);
        mesh.name = `${kit.key}:LOD${li}:${prim.part}:${prim.mat}`;
        this.group.add(mesh);
        entries.push({ prim, mesh, n: 0, prevN: 0, attrs });
      }
      this.byLod[li] = entries;
    });
  }

  reset(): void {
    for (const lod of this.byLod) for (const e of lod) { e.prevN = e.n; e.n = 0; }
  }

  add(lod: number, part: (part: string) => THREE.Matrix4, color?: (mat: string) => THREE.Color | null, attrs?: Record<string, number>): void {
    const entries = this.byLod[Math.min(lod, this.byLod.length - 1)];
    for (const e of entries) {
      const i = e.n;
      if (i >= this.opts.capacity) continue;
      e.n++;
      e.mesh.setMatrixAt(i, part(e.prim.part));
      if (e.mesh.instanceColor) e.mesh.setColorAt(i, color?.(e.prim.mat) ?? WHITE);
      if (attrs) for (const [k, a] of Object.entries(e.attrs)) a.setX(i, attrs[k] ?? 0);
    }
  }

  commit(): void {
    for (const lod of this.byLod) {
      for (const e of lod) {
        e.mesh.count = e.n;
        if (e.n === 0 && e.prevN === 0) continue;
        const im = e.mesh.instanceMatrix;
        im.clearUpdateRanges();
        im.addUpdateRange(0, Math.max(1, e.n) * 16);
        im.needsUpdate = true;
        if (e.mesh.instanceColor) {
          e.mesh.instanceColor.clearUpdateRanges();
          e.mesh.instanceColor.addUpdateRange(0, Math.max(1, e.n) * 3);
          e.mesh.instanceColor.needsUpdate = true;
        }
        for (const a of Object.values(e.attrs)) {
          a.clearUpdateRanges();
          a.addUpdateRange(0, Math.max(1, e.n));
          a.needsUpdate = true;
        }
      }
    }
  }

  dispose(): void {
    for (const lod of this.byLod) for (const e of lod) { e.mesh.geometry.dispose(); e.mesh.dispose(); }
  }
}

// ------------------------------------------------------------------ aircraft materials

/** Shared runtime materials for the procedural fleet; night/day updates touch these once. */
export const fleetLook = {
  lights: [] as THREE.MeshStandardMaterial[],
  windows: [] as THREE.MeshStandardMaterial[],
};

const PAINT = /^M_Paint_/;

export function isPaint(mat: string): boolean { return PAINT.test(mat); }

function wheelSpin(m: THREE.Material): void {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 _axle;\nattribute float aSpin;")
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
  float spinC = cos( aSpin ), spinS = sin( aSpin );
  objectNormal = vec3( objectNormal.x, spinC * objectNormal.y - spinS * objectNormal.z, spinS * objectNormal.y + spinC * objectNormal.z );`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  {
    vec3 rel = transformed - _axle;
    transformed = _axle + vec3( rel.x, spinC * rel.y - spinS * rel.z, spinS * rel.y + spinC * rel.z );
  }`);
  };
  m.customProgramCacheKey = () => "wheel-spin";
}

function decalRows(m: THREE.Material, grid: boolean): void {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aRow;")
      .replace("#include <uv_vertex>", grid
        ? "#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = ( vMapUv + vec2( mod( aRow, 4.0 ), floor( aRow / 4.0 ) ) ) / 4.0;\n#endif"
        : `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vec2( vMapUv.x, ( vMapUv.y + aRow ) / ${DECAL_ROWS.toFixed(1)} );\n#endif`);
  };
  m.customProgramCacheKey = () => (grid ? "decal-grid" : "decal-rows");
}

const shared = new Map<string, THREE.Material>();

export function aircraftMaterial(src: THREE.Material, mat: string): THREE.Material {
  const hit = shared.get(mat);
  if (hit) return hit;
  const s = src as THREE.MeshStandardMaterial;
  const base = mat.replace("#wheel", "");
  let m: THREE.MeshStandardMaterial;
  if (PAINT.test(base)) {
    m = new THREE.MeshPhysicalMaterial({
      name: mat, color: 0xffffff, roughness: base === "M_Paint_Engine" ? 0.38 : 0.3, metalness: 0.02,
      clearcoat: 0.55, clearcoatRoughness: 0.22,
    });
  } else if (base === "M_TailLogo" || base === "M_Titles") {
    m = new THREE.MeshStandardMaterial({
      name: mat, map: base === "M_Titles" ? titleAtlas() : logoAtlas(), transparent: true, depthWrite: false,
      roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    decalRows(m, base === "M_TailLogo");
  } else {
    m = s.clone();
    m.name = mat;
    if (base === "M_Window" || base === "M_Cockpit") {
      m.color.set(base === "M_Window" ? "#1b232c" : "#151c24");
      m.roughness = 0.08;
      m.metalness = 0.3;
      m.emissive = new THREE.Color(base === "M_Window" ? "#ffc98a" : "#9fb4c8");
      m.emissiveIntensity = 0;
      fleetLook.windows.push(m);
    }
    if (base === "M_Window" || base === "M_PanelLine") {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -2;
    }
    if (base === "M_Lights") {
      m.emissive = new THREE.Color("#ffffff");
      if (s.emissiveMap) m.emissiveMap = s.emissiveMap;
      fleetLook.lights.push(m);
    }
    if (base === "M_Wing") { m.roughness = Math.min(m.roughness, 0.45); }
  }
  if (mat.endsWith("#wheel")) wheelSpin(m);
  shared.set(mat, m);
  return m;
}

/** Equipment materials: per-kit clones of the exported Principled values; lights tracked for night. */
export const equipmentLook = { lights: [] as THREE.MeshStandardMaterial[], beacons: [] as THREE.MeshStandardMaterial[] };

export function equipmentMaterial(src: THREE.Material, mat: string): THREE.Material {
  const m = (src as THREE.MeshStandardMaterial).clone();
  if (mat === "M_Lights") equipmentLook.lights.push(m);
  if (mat === "M_Beacon") equipmentLook.beacons.push(m);
  if (mat === "M_Glass" && m.transparent) m.depthWrite = false;
  return m;
}
