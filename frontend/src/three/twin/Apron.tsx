"use client";

/**
 * Apron life: apron-drive jet bridges that dock to the parked aircraft's doors, and turnaround
 * ground equipment staged from the simulator's turnaround timeline (on-block → ready → pushback).
 * Everything is derived from simulator state; nothing here changes it.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { AIRCRAFT, type TypeKey } from "@/core/aircraft";
import type { AirportInfo, StandInfo } from "@/core/airports/registry";
import type { Runtime } from "@/core/runtime";
import type { Visit } from "@/core/types";
import { loadKit, type Kit } from "./assets";
import { fleetIndex, useFleetKits, type FleetEntry } from "./Fleet";
import { equipmentLook, equipmentMaterial, InstancedKit } from "./instancing";
import { twinState } from "./state";

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const BRIDGE_PARTS = /^(JB_(?:Cab|Rotunda|Tunnel_A|Tunnel_B|DriveColumn_Lift|DriveColumn))/;

const GSE = [
  "gpu_cart", "belt_loader", "baggage_tractor", "baggage_cart", "uld_dolly", "catering_truck", "fuel_hydrant_dispenser",
  "pushback_tug", "stairs_truck", "apron_bus", "ambulift", "main_deck_loader",
] as const;
type GseKey = (typeof GSE)[number];

function useEquipment() {
  const [kits, setKits] = useState<{ bridge: Kit; gse: Record<GseKey, Kit> } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      loadKit("/assets/equipment/jet_bridge_glass.glb", "jet_bridge", { material: equipmentMaterial, partRule: (n) => BRIDGE_PARTS.exec(n)?.[1] ?? null }),
      ...GSE.map((k) => loadKit(`/assets/equipment/${k}.glb`, k, { material: equipmentMaterial })),
    ]).then(([bridge, ...rest]) => {
      if (alive) setKits({ bridge, gse: Object.fromEntries(GSE.map((k, i) => [k, rest[i]])) as Record<GseKey, Kit> });
    }).catch((e) => console.error("equipment assets failed to load", e));
    return () => { alive = false; };
  }, []);
  return kits;
}

// ------------------------------------------------------------------ jet bridge geometry

interface BridgeRig {
  mount: THREE.Vector3; // root space (rotunda at origin)
  bMin: THREE.Vector3; bMax: THREE.Vector3; // A-local
  pivot: THREE.Vector3; colMount: THREE.Vector3; // B-local
  dock: THREE.Vector3; // cab-local bumper face
}

function rigOf(kit: Kit): BridgeRig {
  const toLocal = (name: string, part: string) => {
    const p = kit.empties[name]?.clone() ?? new THREE.Vector3();
    const m = kit.parts[part];
    return m ? p.applyMatrix4(m.clone().invert()) : p;
  };
  return {
    mount: kit.empties.TUNNEL_A_MOUNT?.clone() ?? new THREE.Vector3(0, 5, -1.45),
    bMin: toLocal("TUNNEL_B_RETRACTED", "JB_Tunnel_A"), bMax: toLocal("TUNNEL_B_EXTENDED", "JB_Tunnel_A"),
    pivot: toLocal("CAB_PIVOT", "JB_Tunnel_B"), colMount: toLocal("DRIVE_COLUMN_MOUNT", "JB_Tunnel_B"),
    dock: toLocal("CAB_DOCK", "JB_Cab"),
  };
}

interface Pose { yaw: number; pitch: number; t: number; cab: number }

/** Solve yaw / pitch / extension / cab yaw so the cab bumper meets `door` (bridge frame) facing `face`. */
function solveDock(rig: BridgeRig, door: THREE.Vector3, face: THREE.Vector3): Pose {
  const cabYaw = Math.atan2(-face.x, -face.z);
  const dockLen = -rig.dock.z;
  const P = new THREE.Vector3(door.x - face.x * dockLen, door.y - rig.dock.y, door.z - face.z * dockLen);
  const yaw = Math.atan2(-P.x, -P.z);
  const along = Math.hypot(P.x, P.z);
  const dA = along - -rig.mount.z, dH = P.y - rig.mount.y;
  const a0 = -(rig.bMin.z + rig.pivot.z), a1 = -(rig.bMax.z + rig.pivot.z);
  const b = rig.bMin.y + rig.pivot.y;
  const L = Math.hypot(dA, dH);
  const a = Math.sqrt(Math.max(0, L * L - b * b));
  const t = THREE.MathUtils.clamp((a - a0) / (a1 - a0), 0, 1);
  const ac = a0 + (a1 - a0) * t;
  const pitch = THREE.MathUtils.clamp(Math.atan2(dH, dA) - Math.atan2(b, ac), -8 * DEG, 6 * DEG);
  const cab = THREE.MathUtils.clamp(wrap(cabYaw - yaw), -45 * DEG, 45 * DEG);
  return { yaw, pitch, t, cab };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const REST: Pose = { yaw: 0, pitch: 0, t: 0.05, cab: 0 };

const qy = new THREE.Quaternion(), qa = new THREE.Quaternion(), qp = new THREE.Quaternion(), qc = new THREE.Quaternion();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);

/** Part matrices (bridge frame) for a pose, following the asset's reference implementation. */
function bridgeParts(rig: BridgeRig, p: Pose, frame: THREE.Matrix4, out: Record<string, THREE.Matrix4>): void {
  qy.setFromAxisAngle(UP, p.yaw);
  qa.copy(qy).multiply(qp.setFromAxisAngle(X, p.pitch));
  const A = v1.copy(rig.mount).applyQuaternion(qy);
  out.JB_Rotunda.copy(frame);
  out.JB_Tunnel_A.compose(A, qa, one).premultiply(frame);
  const B = v2.copy(rig.bMin).lerp(rig.bMax, p.t).applyQuaternion(qa).add(A);
  out.JB_Tunnel_B.compose(B, qa, one).premultiply(frame);
  const cabPos = rig.pivot.clone().applyQuaternion(qa).add(B);
  qc.setFromAxisAngle(UP, p.yaw + p.cab);
  out.JB_Cab.compose(cabPos, qc, one).premultiply(frame);
  const m = rig.colMount.clone().applyQuaternion(qa).add(B);
  out.JB_DriveColumn.compose(new THREE.Vector3(m.x, 0, m.z), qy, one).premultiply(frame);
  out.JB_DriveColumn_Lift.compose(new THREE.Vector3(m.x, m.y, m.z), qy, one).premultiply(frame);
}

interface BridgeSlot {
  stand: StandInfo;
  door: "DOOR_L1" | "DOOR_L2";
  frame: THREE.Matrix4; // bridge frame in world
  frameInv: THREE.Matrix4;
  link: { from: THREE.Vector3; to: THREE.Vector3 } | null;
  pose: Pose;
}

const designType = (st: StandInfo): TypeKey => (st.sizeCode === "F" ? "vla" : st.sizeCode === "E" || st.sizeCode === "D" ? "wb" : "nb");

/** Stand-frame helpers: forward = heading, left = 90° anticlockwise; three.js coordinates. */
function standBasis(st: StandInfo) {
  const h = st.heading * DEG;
  const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
  const left = new THREE.Vector3(-Math.cos(h), 0, -Math.sin(h));
  const stop = new THREE.Vector3(st.x, 0, -st.y);
  return { fwd, left, stop };
}

function buildBridgeSlots(ap: AirportInfo, fleetKits: Record<TypeKey, Kit>): BridgeSlot[] {
  const out: BridgeSlot[] = [];
  for (const st of Object.values(ap.stands)) {
    if (!st.contact || st.bridgeCount <= 0) continue;
    const kit = fleetKits[designType(st)];
    const { fwd, left, stop } = standBasis(st);
    const doors = (["DOOR_L1", "DOOR_L2"] as const).filter((d) => kit.empties[d]).slice(0, Math.min(2, st.bridgeCount));
    doors.forEach((door, k) => {
      const d = kit.empties[door];
      // door in world for the design aircraft parked at the stop point (model: -Z = forward, -X = left)
      const doorW = stop.clone().addScaledVector(fwd, -d.z).addScaledVector(left, -d.x);
      const root = doorW.clone().addScaledVector(left, 19).addScaledVector(fwd, k === 0 ? 13 : 8);
      const dir = doorW.clone().sub(root).setY(0).normalize();
      const psi0 = Math.atan2(-dir.x, -dir.z);
      const frame = new THREE.Matrix4().compose(root, new THREE.Quaternion().setFromAxisAngle(UP, psi0), one);
      let link: BridgeSlot["link"] = null;
      if (k === 0 && st.bridgeRoot) {
        const hint = new THREE.Vector3(st.bridgeRoot[0], 0, -st.bridgeRoot[1]);
        const rel = hint.clone().sub(stop);
        if (rel.dot(left) > -6 && rel.dot(fwd) > -8 && hint.distanceTo(root) > 4 && hint.distanceTo(root) < 75) link = { from: root.clone(), to: hint };
      }
      out.push({ stand: st, door, frame, frameInv: frame.clone().invert(), link, pose: { ...REST } });
    });
  }
  return out;
}

// ------------------------------------------------------------------ GSE staging

interface Placement { key: GseKey; x: number; z: number; yaw: number } // aircraft-local (x right, z aft), yaw: radians, 0 = facing nose

function turnaroundSet(v: Visit, kit: Kit, st: StandInfo | undefined, now: number): Placement[] {
  const t = AIRCRAFT[v.type];
  const e = kit.empties;
  const L1 = e.DOOR_L1 ?? new THREE.Vector3(-2, 3, -2);
  const fw = Math.abs(L1.x);
  const Lz = t.length;
  const start = v.aibt ?? now - 600;
  const ready = v.readyAt ?? v.tobt ?? start + v.minTat;
  const span = Math.max(600, ready - start);
  const k = (now - start) / span; // 0 = on block, 1 = ready
  const out: Placement[] = [];
  const toFuselage = Math.PI / 2; // facing −X (vehicle front toward the fuselage from the right side)
  const remote = !st?.contact || (st?.bridgeCount ?? 0) === 0;
  if (v.phase === "READY" || k > 0.92) {
    out.push({ key: "pushback_tug", x: 0, z: -(e.TUG_HITCH ? -e.TUG_HITCH.z : 0) - 6.2, yaw: Math.PI });
    out.push({ key: "gpu_cart", x: fw + 2.4, z: L1.z + 4, yaw: 0 });
    return out;
  }
  if (k < 0) return out;
  out.push({ key: "gpu_cart", x: fw + 2.4, z: L1.z + 4, yaw: 0 });
  if (k > 0.04 && k < 0.85) {
    const fwdHold = L1.z + Lz * 0.2, aftHold = L1.z + Lz * 0.6;
    if (t.freighter) {
      out.push({ key: "main_deck_loader", x: -(fw + 6.5), z: L1.z + Lz * 0.72, yaw: -Math.PI / 2 });
      for (let i = 0; i < 4; i++) out.push({ key: "uld_dolly", x: -(fw + 16), z: L1.z + Lz * 0.55 + i * 4.2, yaw: 0 });
    } else {
      out.push({ key: "belt_loader", x: fw + 4.4, z: fwdHold, yaw: toFuselage - 0.35 });
      if (Lz > 30) out.push({ key: "belt_loader", x: fw + 4.4, z: aftHold, yaw: toFuselage + 0.35 });
      out.push({ key: "baggage_tractor", x: fw + 11, z: fwdHold - 7, yaw: Math.PI });
      const cart: GseKey = t.widebody ? "uld_dolly" : "baggage_cart";
      for (let i = 0; i < 3; i++) out.push({ key: cart, x: fw + 11, z: fwdHold - 1.5 + i * 3.6, yaw: Math.PI });
    }
    if (k > 0.12 && k < 0.7 && !t.freighter) out.push({ key: "catering_truck", x: fw + 4, z: L1.z + Lz * 0.78, yaw: toFuselage });
    if (k > 0.2 && k < 0.75) {
      const eng = e.ENGINE_2 ?? new THREE.Vector3(fw + 6, 2, L1.z + Lz * 0.4);
      out.push({ key: "fuel_hydrant_dispenser", x: Math.abs(eng.x) + 1.5, z: eng.z + 6, yaw: 0 });
    }
    if (remote && !t.freighter && t.key !== "biz") {
      out.push({ key: "stairs_truck", x: -(fw + 2.6), z: L1.z + 0.5, yaw: -Math.PI / 2 });
      if (Lz > 30) out.push({ key: "stairs_truck", x: -(fw + 2.6), z: L1.z + Lz * 0.8, yaw: -Math.PI / 2 });
      if (k < 0.15 || k > 0.7) out.push({ key: "apron_bus", x: -(fw + 17), z: L1.z + Lz * 0.3, yaw: 0 });
    }
    if (v.prm > 0 && remote) out.push({ key: "ambulift", x: fw + 3.4, z: L1.z + 0.6, yaw: toFuselage });
  }
  return out;
}

// ------------------------------------------------------------------ component

export function Apron({ rt, ap }: { rt: Runtime; ap: AirportInfo }) {
  const eq = useEquipment();
  const fleetKits = useFleetKits();
  const { camera } = useThree();
  const rig = useMemo(() => {
    if (!eq || !fleetKits) return null;
    const group = new THREE.Group();
    group.name = "apron";
    const bridges = new InstancedKit(eq.bridge, { capacity: 320, castShadow: true, receiveShadow: true });
    group.add(bridges.group);
    const gse = Object.fromEntries(GSE.map((k) => [k, new InstancedKit(eq.gse[k], { capacity: k === "baggage_cart" || k === "uld_dolly" ? 480 : 160, castShadow: true, receiveShadow: true })])) as Record<GseKey, InstancedKit>;
    for (const k of GSE) group.add(gse[k].group);
    const slots = buildBridgeSlots(ap, fleetKits);
    // fixed links from the terminal to each rotunda: one instanced box, plus support pillars
    const links = slots.filter((s) => s.link);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const linkMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: "#d6d9dc", roughness: 0.55, metalness: 0.2 }), Math.max(1, links.length));
    const pillarMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 10), new THREE.MeshStandardMaterial({ color: "#9aa1a8", roughness: 0.6 }), Math.max(1, links.length * 4));
    const o = new THREE.Object3D();
    let np = 0;
    links.forEach((s, i) => {
      const a = s.link!.from, b = s.link!.to;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const len = a.distanceTo(b);
      o.position.set(mid.x, 6.6, mid.z);
      o.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
      o.scale.set(3.4, 3.2, len);
      o.updateMatrix();
      linkMesh.setMatrixAt(i, o.matrix);
      for (let f = 0.15; f < 1; f += 0.35) {
        const p = a.clone().lerp(b, f);
        o.position.set(p.x, 2.5, p.z);
        o.rotation.set(0, 0, 0);
        o.scale.set(1, 5, 1);
        o.updateMatrix();
        pillarMesh.setMatrixAt(np++, o.matrix);
      }
    });
    linkMesh.count = links.length;
    pillarMesh.count = np;
    for (const m of [linkMesh, pillarMesh]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
    return { group, bridges, gse, slots };
  }, [eq, fleetKits, ap]);
  useEffect(() => () => { if (rig) { rig.bridges.dispose(); Object.values(rig.gse).forEach((k) => k.dispose()); } }, [rig]);

  const scratch = useMemo(() => ({
    parts: Object.fromEntries(["JB_Rotunda", "JB_Tunnel_A", "JB_Tunnel_B", "JB_Cab", "JB_DriveColumn", "JB_DriveColumn_Lift"].map((k) => [k, new THREE.Matrix4()])) as Record<string, THREE.Matrix4>,
    m: new THREE.Matrix4(), v: new THREE.Vector3(), cam: new THREE.Vector3(), q: new THREE.Quaternion(),
  }), []);

  useFrame((_, dt) => {
    if (!rig || !eq || !fleetKits) return;
    const w = rt.world;
    const now = w.now;
    camera.getWorldPosition(scratch.cam);
    const brig = rigOf(eq.bridge);
    rig.bridges.reset();
    // which aircraft is parked at which stand (exact pose from the fleet layer)
    const parked = new Map<string, FleetEntry>();
    for (const e of fleetIndex.values()) if ((e.visit.phase === "ON_STAND" || e.visit.phase === "READY") && e.visit.stand && e.pose.kind === "stand") parked.set(e.visit.stand, e);
    const ease = Math.min(1, dt * 2.2);
    for (const s of rig.slots) {
      const e = parked.get(s.stand.id);
      let target = REST;
      if (e) {
        const kit = fleetKits[e.visit.type];
        const door = kit.empties[s.door];
        if (door) {
          const v = e.visit;
          const since = now - (v.aibt ?? now - 600);
          const until = v.tsat !== null ? v.tsat - now : v.tobt !== null ? v.tobt - now + 300 : 1e9;
          if (since > 45 && until > 150) {
            const dW = door.clone().applyMatrix4(e.matrix).applyMatrix4(s.frameInv);
            // cab faces the fuselage: aircraft right vector (+X) in the bridge frame
            const face = new THREE.Vector3(1, 0, 0).transformDirection(e.matrix).transformDirection(s.frameInv).setY(0).normalize();
            target = solveDock(brig, dW, face);
          }
        }
      }
      const p = s.pose;
      p.yaw += wrap(target.yaw - p.yaw) * ease;
      p.pitch += (target.pitch - p.pitch) * ease;
      p.t += (target.t - p.t) * ease;
      p.cab += wrap(target.cab - p.cab) * ease;
      scratch.v.setFromMatrixPosition(s.frame);
      const dist = scratch.v.distanceTo(scratch.cam);
      const lod = dist < 260 ? 0 : dist < 1100 ? 1 : 2;
      bridgeParts(brig, p, s.frame, scratch.parts);
      rig.bridges.add(lod, (part) => scratch.parts[part] ?? s.frame);
    }
    rig.bridges.commit();

    // ground equipment around parked aircraft near the camera
    for (const k of GSE) rig.gse[k].reset();
    const tmpM = scratch.m;
    for (const e of parked.values()) {
      scratch.v.set(e.pose.x, 0, -e.pose.y);
      const dist = scratch.v.distanceTo(scratch.cam);
      if (dist > 2200) continue;
      const lod = dist < 220 ? 0 : dist < 900 ? 1 : 2;
      const st = ap.stands[e.visit.stand!];
      for (const pl of turnaroundSet(e.visit, fleetKits[e.visit.type], st, now)) {
        scratch.q.setFromAxisAngle(UP, pl.yaw);
        tmpM.compose(new THREE.Vector3(pl.x, 0, pl.z), scratch.q, one).premultiply(e.matrix);
        rig.gse[pl.key].add(lod, () => tmpM);
      }
    }
    // pushback tugs during pushback and tows
    for (const e of fleetIndex.values()) {
      const kind = e.pose.kind;
      const towing = e.visit.movementKind === "tow" && (kind === "pushback" || kind === "pivot" || kind === "tow");
      if (!(kind === "pushback" || towing || (kind === "pivot" && e.visit.phase === "PUSHBACK"))) continue;
      const hitch = fleetKits[e.visit.type].empties.TUG_HITCH;
      scratch.q.setFromAxisAngle(UP, Math.PI);
      tmpM.compose(new THREE.Vector3(0, 0, (hitch?.z ?? 0) - 6.2), scratch.q, one).premultiply(e.matrix);
      rig.gse.pushback_tug.add(1, () => tmpM);
    }
    for (const k of GSE) rig.gse[k].commit();
    const night = twinState.night;
    for (const m of equipmentLook.lights) m.emissiveIntensity = 0.3 + 2.2 * night;
    for (const m of equipmentLook.beacons) m.emissiveIntensity = 1 + 3 * night;
  });

  if (!rig) return null;
  return <primitive object={rig.group} />;
}
