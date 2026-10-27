/**
 * Builds airfield geometry from a layout.json (docs/CONVENTIONS.md §4).
 * Layout coordinates are ENU metres around the ARP: (x east, y north). three.js: (x, height, -y).
 * All builders are pure (no React) so they can be unit-tested and run once per airport.
 */

import * as THREE from "three";
import type { AirportInfo, Layout, StandInfo } from "@/core/airports/registry";

export type P2 = [number, number];

export interface LayoutTaxiway { id?: string; ref?: string; kind?: string; width_m?: number; points: number[][] }
export interface LayoutApron { id?: string; ref?: string; polygon: number[][]; holes?: number[][][] }
export interface LayoutBuilding {
  id?: string; kind?: string; name?: string; footprint: number[][]; holes?: number[][][]; height_m?: number; levels?: number; source?: string;
}
export interface LayoutRoad { kind?: string; width_m?: number; points: number[][] }
export interface LayoutLanduse { kind?: string; polygon: number[][]; holes?: number[][][] }

const p2 = (p: number[]): P2 => [p[0], p[1]];
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const norm = (a: P2): P2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a: P2): P2 => [-a[1], a[0]]; // left of direction
export const headingVec = (deg: number): P2 => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];

/** Accumulates flat or 3D triangles with world-space UVs (u = x / tile, v = y / tile). */
export class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  color: number[] | null = null;
  constructor(public tile = 20) {}

  /** Flat triangle at height h (layout coords); winding fixed so the face points up. */
  tri(a: P2, b: P2, c: P2, h: number): void {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) return;
    const v = area > 0 ? [a, b, c] : [a, c, b];
    for (const p of v) {
      this.pos.push(p[0], h, -p[1]);
      this.nrm.push(0, 1, 0);
      this.uv.push(p[0] / this.tile, p[1] / this.tile);
    }
  }

  quad(a: P2, b: P2, c: P2, d: P2, h: number): void {
    this.tri(a, b, c, h);
    this.tri(a, c, d, h);
  }

  /** Oriented rectangle: centre, unit direction, length along dir, width across. */
  rect(center: P2, dir: P2, along: number, across: number, h: number): void {
    const u = mul(dir, along / 2), n = mul(perp(dir), across / 2);
    this.quad(add(add(center, u), n), add(sub(center, u), n), sub(sub(center, u), n), sub(add(center, u), n), h);
  }

  disc(c: P2, r: number, h: number, seg = 14): void {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri(c, [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], h);
    }
  }

  /** Polyline ribbon with round joints (overlaps are harmless: same material, world UVs). */
  ribbon(pts: P2[], width: number, h: number, caps = true, joints = true): void {
    if (pts.length < 2) return;
    const w = width / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = sub(b, a);
      if (len(d) < 1e-6) continue;
      const n = mul(perp(norm(d)), w);
      this.quad(add(a, n), add(b, n), sub(b, n), sub(a, n), h);
      if ((i > 0 && joints) || (i === 0 && caps)) this.disc(a, w, h, w > 4 ? 14 : 8);
    }
    if (caps) this.disc(pts[pts.length - 1], w, h, w > 4 ? 14 : 8);
  }

  /** Dashed ribbon (dash/gap along the polyline). */
  dashed(pts: P2[], width: number, dash: number, gap: number, h: number): void {
    const period = dash + gap;
    let S = 0; // cumulative distance at the start of the segment
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = len(sub(b, a));
      if (L < 1e-6) continue;
      const u = norm(sub(b, a));
      for (let k = Math.floor(S / period); k * period < S + L; k++) {
        const s0 = Math.max(S, k * period) - S, s1 = Math.min(S + L, k * period + dash) - S;
        if (s1 > s0 + 1e-3) this.rect(add(a, mul(u, (s0 + s1) / 2)), u, s1 - s0, width, h);
      }
      S += L;
    }
  }

  polygon(outer: P2[], holes: P2[][], h: number): void {
    const o = dedupeRing(outer);
    if (o.length < 3) return;
    const hs = holes.map(dedupeRing).filter((r) => r.length >= 3);
    const faces = THREE.ShapeUtils.triangulateShape(o.map((p) => new THREE.Vector2(p[0], p[1])), hs.map((r) => r.map((p) => new THREE.Vector2(p[0], p[1]))));
    const all = [...o, ...hs.flat()];
    for (const [a, b, c] of faces) this.tri(all[a], all[b], all[c], h);
  }

  /** Vertical wall quad from (a, h0) to (b, h1), UV u along the wall (m / uTile), v = height / vTile. */
  wall(a: P2, b: P2, h0: number, h1: number, u0: number, uTile: number, vTile: number): void {
    const d = sub(b, a);
    const L = len(d);
    if (L < 1e-3) return;
    const n = norm([d[1], -d[0]]); // right of a→b = outward for CCW rings
    const corners: [P2, number, number, number][] = [[a, h0, u0, h0], [b, h0, u0 + L, h0], [b, h1, u0 + L, h1], [a, h1, u0, h1]];
    const push = (k: number) => {
      const [p, y, u, v] = corners[k];
      this.pos.push(p[0], y, -p[1]);
      this.nrm.push(n[0], 0, -n[1]);
      this.uv.push(u / uTile, v / vTile);
    };
    [0, 1, 2, 0, 2, 3].forEach(push);
  }

  get empty(): boolean { return this.pos.length === 0; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function dedupeRing(r: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of r) if (!out.length || len(sub(p, out[out.length - 1])) > 0.05) out.push(p);
  if (out.length > 2 && len(sub(out[0], out[out.length - 1])) < 0.05) out.pop();
  return out;
}

const ringArea = (r: P2[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const ccw = (r: P2[]) => (ringArea(r) < 0 ? [...r].reverse() : r);
const cw = (r: P2[]) => (ringArea(r) > 0 ? [...r].reverse() : r);

// ------------------------------------------------------------------ runways

export interface RunwayEndGeom {
  designator: string;
  at: P2; // landing threshold
  pave: P2; // physical end of the pavement behind the threshold
  displaced: number; // metres between pavement end and threshold
  dir: P2; // unit direction of landing
  heading: number;
}

export interface RunwayGeom {
  id: string;
  a: P2; b: P2; // pavement ends
  width: number;
  ends: RunwayEndGeom[];
}

type LayoutRunwayEnd = { designator: string; x: number; y: number; heading_true?: number; end_x?: number; end_y?: number };

export function runwaysOf(layout: Layout): RunwayGeom[] {
  return layout.runways.map((r) => {
    const [e0, e1] = r.ends as LayoutRunwayEnd[];
    const t0: P2 = [e0.x, e0.y], t1: P2 = [e1.x, e1.y];
    const a: P2 = e0.end_x !== undefined && e0.end_y !== undefined ? [e0.end_x, e0.end_y] : t0;
    const b: P2 = e1.end_x !== undefined && e1.end_y !== undefined ? [e1.end_x, e1.end_y] : t1;
    const u = norm(sub(t1, t0));
    const hd = (v: P2) => ((Math.atan2(v[0], v[1]) * 180) / Math.PI + 360) % 360;
    return {
      id: r.id, a, b, width: Number(r.width_m ?? 45),
      ends: [
        { designator: e0.designator, at: t0, pave: a, displaced: len(sub(t0, a)), dir: u, heading: e0.heading_true ?? hd(u) },
        { designator: e1.designator, at: t1, pave: b, displaced: len(sub(t1, b)), dir: mul(u, -1), heading: e1.heading_true ?? hd(mul(u, -1)) },
      ],
    };
  });
}

export interface DesignatorLabel { text: string; letter: string; at: P2; heading: number }

/** Pavement (asphalt) and paint (white) for every runway, ICAO Annex 14 style. */
export function buildRunways(rws: RunwayGeom[], asphalt: GeoBuilder, shoulder: GeoBuilder, paint: GeoBuilder, labels: DesignatorLabel[]): void {
  for (const rw of rws) {
    const W = rw.width;
    shoulder.ribbon([rw.a, rw.b], W + 15, 0, false);
    asphalt.ribbon([rw.a, rw.b], W, 0, false);
    const L = len(sub(rw.b, rw.a));
    const u = norm(sub(rw.b, rw.a));
    // edge stripes
    for (const s of [-1, 1]) {
      const off = mul(perp(u), s * (W / 2 - 0.6));
      paint.ribbon([add(rw.a, off), add(rw.b, off)], 0.9, 0, false);
    }
    for (const end of rw.ends) {
      const E = end.at, d = end.dir, n = perp(d);
      if (end.displaced > 40) {
        // displaced threshold: transverse bar + centreline arrows pointing to the threshold
        paint.rect(add(E, mul(d, -0.9)), d, 1.8, W - 3, 0);
        for (let s = 40; s < end.displaced - 20; s += 120) {
          const c = sub(E, mul(d, s));
          paint.rect(sub(c, mul(d, 12)), d, 24, 1.2, 0);
          for (const side of [-1, 1]) {
            const tip = c, tail = add(sub(c, mul(d, 8)), mul(n, side * 3));
            paint.ribbon([tail, tip], 1.0, 0, false);
          }
        }
      }
      // threshold piano keys
      const stripes = W >= 60 ? 16 : W >= 45 ? 12 : W >= 30 ? 8 : 6;
      const per = stripes / 2, sw = 1.8;
      for (const side of [-1, 1]) {
        for (let k = 0; k < per; k++) {
          const lat = side * (sw + sw / 2 + k * 2 * sw);
          paint.rect(add(add(E, mul(d, 6 + 15)), mul(n, lat)), d, 30, sw, 0);
        }
      }
      // designator
      const m = /^(\d{1,2})([LCR]?)$/.exec(end.designator);
      labels.push({ text: m ? m[1].padStart(2, "0") : end.designator, letter: m?.[2] ?? "", at: add(E, mul(d, m?.[2] ? 66 : 54)), heading: end.heading });
      // aiming point + touchdown zone
      for (const side of [-1, 1]) {
        paint.rect(add(add(E, mul(d, 400 + 25)), mul(n, side * (9 + 4.5))), d, 50, 9, 0);
        for (const [at, count] of [[150, 3], [300, 3], [600, 2], [750, 2], [900, 1]] as [number, number][]) {
          if (at + 30 > (L - rw.ends[0].displaced - rw.ends[1].displaced) / 2) continue;
          for (let k = 0; k < count; k++) {
            paint.rect(add(add(E, mul(d, at + 11.25)), mul(n, side * (9 + 1.5 + k * 4.5))), d, 22.5, 3, 0);
          }
        }
      }
    }
    // centreline: 30 m dashes, 20 m gaps, between the designators
    const c0 = add(rw.ends[0].at, mul(rw.ends[0].dir, 90)), c1 = add(rw.ends[1].at, mul(rw.ends[1].dir, 90));
    paint.dashed([c0, c1], 0.9, 30, 20, 0);
  }
}

// ------------------------------------------------------------------ taxiways, stands, aprons

export interface TaxiPaths { centre: P2[][]; ribbons: { pts: P2[]; width: number }[] }

/** Taxiway pavement polylines (layout.taxiways if present, otherwise the taxi graph). */
export function taxiwaysOf(layout: Layout, ap: AirportInfo): TaxiPaths {
  const out: TaxiPaths = { centre: [], ribbons: [] };
  const tws = (layout.taxiways ?? []) as LayoutTaxiway[];
  for (const t of tws) {
    if (t.points?.length >= 2) out.ribbons.push({ pts: t.points.map(p2), width: Number(t.width_m ?? (t.kind === "taxilane" ? 18 : 23)) });
  }
  for (const e of ap.graph.edges) {
    if (e.kind === "runway" || e.kind === "stand_link") continue;
    out.centre.push(e.points);
    if (!tws.length) out.ribbons.push({ pts: e.points, width: e.kind === "taxilane" ? 30 : 23 });
  }
  return out;
}

export function apronsOf(layout: Layout, stands: StandInfo[]): { outer: P2[]; holes: P2[][] }[] {
  const aprons = (layout.aprons ?? []) as LayoutApron[];
  if (aprons.length) return aprons.map((a) => ({ outer: a.polygon.map(p2), holes: (a.holes ?? []).map((h) => h.map(p2)) }));
  // fixture fallback: one slab per stand envelope
  return stands.map((s) => {
    const d = headingVec(s.heading), n = perp(d);
    const L = Math.max(40, s.maxWingspan * 1.05), half = s.maxWingspan / 2 + 6;
    const c = sub([s.x, s.y], mul(d, L / 2 - 8));
    const u = mul(d, L / 2 + 14), w = mul(n, half);
    return { outer: [add(add(c, u), w), add(sub(c, u), w), sub(sub(c, u), w), sub(add(c, u), w)], holes: [] };
  });
}

/** Stand markings: lead-in line, stop bar, envelope (equipment restraint line). */
export function buildStandMarkings(stands: StandInfo[], ap: AirportInfo, yellow: GeoBuilder, red: GeoBuilder, white: GeoBuilder): void {
  for (const s of stands) {
    const d = headingVec(s.heading), n = perp(d);
    const stop: P2 = [s.x, s.y];
    let lead = s.leadIn.length >= 2 ? [...s.leadIn] : [];
    if (lead.length && len(sub(lead[0], stop)) < len(sub(lead[lead.length - 1], stop))) lead = lead.reverse();
    if (!lead.length) {
      const entry = ap.graph.node(s.entryNode);
      lead = [entry, sub(stop, mul(d, 35)), stop];
    }
    if (len(sub(lead[lead.length - 1], stop)) > 1) lead.push(stop);
    yellow.ribbon(lead, 0.35, 0);
    yellow.rect(add(stop, mul(d, 1.2)), d, 0.6, 6, 0); // stop bar
    // equipment restraint area: dashed red outline of the parked envelope
    const half = s.maxWingspan / 2 + 3;
    const tail = s.maxWingspan > 65 ? 74 : s.maxWingspan > 52 ? 66 : 42;
    const front = 6;
    const corners: P2[] = [add(add(stop, mul(d, front)), mul(n, half)), add(sub(stop, mul(d, tail)), mul(n, half)), sub(sub(stop, mul(d, tail)), mul(n, half)), sub(add(stop, mul(d, front)), mul(n, half))];
    red.dashed([corners[0], corners[1]], 0.3, 3, 2, 0);
    red.dashed([corners[2], corners[3]], 0.3, 3, 2, 0);
    red.ribbon([corners[3], corners[0]], 0.3, 0, false);
    white.rect(add(stop, mul(d, 3.2)), d, 0.4, 3.5, 0); // nose-wheel stop mark
  }
}

// ------------------------------------------------------------------ buildings

export interface BuildingGeoms { glass: GeoBuilder; concrete: GeoBuilder; metal: GeoBuilder; roof: GeoBuilder; roofMetal: GeoBuilder }

export function buildingsOf(layout: Layout, stands: StandInfo[]): LayoutBuilding[] {
  const bs = (layout.buildings ?? []) as LayoutBuilding[];
  if (bs.length) return bs;
  // fixture fallback: a pier behind the contact stands
  const contact = stands.filter((s) => s.contact && s.bridgeRoot);
  if (!contact.length) return [];
  const d = headingVec(contact[0].heading), n = perp(d);
  const xs = contact.map((s) => (s.x - contact[0].x) * n[0] + (s.y - contact[0].y) * n[1]);
  const lo = Math.min(...xs) - 45, hi = Math.max(...xs) + 45;
  const base = add([contact[0].x, contact[0].y], mul(d, 34));
  const fp: P2[] = [add(base, mul(n, lo)), add(base, mul(n, hi)), add(add(base, mul(n, hi)), mul(d, 70)), add(add(base, mul(n, lo)), mul(d, 70))];
  return [{ kind: "terminal", name: "Terminal (fixture)", footprint: fp, height_m: 22, source: "derived" }];
}

export function buildBuildings(list: LayoutBuilding[], g: BuildingGeoms, minHeight = 6): void {
  for (const b of list) {
    const outer = ccw(dedupeRing(b.footprint.map(p2)));
    if (outer.length < 3) continue;
    const holes = (b.holes ?? []).map((h) => cw(dedupeRing(h.map(p2))));
    const h = Math.max(minHeight, Number(b.height_m ?? (b.levels ? b.levels * 4 : 10)));
    const kind = b.kind ?? "other";
    const walls = kind === "terminal" || kind === "concourse" || kind === "tower" ? g.glass : kind === "hangar" || kind === "cargo" ? g.metal : g.concrete;
    const roof = kind === "hangar" || kind === "cargo" ? g.roofMetal : g.roof;
    for (const ring of [outer, ...holes]) {
      let u = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        walls.wall(a, c, 0, h, u, 4, 4.2);
        u += len(sub(c, a));
      }
    }
    roof.polygon(outer, holes, h);
  }
}

// ------------------------------------------------------------------ lights

export type LightGroup = "runway" | "approach" | "taxi" | "stopbar" | "guard" | "apron" | "papi" | "edge_blue";

export interface LightSet {
  positions: number[]; // three.js xyz
  colors: number[]; // linear rgb
  sizes: number[]; // metres
  groups: number[]; // index into LIGHT_GROUPS
  phases: number[]; // flash phase (s) or -1 = steady
  runway: number[]; // runway index (for closures) or -1
}

export const LIGHT_GROUPS: LightGroup[] = ["runway", "approach", "taxi", "stopbar", "guard", "apron", "papi", "edge_blue"];

const C = {
  white: [1.0, 0.92, 0.78], amber: [1.0, 0.62, 0.16], red: [1.0, 0.1, 0.06], green: [0.15, 1.0, 0.45], blue: [0.2, 0.42, 1.0],
  cool: [0.85, 0.92, 1.0], warm: [1.0, 0.78, 0.52],
};

export function emptyLights(): LightSet { return { positions: [], colors: [], sizes: [], groups: [], phases: [], runway: [] }; }

function light(L: LightSet, p: P2, h: number, color: number[], size: number, group: LightGroup, phase = -1, runway = -1): void {
  L.positions.push(p[0], h, -p[1]);
  L.colors.push(...color);
  L.sizes.push(size);
  L.groups.push(LIGHT_GROUPS.indexOf(group));
  L.phases.push(phase);
  L.runway.push(runway);
}

export function buildRunwayLights(rws: RunwayGeom[], L: LightSet): void {
  rws.forEach((rw, ri) => {
    const W = rw.width;
    const total = len(sub(rw.b, rw.a));
    const u = norm(sub(rw.b, rw.a)), n = perp(u);
    for (let s = 0; s <= total + 0.1; s += 60) {
      const amber = s < 600 || s > total - 600;
      for (const side of [-1, 1]) light(L, add(add(rw.a, mul(u, s)), mul(n, side * (W / 2 + 1.5))), 0.6, amber ? C.amber : C.white, 2.2, "runway", -1, ri);
    }
    for (let s = 15; s < total; s += 15) {
      const fromEnd = Math.min(s, total - s);
      const col = fromEnd < 300 ? C.red : fromEnd < 900 ? ((s / 15) % 2 ? C.red : C.white) : C.white;
      light(L, add(rw.a, mul(u, s)), 0.15, col, 1.4, "runway", -1, ri);
    }
    for (const end of rw.ends) {
      const E = end.at, d = end.dir, nn = perp(d);
      for (let x = -W / 2; x <= W / 2 + 0.01; x += 3) {
        light(L, add(add(E, mul(d, 1)), mul(nn, x)), 0.3, C.green, 1.7, "runway", -1, ri);
        light(L, add(sub(end.pave, mul(d, 1.5)), mul(nn, x)), 0.3, C.red, 1.5, "runway", -1, ri);
      }
      if (end.displaced > 40) for (const side of [-1, 1]) for (let k = 0; k < 5; k++) {
        light(L, add(E, mul(nn, side * (W / 2 + 2 + k * 3))), 0.4, C.green, 1.8, "runway", -1, ri); // wing bars
      }
      // touchdown zone barrettes
      for (let s = 60; s <= 900; s += 60) for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
        light(L, add(add(E, mul(d, s)), mul(nn, side * (9 + k * 1.5))), 0.15, C.white, 1.1, "runway", -1, ri);
      }
      // approach lighting system with sequenced flashers
      for (let s = 30; s <= 900; s += 30) {
        const base = sub(E, mul(d, s));
        const hgt = 0.8 + s * 0.004;
        for (let k = -2; k <= 2; k++) light(L, add(base, mul(nn, k * 1.05)), hgt, C.white, 1.9, "approach", -1, ri);
        if (s > 300) light(L, base, hgt + 0.6, [1.0, 1.0, 1.0], 3.2, "approach", (900 - s) / 900, ri);
        if (s <= 270) for (const side of [-1, 1]) for (let k = 0; k < 3; k++) light(L, add(base, mul(nn, side * (9 + k * 1.5))), hgt, C.red, 1.5, "approach", -1, ri);
      }
      for (let x = -15; x <= 15; x += 1.5) light(L, add(sub(E, mul(d, 300)), mul(nn, x)), 2.0, C.white, 1.8, "approach", -1, ri);
      // PAPI (left side, 400 m in): two red inboard, two white outboard
      for (let k = 0; k < 4; k++) light(L, add(add(E, mul(d, 400)), mul(nn, W / 2 + 15 + k * 9)), 0.9, k < 2 ? C.red : C.white, 2.6, "papi", -1, ri);
    }
  });
}

export interface HoldPosition { at: P2; dir: P2; runway: number }

/** Runway-holding positions: where a non-runway graph edge leaves a runway node, ~90 m out. */
export function holdPositions(ap: AirportInfo, rws: RunwayGeom[]): HoldPosition[] {
  const out: HoldPosition[] = [];
  const g = ap.graph;
  const seen = new Set<string>();
  for (const end of Object.values(ap.runwayEnds)) {
    const ri = rws.findIndex((r) => r.id === end.runwayId);
    for (const [node] of end.chain) {
      for (const [, ei] of g.adj.get(node) ?? []) {
        const e = g.edges[ei];
        if (e.kind === "runway") continue;
        const pts = (e.a === node ? e.points : [...e.points].reverse()).map(p2);
        if (pts.length < 2) continue;
        let acc = 0, at: P2 | null = null, dir: P2 = [0, 1];
        for (let i = 0; i < pts.length - 1 && !at; i++) {
          const seg = len(sub(pts[i + 1], pts[i]));
          if (acc + seg >= 90) { dir = norm(sub(pts[i + 1], pts[i])); at = add(pts[i], mul(dir, 90 - acc)); }
          acc += seg;
        }
        if (!at) continue;
        const key = `${Math.round(at[0] / 5)}:${Math.round(at[1] / 5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ at, dir, runway: ri });
      }
    }
  }
  return out;
}

export function buildHoldMarkings(holds: HoldPosition[], yellow: GeoBuilder, L: LightSet): void {
  for (const h of holds) {
    const n = perp(h.dir);
    // pattern A: two solid lines on the holding side, two dashed on the runway side
    for (const [off, dashedLine] of [[0, false], [1.0, false], [-1.2, true], [-2.2, true]] as [number, boolean][]) {
      const c = add(h.at, mul(h.dir, off));
      if (!dashedLine) yellow.rect(c, n, 26, 0.3, 0);
      else yellow.dashed([add(c, mul(n, -13)), add(c, mul(n, 13))], 0.3, 1, 1, 0);
    }
    for (let x = -12; x <= 12; x += 3) light(L, add(add(h.at, mul(h.dir, 0.6)), mul(n, x)), 0.2, C.red, 1.2, "stopbar", -1, h.runway);
    for (const [side, ph] of [[-1, 0], [1, 0.5]] as [number, number][]) light(L, add(add(h.at, mul(h.dir, 2.5)), mul(n, side * 15)), 0.9, C.amber, 2.2, "guard", ph, h.runway);
  }
}

export function buildTaxiLights(centre: P2[][], L: LightSet): void {
  for (const pts of centre) {
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const seg = len(sub(b, a));
      const u = norm(sub(b, a));
      let s = carry;
      while (s < seg) { light(L, add(a, mul(u, s)), 0.12, C.green, 0.9, "taxi"); s += 30; }
      carry = s - seg;
    }
  }
}

/** Apron flood masts between stands, facing the stands; returns mast positions for models and pools. */
export function floodMasts(stands: StandInfo[], L: LightSet): { at: P2; heading: number }[] {
  const out: { at: P2; heading: number }[] = [];
  const sorted = [...stands].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length; i += 2) {
    const s = sorted[i];
    const d = headingVec(s.heading), n = perp(d);
    const at = add(add([s.x, s.y], mul(d, 14)), mul(n, s.maxWingspan / 2 + 5));
    if (out.some((m) => len(sub(m.at, at)) < 45)) continue;
    out.push({ at, heading: (s.heading + 180) % 360 });
    for (const k of [-1.2, 0, 1.2]) light(L, add(at, mul(n, k)), 29, s.kind === "remote" || s.kind === "cargo" ? C.warm : C.cool, 2.4, "apron");
  }
  return out;
}

// ------------------------------------------------------------------ misc layout layers

const near = (pts: number[][], c: P2, R: number) => pts.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < R);

export function roadsOf(layout: Layout, c: P2 = [0, 0], R = 1e9): LayoutRoad[] {
  return ((layout.roads ?? []) as LayoutRoad[]).filter((r) => r.points?.length >= 2 && near(r.points, c, R));
}

/** City context around the airport: nearest/largest footprints first, capped for GPU memory. */
export function contextOf(layout: Layout, c: P2, R: number, max: number): { footprint: number[][]; height_m?: number }[] {
  const all = (layout.context_buildings ?? []) as { footprint: number[][]; height_m?: number }[];
  const scored = all.filter((b) => b.footprint?.length >= 3).map((b) => {
    let sx = 0, sy = 0;
    for (const p of b.footprint) { sx += p[0]; sy += p[1]; }
    const d = Math.hypot(sx / b.footprint.length - c[0], sy / b.footprint.length - c[1]);
    return { b, d };
  }).filter((x) => x.d < R);
  scored.sort((p, q) => p.d - q.d);
  return scored.slice(0, max).map((x) => x.b);
}
export function landuseOf(layout: Layout): LayoutLanduse[] { return ((layout.landuse ?? []) as LayoutLanduse[]).filter((l) => l.polygon?.length >= 3); }

export function layoutBounds(layout: Layout, ap: AirportInfo): { min: P2; max: P2; center: P2; radius: number } {
  const xs: number[] = [], ys: number[] = [];
  for (const r of layout.runways) for (const e of r.ends) { xs.push(e.x); ys.push(e.y); }
  for (const s of Object.values(ap.stands)) { xs.push(s.x); ys.push(s.y); }
  const min: P2 = [Math.min(...xs), Math.min(...ys)], max: P2 = [Math.max(...xs), Math.max(...ys)];
  const center: P2 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  return { min, max, center, radius: Math.max(600, len(sub(max, min)) / 2) };
}
