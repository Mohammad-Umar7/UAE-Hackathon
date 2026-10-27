/**
 * Time-indexed mixed-integer recovery model solved with HiGHS (WebAssembly, in a Web Worker).
 *
 * One binary per (flight, option, time): home stand with a landing slot (restricted airports,
 * 5-minute grid) or a ground-wait offset (normal-capacity airports), or a diversion to an
 * eligible alternate stand with an alternate landing slot, or "unresolved" (escalate to humans).
 *
 * Hard constraints:
 *   - exactly one option per flight
 *   - stand exclusivity and handling/ambulift capacity: constraints at every interval start point (strong formulation);
 *     options overlapping fixed occupancies or closures are removed before solving
 *   - runway arrival capacity per 15-minute bucket (restricted airports and alternates)
 *   - diversion acceptance per alternate per rolling hour
 *   - ambulift and wide-body handling team availability per 5-minute period
 *   - fuel-limited airborne holding (encoded in each flight's landing window)
 * Soft preferences are the objective weights of the chosen variant.
 */

import type { Decision } from "../sim/engine";
import { BUCKET_S, bucketOf } from "../sim/capacity";
import { AMBULIFT_MIN, POST, PRE, type FlightVar, type Problem, type StandOpt } from "./problem";

export interface Weights {
  delay: number; depDelay: number; change: number; remoteWb: number; zone: number; divert: number; coord: number;
  tow: number; unresolved: number; prmRemote: number; holdAir: number; holdGround: number; groundWait: number;
}

export type VariantId = "min_delay" | "stability" | "min_coord";

export const VARIANTS: Record<VariantId, { label: string; short: string; w: Weights }> = {
  min_delay: {
    label: "Lowest total delay", short: "Delay-first",
    w: { delay: 10, depDelay: 6, change: 150, remoteWb: 120, zone: 60, divert: 1200, coord: 300, tow: 250, unresolved: 80000, prmRemote: 120, holdAir: 4, holdGround: 1, groundWait: 4 },
  },
  stability: {
    label: "Least disruption to existing assignments", short: "Stability-first",
    w: { delay: 5, depDelay: 3, change: 1200, remoteWb: 150, zone: 100, divert: 2600, coord: 700, tow: 2000, unresolved: 80000, prmRemote: 120, holdAir: 3, holdGround: 1, groundWait: 3 },
  },
  min_coord: {
    label: "Fewest cross-airport coordination requests", short: "Coordination-light",
    w: { delay: 6, depDelay: 4, change: 200, remoteWb: 120, zone: 60, divert: 7000, coord: 20000, tow: 250, unresolved: 80000, prmRemote: 120, holdAir: 4, holdGround: 1, groundWait: 4 },
  },
};

const GROUND_WAIT_STEPS = [0, 5, 10, 15, 20, 30, 45, 60, 90];
const SLOT_STEP = 5;
/** Relative optimality target: a plan reported "Optimal" is proven within 0.5 % of the best plan for this model. */
export const MIP_REL_GAP = 0.005;

interface Col {
  name: string;
  cost: number;
  kind: "y" | "z" | "u" | "c" | "stay" | "tow";
  fi: number;
  airport: string;
  stand?: string;
  opt?: StandOpt;
  L?: number;
  on?: number;
  off?: number;
  start?: number;
  end?: number;
  landAirport?: string;
  divIdx?: number;
  wbSpan?: [number, number];
  ambSpan?: [number, number];
  towVisit?: string;
}

export interface PlanRow {
  visit: string; callsign: string; airline: string; type: string; home: string; pax: number; prm: number;
  E: number; sibt: number; sobt: number | null; currentStand: string | null; currentEldt: number | null;
  /** minimum turnaround in minutes as the optimiser used it (a diverted aircraft's visit has its own) */
  tat: number;
  holdLimit: number | null; reason: string; airborne: boolean; restricted: boolean;
  option: "home" | "divert" | "unresolved"; stand?: string; to?: string; L?: number; onBlock?: number;
  arrDelay?: number; depDelay?: number; hold?: number; groundWait?: number; changed?: boolean; needsAmbulift?: boolean; stay?: number;
}

export interface PlanResult {
  variant: VariantId;
  label: string;
  status: string;
  objective: number | null;
  mipGap: number | null;
  solveMs: number;
  buildMs: number;
  numVars: number;
  numRows: number;
  prunedOptions: number;
  decisions: Decision[];
  rows: PlanRow[];
  kpis: PlanKpis;
  signature: string;
  forcedDistinct: boolean;
  distinctNote?: string;
  duplicateOf: VariantId | null;
  modelExcerpt: string;
}

export interface PlanKpis {
  arrDelay: number; depDelay: number; paxDelayHours: number; holding: number; groundDelay: number; groundWait: number;
  standChanges: number; diversions: number; unresolved: number; tows: number; remoteWb: number; prmOk: number; prmTotal: number;
  coordinationRequests: number; coordinationAirports: string[]; flights: number; landingSlots: number;
}

export interface HighsLike {
  solve(lp: string, opts?: Record<string, unknown>): {
    Status: string; ObjectiveValue?: number; Columns: Record<string, { Primal: number }>; Info?: Record<string, unknown>;
  };
}

/**
 * Landing-slot grid: 5-minute steps for the first half hour (sequencing detail matters most there),
 * then 10 and 15-minute steps (15-minute capacity buckets) out to the fuel/horizon limit.
 */
const slots = (lo: number, hi: number) => {
  const out: number[] = [];
  for (let x = lo; x < hi;) {
    out.push(x);
    const d = x - lo;
    x += d < 30 ? SLOT_STEP : d < 90 ? 2 * SLOT_STEP : 3 * SLOT_STEP;
  }
  if (!out.length || out[out.length - 1] !== hi) out.push(hi);
  return out;
};
/** A stand change combined with a long hold is rarely sensible: alternatives get a one-hour landing window. */
const ALT_WINDOW = 60;

export interface PrunedReason {
  airport: string;
  stand: string;
  by: string;
  kind: string;
  start: number;
  end: number;
}

export interface Model {
  lp: string;
  cols: Col[];
  pruned: number;
  prunedBy: Map<number, Map<string, PrunedReason>>;
  rows: number;
  buildMs: number;
}

export function buildModel(pb: Problem, variant: VariantId, exclude: Set<string> = new Set()): Model {
  const t0 = performance.now();
  const w = VARIANTS[variant].w;
  const endRel = pb.horizon + 150;
  const cols: Col[] = [];
  const fixedByStand = new Map<string, [number, number, string, string][]>();
  for (const f of pb.fixed) {
    const k = `${f.airport}:${f.stand}`;
    if (!fixedByStand.has(k)) fixedByStand.set(k, []);
    fixedByStand.get(k)!.push([f.start, f.end, f.who ?? f.label, f.kind]);
  }
  const blocker = (airport: string, stand: string, s: number, e: number) => {
    for (const sid of [stand, ...(pb.conflicts[`${airport}:${stand}`] ?? [])]) {
      const hit = (fixedByStand.get(`${airport}:${sid}`) ?? []).find(([a, b]) => a < e && b > s);
      if (hit) return hit;
    }
    return null;
  };
  const prunedBy = new Map<number, Map<string, PrunedReason>>();
  const notePrune = (fi: number, airport: string, stand: string, b: [number, number, string, string]) => {
    if (!prunedBy.has(fi)) prunedBy.set(fi, new Map());
    const m = prunedBy.get(fi)!;
    const key = `${airport}:${stand}`;
    if (!m.has(key)) m.set(key, { airport, stand, by: b[2], kind: b[3], start: b[0], end: b[1] });
  };
  let pruned = 0;
  const flightCols: number[][] = [];
  pb.flights.forEach((f, fi) => {
    const wpax = 1 + f.pax / 150;
    const mine: number[] = [];
    f.homeOpts.forEach((o, oi) => {
      if (exclude.has(`${f.visit}|home:${o.stand}`)) return;
      const cands: [number, number][] = []; // [L, on]
      if (f.waiting) for (const g of GROUND_WAIT_STEPS) cands.push([f.E, f.E + o.taxi + g]);
      else if (f.restricted) for (const L of slots(f.E, o.current ? f.Lhi : Math.min(f.Lhi, f.E + ALT_WINDOW))) cands.push([L, L + o.taxi]);
      else for (const g of GROUND_WAIT_STEPS) cands.push([f.E, f.E + o.taxi + g]);
      cands.forEach(([L, on], k) => {
        const off = f.sobt !== null ? Math.max(f.sobt, on + f.tat) : endRel + 600;
        const start = on - PRE, end = off + POST;
        const blk = blocker(f.home, o.stand, start, end);
        if (blk) { pruned++; notePrune(fi, f.home, o.stand, blk); return; }
        const gw = on - L - (f.waiting ? 4 : o.taxi);
        let cost = Math.max(0, on - f.sibt) * w.delay * wpax;
        if (f.sobt !== null) cost += Math.max(0, off - f.sobt) * w.depDelay * wpax;
        if (f.restricted && !f.waiting) cost += (L - f.E) * (f.airborne ? w.holdAir : w.holdGround);
        cost += Math.max(0, gw) * w.groundWait;
        if (!o.current && f.currentStand !== null) cost += w.change;
        if (o.remoteWb) cost += w.remoteWb * wpax;
        if (o.zoneMiss) cost += w.zone;
        if (o.needsAmbulift) cost += w.prmRemote;
        cost += o.pref;
        mine.push(cols.length);
        cols.push({
          name: `y${fi}_${oi}_${k}`, cost: Math.round(cost), kind: "y", fi, airport: f.home, stand: o.stand, opt: o, L, on, off, start, end,
          landAirport: f.waiting ? undefined : f.home,
          wbSpan: f.widebody ? [on, on + f.tat] : undefined, ambSpan: o.needsAmbulift ? [on, on + AMBULIFT_MIN] : undefined,
        });
      });
    });
    f.divOpts.forEach((d, di) => {
      if (exclude.has(`${f.visit}|div:${d.airport}:*`)) return;
      d.stands.forEach((o, oi) => {
        slots(d.lo, d.hi).forEach((La, k) => {
          const on = La + o.taxi;
          const start = on - PRE, end = on + d.stay + POST;
          const blk = blocker(d.airport, o.stand, start, end);
          if (blk) { pruned++; notePrune(fi, d.airport, o.stand, blk); return; }
          let cost = w.divert + (w.delay * d.arrDelayConst + w.depDelay * d.depDelayConst) * wpax + (La - d.lo) * 2 + o.pref;
          if (o.remoteWb) cost += w.remoteWb * wpax * 0.5;
          if (o.needsAmbulift) cost += w.prmRemote;
          mine.push(cols.length);
          cols.push({
            name: `z${fi}_${di}_${oi}_${k}`, cost: Math.round(cost), kind: "z", fi, airport: d.airport, stand: o.stand, opt: o, L: La, on,
            off: on + d.stay, start, end, landAirport: d.airport, divIdx: di,
            wbSpan: f.widebody ? [on, on + 50] : undefined, ambSpan: o.needsAmbulift ? [on, on + AMBULIFT_MIN] : undefined,
          });
        });
      });
    });
    mine.push(cols.length);
    // "unresolved" leaves the flight on its current plan: it still occupies its current stand, so no other
    // flight may be planned onto that stand over that interval (its landing is re-sequenced by the AMAN)
    const curOpt = f.homeOpts.find((o) => o.current);
    let keep: Partial<Col> = {};
    if (curOpt && f.currentEldt !== null && !f.waiting) {
      const on = f.currentEldt + curOpt.taxi;
      const off = f.sobt !== null ? Math.max(f.sobt, on + f.tat) : endRel + 600;
      keep = { stand: curOpt.stand, start: on - PRE, end: off + POST };
    }
    cols.push({ name: `u${fi}`, cost: Math.round(w.unresolved * wpax * (f.priority ? 5 : 1)), kind: "u", fi, airport: f.home, ...keep });
    flightCols.push(mine);
  });
  const towGroups: number[][] = [];
  pb.tows.forEach((tc, ti) => {
    const grp: number[] = [];
    grp.push(cols.length);
    cols.push({ name: `s${ti}`, cost: 0, kind: "stay", fi: -1, airport: tc.airport, stand: tc.fromStand, start: tc.at + 10, end: tc.holdEnd, towVisit: tc.visit });
    tc.targets.forEach((sid, ri) => {
      const start = tc.at + 15, end = tc.holdEnd;
      if (blocker(tc.airport, sid, start, end)) { pruned++; return; }
      grp.push(cols.length);
      cols.push({ name: `t${ti}_${ri}`, cost: w.tow, kind: "tow", fi: -1, airport: tc.airport, stand: sid, start, end, towVisit: tc.visit, L: tc.at });
    });
    towGroups.push(grp);
  });
  const coordCols = new Map<string, number>();
  for (const icao of Object.keys(pb.caps)) {
    if (cols.some((c) => c.kind === "z" && c.airport === icao)) {
      coordCols.set(icao, cols.length);
      cols.push({ name: `c_${icao}`, cost: w.coord, kind: "c", fi: -1, airport: icao });
    }
  }

  // ---------------------------------------------------------------- constraints
  const rows: string[] = [];
  const term = (coef: number, name: string) => `${coef >= 0 ? "+" : "-"} ${Math.abs(coef) === 1 ? "" : `${Math.abs(coef)} `}${name}`;
  const emit = (label: string, terms: string[], rhs: string) => {
    if (!terms.length) return;
    const lines: string[] = [];
    for (let i = 0; i < terms.length; i += 12) lines.push(terms.slice(i, i + 12).join(" "));
    rows.push(` ${label}: ${lines.join("\n   ")} ${rhs}`);
  };
  flightCols.forEach((ids, fi) => emit(`one${fi}`, ids.map((i) => term(1, cols[i].name)), "= 1"));
  towGroups.forEach((ids, ti) => emit(`tow${ti}`, ids.map((i) => term(1, cols[i].name)), "= 1"));
  // stand cliques
  const byStand = new Map<string, number[]>();
  cols.forEach((c, i) => {
    if (c.start === undefined || c.stand === undefined) return;
    const k = `${c.airport}:${c.stand}`;
    if (!byStand.has(k)) byStand.set(k, []);
    byStand.get(k)!.push(i);
  });
  let cliqueCount = 0;
  // conflicting stand pairs behave like one stand for the overlapping options of both
  const groups: number[][] = [...byStand.values()];
  for (const [k, others] of Object.entries(pb.conflicts)) {
    const [airport, stand] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    for (const o of others) {
      if (o <= stand) continue; // each pair once
      const ids = [...(byStand.get(`${airport}:${stand}`) ?? []), ...(byStand.get(`${airport}:${o}`) ?? [])];
      if (ids.length >= 2) groups.push(ids);
    }
  }
  const emitted = new Set<string>();
  const clique = (ids: number[]) => {
    const key = ids.join(",");
    if (emitted.has(key)) return;
    emitted.add(key);
    emit(`st${cliqueCount++}`, ids.map((i) => term(1, cols[i].name)), "<= 1");
  };
  const flightOf = (i: number) => (cols[i].fi >= 0 ? `f${cols[i].fi}` : cols[i].towVisit);
  for (const ids of groups) {
    if (ids.length < 2) continue;
    const starts = [...new Set(ids.map((i) => cols[i].start!))].sort((a, b) => a - b);
    for (let si = 0; si < starts.length; si++) {
      const tau = starts[si];
      const active = ids.filter((i) => cols[i].start! <= tau && tau < cols[i].end!);
      // only maximal cliques: when every option active here is still active at the next start, that row
      // implies this one (same feasible set, far fewer rows)
      const next = starts[si + 1];
      if (next !== undefined && active.every((i) => cols[i].end! > next)) continue;
      // planned options exclude each other; unresolved flights' current intervals exclude planned options,
      // but two unresolved flights already in conflict are left as they are (that is why they are unresolved)
      const planned = active.filter((i) => cols[i].kind !== "u");
      if (planned.length >= 2 && new Set(planned.map(flightOf)).size >= 2) clique(planned);
      for (const u of active.filter((i) => cols[i].kind === "u")) {
        // only options the optimiser chooses (stands, diversions, tow targets) give way; a towable aircraft
        // staying put is like a fixed occupancy, so "all unresolved + all stay" always remains feasible
        const others = planned.filter((i) => cols[i].fi !== cols[u].fi && cols[i].kind !== "stay");
        if (others.length) clique([...others, u]);
      }
    }
  }
  // runway arrival capacity
  const movableLandingConst: Record<string, Record<number, number>> = {};
  pb.flights.forEach((f) => {
    if (!f.waiting && !f.restricted && !f.divOpts.length) {
      const b = bucketOf(pb.t0 + f.E * 60);
      (movableLandingConst[f.home] ??= {})[b] = (movableLandingConst[f.home][b] ?? 0) + 1;
    }
  });
  const landBy = new Map<string, number[]>();
  cols.forEach((c, i) => {
    if (c.landAirport === undefined || c.L === undefined || (c.kind !== "y" && c.kind !== "z")) return;
    const restricted = pb.restrictionEnd[c.landAirport] !== null;
    if (c.kind === "y" && !restricted && !pb.flights[c.fi].divOpts.length) return; // landing fixed at E
    const k = `${c.landAirport}|${bucketOf(pb.t0 + c.L * 60)}`;
    if (!landBy.has(k)) landBy.set(k, []);
    landBy.get(k)!.push(i);
  });
  let capRows = 0;
  for (const [k, ids] of landBy) {
    const [icao, bs] = k.split("|");
    const b = Number(bs);
    const cap = pb.caps[icao]?.[b];
    if (cap === undefined) continue;
    const used = (pb.fixedLandings[icao]?.[b] ?? 0) + (movableLandingConst[icao]?.[b] ?? 0);
    const rhs = Math.max(0, cap - used);
    const flightsHere = new Set(ids.map((i) => cols[i].fi));
    if (flightsHere.size <= rhs) continue;
    emit(`cap${capRows++}`, ids.map((i) => term(1, cols[i].name)), `<= ${rhs}`);
  }
  // diversion acceptance per rolling hour
  const divBy = new Map<string, number[]>();
  cols.forEach((c, i) => {
    if (c.kind !== "z") return;
    const k = `${c.airport}|${Math.floor((pb.t0 + c.L! * 60) / 3600)}`; // clock hour (same as the validator)
    if (!divBy.has(k)) divBy.set(k, []);
    divBy.get(k)!.push(i);
  });
  let divRows = 0;
  for (const [k, ids] of divBy) {
    const icao = k.split("|")[0];
    if (new Set(ids.map((i) => cols[i].fi)).size <= pb.divLimit[icao]) continue;
    emit(`div${divRows++}`, ids.map((i) => term(1, cols[i].name)), `<= ${pb.divLimit[icao]}`);
  }
  // coordination indicators
  let coordRows = 0;
  for (const [icao, ci] of coordCols) {
    const perFlight = new Map<number, number[]>();
    cols.forEach((c, i) => { if (c.kind === "z" && c.airport === icao) { if (!perFlight.has(c.fi)) perFlight.set(c.fi, []); perFlight.get(c.fi)!.push(i); } });
    for (const ids of perFlight.values()) emit(`co${coordRows++}`, [...ids.map((i) => term(1, cols[i].name)), term(-1, cols[ci].name)], "<= 0");
  }
  // time-indexed resources (5-minute periods)
  let resRows = 0;
  const resource = (span: "ambSpan" | "wbSpan", capOf: (icao: string, tau: number) => number, tag: string) => {
    const byAp = new Map<string, number[]>();
    cols.forEach((c, i) => { if (c[span]) { if (!byAp.has(c.airport)) byAp.set(c.airport, []); byAp.get(c.airport)!.push(i); } });
    for (const [icao, ids] of byAp) {
      let prevKey = "";
      // overlaps peak at interval starts (and capacity drops at outage starts): check exactly there, not on a
      // grid — a grid can miss a two-minute overlap between consecutive turnarounds
      const outStarts = span === "wbSpan" ? pb.wb[icao]?.out.map(([s0]) => s0) ?? [] : pb.ambulift[icao]?.out.map(([s0]) => s0) ?? [];
      const taus = [...new Set([...ids.map((i) => cols[i][span]![0]), ...outStarts])].sort((a, b) => a - b);
      for (let ti = 0; ti < taus.length; ti++) {
        const tau = taus[ti];
        const active = ids.filter((i) => cols[i][span]![0] <= tau && tau < cols[i][span]![1]);
        if (!active.length) continue;
        const cap = Math.max(0, capOf(icao, tau));
        // implied by the next row when everything active here is still active there with no more capacity
        const next = taus[ti + 1];
        if (next !== undefined && active.every((i) => cols[i][span]![1] > next) && Math.max(0, capOf(icao, next)) <= cap) continue;
        const nFlights = new Set(active.map((i) => cols[i].fi)).size;
        if (nFlights <= cap) continue;
        const key = `${active.join(",")}|${cap}`;
        if (key === prevKey) continue;
        prevKey = key;
        emit(`${tag}${resRows++}`, active.map((i) => term(1, cols[i].name)), `<= ${cap}`);
      }
    }
  };
  resource("ambSpan", (icao, tau) => {
    const a = pb.ambulift[icao];
    return a.cap - a.out.filter(([s, e]) => s <= tau && tau < e).reduce((x, [, , u]) => x + u, 0);
  }, "amb");
  resource("wbSpan", (icao, tau) => {
    const r = pb.wb[icao];
    const out = r.out.filter(([s, e]) => s <= tau && tau < e).reduce((x, [, , u]) => x + u, 0);
    const busy = r.fixed.filter(([s, e]) => s <= tau && tau < e).length;
    return r.cap - out - busy;
  }, "wb");
  const objTerms = cols.filter((c) => c.cost !== 0).map((c) => term(c.cost, c.name));
  const objLines: string[] = [];
  for (let i = 0; i < objTerms.length; i += 12) objLines.push(objTerms.slice(i, i + 12).join(" "));
  const binLines: string[] = [];
  for (let i = 0; i < cols.length; i += 16) binLines.push(" " + cols.slice(i, i + 16).map((c) => c.name).join(" "));
  const lp = ["Minimize", ` obj: ${objLines.join("\n   ") || "0 " + cols[0]?.name}`, "Subject To", ...rows, "Binary", ...binLines, "End"].join("\n");
  return { lp, cols, pruned, prunedBy, rows: rows.length, buildMs: performance.now() - t0 };
}

export function optionKey(c: Col): string {
  if (c.kind === "y") return `home:${c.stand}`;
  if (c.kind === "z") return `div:${c.airport}:${c.stand}`;
  if (c.kind === "u") return "u";
  return c.kind;
}

export function solveVariant(highs: HighsLike, pb: Problem, variant: VariantId,
  opts: { timeLimit?: number; exclude?: Set<string> } = {}): PlanResult {
  const model = buildModel(pb, variant, opts.exclude);
  const t = performance.now();
  const res = highs.solve(model.lp, {
    // node limit keeps results deterministic; the time limit is only a safety net. More primal-heuristic effort than
    // HiGHS's default (0.05) finds good plans early: on the Nightfall fog problem the best plan after 12 s left 7
    // flights unresolved instead of 45.
    time_limit: opts.timeLimit ?? 30, mip_max_nodes: 50000, mip_rel_gap: MIP_REL_GAP, mip_heuristic_effort: 0.3, output_flag: false,
    presolve: "on", random_seed: 7,
  });
  const solveMs = performance.now() - t;
  const status = res.Status;
  const ok = status === "Optimal" || (status === "Time limit reached" && Object.keys(res.Columns ?? {}).length > 0);
  const excerpt = model.lp.split("\n").slice(0, 28).join("\n");
  const base = {
    variant, label: VARIANTS[variant].label, status, solveMs, buildMs: model.buildMs + pb.buildMs, numVars: model.cols.length,
    numRows: model.rows, prunedOptions: model.pruned, forcedDistinct: (opts.exclude?.size ?? 0) > 0, duplicateOf: null, modelExcerpt: excerpt,
  };
  if (!ok) {
    return { ...base, objective: null, mipGap: null, decisions: [], rows: [], kpis: emptyKpis(pb.flights.length), signature: "" };
  }
  const val = (name: string) => (res.Columns[name]?.Primal ?? 0) > 0.5;
  return { ...base, ...extract(pb, model, val), objective: res.ObjectiveValue ?? null, mipGap: (res.Info?.mip_gap as number) ?? null };
}

const emptyKpis = (n: number): PlanKpis => ({
  arrDelay: 0, depDelay: 0, paxDelayHours: 0, holding: 0, groundDelay: 0, groundWait: 0, standChanges: 0, diversions: 0, unresolved: 0,
  tows: 0, remoteWb: 0, prmOk: 0, prmTotal: 0, coordinationRequests: 0, coordinationAirports: [], flights: n, landingSlots: 0,
});

function extract(pb: Problem, model: Model, val: (n: string) => boolean): Pick<PlanResult, "decisions" | "rows" | "kpis" | "signature"> {
  const t0 = pb.t0;
  const cols = model.cols;
  const k = emptyKpis(pb.flights.length);
  const decisions: Decision[] = [];
  const rows: PlanRow[] = [];
  const sig: string[] = [];
  const chosenByFlight = new Map<number, Col>();
  for (const c of cols) if (c.fi >= 0 && val(c.name)) chosenByFlight.set(c.fi, c);
  let paxDelay = 0;
  pb.flights.forEach((f: FlightVar, fi) => {
    const c = chosenByFlight.get(fi);
    const base: PlanRow = {
      visit: f.visit, callsign: f.callsign, airline: f.airline, type: f.type, home: f.home, pax: f.pax, prm: f.prm, E: f.E,
      sibt: f.sibt, sobt: f.sobt, tat: f.tat, currentStand: f.currentStand, currentEldt: f.currentEldt, holdLimit: f.holdLimit, reason: f.reason,
      airborne: f.airborne, restricted: f.restricted, option: "unresolved",
    };
    if (f.prm) k.prmTotal++;
    if (!c || c.kind === "u") {
      k.unresolved++;
      rows.push(base);
      sig.push(`${f.visit}:u`);
      const occupied = [...(model.prunedBy.get(fi)?.values() ?? [])].map((p) => ({
        airport: p.airport, stand: p.stand, code: p.kind === "closure" ? "STAND_CLOSED" : "STAND_OCCUPIED",
        reason: `${p.kind === "closure" ? "closed" : `occupied by ${p.by}`} (${p.kind.replace("_", " ")}) for the whole feasible window`,
      }));
      decisions.push({ action: "unresolved", visit: f.visit, callsign: f.callsign, airport: f.home,
        excluded: [...occupied, ...f.excluded].slice(0, 80), reason: f.reason });
      return;
    }
    if (c.kind === "y") {
      const o = c.opt!;
      const arrDelay = Math.max(0, c.on! - f.sibt);
      const depDelay = f.sobt !== null ? Math.max(0, c.off! - f.sobt) : 0;
      const hold = f.restricted && !f.waiting ? c.L! - f.E : 0;
      const gw = Math.max(0, c.on! - c.L! - (f.waiting ? 4 : o.taxi));
      const changed = f.currentStand !== null && o.stand !== f.currentStand;
      k.arrDelay += arrDelay; k.depDelay += depDelay; paxDelay += arrDelay * f.pax;
      if (f.airborne) k.holding += hold; else if (!f.waiting) k.groundDelay += hold;
      k.groundWait += gw; k.remoteWb += o.remoteWb ? 1 : 0; k.prmOk += f.prm ? 1 : 0; k.standChanges += changed ? 1 : 0;
      rows.push({ ...base, option: "home", stand: o.stand, L: c.L, onBlock: c.on, arrDelay, depDelay, hold, groundWait: gw, changed, needsAmbulift: o.needsAmbulift });
      sig.push(`${f.visit}:home:${o.stand}`);
      if (changed || f.currentStand === null) {
        decisions.push({ action: "assign_stand", visit: f.visit, callsign: f.callsign, airport: f.home, stand: o.stand, from: f.currentStand,
          on_block: t0 + c.on! * 60, ground_wait_min: gw, type: f.type, needs_ambulift: o.needsAmbulift, prm: f.prm });
      }
      if (!f.waiting && f.restricted) {
        k.landingSlots++;
        decisions.push({ action: "landing_slot", visit: f.visit, callsign: f.callsign, airport: f.home, eldt: t0 + c.L! * 60,
          prev_eldt: f.currentEldt !== null ? t0 + f.currentEldt * 60 : null, holding_min: hold, hold_limit: f.holdLimit,
          ground_delay: !f.airborne && hold > 0, stand: o.stand });
      }
      return;
    }
    const d = f.divOpts[c.divIdx!];
    const o = c.opt!;
    k.diversions++; k.arrDelay += d.arrDelayConst; k.depDelay += d.depDelayConst; paxDelay += d.arrDelayConst * f.pax; k.prmOk += f.prm ? 1 : 0;
    rows.push({ ...base, option: "divert", to: c.airport, stand: o.stand, L: c.L, arrDelay: d.arrDelayConst, depDelay: d.depDelayConst, stay: d.stay, needsAmbulift: o.needsAmbulift });
    sig.push(`${f.visit}:div:${c.airport}:${o.stand}`);
    decisions.push({ action: "divert", visit: f.visit, callsign: f.callsign, airport: f.home, to: c.airport, stand: o.stand, eldt: t0 + c.L! * 60,
      stay_min: d.stay, type: f.type, needs_ambulift: o.needsAmbulift, prm: f.prm, pax: f.pax, hold_limit: f.holdLimit });
  });
  for (const c of cols) {
    if (c.kind === "tow" && val(c.name)) {
      const tc = pb.tows.find((t) => t.visit === c.towVisit)!;
      k.tows++;
      decisions.push({ action: "tow", visit: tc.visit, callsign: tc.callsign, airport: tc.airport, from_stand: tc.fromStand, to_stand: c.stand, at: t0 + tc.at * 60 });
      sig.push(`${tc.visit}:tow:${c.stand}`);
    }
    if (c.kind === "c" && val(c.name)) { k.coordinationRequests++; k.coordinationAirports.push(c.airport); }
  }
  k.paxDelayHours = Math.round((paxDelay / 60) * 10) / 10;
  const order: Record<string, number> = { unresolved: 0, divert: 1, tow: 2, assign_stand: 3, landing_slot: 4 };
  decisions.sort((a, b) => order[a.action] - order[b.action] || ((a.eldt ?? a.on_block ?? a.at ?? 0) - (b.eldt ?? b.on_block ?? b.at ?? 0)) || (a.visit < b.visit ? -1 : 1));
  return { decisions, rows, kpis: k, signature: sig.sort().join("|") };
}

/** Assignment signature per flight (stand/airport choice), used for distinctness cuts. */
export function choices(plan: PlanResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of plan.rows) {
    out[r.visit] = r.option === "home" ? `home:${r.stand}` : r.option === "divert" ? `div:${r.to}:${r.stand}` : "u";
  }
  return out;
}

export function assignmentSignature(plan: PlanResult): string {
  return Object.entries(choices(plan)).sort().map(([v, c]) => `${v}=${c}`).join("|");
}

/** Decisions of a plan that can be excluded to look for a genuinely different alternative. */
function pivots(plan: PlanResult): { key: string; note: string }[] {
  const out: { key: string; note: string }[] = [];
  for (const d of plan.decisions) {
    if (d.action === "divert") out.push({ key: `${d.visit}|div:${d.to}:*`, note: `without diverting ${d.callsign} to ${d.to}` });
  }
  for (const d of plan.decisions) {
    if (d.action === "assign_stand" && d.from) out.push({ key: `${d.visit}|home:${d.stand}`, note: `keeping ${d.callsign} off stand ${d.stand}` });
  }
  return out;
}

/** Solve the three weighting variants. If a variant reproduces an earlier plan's assignment, look
 * for a genuinely different plan by excluding one pivotal decision of the earlier plan (reported as
 * a forced alternative). If none exists, the duplicate is reported honestly. Deterministic. */
export const VARIANT_IDS: VariantId[] = ["min_delay", "stability", "min_coord"];

/**
 * Three objective variants; identical assignments are re-solved with one pivot decision excluded so the
 * supervisor sees genuinely different options. `first` lets a caller supply first-pass solves computed in
 * parallel (one worker per variant); the result is identical to solving them here in order.
 */
export function solveAlternatives(highs: HighsLike, pb: Problem, timeLimit = 30, first?: PlanResult[]): PlanResult[] {
  const out: PlanResult[] = [];
  for (const [i, v] of VARIANT_IDS.entries()) {
    let r = first?.[i] ?? solveVariant(highs, pb, v, { timeLimit });
    const dup = out.find((p) => p.signature && assignmentSignature(p) === assignmentSignature(r));
    if (dup && r.rows.length) {
      let found = false;
      for (const p of pivots(dup).slice(0, 3)) {
        const alt = solveVariant(highs, pb, v, { timeLimit, exclude: new Set([p.key]) });
        const sig = assignmentSignature(alt);
        if (alt.rows.length && alt.kpis.unresolved <= r.kpis.unresolved && !out.some((q) => assignmentSignature(q) === sig)) {
          r = { ...alt, distinctNote: p.note };
          found = true;
          break;
        }
      }
      if (!found) r = { ...r, duplicateOf: dup.variant };
    }
    out.push(r);
  }
  return out;
}

export const BUCKET_SECONDS = BUCKET_S;
