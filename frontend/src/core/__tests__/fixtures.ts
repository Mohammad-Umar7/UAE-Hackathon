/** Small synthetic airport layouts (same contract as layout.json) for fast, data-independent tests. */

import { PROFILES } from "../airports/profiles";
import { buildAirport, type Layout, type Registry } from "../airports/registry";

export function makeLayout(nContact = 10, nRemote = 6, nCargo = 2, bigEvery = 4): Layout {
  const nodes: { id: number; x: number; y: number }[] = [];
  const edges: { a: number; b: number; kind: string; ref: string; length_m: number; points: number[][] }[] = [];
  const node = (x: number, y: number) => {
    const f = nodes.find((n) => Math.abs(n.x - x) < 0.01 && Math.abs(n.y - y) < 0.01);
    if (f) return f.id;
    nodes.push({ id: nodes.length, x, y });
    return nodes.length - 1;
  };
  const edge = (a: number, b: number, kind: string, ref = "") => {
    const pa = nodes[a], pb = nodes[b];
    edges.push({ a, b, kind, ref, length_m: Math.hypot(pb.x - pa.x, pb.y - pa.y), points: [[pa.x, pa.y], [pb.x, pb.y]] });
  };
  const rw = [-1600, -1400, -700, 0, 700, 1400, 1600].map((x) => node(x, 0));
  for (let i = 0; i < rw.length - 1; i++) edge(rw[i], rw[i + 1], "runway", "RWY");
  const tw = [-1400, -900, -700, 0, 700, 900, 1400].map((x) => node(x, -200));
  for (let i = 0; i < tw.length - 1; i++) edge(tw[i], tw[i + 1], "taxiway", "A");
  for (const x of [-1400, -700, 0, 700, 1400]) edge(node(x, 0), node(x, -200), "taxiway", "A");
  const specs: [string, number, number][] = [];
  let x = -820;
  for (let i = 0; i < nContact; i++) { const span = i % bigEvery === 0 ? 80 : 65; specs.push(["contact", x, span]); x += span + 7.5; }
  x += 40;
  for (let i = 0; i < nRemote; i++) { specs.push(["remote", x, 65]); x += 72.5; }
  for (let i = 0; i < nCargo; i++) { specs.push(["cargo", x, 80]); x += 87.5; }
  const laneY = -380;
  const laneXs = [...new Set([-900, 900, Math.max(900, x + 50), ...specs.map((s) => s[1])])].sort((a, b) => a - b);
  const lane = laneXs.map((lx) => node(lx, laneY));
  for (let i = 0; i < lane.length - 1; i++) edge(lane[i], lane[i + 1], "taxilane", "L");
  edge(node(-900, -200), node(-900, laneY), "taxiway", "B");
  edge(node(900, -200), node(900, laneY), "taxiway", "C");
  const stands = specs.map(([kind, sx, span], i) => {
    const entry = node(sx, laneY), stop = node(sx, -470);
    edge(entry, stop, "stand_link", `S${i}`);
    const id = ({ contact: "C", remote: "R", cargo: "K" } as Record<string, string>)[kind] + (i + 1);
    return {
      id, ref: id, x: sx, y: -470, heading: 180, lead_in: [[sx, laneY], [sx, -470]], kind, contact: kind === "contact",
      bridge_root: kind === "contact" ? [sx + 12, -500] : null, bridge_count: kind === "contact" ? (span > 65 ? 3 : 2) : 0,
      max_wingspan_m: span, size_code: span > 65 ? "F" : "E", entry_node: entry, stop_node: stop,
      area: kind === "contact" ? "Terminal" : kind, source: "fixture",
    };
  });
  return {
    icao: "TEST", runways: [{ id: "09/27", width_m: 60, length_m: 3200, ends: [{ designator: "09", x: -1600, y: 0, heading_true: 90 }, { designator: "27", x: 1600, y: 0, heading_true: 270 }] }],
    stands, taxi_graph: { nodes, edges },
  };
}

export function makeAirports(sizes: Record<string, [number, number, number]> = { OMAA: [12, 8, 2], OMDB: [16, 10, 2], OMSJ: [6, 6, 4] }): Registry {
  const out: Registry = {};
  for (const [icao, [c, r, k]] of Object.entries(sizes)) {
    out[icao] = buildAirport({ ...PROFILES[icao], arrivalHeadingPref: 270, singleRunway: true }, makeLayout(c, r, k));
  }
  return out;
}
