"""Taxi-graph construction from OSM centrelines (taxiways, taxilanes, runways).

Topology rules (documented in docs/DATA_SOURCES.md):
  * a node at every OSM node shared by two graph ways, at every way end, and at every
    geometric crossing of two graph lines (taxiways never cross without a junction);
  * dangling way ends within SNAP m (3 m) of another line are snapped onto it;
  * remaining dangling ends of taxiways that stop just short of another line are extended
    along their own direction (<= EXTEND m, <= EXTEND_RWY m when the target is a runway
    centreline), because many OSM taxiways stop at the runway edge instead of the centreline;
  * nodes closer than SNAP m are merged;
  * small disconnected fragments are bridged to the main component when the gap is
    <= BRIDGE m (edge marked source=derived) and dropped otherwise.
Polylines are nose-gear tracks (= the painted centrelines).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import networkx as nx
from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import nearest_points
from shapely.strtree import STRtree

SNAP = 3.0
EXTEND = 25.0
EXTEND_RWY = 45.0
BRIDGE = 30.0


@dataclass
class Line:
    osm_id: int
    kind: str  # taxiway | taxilane | runway
    ref: str
    width: float
    pts: list  # [(x, y)]
    keys: list  # per-vertex node key
    tags: dict = field(default_factory=dict)


class UF:
    def __init__(self):
        self.p = {}

    def find(self, a):
        p = self.p
        p.setdefault(a, a)
        root = a
        while p[root] != root:
            root = p[root]
        while p[a] != root:
            p[a], a = root, p[a]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            # prefer OSM node keys as roots (stable positions)
            if ra[0] == "x" and rb[0] == "n":
                ra, rb = rb, ra
            self.p[rb] = ra
        return ra


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def polyline_length(pts):
    return sum(_dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def _points_of(geom):
    if geom.is_empty:
        return []
    t = geom.geom_type
    if t == "Point":
        return [(geom.x, geom.y)]
    if t in ("MultiPoint", "GeometryCollection", "MultiLineString"):
        out = []
        for g in geom.geoms:
            out.extend(_points_of(g))
        return out
    if t == "LineString":  # collinear overlap: use its end points
        c = list(geom.coords)
        return [c[0], c[-1]]
    return []


class GraphBuilder:
    def __init__(self, lines: list[Line], log=print):
        self.lines = lines
        self.log = log
        self.uf = UF()
        self.xcount = 0
        self.stats = {"crossings_added": 0, "endpoint_snaps": 0, "endpoint_extensions": 0,
                      "merged_nodes": 0, "bridges": 0, "dropped_fragments": 0,
                      "dropped_fragment_length_m": 0.0, "fixes": []}

    # ------------------------------------------------------------ vertex insertion
    def _newkey(self):
        self.xcount += 1
        return ("x", self.xcount)

    def _vertex_near(self, li, p, tol):
        best, bk = tol, None
        for q, k in zip(self.lines[li].pts, self.lines[li].keys):
            d = _dist(p, q)
            if d <= best:
                best, bk = d, k
        return bk

    def _insert(self, li, p, key):
        """insert point p into line li at the right segment, with node key."""
        ln = self.lines[li]
        pts = ln.pts
        best, bi = float("inf"), 0
        for i in range(len(pts) - 1):
            d = LineString([pts[i], pts[i + 1]]).distance(Point(p)) if pts[i] != pts[i + 1] else _dist(p, pts[i])
            if d < best:
                best, bi = d, i
        ln.pts.insert(bi + 1, tuple(p))
        ln.keys.insert(bi + 1, key)

    def _connect_at(self, li, lj, p, tol=0.75):
        ki = self._vertex_near(li, p, tol)
        kj = self._vertex_near(lj, p, tol)
        if ki is not None and kj is not None:
            self.uf.union(ki, kj)
        elif ki is not None:
            self._insert(lj, p, ki)
        elif kj is not None:
            self._insert(li, p, kj)
        else:
            k = self._newkey()
            self._insert(li, p, k)
            self._insert(lj, p, k)

    # ------------------------------------------------------------ steps
    def add_crossings(self):
        geoms = [LineString(l.pts) for l in self.lines]
        tree = STRtree(geoms)
        todo = []
        for i, gi in enumerate(geoms):
            for j in tree.query(gi):
                j = int(j)
                if j <= i:
                    continue
                if not gi.intersects(geoms[j]):
                    continue
                shared = set(self.lines[i].keys) & set(self.lines[j].keys)
                shared_pts = [q for q, k in zip(self.lines[i].pts, self.lines[i].keys) if k in shared]
                for p in _points_of(gi.intersection(geoms[j])):
                    if any(_dist(p, q) < 1.0 for q in shared_pts):
                        continue
                    todo.append((i, j, p))
        for i, j, p in todo:
            self._connect_at(i, j, p)
            self.stats["crossings_added"] += 1

    def _usage(self):
        use = {}
        for li, ln in enumerate(self.lines):
            for vi, k in enumerate(ln.keys):
                r = self.uf.find(k)
                use.setdefault(r, set()).add(li)
        return use

    def snap_dangling(self):
        use = self._usage()
        geoms = [LineString(l.pts) for l in self.lines]
        tree = STRtree(geoms)
        for li, ln in enumerate(self.lines):
            if ln.kind == "runway":
                continue
            for end in (0, -1):
                k = ln.keys[end]
                r = self.uf.find(k)
                if len(use.get(r, ())) > 1:
                    continue  # already connected
                if ln.pts[0] == ln.pts[-1]:
                    continue
                p = ln.pts[end]
                P = Point(p)
                # 1) snap to the nearest other line within SNAP
                best, bj = SNAP, None
                for j in tree.query(P.buffer(SNAP)):
                    j = int(j)
                    if j == li:
                        continue
                    d = geoms[j].distance(P)
                    if d <= best:
                        best, bj = d, j
                if bj is not None:
                    kj = self._vertex_near(bj, p, SNAP)
                    if kj is not None:
                        self.uf.union(kj, k)
                    else:
                        q = nearest_points(geoms[bj], P)[0]
                        self._insert(bj, (q.x, q.y), k)
                    use.setdefault(self.uf.find(k), set()).update({li, bj})
                    self.stats["endpoint_snaps"] += 1
                    continue
                # 2) extend along the end direction
                prev = ln.pts[1] if end == 0 else ln.pts[-2]
                d = _dist(p, prev)
                if d < 0.5:
                    continue
                ux, uy = (p[0] - prev[0]) / d, (p[1] - prev[1]) / d
                ray = LineString([p, (p[0] + ux * EXTEND_RWY, p[1] + uy * EXTEND_RWY)])
                hit, hj, hd = None, None, float("inf")
                for j in tree.query(ray):
                    j = int(j)
                    if j == li:
                        continue
                    inter = ray.intersection(geoms[j])
                    for q in _points_of(inter):
                        dq = _dist(p, q)
                        lim = EXTEND_RWY if self.lines[j].kind == "runway" else EXTEND
                        if 0.01 < dq <= lim and dq < hd:
                            hit, hj, hd = q, j, dq
                if hit is not None:
                    kj = self._vertex_near(hj, hit, 0.75)
                    if kj is None:
                        kj = self._newkey()
                        self._insert(hj, hit, kj)
                    if end == 0:
                        ln.pts.insert(0, tuple(hit))
                        ln.keys.insert(0, kj)
                    else:
                        ln.pts.append(tuple(hit))
                        ln.keys.append(kj)
                    use.setdefault(self.uf.find(kj), set()).update({li, hj})
                    self.stats["endpoint_extensions"] += 1
                    self.stats["fixes"].append(
                        f"extended {ln.kind} osm:way/{ln.osm_id} ({ln.ref or 'no ref'}) by {hd:.1f} m to "
                        f"{self.lines[hj].kind} osm:way/{self.lines[hj].osm_id} ({self.lines[hj].ref or 'no ref'})")

    def split(self):
        """returns nodes {root_key: (x, y)}, edges [dict]"""
        count = {}
        for li, ln in enumerate(self.lines):
            seen_in_line = set()
            for vi, k in enumerate(ln.keys):
                r = self.uf.find(k)
                count.setdefault(r, set()).add(li)
                if r in seen_in_line and not (vi == len(ln.keys) - 1 and ln.pts[0] == ln.pts[-1]):
                    count[r].add(("self", li))
                seen_in_line.add(r)
        pos_acc = {}
        edges = []
        for li, ln in enumerate(self.lines):
            n = len(ln.pts)
            cut = [0]
            for vi in range(1, n - 1):
                r = self.uf.find(ln.keys[vi])
                if len(count[r]) > 1:
                    cut.append(vi)
            cut.append(n - 1)
            for a, b in zip(cut[:-1], cut[1:]):
                pts = ln.pts[a:b + 1]
                if len(pts) < 2:
                    continue
                ka, kb = self.uf.find(ln.keys[a]), self.uf.find(ln.keys[b])
                edges.append({"a": ka, "b": kb, "kind": ln.kind, "ref": ln.ref, "pts": list(pts),
                              "way": ln.osm_id, "width": ln.width, "source": "osm"})
            for vi in (cut):
                r = self.uf.find(ln.keys[vi])
                pos_acc.setdefault(r, []).append(ln.pts[vi])
        nodes = {k: (sum(p[0] for p in v) / len(v), sum(p[1] for p in v) / len(v)) for k, v in pos_acc.items()}
        return nodes, edges


class TaxiGraph:
    """Mutable graph with integer node ids."""

    def __init__(self):
        self.nodes: dict[int, tuple[float, float]] = {}
        self.edges: list[dict] = []
        self._next = 0

    # ------------------------------------------------------------ basics
    def add_node(self, x, y):
        nid = self._next
        self._next += 1
        self.nodes[nid] = (float(x), float(y))
        return nid

    def add_edge(self, a, b, kind, ref, pts, **extra):
        pts = [tuple(p) for p in pts]
        pts[0] = self.nodes[a]
        pts[-1] = self.nodes[b]
        e = {"a": a, "b": b, "kind": kind, "ref": ref, "pts": pts}
        e.update(extra)
        self.edges.append(e)
        return e

    @classmethod
    def from_builder(cls, nodes, edges, merge_tol=SNAP, log=print, stats=None):
        g = cls()
        # cluster node positions within merge_tol (grid hashing + union find)
        keys = list(nodes)
        uf = UF()
        cell = {}
        for k in keys:
            x, y = nodes[k]
            cell.setdefault((int(x // merge_tol), int(y // merge_tol)), []).append(k)
        merged = 0
        for k in keys:
            x, y = nodes[k]
            cx, cy = int(x // merge_tol), int(y // merge_tol)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for k2 in cell.get((cx + dx, cy + dy), ()):
                        if k2 != k and _dist(nodes[k], nodes[k2]) <= merge_tol:
                            if uf.find(k) != uf.find(k2):
                                uf.union(k, k2)
                                merged += 1
        groups = {}
        for k in keys:
            groups.setdefault(uf.find(k), []).append(k)
        idmap = {}
        for root in sorted(groups, key=lambda r: (round(nodes[r][0], 1), round(nodes[r][1], 1))):
            mem = groups[root]
            x = sum(nodes[m][0] for m in mem) / len(mem)
            y = sum(nodes[m][1] for m in mem) / len(mem)
            nid = g.add_node(x, y)
            for m in mem:
                idmap[m] = nid
        seen = {}
        for e in edges:
            a, b = idmap[e["a"]], idmap[e["b"]]
            pts = list(e["pts"])
            length = polyline_length(pts)
            if a == b:
                if length < 15.0:
                    continue
                # closed loop: split at the vertex farthest from the node
                far = max(range(len(pts)), key=lambda i: _dist(pts[i], g.nodes[a]))
                if far in (0, len(pts) - 1):
                    continue
                m = g.add_node(*pts[far])
                for sub, (u, v) in ((pts[:far + 1], (a, m)), (pts[far:], (m, b))):
                    g.add_edge(u, v, e["kind"], e["ref"], sub, way=e["way"], width=e["width"], source=e["source"])
                continue
            key = (min(a, b), max(a, b), e["kind"])
            if key in seen and abs(seen[key] - length) < 2.0:
                continue  # duplicate
            seen[key] = length
            g.add_edge(a, b, e["kind"], e["ref"], pts, way=e["way"], width=e["width"], source=e["source"])
        if stats is not None:
            stats["merged_nodes"] = merged
        g.drop_unused_nodes()
        return g

    def drop_unused_nodes(self):
        used = {e["a"] for e in self.edges} | {e["b"] for e in self.edges}
        for n in list(self.nodes):
            if n not in used:
                del self.nodes[n]

    def nx(self, kinds=None):
        G = nx.Graph()
        for n, p in self.nodes.items():
            G.add_node(n)
        for i, e in enumerate(self.edges):
            if kinds and e["kind"] not in kinds:
                continue
            L = polyline_length(e["pts"])
            if G.has_edge(e["a"], e["b"]) and G[e["a"]][e["b"]]["length"] <= L:
                continue
            G.add_edge(e["a"], e["b"], length=L, idx=i)
        return G

    def degree(self):
        d = {n: 0 for n in self.nodes}
        for e in self.edges:
            d[e["a"]] += 1
            d[e["b"]] += 1
        return d

    # ------------------------------------------------------------ splitting
    def split_edge_at(self, ei, positions, tol=2.0):
        """Split edge ei at along-distances `positions` (metres from its 'a' end).
        Returns {position: node_id}.  Positions within tol of an end or of each other
        share a node.  The original edge is replaced in-place (index ei keeps the first part)."""
        e = self.edges[ei]
        line = LineString(e["pts"])
        L = line.length
        res = {}
        cuts = []
        for s in sorted(set(positions)):
            if s <= tol:
                res[s] = e["a"]
            elif s >= L - tol:
                res[s] = e["b"]
            elif cuts and s - cuts[-1][0] <= tol:
                res[s] = cuts[-1][1]
            else:
                p = line.interpolate(s)
                nid = self.add_node(p.x, p.y)
                cuts.append((s, nid))
                res[s] = nid
        if not cuts:
            return res
        # build sub-polylines
        pts = e["pts"]
        cum = [0.0]
        for i in range(len(pts) - 1):
            cum.append(cum[-1] + _dist(pts[i], pts[i + 1]))
        bounds = [(0.0, e["a"])] + cuts + [(L, e["b"])]
        new_edges = []
        for (s0, n0), (s1, n1) in zip(bounds[:-1], bounds[1:]):
            sub = [self.nodes[n0]] + [pts[i] for i in range(len(pts)) if s0 + 1e-6 < cum[i] < s1 - 1e-6] + [self.nodes[n1]]
            ne = dict(e)
            ne["a"], ne["b"], ne["pts"] = n0, n1, sub
            new_edges.append(ne)
        self.edges[ei] = new_edges[0]
        self.edges.extend(new_edges[1:])
        return res

    def edge_tree(self, kinds=None):
        idx = [i for i, e in enumerate(self.edges) if kinds is None or e["kind"] in kinds]
        geoms = [LineString(self.edges[i]["pts"]) for i in idx]
        return STRtree(geoms), idx, geoms


def bridge_fragments(g: TaxiGraph, log=print, stats=None, max_gap=BRIDGE, min_keep=60.0):
    """Connect small components to the main one (gap <= max_gap) or drop them."""
    G = g.nx()
    comps = sorted(nx.connected_components(G), key=lambda c: -sum(
        G[u][v]["length"] for u, v in G.subgraph(c).edges()))
    if not comps:
        return
    # main = component with the most runway length, else largest
    def rwy_len(c):
        return sum(polyline_length(g.edges[G[u][v]["idx"]]["pts"]) for u, v in G.subgraph(c).edges()
                   if g.edges[G[u][v]["idx"]]["kind"] == "runway")
    main = max(comps, key=lambda c: (rwy_len(c), len(c)))
    changed = True
    while changed:
        changed = False
        G = g.nx()
        comps = list(nx.connected_components(G))
        main = max(comps, key=lambda c: (rwy_len_g(g, G, c), len(c)))
        main_idx = [i for i, e in enumerate(g.edges) if e["a"] in main]
        main_geom = MultiLineString([g.edges[i]["pts"] for i in main_idx])
        tree = STRtree([LineString(g.edges[i]["pts"]) for i in main_idx])
        for c in comps:
            if c is main or c == main:
                continue
            cidx = [i for i, e in enumerate(g.edges) if e["a"] in c]
            if not cidx:
                continue
            cgeom = MultiLineString([g.edges[i]["pts"] for i in cidx])
            p, q = nearest_points(cgeom, main_geom)
            gap = p.distance(q)
            if gap <= max_gap:
                # split the two closest edges and add a bridge edge
                ci = min(cidx, key=lambda i: LineString(g.edges[i]["pts"]).distance(p))
                mi_local = int(tree.nearest(q))
                mi = main_idx[mi_local]
                sp = LineString(g.edges[ci]["pts"]).project(p)
                sq = LineString(g.edges[mi]["pts"]).project(q)
                na = g.split_edge_at(ci, [sp])[sp]
                nb = g.split_edge_at(mi, [sq])[sq]
                if na != nb:
                    kind = "taxilane"
                    g.add_edge(na, nb, kind, "", [g.nodes[na], g.nodes[nb]], way=None, width=15.0, source="derived")
                if stats is not None:
                    stats["bridges"] += 1
                    stats["fixes"].append(f"bridged fragment ({len(c)} nodes) to main graph across {gap:.1f} m gap")
                changed = True
                break
            else:
                L = sum(polyline_length(g.edges[i]["pts"]) for i in cidx)
                if stats is not None:
                    stats["dropped_fragments"] += 1
                    stats["dropped_fragment_length_m"] += L
                    refs = sorted({g.edges[i]["ref"] for i in cidx if g.edges[i]["ref"]})
                    cx, cy = cgeom.centroid.x, cgeom.centroid.y
                    stats["fixes"].append(f"dropped fragment: {len(c)} nodes, {L:.0f} m, refs {refs[:6]}, "
                                          f"gap {gap:.0f} m, around x={cx:.0f} y={cy:.0f}")
                for i in sorted(cidx, reverse=True):
                    g.edges.pop(i)
                g.drop_unused_nodes()
                changed = True
                break


def rwy_len_g(g, G, c):
    s = 0.0
    for u, v in G.subgraph(c).edges():
        e = g.edges[G[u][v]["idx"]]
        if e["kind"] == "runway":
            s += polyline_length(e["pts"])
    return s
