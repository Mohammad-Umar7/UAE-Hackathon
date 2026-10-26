"""Aircraft stand derivation from OSM aeroway=parking_position data (+ synthetic stands).

OSM evidence is messy: a stand can be a node, a lead-in way, several lead-in ways (one per
approach direction / aircraft type) chained together, or a node plus ways; refs are reused
for MARS sub-stands (B18L/B18R) and by mistake in different apron areas.  The rules:

  * parking_position ways that share an OSM node (or end within 2 m) and have the same ref
    (or one has none) form one lead-in network; a parking_position node joins the network
    it lies on (<= 3 m) with the same/no ref; other nodes are stand-alone stands;
  * the stop point (nose-gear position) is the network end farthest from the taxi network
    (the lead-in starts on a taxiway centreline), or the node if it lies on the last 45 m
    of the lead-in;
  * heading = direction of the last ~15 m of the lead-in; for stand-alone nodes: nose
    towards the nearest terminal/concourse facade if it is within 80 m, else away from the
    nearest taxi line (aircraft enter from the taxilane);
  * groups with the same ref farther than 150 m apart are different stands (suffix -2 ...).
"""
from __future__ import annotations

import math
import re

import networkx as nx
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import nearest_points
from shapely.strtree import STRtree

SIZE_LIMITS = [("A", 15.0), ("B", 24.0), ("C", 36.0), ("D", 52.0), ("E", 65.0), ("F", 80.0)]
CLEARANCE = 7.5
MAX_SPAN = 80.0
CONTACT_DIST = 70.0


def size_code(span: float) -> str:
    for code, lim in SIZE_LIMITS:
        if code == "F":
            return "F"
        if span < lim:
            return code
    return "F"


def unit(dx, dy):
    L = math.hypot(dx, dy)
    return (dx / L, dy / L) if L > 1e-9 else (0.0, 1.0)


def heading_of(dx, dy) -> float:
    """compass heading (deg, clockwise from north) of vector (dx east, dy north)."""
    return (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0


def hvec(h):
    r = math.radians(h)
    return (math.sin(r), math.cos(r))


def angle_between(h1, h2):
    d = abs((h1 - h2 + 180.0) % 360.0 - 180.0)
    return d


def base_ref(ref: str | None):
    if not ref:
        return None
    m = re.match(r"^(.*?\d+)([A-Z])$", ref.strip().upper())
    return m.group(1) if m else ref.strip().upper()


def mars_alternatives(r1, r2) -> bool:
    """True if r1, r2 are mutually exclusive MARS variants (B18 vs B18L/B18R, 605C vs 605L)."""
    if not r1 or not r2:
        return False
    a, b = r1.strip().upper(), r2.strip().upper()
    ba, bb = base_ref(a), base_ref(b)
    if ba != bb:
        return False
    sa, sb = a[len(ba):], b[len(bb):]
    # centre (no suffix or C) versus side (L/R) are alternatives; L versus R are neighbours
    return {sa, sb} != {"L", "R"} and sa != sb


class _UF:
    def __init__(self):
        self.p = {}

    def find(self, a):
        self.p.setdefault(a, a)
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def derive_osm_stands(pp_ways, pp_nodes, taxi_lines, log=print, terminals=None):
    """pp_ways: [{id, ref, pts:[(x,y)], nodes:[osm ids]}], pp_nodes: [{id, ref, x, y}],
    taxi_lines: list of shapely LineStrings (OSM taxiway/taxilane centrelines).
    Returns list of stand dicts with x, y, heading(or None), lead_in(or None), ref, source."""
    tl_tree = STRtree(taxi_lines)
    tb_tree = STRtree(terminals) if terminals else None

    def d_bld(p):
        if tb_tree is None:
            return 1e9
        P = Point(p)
        return terminals[int(tb_tree.nearest(P))].distance(P)

    def d_taxi(p):
        P = Point(p)
        i = tl_tree.nearest(P)
        return taxi_lines[int(i)].distance(P)

    # 0) lines drawn straight across a taxilane mark the stand centrelines on both sides:
    #    split every parking_position way where it crosses/touches a taxi line in its
    #    interior; pieces between two crossings are dropped
    pieces = []
    n_split = 0
    for w in pp_ways:
        L = LineString(w["pts"])
        cuts = []
        for k in tl_tree.query(L):
            inter = L.intersection(taxi_lines[int(k)])
            for p in _points(inter):
                s = L.project(Point(p))
                if 12.0 < s < L.length - 12.0:
                    cuts.append(s)
        cuts = sorted(cuts)
        merged = []
        for c in cuts:
            if not merged or c - merged[-1] > 5.0:
                merged.append(c)
        if not merged:
            w = dict(w)
            w.setdefault("osm_id", w["id"])
            pieces.append(w)
            continue
        n_split += 1
        cum = [0.0]
        for a, b in zip(w["pts"][:-1], w["pts"][1:]):
            cum.append(cum[-1] + math.dist(a, b))
        bounds = [0.0] + merged + [L.length]
        for i, (a, b) in enumerate(zip(bounds[:-1], bounds[1:])):
            cut_a, cut_b = a in merged, b in merged
            if (cut_a and cut_b) or b - a < 10.0:
                continue
            pa, pb = L.interpolate(a), L.interpolate(b)
            if d_taxi((pa.x, pa.y)) <= 8.0 and d_taxi((pb.x, pb.y)) <= 8.0:
                continue  # piece runs between two taxi lines: no stand on it
            inner = [(p, n) for p, n, c in zip(w["pts"], w["nodes"], cum) if a + 0.01 < c < b - 0.01]
            pts = [(pa.x, pa.y)] + [p for p, _ in inner] + [(pb.x, pb.y)]
            na = -(w["id"] * 100 + 2 * i) if cut_a else w["nodes"][0]
            nb = -(w["id"] * 100 + 2 * i + 1) if cut_b else w["nodes"][-1]
            nodes = [na] + [n for _, n in inner] + [nb]
            pieces.append({"id": f"{w['id']}.{i}", "osm_id": w["id"], "ref": w["ref"], "pts": pts, "nodes": nodes})
    if n_split:
        log(f"  parking_position ways split where they cross a taxi line: {n_split}")
    pp_ways = pieces

    # 1) group ways
    uf = _UF()
    for w in pp_ways:
        uf.find(w["id"])
    by_node = {}
    node_xy = {}
    for w in pp_ways:
        for n, p in zip(w["nodes"], w["pts"]):
            by_node.setdefault(n, []).append(w)
            node_xy[n] = p
    for n, ws in by_node.items():
        # lead-ins of different stands often start from the same taxiway node: a shared
        # node lying on a taxi line only joins ways that carry the same ref
        on_taxi = d_taxi(node_xy[n]) < 3.0
        for i in range(len(ws)):
            for j in range(i + 1, len(ws)):
                a, b = ws[i], ws[j]
                if a["ref"] and b["ref"] and a["ref"] != b["ref"]:
                    continue
                if on_taxi and not (a["ref"] and a["ref"] == b["ref"]):
                    continue
                uf.union(a["id"], b["id"])
    groups = {}
    for w in pp_ways:
        groups.setdefault(uf.find(w["id"]), []).append(w)

    stands = []
    used_nodes = set()
    for gid, ws in groups.items():
        refs = sorted({w["ref"] for w in ws if w["ref"]})
        ref = refs[0] if refs else None
        # network graph of the group's polylines
        G = nx.Graph()
        for w in ws:
            pts = w["pts"]
            for k in range(len(pts) - 1):
                a, b = (round(pts[k][0], 2), round(pts[k][1], 2)), (round(pts[k + 1][0], 2), round(pts[k + 1][1], 2))
                if a != b:
                    G.add_edge(a, b, length=math.dist(a, b))
        if G.number_of_edges() == 0:
            continue
        ends = [n for n in G.nodes if G.degree(n) == 1] or list(G.nodes)
        dt = {e: d_taxi(e) for e in ends}
        near = [e for e in ends if dt[e] <= 8.0]
        far = [e for e in ends if dt[e] > 8.0]
        if near and far:
            stop = max(far, key=lambda e: dt[e])
        elif len(ends) == 2 and not near:
            # both ends off the (mapped) taxi network: a lead-in ending at a terminal facade is a
            # contact stand; otherwise the curved end is the entry and the straight end the stop
            db = {e: d_bld(e) for e in ends}
            e_near, e_far = sorted(ends, key=lambda e: db[e])
            if db[e_near] < 45.0 and db[e_far] > db[e_near] + 30.0:
                stop = e_near
            else:
                stop = min(ends, key=lambda e: _end_turn(G, e))
                if abs(_end_turn(G, ends[0]) - _end_turn(G, ends[1])) < 10.0:
                    stop = max(ends, key=lambda e: dt[e])
        else:
            stop = max(ends, key=lambda e: dt[e])
        others = [e for e in ends if e != stop]
        if not others:
            # the rest of the network is a loop (e.g. a turning circle drawn at the lead-in
            # start): enter from the network node closest to the taxi lines
            comp = [n for n in nx.node_connected_component(G, stop) if n != stop]
            others = [min(comp, key=lambda n: d_taxi(n))] if comp else []
        entry = min(others, key=lambda e: dt.get(e, d_taxi(e))) if others else None
        try:
            path = nx.shortest_path(G, entry, stop, weight="length") if entry and entry != stop else [stop]
        except nx.NetworkXNoPath:
            comp = nx.node_connected_component(G, stop)
            cand = [e for e in ends if e in comp and e != stop]
            entry = min(cand, key=lambda e: dt[e]) if cand else None
            path = nx.shortest_path(G, entry, stop, weight="length") if entry else [stop]
        lead = [tuple(p) for p in path]
        # node on this network with matching/no ref?
        node_used = None
        line = LineString(lead) if len(lead) >= 2 else None
        for nd in pp_nodes:
            if nd["id"] in used_nodes:
                continue
            if nd["ref"] and ref and nd["ref"] != ref:
                continue
            if line is not None and line.distance(Point(nd["x"], nd["y"])) <= 3.0:
                s = line.project(Point(nd["x"], nd["y"]))
                used_nodes.add(nd["id"])
                if line.length - s <= 45.0 and s > 5.0:
                    node_used = nd
                    # truncate lead-in at the node
                    cut = []
                    acc = 0.0
                    for k in range(len(lead)):
                        if k > 0:
                            acc += math.dist(lead[k - 1], lead[k])
                        if acc < s - 0.5:
                            cut.append(lead[k])
                    cut.append((nd["x"], nd["y"]))
                    lead = cut
                if not ref and nd["ref"]:
                    ref = nd["ref"]
        lead = _trim_lead(lead, d_taxi)
        sx, sy = lead[-1]
        heading = None
        if len(lead) >= 2:
            # direction over the last ~15 m
            acc, k = 0.0, len(lead) - 1
            while k > 0 and acc < 15.0:
                acc += math.dist(lead[k - 1], lead[k])
                k -= 1
            heading = heading_of(sx - lead[k][0], sy - lead[k][1])
        stands.append({"ref": ref, "x": sx, "y": sy, "heading": heading,
                       "lead_in": lead if len(lead) >= 2 else None,
                       "source": "osm:way/" + ",".join(sorted({str(w["osm_id"]) for w in ws})) +
                                 (f";node/{node_used['id']}" if node_used else ""),
                       "entry_dist_taxi": dt.get(entry) if entry else None})
    for nd in pp_nodes:
        if nd["id"] in used_nodes:
            continue
        # node at the start of / on a network with the same ref: already represented
        dup = False
        for s in stands:
            if s["lead_in"] and (not nd["ref"] or not s["ref"] or nd["ref"] == s["ref"]):
                if LineString(s["lead_in"]).distance(Point(nd["x"], nd["y"])) <= 3.0:
                    dup = True
                    break
        if dup:
            continue
        stands.append({"ref": nd["ref"], "x": nd["x"], "y": nd["y"], "heading": None, "lead_in": None,
                       "source": f"osm:node/{nd['id']}", "entry_dist_taxi": None})

    out = merge_duplicates(stands, log=log)
    log(f"  stands from OSM: {len(out)} ({sum(1 for s in out if s['lead_in'])} with lead-in lines, "
        f"{sum(1 for s in out if not s['ref'])} without ref)")
    return out


def _trim_lead(lead, d_taxi, tol=3.0, step=2.0):
    """cut the lead-in where it first (walking back from the stop point) comes within `tol`
    of a taxi line: OSM lead-ins often run along the taxilane from its start, the entry is
    where they leave it."""
    if len(lead) < 2:
        return lead
    L = LineString(lead)
    if d_taxi(lead[0]) > tol:
        return lead
    s = L.length - step
    cut = None
    while s > 0:
        p = L.interpolate(s)
        if d_taxi((p.x, p.y)) <= tol:
            cut = s
            break
        s -= step
    if cut is None or cut <= 0.5:
        return lead
    cum = [0.0]
    for a, b in zip(lead[:-1], lead[1:]):
        cum.append(cum[-1] + math.dist(a, b))
    p = L.interpolate(cut)
    out = [(p.x, p.y)] + [q for q, c in zip(lead, cum) if c > cut + 0.5]
    return out if len(out) >= 2 else lead


def _priority(s):
    return (s.get("origin", "osm") != "osm", s.get("ref") is None, s.get("lead_in") is None)


def merge_duplicates(stands, log=print, dup_dist=12.0, lr_dist=20.0):
    """merge stands that are the same physical position: stop points < 12 m apart with similar
    heading (alternative stop bars / lead-ins / node+way duplicates), and L/R stands of the same
    base ref < 20 m apart (DXB uses L/R for alternative lead-ins, not for MARS)."""
    out = []
    merged = 0
    for s in sorted(stands, key=_priority):
        hit = None
        for o in out:
            d = math.dist((s["x"], s["y"]), (o["x"], o["y"]))
            same_h = s["heading"] is None or o["heading"] is None or angle_between(s["heading"], o["heading"]) < 45
            if d < dup_dist and same_h:
                hit = o
                break
            r1, r2 = (s.get("ref") or "").upper(), (o.get("ref") or "").upper()
            if r1 and r2 and d < lr_dist and base_ref(r1) == base_ref(r2) and {r1[-1:], r2[-1:]} <= {"L", "R"} \
                    and r1 != r2:
                hit = o
                b = base_ref(r1)
                if not any((x.get("ref") or "").upper() == b for x in stands):
                    o.setdefault("alt_refs", []).append(o["ref"])
                    o["ref"] = b
                break
        if hit is None:
            out.append(s)
        else:
            merged += 1
            if s.get("ref") and s["ref"] != hit.get("ref"):
                hit.setdefault("alt_refs", []).append(s["ref"])
            hit["source"] = hit["source"] + "+" + s["source"].replace("osm:", "")
    if merged:
        log(f"  merged {merged} duplicate / alternative stand positions")
    return out


def compute_conflicts(stands, near=25.0):
    """stands that cannot be occupied at the same time: MARS centre vs its L/R positions and
    any two stop points closer than `near` m."""
    for s in stands:
        s["conflicts"] = []
    for i, a in enumerate(stands):
        for b in stands[i + 1:]:
            d = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
            if d > 120:
                continue
            if d < near or (mars_alternatives(a.get("ref"), b.get("ref")) and d < 90):
                a["conflicts"].append(b["id"])
                b["conflicts"].append(a["id"])
    for s in stands:
        s["conflicts"] = sorted(set(s["conflicts"]), key=lambda x: [int(t) if t.isdigit() else t
                                                                    for t in re.split(r"(\d+)", x)])
    return stands


def _points(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Point":
        return [(geom.x, geom.y)]
    if geom.geom_type == "LineString":
        c = list(geom.coords)
        return [c[0], c[-1]]
    out = []
    for g in getattr(geom, "geoms", []):
        out.extend(_points(g))
    return out


def _end_turn(G, end, span=40.0):
    """total absolute turning angle (deg) along the first `span` metres from a network end."""
    path = [end]
    prev = None
    cur = end
    acc = 0.0
    while acc < span:
        nb = [n for n in G.neighbors(cur) if n != prev]
        if len(nb) != 1 and cur != end:
            break
        if not nb:
            break
        nxt = nb[0]
        acc += math.dist(cur, nxt)
        prev, cur = cur, nxt
        path.append(cur)
    turn = 0.0
    for a, b, c in zip(path, path[1:], path[2:]):
        h1 = heading_of(b[0] - a[0], b[1] - a[1])
        h2 = heading_of(c[0] - b[0], c[1] - b[1])
        turn += angle_between(h1, h2)
    return turn


def assign_ids(stands, prefix="P"):
    """unique ids: the OSM ref; ref-2.. for far duplicates; for unnamed contact stands the
    nearest OSM gate ref (if unique); otherwise P01.. (S01.. at OMSJ)."""
    seen = {}
    for s in stands:
        if not s.get("ref"):
            continue
        r = s["ref"].strip()
        s["ref"] = r
        if r in seen:
            seen[r] += 1
            s["id"] = f"{r}-{seen[r]}"
        else:
            seen[r] = 1
            s["id"] = r
    noref = [s for s in stands if not s.get("ref")]
    gate_count = {}
    for s in noref:
        if s.get("gate") and re.match(r"^[A-Z]?\d{1,3}[A-Z]?$", s["gate"]):
            gate_count[s["gate"]] = gate_count.get(s["gate"], 0) + 1
    for s in noref:
        g = s.get("gate")
        if g and gate_count.get(g) == 1 and g not in seen:
            s["id"] = g
            s["id_source"] = "gate"
            seen[g] = 1
    rest = [s for s in noref if "id_source" not in s]
    rest.sort(key=lambda s: (round(s["x"] / 50), s["y"]))
    width = 2 if len(rest) < 100 else 3
    k = 0
    for s in rest:
        k += 1
        while f"{prefix}{k:0{width}d}" in seen:
            k += 1
        s["id"] = f"{prefix}{k:0{width}d}"
        s["ref"] = None
    return stands


def wingspans(stands, aprons=None, buildings=None):
    """max_wingspan_m from lateral spacing to neighbouring stands minus clearance (cap 80);
    also limited by the lateral room to buildings (wing reference point ~ 20 m aft of the
    nose gear)."""
    pts = []
    for s in stands:
        hx, hy = hvec(s["heading"])
        pts.append((s["x"] - hx * 20.0, s["y"] - hy * 20.0, hx, hy))
    bgeoms = [b for b in (buildings or [])]
    btree = STRtree(bgeoms) if bgeoms else None
    for i, s in enumerate(stands):
        px, py, hx, hy = pts[i]
        nx_, ny_ = hy, -hx  # right-hand normal
        best = MAX_SPAN + CLEARANCE
        for j, o in enumerate(stands):
            if i == j:
                continue
            qx, qy = pts[j][0], pts[j][1]
            dx, dy = qx - px, qy - py
            if abs(dx) > 150 or abs(dy) > 150:
                continue
            if mars_alternatives(s.get("ref"), o.get("ref")) or o["id"] in s.get("conflicts", ()):
                continue
            lon = abs(dx * hx + dy * hy)
            lat = abs(dx * nx_ + dy * ny_)
            if lon < 45.0:  # wings overlap longitudinally -> lateral spacing limits the span
                best = min(best, lat)
            elif math.hypot(dx, dy) < best:  # staggered neighbours: use the plain distance
                pass
        span = best - CLEARANCE
        # lateral room to buildings: wing tips must clear buildings by the clearance
        if btree is not None:
            for side in (1, -1):
                ray = LineString([(px, py), (px + side * nx_ * 60, py + side * ny_ * 60)])
                for k in btree.query(ray):
                    g = bgeoms[int(k)]
                    if g.intersects(ray):
                        d = Point(px, py).distance(g.intersection(ray))
                        span = min(span, 2 * (d - CLEARANCE))
        span = max(12.0, min(MAX_SPAN, span))
        s["max_wingspan_m"] = round(span, 1)
        s["size_code"] = size_code(s["max_wingspan_m"])
    return stands
