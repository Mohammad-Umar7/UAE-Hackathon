/** Three-airport registry: OSM-derived layouts + synthetic operating profiles. */

import { AIRCRAFT, codeForSpan, type AircraftType } from "../aircraft";
import { headingOf, TaxiGraph, type LayoutGraph, type Pt } from "./graph";
import { PROFILES, type AirportProfile } from "./profiles";

export interface RunwayEnd {
  designator: string;
  runwayId: string;
  x: number;
  y: number;
  heading: number;
  width: number;
  length: number;
  chain: [number, number][]; // [node, distance from this threshold]
  exits: [number, number, number][]; // [node, distance, exit angle]
}

export interface StandInfo {
  key: string;
  airport: string;
  id: string;
  x: number;
  y: number;
  heading: number;
  kind: "contact" | "remote" | "cargo" | "ga";
  contact: boolean;
  maxWingspan: number;
  sizeCode: string;
  bridgeRoot: Pt | null;
  bridgeCount: number;
  area: string;
  zone: string;
  entryNode: number;
  stopNode: number;
  services: Set<string>;
  source: string;
  leadIn: Pt[];
  taxiIn: number;
  taxiOut: number;
  index: number;
}

export interface Layout {
  icao: string;
  iata?: string;
  name?: string;
  arp?: { lat: number; lon: number; elevation_m?: number };
  runways: { id: string; width_m?: number; length_m?: number; ends: { designator: string; x: number; y: number; heading_true?: number }[] }[];
  stands: Record<string, unknown>[];
  taxi_graph: LayoutGraph;
  taxiways?: unknown[];
  aprons?: unknown[];
  buildings?: unknown[];
  roads?: unknown[];
  landuse?: unknown[];
  context_buildings?: unknown[];
  [k: string]: unknown;
}

export interface AirportInfo {
  icao: string;
  profile: AirportProfile;
  layout: Layout;
  graph: TaxiGraph;
  runwayEnds: Record<string, RunwayEnd>;
  stands: Record<string, StandInfo>;
  arrivalEnd: string;
  departureEnd: string;
  maxWingspan: number;
  maxRunwayLength: number;
  maxRunwayWidth: number;
}

export function standAccepts(st: StandInfo, t: AircraftType): [boolean, string] {
  if (t.wingspan > st.maxWingspan + 1e-6) {
    return [false, `wingspan ${t.wingspan.toFixed(1)} m > stand limit ${st.maxWingspan.toFixed(1)} m`];
  }
  if (t.freighter) return st.kind === "cargo" ? [true, ""] : [false, "freighter requires a cargo stand"];
  if (st.kind === "cargo") return [false, "cargo stand (no passenger facilities)"];
  if (t.key === "biz") return st.kind === "contact" ? [false, "business aviation uses GA/remote stands"] : [true, ""];
  if (st.kind === "ga" && t.key !== "reg") return [false, "GA stand"];
  return [true, ""];
}

function project(px: number, py: number, end: RunwayEnd): [number, number] {
  const h = (end.heading * Math.PI) / 180;
  const ux = Math.sin(h), uy = Math.cos(h);
  const dx = px - end.x, dy = py - end.y;
  return [dx * ux + dy * uy, -dx * uy + dy * ux];
}

function zoneFor(area: string, kind: string, id: string, profile: AirportProfile): string {
  if (kind === "cargo") return "CARGO";
  if (kind === "ga") return "GA";
  for (const [re, zone] of profile.zoneRules) {
    if (zone === "CARGO" || zone === "GA") continue;
    if (re.test(area) || re.test(id)) return zone;
  }
  return kind === "remote" ? "REMOTE" : (area || kind).toUpperCase();
}

function services(kind: string, contact: boolean, bridges: number): Set<string> {
  const s = new Set(["GPU"]);
  if (contact && bridges > 0) ["JET_BRIDGE", "PRM_BRIDGE", "PCA", "FUEL_HYDRANT"].forEach((x) => s.add(x));
  if (kind === "remote") ["BUS_BOARDING", "FUEL_HYDRANT"].forEach((x) => s.add(x));
  if (kind === "cargo") s.add("CARGO");
  if (kind === "ga") s.add("GA_HANDLING");
  return s;
}

export function landingExit(ap: AirportInfo, end: RunwayEnd, touchdown: number, stopDist: number): [number, number, number] {
  const need = touchdown + stopDist;
  for (const ex of end.exits) if (ex[1] >= need) return ex;
  if (end.exits.length) return end.exits[end.exits.length - 1];
  const last = end.chain[end.chain.length - 1];
  return [last[0], last[1], 90];
}

export function departureEntry(end: RunwayEnd): [number, number] {
  const cands = end.exits.filter((e) => e[1] < 900);
  if (cands.length) {
    const best = cands.reduce((a, b) => (b[1] < a[1] ? b : a));
    return [best[0], best[1]];
  }
  if (end.exits.length) return [end.exits[0][0], end.exits[0][1]];
  return end.chain[0];
}

export function holdNodeForEntry(ap: AirportInfo, entry: number): number {
  for (const [v, ei] of ap.graph.adj.get(entry) ?? []) if (ap.graph.edges[ei].kind !== "runway") return v;
  return entry;
}

export function buildAirport(profile: AirportProfile, layout: Layout): AirportInfo {
  const graph = TaxiGraph.fromLayout(layout.taxi_graph);
  const runwayEnds: Record<string, RunwayEnd> = {};
  for (const rw of layout.runways) {
    const width = Number(rw.width_m ?? 45);
    const [e0, e1] = rw.ends;
    const length = Number(rw.length_m ?? Math.hypot(e1.x - e0.x, e1.y - e0.y));
    rw.ends.forEach((e, i) => {
      const other = rw.ends[1 - i];
      const hdg = e.heading_true ?? headingOf([e.x, e.y], [other.x, other.y]);
      runwayEnds[e.designator] = { designator: e.designator, runwayId: rw.id, x: e.x, y: e.y, heading: hdg, width, length, chain: [], exits: [] };
    });
  }
  const runwayNodes = new Map<string, Set<number>>();
  for (const e of graph.edges) {
    if (e.kind !== "runway") continue;
    for (const end of Object.values(runwayEnds)) {
      const [aAl, aCr] = project(...graph.node(e.a), end);
      const [bAl, bCr] = project(...graph.node(e.b), end);
      const tol = Math.max(40, end.width);
      if (Math.abs(aCr) < tol && Math.abs(bCr) < tol && aAl > -200 && aAl < end.length + 200 && bAl > -200 && bAl < end.length + 200) {
        if (!runwayNodes.has(end.runwayId)) runwayNodes.set(end.runwayId, new Set());
        runwayNodes.get(end.runwayId)!.add(e.a).add(e.b);
      }
    }
  }
  for (const end of Object.values(runwayEnds)) {
    const nodes = [...(runwayNodes.get(end.runwayId) ?? [])];
    end.chain = nodes.map((n) => [n, Math.max(0, project(...graph.node(n), end)[0])] as [number, number])
      .sort((a, b) => a[1] - b[1]);
    end.exits = [];
    for (const [n, d] of end.chain) {
      for (const [, ei] of graph.adj.get(n) ?? []) {
        const edge = graph.edges[ei];
        if (edge.kind === "runway") continue;
        const pts = edge.a === n ? edge.points : [...edge.points].reverse();
        let ang = 90;
        if (pts.length >= 2) {
          const far = pts[Math.min(pts.length - 1, 3)];
          ang = Math.abs(((((headingOf(pts[0], far) - end.heading) % 360) + 540) % 360) - 180);
        }
        end.exits.push([n, d, ang]);
        break;
      }
    }
  }
  // synthetic runway configuration: land into the preferred direction
  const score = (e: RunwayEnd) => Math.abs(((((e.heading - profile.arrivalHeadingPref) % 360) + 540) % 360) - 180);
  const sorted = Object.values(runwayEnds).sort((a, b) => score(a) - score(b) || b.length - a.length);
  const usable = sorted.filter((e) => score(e) < 90);
  let arrivalEnd: string, departureEnd: string;
  if (profile.singleRunway || new Set(usable.map((e) => e.runwayId)).size < 2) {
    arrivalEnd = departureEnd = (usable[0] ?? sorted[0]).designator;
  } else {
    arrivalEnd = usable[0].designator;
    departureEnd = usable.find((e) => e.runwayId !== usable[0].runwayId)!.designator;
  }
  const stands: Record<string, StandInfo> = {};
  layout.stands.forEach((s: Record<string, unknown>, i) => {
    const id = String(s.id ?? s.ref ?? `S${i}`);
    const kind = (s.kind as StandInfo["kind"]) ?? (s.contact ? "contact" : "remote");
    const span = Number(s.max_wingspan_m ?? 36);
    const area = String(s.area ?? "");
    const contact = Boolean(s.contact) && kind === "contact";
    const bridges = contact ? Number(s.bridge_count ?? 1) : 0;
    stands[id] = {
      key: `${profile.icao}:${id}`, airport: profile.icao, id, x: Number(s.x), y: Number(s.y),
      heading: Number(s.heading ?? 0), kind, contact, maxWingspan: span,
      sizeCode: String(s.size_code ?? codeForSpan(span)), bridgeRoot: (s.bridge_root as Pt) ?? null,
      bridgeCount: bridges, area, zone: zoneFor(area, kind, id, profile), entryNode: Number(s.entry_node),
      stopNode: Number(s.stop_node), services: services(kind, contact, bridges), source: String(s.source ?? "osm"),
      leadIn: ((s.lead_in as number[][]) ?? []).map((p) => [p[0], p[1]] as Pt), taxiIn: 420, taxiOut: 540, index: i,
    };
  });
  const ap: AirportInfo = {
    icao: profile.icao, profile, layout, graph, runwayEnds, stands, arrivalEnd, departureEnd,
    maxWingspan: Math.max(0, ...Object.values(stands).map((s) => s.maxWingspan)),
    maxRunwayLength: Math.max(0, ...Object.values(runwayEnds).map((e) => e.length)),
    maxRunwayWidth: Math.max(0, ...Object.values(runwayEnds).map((e) => e.width)),
  };
  precomputeTaxiTimes(ap);
  return ap;
}

function precomputeTaxiTimes(ap: AirportInfo): void {
  const g = ap.graph;
  const arr = ap.runwayEnds[ap.arrivalEnd];
  const [exitNode] = landingExit(ap, arr, 400, 1500);
  const dIn = g.dijkstra(exitNode);
  const dep = ap.runwayEnds[ap.departureEnd];
  const [entry] = departureEntry(dep);
  const hold = holdNodeForEntry(ap, entry);
  const dOut = g.dijkstra(hold);
  for (const st of Object.values(ap.stands)) {
    const din = dIn.get(st.entryNode) ?? 1.4 * Math.hypot(st.x - g.node(exitNode)[0], st.y - g.node(exitNode)[1]);
    const dout = dOut.get(st.entryNode) ?? 1.4 * Math.hypot(st.x - g.node(hold)[0], st.y - g.node(hold)[1]);
    st.taxiIn = 60 + (din + 60) / 7;
    st.taxiOut = 240 + (dout + 60) / 7;
  }
}

export type Registry = Record<string, AirportInfo>;

export function buildRegistry(layouts: Record<string, Layout>, profiles = PROFILES): Registry {
  const out: Registry = {};
  for (const icao of Object.keys(layouts).sort()) out[icao] = buildAirport(profiles[icao], layouts[icao]);
  return out;
}

export const typeOf = (k: keyof typeof AIRCRAFT) => AIRCRAFT[k];
