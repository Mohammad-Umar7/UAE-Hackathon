"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { AIRCRAFT, type TypeKey } from "@/core/aircraft";
import { AIRLINES } from "@/core/airlines";
import type { AirportInfo } from "@/core/airports/registry";
import type { Runtime } from "@/core/runtime";
import type { Visit } from "@/core/types";
import { loadKit, type Kit } from "./assets";
import { aircraftMatrix, buildQueues, lightState, poseFor, TYPE_KEYS, type FleetPose, type PoseContext } from "./poses";
import { aircraftMaterial, fleetLook, InstancedKit, isPaint } from "./instancing";
import { DynamicLights, pointScale } from "./lights";
import { twinState } from "./state";
import { AIRLINE_ROW } from "./textures";

export interface FleetEntry {
  visit: Visit;
  pose: FleetPose;
  matrix: THREE.Matrix4;
  kit: Kit;
}

/** Aircraft rendered this frame, by visit id (used for picking, follow camera, labels, bridges, GSE). */
export const fleetIndex = new Map<string, FleetEntry>();

const propRule = (n: string) => (n.startsWith("PROP_L") ? "PROP_L" : n.startsWith("PROP_R") ? "PROP_R" : null);

export function useFleetKits(): Record<TypeKey, Kit> | null {
  const [kits, setKits] = useState<Record<TypeKey, Kit> | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all(TYPE_KEYS.map((k) => loadKit(`/assets/aircraft/${k}.glb`, k, { partRule: propRule, material: aircraftMaterial, wheels: true })))
      .then((list) => { if (alive) setKits(Object.fromEntries(TYPE_KEYS.map((k, i) => [k, list[i]])) as Record<TypeKey, Kit>); })
      .catch((e) => console.error("aircraft assets failed to load", e));
    return () => { alive = false; };
  }, []);
  return kits;
}

const PAINT_SLOT: Record<string, keyof (typeof AIRLINES)[string]["livery"]> = {
  M_Paint_Top: "top", M_Paint_Belly: "belly", M_Paint_Cheatline: "cheatline", M_Paint_Tail: "tail", M_Paint_Engine: "engine",
};

const liveryColors = new Map<string, Record<string, THREE.Color>>();
function colorsFor(airline: string): Record<string, THREE.Color> {
  let c = liveryColors.get(airline);
  if (!c) {
    const l = (AIRLINES[airline] ?? Object.values(AIRLINES)[0]).livery;
    c = Object.fromEntries(Object.entries(PAINT_SLOT).map(([mat, slot]) => [mat, new THREE.Color(l[slot])]));
    liveryColors.set(airline, c);
  }
  return c;
}

const RGB = {
  red: [1, 0.08, 0.04], green: [0.1, 1, 0.32], white: [1, 0.97, 0.92], strobe: [1, 1, 1], landing: [1, 0.95, 0.85],
} as const;

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

export function Fleet({ rt, ap }: { rt: Runtime; ap: AirportInfo }) {
  const kits = useFleetKits();
  const { camera, size } = useThree();
  const rig = useMemo(() => {
    if (!kits) return null;
    const group = new THREE.Group();
    group.name = "fleet";
    const inst = {} as Record<TypeKey, InstancedKit>;
    for (const k of TYPE_KEYS) {
      inst[k] = new InstancedKit(kits[k], {
        capacity: 220, castShadow: true, receiveShadow: true, tint: isPaint,
        attrs: (p) => (p.mat.endsWith("#wheel") ? ["aSpin"] : p.mat === "M_Titles" || p.mat === "M_TailLogo" ? ["aRow"] : []),
      });
      group.add(inst[k].group);
    }
    const lights = new DynamicLights(220 * 10);
    group.add(lights.points);
    return { group, inst, lights };
  }, [kits]);
  useEffect(() => () => { if (rig) Object.values(rig.inst).forEach((k) => k.dispose()); }, [rig]);

  const ctx = useMemo<PoseContext>(() => ({ ap, now: 0, wall: 0, lastHeading: new Map(), waitQueue: new Map(), holdIndex: new Map() }), [ap]);
  const scratch = useMemo(() => ({ m: new THREE.Matrix4(), part: new THREE.Matrix4(), rz: new THREE.Matrix4(), v: new THREE.Vector3(), cam: new THREE.Vector3() }), []);

  useFrame(({ clock }) => {
    if (!rig || !kits) return;
    const w = rt.world;
    ctx.now = w.now;
    ctx.wall = clock.elapsedTime;
    const visits = Object.values(w.visits).filter((v) => v.airport === ap.icao);
    buildQueues(visits, ctx);
    for (const k of TYPE_KEYS) rig.inst[k].reset();
    rig.lights.reset();
    fleetIndex.clear();
    camera.getWorldPosition(scratch.cam);
    const night = twinState.night;
    const dayGain = 0.35 + 0.95 * night;
    const t = clock.elapsedTime;
    for (const v of visits) {
      const pose = poseFor(v, ctx);
      if (!pose) continue;
      const kit = kits[v.type];
      const inst = rig.inst[v.type];
      const at = AIRCRAFT[v.type];
      const matrix = aircraftMatrix(new THREE.Matrix4(), pose, kit.axleZ[1]);
      fleetIndex.set(v.id, { visit: v, pose, matrix, kit });
      scratch.v.set(pose.x, pose.z, -pose.y);
      const d = scratch.v.distanceTo(scratch.cam) / at.length;
      const lod = d < 7 ? 0 : d < 30 ? 1 : 2;
      const colors = colorsFor(v.airline);
      const spinning = pose.engines && v.type === "reg";
      const propAngle = spinning ? t * 21 + hash01(v.id) * 6 : hash01(v.id) * 6;
      inst.add(lod, (part) => {
        if (part === "body") return matrix;
        const rest = kit.parts[part];
        if (!rest) return matrix;
        scratch.rz.makeRotationZ(part === "PROP_L" ? propAngle : -propAngle);
        return scratch.part.multiplyMatrices(matrix, rest).multiply(scratch.rz);
      }, (mat) => colors[mat] ?? null, { aSpin: -pose.dist / Math.max(0.3, at.wheelRadius), aRow: AIRLINE_ROW[v.airline] ?? 0 });

      // lights from the model's empties
      const ls = lightState(v, pose);
      const ph = hash01(v.id);
      const e = kit.empties;
      const put = (name: string, rgb: readonly number[], sz: number, gain: number) => {
        const p = e[name];
        if (!p || gain <= 0) return;
        scratch.v.copy(p).applyMatrix4(matrix);
        rig.lights.push(scratch.v.x, scratch.v.y, scratch.v.z, rgb, sz, gain);
      };
      const scale = at.length / 40;
      if (ls.nav) {
        put("LIGHT_NAV_L", RGB.red, 1.6 * scale, 1.1 * dayGain);
        put("LIGHT_NAV_R", RGB.green, 1.6 * scale, 1.1 * dayGain);
        put("LIGHT_TAIL", RGB.white, 1.3 * scale, 0.9 * dayGain);
      }
      if (ls.beacon) {
        const on = (t + ph) % 1.1 < 0.14 ? 3 : 0;
        put("LIGHT_BEACON_TOP", RGB.red, 2.0 * scale, on * dayGain);
        put("LIGHT_BEACON_BOTTOM", RGB.red, 2.0 * scale, ((t + ph + 0.5) % 1.1 < 0.14 ? 3 : 0) * dayGain);
      }
      if (ls.strobe) {
        const c = (t + ph * 1.3) % 1.3;
        const on = c < 0.05 || (c > 0.16 && c < 0.21) ? 4 : 0;
        put("LIGHT_STROBE_L", RGB.strobe, 2.4 * scale, on);
        put("LIGHT_STROBE_R", RGB.strobe, 2.4 * scale, on);
      }
      if (ls.landing) {
        put("LIGHT_LANDING_L", RGB.landing, 3.6 * scale, 2.2 * dayGain);
        put("LIGHT_LANDING_R", RGB.landing, 3.6 * scale, 2.2 * dayGain);
      }
      if (ls.taxi) put("LIGHT_TAXI", RGB.landing, 2.6 * scale, 1.6 * dayGain);
    }
    for (const k of TYPE_KEYS) rig.inst[k].commit();
    rig.lights.commit();
    const u = rig.lights.material.uniforms;
    u.uScale.value = pointScale(camera, size.height);
    for (const m of fleetLook.lights) m.emissiveIntensity = 0.4 + 2.6 * night;
    for (const m of fleetLook.windows) m.emissiveIntensity = (m.name.startsWith("M_Window") ? 0.9 : 0.25) * night;
  });

  if (!rig) return null;
  return <primitive object={rig.group} />;
}
