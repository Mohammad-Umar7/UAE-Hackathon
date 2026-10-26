"""Build data/airports/<ICAO>/layout.json (+ debug_layout.png, debug_graph_check.txt) from
the cached OSM extracts written by fetch_osm.py.  Offline and deterministic.

  uv run --project pipeline python pipeline/osm/build_layout.py [OMAA OMDB OMSJ] [--no-plot]

Contract: docs/CONVENTIONS.md section 4.  Heuristics and their provenance labels are
documented in docs/DATA_SOURCES.md.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import networkx as nx  # noqa: E402
from pyproj import Geod  # noqa: E402
from shapely import make_valid  # noqa: E402
from shapely.geometry import LineString, MultiLineString, Point, Polygon  # noqa: E402
from shapely.ops import nearest_points, substring, unary_union  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

import config  # noqa: E402
import stands as stmod  # noqa: E402
from osmutil import Projector, coast_faces, element_polygons, load_raw, parse_height, parse_width  # noqa: E402
from taxigraph import GraphBuilder, Line, TaxiGraph, bridge_fragments, polyline_length  # noqa: E402

GEOD = Geod(ellps="WGS84")
CONTEXT_RADIUS = 3000.0
LICENSE = "ODbL 1.0 © OpenStreetMap contributors"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ============================================================================ helpers

def name_of(tags):
    return tags.get("name:en") or tags.get("name") or ""


def polys_of(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if g.geom_type in ("MultiPolygon", "GeometryCollection"):
        out = []
        for x in g.geoms:
            out.extend(polys_of(x))
        return out
    return []


def el_polys(el, proj):
    res = []
    for outer, holes in element_polygons(el):
        try:
            P = Polygon(proj.xy(outer), [proj.xy(h) for h in holes if len(h) >= 4])
        except Exception:
            continue
        if not P.is_valid:
            P = make_valid(P)
        res.extend(p for p in polys_of(P) if p.area > 0.5)
    return res


def is_closed(el):
    g = el.get("geometry") or []
    return el["type"] == "way" and len(g) >= 4 and g[0] == g[-1]


def lifecycle_dead(tags):
    return any(k in tags for k in ("disused", "abandoned", "construction", "proposed", "demolished")) or \
        tags.get("aeroway") in ("construction",) or tags.get("disused") == "yes"


def r1(v):
    return round(float(v), 1)


def pts_out(pts):
    return [[r1(x), r1(y)] for x, y in pts]


def ring_out(poly: Polygon, simplify=0.0):
    if simplify > 0:
        poly = poly.simplify(simplify, preserve_topology=True)
    ext = list(poly.exterior.coords)[:-1]
    holes = [list(h.coords)[:-1] for h in poly.interiors]
    return pts_out(ext), [pts_out(h) for h in holes if len(h) >= 3]


def ccw(poly: Polygon) -> Polygon:
    from shapely.geometry.polygon import orient

    return orient(poly, sign=1.0)


def norm_rwy_ref(ref):
    if not ref:
        return None
    r = ref.upper().replace(" ", "").replace("-", "/")
    if not re.match(r"^\d{2}[LRC]?/\d{2}[LRC]?$", r):
        return None
    return r


def lonlat_dist(a, b):
    return GEOD.inv(a[0], a[1], b[0], b[1])[2]


# ============================================================================ classification

DEFAULT_H = {"terminal": 28.0, "concourse": 22.0, "hangar": 26.0, "cargo": 15.0, "tower": 45.0,
             "fire_station": 9.0, "car_park": 14.0, "other": 8.0}


def building_kind(tags, name):
    n = name.lower()
    aw = tags.get("aeroway", "")
    b = tags.get("building", "") or tags.get("building:part", "")
    if b in ("parking", "carport") or tags.get("amenity") == "parking" or             tags.get("parking") in ("multi-storey", "multistorey") or             re.search(r"(short|long)[- ]term park|car ?park|parking", n):
        return "car_park"
    if b in ("mosque", "church", "temple") or tags.get("amenity") == "place_of_worship" or             re.search(r"(masjid|mosque)", n):
        return "other"
    if aw in ("tower", "control_tower") or b in ("control_tower", "tower") or "control tower" in n or \
            (tags.get("man_made") == "tower" and (aw or "control" in n or tags.get("tower:type") in
                                                    ("observation", "communication", "airport_control"))):
        return "tower"
    if tags.get("amenity") == "fire_station" or b == "fire_station" or "fire station" in n:
        return "fire_station"
    if "concourse" in n or re.search(r"\bpier\b", n):
        return "concourse"
    if any(w in n for w in ("cargo", "freight", "logistic", "skycargo", "mail", "courier", "dhl", "fedex",
                            "aramex", "ups ")) or b == "warehouse":
        return "cargo"
    if aw == "terminal" or b in ("terminal",) or "terminal" in n:
        return "terminal"
    if aw == "hangar" or b == "hangar" or "hangar" in n or "maintenance" in n or "mro" in n.split() \
            or "engineering" in n:
        return "hangar"
    if b in ("parking", "carport") or tags.get("amenity") == "parking" or tags.get("parking") in \
            ("multi-storey", "multistorey") or "car park" in n or "parking" in n:
        return "car_park"
    return "other"


def height_of(tags, kind, area, tower_h=None):
    h = parse_height(tags.get("height"))
    if h is not None and h > 0:
        return h, "osm:height"
    lv = parse_height(tags.get("building:levels"))
    if lv is not None and lv > 0:
        return lv * 3.5 + (2.0 if kind in ("terminal", "concourse") else 0.0), "osm:levels"
    if kind == "tower" and tower_h and "old" not in (tags.get("name:en") or tags.get("name") or "").lower():
        return tower_h, "reference"
    if kind == "tower":
        return 35.0, "default"
    if tags.get("building") == "carport":
        return 3.0, "default"
    if kind == "other":
        return (5.0 if area < 150 else 7.0 if area < 1000 else 10.0 if area < 5000 else 14.0), "default"
    return DEFAULT_H[kind], "default"


CTX_DEFAULT = {"house": 7.0, "detached": 7.0, "villa": 8.0, "residential": 12.0, "apartments": 24.0,
               "commercial": 16.0, "office": 24.0, "retail": 8.0, "industrial": 9.0, "warehouse": 10.0,
               "mosque": 12.0, "school": 10.0, "hospital": 18.0, "hotel": 30.0, "garage": 3.5,
               "garages": 3.5, "roof": 4.0, "carport": 3.0, "shed": 3.0, "construction": 6.0,
               "service": 4.0, "hut": 3.0, "kiosk": 3.0}


def ctx_height(tags, area):
    h = parse_height(tags.get("height"))
    if h is not None and h > 0:
        return h
    lv = parse_height(tags.get("building:levels"))
    if lv is not None and lv > 0:
        return lv * 3.5
    b = tags.get("building") or tags.get("building:part") or "yes"
    if b in CTX_DEFAULT:
        return CTX_DEFAULT[b]
    return 5.0 if area < 120 else 7.0 if area < 400 else 10.0 if area < 1500 else 14.0 if area < 6000 else 18.0


LANDUSE_KIND = [
    (("natural", "water"), "water"), (("water", None), "water"), (("waterway", "riverbank"), "water"),
    (("landuse", "reservoir"), "water"), (("landuse", "basin"), "water"), (("leisure", "marina"), "water"),
    (("natural", "wetland"), "landscaping"), (("landuse", "grass"), "grass"), (("natural", "grassland"), "grass"),
    (("landuse", "meadow"), "grass"), (("landuse", "village_green"), "grass"), (("leisure", "pitch"), "grass"),
    (("golf", "fairway"), "grass"), (("leisure", "golf_course"), "landscaping"), (("leisure", "park"), "landscaping"),
    (("leisure", "garden"), "landscaping"), (("landuse", "recreation_ground"), "landscaping"),
    (("natural", "wood"), "landscaping"), (("landuse", "forest"), "landscaping"), (("landuse", "orchard"), "landscaping"),
    (("landuse", "farmland"), "landscaping"), (("landuse", "plant_nursery"), "landscaping"),
    (("natural", "tree_row"), "landscaping"), (("natural", "sand"), "sand"), (("natural", "beach"), "sand"),
    (("natural", "scrub"), "sand"), (("natural", "bare_rock"), "sand"), (("landuse", "brownfield"), "sand"),
    (("landuse", "greenfield"), "sand"), (("natural", "desert"), "sand"), (("amenity", "parking"), "parking"),
]


def landuse_kind(tags):
    if "building" in tags:
        return None
    for (k, v), kind in LANDUSE_KIND:
        if k in tags and (v is None or tags[k] == v):
            if k == "water" and tags.get("natural") not in (None, "water"):
                continue
            return kind
    return None


ROAD_W = {"motorway": 11.0, "trunk": 10.5, "primary": 9.0, "secondary": 7.5, "tertiary": 7.0,
          "unclassified": 6.0, "residential": 6.0, "service": 4.5, "living_street": 5.0, "road": 6.0,
          "pedestrian": 5.0, "motorway_link": 5.5, "trunk_link": 5.5, "primary_link": 5.5,
          "secondary_link": 5.0, "tertiary_link": 5.0, "busway": 4.0, "rail": 9.0, "airside_service": 6.0}
ROAD_OK = set(ROAD_W) - {"rail", "airside_service"}


# ============================================================================ main build

class Airport:
    def __init__(self, icao):
        self.icao = icao
        self.cfg = config.AIRPORTS[icao]
        self.dir = config.airport_dir(icao)
        self.proj = Projector(config.projection_string(icao))
        self.notes = []
        self.check = []  # lines for debug_graph_check.txt
        ref = load_raw(config.REFERENCE_DIR / "airports.json")
        self.ref = ref["airports"].get(icao, {})

    # ------------------------------------------------------------------ load
    def load(self):
        self.core_doc = load_raw(self.dir / "osm_raw.json")
        self.core = self.core_doc["elements"]
        cpath = self.dir / "osm_context_raw.json"
        self.ctx = load_raw(cpath)["elements"] if cpath.exists() else []
        self.osm_ts = self.core_doc.get("osm3s", {}).get("timestamp_osm_base")
        ad = [e for e in self.core if e.get("tags", {}).get("aeroway") == "aerodrome"
              and e.get("tags", {}).get("icao") == self.icao and e["type"] != "node"]
        polys = []
        for e in ad:
            polys.extend(el_polys(e, self.proj))
        self.aerodrome = unary_union(polys)
        self.aerodrome_src = ",".join(f"osm:{e['type']}/{e['id']}" for e in ad)
        self.region = self.aerodrome.buffer(CONTEXT_RADIUS)
        self.airside_zone = self.aerodrome.buffer(200)
        log(f"{self.icao}: aerodrome {self.aerodrome.area / 1e6:.2f} km2 from {self.aerodrome_src}")

    # ------------------------------------------------------------------ runways
    def build_runways(self):
        groups = {}
        for e in self.core:
            t = e.get("tags", {})
            if e["type"] != "way" or t.get("aeroway") != "runway" or lifecycle_dead(t):
                continue
            if is_closed(e) and t.get("area") == "yes":
                continue
            rid = norm_rwy_ref(t.get("ref"))
            if not rid or "H" in (t.get("ref") or "").upper():
                continue
            pts = self.proj.xy(e["geometry"])
            if not LineString(pts).intersects(self.airside_zone):
                continue
            groups.setdefault(rid, []).append((e, pts))
        ref_rwys = {r.get("id"): r for r in self.ref.get("runways", [])}
        self.runways = []
        for rid, pieces in sorted(groups.items()):
            allp = [p for _, pts in pieces for p in pts]
            mx = sum(p[0] for p in allp) / len(allp)
            my = sum(p[1] for p in allp) / len(allp)
            # principal axis
            sxx = sum((p[0] - mx) ** 2 for p in allp)
            syy = sum((p[1] - my) ** 2 for p in allp)
            sxy = sum((p[0] - mx) * (p[1] - my) for p in allp)
            ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
            ux, uy = math.cos(ang), math.sin(ang)
            proj_s = [((p[0] - mx) * ux + (p[1] - my) * uy, p) for p in allp]
            e0 = min(proj_s)[1]
            e1 = max(proj_s)[1]
            if math.dist(e0, e1) < 1200:
                continue
            ll0, ll1 = self.proj.lonlat([e0, e1])
            az01, az10, dist = GEOD.inv(ll0[0], ll0[1], ll1[0], ll1[1])
            h01 = az01 % 360.0
            h10 = az10 % 360.0
            d_a, d_b = rid.split("/")

            def mag(d):
                return int(re.match(r"\d+", d).group(0)) * 10.0

            # designator whose magnetic heading (+2 deg E variation) matches the 0->1 bearing
            if abs(((mag(d_a) + 2.0) - h01 + 180) % 360 - 180) < abs(((mag(d_b) + 2.0) - h01 + 180) % 360 - 180):
                des0, des1 = d_a, d_b
            else:
                des0, des1 = d_b, d_a
            # end 0 is where designator des0 starts (aircraft land/take off heading h01)
            tags0 = pieces[0][0]["tags"]
            widths = [parse_width(e["tags"].get("width")) for e, _ in pieces]
            osm_w = max([w for w in widths if w] or [0]) or None
            surface = next((e["tags"].get("surface") for e, _ in pieces if e["tags"].get("surface")), None)
            aip = ref_rwys.get(rid) or {}
            width = aip.get("width_m") or osm_w or 45.0
            rw = {"id": rid, "pieces": pieces, "e0": e0, "e1": e1, "des": (des0, des1), "h": (h01, h10),
                  "length_geo": dist, "width": width, "osm_width": osm_w, "surface": surface or aip.get("surface"),
                  "aip": aip, "line": LineString([e0, e1])}
            self.runways.append(rw)
            log(f"  runway {rid}: {des0} {h01:.2f}T -> {des1} {h10:.2f}T, OSM length {dist:.0f} m, "
                f"width {width} (OSM {osm_w}), AIP {aip.get('length_m')} x {aip.get('width_m')}")

    def crosscheck_runways(self):
        """compare OSM geometry against AIP coordinates; derive landing thresholds."""
        self.xcheck = []
        for rw in self.runways:
            aip = rw["aip"]
            line = rw["line"]
            L = line.length
            thr = {}
            for t in aip.get("thresholds", []) or []:
                thr[t["designator"]] = t
            ends_aip = {}
            for k, en in enumerate(aip.get("runway_ends", []) or []):
                ends_aip[k] = en
            rec = {"runway": rw["id"], "osm_length_m": round(rw["length_geo"], 1),
                   "aip_length_m": aip.get("length_m"), "osm_width_m": rw["osm_width"],
                   "aip_width_m": aip.get("width_m"), "ends": []}
            rw["thr_s"] = {}
            for k, des in enumerate(rw["des"]):
                end_xy = rw["e0"] if k == 0 else rw["e1"]
                s_end = 0.0 if k == 0 else L
                t = thr.get(des)
                displaced = float(t.get("displaced_m") or 0) if t else 0.0
                s_thr = s_end
                info = {"designator": des, "displaced_threshold_m_aip": displaced}
                if t and t.get("lat") is not None:
                    txy = self.proj.xy([(t["lon"], t["lat"])])[0]
                    s_proj = line.project(Point(txy))
                    cross = line.distance(Point(txy))
                    info["aip_threshold_cross_track_m"] = round(cross, 1)
                    if displaced > 0:
                        s_thr = s_proj
                        info["osm_end_to_aip_threshold_m"] = round(abs(s_proj - s_end), 1)
                    else:
                        info["osm_end_vs_aip_threshold_along_m"] = round((s_proj - s_end) * (1 if k == 0 else -1), 1)
                # pavement end comparison (AIP runway_ends list ordered NW, SE)
                for en in (aip.get("runway_ends") or []):
                    exy = self.proj.xy([(en["lon"], en["lat"])])[0]
                    if math.dist(exy, end_xy) < 400:
                        info["osm_end_vs_aip_end_m"] = round(math.dist(exy, end_xy), 1)
                rw["thr_s"][des] = s_thr
                rec["ends"].append(info)
            self.xcheck.append(rec)
            if aip.get("length_m"):
                diff = rw["length_geo"] - aip["length_m"]
                msg = (f"runway {rw['id']}: OSM centreline {rw['length_geo']:.0f} m vs AIP {aip['length_m']} m "
                       f"({diff:+.0f} m); width OSM {rw['osm_width']} vs AIP {aip.get('width_m')}")
                self.notes.append(msg)
                self.check.append(msg)

    # ------------------------------------------------------------------ taxi graph
    def collect_lines(self):
        """OSM taxiway/taxilane/runway centrelines as graph input lines."""
        lines = []
        self.taxi_ways = []
        for e in self.core:
            t = e.get("tags", {})
            if e["type"] != "way" or t.get("aeroway") not in ("taxiway", "taxilane") or lifecycle_dead(t):
                continue
            if t.get("area") == "yes":
                continue
            pts = self.proj.xy(e["geometry"])
            if len(pts) < 2 or not LineString(pts).intersects(self.airside_zone):
                continue
            kind = "taxilane" if t["aeroway"] == "taxilane" else "taxiway"
            width = parse_width(t.get("width")) or (15.0 if kind == "taxilane" else 23.0)
            ref = (t.get("ref") or "").strip()
            lines.append(Line(e["id"], kind, ref, width, list(pts), [("n", n) for n in e["nodes"]], t))
            self.taxi_ways.append({"osm_id": e["id"], "ref": ref, "kind": kind, "width": width, "pts": pts,
                                   "source": "osm"})
        for rw in self.runways:
            for e, pts in rw["pieces"]:
                lines.append(Line(e["id"], "runway", rw["id"], rw["width"], list(pts),
                                  [("n", n) for n in e["nodes"]], e["tags"]))
        self.lines = lines
        self.lines_osm = [LineString(l.pts) for l in lines if l.kind != "runway"]
        self.derived_lines = []

    def derive_taxilanes(self):
        """Apron taxilanes where OSM maps stands but no taxi line behind them (e.g. the new
        Zayed Terminal A apron): a polyline through points D m behind the stop points of
        side-by-side stands (D = 80 m contact / 65 m remote), extended along its own direction
        to the nearest taxi line without crossing buildings or runway strips.  source=derived."""
        lines = self.lines_osm
        tree = STRtree(lines)
        blds = [P for b, P in self.bgeoms if b["height_m"] >= 3 and b["kind"] != "car_park"]
        btree = STRtree(blds) if blds else None
        strips = unary_union([rw["line"].buffer(75) for rw in self.runways]) if self.runways else None

        aprons_u = unary_union([a["_poly"] for a in self.aprons]) if self.aprons else None
        paved = unary_union([x for x in [aprons_u.buffer(8) if aprons_u is not None else None,
                                          unary_union(lines).buffer(25)] if x is not None])

        def blocked(geom, buf=4.0, check_paved=False):
            g = geom.buffer(buf) if buf else geom
            if strips is not None and g.intersects(strips):
                return True
            return btree is not None and any(blds[int(k)].intersects(g) for k in btree.query(g))

        orphans = []
        for s in self.stands:
            hx, hy = stmod.hvec(s["heading"])
            ray = LineString([(s["x"], s["y"]), (s["x"] - hx * 150, s["y"] - hy * 150)])
            if any(lines[int(k)].intersects(ray) for k in tree.query(ray)):
                continue
            if s.get("lead_in"):
                p0 = Point(s["lead_in"][0])
                if lines[int(tree.nearest(p0))].distance(p0) <= 15:
                    continue
            D = 80.0 if s.get("contact") else 65.0
            T = (s["x"] - hx * D, s["y"] - hy * D)
            if blocked(Point(T), 10.0):
                continue
            orphans.append((s, T))
        if not orphans:
            return []
        uf = stmod._UF()
        for i in range(len(orphans)):
            uf.find(i)
        for i in range(len(orphans)):
            si, Ti = orphans[i]
            hx, hy = stmod.hvec(si["heading"])
            for j in range(i + 1, len(orphans)):
                sj, Tj = orphans[j]
                if stmod.angle_between(si["heading"], sj["heading"]) > 25:
                    continue
                d = math.dist(Ti, Tj)
                if d > 110 or d < 1:
                    continue
                along = abs((Tj[0] - Ti[0]) * hx + (Tj[1] - Ti[1]) * hy)
                if along > 0.45 * d:
                    continue
                if blocked(LineString([Ti, Tj]), 4.0):
                    continue
                uf.union(i, j)
        rows = {}
        for i in range(len(orphans)):
            rows.setdefault(uf.find(i), []).append(i)
        polys = []
        for row in rows.values():
            vx = sum(stmod.hvec(orphans[i][0]["heading"])[0] for i in row)
            vy = sum(stmod.hvec(orphans[i][0]["heading"])[1] for i in row)
            hx, hy = stmod.unit(vx, vy)
            rx, ry = hy, -hx
            pts = sorted((orphans[i][1] for i in row), key=lambda p: p[0] * rx + p[1] * ry)
            if len(pts) >= 3:
                # straighten: project onto the best-fit line when the row is nearly straight,
                # else smooth with a 3-point moving average
                mx = sum(p[0] for p in pts) / len(pts)
                my = sum(p[1] for p in pts) / len(pts)
                sxx = sum((p[0] - mx) ** 2 for p in pts)
                syy = sum((p[1] - my) ** 2 for p in pts)
                sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
                ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
                ux, uy = math.cos(ang), math.sin(ang)
                res = [abs((p[0] - mx) * -uy + (p[1] - my) * ux) for p in pts]
                if max(res) <= 15.0:
                    pts = [(mx + ux * ((p[0] - mx) * ux + (p[1] - my) * uy),
                            my + uy * ((p[0] - mx) * ux + (p[1] - my) * uy)) for p in pts]
                else:
                    pts = [pts[0]] + [((pts[i - 1][0] + pts[i][0] + pts[i + 1][0]) / 3,
                                       (pts[i - 1][1] + pts[i][1] + pts[i + 1][1]) / 3)
                                      for i in range(1, len(pts) - 1)] + [pts[-1]]
                rx, ry = stmod.unit(pts[-1][0] - pts[0][0], pts[-1][1] - pts[0][1])
            a = (pts[0][0] - rx * 40, pts[0][1] - ry * 40)
            b = (pts[-1][0] + rx * 40, pts[-1][1] + ry * 40)
            poly = [a] + pts + [b]
            if blocked(LineString(poly), 3.0):
                # drop the extensions if they hit something
                poly = pts if len(pts) >= 2 else [a, b]
            polys.append(poly)
        targets = list(lines) + [LineString(p) for p in polys]
        ttree = STRtree(targets)
        n_conn = 0
        for k, poly in enumerate(polys):
            for end in (0, -1):
                e = poly[end]
                prev = poly[1] if end == 0 else poly[-2]
                ux, uy = stmod.unit(e[0] - prev[0], e[1] - prev[1])
                ray = LineString([e, (e[0] + ux * 350, e[1] + uy * 350)])
                best = None
                for t in ttree.query(ray):
                    t = int(t)
                    if t == len(lines) + k:
                        continue
                    for q in _pts(ray.intersection(targets[t])):
                        d = math.dist(q, e)
                        if d > 1.0 and (best is None or d < best[0]):
                            best = (d, q)
                opts = []
                if best is not None and not blocked(LineString([e, best[1]]), 3.0):
                    opts.append((best[0], best[1]))
                # nearest point on an OSM taxi line, if the connector is clear
                t = int(tree.nearest(Point(e)))
                q = nearest_points(lines[t], Point(e))[0]
                if q.distance(Point(e)) <= 250 and not blocked(LineString([e, (q.x, q.y)]), 3.0):
                    opts.append((q.distance(Point(e)), (q.x, q.y)))
                hitp = min(opts)[1] if opts else None
                if hitp is not None:
                    if end == 0:
                        poly.insert(0, hitp)
                    else:
                        poly.append(hitp)
                    n_conn += 1
        out = []
        for k, poly in enumerate(polys):
            ln = Line(-(k + 1), "taxilane", "", 15.0, [tuple(p) for p in poly],
                      [("d", k, i) for i in range(len(poly))], {"source": "derived"})
            out.append(ln)
            self.taxi_ways.append({"osm_id": None, "id": f"derived-tl{k + 1}", "ref": "", "kind": "taxilane",
                                   "width": 15.0, "pts": [tuple(p) for p in poly], "source": "derived"})
        self.derived_lines = out
        self.notes.append(f"{len(out)} apron taxilanes derived behind {len(orphans)} stands that have no mapped "
                          f"taxi line behind them (source=derived; {n_conn} end connections)")
        log(f"  derived taxilanes: {len(out)} rows for {len(orphans)} orphan stands, {n_conn} end connections")
        return out

    def build_graph(self):
        lines = list(self.lines) + list(self.derived_lines)
        gb = GraphBuilder(lines, log=log)
        gb.add_crossings()
        gb.snap_dangling()
        nodes, edges = gb.split()
        for e in edges:
            if e["way"] is not None and e["way"] < 0:
                e["source"] = "derived"
                e["way"] = None
        g = TaxiGraph.from_builder(nodes, edges, stats=gb.stats)
        n0 = len(g.nodes)
        bridge_fragments(g, stats=gb.stats)
        self.g = g
        self.gstats = gb.stats
        log(f"  taxi graph: {len(g.nodes)} nodes, {len(g.edges)} edges (before bridging {n0} nodes); "
            f"crossings +{gb.stats['crossings_added']}, snaps {gb.stats['endpoint_snaps']}, "
            f"extensions {gb.stats['endpoint_extensions']}, bridges {gb.stats['bridges']}, "
            f"dropped {gb.stats['dropped_fragments']} fragments ({gb.stats['dropped_fragment_length_m']:.0f} m)")

    def runway_nodes(self):
        """graph nodes at pavement ends and landing thresholds."""
        g = self.g
        for rw in self.runways:
            rw["end_nodes"] = []
            for end_xy in (rw["e0"], rw["e1"]):
                nid = min(g.nodes, key=lambda n: math.dist(g.nodes[n], end_xy))
                if math.dist(g.nodes[nid], end_xy) > 5:
                    raise SystemExit(f"{rw['id']}: no graph node at runway end {end_xy}")
                rw["end_nodes"].append(nid)
            rw["thr_nodes"] = []
            line = rw["line"]
            for k, des in enumerate(rw["des"]):
                s = rw["thr_s"][des]
                s_end = 0.0 if k == 0 else line.length
                if abs(s - s_end) < 5.0:
                    rw["thr_nodes"].append(rw["end_nodes"][k])
                    continue
                p = line.interpolate(s)
                # find runway edge containing p
                best, bi = 1e9, None
                for i, e in enumerate(g.edges):
                    if e["kind"] != "runway" or e["ref"] != rw["id"]:
                        continue
                    d = LineString(e["pts"]).distance(p)
                    if d < best:
                        best, bi = d, i
                el = LineString(g.edges[bi]["pts"])
                res = g.split_edge_at(bi, [el.project(p)], tol=3.0)
                rw["thr_nodes"].append(list(res.values())[0])

    # ------------------------------------------------------------------ buildings
    def build_buildings(self):
        tower_h = None
        for t in self.ref.get("control_towers", []) or []:
            if t.get("height_m"):
                tower_h = float(t["height_m"])
                break
        outlines, parts = [], []
        for e in self.core:
            t = e.get("tags", {})
            if e["type"] == "node":
                continue
            is_b = "building" in t and t.get("building") not in ("no",)
            is_part = "building:part" in t and t.get("building:part") not in ("no",)
            if not (is_b or is_part or t.get("aeroway") in ("terminal", "hangar", "tower")):
                continue
            if lifecycle_dead(t) and t.get("building") != "construction":
                continue
            for P in el_polys(e, self.proj):
                rec = {"el": e, "poly": P, "tags": t}
                (parts if (is_part and not is_b) else outlines).append(rec)
        # airport buildings: centroid in aerodrome (+25 m) or aeroway tag / airport name
        zone = self.aerodrome.buffer(25)
        self.buildings = []
        self.bgeoms = []
        part_tree = STRtree([p["poly"] for p in parts]) if parts else None
        used_parts = set()
        airport_ids = set()
        for rec in outlines:
            t = rec["tags"]
            P = rec["poly"]
            nm = name_of(t)
            inside = zone.contains(P.representative_point())
            airporty = t.get("aeroway") in ("terminal", "hangar", "tower") or \
                any(w in nm.lower() for w in ("terminal", "concourse", "airport"))
            if not (inside or (airporty and self.aerodrome.buffer(600).intersects(P))):
                continue
            airport_ids.add((rec["el"]["type"], rec["el"]["id"]))
            kind = building_kind(t, nm)
            # building parts inside this outline
            inner = []
            if part_tree is not None:
                for k in part_tree.query(P):
                    pr = parts[int(k)]
                    if P.buffer(1.0).contains(pr["poly"].representative_point()) and \
                            pr["poly"].intersection(P).area > 0.6 * pr["poly"].area:
                        inner.append(int(k))
            if inner:
                used_parts.update(inner)
                hs = []
                for k in inner:
                    pr = parts[k]
                    pk = building_kind(pr["tags"], name_of(pr["tags"]))
                    pk = pk if pk != "other" else kind
                    h, src = height_of(pr["tags"], pk, pr["poly"].area, tower_h if pk == "tower" else None)
                    self._add_building(pr["el"], pr["poly"], pk, name_of(pr["tags"]) or nm, h, src, pr["tags"],
                                       part_of=rec["el"])
                    hs.append(h)
                rest = P.difference(unary_union([parts[k]["poly"] for k in inner]))
                for rp in polys_of(rest):
                    if rp.area < 30:
                        continue
                    h, src = height_of(t, kind, rp.area)
                    if src == "osm:height" and h > 20 and max(hs) >= h - 1:
                        h, src = (min(15.0, h), "derived")  # outline height belongs to the part (tower)
                    self._add_building(rec["el"], rp, kind if kind != "tower" else "other", nm, h, src, t,
                                       remainder=True)
                continue
            h, src = height_of(t, kind, P.area, tower_h if kind == "tower" else None)
            self._add_building(rec["el"], P, kind, nm, h, src, t)
        for k, pr in enumerate(parts):  # orphan parts inside the aerodrome
            if k in used_parts:
                continue
            if zone.contains(pr["poly"].representative_point()):
                t = pr["tags"]
                kind = building_kind(t, name_of(t))
                h, src = height_of(t, kind, pr["poly"].area, tower_h if kind == "tower" else None)
                self._add_building(pr["el"], pr["poly"], kind, name_of(t), h, src, t)
                airport_ids.add((pr["el"]["type"], pr["el"]["id"]))
        self.airport_building_ids = airport_ids
        # researched heights (data/reference/airports.json quotes the OSM way of DXB Concourses A/B/D)
        ref_h = {}
        for t in self.ref.get("terminals", []) or []:
            arch = t.get("architecture") or {}
            h = arch.get("height_m")
            dims = json.dumps(arch.get("dimensions_m") or {})
            m = re.search(r"OSM way (\d+)", dims)
            if h and m:
                ref_h[f"osm-w{m.group(1)}"] = (float(h), t["name"])
            elif h:
                self.notes.append(f"reference height {h} m for '{t['name']}' kept as reference_peak_height_m only")
                for b in self.buildings:
                    if b["kind"] in ("terminal", "concourse") and b["name"] and \
                            t["name"].split("(")[0].strip().lower() in b["name"].lower():
                        b["reference_peak_height_m"] = float(h)
        for b in self.buildings:
            if b["id"] in ref_h and b["height_source"] in ("default", "osm:levels"):
                b["height_m"], b["height_source"] = ref_h[b["id"]][0], "reference"
                b["levels"] = max(1, int(round(b["height_m"] / 3.5)))
        # control towers mapped only as nodes (DXB, SHJ): small derived footprint at the node
        tower_h = None
        for t in self.ref.get("control_towers", []) or []:
            if t.get("height_m"):
                tower_h = float(t["height_m"])
                break
        have_tower = any(b["kind"] == "tower" and "old" not in (b["name"] or "").lower() for b in self.buildings)
        for e in self.core:
            t = e.get("tags", {})
            if e["type"] != "node" or not (t.get("aeroway") in ("tower", "control_tower") or
                                           (t.get("man_made") == "tower" and "control" in name_of(t).lower())):
                continue
            x, y = self.proj.xy([(e["lon"], e["lat"])])[0]
            if not self.aerodrome.buffer(100).contains(Point(x, y)):
                continue
            if any(bP.contains(Point(x, y)) and b["kind"] == "tower" for b, bP in self.bgeoms):
                continue
            h = parse_height(t.get("height"))
            src = "osm:height"
            if h is None:
                h, src = (tower_h, "reference") if (tower_h and not have_tower) else (35.0, "default")
            P = Point(x, y).buffer(9.0, 16)
            self._add_building(e, P, "tower", name_of(t) or "ATC tower", h, src, t)
            self.buildings[-1]["source"] = "derived"
            self.buildings[-1]["footprint_note"] = "OSM maps the tower as a node; 18 m diameter footprint derived"
            have_tower = True
            self.notes.append(f"control tower osm:node/{e['id']} given a derived 18 m footprint, height {h} m ({src})")
        cnt = {}
        for b in self.buildings:
            cnt[b["kind"]] = cnt.get(b["kind"], 0) + 1
        log(f"  buildings: {len(self.buildings)} {cnt}")

    def _add_building(self, el, P, kind, name, h, hsrc, tags, part_of=None, remainder=False):
        P = ccw(P)
        fp, holes = ring_out(P, simplify=0.2)
        if len(fp) < 3:
            return
        lv = parse_height(tags.get("building:levels"))
        levels = int(round(lv)) if lv else max(1, int(round(h / 3.5)))
        b = {"id": f"osm-{el['type'][0]}{el['id']}" + ("-rest" if remainder else ""),
             "kind": kind, "name": name or None, "footprint": fp, "holes": holes,
             "height_m": round(h, 1), "levels": levels,
             "source": "osm",
             "height_source": hsrc}
        mh = parse_height(tags.get("min_height"))
        if mh:
            b["min_height_m"] = round(mh, 1)
        if part_of is not None:
            b["part_of"] = f"osm-{part_of['type'][0]}{part_of['id']}"
        # avoid id clashes (multipolygon split into several polygons)
        base, k = b["id"], 2
        while any(x["id"] == b["id"] for x in self.buildings[-50:]):
            b["id"] = f"{base}-{k}"
            k += 1
        self.buildings.append(b)
        self.bgeoms.append((b, P))

    # ------------------------------------------------------------------ aprons / landuse / roads / context
    def build_surfaces(self):
        self.aprons = []
        for e in self.core:
            t = e.get("tags", {})
            if t.get("aeroway") != "apron" or e["type"] == "node":
                continue
            for P in el_polys(e, self.proj):
                if not P.intersects(self.airside_zone):
                    continue
                fp, holes = ring_out(ccw(P), simplify=0.3)
                self.aprons.append({"id": f"osm-{e['type'][0]}{e['id']}", "ref": t.get("ref") or name_of(t) or None,
                                    "polygon": fp, "holes": holes, "_poly": P})
        self.landuse = []
        seen = set()
        region = self.region
        for e in self.core + self.ctx:
            t = e.get("tags", {})
            if e["type"] == "node" or (e["type"], e["id"]) in seen:
                continue
            kind = landuse_kind(t)
            if not kind:
                continue
            seen.add((e["type"], e["id"]))
            for P in el_polys(e, self.proj):
                if not P.intersects(region):
                    continue
                if P.area < 50:
                    continue
                C = P.intersection(region) if not region.contains(P) else P
                for q in polys_of(C):
                    if q.area < 50:
                        continue
                    fp, holes = ring_out(ccw(q), simplify=0.8)
                    if len(fp) >= 3:
                        self.landuse.append({"kind": kind, "polygon": fp, "holes": holes,
                                             "source": f"osm:{e['type']}/{e['id']}"})
        # sea from the coastline
        coast = []
        for e in self.core + self.ctx:
            if e["type"] == "way" and e.get("tags", {}).get("natural") == "coastline":
                coast.append(LineString(self.proj.xy(e["geometry"])))
        n_sea = 0
        if coast:
            clip = region.envelope
            land, water = coast_faces(coast, clip, eps=0.5)
            for w in water:
                C = w.intersection(region)
                for q in polys_of(C):
                    if q.area < 200:
                        continue
                    fp, holes = ring_out(ccw(q), simplify=1.0)
                    self.landuse.append({"kind": "water", "polygon": fp, "holes": holes,
                                         "source": "osm:natural=coastline (sea polygon built from coastline)"})
                    n_sea += 1
        log(f"  aprons {len(self.aprons)}, landuse {len(self.landuse)} (sea polygons {n_sea})")

        # roads + rail
        self.roads = []
        seen = set()
        for e in self.core + self.ctx:
            t = e.get("tags", {})
            if e["type"] != "way" or (e["id"] in seen):
                continue
            hw = t.get("highway")
            kind = None
            if t.get("aeroway") == "gse-road" or (hw == "service" and t.get("service") == "aircraft"):
                kind = "airside_service"
            elif hw in ROAD_OK and t.get("area") != "yes":
                kind = hw
            elif t.get("railway") in ("rail", "subway", "light_rail", "monorail", "tram", "narrow_gauge") and \
                    t.get("railway") != "platform":
                kind = "rail"
            if not kind:
                continue
            seen.add(e["id"])
            L = LineString(self.proj.xy(e["geometry"]))
            if not L.intersects(region):
                continue
            near_airport = L.intersects(self.airside_zone.buffer(300))
            if kind == "service" and not near_airport:
                continue  # driveways / parking aisles of the city: not needed, keeps the file small
            C = L.intersection(region) if not region.contains(L) else L
            parts = [C] if C.geom_type == "LineString" else [g for g in getattr(C, "geoms", []) if g.geom_type == "LineString"]
            w = parse_width(t.get("width"))
            if w is None:
                lanes = parse_height(t.get("lanes"))
                w = lanes * 3.5 if (lanes and kind not in ("rail",)) else ROAD_W[kind]
            for part in parts:
                part = part.simplify(0.5 if near_airport else 1.0)
                if part.length < 2:
                    continue
                r = {"kind": kind, "width_m": round(w, 1), "points": pts_out(part.coords)}
                if t.get("name:en") or t.get("name"):
                    r["name"] = name_of(t)
                if t.get("bridge") not in (None, "no"):
                    r["bridge"] = True
                if t.get("tunnel") not in (None, "no"):
                    r["tunnel"] = True
                try:
                    lay = int(t.get("layer", "0"))
                    if lay:
                        r["layer"] = lay
                except ValueError:
                    pass
                if kind == "rail":
                    r["rail"] = t.get("railway")
                self.roads.append(r)
        log(f"  roads {len(self.roads)}")

    def build_context(self):
        """surrounding city: buildings within 3 km of the aerodrome boundary (+ skyline)."""
        sk = self.cfg.get("skyline")
        arp_pt = Point(0, 0)
        outlines, parts = [], []
        seen = set()
        for e in self.core + self.ctx:
            t = e.get("tags", {})
            if e["type"] == "node" or (e["type"], e["id"]) in seen:
                continue
            if (e["type"], e["id"]) in self.airport_building_ids:
                continue
            is_b = "building" in t and t.get("building") != "no"
            is_p = "building:part" in t and t.get("building:part") != "no"
            if not (is_b or is_p):
                continue
            seen.add((e["type"], e["id"]))
            for P in el_polys(e, self.proj):
                (parts if (is_p and not is_b) else outlines).append((e, P))
        zone_air = self.aerodrome.buffer(25)
        region = self.region
        part_tree = STRtree([p for _, p in parts]) if parts else None
        out = []
        n_sky = 0
        for e, P in outlines:
            c = P.representative_point()
            in_ring = region.contains(c) and not zone_air.contains(c)
            t = e["tags"]
            h = ctx_height(t, P.area)
            in_sky = False
            if not in_ring and sk:
                if c.distance(arp_pt) <= sk["radius_m"] and h >= sk["min_height_m"] and \
                        (parse_height(t.get("height")) or parse_height(t.get("building:levels"))):
                    in_sky = True
            if not (in_ring or in_sky):
                continue
            inner = []
            if part_tree is not None and (P.area > 300 or in_sky):
                for k in part_tree.query(P):
                    pe, pp = parts[int(k)]
                    if P.buffer(1.0).contains(pp.representative_point()) and pp.intersection(P).area > 0.6 * pp.area:
                        inner.append(int(k))
            items = []
            if inner and any(parse_height(parts[k][0]["tags"].get("height")) or
                             parse_height(parts[k][0]["tags"].get("building:levels")) for k in inner):
                for k in inner:
                    pe, pp = parts[k]
                    ph = ctx_height(pe["tags"], pp.area)
                    mh = parse_height(pe["tags"].get("min_height"))
                    if mh is None and parse_height(pe["tags"].get("building:min_level")):
                        mh = parse_height(pe["tags"].get("building:min_level")) * 3.5
                    items.append((pp, ph, mh, name_of(pe["tags"]) or name_of(t)))
            else:
                items.append((P, h, parse_height(t.get("min_height")), name_of(t)))
            for poly, hh, mh, nm in items:
                tol = 1.5 if not in_sky else (0.5 if poly.area > 200 else 0.1)
                q = poly.simplify(tol, preserve_topology=True)
                if q.is_empty or q.area < (0.3 if (in_sky and hh >= 100) else 25):
                    continue
                q = ccw(q) if q.geom_type == "Polygon" else q
                if q.geom_type != "Polygon":
                    continue
                fp = pts_out(list(q.exterior.coords)[:-1])
                if len(fp) < 3:
                    continue
                cb = {"footprint": fp, "height_m": round(hh, 1)}
                if mh:
                    cb["min_height_m"] = round(mh, 1)
                if nm and hh >= 100:
                    cb["name"] = nm
                out.append(cb)
                if in_sky:
                    n_sky += 1
        self.context = out
        log(f"  context buildings {len(out)} (skyline beyond the 3 km ring: {n_sky})")

    # ------------------------------------------------------------------ stands
    def build_stands(self):
        pp_ways, pp_nodes = [], []
        for e in self.core:
            t = e.get("tags", {})
            if t.get("aeroway") != "parking_position" or lifecycle_dead(t):
                continue
            ref = (t.get("ref") or "").strip() or None
            if ref and ";" in ref:
                ref = ref.split(";")[0].strip()
            if e["type"] == "node":
                x, y = self.proj.xy([(e["lon"], e["lat"])])[0]
                if self.airside_zone.contains(Point(x, y)):
                    pp_nodes.append({"id": e["id"], "ref": ref, "x": x, "y": y})
            elif e["type"] == "way":
                pts = self.proj.xy(e["geometry"])
                if not LineString(pts).intersects(self.airside_zone):
                    continue
                if is_closed(e):
                    c = Polygon(pts).centroid
                    pp_nodes.append({"id": e["id"], "ref": ref, "x": c.x, "y": c.y})
                else:
                    pp_ways.append({"id": e["id"], "ref": ref, "pts": pts, "nodes": e["nodes"]})
        terms = [P for b, P in self.bgeoms if b["kind"] in ("terminal", "concourse")]
        raw = stmod.derive_osm_stands(pp_ways, pp_nodes, self.lines_osm, log=log, terminals=terms)
        # parking positions inside hangars / buildings are maintenance positions, not stands
        blds = [(b, P) for b, P in self.bgeoms if b["height_m"] >= 4 and b["kind"] not in ("car_park",)]
        btree = STRtree([P for _, P in blds]) if blds else None
        keep, dropped = [], []
        for st in raw:
            S = Point(st["x"], st["y"])
            inside = btree is not None and any(blds[int(k)][1].buffer(-1.0).contains(S) for k in btree.query(S))
            (dropped if inside else keep).append(st)
        if dropped:
            self.notes.append(f"{len(dropped)} OSM parking positions inside hangars/buildings were not used as stands: "
                              + ", ".join(sorted((d.get('ref') or d['source']) for d in dropped))[:300])
            log(f"  dropped {len(dropped)} parking positions inside buildings")
        raw = keep
        self.stands = raw
        for s in self.stands:
            s["origin"] = "osm"
        self.classify_stands()

    def classify_stands(self):
        terms = [(b, P) for b, P in self.bgeoms if b["kind"] in ("terminal", "concourse")]
        tterm = STRtree([P for _, P in terms]) if terms else None
        allb = [P for _, P in self.bgeoms]
        ball = STRtree(allb) if allb else None
        taxi = self.lines_osm
        ttree = STRtree(taxi)
        aprons = self.aprons
        atree = STRtree([a["_poly"] for a in aprons]) if aprons else None
        # jet bridges & gates
        self.jet_bridges = []
        self.gates = []
        for e in self.core:
            t = e.get("tags", {})
            if t.get("aeroway") == "jet_bridge" and e["type"] == "way":
                self.jet_bridges.append(LineString(self.proj.xy(e["geometry"])))
            if t.get("aeroway") == "gate" and e["type"] == "node" and t.get("ref"):
                self.gates.append((t["ref"], Point(self.proj.xy([(e["lon"], e["lat"])])[0])))
        for s in self.stands:
            S = Point(s["x"], s["y"])
            # nearest terminal / concourse
            tb, tP, td = None, None, 1e9
            if tterm is not None:
                for k in tterm.query(S.buffer(stmod.CONTACT_DIST + 40)):
                    b, P = terms[int(k)]
                    d = P.distance(S)
                    if d < td:
                        tb, tP, td = b, P, d
            if s["heading"] is None:
                if tb is not None and td <= 80:
                    # facade direction from the simplified outline (ignores narrow fingers)
                    q = nearest_points(tP.simplify(12.0, preserve_topology=True).exterior, S)[0]
                    s["heading"] = stmod.heading_of(q.x - s["x"], q.y - s["y"])
                    s["heading_source"] = "derived: nose towards nearest terminal facade"
                else:
                    i = int(ttree.nearest(S))
                    q = nearest_points(taxi[i], S)[0]
                    if q.distance(S) < 0.5:
                        s["heading"] = 0.0
                    else:
                        s["heading"] = stmod.heading_of(s["x"] - q.x, s["y"] - q.y)
                    s["heading_source"] = "derived: nose away from nearest taxi line"
            else:
                s.setdefault("heading_source", "osm lead-in line")
            # contact?  the nose points at a terminal/concourse facade within ~70 m (ray along
            # the heading), or the stop point is within 25 m of the facade and roughly facing it
            s["contact"] = False
            s["bridge_root"] = None
            s.pop("gate", None)
            cb, cP = None, None
            if tterm is not None:
                hx, hy = stmod.hvec(s["heading"])
                ray = LineString([(s["x"], s["y"]), (s["x"] + hx * stmod.CONTACT_DIST, s["y"] + hy * stmod.CONTACT_DIST)])
                hit = None
                for k in tterm.query(ray):
                    b, P = terms[int(k)]
                    if P.intersects(ray):
                        d = S.distance(P.intersection(ray))
                        if hit is None or d < hit[0]:
                            hit = (d, b, P)
                if hit is not None:
                    cb, cP = hit[1], hit[2]
                elif tb is not None and td <= 25.0:
                    q = nearest_points(tP.exterior, S)[0]
                    to_b = stmod.heading_of(q.x - s["x"], q.y - s["y"]) if q.distance(S) > 0.5 else s["heading"]
                    if stmod.angle_between(to_b, s["heading"]) <= 60:
                        cb, cP = tb, tP
            if cb is not None and len(self.jet_bridges) >= 10:
                # this airport maps its jet bridges: a stand is only a contact stand if an OSM
                # jet bridge reaches it (DXB Terminal 2 is a bus-gate terminal, for example)
                if min(jb.distance(S) for jb in self.jet_bridges) > 35.0:
                    cb, cP = None, None
            if cb is not None:
                s["contact"] = True
                q = nearest_points(cP.exterior, S)[0]
                # bridge root: building end of an OSM jet bridge serving this stand, else nearest facade point
                root = None
                best = 1e9
                for jb in self.jet_bridges:
                    if jb.distance(S) > 60:
                        continue
                    c0, c1 = Point(jb.coords[0]), Point(jb.coords[-1])
                    inner_pt = c0 if cP.distance(c0) < cP.distance(c1) else c1
                    if cP.distance(inner_pt) > 12:
                        continue
                    d = inner_pt.distance(S)
                    if d < best:
                        best, root = d, inner_pt
                if root is None:
                    root = q
                    s["bridge_root_source"] = "derived: nearest facade point"
                else:
                    root = nearest_points(cP.exterior, root)[0]
                    s["bridge_root_source"] = "osm aeroway=jet_bridge (building end)"
                # push 1.5 m outward (away from the building interior)
                ox, oy = stmod.unit(s["x"] - root.x, s["y"] - root.y)
                probe = Point(root.x + ox * 1.5, root.y + oy * 1.5)
                if cP.contains(probe):
                    ox, oy = -ox, -oy
                s["bridge_root"] = (root.x + ox * 1.5, root.y + oy * 1.5)
                s["area"] = cb["name"] or cb["kind"].title()
                gate = None
                gd = 1e9
                for gref, gp in self.gates:
                    d = gp.distance(Point(s["bridge_root"]))
                    if d < 45 and d < gd:
                        gate, gd = gref, d
                if gate:
                    s["gate"] = gate
            elif s.get("area") and s.get("_area_from_contact"):
                s["area"] = None
            if s["contact"]:
                s["_area_from_contact"] = True
            # apron / area name
            if not s.get("area"):
                nm = None
                if atree is not None:
                    for k in atree.query(S):
                        a = aprons[int(k)]
                        if a["_poly"].contains(S) and a["ref"]:
                            nm = a["ref"]
                            break
                if not nm and tb is not None and td < 250:
                    nm = f"{tb['name'] or tb['kind'].title()} apron"
                if not nm:
                    # nearest named building
                    bn, bd = None, 1e9
                    for b, P in self.bgeoms:
                        if b["name"] and b["kind"] in ("cargo", "hangar", "terminal", "concourse"):
                            d = P.distance(S)
                            if d < bd:
                                bn, bd = b, d
                    if bn is not None and bd < 300:
                        nm = f"{bn['name']} apron"
                s["area"] = nm or "Apron"
            # kind
            area_l = (s["area"] or "").lower()
            near_kinds = {}
            if ball is not None:
                for k in ball.query(S.buffer(160)):
                    b, P = self.bgeoms[int(k)]
                    d = P.distance(S)
                    if d < 160:
                        near_kinds[b["kind"]] = min(d, near_kinds.get(b["kind"], 1e9))
                        nml = (b["name"] or "").lower()
                        if any(w in nml for w in ("royal", "presidential", "vip", "executive", "jet aviation",
                                                  "execujet", "private", "general aviation", "business aviation",
                                                  "amiri", "fbo", "aviation terminal")):
                            near_kinds["ga"] = min(d, near_kinds.get("ga", 1e9))
            if s["contact"]:
                s["kind"] = "contact"
            elif "cargo" in area_l or ("cargo" in near_kinds and near_kinds["cargo"] < 140 and
                                       near_kinds.get("terminal", 1e9) > 250 and near_kinds.get("concourse", 1e9) > 250):
                s["kind"] = "cargo"
            elif any(w in area_l for w in ("royal", "presidential", "vip", "executive", "private", "general aviation",
                                            "aviation terminal")) or \
                    ("ga" in near_kinds and near_kinds.get("concourse", 1e9) > 300):
                s["kind"] = "ga"
            else:
                s["kind"] = "remote"

    def spur_stands(self):
        """derived stands at dead-end taxi spurs that end inside an apron with no stand nearby
        (aircraft parking spurs mapped as aeroway=taxiway without parking_position)."""
        g = self.g
        if not self.aprons:
            return []
        apron_u = unary_union([a["_poly"] for a in self.aprons]).buffer(10)
        inc = {}
        for i, e in enumerate(g.edges):
            inc.setdefault(e["a"], []).append(i)
            inc.setdefault(e["b"], []).append(i)
        near_lines = [LineString(s["lead_in"]) for s in self.stands if s.get("lead_in")]
        nl_tree = STRtree(near_lines) if near_lines else None
        added = []
        for n, ei in sorted(inc.items()):
            if len(ei) != 1:
                continue
            e = g.edges[ei[0]]
            if e["kind"] not in ("taxiway", "taxilane"):
                continue
            P = Point(g.nodes[n])
            if not apron_u.contains(P):
                continue
            if any(math.dist(g.nodes[n], (s["x"], s["y"])) < 45 for s in self.stands + added):
                continue
            if nl_tree is not None and any(near_lines[int(k)].distance(P) < 20 for k in nl_tree.query(P.buffer(20))):
                continue
            pts = e["pts"] if e["b"] == n else e["pts"][::-1]
            L = polyline_length(pts)
            if L < 20:
                continue
            acc, k = 0.0, len(pts) - 1
            while k > 0 and acc < 15.0:
                acc += math.dist(pts[k - 1], pts[k])
                k -= 1
            h = stmod.heading_of(pts[-1][0] - pts[k][0], pts[-1][1] - pts[k][1])
            added.append({"ref": None, "x": P.x, "y": P.y, "heading": h, "lead_in": None,
                          "source": "derived", "derivation": f"dead end of a taxiway spur (osm:way/{e.get('way')})",
                          "origin": "spur",
                          "spur_node": n, "heading_source": "osm taxiway spur direction"})
        if added:
            self.stands.extend(added)
            self.notes.append(f"{len(added)} stands derived at dead-end taxiway spurs inside aprons that carry no "
                              f"parking_position (source=derived; the spur's last edge becomes the stand_link)")
        log(f"  spur stands: {len(added)}")
        return added

    def synthesize_stands(self, targets):
        """derived contact stands along long straight terminal/concourse facades that face an
        apron but have no OSM stand (sparse mapping)."""
        added = []
        if not self.aprons:
            return added
        aprons = unary_union([a["_poly"] for a in self.aprons])
        apron5, apron15 = aprons.buffer(5), aprons.buffer(15)
        blds = [P for b, P in self.bgeoms if b["height_m"] >= 3]
        btree = STRtree(blds)
        taxi = unary_union(self.lines_osm)
        spacing = 72.0  # code-E contact stand pitch
        for b, P in [(b, P) for b, P in self.bgeoms if b["kind"] in ("terminal", "concourse")]:
            if P.area < 8000:
                continue
            simp = P.simplify(12.0, preserve_topology=True)
            co = list(simp.exterior.coords)
            for a, c in zip(co[:-1], co[1:]):
                seg = math.dist(a, c)
                if seg < 60:
                    continue
                tx, ty = stmod.unit(c[0] - a[0], c[1] - a[1])
                nx_, ny_ = ty, -tx
                mid = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
                if P.contains(Point(mid[0] + nx_ * 4, mid[1] + ny_ * 4)):
                    nx_, ny_ = -nx_, -ny_
                n_st = int((seg - 16) // spacing)
                if n_st < 1:
                    continue
                off = (seg - n_st * spacing) / 2 + spacing / 2
                for k in range(n_st):
                    sdist = off + k * spacing
                    foot = Point(a[0] + tx * sdist, a[1] + ty * sdist)
                    foot = nearest_points(P.exterior, foot)[0]
                    stop = Point(foot.x + nx_ * 22.0, foot.y + ny_ * 22.0)
                    tail = Point(foot.x + nx_ * 85.0, foot.y + ny_ * 85.0)
                    if P.contains(stop) or not apron5.contains(stop) or not apron15.contains(tail):
                        continue
                    if any(math.dist((stop.x, stop.y), (s["x"], s["y"])) < spacing * 0.75 for s in self.stands + added):
                        continue
                    env = LineString([stop, tail]).buffer(28, cap_style=2)
                    if any(blds[int(q)].intersects(env) and not blds[int(q)].equals(P) for q in btree.query(env)):
                        continue
                    if taxi.distance(stop) < 30:
                        continue
                    h = stmod.heading_of(-nx_, -ny_)
                    added.append({"ref": None, "x": stop.x, "y": stop.y, "heading": h, "lead_in": None,
                                  "source": "derived", "origin": "derived", "heading_source": "derived: facade normal",
                                  "derivation": f"synthetic contact stand along the facade of {b['name'] or b['id']}"})
        if added:
            self.stands.extend(added)
            self.notes.append(f"{len(added)} synthetic contact stands generated along terminal/concourse facades "
                              f"without OSM parking positions (source=derived, 72 m pitch, nose gear 22 m off the facade)")
        log(f"  synthetic facade stands: {len(added)}")
        return added

    def finalize_stands(self):
        prefix = {"OMAA": "P", "OMDB": "P", "OMSJ": "S"}[self.icao]
        self.classify_stands()
        stmod.assign_ids(self.stands, prefix=prefix)
        stmod.compute_conflicts(self.stands)
        obstacles = [P for b, P in self.bgeoms if b["height_m"] >= 4 and
                     b["kind"] not in ("car_park", "terminal", "concourse")]
        stmod.wingspans(self.stands, buildings=obstacles)
        for s in self.stands:
            if s["kind"] == "contact":
                s["bridge_count"] = 1 if s["size_code"] in ("A", "B", "C") else (2 if s["size_code"] in ("D", "E") else 3)
            else:
                s["bridge_count"] = 0

    def attach_stands(self):
        g = self.g
        G = g.nx()
        rwy_nodes = {n for rw in self.runways for n in rw["end_nodes"]}
        main = max(nx.connected_components(G), key=lambda c: (len(c & rwy_nodes), len(c)))
        cand = [i for i, e in enumerate(g.edges) if e["kind"] in ("taxiway", "taxilane") and e["a"] in main]
        geoms = [LineString(g.edges[i]["pts"]) for i in cand]
        tree = STRtree(geoms)
        reqs = []
        for si, s in enumerate(self.stands):
            if s.get("origin") != "spur":
                continue
            n = s["spur_node"]
            ei = next(i for i, e in enumerate(g.edges) if n in (e["a"], e["b"]))
            e = g.edges[ei]
            if polyline_length(e["pts"]) > 150:
                el = LineString(e["pts"])
                sv = (el.length - 60.0) if e["b"] == n else 60.0
                g.split_edge_at(ei, [sv], tol=3.0)
                ei = next(i for i, e in enumerate(g.edges) if n in (e["a"], e["b"]))
                e = g.edges[ei]
            entry = e["a"] if e["b"] == n else e["b"]
            if e["b"] != n:
                e["a"], e["b"], e["pts"] = e["b"], e["a"], e["pts"][::-1]
            e["kind"], e["ref"] = "stand_link", s["id"]
            s["entry_node"], s["stop_node"] = entry, n
            s["lead_in"] = list(e["pts"])
            s["link_source"] = "osm taxiway spur"
        # spur splits created new nodes: recompute the main component
        G = g.nx()
        main = max(nx.connected_components(G), key=lambda c: (len(c & rwy_nodes), len(c)))
        cand = [i for i, e in enumerate(g.edges) if e["kind"] in ("taxiway", "taxilane") and e["a"] in main]
        geoms = [LineString(g.edges[i]["pts"]) for i in cand]
        tree = STRtree(geoms)
        blds = [P for b, P in self.bgeoms if b["height_m"] >= 3 and b["kind"] != "car_park"]
        btree = STRtree(blds) if blds else None

        def crosses_building(pts):
            L = LineString(pts)
            if L.length > 8:
                L = substring(L, 0, L.length - 4.0)  # the stop point may sit close to a facade
            if btree is None:
                return False
            return any(blds[int(k)].buffer(-0.5).intersects(L) for k in btree.query(L))

        n_bad = 0
        for si, s in enumerate(self.stands):
            if s.get("origin") == "spur":
                continue
            S = (s["x"], s["y"])
            hx, hy = stmod.hvec(s["heading"])
            cands = []
            if s.get("lead_in") and len(s["lead_in"]) >= 2:
                lead = [tuple(p) for p in s["lead_in"]]
                LL = LineString(lead)
                cum = [0.0]
                for p0, p1 in zip(lead[:-1], lead[1:]):
                    cum.append(cum[-1] + math.dist(p0, p1))
                # A) walk back from the stop: the lead-in joins the taxi network where it first
                #    comes within 3 m of a taxi edge (also derived apron taxilanes)
                sv = LL.length - 12.0
                while sv >= 0:
                    p = LL.interpolate(sv)
                    k = int(tree.nearest(p))
                    if geoms[k].distance(p) <= 3.0:
                        q = nearest_points(geoms[k], p)[0]
                        link = [(q.x, q.y)] + [v for v, c in zip(lead, cum) if c > sv + 0.5]
                        if link[-1] != S:
                            link.append(S)
                        cands.append(("osm lead-in", k, geoms[k].project(q), link))
                        break
                    sv -= 2.0
                # B) lead-in start within 30 m of a taxi edge
                E0 = Point(lead[0])
                k = int(tree.nearest(E0))
                if geoms[k].distance(E0) <= 30.0:
                    q = nearest_points(geoms[k], E0)[0]
                    cands.append(("osm lead-in", k, geoms[k].project(q),
                                  [(q.x, q.y)] + (lead[1:] if q.distance(E0) < 1.0 else lead)))
                # C) extend the lead-in backwards along its first segment
                dx, dy = stmod.unit(lead[0][0] - lead[1][0], lead[0][1] - lead[1][1])
                ray = LineString([lead[0], (lead[0][0] + dx * 300, lead[0][1] + dy * 300)])
                best = None
                for kk in tree.query(ray):
                    kk = int(kk)
                    for pt in _pts(ray.intersection(geoms[kk])):
                        d = math.dist(pt, lead[0])
                        if best is None or d < best[0]:
                            best = (d, kk, pt)
                if best:
                    cands.append(("osm lead-in extended to taxi line", best[1],
                                  geoms[best[1]].project(Point(best[2])), [best[2]] + lead))
            # D) straight back along the stand centreline to the first taxi edge
            ray = LineString([S, (S[0] - hx * 320, S[1] - hy * 320)])
            best = None
            for kk in tree.query(ray):
                kk = int(kk)
                for pt in _pts(ray.intersection(geoms[kk])):
                    d = math.dist(pt, S)
                    if d < 12:
                        continue
                    if best is None or d < best[0]:
                        best = (d, kk, pt)
            if best:
                cands.append(("derived: straight along stand centreline", best[1],
                              geoms[best[1]].project(Point(best[2])), [best[2], S]))
            # E) smooth curve from the nearest taxi edge
            k = int(tree.nearest(Point(S)))
            q = nearest_points(geoms[k], Point(S))[0]
            cands.append(("derived: smooth curve from nearest taxi line", k, geoms[k].project(q),
                          _bezier(geoms[k], q, S, (hx, hy))))
            choice = next((c for c in cands if not crosses_building(c[3])), None)
            if choice is None:
                choice = cands[0]
                n_bad += 1
                s["link_warning"] = "stand link crosses a building footprint"
            s["link_source"] = choice[0]
            reqs.append((si, cand[choice[1]], choice[2], choice[3]))
        if n_bad:
            log(f"  WARNING: {n_bad} stand links cross a building footprint")
            self.notes.append(f"{n_bad} stand links could not avoid crossing a building footprint")
        # split edges (grouped)
        by_edge = {}
        for si, ei, sv, link in reqs:
            by_edge.setdefault(ei, []).append(sv)
        node_at = {}
        for ei, svs in by_edge.items():
            res = g.split_edge_at(ei, svs, tol=3.0)
            for sv, nid in res.items():
                node_at[(ei, sv)] = nid
        for si, ei, sv, link in reqs:
            s = self.stands[si]
            entry = node_at[(ei, sv)]
            stop = g.add_node(s["x"], s["y"])
            pts = [g.nodes[entry]] + [p for p in link[1:-1]] + [(s["x"], s["y"])]
            # drop vertices closer than 0.5 m
            clean = [pts[0]]
            for p in pts[1:]:
                if math.dist(p, clean[-1]) > 0.5:
                    clean.append(p)
            if len(clean) < 2:
                clean = [g.nodes[entry], (s["x"], s["y"])]
            g.add_edge(entry, stop, "stand_link", s["id"], clean,
                       source="osm" if s.get("link_source", "").startswith("osm") else "derived")
            s["entry_node"] = entry
            s["stop_node"] = stop
            if not s.get("lead_in"):
                s["lead_in"] = clean
        log(f"  stands attached: {len(reqs)}")

    # ------------------------------------------------------------------ exits
    def build_exits(self):
        g = self.g
        inc = {}
        for i, e in enumerate(g.edges):
            inc.setdefault(e["a"], []).append(i)
            inc.setdefault(e["b"], []).append(i)
        self.rapid_ways = set()
        for rw in self.runways:
            line = rw["line"]
            L = line.length
            ux, uy = stmod.unit(rw["e1"][0] - rw["e0"][0], rw["e1"][1] - rw["e0"][1])
            rnodes = set()
            for e in g.edges:
                if e["kind"] == "runway" and e["ref"] == rw["id"]:
                    rnodes.update((e["a"], e["b"]))
            exits = []
            for n in rnodes:
                taxi_edges = [i for i in inc.get(n, []) if g.edges[i]["kind"] in ("taxiway", "taxilane")]
                if not taxi_edges:
                    continue
                s_n = line.project(Point(g.nodes[n]))
                for k, des in enumerate(rw["des"]):
                    dirx, diry = (ux, uy) if k == 0 else (-ux, -uy)
                    s_thr = rw["thr_s"][des]
                    dist = (s_n - s_thr) if k == 0 else (s_thr - s_n)
                    if dist < 150:
                        continue
                    best = None
                    for i in taxi_edges:
                        e = g.edges[i]
                        pts = e["pts"] if e["a"] == n else e["pts"][::-1]
                        el = LineString(pts)
                        far = el.interpolate(min(60.0, el.length))
                        vx, vy = stmod.unit(far.x - pts[0][0], far.y - pts[0][1])
                        ang = math.degrees(math.acos(max(-1, min(1, vx * dirx + vy * diry))))
                        if ang <= 100 and (best is None or ang < best[0]):
                            best = (ang, i)
                    if best is None:
                        continue
                    ang, i = best
                    e = g.edges[i]
                    rapid = 15 <= ang <= 45
                    if rapid and e.get("way"):
                        self.rapid_ways.add(e["way"])
                    exits.append({"node": n, "from_end": des, "distance_from_threshold_m": round(dist, 1),
                                  "angle_deg": round(ang, 1), "rapid": rapid, "taxiway_ref": e["ref"] or None})
            exits.sort(key=lambda x: (rw["des"].index(x["from_end"]), x["distance_from_threshold_m"]))
            rw["exits"] = exits
            for des in rw["des"]:
                ex = [x for x in exits if x["from_end"] == des]
                log(f"  {rw['id']} landing {des}: {len(ex)} exits ({sum(1 for x in ex if x['rapid'])} rapid) at "
                    + ", ".join(f"{x['distance_from_threshold_m']:.0f}{'R' if x['rapid'] else ''}" for x in ex))

    # ------------------------------------------------------------------ output
    def assemble(self):
        g = self.g
        g.drop_unused_nodes()
        order = sorted(g.nodes, key=lambda n: (round(g.nodes[n][0], 1), round(g.nodes[n][1], 1), n))
        remap = {old: new for new, old in enumerate(order)}
        nodes = [{"id": remap[n], "x": r1(g.nodes[n][0]), "y": r1(g.nodes[n][1])} for n in order]
        edges = []
        for e in g.edges:
            pts = LineString(e["pts"]).simplify(0.15).coords if len(e["pts"]) > 2 else e["pts"]
            pts = list(pts)
            ed = {"a": remap[e["a"]], "b": remap[e["b"]], "kind": e["kind"], "ref": e["ref"] or "",
                  "length_m": round(polyline_length(e["pts"]), 1), "points": pts_out(pts)}
            if e.get("source") == "derived":
                ed["source"] = "derived"
            edges.append(ed)
        edges.sort(key=lambda d: (d["a"], d["b"], d["kind"]))
        runways = []
        for rw in self.runways:
            ends = []
            for k, des in enumerate(rw["des"]):
                end_xy = rw["e0"] if k == 0 else rw["e1"]
                thr = g.nodes[rw["thr_nodes"][k]]
                aip_t = next((t for t in (rw["aip"].get("thresholds") or []) if t["designator"] == des), {})
                ends.append({"designator": des, "x": r1(thr[0]), "y": r1(thr[1]),
                             "heading_true": round(rw["h"][k], 2),
                             "threshold_node": remap[rw["thr_nodes"][k]],
                             "displaced_threshold_m": round(abs(rw["thr_s"][des] - (0.0 if k == 0 else rw["line"].length)), 1),
                             "end_x": r1(end_xy[0]), "end_y": r1(end_xy[1]),
                             "end_node": remap[rw["end_nodes"][k]],
                             "elevation_m": aip_t.get("elevation_m")})
            exits = [dict(x, node=remap[x["node"]]) for x in rw["exits"]]
            pieces = ",".join(f"way/{e['id']}" for e, _ in rw["pieces"])
            runways.append({"id": rw["id"], "width_m": rw["width"], "length_m": round(rw["length_geo"], 1),
                            "surface": rw["surface"], "ends": ends, "exits": exits,
                            "aip_length_m": rw["aip"].get("length_m"), "aip_width_m": rw["aip"].get("width_m"),
                            "source": f"osm:{pieces}; ends/headings from OSM centreline (geodesic); width, "
                                      f"thresholds and elevations from GCAA eAIP AD 2.12 (data/reference/airports.json)"})
        taxiways = []
        for t in self.taxi_ways:
            kind = "rapid_exit" if t["osm_id"] in self.rapid_ways else t["kind"]
            tw = {"id": t.get("id") or f"osm-w{t['osm_id']}", "ref": t["ref"] or None, "kind": kind,
                  "width_m": t["width"], "points": pts_out(LineString(t["pts"]).simplify(0.2).coords)}
            if t.get("source") == "derived":
                tw["source"] = "derived"
            taxiways.append(tw)
        stands = []
        for s in sorted(self.stands, key=lambda s: _natkey(s["id"])):
            st = {"id": s["id"], "ref": s.get("ref"), "x": r1(s["x"]), "y": r1(s["y"]),
                  "heading": round(s["heading"] % 360.0, 1),
                  "lead_in": pts_out(LineString(s["lead_in"]).simplify(0.2).coords) if s.get("lead_in") else None,
                  "kind": s["kind"], "contact": s["contact"],
                  "bridge_root": [r1(s["bridge_root"][0]), r1(s["bridge_root"][1])] if s.get("bridge_root") else None,
                  "bridge_count": s["bridge_count"], "max_wingspan_m": s["max_wingspan_m"],
                  "size_code": s["size_code"], "entry_node": remap[s["entry_node"]],
                  "stop_node": remap[s["stop_node"]], "area": s.get("area"),
                  "source": s["source"],
                  "derived_fields": "heading" if "derived" in s.get("heading_source", "") else None}
            df = ["kind", "contact", "max_wingspan_m", "size_code", "bridge_count", "area"]
            if "derived" in s.get("heading_source", ""):
                df.append("heading")
            if s.get("bridge_root"):
                df.append("bridge_root")
            if not s.get("ref"):
                df.append("id")
            st["derived_fields"] = df
            if s.get("gate"):
                st["gate"] = s["gate"]
            if s.get("alt_refs"):
                st["alt_refs"] = sorted(set(s["alt_refs"]))
            st["conflicts"] = s.get("conflicts", [])
            st["link_source"] = s.get("link_source")
            if s.get("derivation"):
                st["derivation"] = s["derivation"]
            stands.append(st)
        allx = [p[0] for p in self.aerodrome.exterior.coords] if self.aerodrome.geom_type == "Polygon" else \
            [p[0] for q in self.aerodrome.geoms for p in q.exterior.coords]
        minx, miny, maxx, maxy = self.aerodrome.bounds
        rminx, rminy, rmaxx, rmaxy = self.region.bounds
        aero_poly = max(polys_of(self.aerodrome), key=lambda p: p.area)
        layout = {
            "icao": self.icao, "iata": self.cfg["iata"], "name": self.cfg["name"], "city": self.cfg["city"],
            "arp": dict(self.cfg["arp"]),
            "projection": config.projection_string(self.icao),
            "bounds": {"min_x": r1(minx), "min_y": r1(miny), "max_x": r1(maxx), "max_y": r1(maxy)},
            "context_bounds": {"min_x": r1(rminx), "min_y": r1(rminy), "max_x": r1(rmaxx), "max_y": r1(rmaxy)},
            "provenance": {
                "osm_timestamp": self.osm_ts, "license": LICENSE,
                "osm_source": "Geofabrik gcc-states-261025.osm.pbf (data up to 2026-10-25T21:21:21Z)",
                "arp_source": self.cfg["arp_source"],
                "generator": "pipeline/osm/build_layout.py",
                "aerodrome_boundary": self.aerodrome_src,
                "notes": self.notes,
            },
            "aerodrome_boundary": ring_out(ccw(aero_poly), simplify=1.0)[0],
            "runways": runways,
            "taxiways": taxiways,
            "aprons": [{k: v for k, v in a.items() if not k.startswith("_")} for a in self.aprons],
            "buildings": self.buildings,
            "stands": stands,
            "taxi_graph": {"nodes": nodes, "edges": edges},
            "roads": self.roads,
            "landuse": self.landuse,
            "context_buildings": self.context,
        }
        self.layout = layout
        return layout


def _pts(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Point":
        return [(geom.x, geom.y)]
    if hasattr(geom, "geoms"):
        out = []
        for g in geom.geoms:
            out.extend(_pts(g))
        return out
    if geom.geom_type == "LineString":
        return [tuple(geom.coords[0])]
    return []


def _bezier(edge_line, q, S, h, n=12):
    """cubic Bezier from q (on edge, tangent along the edge towards S side) to S arriving with heading h."""
    s = edge_line.project(q)
    a = edge_line.interpolate(max(0, s - 1))
    b = edge_line.interpolate(min(edge_line.length, s + 1))
    tx, ty = stmod.unit(b.x - a.x, b.y - a.y)
    # choose the tangent direction that points more towards the stand
    if (S[0] - q.x) * tx + (S[1] - q.y) * ty < 0:
        tx, ty = -tx, -ty
    d = math.dist((q.x, q.y), S)
    k = max(10.0, d * 0.4)
    p0 = (q.x, q.y)
    p1 = (q.x + tx * k, q.y + ty * k)
    p2 = (S[0] - h[0] * k, S[1] - h[1] * k)
    p3 = S
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        pts.append((mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                    mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1]))
    return pts


def _natkey(s):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


def graph_check(ap: Airport, layout: dict) -> list[str]:
    """connectivity statistics for debug_graph_check.txt"""
    L = []
    nodes = {n["id"]: (n["x"], n["y"]) for n in layout["taxi_graph"]["nodes"]}
    G = nx.Graph()
    G.add_nodes_from(nodes)
    for e in layout["taxi_graph"]["edges"]:
        G.add_edge(e["a"], e["b"], length=e["length_m"])
    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    main = comps[0] if comps else set()
    L.append(f"airport: {layout['icao']} / {layout['iata']} {layout['name']}")
    L.append(f"nodes: {G.number_of_nodes()}  edges: {len(layout['taxi_graph']['edges'])}  components: {len(comps)}")
    kinds = {}
    for e in layout["taxi_graph"]["edges"]:
        k = kinds.setdefault(e["kind"], [0, 0.0])
        k[0] += 1
        k[1] += e["length_m"]
    for k, (n, l) in sorted(kinds.items()):
        L.append(f"  edges {k:<10} {n:5d}  total {l / 1000:8.2f} km")
    L.append(f"largest component: {len(main)} nodes ({100.0 * len(main) / max(1, G.number_of_nodes()):.1f}%)")
    for c in comps[1:6]:
        L.append(f"  other component: {len(c)} nodes")
    deg = dict(G.degree())
    L.append(f"dead-end nodes (degree 1): {sum(1 for v in deg.values() if v == 1)} "
             f"(of which stand stop nodes: {sum(1 for s in layout['stands'] if deg.get(s['stop_node']) == 1)})")
    L.append(f"junction nodes (degree >= 3): {sum(1 for v in deg.values() if v >= 3)}")
    st = ap.gstats
    L.append(f"topology fixes: crossings added {st['crossings_added']}, endpoint snaps (<=3 m) {st['endpoint_snaps']}, "
             f"endpoint extensions {st['endpoint_extensions']}, nodes merged {st['merged_nodes']}, "
             f"gap bridges {st['bridges']}, dropped fragments {st['dropped_fragments']} "
             f"({st['dropped_fragment_length_m']:.0f} m)")
    for f in st["fixes"]:
        L.append(f"   - {f}")
    ends = [(r["id"], e["designator"], e["threshold_node"], e["end_node"]) for r in layout["runways"] for e in r["ends"]]
    for rid, des, tn, en in ends:
        L.append(f"runway end {des} ({rid}): threshold node {tn} in main={tn in main}, end node {en} in main={en in main}")
    ex_nodes = [x["node"] for r in layout["runways"] for x in r["exits"]]
    L.append(f"runway exits: {len(ex_nodes)}, in main component: {sum(1 for n in ex_nodes if n in main)}")
    for r in layout["runways"]:
        for e in r["ends"]:
            ex = [x for x in r["exits"] if x["from_end"] == e["designator"]]
            L.append(f"  landing {e['designator']}: {len(ex)} exits, rapid {sum(1 for x in ex if x['rapid'])}; "
                     f"first at {min([x['distance_from_threshold_m'] for x in ex] or [0]):.0f} m")
    sn = [s["stop_node"] for s in layout["stands"]]
    in_main = sum(1 for n in sn if n in main)
    L.append(f"stands: {len(sn)}, stop node in main component: {in_main} ({100.0 * in_main / max(1, len(sn)):.1f}%)")
    # reachability: every stand from every runway end
    bad = 0
    for rid, des, tn, en in ends:
        reach = nx.node_connected_component(G, tn)
        for s in layout["stands"]:
            if s["stop_node"] not in reach:
                bad += 1
    L.append(f"stand x runway-end pairs unreachable: {bad}")
    # sample path lengths
    if ends and layout["stands"]:
        tn = ends[0][2]
        dist = nx.single_source_dijkstra_path_length(G, tn, weight="length")
        ds = [dist.get(s["stop_node"]) for s in layout["stands"] if s["stop_node"] in dist]
        if ds:
            L.append(f"taxi distance threshold {ends[0][1]} -> stands: min {min(ds):.0f} m, "
                     f"median {sorted(ds)[len(ds) // 2]:.0f} m, max {max(ds):.0f} m")
    # stand summary
    from collections import Counter

    L.append("stands by kind: " + str(dict(Counter(s["kind"] for s in layout["stands"]))))
    L.append("stands by size code: " + str(dict(sorted(Counter(s["size_code"] for s in layout["stands"]).items()))))
    L.append("stands by source: " + str(dict(Counter("derived" if s["source"].startswith("derived") else "osm"
                                                      for s in layout["stands"]))))
    return L


def build(icao, plot=True):
    t0 = time.time()
    ap = Airport(icao)
    ap.load()
    ap.build_runways()
    ap.crosscheck_runways()
    ap.collect_lines()
    ap.build_buildings()
    ap.build_surfaces()
    ap.build_stands()
    targets = {"OMAA": 50, "OMDB": 100, "OMSJ": 25}
    ap.synthesize_stands(targets)
    ap.classify_stands()
    ap.derive_taxilanes()
    ap.build_graph()
    ap.runway_nodes()
    ap.spur_stands()
    ap.finalize_stands()
    ap.attach_stands()
    ap.build_exits()
    ap.build_context()
    layout = ap.assemble()
    out = ap.dir / "layout.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(layout, f, ensure_ascii=False, separators=(",", ":"))
    log(f"  wrote {out} ({out.stat().st_size / 1e6:.2f} MB)")
    chk = graph_check(ap, layout)
    chk += [""] + ["OSM vs AIP runway cross-check:"] + [json.dumps(x, ensure_ascii=False) for x in ap.xcheck]
    (ap.dir / "debug_graph_check.txt").write_text("\n".join(chk) + "\n", encoding="utf-8")
    (ap.dir / "runway_crosscheck.json").write_text(json.dumps(ap.xcheck, indent=1), encoding="utf-8")
    for line in chk[:40]:
        log("   | " + line)
    if plot:
        import debug_plot

        debug_plot.plot_layout(layout, ap.dir / "debug_layout.png")
        log(f"  wrote {ap.dir / 'debug_layout.png'}")
    log(f"{icao} done in {time.time() - t0:.0f}s")
    return layout


def main():
    p = argparse.ArgumentParser()
    p.add_argument("icao", nargs="*", default=list(config.AIRPORTS))
    p.add_argument("--no-plot", action="store_true")
    a = p.parse_args()
    for icao in a.icao:
        build(icao, plot=not a.no_plot)


if __name__ == "__main__":
    main()
