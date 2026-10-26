/** Taxi graph routing on the airport layout network (nose-gear tracks), plus geometry helpers. */

export type Pt = [number, number];

export interface Edge {
  idx: number;
  a: number;
  b: number;
  kind: string;
  ref: string;
  length: number;
  points: Pt[];
}

export interface LayoutGraph {
  nodes: { id: number; x: number; y: number }[];
  edges: { a: number; b: number; kind?: string; ref?: string; length_m?: number; points?: number[][] }[];
}

/** Binary min-heap keyed by number. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    this.k.push(key); this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0], this.v[0]];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
        [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
        i = m;
      }
    }
    return top;
  }
}

export type PathStep = [number, number, number]; // from node, to node, edge index

export class TaxiGraph {
  nodes = new Map<number, Pt>();
  edges: Edge[] = [];
  adj = new Map<number, [number, number][]>();

  static fromLayout(data: LayoutGraph): TaxiGraph {
    const g = new TaxiGraph();
    for (const n of data.nodes) g.nodes.set(n.id, [n.x, n.y]);
    data.edges.forEach((e, i) => {
      let pts: Pt[] = (e.points ?? []).map((p) => [p[0], p[1]] as Pt);
      if (pts.length < 2) pts = [g.nodes.get(e.a)!, g.nodes.get(e.b)!];
      const length = e.length_m ?? polylineLength(pts);
      g.edges.push({ idx: i, a: e.a, b: e.b, kind: e.kind ?? "taxiway", ref: e.ref ?? "", length, points: pts });
    });
    for (const id of g.nodes.keys()) g.adj.set(id, []);
    for (const e of g.edges) {
      g.adj.get(e.a)?.push([e.b, e.idx]);
      g.adj.get(e.b)?.push([e.a, e.idx]);
    }
    return g;
  }

  node(id: number): Pt {
    return this.nodes.get(id)!;
  }

  nearestNode(x: number, y: number, kinds?: Set<string>): number {
    let allowed: Set<number> | null = null;
    if (kinds) {
      allowed = new Set();
      for (const e of this.edges) if (kinds.has(e.kind)) { allowed.add(e.a); allowed.add(e.b); }
    }
    let best = -1, bestD = Infinity;
    for (const [id, [nx, ny]] of this.nodes) {
      if (allowed && !allowed.has(id)) continue;
      const d = (nx - x) ** 2 + (ny - y) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  edgeCost(e: Edge, allowStand?: Set<number>): number {
    if (e.kind === "runway") return e.length * 25;
    if (e.kind === "stand_link") return allowStand?.has(e.idx) ? e.length : e.length * 50;
    return e.length;
  }

  dijkstra(src: number): Map<number, number> {
    const dist = new Map<number, number>([[src, 0]]);
    const h = new Heap();
    h.push(0, src);
    while (h.size) {
      const [d, u] = h.pop();
      if (d > (dist.get(u) ?? Infinity)) continue;
      for (const [v, ei] of this.adj.get(u) ?? []) {
        const e = this.edges[ei];
        const nd = d + (e.kind === "runway" ? e.length * 25 : e.kind === "stand_link" ? e.length * 1.6 : e.length);
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); h.push(nd, v); }
      }
    }
    return dist;
  }

  shortestPath(src: number, dst: number, allowStand?: Set<number>): PathStep[] | null {
    if (src === dst) return [];
    const dist = new Map<number, number>([[src, 0]]);
    const prev = new Map<number, [number, number]>();
    const h = new Heap();
    h.push(0, src);
    while (h.size) {
      const [d, u] = h.pop();
      if (u === dst) break;
      if (d > (dist.get(u) ?? Infinity)) continue;
      for (const [v, ei] of this.adj.get(u) ?? []) {
        const nd = d + this.edgeCost(this.edges[ei], allowStand);
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, [u, ei]); h.push(nd, v); }
      }
    }
    if (!prev.has(dst)) return null;
    const out: PathStep[] = [];
    let n = dst;
    while (n !== src) {
      const [u, ei] = prev.get(n)!;
      out.push([u, n, ei]);
      n = u;
    }
    return out.reverse();
  }

  pathPoints(path: PathStep[]): Pt[] {
    const pts: Pt[] = [];
    for (const [u, , ei] of path) {
      const e = this.edges[ei];
      const seg = e.a === u ? e.points : [...e.points].reverse();
      if (pts.length && close(pts[pts.length - 1], seg[0])) pts.push(...seg.slice(1));
      else pts.push(...seg);
    }
    return dedupe(pts);
  }
}

export const close = (p: Pt, q: Pt, tol = 0.05) => Math.abs(p[0] - q[0]) < tol && Math.abs(p[1] - q[1]) < tol;

export function dedupe(pts: Pt[], tol = 0.05): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || !close(out[out.length - 1], p, tol)) out.push(p);
  return out;
}

export const dist = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);

export function polylineLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += dist(pts[i], pts[i + 1]);
  return s;
}

/** True heading (deg clockwise from north) of p→q in the ENU frame. */
export function headingOf(p: Pt, q: Pt): number {
  return ((Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI + 360) % 360;
}

export function offsetPoint(p: Pt, headingDeg: number, d: number): Pt {
  const h = (headingDeg * Math.PI) / 180;
  return [p[0] + Math.sin(h) * d, p[1] + Math.cos(h) * d];
}

export function angleDiff(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Replace sharp polyline corners with circular fillets (limited by adjacent segment length). */
export function roundCorners(input: Pt[], radius: number, step = 6): Pt[] {
  const pts = dedupe(input);
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = out[out.length - 1], p1 = pts[i], p2 = pts[i + 1];
    const v1: Pt = [p0[0] - p1[0], p0[1] - p1[1]];
    const v2: Pt = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)));
    const interior = Math.acos(cos);
    if (Math.PI - interior < (4 * Math.PI) / 180) { out.push(p1); continue; }
    const tanHalf = Math.tan(interior / 2);
    if (tanHalf < 1e-6) { out.push(p1); continue; }
    let r = radius;
    let d = r / tanHalf;
    const dmax = 0.48 * Math.min(l1, l2);
    if (d > dmax) { d = dmax; r = d * tanHalf; }
    const u1: Pt = [v1[0] / l1, v1[1] / l1], u2: Pt = [v2[0] / l2, v2[1] / l2];
    const t1: Pt = [p1[0] + u1[0] * d, p1[1] + u1[1] * d];
    const t2: Pt = [p1[0] + u2[0] * d, p1[1] + u2[1] * d];
    let bis: Pt = [u1[0] + u2[0], u1[1] + u2[1]];
    const bl = Math.hypot(...bis);
    if (bl < 1e-9) { out.push(p1); continue; }
    bis = [bis[0] / bl, bis[1] / bl];
    const cd = r / Math.sin(interior / 2);
    const c: Pt = [p1[0] + bis[0] * cd, p1[1] + bis[1] * cd];
    const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    const a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const n = Math.max(2, Math.floor((Math.abs(da) * r) / step) + 1);
    out.push(t1);
    for (let k = 1; k < n; k++) {
      const a = a1 + (da * k) / n;
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    out.push(t2);
  }
  out.push(pts[pts.length - 1]);
  return dedupe(out);
}
