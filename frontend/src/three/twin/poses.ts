/**
 * Aircraft poses for the digital twin, derived only from simulator state:
 * movement legs (exact kinematics shared with the simulator), stand positions, holding points and
 * airborne holding stacks. No animation is invented that the simulator does not imply.
 */

import * as THREE from "three";
import { AIRCRAFT, type TypeKey } from "@/core/aircraft";
import type { AirportInfo } from "@/core/airports/registry";
import { positionAt } from "@/core/sim/movementEval";
import type { Visit } from "@/core/types";

export interface FleetPose {
  x: number; // layout east
  y: number; // layout north
  z: number; // altitude above ground
  heading: number;
  pitch: number; // radians, + nose up
  speed: number;
  dist: number;
  kind: string; // movement leg kind, or "stand" | "wait" | "holding"
  engines: boolean;
}

const MOVING = new Set(["APPROACH", "LANDING", "TAXI_IN", "TOWING", "PUSHBACK", "TAXI_OUT", "TAKEOFF"]);
const DEG = Math.PI / 180;

/** Pitch attitude for airborne/rotation phases (cosmetic, derived from the leg kind and timing). */
function pitchFor(v: Visit, kind: string, t: number): number {
  const legs = v.movement ?? [];
  const leg = legs.find((l) => l.kind === kind);
  if (!leg) return 0;
  const t0 = leg.s[0][3], t1 = leg.s[leg.s.length - 1][3];
  switch (kind) {
    case "approach": return 1.8 * DEG;
    case "landing": return Math.max(0, 4.5 * (1 - (t - t0) / 4)) * DEG;
    case "takeoff": return Math.max(0, Math.min(1, (t - (t1 - 3.5)) / 3.5)) * 9 * DEG;
    case "climb": return 11 * DEG;
    default: return 0;
  }
}

export interface PoseContext {
  ap: AirportInfo;
  now: number;
  wall: number;
  lastHeading: Map<string, number>;
  waitQueue: Map<string, number>; // visit id → index in its hold-point queue
  holdIndex: Map<string, number>; // visit id → level in the airborne holding stack
}

export function buildQueues(visits: Visit[], ctx: PoseContext): void {
  ctx.waitQueue.clear();
  ctx.holdIndex.clear();
  const byPoint = new Map<string, Visit[]>();
  const holding: Visit[] = [];
  for (const v of visits) {
    if (v.phase === "WAITING_STAND" && v.holdPoint) {
      const k = `${Math.round(v.holdPoint[0])}:${Math.round(v.holdPoint[1])}`;
      if (!byPoint.has(k)) byPoint.set(k, []);
      byPoint.get(k)!.push(v);
    } else if (v.phase === "HOLDING") holding.push(v);
  }
  for (const list of byPoint.values()) {
    list.sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0) || (a.id < b.id ? -1 : 1));
    list.forEach((v, i) => ctx.waitQueue.set(v.id, i));
  }
  holding.sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((v, i) => ctx.holdIndex.set(v.id, i));
}

export function poseFor(v: Visit, ctx: PoseContext): FleetPose | null {
  const { ap, now } = ctx;
  if (MOVING.has(v.phase) && v.movement?.length) {
    const p = positionAt(v.movement, now);
    if (!p) return null;
    ctx.lastHeading.set(v.id, p.heading);
    const towed = v.movementKind === "tow";
    return {
      x: p.x, y: p.y, z: p.z, heading: p.heading, pitch: pitchFor(v, p.kind, now), speed: p.speed, dist: p.dist, kind: p.kind,
      engines: !towed && p.kind !== "pushback",
    };
  }
  if ((MOVING.has(v.phase) || v.phase === "ON_STAND" || v.phase === "READY") && v.stand) {
    const st = ap.stands[v.stand];
    if (!st) return null;
    ctx.lastHeading.set(v.id, st.heading);
    return { x: st.x, y: st.y, z: 0, heading: st.heading, pitch: 0, speed: 0, dist: 0, kind: "stand", engines: false };
  }
  if (v.phase === "WAITING_STAND" && v.holdPoint) {
    const heading = ctx.lastHeading.get(v.id) ?? nearestEdgeHeading(ap, v.holdPoint);
    const q = ctx.waitQueue.get(v.id) ?? 0;
    const back = q * (AIRCRAFT[v.type].length + 18);
    const h = heading * DEG;
    return {
      x: v.holdPoint[0] - Math.sin(h) * back, y: v.holdPoint[1] - Math.cos(h) * back, z: 0, heading, pitch: 0, speed: 0, dist: 0,
      kind: "wait", engines: true,
    };
  }
  if (v.phase === "HOLDING") return holdingPose(v, ctx);
  return null;
}

function nearestEdgeHeading(ap: AirportInfo, p: [number, number]): number {
  const n = ap.graph.nearestNode(p[0], p[1]);
  for (const [, ei] of ap.graph.adj.get(n) ?? []) {
    const e = ap.graph.edges[ei];
    const pts = e.a === n ? e.points : [...e.points].reverse();
    if (pts.length >= 2) return ((Math.atan2(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * 180) / Math.PI + 360) % 360;
  }
  return 0;
}

/**
 * Airborne holding: racetrack patterns 15 km out, either side of the final approach course,
 * stacked 300 m apart from 1,200 m. Animated on wall-clock time (the stack is a visual summary;
 * the simulator models holding as time, not as a track).
 */
function holdingPose(v: Visit, ctx: PoseContext): FleetPose | null {
  const end = ctx.ap.runwayEnds[ctx.ap.arrivalEnd];
  if (!end) return null;
  const level = ctx.holdIndex.get(v.id) ?? 0;
  const side = level % 2 ? 1 : -1;
  const h = end.heading * DEG;
  const ux = Math.sin(h), uy = Math.cos(h); // inbound course
  const nx = uy * side, ny = -ux * side; // lateral
  const fx = end.x - ux * 15000 + nx * 6000, fy = end.y - uy * 15000 + ny * 6000;
  const R = 2600, Ls = 6500;
  const lap = 2 * Ls + 2 * Math.PI * R;
  const speed = 115;
  const s = ((((ctx.wall * speed) / lap + level * 0.37) % 1) + 1) % 1 * lap;
  let lx: number, ly: number, hd: number; // local: x along course, y lateral
  if (s < Ls) { lx = s; ly = 0; hd = 0; }
  else if (s < Ls + Math.PI * R) { const a = (s - Ls) / R; lx = Ls + Math.sin(a) * R; ly = R - Math.cos(a) * R; hd = a; }
  else if (s < 2 * Ls + Math.PI * R) { lx = Ls - (s - Ls - Math.PI * R); ly = 2 * R; hd = Math.PI; }
  else { const a = (s - 2 * Ls - Math.PI * R) / R; lx = -Math.sin(a) * R; ly = R + Math.cos(a) * R; hd = Math.PI + a; }
  const x = fx + ux * lx + nx * ly, y = fy + uy * lx + ny * ly;
  const course = Math.atan2(ux, uy) + side * hd;
  return {
    x, y, z: 1200 + 300 * Math.floor(level / 2), heading: ((course * 180) / Math.PI + 360) % 360, pitch: 1 * DEG,
    speed, dist: 0, kind: "holding", engines: true,
  };
}

export interface LightState { nav: boolean; beacon: boolean; strobe: boolean; landing: boolean; taxi: boolean }

export function lightState(v: Visit, pose: FleetPose): LightState {
  const airborne = ["approach", "landing", "takeoff", "climb", "holding"].includes(pose.kind);
  const taxiing = pose.kind === "taxi" && pose.speed > 0.3;
  return {
    nav: true,
    beacon: pose.engines || pose.kind === "pushback" || pose.kind === "pivot" || pose.kind === "hold" || v.phase === "WAITING_STAND",
    strobe: airborne,
    landing: ["approach", "landing", "takeoff", "climb"].includes(pose.kind),
    taxi: taxiing || pose.kind === "hold",
  };
}

const UP = new THREE.Vector3(0, 1, 0), XAXIS = new THREE.Vector3(1, 0, 0);
const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion();
const mA = new THREE.Matrix4(), mB = new THREE.Matrix4();

/** World matrix of an aircraft root (nose-gear origin), pitching about the main gear. */
export function aircraftMatrix(out: THREE.Matrix4, pose: FleetPose, mainGearZ: number): THREE.Matrix4 {
  qYaw.setFromAxisAngle(UP, -pose.heading * DEG);
  out.makeRotationFromQuaternion(qYaw);
  out.setPosition(pose.x, pose.z, -pose.y);
  if (pose.pitch !== 0) {
    qPitch.setFromAxisAngle(XAXIS, pose.pitch);
    mA.makeTranslation(0, 0, mainGearZ);
    mB.makeRotationFromQuaternion(qPitch);
    out.multiply(mA).multiply(mB);
    mA.makeTranslation(0, 0, -mainGearZ);
    out.multiply(mA);
  }
  return out;
}

export const TYPE_KEYS: TypeKey[] = ["nb", "wb", "vla", "cargo", "biz", "reg"];
