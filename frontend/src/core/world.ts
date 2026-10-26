/** Helpers over the authoritative world state (plain data so it can be cloned into workers). */

import { ALLOWED_TRANSITIONS, type Phase, type Restriction, type RestrictionKind, type Visit, type World } from "./types";

export class TransitionError extends Error {}

export function createWorld(seed: number, scenarioId: string, now: number): World {
  return {
    seed, scenarioId, now, visits: {}, stands: {}, restrictions: {}, incidents: {}, weather: {}, weatherTrack: {},
    resources: {}, version: 0, changeSeq: 0, changes: [], changeLog: [], counters: {},
  };
}

const VERSIONED: Record<string, keyof World> = {
  visit: "visits", stand: "stands", restriction: "restrictions", incident: "incidents",
};

export function touch(w: World, kind: string, key: string, detail = ""): void {
  w.version += 1;
  w.changeSeq += 1;
  w.changes.push(`${kind}|${key}`);
  w.changeLog.push({ seq: w.changeSeq, t: w.now, kind, key, detail });
  if (w.changeLog.length > 6000) w.changeLog.splice(0, 2000);
  const coll = VERSIONED[kind];
  if (coll) {
    const obj = (w[coll] as Record<string, { version: number }>)[key];
    if (obj) obj.version += 1;
  }
}

export function nextId(w: World, prefix: string): string {
  const n = (w.counters[prefix] ?? 0) + 1;
  w.counters[prefix] = n;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export function setPhase(w: World, v: Visit, phase: Phase, note = ""): void {
  if (phase === v.phase) return;
  if (!ALLOWED_TRANSITIONS[v.phase].includes(phase)) {
    throw new TransitionError(`${v.id}: illegal transition ${v.phase} -> ${phase}`);
  }
  v.history.push([w.now, phase, note]);
  v.phase = phase;
  touch(w, "visit", v.id, `phase:${phase}`);
}

export const isActive = (r: Restriction, t: number) => r.start <= t && t < r.end;

export function activeRestrictions(w: World, airport: string, kind?: RestrictionKind, t?: number,
  sharedOnly = false): Restriction[] {
  const at = t ?? w.now;
  const out: Restriction[] = [];
  for (const r of Object.values(w.restrictions)) {
    if (r.airport !== airport || !isActive(r, at)) continue;
    if (kind && r.kind !== kind) continue;
    if (sharedOnly && !r.shared) continue;
    out.push(r);
  }
  return out;
}

export function restrictionsOverlapping(w: World, airport: string, kind: RestrictionKind, t0: number, t1: number,
  sharedOnly = false): Restriction[] {
  return Object.values(w.restrictions).filter((r) => r.airport === airport && r.kind === kind && r.start < t1
    && r.end > t0 && (r.shared || !sharedOnly));
}

export function resourceAvailable(w: World, airport: string, pool: string, t0: number, t1: number,
  sharedOnly = false): number {
  const total = w.resources[airport]?.[pool] ?? 0;
  let out = 0;
  for (const r of restrictionsOverlapping(w, airport, "RESOURCE_OUTAGE", t0, t1, sharedOnly)) {
    if (r.params.pool === pool) out += Number(r.params.units ?? 0);
  }
  return Math.max(0, total - out);
}

export function cloneWorld(w: World): World {
  const c = structuredClone(w);
  c.changes = [];
  return c;
}

export function callsignOf(v: Visit): string {
  const inbound = ["SCHEDULED", "INBOUND", "HOLDING", "APPROACH", "LANDING", "TAXI_IN", "WAITING_STAND"];
  if (v.arr && inbound.includes(v.phase)) return v.arr.callsign;
  if (v.dep) return v.dep.callsign;
  return v.arr?.callsign ?? v.id;
}

export const sibt = (v: Visit) => v.arr?.sched ?? null;
export const sobt = (v: Visit) => v.dep?.sched ?? null;

export function fmtTime(t: number | null | undefined, seconds = false): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return "—";
  const d = ((t % 86400) + 86400) % 86400;
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = Math.floor(d % 60);
  const base = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return seconds ? `${base}:${String(s).padStart(2, "0")}` : base;
}
