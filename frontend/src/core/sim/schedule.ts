/**
 * Seeded synthetic schedule + original stand plan.
 *
 * Generates turnarounds for each airport flown by real carriers under their real flight numbers, then builds a
 * conflict-free stand plan with a first-fit interval allocator that respects stand compatibility, airline zone
 * preferences and a stand buffer. Flights that cannot be placed are dropped (this is the airport's published
 * plan for the synthetic day). Timings, loads and stands are synthetic; the airlines and their routes are real.
 */

import { AIRCRAFT, type TypeKey } from "../aircraft";
import { AIRLINES } from "../airlines";
import { ROUTES, type Route } from "../routes";
import { standAccepts, type AirportInfo, type Registry } from "../airports/registry";
import { Rng } from "../rng";
import type { Visit, World } from "../types";
import { blankVisit } from "./engine";

const MIX: Record<string, [string, TypeKey, number][]> = {
  OMAA: [["ETD", "wb", 30], ["ETD", "nb", 26], ["ETD", "vla", 5], ["GFA", "reg", 8], ["QTR", "wb", 6], ["QTR", "wb", 5],
    ["QTR", "nb", 4], ["IGO", "nb", 8], ["CSS", "cargo", 3], ["ROJ", "biz", 5]],
  OMDB: [["UAE", "wb", 34], ["UAE", "vla", 14], ["FDB", "nb", 22], ["BAW", "wb", 6], ["QTR", "wb", 5], ["QTR", "nb", 4],
    ["IGO", "nb", 7], ["SVA", "nb", 3], ["AXB", "nb", 2], ["ETH", "cargo", 2], ["ROJ", "biz", 3]],
  OMSJ: [["ABY", "nb", 46], ["IGO", "nb", 12], ["ETH", "cargo", 14], ["ETH", "cargo", 8], ["OMS", "reg", 6], ["AXB", "nb", 4],
    ["ROJ", "biz", 4]],
};

const PROFILE_BY_HOUR: Record<number, number> = {
  14: 0.6, 15: 0.65, 16: 0.72, 17: 0.78, 18: 0.82, 19: 0.86, 20: 0.86, 21: 0.82, 22: 0.78, 23: 0.75, 0: 0.72, 1: 0.68,
  2: 0.66, 3: 0.62,
};

const GROUND_MIN: Record<TypeKey, [number, number]> = {
  nb: [55, 110], wb: [110, 210], vla: [150, 260], cargo: [180, 320], biz: [90, 300], reg: [40, 75],
};

const ORIGINS = {
  long: ["EGLL", "LFPG", "EDDF", "EHAM", "LIRF", "LEMD", "KJFK", "KIAD", "WSSS", "VHHH", "RJTT", "YSSY", "ZBAA", "FAOR",
    "HKJK", "LTFM", "VTBS", "WMKK", "RKSI", "LSZH"],
  medium: ["VIDP", "VABB", "VOBL", "VOMM", "OPKC", "OPLA", "OPIS", "HECA", "OEJN", "OERK", "LCLK", "LGAV", "UBBB", "UTTT",
    "VCBI", "VNKT", "HAAB", "OJAI"],
  short: ["OTHH", "OBBI", "OKKK", "OOMS", "OOSA", "OEDF", "OIII", "OISS"],
};

const CODE_POOL = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export interface ScheduleConfig {
  start: number;
  end: number;
  history?: number;
  density?: number;
}

/**
 * Real flight numbers in a seeded order per airline, airport and aircraft class: every flight is used once before
 * any repeats. A hub carrier lands from one city and leaves for another; other carriers fly out and back.
 */
class RealFlights {
  private queues = new Map<string, { list: { r: Route; f: number }[]; i: number }>();
  constructor(private seed: number) {}

  private take(airline: string, icao: string, type: TypeKey, dir: string) {
    // a carrier listed elsewhere only (freighters calling at another UAE airport) flies its routes from there
    const all = ROUTES[airline]?.[icao] ?? Object.values(ROUTES[airline] ?? {})[0];
    if (!all?.length) return null;
    const key = `${airline}:${icao}:${type}:${dir}`;
    let q = this.queues.get(key);
    if (!q) {
      const fit = all.filter((r) => r.cls === type);
      const list = (fit.length ? fit : all).flatMap((r) => r.out.map((_, f) => ({ r, f })));
      const rng = new Rng(`${this.seed}:flights:${key}`);
      for (let i = list.length - 1; i > 0; i--) { const j = rng.int(0, i); [list[i], list[j]] = [list[j], list[i]]; }
      this.queues.set(key, (q = { list, i: 0 }));
    }
    return q.list[q.i++ % q.list.length];
  }

  legs(airline: string, icao: string, type: TypeKey): { arr: [string, string]; dep: [string, string] } | null {
    const hub = AIRLINES[airline]?.kind === "hub";
    const a = this.take(airline, icao, type, hub ? "in" : "both");
    if (!a) return null;
    const d = hub ? this.take(airline, icao, type, "out")! : a;
    return { arr: [a.r.back[a.f % a.r.back.length], a.r.other], dep: [d.r.out[d.f], d.r.other] };
  }
}

function routeFor(type: TypeKey, rng: Rng): string {
  if (type === "vla" || type === "wb") return rng.pick([...ORIGINS.long, ...ORIGINS.medium.slice(0, 6)]);
  if (type === "cargo") return rng.pick([...ORIGINS.long.slice(0, 12), ...ORIGINS.medium]);
  if (type === "reg") return rng.pick(ORIGINS.short);
  return rng.pick([...ORIGINS.medium, ...ORIGINS.short]);
}

export function generateSchedule(w: World, airports: Registry, cfg: ScheduleConfig): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [icao, ap] of Object.entries(airports)) {
    for (const st of Object.values(ap.stands)) w.stands[st.key] = { key: st.key, airport: icao, id: st.id, occupant: null, reservedBy: null, version: 0 };
    w.resources[icao] = { ...ap.profile.resources };
  }
  const flightNo: Record<string, number> = {};
  const real = new RealFlights(w.seed);
  let regSeq = 0;
  const nextFlight = (airline: string) => {
    const n = (flightNo[airline] = (flightNo[airline] ?? 0) + 1);
    const r = new Rng(`${w.seed}:fn:${airline}:${n}`);
    return `${airline}${100 + ((n * 37 + r.int(0, 30)) % 880)}`;
  };
  const nextReg = (airline: string) => {
    regSeq += 1;
    return `Z6-${CODE_POOL[regSeq % 24]}${CODE_POOL[Math.floor(regSeq / 24) % 24]}${airline[0]}`;
  };
  for (const icao of Object.keys(airports).sort()) {
    const ap = airports[icao];
    const rng = new Rng(`${w.seed}:schedule:${icao}`);
    const mix = MIX[icao];
    const arrivals: [number, string, TypeKey][] = [];
    let t = cfg.start - (cfg.history ?? 4 * 3600);
    while (t < cfg.end) {
      const hour = Math.floor((t / 3600) % 24);
      const rate = ap.profile.arrCapacity * (PROFILE_BY_HOUR[hour] ?? 0.55) * (cfg.density ?? 1) * ap.profile.demandScale;
      t += (3600 / Math.max(rate, 1)) * rng.uniform(0.55, 1.45);
      const [airline, type] = rng.weighted(mix, mix.map((m) => m[2]));
      arrivals.push([t, airline, type]);
    }
    counts[icao] = allocate(w, ap, arrivals, rng, cfg, nextFlight, nextReg, real);
  }
  return counts;
}

function allocate(w: World, ap: AirportInfo, arrivals: [number, string, TypeKey][], rng: Rng, cfg: ScheduleConfig,
  nextFlight: (a: string) => string, nextReg: (a: string) => string, real: RealFlights): number {
  const icao = ap.icao;
  const buffer = ap.profile.standBufferMin * 60;
  const busy: Record<string, [number, number][]> = {};
  const stands = Object.values(ap.stands).sort((a, b) => a.index - b.index);
  for (const st of stands) busy[st.id] = [];
  let count = 0;
  arrivals.forEach(([tLand, airline, type], idx) => {
    const t = AIRCRAFT[type];
    const [lo, hi] = GROUND_MIN[type];
    const ground = Math.max(60 * rng.uniform(lo, hi), 60 * (t.minTurnaroundMin + 10));
    const zones = ap.profile.airlineZones[airline] ?? [];
    const cands = stands.filter((st) => standAccepts(st, t)[0]).map((st) => ({
      st, k: [zones.includes(st.zone) ? 0 : 1, t.widebody && !st.contact && !t.freighter ? 1 : 0, st.maxWingspan, rng.next()],
    })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.k[3] - b.k[3]);
    let chosen: { st: (typeof stands)[number]; sibt: number; sobt: number; occ: [number, number] } | null = null;
    for (const { st } of cands) {
      const sibt = tLand + st.taxiIn;
      const sobt = sibt + ground;
      const occ: [number, number] = [sibt - buffer, sobt + 300 + buffer];
      const free = (id: string) => busy[id].every(([a, b]) => occ[1] <= a || occ[0] >= b);
      if (free(st.id) && st.conflicts.every(free)) { chosen = { st, sibt, sobt, occ }; break; }
    }
    if (!chosen) return;
    const { st, sibt, sobt, occ } = chosen;
    busy[st.id].push(occ);
    // drawn even when a real route replaces them, so every later draw (stands, passengers) stays the same for a seed
    let origin = routeFor(type, rng);
    let dest = routeFor(type, rng);
    let fnIn: string, fnOut: string;
    const legs = real.legs(airline, icao, type);
    if (legs) [[fnIn, origin], [fnOut, dest]] = [legs.arr, legs.dep];
    else [fnIn, fnOut] = [nextFlight(airline), nextFlight(airline)];
    const paxIn = Math.floor(t.seats * rng.uniform(0.72, 0.95));
    const paxOut = Math.floor(t.seats * rng.uniform(0.7, 0.95));
    const prm = t.seats > 0 && rng.next() < 0.18 ? rng.int(1, 3) : 0;
    const connecting = AIRLINES[airline].kind === "hub" ? Math.floor(paxIn * rng.uniform(0.35, 0.6)) : 0;
    const vid = `${icao}-${String(idx).padStart(4, "0")}`;
    const v: Visit = blankVisit(vid, icao, airline, type, nextReg(airline),
      { callsign: fnIn, origin, destination: icao, sched: sibt, pax: paxIn },
      { callsign: fnOut, origin: icao, destination: dest, sched: sobt, pax: paxOut }, "SCHEDULED", st.id, 60 * t.minTurnaroundMin);
    v.pax = paxIn;
    v.prm = prm;
    v.connecting = connecting;
    v.requirements = prm ? ["PRM"] : [];
    v.eta = sibt - st.taxiIn;
    if (v.eta < cfg.start) {
      if (sobt + 300 <= cfg.start) { busy[st.id].pop(); return; }
      v.phase = "ON_STAND";
      v.aldt = v.eta;
      v.eldt = v.eta;
      v.aibt = sibt;
      v.readyAt = sibt + v.minTat;
      v.history.push([sibt, "ON_STAND", "on stand at scenario start"]);
    }
    w.visits[vid] = v;
    count++;
  });
  return count;
}
