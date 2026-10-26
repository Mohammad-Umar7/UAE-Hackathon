/**
 * Scenario catalogue (A–I + Operation Nightfall) and the Scenario Lab builder.
 * Every scenario is synthetic: incident timings, capacity rates and resource outages are scenario
 * inputs chosen for demonstration, not operational limits of the real airports.
 */

import { AIRCRAFT, type TypeKey } from "../aircraft";
import { RESOURCE_LABELS } from "../airports/profiles";
import type { Registry } from "../airports/registry";
import type { Incident, IncidentType, Restriction, RestrictionKind, World } from "../types";
import { createWorld, fmtTime, nextId } from "../world";
import { generateSchedule } from "./schedule";
import { clearTrack, fogTrack, stormTrack } from "./weather";

const H = 3600, M = 60;
export const hm = (h: number, m = 0) => h * H + m * M;

export interface ScenarioDef {
  id: string;
  code: string;
  title: string;
  summary: string;
  start: number;
  duration: number;
  focus: string[];
  build: (ctx: ScenarioContext) => void;
  density?: number;
  tags?: string[];
}

export interface ScenarioContext {
  world: World;
  airports: Registry;
  scenario: ScenarioDef;
  notes: string[];
  lab?: LabSpec;
}

export interface LabIncidentSpec {
  type: IncidentType;
  airport: string;
  start_offset_min?: number;
  duration_min?: number;
  severity?: Incident["severity"];
  capacity_rate?: number;
  flights?: number;
  pool?: string;
  units?: number;
  shared?: boolean;
  prm?: number;
  count?: number;
  stand_kind?: string;
  visit?: string;
  reason?: string;
  runway?: string;
}

export interface LabSpec {
  title?: string;
  start?: number;
  duration_h?: number;
  density?: number;
  incidents: LabIncidentSpec[];
}

// ============================================================================ factories

function restriction(w: World, kind: RestrictionKind, airport: string, start: number, end: number,
  params: Record<string, unknown>, shared = true): Restriction {
  const r: Restriction = { id: nextId(w, "RST"), kind, airport, start, end, params, incidentId: null, shared, provenance: "synthetic", version: 0 };
  w.restrictions[r.id] = r;
  return r;
}

function incident(w: World, type: IncidentType, airport: string, title: string, description: string, start: number,
  end: number, severity: Incident["severity"], params: Record<string, unknown>, rs: Restriction[],
  source: Incident["source"] = "scenario", shared = true): Incident {
  const id = nextId(w, "INC");
  for (const r of rs) r.incidentId = id;
  const inc: Incident = { id, type, airport, title, description, start, end, severity, status: "scheduled", params, restrictionIds: rs.map((r) => r.id), source, shared, version: 0 };
  w.incidents[id] = inc;
  return inc;
}

const FOG_FACTOR = { low: 0.7, moderate: 0.6, high: 0.47, severe: 0.4 };

export function makeFog(ctx: ScenarioContext, icao: string, start: number, end: number, severity: Incident["severity"] = "high",
  arrRate?: number, source: Incident["source"] = "scenario"): Incident {
  const w = ctx.world, p = ctx.airports[icao].profile;
  const arr = arrRate ?? Math.max(4, Math.round(p.arrCapacity * FOG_FACTOR[severity]));
  const dep = Math.max(6, Math.round(p.depCapacity * Math.min(1, FOG_FACTOR[severity] + 0.25)));
  const rs = [
    restriction(w, "ARRIVAL_CAPACITY", icao, start, end, { rate: arr, normal: p.arrCapacity, reason: "Low-visibility procedures (fog)" }),
    restriction(w, "DEPARTURE_CAPACITY", icao, start, end, { rate: dep, normal: p.depCapacity, reason: "Low-visibility procedures (fog)" }),
    restriction(w, "LOW_VISIBILITY", icao, start, end, { lvp: true }),
  ];
  w.weatherTrack[icao] = fogTrack(ctx.scenario.start, start - 10 * M, start + 25 * M, end);
  return incident(w, "FOG", icao, `Fog — low-visibility procedures at ${p.iata}`,
    `Simulated radiation fog. Scenario capacity input: arrivals ${arr}/h (normal ${p.arrCapacity}/h), departures ${dep}/h until ${fmtTime(end)} (forecast).`,
    start, end, severity, { arr_rate: arr, dep_rate: dep, normal_arr: p.arrCapacity, normal_dep: p.depCapacity }, rs, source);
}

export function makeStorm(ctx: ScenarioContext, icao: string, start: number, end: number, severity: Incident["severity"] = "high",
  source: Incident["source"] = "scenario"): Incident {
  const w = ctx.world, p = ctx.airports[icao].profile;
  const f = { low: 0.8, moderate: 0.7, high: 0.55, severe: 0.45 }[severity];
  const arr = Math.max(4, Math.round(p.arrCapacity * f)), dep = Math.max(4, Math.round(p.depCapacity * f));
  const peak = start + 0.35 * (end - start);
  const rs = [
    restriction(w, "ARRIVAL_CAPACITY", icao, start, end, { rate: arr, normal: p.arrCapacity, reason: "Thunderstorm in terminal area" }),
    restriction(w, "DEPARTURE_CAPACITY", icao, start, end, { rate: dep, normal: p.depCapacity, reason: "Thunderstorm in terminal area" }),
    restriction(w, "APRON_SUSPENSION", icao, start + 15 * M, start + 40 * M, { reason: "Lightning within 5 NM — ramp operations suspended" }),
    restriction(w, "APRON_SUSPENSION", icao, peak + 10 * M, peak + 35 * M, { reason: "Lightning within 5 NM — ramp operations suspended" }),
  ];
  w.weatherTrack[icao] = stormTrack(ctx.scenario.start, start, peak, end);
  return incident(w, "THUNDERSTORM", icao, `Thunderstorm and heavy rain at ${p.iata}`,
    `Simulated convective weather: arrivals ${arr}/h, departures ${dep}/h, two lightning ramp suspensions, wet runway (longer landing rolls).`,
    start, end, severity, { arr_rate: arr, dep_rate: dep }, rs, source);
}

export function makeRunwayClosure(ctx: ScenarioContext, icao: string, start: number, end: number, runway?: string,
  reason = "Runway inspection — reported debris", source: Incident["source"] = "scenario"): Incident {
  const w = ctx.world, ap = ctx.airports[icao], p = ap.profile;
  const rw = runway ?? ap.runwayEnds[ap.arrivalEnd].runwayId;
  const single = new Set(Object.values(ap.runwayEnds).map((e) => e.runwayId)).size <= 1;
  const arr = single ? 0 : Math.max(4, Math.round(p.arrCapacity * 0.62));
  const dep = single ? 0 : Math.max(4, Math.round(p.depCapacity * 0.62));
  const rs = [restriction(w, "RUNWAY_CLOSED", icao, start, end, { runway: rw, arr_rate: arr, dep_rate: dep, reason })];
  return incident(w, "RUNWAY_CLOSURE", icao, `Runway ${rw} unavailable at ${p.iata}`,
    `${reason}. Remaining runway operates mixed mode (scenario capacity: arrivals ${arr}/h, departures ${dep}/h).`,
    start, end, "high", { runway: rw, arr_rate: arr, dep_rate: dep }, rs, source);
}

export function makeStandBlocked(ctx: ScenarioContext, icao: string, start: number, end: number, visitId: string,
  issue = "hydraulic leak — aircraft unserviceable", towableAfterMin = 60, source: Incident["source"] = "scenario"): Incident {
  const v = ctx.world.visits[visitId];
  const cs = v.dep?.callsign ?? v.id;
  return incident(ctx.world, "STAND_BLOCKED", icao, `Stand ${v.stand} blocked — ${cs} technical issue`,
    `${issue}. Departure ${cs} delayed until at least ${fmtTime(end)}; aircraft remains on stand ${v.stand} (towable after ${towableAfterMin} min).`,
    start, end, "high", { visit: visitId, stand: v.stand, issue, towable_after_min: towableAfterMin }, [], source);
}

export function makeResourceOutage(ctx: ScenarioContext, icao: string, pool: string, units: number, start: number, end: number,
  reason: string, shared = true, source: Incident["source"] = "scenario"): Incident {
  const r = restriction(ctx.world, "RESOURCE_OUTAGE", icao, start, end, { pool, units, reason }, shared);
  const label = RESOURCE_LABELS[pool] ?? pool;
  return incident(ctx.world, "RESOURCE_OUTAGE", icao, `${label} unavailable (${units} unit${units === 1 ? "" : "s"})`, reason,
    start, end, "moderate", { pool, units }, [r], source, shared);
}

export function makePriority(ctx: ScenarioContext, icao: string, start: number, visitId: string, nature: string,
  source: Incident["source"] = "scenario"): Incident {
  const v = ctx.world.visits[visitId];
  return incident(ctx.world, "PRIORITY_ARRIVAL", icao, `Priority arrival — ${v.arr?.callsign ?? v.id}`,
    `Crew reported ${nature}. Scenario requires priority sequencing and a suitable stand; ATC actions remain with authorised controllers.`,
    start, start + 2 * H, "severe", { visit: visitId, nature }, [], source);
}

export function makeAccessibility(ctx: ScenarioContext, icao: string, start: number, visitId: string, prm = 3,
  source: Incident["source"] = "scenario"): Incident {
  const v = ctx.world.visits[visitId];
  return incident(ctx.world, "ACCESSIBILITY_REQUIREMENT", icao, `${prm} passengers requiring full assistance on ${v.arr?.callsign ?? v.id}`,
    "Wheelchair (WCHC) passengers: recovery must keep accessible boarding (jet bridge, or remote stand with an available ambulift).",
    start, start + 6 * H, "moderate", { visit: visitId, prm }, [], source);
}

export function makeStandClosure(ctx: ScenarioContext, icao: string, stands: string[], start: number, end: number, reason: string,
  source: Incident["source"] = "scenario"): Incident {
  const r = restriction(ctx.world, "STAND_CLOSED", icao, start, end, { stands, reason });
  return incident(ctx.world, "STAND_CLOSURE", icao, `Stand${stands.length > 1 ? "s" : ""} ${stands.join(", ")} closed`, reason,
    start, end, "moderate", { stands }, [r], source);
}

export function makeInflux(ctx: ScenarioContext, icao: string, start: number, n: number, source: Incident["source"] = "scenario"): Incident {
  const types: TypeKey[] = ["wb", "nb", "wb", "nb", "vla", "wb", "nb", "wb"];
  const airlines: Record<string, string[]> = { wb: ["MPX", "BRL", "MJL"], nb: ["DCW", "BRL", "DNE"], vla: ["MJL"] };
  const origins = ["OTHH", "OBBI", "OKKK", "OOMS"];
  const specs = Array.from({ length: n }, (_, i) => {
    const t = types[i % types.length];
    const al = airlines[t][i % airlines[t].length];
    return {
      id: `${icao}-X${String(i + 1).padStart(2, "0")}`, callsign: `${al}${870 + i * 3}`, airline: al, type: t,
      origin: origins[i % origins.length], eta: start + (25 + 9 * i) * M, pax: Math.floor(AIRCRAFT[t].seats * 0.85),
      fuel_min: 25 + (i % 3) * 10, ground_min: 150, prm: i === 1 ? 2 : 0,
    };
  });
  return incident(ctx.world, "DIVERSION_INFLUX", icao, `${n} unplanned diversions inbound to ${icao}`,
    "Weather at a regional hub outside the network diverts flights into the UAE network. Each must be accommodated by an eligible airport (aircraft size, runway, stand, handling).",
    start, start + 4 * H, "high", { flights: specs }, [], source);
}

// ============================================================================ selectors

export function pickBlockedVisit(ctx: ScenarioContext, icao: string, t: number, window: [number, number] = [15 * M, 80 * M]): string | null {
  const w = ctx.world, ap = ctx.airports[icao];
  let best: [number, number, string] | null = null;
  for (const v of Object.values(w.visits).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (v.airport !== icao || v.phase !== "ON_STAND" || !v.dep || !v.stand) continue;
    if (!AIRCRAFT[v.type].widebody || !ap.stands[v.stand].contact) continue;
    if (v.dep.sched < t + window[0] || v.dep.sched > t + window[1]) continue;
    const next = Object.values(w.visits).filter((o) => o.airport === icao && o.stand === v.stand && o.id !== v.id && o.arr
      && o.arr.sched >= v.dep!.sched && o.arr.sched <= v.dep!.sched + 100 * M);
    if (!next.length) continue;
    const gap = Math.min(...next.map((o) => o.arr!.sched)) - v.dep.sched;
    if (!best || gap < best[0] || (gap === best[0] && v.dep.sched < best[1])) best = [gap, v.dep.sched, v.id];
  }
  return best?.[2] ?? null;
}

export function pickInbound(ctx: ScenarioContext, icao: string, t0: number, t1: number, types: TypeKey[], airline?: string): string | null {
  const c = Object.values(ctx.world.visits).filter((v) => v.airport === icao && v.phase === "SCHEDULED" && types.includes(v.type)
    && v.eta !== null && v.eta >= t0 && v.eta <= t1 && (!airline || v.airline === airline))
    .sort((a, b) => a.eta! - b.eta! || (a.id < b.id ? -1 : 1));
  return c[0]?.id ?? null;
}

function someStands(ctx: ScenarioContext, icao: string, kind: string, n: number): string[] {
  const ids = Object.values(ctx.airports[icao].stands).sort((a, b) => a.index - b.index).filter((s) => s.kind === kind).map((s) => s.id);
  const step = Math.max(1, Math.floor(ids.length / (n + 1)));
  return ids.filter((_, i) => i >= step && (i - step) % step === 0).slice(0, n);
}

function clearWeather(ctx: ScenarioContext) {
  for (const icao of Object.keys(ctx.airports)) if (!ctx.world.weatherTrack[icao]) ctx.world.weatherTrack[icao] = clearTrack(ctx.scenario.start);
}

// ============================================================================ catalogue

function buildNightfall(ctx: ScenarioContext) {
  const s = ctx.scenario.start;
  makeFog(ctx, "OMAA", s + 40 * M, s + 4 * H + 30 * M, "severe");
  const tBlock = s + 48 * M;
  const vid = pickBlockedVisit(ctx, "OMDB", tBlock);
  if (vid) makeStandBlocked(ctx, "OMDB", tBlock, tBlock + 3 * H + 20 * M, vid, "hydraulic leak — aircraft unserviceable", 75);
  const prm = pickInbound(ctx, "OMAA", s + 65 * M, s + 105 * M, ["wb"], "SQR");
  if (prm) makeAccessibility(ctx, "OMAA", s + 5 * M, prm, 3);
  makeResourceOutage(ctx, "OMSJ", "ambulift", 2, s - 20 * M, s + 6 * H,
    "Both ambulifts unserviceable (hydraulic lift fault) — recorded in the Sharjah local equipment log only.", false, "local_log");
  makeResourceOutage(ctx, "OMSJ", "wb_handling", 3, s - 20 * M, s + 6 * H,
    "Three wide-body handling teams reassigned to a cargo surge (local roster).", false, "local_log");
  clearWeather(ctx);
  ctx.notes.push(`Blocked-stand visit: ${vid ?? "none"}; accessibility inbound: ${prm ?? "none"}`);
}

export const SCENARIOS: ScenarioDef[] = [
  { id: "nightfall", code: "I", title: "Operation Nightfall", start: hm(17, 20), duration: 7 * H, focus: ["OMAA", "OMDB", "OMSJ"],
    summary: "Cascading three-airport disruption: fog at Zayed International, a blocked stand at Dubai International, passengers needing assistance, and Sharjah constraints only revealed through coordination.",
    build: buildNightfall, tags: ["signature"] },
  { id: "baseline", code: "—", title: "Normal operations", start: hm(17, 20), duration: 6 * H, focus: ["OMAA", "OMDB", "OMSJ"],
    summary: "All three airports operating normally (reference run).", build: (c) => { clearWeather(c); } },
  { id: "a_fog", code: "A", title: "Heavy fog — Zayed International", start: hm(4, 40), duration: 6 * H, focus: ["OMAA"],
    summary: "Radiation fog at dawn triggers low-visibility procedures and an arrival-capacity restriction.",
    build: (c) => { makeFog(c, "OMAA", c.scenario.start + 35 * M, c.scenario.start + 4 * H + 15 * M, "high"); clearWeather(c); } },
  { id: "b_storm", code: "B", title: "Thunderstorm — Dubai International", start: hm(14, 30), duration: 6 * H, focus: ["OMDB"],
    summary: "Convective weather reduces runway capacity and lightning suspends ramp operations twice.",
    build: (c) => { makeStorm(c, "OMDB", c.scenario.start + 30 * M, c.scenario.start + 2.5 * H, "high"); clearWeather(c); } },
  { id: "c_runway", code: "C", title: "Runway unavailable — Dubai International", start: hm(12, 30), duration: 6 * H, focus: ["OMDB"],
    summary: "The arrival runway closes for inspection; operations continue on the remaining runway.",
    build: (c) => { makeRunwayClosure(c, "OMDB", c.scenario.start + 30 * M, c.scenario.start + 2.5 * H); clearWeather(c); } },
  { id: "d_stand", code: "D", title: "Blocked stand — Dubai International", start: hm(16, 0), duration: 6 * H, focus: ["OMDB"],
    summary: "A wide-body becomes unserviceable on a contact stand; the next arrival loses its stand.",
    build: (c) => {
      const t = c.scenario.start + 30 * M;
      const vid = pickBlockedVisit(c, "OMDB", t);
      if (vid) makeStandBlocked(c, "OMDB", t, t + 3.5 * H, vid);
      clearWeather(c);
    } },
  { id: "e_priority", code: "E", title: "Priority arrival — Zayed International", start: hm(11, 0), duration: 5 * H, focus: ["OMAA"],
    summary: "An inbound flight reports an emergency; priority sequencing and a suitable stand are needed.",
    build: (c) => {
      const vid = pickInbound(c, "OMAA", c.scenario.start + 50 * M, c.scenario.start + 80 * M, ["wb", "nb"]);
      if (vid) makePriority(c, "OMAA", c.scenario.start + 35 * M, vid, "a medical emergency on board and a suspected hydraulic fault");
      clearWeather(c);
    } },
  { id: "f_influx", code: "F", title: "Unexpected diversions — Sharjah", start: hm(15, 0), duration: 6 * H, focus: ["OMSJ", "OMDB", "OMAA"],
    summary: "Six flights divert into the network; ineligible aircraft must be accommodated elsewhere.",
    build: (c) => { makeInflux(c, "OMSJ", c.scenario.start + 25 * M, 6); clearWeather(c); } },
  { id: "g_handling", code: "G", title: "Ground-handling limitation — Zayed International", start: hm(13, 0), duration: 6 * H, focus: ["OMAA"],
    summary: "Stands are free but handling teams and ground power are not; the plan must respect it.",
    build: (c) => {
      const s = c.scenario.start;
      makeResourceOutage(c, "OMAA", "wb_handling", 10, s + 30 * M, s + 3 * H, "Wide-body handling teams unavailable (equipment recall: main-deck loaders and tow bars).");
      makeStandClosure(c, "OMAA", someStands(c, "OMAA", "remote", 4), s + 30 * M, s + 3 * H,
        "Ground power and pre-conditioned air unserviceable at these remote stands (technically free, not usable for turnarounds).");
      clearWeather(c);
    } },
  { id: "h_accessibility", code: "H", title: "Accessibility-sensitive recovery — Dubai International", start: hm(18, 0), duration: 6 * H, focus: ["OMDB"],
    summary: "Moderate fog plus an ambulift shortage; passengers needing full assistance must keep accessible boarding.",
    build: (c) => {
      const s = c.scenario.start;
      makeFog(c, "OMDB", s + 30 * M, s + 3 * H, "moderate");
      const vid = pickInbound(c, "OMDB", s + 50 * M, s + 100 * M, ["wb", "nb"]);
      if (vid) makeAccessibility(c, "OMDB", s + 20 * M, vid, 3);
      makeResourceOutage(c, "OMDB", "ambulift", 6, s + 20 * M, s + 3 * H, "Six of eight ambulifts out of service (battery fault recall).");
      clearWeather(c);
    } },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[1];

export function buildWorld(scenarioId: string, seed: number, airports: Registry, lab?: LabSpec): { world: World; scenario: ScenarioDef; notes: string[] } {
  let sc = scenarioById(scenarioId);
  if (lab) {
    sc = { id: "lab", code: "LAB", title: lab.title ?? "Scenario Lab run", summary: "Custom scenario configured in the Scenario Lab",
      start: lab.start ?? hm(17, 20), duration: (lab.duration_h ?? 6) * H, focus: ["OMAA", "OMDB", "OMSJ"], density: lab.density ?? 1,
      build: (c) => { for (const spec of lab.incidents) injectIncident(c, spec, c.scenario.start); clearWeather(c); } };
  }
  const world = createWorld(seed, sc.id, sc.start);
  generateSchedule(world, airports, { start: sc.start, end: sc.start + sc.duration, density: sc.density ?? 1 });
  const ctx: ScenarioContext = { world, airports, scenario: sc, notes: [], lab };
  sc.build(ctx);
  for (const icao of Object.keys(airports)) {
    const track = world.weatherTrack[icao];
    if (track?.length) world.weather[icao] = track[0].obs;
  }
  return { world, scenario: sc, notes: ctx.notes };
}

/** Create an incident from a Scenario Lab specification. `start_offset_min` is relative to `at`. */
export function injectIncident(ctx: ScenarioContext, spec: LabIncidentSpec, at: number, source: Incident["source"] = "scenario"): Incident | null {
  const icao = spec.airport;
  const start = at + 60 * (spec.start_offset_min ?? 0);
  const end = start + 60 * (spec.duration_min ?? 120);
  const sev = spec.severity ?? "high";
  switch (spec.type) {
    case "FOG": return makeFog(ctx, icao, start, end, sev, spec.capacity_rate, source);
    case "THUNDERSTORM": return makeStorm(ctx, icao, start, end, sev, source);
    case "RUNWAY_CLOSURE": return makeRunwayClosure(ctx, icao, start, end, spec.runway, undefined, source);
    case "STAND_BLOCKED": {
      const vid = spec.visit ?? pickBlockedVisit(ctx, icao, start, [5 * M, 120 * M]) ?? anyOnStand(ctx, icao);
      return vid ? makeStandBlocked(ctx, icao, start, end, vid, undefined, 60, source) : null;
    }
    case "PRIORITY_ARRIVAL": {
      const vid = spec.visit ?? nextInbound(ctx, icao, start);
      return vid ? makePriority(ctx, icao, start, vid, "a medical emergency on board", source) : null;
    }
    case "DIVERSION_INFLUX": return makeInflux(ctx, icao, start, spec.flights ?? 4, source);
    case "RESOURCE_OUTAGE": return makeResourceOutage(ctx, icao, spec.pool ?? "wb_handling", spec.units ?? 4, start, end,
      spec.reason ?? "Resource unavailable (Scenario Lab)", spec.shared ?? true, source);
    case "ACCESSIBILITY_REQUIREMENT": {
      const vid = spec.visit ?? nextInbound(ctx, icao, start, ["wb", "nb"]);
      return vid ? makeAccessibility(ctx, icao, start, vid, spec.prm ?? 3, source) : null;
    }
    case "STAND_CLOSURE": return makeStandClosure(ctx, icao, someStands(ctx, icao, spec.stand_kind ?? "contact", spec.count ?? 3), start, end,
      spec.reason ?? "Stand closure (Scenario Lab)", source);
    default: return null;
  }
}

function anyOnStand(ctx: ScenarioContext, icao: string): string | null {
  return Object.values(ctx.world.visits).sort((a, b) => (a.id < b.id ? -1 : 1))
    .find((v) => v.airport === icao && v.phase === "ON_STAND" && v.dep)?.id ?? null;
}

function nextInbound(ctx: ScenarioContext, icao: string, t: number, types: TypeKey[] = ["wb", "nb", "vla"]): string | null {
  return Object.values(ctx.world.visits).filter((v) => v.airport === icao && (v.phase === "SCHEDULED" || v.phase === "INBOUND")
    && v.eta !== null && v.eta > t + 20 * M && types.includes(v.type)).sort((a, b) => a.eta! - b.eta! || (a.id < b.id ? -1 : 1))[0]?.id ?? null;
}
