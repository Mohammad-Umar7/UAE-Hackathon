"use client";

/**
 * Signature terminals and towers (original Blender models, pipeline/blender/airports) placed in the
 * airport's ENU frame with an identity transform. The OSM extrusions they supersede are hidden by the
 * airfield builder using the manifest's `replaces` ids.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { loadKit, type Kit } from "./assets";
import { twinState } from "./state";

export interface LandmarkEntry {
  name: string;
  icao: string;
  title: string;
  replaces: string[];
  bbox_enu: { min: number[]; max: number[] };
}

let manifest: Promise<LandmarkEntry[]> | null = null;

/** Landmark manifest (cached); an empty list if the assets are not present. */
export function landmarkManifest(): Promise<LandmarkEntry[]> {
  manifest ??= fetch("/assets/airports/manifest.json")
    .then((r) => (r.ok ? r.json() : { assets: [] }))
    .then((m: { assets?: LandmarkEntry[] }) => m.assets ?? [])
    .catch(() => []);
  return manifest;
}

/** Building ids replaced by landmark models at `icao` (null until the manifest has loaded). */
export function useReplacedBuildings(icao: string): Set<string> | null {
  const [ids, setIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    landmarkManifest().then((list) => { if (alive) setIds(new Set(list.filter((a) => a.icao === icao).flatMap((a) => a.replaces))); });
    return () => { alive = false; };
  }, [icao]);
  return ids;
}

const lit = { glass: [] as THREE.MeshStandardMaterial[], lights: [] as THREE.MeshStandardMaterial[] };

function landmarkMaterial(src: THREE.Material, mat: string): THREE.Material {
  const m = (src as THREE.MeshStandardMaterial).clone();
  if (mat === "M_GlassLit") {
    m.emissive = new THREE.Color("#ffe1b8");
    m.emissiveIntensity = 0;
    lit.glass.push(m);
  }
  if (mat === "M_Lights") lit.lights.push(m);
  if (mat === "M_Glass" || mat === "M_GlassLit") { m.roughness = Math.min(m.roughness, 0.12); m.envMapIntensity = 1.2; }
  return m;
}

interface Placed { entry: LandmarkEntry; kit: Kit; lods: THREE.Group[]; center: THREE.Vector3; radius: number }

export function Landmarks({ icao }: { icao: string }) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const { camera } = useThree();
  useEffect(() => {
    let alive = true;
    landmarkManifest().then(async (list) => {
      const mine = list.filter((a) => a.icao === icao);
      const kits = await Promise.all(mine.map((a) => loadKit(`/assets/airports/${a.name}.glb`, a.name, { material: landmarkMaterial }).catch(() => null)));
      if (!alive) return;
      const out: Placed[] = [];
      mine.forEach((entry, i) => {
        const kit = kits[i];
        if (!kit) return;
        const lods = kit.lods.map((prims) => {
          const g = new THREE.Group();
          for (const p of prims) {
            const mesh = new THREE.Mesh(p.geometry, p.material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            g.add(mesh);
          }
          return g;
        });
        const [x0, y0, z0] = entry.bbox_enu.min, [x1, y1, z1] = entry.bbox_enu.max;
        out.push({ entry, kit, lods, center: new THREE.Vector3((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2), radius: Math.hypot(x1 - x0, y1 - y0) / 2 });
      });
      setPlaced(out);
    });
    return () => { alive = false; };
  }, [icao]);

  useFrame(() => {
    const cam = camera.position;
    for (const p of placed) {
      const d = Math.max(0, cam.distanceTo(p.center) - p.radius);
      const lod = d < 900 ? 0 : d < 3500 ? 1 : 2;
      p.lods.forEach((g, i) => { g.visible = i === Math.min(lod, p.lods.length - 1); });
    }
    const n = twinState.night;
    for (const m of lit.glass) m.emissiveIntensity = 0.04 + 0.9 * n;
    for (const m of lit.lights) m.emissiveIntensity = 1 + 3 * n;
  });

  return (
    <group name="landmarks">
      {placed.map((p) => <group key={p.entry.name}>{p.lods.map((g, i) => <primitive key={i} object={g} />)}</group>)}
    </group>
  );
}
