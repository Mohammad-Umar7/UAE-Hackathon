/**
 * Independent deterministic plan validation — a separate code path from the optimiser.
 *
 * Re-derives stand occupancy, capacity usage and eligibility directly from the *current*
 * authoritative state and checks every element of a plan against them. Run by the Validation &
 * Safety agent before a plan is proposed, whenever inputs change while a plan is pending, and
 * immediately before commit.
 */

import { AIRCRAFT } from "../aircraft";
import { diversionMinutes } from "../airports/profiles";
import { standAccepts, type Registry } from "../airports/registry";
import { BUCKET_S, bucketCapacity, bucketOf } from "../sim/capacity";
import type { Decision } from "../sim/engine";
import type { Visit, World } from "../types";
import { callsignOf, fmtTime, resourceAvailable } from "../world";
import { airportEligible, standEligible } from "./eligibility";
import type { PlanRow } from "./milp";
import type { Snapshot } from "./problem";

const INBOUND = new Set(["SCHEDULED", "INBOUND", "HOLDING"]);
const ASSIGNABLE = new Set([...INBOUND, "APPROACH", "LANDING", "TAXI_IN", "WAITING_STAND"]);
const BUFFER = 300;
const TOL = 90;

export const CONSTRAINT_CATALOGUE: [string, string][] = [
  ["STAND_COMPATIBILITY", "Aircraft wingspan and category fit the stand"],
  ["STAND_OVERLAP", "One aircraft per stand at a time, with 5-minute buffers"],
  ["STAND_CLOSURE", "Closed stands are not used"],
  ["ARRIVAL_CAPACITY", "Landings per 15 min within the modelled runway capacity"],
  ["FUEL", "Airborne holding within the flight's fuel endurance (synthetic)"],
  ["DIVERSION_ELIGIBILITY", "Alternate accepts aircraft size, runway and handling arrangement"],
  ["DIVERSION_ACCEPTANCE", "Diversions per hour within the alternate's modelled limit"],
  ["ACCESSIBILITY", "Passengers needing assistance keep accessible boarding (bridge or ambulift)"],
  ["PHASE", "Decision still executable in the aircraft's current phase"],
  ["AUTHORISATION", "Commit only with every required approval recorded"],
];

export interface Violation {
  code: string;
  visit: string | null;
  callsign: string | null;
  detail: string;
}

export interface ValidationReport {
  valid: boolean;
  violations: Violation[];
  checks: Record<string, number>;
  t: number;
}

const offTime = (v: Visit, on: number) => (v.dep ? Math.max(v.dep.sched, on + v.minTat) : on + 86400);

function occupancy(w: World, ap: Registry, exclude: Set<string>, sharedOnly: boolean) {
  const now = w.now;
  const occ = new Map<string, [number, number, string][]>();
  const add = (k: string, x: [number, number, string]) => { if (!occ.has(k)) occ.set(k, []); occ.get(k)!.push(x); };
  for (const v of Object.values(w.visits)) {
    if (exclude.has(v.id) || !v.stand || v.phase === "DIVERTED" || v.phase === "CANCELLED" || v.phase === "DEPARTED") continue;
    const st = ap[v.airport]?.stands[v.stand];
    if (!st) continue;
    const key = `${v.airport}:${v.stand}`;
    if (v.phase === "ON_STAND" || v.phase === "READY" || v.phase === "TOWING") {
      let ready = v.readyAt ?? now;
      if (v.techHoldUntil) ready = Math.max(ready, v.techHoldUntil);
      let off = v.dep ? Math.max(ready, v.dep.sched, now) : now + 86400;
      if (v.phase === "READY" && v.tsat) off = v.tsat;
      add(key, [now - 60, off + BUFFER, callsignOf(v)]);
    } else if (ASSIGNABLE.has(v.phase)) {
      const eldt = v.eldt ?? v.eta;
      if (eldt === null) continue;
      const on = INBOUND.has(v.phase) || v.phase === "APPROACH" ? Math.max(now, eldt + st.taxiIn) : now + 240;
      add(key, [on - BUFFER, offTime(v, on) + BUFFER, callsignOf(v)]);
    }
  }
  for (const r of Object.values(w.restrictions)) {
    if (r.kind === "STAND_CLOSED" && (r.shared || !sharedOnly) && r.end > now) {
      for (const sid of (r.params.stands as string[]) ?? []) add(`${r.airport}:${sid}`, [r.start, r.end, `closure ${r.id}`]);
    }
  }
  return occ;
}

export function validatePlan(w: World, ap: Registry, decisions: Decision[], rows: PlanRow[] = [], t0?: number,
  sharedOnly = true): ValidationReport {
  const now = w.now;
  const checks: Record<string, number> = Object.fromEntries(CONSTRAINT_CATALOGUE.map(([c]) => [c, 0]));
  const violations: Violation[] = [];
  const planVisits = new Set([...decisions.filter((d) => d.action !== "unresolved").map((d) => d.visit),
    ...rows.filter((r) => r.option !== "unresolved").map((r) => r.visit)]);
  const occ = occupancy(w, ap, planVisits, sharedOnly);
  const landings: Record<string, Map<number, number>> = Object.fromEntries(Object.keys(ap).map((a) => [a, new Map()]));
  const planBuckets: Record<string, Set<number>> = Object.fromEntries(Object.keys(ap).map((a) => [a, new Set()]));
  for (const v of Object.values(w.visits)) {
    if (planVisits.has(v.id) || !v.arr || v.phase === "DIVERTED" || v.phase === "CANCELLED") continue;
    const tl = v.aldt ?? v.eldt;
    if (tl !== null && tl > now - BUCKET_S) landings[v.airport].set(bucketOf(tl), (landings[v.airport].get(bucketOf(tl)) ?? 0) + 1);
  }
  const add = (code: string, d: { visit?: string; callsign?: string }, detail: string) =>
    violations.push({ code, visit: d.visit ?? null, callsign: d.callsign ?? null, detail });
  const place = (airport: string, stand: string, s: number, e: number, d: { visit?: string; callsign?: string }) => {
    checks.STAND_OVERLAP++;
    const k = `${airport}:${stand}`;
    const hit = (occ.get(k) ?? []).find(([a, b]) => a < e - TOL && b > s + TOL);
    if (hit) add("STAND_OVERLAP", d, `stand ${stand} at ${airport} overlaps ${hit[2]} (${fmtTime(Math.max(hit[0], s))}–${fmtTime(Math.min(hit[1], e))})`);
    if (!occ.has(k)) occ.set(k, []);
    occ.get(k)!.push([s, e, d.callsign ?? d.visit ?? "plan"]);
  };
  const land = (airport: string, t: number) => {
    const b = bucketOf(t);
    landings[airport].set(b, (landings[airport].get(b) ?? 0) + 1);
    planBuckets[airport].add(b);
  };
  const divCount = new Map<string, number>();

  // ---- 1. executability & eligibility per decision ---------------------------------------
  for (const d of decisions) {
    if (d.action === "unresolved") continue;
    const v = w.visits[d.visit];
    if (!v) { add("PHASE", d, "aircraft visit no longer exists"); continue; }
    const t = AIRCRAFT[v.type];
    checks.PHASE++;
    if (d.action === "assign_stand") {
      if (v.airport === d.airport && v.stand === d.stand && !ASSIGNABLE.has(v.phase)) continue; // already satisfied
      if (!ASSIGNABLE.has(v.phase) || v.airport !== d.airport) { add("PHASE", d, `stand reassignment no longer executable (phase ${v.phase}, at ${v.airport})`); continue; }
      const st = ap[d.airport].stands[d.stand!];
      if (!st) { add("STAND_COMPATIBILITY", d, `unknown stand ${d.stand}`); continue; }
      const on = d.on_block ?? now + 240;
      const chk = standEligible(w, v, t, st, on, offTime(v, on), sharedOnly);
      checks.STAND_COMPATIBILITY++;
      if (v.prm) checks.ACCESSIBILITY++;
      if (!chk.ok) add(chk.code === "PRM_ACCESS" ? "ACCESSIBILITY" : chk.code === "STAND_CLOSED" ? "STAND_CLOSURE" : "STAND_COMPATIBILITY", d, chk.reason);
    } else if (d.action === "landing_slot") {
      if (!INBOUND.has(v.phase)) {
        // overtaken by events: the flight already landed at its home airport (not a conflict)
        if (v.airport === d.airport && v.phase !== "DIVERTED" && v.phase !== "CANCELLED") continue;
        add("PHASE", d, `landing slot no longer applicable (phase ${v.phase})`);
        continue;
      }
      checks.FUEL++;
      if ((v.phase === "INBOUND" || v.phase === "HOLDING") && v.eta !== null && v.fuelEndurance !== null && d.eldt! - v.eta > v.fuelEndurance + 120) {
        add("FUEL", d, `holding ${Math.round((d.eldt! - v.eta) / 60)} min exceeds fuel endurance ${Math.round(v.fuelEndurance / 60)} min`);
      }
      // a slot whose time has passed while the flight is still airborne has lapsed (the arrival manager
      // re-sequences it); it is not a safety violation of the remaining plan
      if (d.eldt! < now - 60) continue;
    } else if (d.action === "divert") {
      if (!INBOUND.has(v.phase)) { add("PHASE", d, `diversion no longer possible (phase ${v.phase})`); continue; }
      const alt = ap[d.to!];
      checks.DIVERSION_ELIGIBILITY++;
      const chk = airportEligible(w, v, t, alt, sharedOnly);
      if (!chk.ok) { add("DIVERSION_ELIGIBILITY", d, chk.reason); continue; }
      const st = alt.stands[d.stand!];
      if (!st) { add("DIVERSION_ELIGIBILITY", d, `stand ${d.stand} unknown at ${d.to}`); continue; }
      const on = d.eldt! + st.taxiIn;
      const chk2 = standEligible(w, v, t, st, on, on + 60 * (d.stay_min ?? 60), sharedOnly);
      checks.STAND_COMPATIBILITY++;
      if (v.prm) checks.ACCESSIBILITY++;
      if (!chk2.ok) add(chk2.code === "PRM_ACCESS" ? "ACCESSIBILITY" : "STAND_COMPATIBILITY", d, chk2.reason);
      const hk = `${d.to}|${Math.floor((d.eldt! - now) / 3600)}`;
      divCount.set(hk, (divCount.get(hk) ?? 0) + 1);
      checks.DIVERSION_ACCEPTANCE++;
      if (divCount.get(hk)! > alt.profile.maxDiversionsPerHour) add("DIVERSION_ACCEPTANCE", d, `${d.to} would receive more than ${alt.profile.maxDiversionsPerHour} diversions in one hour`);
      checks.FUEL++;
      if ((v.phase === "INBOUND" || v.phase === "HOLDING") && v.eta !== null && v.fuelEndurance !== null) {
        const dm = diversionMinutes(ap[v.airport].profile, alt.profile) * 60;
        if (d.eldt! - v.eta > v.fuelEndurance + dm + 600) add("FUEL", d, "alternate landing time beyond fuel endurance");
      }
      if (d.eldt! < now) add("PHASE", d, "planned alternate landing time has passed");
    } else if (d.action === "tow") {
      if (v.phase !== "ON_STAND" && v.phase !== "READY") { add("PHASE", d, `tow not possible in phase ${v.phase}`); continue; }
      if (v.towableAfter !== null && d.at! + 60 < v.towableAfter) add("PHASE", d, "aircraft not yet towable at the planned time");
      const st = ap[v.airport].stands[d.to_stand!];
      if (!st || !standAccepts(st, t)[0]) { add("STAND_COMPATIBILITY", d, `tow target ${d.to_stand} incompatible`); continue; }
      place(v.airport, st.id, d.at! + 900 - BUFFER, Math.max(v.techHoldUntil ?? d.at!, v.dep?.sched ?? d.at!) + BUFFER, d);
    }
  }

  // ---- 2. placements (occupancy + capacity) ----------------------------------------------
  const base = t0 ?? now;
  const byVisit = new Map(decisions.map((d) => [d.visit, d]));
  if (rows.length) {
    for (const r of rows) {
      const v = w.visits[r.visit];
      if (!v || r.option === "unresolved") continue;
      const d = byVisit.get(r.visit) ?? { visit: r.visit, callsign: r.callsign };
      if (r.option === "home") {
        if (!ASSIGNABLE.has(v.phase)) continue;
        const on = base + 60 * r.onBlock!;
        place(v.airport, r.stand!, on - BUFFER, offTime(v, on) + BUFFER, d);
        if (INBOUND.has(v.phase) && (r.restricted || (v.eldt !== null && Math.abs(base + 60 * r.L! - v.eldt) > 60))) land(v.airport, base + 60 * r.L!);
        else if (INBOUND.has(v.phase) && v.eldt !== null) landings[v.airport].set(bucketOf(v.eldt), (landings[v.airport].get(bucketOf(v.eldt)) ?? 0) + 1);
      } else {
        if (!INBOUND.has(v.phase)) continue;
        const st = ap[r.to!].stands[r.stand!];
        const eldt = base + 60 * r.L!;
        const on = eldt + st.taxiIn;
        place(r.to!, r.stand!, on - BUFFER, on + 60 * (r.stay ?? 60) + BUFFER, d);
        land(r.to!, eldt);
      }
    }
  } else {
    for (const d of decisions) {
      const v = w.visits[d.visit];
      if (!v) continue;
      if (d.action === "assign_stand" && ASSIGNABLE.has(v.phase)) {
        const on = d.on_block ?? now + 240;
        place(v.airport, d.stand!, on - BUFFER, offTime(v, on) + BUFFER, d);
      } else if (d.action === "landing_slot" && INBOUND.has(v.phase)) land(v.airport, d.eldt!);
      else if (d.action === "divert" && INBOUND.has(v.phase)) {
        const st = ap[d.to!].stands[d.stand!];
        const on = d.eldt! + st.taxiIn;
        place(d.to!, d.stand!, on - BUFFER, on + 60 * (d.stay_min ?? 60) + BUFFER, d);
        land(d.to!, d.eldt!);
      }
    }
  }
  for (const [icao, buckets] of Object.entries(planBuckets)) {
    for (const b of [...buckets].sort((a, c) => a - c)) {
      const n = landings[icao].get(b) ?? 0;
      const c = bucketCapacity(w, ap[icao].profile, b, "arr", sharedOnly);
      checks.ARRIVAL_CAPACITY++;
      if (n > c) violations.push({ code: "ARRIVAL_CAPACITY", visit: null, callsign: null,
        detail: `${icao} ${fmtTime(b * BUCKET_S)}–${fmtTime((b + 1) * BUCKET_S)}: ${n} landings > modelled capacity ${c}` });
    }
  }
  return { valid: violations.length === 0, violations, checks, t: now };
}

/** Material input changes since a plan's snapshot (informational; validity is decided by re-validation). */
export function diffSnapshot(snap: Snapshot, w: World, sharedOnly = true): { kind: string; id: string; detail: string }[] {
  const out: { kind: string; id: string; detail: string }[] = [];
  const now = w.now;
  const cur = Object.fromEntries(Object.values(w.restrictions).filter((r) => (r.shared || !sharedOnly) && r.end > now).map((r) => [r.id, r]));
  for (const [rid, old] of Object.entries(snap.restrictions)) {
    const r = cur[rid];
    if (!r) { if (old.end > now) out.push({ kind: "restriction_removed", id: rid, detail: `${old.kind} at ${old.airport} removed` }); continue; }
    if (Math.abs(r.end - old.end) > 60 || r.params.rate !== old.params.rate) {
      out.push({ kind: "restriction_changed", id: rid, detail: `${r.kind} at ${r.airport}: ends ${fmtTime(old.end)}→${fmtTime(r.end)}, rate ${old.params.rate ?? "—"}→${r.params.rate ?? "—"}` });
    }
  }
  for (const [rid, r] of Object.entries(cur)) {
    if (!snap.restrictions[rid]) out.push({ kind: "restriction_added", id: rid, detail: `new ${r.kind.toLowerCase().replace(/_/g, " ")} at ${r.airport}: ${String(r.params.reason ?? r.params.pool ?? "")}` });
  }
  for (const [icao, pools] of Object.entries(snap.resources)) {
    for (const [pool, n] of Object.entries(pools)) {
      const c = resourceAvailable(w, icao, pool, now, now + 3600, sharedOnly);
      if (c !== n) out.push({ kind: "resource_changed", id: `${icao}:${pool}`, detail: `${pool.replace("_", " ")} available at ${icao}: ${n}→${c}` });
    }
  }
  for (const [vid, old] of Object.entries(snap.visits)) {
    const v = w.visits[vid];
    if (v && v.phase !== old.phase && ["DIVERTED", "APPROACH", "LANDING", "TAXI_IN", "ON_STAND", "CANCELLED"].includes(v.phase)) {
      out.push({ kind: "visit_phase", id: vid, detail: `${callsignOf(v)}: ${old.phase}→${v.phase}` });
    }
  }
  const occNow = new Map<string, string>();
  for (const v of Object.values(w.visits)) if (["ON_STAND", "READY", "TOWING"].includes(v.phase) && v.stand) occNow.set(`${v.airport}:${v.stand}`, v.id);
  for (const [key, [, e, label, kind]] of Object.entries(snap.occupancy)) {
    const o = occNow.get(key);
    if ((kind === "occupied" || kind === "tech_hold") && o && o !== label && e > 0) out.push({ kind: "stand_occupancy", id: key, detail: `${key} now occupied by ${callsignOf(w.visits[o])}` });
  }
  return out;
}
