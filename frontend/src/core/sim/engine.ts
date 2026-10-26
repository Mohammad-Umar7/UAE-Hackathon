/**
 * Deterministic discrete-event airport network simulator.
 *
 * Owns the authoritative timeline: inbound sequencing under runway capacity, landing, taxi,
 * stand occupancy, resource-constrained turnarounds, departure sequencing, diversions, tows,
 * incidents and restrictions. Randomness is seeded per visit, so a scenario with the same seed
 * and the same external inputs replays identically.
 *
 * The engine never changes stand assignments on its own except through an explicit `Policy`
 * (the local-greedy baseline, or tactical handling of aircraft that arrive with no stand).
 * Recovery decisions enter only via `applyDecisions`, which the approval workflow calls after
 * the required human approvals.
 */

import { AIRCRAFT, approachDuration, type AircraftType } from "../aircraft";
import { AIRLINES } from "../airlines";
import type { Pt } from "../airports/graph";
import { diversionMinutes } from "../airports/profiles";
import { holdNodeForEntry, landingExit, standAccepts, type Registry, type StandInfo } from "../airports/registry";
import { rngFor } from "../rng";
import type { DomainEvent, FlightLeg, Incident, Restriction, Visit, World } from "../types";
import {
  activeRestrictions, callsignOf, nextId, resourceAvailable, restrictionsOverlapping, setPhase, touch,
} from "../world";
import { BUCKET_S, MIN_DEPARTURE_SPACING_S, MIN_LANDING_SPACING_S, bucketCapacity, bucketOf } from "./capacity";
import { legT1, legsEnd, planArrival, planDeparture, planTaxiFromHold, planTow } from "./movement";
import { positionAt } from "./movementEval";

const HOLD_FIX_LEAD_S = 600;
const ACTIVATION_LEAD_S = 5400;
const AMAN_TICK_S = 300;
export const PRM_AMBULIFT_S = 25 * 60;

export interface Policy {
  name: string;
  tacticalReassign: boolean; // pick another stand when the assigned one is unavailable
  tacticalForUnassigned: boolean; // aircraft with no stand at all (e.g. unplanned diversions)
  autoFuelDivert: boolean; // crews divert when holding fuel runs out (pilot decision)
}

export const LIVE_POLICY: Policy = { name: "live", tacticalReassign: false, tacticalForUnassigned: true, autoFuelDivert: true };
export const NO_ACTION_POLICY: Policy = { ...LIVE_POLICY, name: "no_action" };
export const LOCAL_GREEDY_POLICY: Policy = { ...LIVE_POLICY, name: "local_greedy", tacticalReassign: true };

type QItem = [number, number, number, string, string, number | null, Record<string, unknown>];

class EventQueue {
  private h: QItem[] = [];
  get size() { return this.h.length; }
  peek(): QItem | undefined { return this.h[0]; }
  clear() { this.h = []; }
  private less(a: QItem, b: QItem) { return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))); }
  push(x: QItem) {
    const h = this.h;
    h.push(x);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  pop(): QItem {
    const h = this.h;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}

function insort(arr: number[], x: number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  arr.splice(lo, 0, x);
  return lo;
}

function bisectLeft(arr: number[], x: number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

export class Engine {
  w: World;
  ap: Registry;
  policy: Policy;
  fast: boolean;
  private q = new EventQueue();
  private seq = 0;
  events: DomainEvent[] = [];
  listeners: ((e: DomainEvent) => void)[] = [];
  poolJobs: Record<string, Record<string, [number, number][]>> = {};
  depSlots: Record<string, number[]> = {};
  eventCount = 0;

  constructor(world: World, airports: Registry, policy: Policy = LIVE_POLICY, fast = false) {
    this.w = world;
    this.ap = airports;
    this.policy = policy;
    this.fast = fast;
    for (const icao of Object.keys(airports)) { this.poolJobs[icao] = {}; this.depSlots[icao] = []; }
  }

  // ================================================================= scheduling core
  schedule(t: number, kind: string, key = "", data: Record<string, unknown> = {}, prio = 5, gen: number | null = null) {
    this.q.push([t, prio, this.seq++, kind, key, gen, data]);
  }

  scheduleVisit(v: Visit, t: number, kind: string, data: Record<string, unknown> = {}, prio = 5) {
    this.schedule(t, kind, v.id, data, prio, v.gen);
  }

  bump(v: Visit) { v.gen += 1; }

  nextEventTime(): number | null { return this.q.peek()?.[0] ?? null; }

  /** Process events up to `target`. Returns true if `stop()` halted early (clock stays at that event). */
  advanceTo(target: number, stop?: () => boolean): boolean {
    for (;;) {
      const top = this.q.peek();
      if (!top || top[0] > target) break;
      const [t, , , kind, key, gen, data] = this.q.pop();
      if (gen !== null) {
        const v = this.w.visits[key];
        if (!v || v.gen !== gen) continue;
      }
      this.w.now = Math.max(this.w.now, t);
      this.eventCount++;
      const handler = (this as unknown as Record<string, (k: string, d: Record<string, unknown>) => void>)[`on_${kind}`];
      handler.call(this, key, data);
      if (stop && stop()) return true;
    }
    this.w.now = Math.max(this.w.now, target);
    return false;
  }

  emit(kind: string, airport: string | null, data: Record<string, unknown> = {}) {
    const ev: DomainEvent = { kind, t: this.w.now, airport, data };
    this.events.push(ev);
    for (const fn of this.listeners) fn(ev);
  }

  drainEvents(): DomainEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ================================================================= initialisation
  bootstrap() {
    const w = this.w;
    for (const [icao, track] of Object.entries(w.weatherTrack)) {
      track.forEach((k, i) => {
        if (k.t <= w.now) w.weather[icao] = k.obs;
        else this.schedule(k.t, "weather", icao, { i }, 1);
      });
    }
    for (const r of Object.values(w.restrictions)) this.scheduleRestriction(r);
    for (const inc of Object.values(w.incidents)) this.scheduleIncident(inc);
    for (const v of Object.values(w.visits).sort((a, b) => (a.id < b.id ? -1 : 1))) this.bootstrapVisit(v);
    this.schedule(w.now + 1, "aman_tick", "", {}, 2);
  }

  private bootstrapVisit(v: Visit) {
    if (v.phase === "SCHEDULED") {
      this.scheduleVisit(v, Math.max(this.w.now, (v.eta ?? 0) - ACTIVATION_LEAD_S), "activate", {}, 3);
    } else if (v.phase === "ON_STAND") {
      const st = this.standState(v);
      if (st) st.occupant = v.id;
      if (v.readyAt !== null && v.readyAt > this.w.now && v.aibt !== null) {
        const pool = this.typ(v).widebody ? "wb_handling" : "nb_handling";
        (this.poolJobs[v.airport][pool] ??= []).push([v.aibt, v.readyAt]);
      }
      if (v.dep) {
        v.tobt = this.tobtOf(v);
        this.scheduleVisit(v, v.tobt, "tobt");
      }
    }
  }

  /** Reconstruct the event queue from a cloned mid-run state (look-ahead projections). */
  rebuildFromState() {
    const w = this.w, now = w.now;
    this.q.clear();
    for (const [icao, track] of Object.entries(w.weatherTrack)) track.forEach((k, i) => { if (k.t > now) this.schedule(k.t, "weather", icao, { i }, 1); });
    for (const r of Object.values(w.restrictions)) {
      if (r.start > now) this.schedule(r.start, "restriction_start", r.id, {}, 1);
      if (r.end > now) this.schedule(r.end, "restriction_end", r.id, {}, 1);
    }
    for (const inc of Object.values(w.incidents)) {
      if (inc.status === "scheduled") this.schedule(Math.max(inc.start, now), "incident_start", inc.id, {}, 0);
      else if (inc.status === "active" && inc.end > now) this.schedule(inc.end, "incident_end", inc.id, {}, 1);
    }
    for (const icao of Object.keys(this.ap)) { this.poolJobs[icao] = {}; this.depSlots[icao] = []; }
    for (const v of Object.values(w.visits).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const st = this.standInfo(v.airport, v.stand);
      const taxiIn = st?.taxiIn ?? 420, taxiOut = st?.taxiOut ?? 540;
      this.bump(v);
      switch (v.phase) {
        case "SCHEDULED": this.scheduleVisit(v, Math.max(now, (v.eta ?? now) - ACTIVATION_LEAD_S), "activate", {}, 3); break;
        case "INBOUND": case "HOLDING": this.scheduleInbound(v); break;
        case "APPROACH": {
          const td = Math.max(now, v.eldt ?? now);
          this.scheduleVisit(v, td, "landing", {}, 4);
          this.scheduleVisit(v, td + 55, "taxi_in", {}, 4);
          this.scheduleVisit(v, td + 55 + Math.max(120, taxiIn - 60), v.stand ? "on_block" : "arrive_hold", {}, 4);
          break;
        }
        case "LANDING":
          this.scheduleVisit(v, now + 30, "taxi_in", {}, 4);
          this.scheduleVisit(v, now + Math.max(150, taxiIn - 30), v.stand ? "on_block" : "arrive_hold", {}, 4);
          break;
        case "TAXI_IN": {
          let tEnd = now + 180;
          if (v.movement?.length) tEnd = Math.max(now + 1, legsEnd(v.movement));
          this.scheduleVisit(v, tEnd, v.stand ? "on_block" : "arrive_hold", {}, 4);
          break;
        }
        case "ON_STAND":
          if (v.readyAt !== null && v.readyAt > now && v.aibt !== null) {
            const pool = this.typ(v).widebody ? "wb_handling" : "nb_handling";
            (this.poolJobs[v.airport][pool] ??= []).push([v.aibt, v.readyAt]);
          }
          if (v.dep) this.scheduleVisit(v, this.tobtOf(v), "tobt");
          if (v.plannedTow) this.schedule(Math.max(now, v.plannedTow[0]), "tow_start", v.id, { to: v.plannedTow[1] }, 4);
          break;
        case "READY":
          if (v.tsat !== null) insort(this.depSlots[v.airport], v.tsat + taxiOut);
          this.scheduleVisit(v, Math.max(now, v.tsat ?? now), "pushback");
          if (v.plannedTow) this.schedule(Math.max(now, v.plannedTow[0]), "tow_start", v.id, { to: v.plannedTow[1] }, 4);
          break;
        case "PUSHBACK":
          this.schedule(now + 120, "stand_clear", `${v.airport}:${v.stand}`, { visit: v.id }, 3);
          this.scheduleVisit(v, now + 120, "taxi_out", {}, 4);
          this.scheduleVisit(v, now + taxiOut - 120, "takeoff", {}, 4);
          this.scheduleVisit(v, now + taxiOut, "departed", {}, 4);
          break;
        case "TAXI_OUT": {
          let tTo = now + 240;
          const roll = v.movement?.find((l) => l.kind === "takeoff");
          if (roll) tTo = Math.max(now + 1, roll.s[0][3]);
          insort(this.depSlots[v.airport], tTo);
          this.scheduleVisit(v, tTo, "takeoff", {}, 4);
          this.scheduleVisit(v, tTo + 90, "departed", {}, 4);
          break;
        }
        case "TAKEOFF": this.scheduleVisit(v, now + 60, "departed", {}, 4); break;
        case "TOWING": {
          const dst = Object.values(w.stands).find((s) => s.reservedBy === v.id && s.airport === v.airport);
          if (dst) this.scheduleVisit(v, now + 600, "tow_end", { to: dst.id }, 4);
          break;
        }
        default: break;
      }
    }
    this.schedule(now + 1, "aman_tick", "", {}, 2);
  }

  addRestriction(r: Restriction) {
    this.w.restrictions[r.id] = r;
    touch(this.w, "restriction", r.id, "created");
    this.scheduleRestriction(r);
  }

  addIncident(inc: Incident, restrictions: Restriction[]) {
    this.w.incidents[inc.id] = inc;
    touch(this.w, "incident", inc.id, "created");
    for (const r of restrictions) this.addRestriction(r);
    this.scheduleIncident(inc);
  }

  updateRestrictionEnd(rid: string, end: number) {
    const r = this.w.restrictions[rid];
    r.end = end;
    touch(this.w, "restriction", rid, "end_changed");
    this.schedule(end, "restriction_end", rid, {}, 1);
  }

  scheduleRestriction(r: Restriction) {
    this.schedule(Math.max(r.start, this.w.now), "restriction_start", r.id, {}, 1);
    this.schedule(r.end, "restriction_end", r.id, {}, 1);
  }

  scheduleIncident(inc: Incident) {
    if (inc.status === "scheduled") this.schedule(Math.max(inc.start, this.w.now), "incident_start", inc.id, {}, 0);
  }

  // ================================================================= helpers
  typ(v: Visit): AircraftType { return AIRCRAFT[v.type]; }

  standInfo(icao: string, sid: string | null): StandInfo | null {
    if (!sid) return null;
    return this.ap[icao]?.stands[sid] ?? null;
  }

  private standState(v: Visit) {
    return v.stand ? this.w.stands[`${v.airport}:${v.stand}`] ?? null : null;
  }

  tobtOf(v: Visit): number {
    let ready = v.readyAt ?? this.w.now;
    if (v.techHoldUntil !== null) ready = Math.max(ready, v.techHoldUntil);
    const sobt = v.dep?.sched ?? ready;
    if (v.recoveryOf && v.dep && this.ap[v.dep.destination]) {
      // a diverted aircraft returns once the original destination's arrival restriction eases
      const dst = this.ap[v.dep.destination].profile;
      const flight = diversionMinutes(this.ap[v.airport].profile, dst) * 60;
      for (const r of restrictionsOverlapping(this.w, dst.icao, "ARRIVAL_CAPACITY", this.w.now, this.w.now + 8 * 3600)) {
        if (Number(r.params.rate ?? 99) < 0.6 * dst.arrCapacity) ready = Math.max(ready, r.end - flight);
      }
    }
    return Math.max(ready, sobt, this.w.now);
  }

  standClosed(icao: string, sid: string, t0: number, t1: number, sharedOnly = false): Restriction | null {
    for (const r of restrictionsOverlapping(this.w, icao, "STAND_CLOSED", t0, t1, sharedOnly)) {
      if ((r.params.stands as string[] | undefined)?.includes(sid)) return r;
    }
    return null;
  }

  expectedClearTime(icao: string, sid: string): number {
    const st = this.w.stands[`${icao}:${sid}`];
    if (!st || !st.occupant) return this.w.now;
    const o = this.w.visits[st.occupant];
    if (!o) return this.w.now;
    if (o.phase === "PUSHBACK" || o.phase === "TOWING") return this.w.now + 240;
    if (!o.dep) return Infinity;
    if (o.phase === "READY" && o.tsat !== null) return o.tsat + 240;
    return this.tobtOf(o) + 360;
  }

  standAvailableFor(v: Visit, sid: string, tArrive: number): [boolean, string] {
    const info = this.standInfo(v.airport, sid);
    if (!info) return [false, "unknown stand"];
    const [ok, why] = standAccepts(info, this.typ(v));
    if (!ok) return [false, why];
    if (this.standClosed(v.airport, sid, tArrive - 60, tArrive + 3600)) return [false, "stand closed"];
    const st = this.w.stands[`${v.airport}:${sid}`];
    if (st.reservedBy !== null && st.reservedBy !== v.id) return [false, `reserved by ${st.reservedBy}`];
    const clear = this.expectedClearTime(v.airport, sid);
    const buffer = 60 * this.ap[v.airport].profile.standBufferMin * 0.5;
    if (st.occupant !== null && st.occupant !== v.id && clear > tArrive - buffer) {
      return [false, `occupied by ${callsignOf(this.w.visits[st.occupant])} until ~${Math.round(clear)}`];
    }
    for (const c of info.conflicts) {
      const cs = this.w.stands[`${v.airport}:${c}`];
      if (!cs) continue;
      if (cs.reservedBy !== null && cs.reservedBy !== v.id) return [false, `conflicting stand ${c} reserved`];
      if (cs.occupant !== null && cs.occupant !== v.id && this.expectedClearTime(v.airport, c) > tArrive - buffer) {
        return [false, `conflicting stand ${c} occupied by ${callsignOf(this.w.visits[cs.occupant])}`];
      }
    }
    return [true, ""];
  }

  /** Tactical first-fit choice (local, no network coordination). */
  greedyStand(v: Visit, tArrive: number, exclude?: Set<string>): string | null {
    const ap = this.ap[v.airport];
    const t = this.typ(v);
    const zones = ap.profile.airlineZones[v.airline] ?? [];
    const cands: [number, number, string][] = [];
    for (const st of Object.values(ap.stands)) {
      if (exclude?.has(st.id)) continue;
      if (!standAccepts(st, t)[0]) continue;
      if (v.requirements.includes("PRM") && !st.services.has("PRM_BRIDGE")
        && resourceAvailable(this.w, v.airport, "ambulift", tArrive, tArrive + PRM_AMBULIFT_S) <= 0) continue;
      if (!this.standAvailableFor(v, st.id, tArrive)[0]) continue;
      let score = 0;
      if (zones.includes(st.zone)) score -= 100;
      if (t.widebody && !st.contact) score += 20;
      score += st.maxWingspan * 0.5 + st.taxiIn / 60;
      cands.push([score, st.index, st.id]);
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return cands[0][2];
  }

  // ================================================================= AMAN / DMAN
  resequence(icao: string) {
    const w = this.w;
    const prof = this.ap[icao].profile;
    const times: number[] = [];
    const used = new Map<number, number>();
    const inc = (b: number) => used.set(b, (used.get(b) ?? 0) + 1);
    for (const v of Object.values(w.visits)) {
      if (v.airport !== icao || !v.arr) continue;
      const tl = v.aldt ?? ((v.phase === "APPROACH" || v.phase === "LANDING") ? v.eldt : null);
      if (tl !== null && tl > w.now - 3 * BUCKET_S) { times.push(tl); inc(bucketOf(tl)); }
    }
    times.sort((a, b) => a - b);
    const pending = Object.values(w.visits).filter((v) => v.airport === icao && v.arr && v.eta !== null
      && (v.phase === "SCHEDULED" || v.phase === "INBOUND" || v.phase === "HOLDING"));
    const fixed = pending.filter((v) => v.slotFixed && v.eldt !== null);
    const free = pending.filter((v) => !(v.slotFixed && v.eldt !== null))
      .sort((a, b) => (a.priority ? 0 : 1) - (b.priority ? 0 : 1) || a.eta! - b.eta! || (a.id < b.id ? -1 : 1));
    for (const v of fixed) { insort(times, v.eldt!); inc(bucketOf(v.eldt!)); }
    const horizonEnd = w.now + 18 * 3600;
    for (const v of free) {
      let t = Math.max(v.eta!, w.now + approachDuration(v.type) + 30);
      for (let guard = 0; guard < 400; guard++) {
        const b = bucketOf(t);
        if ((used.get(b) ?? 0) >= bucketCapacity(w, prof, b, "arr")) {
          t = (b + 1) * BUCKET_S + 1;
          if (t > horizonEnd) break;
          continue;
        }
        const i = bisectLeft(times, t);
        let clash: number | null = null;
        if (i > 0 && t - times[i - 1] < MIN_LANDING_SPACING_S) clash = times[i - 1] + MIN_LANDING_SPACING_S;
        if (i < times.length && times[i] - t < MIN_LANDING_SPACING_S) clash = times[i] + MIN_LANDING_SPACING_S;
        if (clash === null) break;
        t = clash;
      }
      insort(times, t);
      inc(bucketOf(t));
      if (v.eldt === null || Math.abs(v.eldt - t) > 1) {
        v.eldt = t;
        touch(w, "visit", v.id, "eldt");
        if (v.phase !== "SCHEDULED") this.scheduleInbound(v);
      }
    }
    for (const v of fixed) if (v.phase !== "SCHEDULED") this.scheduleInbound(v);
    this.updateHoldingPhases(icao);
  }

  private scheduleInbound(v: Visit) {
    this.bump(v);
    const tApp = (v.eldt ?? v.eta!) - approachDuration(v.type);
    this.scheduleVisit(v, Math.max(this.w.now, tApp), "approach", {}, 4);
    if (this.policy.autoFuelDivert && !v.slotFixed && v.fuelEndurance !== null && v.eta !== null) {
      if ((v.eldt ?? v.eta) - v.eta > v.fuelEndurance) {
        this.scheduleVisit(v, Math.max(this.w.now, v.eta + v.fuelEndurance), "fuel_divert", {}, 3);
      }
    }
  }

  private updateHoldingPhases(icao: string) {
    for (const v of Object.values(this.w.visits)) {
      if (v.airport !== icao || v.eta === null || v.eldt === null) continue;
      if (v.phase === "INBOUND" && this.w.now >= v.eta - HOLD_FIX_LEAD_S && v.eldt - v.eta > 120) {
        setPhase(this.w, v, "HOLDING", `expected holding ${Math.round((v.eldt - v.eta) / 60)} min`);
      } else if (v.phase === "HOLDING" && v.eldt - v.eta <= 120) {
        setPhase(this.w, v, "INBOUND", "holding cancelled");
      }
    }
  }

  private assignTsat(v: Visit): number {
    const icao = v.airport;
    const prof = this.ap[icao].profile;
    const taxi = this.standInfo(icao, v.stand)?.taxiOut ?? 600;
    let t = Math.max(v.tobt ?? this.w.now, this.w.now);
    for (const r of activeRestrictions(this.w, icao, "APRON_SUSPENSION")) t = Math.max(t, r.end);
    const slots = this.depSlots[icao];
    for (let guard = 0; guard < 300; guard++) {
      const ttot = t + taxi;
      const b = bucketOf(ttot);
      const n = slots.reduce((s, x) => s + (bucketOf(x) === b ? 1 : 0), 0);
      if (n >= bucketCapacity(this.w, prof, b, "dep")) { t = (b + 1) * BUCKET_S - taxi + 1; continue; }
      const i = bisectLeft(slots, ttot);
      let clash: number | null = null;
      if (i > 0 && ttot - slots[i - 1] < MIN_DEPARTURE_SPACING_S) clash = slots[i - 1] + MIN_DEPARTURE_SPACING_S;
      if (i < slots.length && slots[i] - ttot < MIN_DEPARTURE_SPACING_S) clash = slots[i] + MIN_DEPARTURE_SPACING_S;
      if (clash === null) break;
      t = clash - taxi;
    }
    insort(slots, t + taxi);
    return t;
  }

  /** Earliest start ≥ t at which a unit of `pool` is free for `duration`. */
  private acquire(icao: string, pool: string, t: number, duration: number): number {
    const jobs = (this.poolJobs[icao][pool] ??= []);
    let start = t;
    for (let k = 0; k < 200; k++) {
      const avail = resourceAvailable(this.w, icao, pool, start, start + duration);
      const busy = jobs.filter((j) => j[0] < start + duration && j[1] > start);
      if (busy.length < avail) { jobs.push([start, start + duration]); return start; }
      if (avail <= 0) {
        const ends = restrictionsOverlapping(this.w, icao, "RESOURCE_OUTAGE", start, start + duration)
          .filter((r) => r.params.pool === pool).map((r) => r.end);
        start = ends.length ? Math.min(...ends) : start + 600;
        continue;
      }
      start = Math.min(...busy.map((j) => j[1]));
    }
    jobs.push([start, start + duration]);
    return start;
  }

  // ================================================================= event handlers
  on_aman_tick() {
    for (const icao of Object.keys(this.ap)) { this.resequence(icao); this.checkWaiting(icao); }
    this.schedule(this.w.now + AMAN_TICK_S, "aman_tick", "", {}, 2);
  }

  on_weather(icao: string, data: Record<string, unknown>) {
    const key = this.w.weatherTrack[icao][data.i as number];
    const prev = this.w.weather[icao];
    this.w.weather[icao] = key.obs;
    touch(this.w, "weather", icao);
    this.emit("WEATHER_UPDATE", icao, { prev, obs: key.obs });
  }

  on_activate(vid: string) {
    const v = this.w.visits[vid];
    if (v.phase !== "SCHEDULED") return;
    const rng = rngFor(this.w.seed, `eta:${v.id}`);
    v.eta = (v.eta ?? 0) + Math.max(-480, Math.min(480, rng.gauss(0, 150)));
    if (v.fuelEndurance === null) v.fuelEndurance = 60 * rng.int(30, 70);
    setPhase(this.w, v, "INBOUND", "airborne");
    this.resequence(v.airport);
    if (v.eldt !== null) this.scheduleInbound(v);
  }

  on_fuel_divert(vid: string) {
    const v = this.w.visits[vid];
    if ((v.phase !== "INBOUND" && v.phase !== "HOLDING") || v.slotFixed) return;
    if (v.eldt !== null && v.eldt - this.w.now <= approachDuration(v.type) + 60) return;
    const alt = this.nearestAlternate(v);
    if (!alt) return;
    this.emit("FUEL_DIVERSION", v.airport, {
      visit: v.id, callsign: callsignOf(v), to: alt, holding_min: Math.round((this.w.now - (v.eta ?? this.w.now)) / 6) / 10,
    });
    this.divert(v, alt, false, "minimum fuel — crew decision");
  }

  private nearestAlternate(v: Visit): string | null {
    const t = this.typ(v);
    let best: [number, string] | null = null;
    for (const [icao, ap] of Object.entries(this.ap)) {
      if (icao === v.airport) continue;
      if (ap.maxWingspan < t.wingspan || ap.maxRunwayLength < t.landingDistance) continue;
      const d = diversionMinutes(this.ap[v.airport].profile, ap.profile);
      if (!best || d < best[0]) best = [d, icao];
    }
    return best?.[1] ?? null;
  }

  on_approach(vid: string) {
    const v = this.w.visits[vid];
    if (v.phase !== "INBOUND" && v.phase !== "HOLDING") return;
    if (v.phase === "INBOUND" && v.eta !== null && v.eldt !== null && v.eldt - v.eta > 120) setPhase(this.w, v, "HOLDING", "holding");
    v.airborneHold = Math.max(0, (v.eldt ?? this.w.now) - (v.eta ?? this.w.now));
    setPhase(this.w, v, "APPROACH", "established on final");
    const ap = this.ap[v.airport];
    const t = this.typ(v);
    const td = Math.max(v.eldt ?? 0, this.w.now + approachDuration(v.type));
    v.eldt = td;
    let target = v.stand;
    const est = td + (this.standInfo(v.airport, target)?.taxiIn ?? 420);
    if (target === null && this.policy.tacticalForUnassigned) {
      target = this.greedyStand(v, est);
      if (target) this.assignStand(v, target, "tactical (no prior assignment)");
    } else if (target !== null) {
      const [ok, why] = this.standAvailableFor(v, target, est);
      if (!ok) {
        if (this.policy.tacticalReassign) {
          const alt = this.greedyStand(v, est, new Set([target]));
          if (alt) { this.assignStand(v, alt, `tactical reassignment (${why})`); target = alt; } else target = null;
        } else {
          this.emit("STAND_CONFLICT", v.airport, { visit: v.id, callsign: callsignOf(v), stand: v.stand, reason: why, at: "approach" });
          v.holdReason = `stand ${v.stand} unavailable: ${why}`;
          target = null;
        }
      }
    }
    const st = target ? this.standInfo(v.airport, target) : null;
    if (st && v.stand === target) {
      this.w.stands[st.key].reservedBy = v.id;
      touch(this.w, "stand", st.key, "reserved");
    }
    let holdPt: Pt | null = null;
    if (!st) { holdPt = this.holdPoint(v); v.holdPoint = holdPt; }
    this.bump(v);
    if (this.fast) {
      const tEnd = td + 55 + (st ? st.taxiIn - 60 : 240);
      this.scheduleVisit(v, td, "landing", {}, 4);
      this.scheduleVisit(v, td + 55, "taxi_in", {}, 4);
      this.scheduleVisit(v, tEnd, st ? "on_block" : "arrive_hold", {}, 4);
      return;
    }
    const wet = ["rain", "heavy_rain"].includes(this.w.weather[v.airport]?.precip ?? "none");
    const plan = planArrival(ap, t, td, st, holdPt, wet);
    v.movement = plan.legs;
    v.movementKind = "arrival";
    touch(this.w, "visit", v.id, "movement");
    this.scheduleVisit(v, td, "landing", {}, 4);
    this.scheduleVisit(v, plan.rollEnd, "taxi_in", {}, 4);
    this.scheduleVisit(v, plan.tEnd, st ? "on_block" : "arrive_hold", {}, 4);
  }

  private holdPoint(v: Visit): Pt {
    const ap = this.ap[v.airport];
    const st = this.standInfo(v.airport, v.stand);
    if (st) {
      const entry = ap.graph.node(st.entryNode);
      return ap.graph.node(ap.graph.nearestNode(entry[0], entry[1], new Set(["taxiway"])));
    }
    const end = ap.runwayEnds[ap.arrivalEnd];
    const [n] = landingExit(ap, end, 400, 1500);
    return ap.graph.node(holdNodeForEntry(ap, n));
  }

  on_landing(vid: string) {
    const v = this.w.visits[vid];
    setPhase(this.w, v, "LANDING", "touchdown");
    v.aldt = this.w.now;
    if (v.priority === "EMERGENCY") {
      const ap = this.ap[v.airport];
      const r: Restriction = {
        id: nextId(this.w, "RST"), kind: "ARRIVAL_CAPACITY", airport: v.airport, start: this.w.now, end: this.w.now + 900,
        params: { rate: 0, reason: `runway inspection after priority landing ${callsignOf(v)}`, runway: ap.runwayEnds[ap.arrivalEnd].runwayId },
        incidentId: null, shared: true, provenance: "synthetic", version: 0,
      };
      this.addRestriction(r);
    }
    this.emit("LANDED", v.airport, { visit: v.id, callsign: callsignOf(v) });
  }

  on_taxi_in(vid: string) {
    const v = this.w.visits[vid];
    if (v.phase === "LANDING") setPhase(this.w, v, "TAXI_IN", "vacated runway");
  }

  on_arrive_hold(vid: string) {
    const v = this.w.visits[vid];
    if (v.phase === "LANDING") setPhase(this.w, v, "TAXI_IN", "vacated runway");
    setPhase(this.w, v, "WAITING_STAND", v.holdReason ?? "stand not available");
    v.waitingSince = this.w.now;
    v.movement = null;
    touch(this.w, "visit", v.id, "waiting");
    this.emit("WAITING_FOR_STAND", v.airport, { visit: v.id, callsign: callsignOf(v), stand: v.stand });
    this.tryDispatch(v);
  }

  tryDispatch(v: Visit): boolean {
    if (v.phase !== "WAITING_STAND") return false;
    if (v.stand) {
      const [ok] = this.standAvailableFor(v, v.stand, this.w.now + 300);
      if (ok && this.w.stands[`${v.airport}:${v.stand}`].occupant === null) return this.dispatch(v, v.stand);
    }
    if (this.policy.tacticalReassign || (!v.stand && this.policy.tacticalForUnassigned)) {
      const alt = this.greedyStand(v, this.w.now + 300, v.stand ? new Set([v.stand]) : undefined);
      if (alt && this.w.stands[`${v.airport}:${alt}`].occupant === null) {
        this.assignStand(v, alt, "tactical reassignment while waiting");
        return this.dispatch(v, alt);
      }
    }
    return false;
  }

  private dispatch(v: Visit, sid: string): boolean {
    const ap = this.ap[v.airport];
    const st = ap.stands[sid];
    if (v.waitingSince !== null) { v.groundWait += this.w.now - v.waitingSince; v.waitingSince = null; }
    setPhase(this.w, v, "TAXI_IN", `cleared to stand ${sid}`);
    this.w.stands[st.key].reservedBy = v.id;
    touch(this.w, "stand", st.key, "reserved");
    this.bump(v);
    if (this.fast) { this.scheduleVisit(v, this.w.now + 240, "on_block", {}, 4); return true; }
    const leg = planTaxiFromHold(ap, this.typ(v), v.holdPoint ?? ap.graph.node(st.entryNode), this.w.now, st);
    v.movement = [leg];
    v.movementKind = "taxi_to_stand";
    touch(this.w, "visit", v.id, "movement");
    this.scheduleVisit(v, legT1(leg), "on_block", {}, 4);
    return true;
  }

  checkWaiting(icao: string) {
    const waiting = Object.values(this.w.visits).filter((x) => x.airport === icao && x.phase === "WAITING_STAND")
      .sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0) || (a.id < b.id ? -1 : 1));
    for (const v of waiting) this.tryDispatch(v);
  }

  on_on_block(vid: string, data: Record<string, unknown>) {
    const v = this.w.visits[vid];
    const ss = this.standState(v);
    if (!ss || (ss.occupant !== null && ss.occupant !== v.id)) {
      const ap = this.ap[v.airport];
      const st = this.standInfo(v.airport, v.stand);
      v.holdPoint = st ? ap.graph.node(st.entryNode) : this.holdPoint(v);
      v.holdReason = "stand still occupied on arrival";
      this.emit("STAND_CONFLICT", v.airport, { visit: v.id, callsign: callsignOf(v), stand: v.stand, reason: "occupied on arrival", at: "on_block" });
      this.on_arrive_hold(vid);
      return;
    }
    void data;
    setPhase(this.w, v, "ON_STAND", `on block ${v.stand}`);
    v.aibt = this.w.now;
    v.movement = null;
    v.holdPoint = null;
    ss.occupant = v.id;
    ss.reservedBy = null;
    touch(this.w, "stand", ss.key, "occupied");
    this.startTurnaround(v);
    this.emit("ON_BLOCK", v.airport, { visit: v.id, callsign: callsignOf(v), stand: v.stand });
  }

  private startTurnaround(v: Visit) {
    const icao = v.airport;
    const t = this.typ(v);
    let start = this.w.now;
    for (const r of activeRestrictions(this.w, icao, "APRON_SUSPENSION")) start = Math.max(start, r.end);
    start = this.acquire(icao, t.widebody ? "wb_handling" : "nb_handling", start, v.minTat);
    let ready = start + v.minTat;
    const st = this.standInfo(icao, v.stand);
    if (v.prm > 0 && st && !st.services.has("PRM_BRIDGE")) {
      const amb = this.acquire(icao, "ambulift", this.w.now, PRM_AMBULIFT_S);
      ready = Math.max(ready, amb + PRM_AMBULIFT_S);
      if (amb > this.w.now + 60) {
        const wait = Math.round((amb - this.w.now) / 6) / 10;
        this.emit("PRM_SERVICE_DELAY", icao, { visit: v.id, callsign: callsignOf(v), wait_min: wait });
        v.history.push([this.w.now, "PRM_WAIT", `${wait} min`]);
      }
    }
    if (t.freighter) {
      const ld = this.acquire(icao, "deck_loader", start, Math.min(v.minTat, 5400));
      ready = Math.max(ready, ld + Math.min(v.minTat, 5400));
    }
    v.readyAt = ready;
    v.paused += Math.max(0, start - this.w.now);
    if (v.dep) {
      v.tobt = this.tobtOf(v);
      this.bump(v);
      this.scheduleVisit(v, v.tobt, "tobt");
    }
    touch(this.w, "visit", v.id, "turnaround");
  }

  on_tobt(vid: string) {
    const v = this.w.visits[vid];
    if (v.phase !== "ON_STAND" || !v.dep) return;
    const tobt = this.tobtOf(v);
    if (tobt > this.w.now + 1) {
      v.tobt = tobt;
      this.bump(v);
      this.scheduleVisit(v, tobt, "tobt");
      touch(this.w, "visit", v.id, "tobt");
      return;
    }
    v.tobt = this.w.now;
    setPhase(this.w, v, "READY", "ready for start-up");
    v.tsat = this.assignTsat(v);
    this.bump(v);
    this.scheduleVisit(v, v.tsat, "pushback");
  }

  on_pushback(vid: string) {
    const v = this.w.visits[vid];
    if (v.phase !== "READY") return;
    const susp = activeRestrictions(this.w, v.airport, "APRON_SUSPENSION");
    if (susp.length) {
      this.bump(v);
      v.tsat = susp[0].end + 60;
      this.scheduleVisit(v, v.tsat, "pushback");
      return;
    }
    const ap = this.ap[v.airport];
    const st = this.standInfo(v.airport, v.stand);
    if (!st) return;
    setPhase(this.w, v, "PUSHBACK", "pushback");
    v.aobt = this.w.now;
    this.bump(v);
    if (this.fast) {
      this.schedule(this.w.now + 150, "stand_clear", st.key, { visit: v.id }, 3);
      this.scheduleVisit(v, this.w.now + 150, "taxi_out", {}, 4);
      this.scheduleVisit(v, this.w.now + st.taxiOut, "takeoff", {}, 4);
      this.scheduleVisit(v, this.w.now + st.taxiOut + 90, "departed", {}, 4);
    } else {
      const plan = planDeparture(ap, this.typ(v), st, this.w.now);
      v.movement = plan.legs;
      v.movementKind = "departure";
      touch(this.w, "visit", v.id, "movement");
      this.schedule(plan.tClear, "stand_clear", st.key, { visit: v.id }, 3);
      this.scheduleVisit(v, plan.tClear, "taxi_out", {}, 4);
      this.scheduleVisit(v, plan.tRoll, "takeoff", {}, 4);
      this.scheduleVisit(v, legsEnd(plan.legs), "departed", {}, 4);
    }
    this.emit("OFF_BLOCK", v.airport, { visit: v.id, callsign: callsignOf(v), stand: v.stand });
  }

  on_stand_clear(skey: string, data: Record<string, unknown>) {
    const st = this.w.stands[skey];
    if (st && st.occupant === data.visit) {
      st.occupant = null;
      touch(this.w, "stand", skey, "cleared");
    }
    this.checkWaiting(skey.split(":")[0]);
  }

  on_taxi_out(vid: string) {
    const v = this.w.visits[vid];
    if (v.phase === "PUSHBACK") setPhase(this.w, v, "TAXI_OUT", "taxiing to runway");
  }

  on_takeoff(vid: string) {
    const v = this.w.visits[vid];
    if (v.phase === "PUSHBACK") setPhase(this.w, v, "TAXI_OUT", "taxiing");
    setPhase(this.w, v, "TAKEOFF", "take-off roll");
    v.atot = this.w.now;
    if (v.recoveryOf && v.divertedFrom) this.spawnRecoveryInbound(v);
  }

  on_departed(vid: string) {
    const v = this.w.visits[vid];
    setPhase(this.w, v, "DEPARTED", "airborne");
    v.movement = null;
  }

  // ----------------------------------------------------------------- tows
  on_tow_start(vid: string, data: Record<string, unknown>) {
    const v = this.w.visits[vid];
    if (!v.plannedTow || v.plannedTow[1] !== data.to) return;
    v.plannedTow = null;
    if ((v.phase !== "ON_STAND" && v.phase !== "READY") || !v.stand) return;
    const ap = this.ap[v.airport];
    const src = ap.stands[v.stand], dst = ap.stands[data.to as string];
    const ds = this.w.stands[dst.key];
    if (ds.occupant !== null) { this.emit("TOW_BLOCKED", v.airport, { visit: v.id, to: dst.id }); return; }
    setPhase(this.w, v, "TOWING", `tow ${src.id} -> ${dst.id}`);
    ds.reservedBy = v.id;
    touch(this.w, "stand", dst.key, "reserved");
    this.bump(v);
    if (this.fast) {
      this.schedule(this.w.now + 150, "stand_clear", src.key, { visit: v.id }, 3);
      this.scheduleVisit(v, this.w.now + 900, "tow_end", { to: dst.id }, 4);
      return;
    }
    const legs = planTow(ap, this.typ(v), src, dst, this.w.now);
    v.movement = legs;
    v.movementKind = "tow";
    touch(this.w, "visit", v.id, "movement");
    this.schedule(legT1(legs[0]), "stand_clear", src.key, { visit: v.id }, 3);
    this.scheduleVisit(v, legsEnd(legs), "tow_end", { to: dst.id }, 4);
  }

  on_tow_end(vid: string, data: Record<string, unknown>) {
    const v = this.w.visits[vid];
    const sid = data.to as string;
    const old = v.stand;
    v.stand = sid;
    v.standChanges += 1;
    const st = this.w.stands[`${v.airport}:${sid}`];
    st.occupant = v.id;
    st.reservedBy = null;
    touch(this.w, "stand", st.key, "occupied");
    setPhase(this.w, v, "ON_STAND", `towed ${old} -> ${sid}`);
    v.movement = null;
    if (v.dep) { this.bump(v); v.tobt = this.tobtOf(v); this.scheduleVisit(v, v.tobt, "tobt"); }
  }

  // ----------------------------------------------------------------- restrictions & incidents
  on_restriction_start(rid: string) {
    const r = this.w.restrictions[rid];
    if (!r || !(r.start <= this.w.now && this.w.now < r.end)) return;
    touch(this.w, "restriction", rid, "active");
    if (r.kind === "APRON_SUSPENSION") {
      for (const v of Object.values(this.w.visits)) {
        if (v.airport === r.airport && v.phase === "ON_STAND" && v.readyAt !== null && v.readyAt > this.w.now) {
          v.readyAt += r.end - this.w.now;
          v.paused += r.end - this.w.now;
          if (v.dep) { v.tobt = this.tobtOf(v); this.bump(v); this.scheduleVisit(v, v.tobt, "tobt"); }
          touch(this.w, "visit", v.id, "apron_suspension");
        }
      }
    }
    this.emit("RESTRICTION_ACTIVE", r.airport, { restriction: rid, rkind: r.kind, params: r.params, shared: r.shared });
    this.resequence(r.airport);
  }

  on_restriction_end(rid: string) {
    const r = this.w.restrictions[rid];
    if (!r || Math.abs(r.end - this.w.now) > 1) return;
    touch(this.w, "restriction", rid, "ended");
    this.emit("RESTRICTION_ENDED", r.airport, { restriction: rid, rkind: r.kind });
    this.resequence(r.airport);
    this.checkWaiting(r.airport);
  }

  on_incident_start(iid: string) {
    const inc = this.w.incidents[iid];
    if (!inc || inc.status !== "scheduled") return;
    inc.status = "active";
    touch(this.w, "incident", iid, "active");
    const p = inc.params;
    const v = typeof p.visit === "string" ? this.w.visits[p.visit] : undefined;
    if (inc.type === "STAND_BLOCKED" && v) {
      v.techHoldUntil = inc.end;
      v.towableAfter = this.w.now + 60 * Number(p.towable_after_min ?? 60);
      if (v.phase === "READY") setPhase(this.w, v, "ON_STAND", "technical issue");
      if (v.dep) { v.tobt = this.tobtOf(v); this.bump(v); this.scheduleVisit(v, v.tobt, "tobt"); }
      v.history.push([this.w.now, "TECH_HOLD", String(p.issue ?? "technical issue")]);
      touch(this.w, "visit", v.id, "tech_hold");
      touch(this.w, "stand", `${v.airport}:${v.stand}`, "blocked");
    } else if (inc.type === "PRIORITY_ARRIVAL" && v) {
      v.priority = "EMERGENCY";
      if (!v.requirements.includes("PRIORITY")) v.requirements.push("PRIORITY");
      touch(this.w, "visit", v.id, "priority");
      this.resequence(v.airport);
    } else if (inc.type === "ACCESSIBILITY_REQUIREMENT" && v) {
      v.prm = Math.max(v.prm, Number(p.prm ?? 2));
      if (!v.requirements.includes("PRM")) v.requirements.push("PRM");
      touch(this.w, "visit", v.id, "prm");
    } else if (inc.type === "DIVERSION_INFLUX") {
      for (const spec of (p.flights as Record<string, unknown>[]) ?? []) this.spawnExternalDiversion(inc, spec);
    }
    this.emit("INCIDENT_ACTIVATED", inc.airport, { incident: iid, type: inc.type, title: inc.title, shared: inc.shared });
    this.schedule(inc.end, "incident_end", iid, {}, 1);
  }

  on_incident_end(iid: string) {
    const inc = this.w.incidents[iid];
    if (!inc || inc.status !== "active" || Math.abs(inc.end - this.w.now) > 1) return;
    inc.status = "cleared";
    touch(this.w, "incident", iid, "cleared");
    this.emit("INCIDENT_CLEARED", inc.airport, { incident: iid, type: inc.type, title: inc.title });
  }

  // ----------------------------------------------------------------- diversions
  divert(v: Visit, to: string, planned: boolean, reason: string, stand: string | null = null,
    landingTime: number | null = null, planId: string | null = null): Visit {
    const w = this.w;
    if (v.stand) {
      const st = w.stands[`${v.airport}:${v.stand}`];
      if (st && st.reservedBy === v.id) { st.reservedBy = null; touch(w, "stand", st.key, "released"); }
    }
    v.divertedTo = to;
    v.divertPlanned = planned;
    setPhase(w, v, "DIVERTED", `diverted to ${to} (${planned ? "coordinated" : "unplanned"}): ${reason}`);
    this.bump(v);
    const mins = diversionMinutes(this.ap[v.airport].profile, this.ap[to].profile);
    const eta = landingTime ?? w.now + mins * 60;
    const cs = v.arr?.callsign ?? v.id;
    const arr: FlightLeg = { callsign: cs, origin: v.arr?.origin ?? v.airport, destination: to, sched: eta + 420, pax: v.pax };
    const dep: FlightLeg = { callsign: cs, origin: to, destination: v.airport, sched: eta + 420 + 3000, pax: v.pax };
    const v2 = blankVisit(`${v.id}>${to}`, to, v.airline, v.type, v.reg, arr, dep, "INBOUND", stand, 3000);
    Object.assign(v2, {
      pax: v.pax, prm: v.prm, requirements: [...new Set([...v.requirements, "DIVERSION"])], priority: v.priority,
      eta, fuelEndurance: 1200, divertedFrom: v.airport, recoveryOf: v.id, slotFixed: landingTime !== null,
      eldt: landingTime,
    });
    v2.history.push([w.now, "DIVERTED_IN", `from ${v.airport} (${planned ? "coordinated" : "unplanned"})`]);
    if (planId) v2.planRefs.push(planId);
    w.visits[v2.id] = v2;
    touch(w, "visit", v2.id, "created");
    this.resequence(to);
    if (v2.eldt !== null) this.scheduleInbound(v2);
    this.emit("DIVERSION", v.airport, { visit: v.id, new_visit: v2.id, callsign: cs, to, planned, reason });
    return v2;
  }

  /** When a diverted aircraft departs its alternate, create the recovery inbound at the original destination. */
  private spawnRecoveryInbound(v2: Visit) {
    const w = this.w;
    const orig = w.visits[v2.recoveryOf ?? ""];
    if (!orig) return;
    const dst = orig.airport;
    const eta = w.now + diversionMinutes(this.ap[v2.airport].profile, this.ap[dst].profile) * 60;
    const arr: FlightLeg = { callsign: v2.arr?.callsign ?? orig.id, origin: v2.airport, destination: dst, sched: orig.arr?.sched ?? eta, pax: v2.pax };
    const v3 = blankVisit(`${orig.id}<R`, dst, orig.airline, orig.type, orig.reg, arr, orig.dep, "INBOUND", orig.stand, orig.minTat);
    Object.assign(v3, {
      plannedStand: orig.plannedStand, pax: orig.pax, prm: orig.prm, connecting: orig.connecting,
      requirements: orig.requirements.filter((r) => r !== "DIVERSION"), eta, fuelEndurance: 2400, divertedFrom: v2.airport,
    });
    v3.history.push([w.now, "RECOVERY_LEG", `returning from ${v2.airport}`]);
    w.visits[v3.id] = v3;
    touch(w, "visit", v3.id, "created");
    this.resequence(dst);
    this.emit("RECOVERY_INBOUND", dst, { visit: v3.id, callsign: arr.callsign, origin: v2.airport });
  }

  private spawnExternalDiversion(inc: Incident, spec: Record<string, unknown>) {
    const w = this.w;
    const type = spec.type as Visit["type"];
    const eta = Number(spec.eta);
    const cs = String(spec.callsign);
    const arr: FlightLeg = { callsign: cs, origin: String(spec.origin ?? "OTHH"), destination: inc.airport, sched: eta + 420, pax: Number(spec.pax ?? 0) };
    const dep: FlightLeg = { callsign: cs, origin: inc.airport, destination: String(spec.origin ?? "OTHH"), sched: eta + 420 + Number(spec.ground_min ?? 120) * 60, pax: Number(spec.pax ?? 0) };
    const v = blankVisit(String(spec.id), inc.airport, String(spec.airline), type, String(spec.reg ?? "Z6-DIV"), arr, dep, "INBOUND", null,
      60 * Math.max(AIRCRAFT[type].minTurnaroundMin, 45));
    Object.assign(v, {
      pax: Number(spec.pax ?? 0), prm: Number(spec.prm ?? 0), eta, fuelEndurance: 60 * Number(spec.fuel_min ?? 25),
      divertedFrom: String(spec.origin ?? ""), requirements: Number(spec.prm ?? 0) ? ["DIVERSION", "PRM"] : ["DIVERSION"],
    });
    v.history.push([w.now, "DIVERTED_IN", `external diversion from ${spec.origin}`]);
    w.visits[v.id] = v;
    touch(w, "visit", v.id, "created");
    this.resequence(inc.airport);
  }

  // ================================================================= recovery decisions
  assignStand(v: Visit, sid: string, note: string) {
    if (v.stand === sid) return;
    const old = v.stand;
    if (old) {
      const so = this.w.stands[`${v.airport}:${old}`];
      if (so && so.reservedBy === v.id) { so.reservedBy = null; touch(this.w, "stand", so.key, "released"); }
    }
    v.stand = sid;
    if (old !== null) v.standChanges += 1;
    v.history.push([this.w.now, "STAND", `${old ?? "—"} -> ${sid}: ${note}`]);
    touch(this.w, "visit", v.id, "stand");
  }

  /** Apply approved recovery decisions to the authoritative state. Returns a log. */
  applyDecisions(decisions: Decision[], planId: string): string[] {
    const log: string[] = [];
    const touched = new Set<string>();
    for (const d of decisions) {
      const v = this.w.visits[d.visit];
      if (!v) { log.push(`skip ${d.visit}: no longer exists`); continue; }
      const cs = callsignOf(v);
      if (d.action === "assign_stand") {
        if (v.airport !== d.airport) { log.push(`skip ${cs}: airport changed`); continue; }
        this.assignStand(v, d.stand!, `recovery plan ${planId}`);
        v.planRefs.push(planId);
        if (v.phase === "TAXI_IN") this.rerouteTaxi(v);
        else if (v.phase === "WAITING_STAND") this.tryDispatch(v);
        log.push(`${cs}: stand → ${d.stand}`);
      } else if (d.action === "landing_slot") {
        if (v.phase === "SCHEDULED" || v.phase === "INBOUND" || v.phase === "HOLDING") {
          v.eldt = d.eldt!;
          v.slotFixed = true;
          v.planRefs.push(planId);
          touch(this.w, "visit", v.id, "slot");
          if (d.stand) this.assignStand(v, d.stand, `recovery plan ${planId}`);
          touched.add(v.airport);
          log.push(`${cs}: landing slot ${Math.round(d.eldt!)}`);
        }
      } else if (d.action === "divert") {
        if (v.phase === "SCHEDULED" || v.phase === "INBOUND" || v.phase === "HOLDING") {
          this.divert(v, d.to!, true, `coordinated recovery plan ${planId}`, d.stand ?? null, d.eldt ?? null, planId);
          log.push(`${cs}: diverted to ${d.to} stand ${d.stand}`);
        } else log.push(`skip divert ${cs}: phase ${v.phase}`);
      } else if (d.action === "tow") {
        const t0 = Math.max(this.w.now + 60, d.at ?? this.w.now + 60);
        v.plannedTow = [t0, d.to_stand!];
        this.schedule(t0, "tow_start", v.id, { to: d.to_stand }, 4);
        v.planRefs.push(planId);
        log.push(`${cs}: tow ${v.stand} → ${d.to_stand}`);
      }
    }
    for (const icao of touched) this.resequence(icao);
    for (const icao of Object.keys(this.ap)) this.checkWaiting(icao);
    return log;
  }

  private rerouteTaxi(v: Visit) {
    if (this.fast) {
      this.w.stands[`${v.airport}:${v.stand}`].reservedBy = v.id;
      this.bump(v);
      this.scheduleVisit(v, this.w.now + 240, "on_block", {}, 4);
      return;
    }
    const pos = positionAt(v.movement, this.w.now);
    if (!pos) return;
    const ap = this.ap[v.airport];
    const st = ap.stands[v.stand!];
    const leg = planTaxiFromHold(ap, this.typ(v), [pos.x, pos.y], this.w.now, st);
    v.movement = [leg];
    v.movementKind = "taxi_to_stand";
    this.w.stands[st.key].reservedBy = v.id;
    touch(this.w, "visit", v.id, "reroute");
    this.bump(v);
    this.scheduleVisit(v, legT1(leg), "on_block", {}, 4);
  }
}

export interface Decision {
  action: "assign_stand" | "landing_slot" | "divert" | "tow" | "unresolved";
  visit: string;
  callsign: string;
  airport: string;
  stand?: string;
  from?: string | null;
  to?: string;
  to_stand?: string;
  from_stand?: string;
  eldt?: number;
  prev_eldt?: number | null;
  on_block?: number;
  at?: number;
  stay_min?: number;
  holding_min?: number;
  hold_limit?: number | null;
  ground_delay?: boolean;
  ground_wait_min?: number;
  needs_ambulift?: boolean;
  prm?: number;
  pax?: number;
  type?: string;
  reason?: string;
  excluded?: { airport: string; stand: string | null; code: string; reason: string }[];
}

export function blankVisit(id: string, airport: string, airline: string, type: Visit["type"], reg: string,
  arr: FlightLeg | null, dep: FlightLeg | null, phase: Visit["phase"], stand: string | null, minTat: number): Visit {
  return {
    id, airport, airline, type, reg, arr, dep, phase, plannedStand: stand, stand, minTat, pax: 0, prm: 0, connecting: 0,
    requirements: [], priority: null, eta: null, eldt: null, aldt: null, aibt: null, readyAt: null, tobt: null, tsat: null,
    aobt: null, atot: null, fuelEndurance: null, slotFixed: false, techHoldUntil: null, towableAfter: null, divertedTo: null,
    divertedFrom: null, recoveryOf: null, divertPlanned: null, plannedTow: null, movement: null, movementKind: null,
    holdPoint: null, holdReason: null, waitingSince: null, groundWait: 0, airborneHold: 0, paused: 0, standChanges: 0,
    planRefs: [], history: [], gen: 0, version: 0,
  };
}

export const airlineName = (code: string) => AIRLINES[code]?.name ?? code;
