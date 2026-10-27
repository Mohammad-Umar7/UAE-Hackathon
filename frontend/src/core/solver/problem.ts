/**
 * Recovery problem construction from the shared operational picture.
 *
 * Movable flights: every inbound flight within the horizon at an airport whose runway capacity
 * is restricted, plus flights at other in-scope airports whose assigned stand is in conflict or
 * unusable, plus aircraft already waiting on the ground for a stand. Everything else is a fixed
 * occupancy the optimiser must respect. Hard eligibility rules prune options before optimisation;
 * every pruned option is recorded with its reason so unresolved flights can be explained.
 */

import { AIRCRAFT, approachDuration } from "../aircraft";
import { diversionMinutes } from "../airports/profiles";
import type { Registry } from "../airports/registry";
import { bucketCapacities, bucketOf, BUCKET_S } from "../sim/capacity";
import { wideBodyTurnarounds } from "../resources";
import { ACTIVATION_LEAD_S } from "../sim/engine";
import type { Visit, World } from "../types";
import { callsignOf, resourceAvailable, restrictionsOverlapping } from "../world";
import { airportEligible, standEligible } from "./eligibility";

export const PRE = 5;
export const POST = 5;
export const AMBULIFT_MIN = 25;

export interface StandOpt {
  airport: string;
  stand: string;
  taxi: number;
  pref: number;
  remoteWb: boolean;
  zoneMiss: boolean;
  needsAmbulift: boolean;
  current: boolean;
}

export interface DivOpt {
  airport: string;
  lo: number;
  hi: number;
  stay: number;
  arrDelayConst: number;
  depDelayConst: number;
  stands: StandOpt[];
}

export interface Excluded {
  airport: string;
  stand: string | null;
  code: string;
  reason: string;
}

export interface FlightVar {
  visit: string;
  callsign: string;
  airline: string;
  type: string;
  home: string;
  pax: number;
  prm: number;
  widebody: boolean;
  E: number;
  Lhi: number;
  sibt: number;
  sobt: number | null;
  tat: number;
  airborne: boolean;
  holdLimit: number | null;
  currentStand: string | null;
  currentEldt: number | null;
  waiting: boolean;
  priority: boolean;
  restricted: boolean;
  reason: string;
  homeOpts: StandOpt[];
  divOpts: DivOpt[];
  excluded: Excluded[];
}

export interface FixedOcc {
  airport: string;
  stand: string;
  start: number;
  end: number;
  label: string;
  kind: "occupied" | "inbound" | "closure" | "tech_hold";
  who?: string;
}

export interface TowCand {
  visit: string;
  callsign: string;
  airport: string;
  fromStand: string;
  at: number;
  holdEnd: number;
  targets: string[];
}

export interface Problem {
  t0: number;
  horizon: number;
  scope: string[];
  flights: FlightVar[];
  fixed: FixedOcc[];
  tows: TowCand[];
  caps: Record<string, Record<number, number>>;
  fixedLandings: Record<string, Record<number, number>>;
  divLimit: Record<string, number>;
  ambulift: Record<string, { cap: number; out: [number, number, number][] }>;
  wb: Record<string, { cap: number; fixed: [number, number][]; out: [number, number, number][] }>;
  restrictionEnd: Record<string, number | null>;
  forbidden: Forbidden[];
  /** `${airport}:${stand}` → conflicting stand ids (only stands that have conflicts) */
  conflicts: Record<string, string[]>;
  snapshot: Snapshot;
  buildMs: number;
}

export interface Forbidden {
  visit?: string;
  airport?: string;
  stand?: string | null;
  reason?: string;
}

export interface Snapshot {
  t: number;
  restrictions: Record<string, { kind: string; airport: string; start: number; end: number; params: Record<string, unknown> }>;
  resources: Record<string, Record<string, number>>;
  occupancy: Record<string, [number, number, string, string]>;
  visits: Record<string, { phase: string; stand: string | null; eta: number | null }>;
}

export interface ProblemConfig {
  horizonMin?: number;
  scope?: string[];
  sharedOnly?: boolean;
  forbidden?: Forbidden[];
  maxHome?: number;
  maxDiv?: number;
  allowTows?: boolean;
  /** visits the look-ahead projection predicts will hit a stand conflict (made movable) */
  predicted?: string[];
}

/** Time a supervisor realistically needs to review and approve a plan. */
export const APPROVAL_LEAD_S = 15 * 60;
/** Minimum modelled holding fuel (30 min) less the ±8 min ETA uncertainty at take-off. */
export const CONSERVATIVE_ENDURANCE_S = 22 * 60;

export const rel = (t: number, t0: number) => Math.ceil((t - t0) / 60 - 1e-9);

function isForbidden(f: Forbidden[], visit: string, airport: string, stand: string | null): boolean {
  return f.some((x) => (x.visit === undefined || x.visit === visit) && (x.airport === undefined || x.airport === airport)
    && (x.stand === undefined || x.stand === null || x.stand === stand));
}

export function expectedOff(v: Visit, now: number): number {
  let ready = v.readyAt ?? now + v.minTat;
  if (v.techHoldUntil !== null) ready = Math.max(ready, v.techHoldUntil);
  if (!v.dep) return now + 86400;
  if (v.phase === "READY" && v.tsat !== null) return v.tsat;
  return Math.max(ready, v.dep.sched, now);
}

export function problemStats(pb: Problem) {
  return {
    flights: pb.flights.length,
    homeOptions: pb.flights.reduce((s, f) => s + f.homeOpts.length, 0),
    diversionOptions: pb.flights.reduce((s, f) => s + f.divOpts.reduce((a, d) => a + d.stands.length, 0), 0),
    fixedOccupancies: pb.fixed.length,
    towCandidates: pb.tows.length,
    excludedOptions: pb.flights.reduce((s, f) => s + f.excluded.length, 0),
    restrictedAirports: Object.entries(pb.restrictionEnd).filter(([, e]) => e !== null).map(([a]) => a),
  };
}

export function buildProblem(w: World, airports: Registry, cfg: ProblemConfig = {}): Problem {
  const tStart = performance.now();
  const now = w.now;
  const t0 = Math.floor(now / 60) * 60;
  const H = cfg.horizonMin ?? 180;
  const endRel = H + 150;
  const scope = cfg.scope ?? Object.keys(airports);
  const so = cfg.sharedOnly ?? true;
  const forbidden = cfg.forbidden ?? [];
  const maxHome = cfg.maxHome ?? 10, maxDiv = cfg.maxDiv ?? 3;
  const predicted = new Set(cfg.predicted ?? []);

  const caps: Problem["caps"] = {};
  const fixedLandings: Problem["fixedLandings"] = {};
  for (const [icao, ap] of Object.entries(airports)) {
    caps[icao] = Object.fromEntries(bucketCapacities(w, ap.profile, t0, t0 + endRel * 60, "arr", so));
    fixedLandings[icao] = {};
  }
  const addLanding = (icao: string, t: number) => {
    const b = bucketOf(t);
    fixedLandings[icao][b] = (fixedLandings[icao][b] ?? 0) + 1;
  };
  const restrictionEnd: Record<string, number | null> = {};
  for (const [icao, ap] of Object.entries(airports)) {
    const ends = restrictionsOverlapping(w, icao, "ARRIVAL_CAPACITY", now, now + H * 60, so)
      .filter((r) => Number(r.params.rate ?? 99) < 0.75 * ap.profile.arrCapacity).map((r) => r.end);
    ends.push(...restrictionsOverlapping(w, icao, "RUNWAY_CLOSED", now, now + H * 60, so).map((r) => r.end));
    restrictionEnd[icao] = ends.length ? rel(Math.max(...ends), t0) : null;
  }
  for (const v of Object.values(w.visits)) if (v.aldt !== null && v.aldt >= bucketOf(t0) * BUCKET_S) addLanding(v.airport, v.aldt);

  // ---- pass 1: aircraft on the ground or committed to a stand; closures --------------------------
  const fixed: FixedOcc[] = [];
  const tows: TowCand[] = [];
  const inbound: Visit[] = [];
  const waiting: Visit[] = [];
  for (const v of Object.values(w.visits).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const ap = airports[v.airport];
    const t = AIRCRAFT[v.type];
    const inScope = scope.includes(v.airport);
    if ((v.phase === "SCHEDULED" || v.phase === "INBOUND" || v.phase === "HOLDING") && v.arr && v.eta !== null) { inbound.push(v); continue; }
    if (v.phase === "WAITING_STAND") {
      if (inScope) waiting.push(v);
      else if (v.stand) fixed.push({ airport: v.airport, stand: v.stand, start: 0, end: rel(expectedOff(v, now + 300), t0) + POST, label: v.id, kind: "inbound", who: callsignOf(v) });
      continue;
    }
    if (v.phase === "APPROACH" && v.aldt === null && v.eldt !== null) addLanding(v.airport, v.eldt);
    if ((v.phase === "APPROACH" || v.phase === "LANDING" || v.phase === "TAXI_IN") && v.stand) {
      const st = ap.stands[v.stand];
      if (st) {
        const on = Math.max(now, (v.eldt ?? now) + st.taxiIn);
        const off = v.dep ? Math.max(v.dep.sched, on + v.minTat) : on + 86400;
        fixed.push({ airport: v.airport, stand: v.stand, start: Math.max(0, rel(on, t0) - PRE), end: rel(off, t0) + POST, label: v.id, kind: "inbound", who: callsignOf(v) });
      }
      continue;
    }
    if ((v.phase === "ON_STAND" || v.phase === "READY" || v.phase === "TOWING" || v.phase === "PUSHBACK") && v.stand) {
      const off = v.phase === "PUSHBACK" ? now + 180 : expectedOff(v, now);
      const e = rel(off, t0) + POST;
      const towable = (cfg.allowTows ?? true) && inScope && v.techHoldUntil !== null && v.techHoldUntil > now + 3600
        && (v.phase === "ON_STAND" || v.phase === "READY") && ap.stands[v.stand]?.contact;
      if (towable) {
        const at = Math.max(rel(now, t0) + 15, rel(v.towableAfter ?? now, t0));
        if (at < H) {
          const targets = Object.values(ap.stands).sort((a, b) => a.index - b.index)
            .filter((st) => st.id !== v.stand && st.kind === "remote" && standEligible(w, v, t, st, now, now + 3600, so).ok
              && !isForbidden(forbidden, v.id, v.airport, st.id)).map((st) => st.id);
          if (targets.length) {
            tows.push({ visit: v.id, callsign: callsignOf(v), airport: v.airport, fromStand: v.stand, at, holdEnd: e, targets: targets.slice(0, 12) });
            fixed.push({ airport: v.airport, stand: v.stand, start: 0, end: at + 10, label: v.id, kind: "tech_hold", who: callsignOf(v) });
            continue;
          }
        }
      }
      const kind = v.techHoldUntil !== null && v.techHoldUntil > now ? "tech_hold" : "occupied";
      fixed.push({ airport: v.airport, stand: v.stand, start: 0, end: Math.max(1, e), label: v.id, kind, who: callsignOf(v) });
    }
  }
  for (const r of Object.values(w.restrictions)) {
    if (r.kind !== "STAND_CLOSED" || (so && !r.shared)) continue;
    const s = rel(r.start, t0), e = rel(r.end, t0);
    if (e <= 0) continue;
    for (const sid of (r.params.stands as string[]) ?? []) fixed.push({ airport: r.airport, stand: sid, start: Math.max(0, s), end: e, label: r.id, kind: "closure" });
  }
  const occ = new Map<string, [number, number, string][]>();
  const addOcc = (a: string, s: string, x: [number, number, string]) => {
    const k = `${a}:${s}`;
    if (!occ.has(k)) occ.set(k, []);
    occ.get(k)!.push(x);
  };
  for (const fo of fixed) addOcc(fo.airport, fo.stand, [fo.start, fo.end, fo.label]);
  // a towable unserviceable aircraft still blocks its stand unless the optimiser chooses the tow,
  // so later arrivals planned onto that stand must be treated as in conflict
  for (const tc of tows) addOcc(tc.airport, tc.fromStand, [tc.at + 10, tc.holdEnd, tc.visit]);
  const overlap = (a: string, s: string, x0: number, x1: number) => occ.get(`${a}:${s}`)?.find(([p, q]) => p < x1 && q > x0)?.[2] ?? null;
  const busyMinutes = (a: string, s: string, x0: number, x1: number) =>
    (occ.get(`${a}:${s}`) ?? []).reduce((sum, [p, q]) => sum + (p < x1 && q > x0 ? Math.min(q, x1) - Math.max(p, x0) : 0), 0);

  // ---- pass 2: inbound flights — movable or fixed ---------------------------------------------
  const movable: [Visit, string][] = [];
  inbound.sort((a, b) => ((a.eldt ?? a.eta!) - (b.eldt ?? b.eta!)) || (a.id < b.id ? -1 : 1));
  for (const v of inbound) {
    const ap = airports[v.airport];
    const t = AIRCRAFT[v.type];
    const inHorizon = v.eta! <= now + H * 60;
    const restricted = restrictionEnd[v.airport] !== null;
    const st = v.stand ? ap.stands[v.stand] : undefined;
    const eldt = v.eldt ?? v.eta ?? now;
    let reason = "";
    if (scope.includes(v.airport) && inHorizon) {
      if (restricted) reason = "arrival capacity restricted";
      else if (predicted.has(v.id)) reason = `projected stand conflict at ${v.stand ?? "—"} (look-ahead)`;
      else if (!st) reason = "no stand assigned";
      else {
        const on = rel(eldt + st.taxiIn, t0);
        const off = v.dep ? rel(Math.max(v.dep.sched, eldt + st.taxiIn + v.minTat), t0) : on + 1440;
        const chk = standEligible(w, v, t, st, t0 + on * 60, t0 + off * 60, so);
        const who = overlap(v.airport, st.id, on - PRE, off + POST);
        if (!chk.ok) reason = `assigned stand ${st.id} not usable: ${chk.reason}`;
        else if (who) reason = `stand ${st.id} conflict with ${w.visits[who] ? callsignOf(w.visits[who]) : who}`;
      }
    }
    if (reason) { movable.push([v, reason]); continue; }
    if (v.eldt !== null && v.eldt < t0 + endRel * 60) addLanding(v.airport, v.eldt);
    if (st) {
      const on = eldt + st.taxiIn;
      const off = v.dep ? Math.max(v.dep.sched, on + v.minTat) : on + 86400;
      const s = rel(on, t0) - PRE, e = rel(off, t0) + POST;
      // keep every future occupancy: long turnarounds of movable flights can reach far beyond the horizon
      if (e > 0) {
        fixed.push({ airport: v.airport, stand: st.id, start: Math.max(0, s), end: e, label: v.id, kind: "inbound", who: callsignOf(v) });
        addOcc(v.airport, st.id, [Math.max(0, s), e, v.id]);
      }
    }
  }
  for (const v of waiting) movable.push([v, "waiting for a stand on the ground"]);
  // Stands currently assigned to other movable flights are not hard constraints (the optimiser may move
  // those flights), but alternatives that are already spoken for rank lower, so the few alternatives a
  // flight gets are ones it can actually use.
  const soft = new Map<string, [number, number, string][]>();
  for (const [v] of movable) {
    const st = v.stand ? airports[v.airport].stands[v.stand] : undefined;
    if (!st) continue;
    const on = (v.eldt ?? v.eta ?? now) + st.taxiIn;
    const k = `${v.airport}:${st.id}`;
    if (!soft.has(k)) soft.set(k, []);
    soft.get(k)!.push([rel(on, t0) - PRE, rel(v.dep ? Math.max(v.dep.sched, on + v.minTat) : on + 36000, t0) + POST, v.id]);
  }
  const softBusy = (a: string, s: string, x0: number, x1: number, self: string) =>
    (soft.get(`${a}:${s}`) ?? []).reduce((sum, [p, q, id]) => sum + (id !== self && p < x1 && q > x0 ? Math.min(q, x1) - Math.max(p, x0) : 0), 0);

  // ---- flight variables -----------------------------------------------------------------------
  const flights: FlightVar[] = [];
  for (const [v, reason] of movable) {
    const ap = airports[v.airport];
    const t = AIRCRAFT[v.type];
    const isWait = v.phase === "WAITING_STAND";
    // a flight that will take off before the plan can realistically be approved cannot take a ground delay:
    // plan it as airborne with a conservative endurance (minimum modelled fuel minus the ETA uncertainty)
    const departsSoon = v.phase === "SCHEDULED" && v.eta !== null && v.eta - ACTIVATION_LEAD_S < now + APPROVAL_LEAD_S;
    const airborne = v.phase === "INBOUND" || v.phase === "HOLDING" || departsSoon;
    const endurance = v.phase === "SCHEDULED" ? CONSERVATIVE_ENDURANCE_S : (v.fuelEndurance ?? 2700);
    const restricted = restrictionEnd[v.airport] !== null;
    const app = Math.ceil(approachDuration(v.type) / 60) + 1;
    let holdLimit: number | null = null;
    let E: number, hi: number;
    if (isWait) { E = rel(now, t0) + 1; hi = E; }
    else {
      E = Math.max(rel(v.eta!, t0), rel(now, t0) + app);
      // fuel is an absolute deadline (ETA + holding endurance); measuring it from E would let a flight
      // that is already holding overshoot by the approach time
      if (airborne) holdLimit = Math.max(0, Math.floor((v.eta! + endurance - t0) / 60) - E);
      if (!restricted) { if (v.eldt !== null) E = Math.max(E, rel(v.eldt, t0)); hi = E; }
      else hi = airborne ? E + holdLimit! : E + 120;
    }
    hi = Math.max(E, Math.min(hi, endRel - 10));
    const sibt = v.arr ? rel(v.arr.sched, t0) : E + 8;
    const sobt = v.dep ? rel(v.dep.sched, t0) : null;
    const tat = Math.ceil(v.minTat / 60);
    const zones = ap.profile.airlineZones[v.airline] ?? [];
    const excluded: Excluded[] = [];
    const opts: [number, StandOpt][] = [];
    for (const st of Object.values(ap.stands)) {
      const taxi = isWait ? 4 : Math.ceil(st.taxiIn / 60);
      const on = E + taxi;
      const chk = standEligible(w, v, t, st, t0 + on * 60, t0 + (on + tat) * 60, so);
      if (!chk.ok) {
        if (st.id === v.stand || (chk.code !== "STAND_SIZE" && chk.code !== "STAND_TYPE") || excluded.length < 60) {
          excluded.push({ airport: v.airport, stand: st.id, code: chk.code, reason: chk.reason });
        }
        continue;
      }
      if (isForbidden(forbidden, v.id, v.airport, st.id)) {
        excluded.push({ airport: v.airport, stand: st.id, code: "REJECTED_BY_STAKEHOLDER", reason: "option rejected in coordination" });
        continue;
      }
      const remoteWb = t.widebody && !t.freighter && !st.contact;
      const zoneMiss = zones.length > 0 && !zones.includes(st.zone);
      const needsAmbulift = (v.prm > 0 || v.requirements.includes("PRM")) && !st.services.has("PRM_BRIDGE");
      const pref = (remoteWb ? 25 : 0) + (zoneMiss ? 15 : 0) + Math.floor((st.maxWingspan - t.wingspan) / 8);
      const o: StandOpt = { airport: v.airport, stand: st.id, taxi, pref, remoteWb, zoneMiss, needsAmbulift, current: st.id === v.stand };
      // score over the whole stay (on-block to off-block) so pre-selected stands can actually host the turnaround
      const offEst = sobt !== null ? Math.max(sobt, on + tat) : on + 600;
      const busy = busyMinutes(v.airport, st.id, on - PRE, offEst + POST);
      const taken = softBusy(v.airport, st.id, on - PRE, offEst + POST, v.id);
      opts.push([busy * 4 + (busy > 0 ? 400 : 0) + taken * 2 + (taken > 0 ? 200 : 0) + pref + taxi + (o.current ? 0 : 3), o]);
    }
    opts.sort((a, b) => a[0] - b[0] || (a[1].stand < b[1].stand ? -1 : 1));
    // flights whose current stand stays free need few alternatives; conflicted flights get the full set
    const cur = opts.find(([, o]) => o.current);
    const clean = Boolean(cur && cur[0] < 400) && !predicted.has(v.id);
    const nHome = clean ? Math.min(3, maxHome) : restricted ? maxHome : maxHome + 6;
    const homeOpts = [...opts.filter(([, o]) => o.current).map(([, o]) => o),
      ...opts.filter(([, o]) => !o.current).slice(0, nHome + (isWait ? 4 : 0)).map(([, o]) => o)];
    const divOpts: DivOpt[] = [];
    // a flight that will be on final approach before the plan can be approved can no longer be diverted by it
    // (holding flights' ETA is in the past, so use the sequenced landing time)
    const divertible = !isWait && !(v.phase !== "SCHEDULED" && (v.eldt ?? v.eta ?? now) < now + APPROVAL_LEAD_S);
    if (divertible && (restricted || (v.requirements.includes("DIVERSION") && !homeOpts.length))) {
      for (const [icao, alt] of Object.entries(airports)) {
        if (icao === v.airport) continue;
        const chk = airportEligible(w, v, t, alt, so);
        if (!chk.ok) { excluded.push({ airport: icao, stand: null, code: chk.code, reason: chk.reason }); continue; }
        if (isForbidden(forbidden, v.id, icao, null)) {
          excluded.push({ airport: icao, stand: null, code: "REJECTED_BY_STAKEHOLDER", reason: "diversion option rejected in coordination" });
          continue;
        }
        const dm = diversionMinutes(ap.profile, alt.profile);
        const lo = Math.max(E + Math.max(4, dm - 8), rel(now, t0) + dm);
        const fuelHi = E + (holdLimit ?? 180) + dm;
        if (airborne && lo > fuelHi) {
          excluded.push({ airport: icao, stand: null, code: "FUEL", reason: `cannot reach ${icao} within remaining fuel` });
          continue;
        }
        const hiD = Math.max(lo, Math.min(lo + 25, airborne ? fuelHi : lo + 25, endRel - 10));
        const rend = restrictionEnd[v.airport];
        const stay = Math.min(360, Math.max(50, rend !== null ? rend - dm - (lo + 6) : 60));
        const homeTaxi = v.stand && ap.stands[v.stand] ? Math.ceil(ap.stands[v.stand].taxiIn / 60) : 8;
        const retOn = lo + 6 + stay + dm + homeTaxi;
        const stands: [number, StandOpt][] = [];
        for (const st of Object.values(alt.stands)) {
          const taxi = Math.ceil(st.taxiIn / 60);
          const on = lo + taxi;
          if (!standEligible(w, v, t, st, t0 + on * 60, t0 + (on + stay) * 60, so).ok || isForbidden(forbidden, v.id, icao, st.id)) continue;
          const remoteWb = t.widebody && !t.freighter && !st.contact;
          const needsAmbulift = (v.prm > 0 || v.requirements.includes("PRM")) && !st.services.has("PRM_BRIDGE");
          const pref = Math.floor((st.maxWingspan - t.wingspan) / 8) + (remoteWb ? 5 : 0);
          stands.push([busyMinutes(icao, st.id, on - PRE, on + stay + POST) * 4 + pref + taxi,
            { airport: icao, stand: st.id, taxi, pref, remoteWb, zoneMiss: false, needsAmbulift, current: false }]);
        }
        stands.sort((a, b) => a[0] - b[0] || (a[1].stand < b[1].stand ? -1 : 1));
        if (!stands.length) {
          excluded.push({ airport: icao, stand: null, code: "NO_ELIGIBLE_STAND", reason: `no eligible stand at ${icao} for this aircraft and its requirements` });
          continue;
        }
        divOpts.push({ airport: icao, lo, hi: hiD, stay, arrDelayConst: Math.max(0, retOn - sibt),
          depDelayConst: sobt !== null ? Math.max(0, retOn + tat - sobt) : 0, stands: stands.slice(0, maxDiv).map(([, o]) => o) });
      }
    }
    flights.push({
      visit: v.id, callsign: callsignOf(v), airline: v.airline, type: v.type, home: v.airport, pax: v.pax, prm: v.prm, widebody: t.widebody,
      E, Lhi: hi, sibt, sobt, tat, airborne, holdLimit, currentStand: v.stand, currentEldt: v.eldt !== null ? rel(v.eldt, t0) : null,
      waiting: isWait, priority: v.priority !== null, restricted, reason, homeOpts, divOpts, excluded,
    });
  }

  // ---- resources -------------------------------------------------------------------------------
  const ambulift: Problem["ambulift"] = {}, wb: Problem["wb"] = {}, divLimit: Problem["divLimit"] = {};
  const movableIds = new Set(flights.map((f) => f.visit));
  for (const [icao, ap] of Object.entries(airports)) {
    divLimit[icao] = ap.profile.maxDiversionsPerHour;
    ambulift[icao] = { cap: w.resources[icao]?.ambulift ?? 0, out: [] };
    wb[icao] = { cap: w.resources[icao]?.wb_handling ?? 0, fixed: [], out: [] };
    for (const r of Object.values(w.restrictions)) {
      if (r.airport !== icao || r.kind !== "RESOURCE_OUTAGE" || (so && !r.shared)) continue;
      const s = Math.max(0, rel(r.start, t0)), e = rel(r.end, t0);
      if (e <= 0) continue;
      if (r.params.pool === "ambulift") ambulift[icao].out.push([s, e, Number(r.params.units ?? 0)]);
      if (r.params.pool === "wb_handling") wb[icao].out.push([s, e, Number(r.params.units ?? 0)]);
    }
    // turnarounds already committed (on stand, or arriving and not part of this problem) hold teams too
    for (const [s0, e0] of wideBodyTurnarounds(w, airports, icao, movableIds)) {
      wb[icao].fixed.push([Math.max(0, Math.floor((s0 - t0) / 60)), Math.max(1, rel(e0, t0))]);
    }
  }
  const snapshot: Snapshot = {
    t: now,
    restrictions: Object.fromEntries(Object.values(w.restrictions).filter((r) => (r.shared || !so) && r.end > now)
      .map((r) => [r.id, { kind: r.kind, airport: r.airport, start: r.start, end: r.end, params: { ...r.params } }])),
    resources: Object.fromEntries(Object.keys(airports).map((icao) => [icao, Object.fromEntries(["ambulift", "wb_handling"]
      .map((p) => [p, resourceAvailable(w, icao, p, now, now + 3600, so)]))])),
    occupancy: Object.fromEntries(fixed.filter((f) => f.kind !== "inbound").map((f) => [`${f.airport}:${f.stand}`, [f.start, f.end, f.label, f.kind]])),
    visits: Object.fromEntries(flights.map((f) => [f.visit, { phase: w.visits[f.visit].phase, stand: f.currentStand, eta: w.visits[f.visit].eta }])),
  };
  const conflicts: Record<string, string[]> = {};
  for (const icao of scope) for (const st of Object.values(airports[icao].stands)) if (st.conflicts.length) conflicts[`${icao}:${st.id}`] = [...st.conflicts];
  return {
    t0, horizon: H, scope, flights, fixed, tows, caps, fixedLandings, divLimit, ambulift, wb, restrictionEnd, forbidden, conflicts, snapshot,
    buildMs: performance.now() - tStart,
  };
}
