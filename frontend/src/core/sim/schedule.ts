/**
 * Seeded synthetic schedule + original stand plan.
 *
 * Generates fictional-carrier turnarounds for each airport, then builds a conflict-free stand plan
 * with a first-fit interval allocator that respects stand compatibility, airline zone preferences
 * and a stand buffer. Flights that cannot be placed are dropped (this is the airport's published
 * plan for the synthetic day). Provenance of everything produced here: synthetic.
 */

import { AIRCRAFT, type TypeKey } from "../aircraft";
import { AIRLINES } from "../airlines";
import { standAccepts, type AirportInfo, type Registry } from "../airports/registry";
import { Rng } from "../rng";
import type { Visit, World } from "../types";
import { blankVisit } from "./engine";

const MIX: Record<string, [string, TypeKey, number][]> = {
  OMAA: [["SQR", "wb", 30], ["SQR", "nb", 26], ["SQR", "vla", 5], ["GFL", "reg", 8], ["MPX", "wb", 6], ["BRL", "wb", 5],
    ["BRL", "nb", 4], ["DCW", "nb", 8], ["NJC", "cargo", 3], ["FCX", "biz", 5]],
  OMDB: [["MJL", "wb", 34], ["MJL", "vla", 14], ["DNE", "nb", 22], ["MPX", "wb", 6], ["BRL", "wb", 5], ["BRL", "nb", 4],
    ["DCW", "nb", 7], ["SQR", "nb", 3], ["SHR", "nb", 2], ["SLK", "cargo", 2], ["FCX", "biz", 3]],
  OMSJ: [["SHR", "nb", 46], ["DCW", "nb", 12], ["NJC", "cargo", 14], ["SLK", "cargo", 8], ["GFL", "reg", 6], ["DNE", "nb", 4],
    ["FCX", "biz", 4]],
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
    counts[icao] = allocate(w, ap, arrivals, rng, cfg, nextFlight, nextReg);
  }
  return counts;
}

function allocate(w: World, ap: AirportInfo, arrivals: [number, string, TypeKey][], rng: Rng, cfg: ScheduleConfig,
  nextFlight: (a: string) => string, nextReg: (a: string) => string): number {
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
    const origin = routeFor(type, rng);
    const dest = routeFor(type, rng);
    const fnIn = nextFlight(airline), fnOut = nextFlight(airline);
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
