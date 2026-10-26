"""Validate data/airports/<ICAO>/layout.json against docs/CONVENTIONS.md section 4.

Checks: schema keys and enums, no NaN/Inf, node/edge references, edge geometry vs nodes,
graph connectivity, every stand's stop_node reachable from every runway end, stand_link
edges, runway exits for every landing direction, runway heading sanity, size codes vs
wingspans, unique ids, file size.

  uv run --project pipeline python pipeline/osm/validate_layouts.py [OMAA OMDB OMSJ]
Exit code 1 if any check fails.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import networkx as nx  # noqa: E402

import config  # noqa: E402

TOP = ["icao", "iata", "name", "city", "arp", "projection", "bounds", "provenance", "runways", "taxiways",
       "aprons", "buildings", "stands", "taxi_graph", "roads", "landuse", "context_buildings"]
BUILDING_KINDS = {"terminal", "concourse", "hangar", "cargo", "tower", "fire_station", "car_park", "other"}
STAND_KINDS = {"contact", "remote", "cargo", "ga"}
EDGE_KINDS = {"taxiway", "taxilane", "runway", "stand_link"}
TAXIWAY_KINDS = {"taxiway", "taxilane", "rapid_exit"}
LANDUSE_KINDS = {"grass", "sand", "water", "parking", "landscaping"}
SIZE_LIMITS = [("A", 15.0), ("B", 24.0), ("C", 36.0), ("D", 52.0), ("E", 65.0), ("F", 80.0)]


class Report:
    def __init__(self, icao):
        self.icao = icao
        self.fail = []
        self.warn = []
        self.info = []

    def check(self, ok, msg):
        if not ok:
            self.fail.append(msg)
        return ok

    def w(self, msg):
        self.warn.append(msg)


def walk_numbers(obj, path="$"):
    if isinstance(obj, float):
        if not math.isfinite(obj):
            yield path
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_numbers(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_numbers(v, f"{path}[{i}]")


def is_pt(p):
    return isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(v, (int, float)) for v in p)


def code_for(span):
    for c, lim in SIZE_LIMITS:
        if c == "F":
            return "F"
        if span < lim:
            return c
    return "F"


def validate(icao) -> Report:
    r = Report(icao)
    path = config.AIRPORTS_DIR / icao / "layout.json"
    if not r.check(path.exists(), f"{path} missing"):
        return r
    size_mb = path.stat().st_size / 1e6
    raw = path.read_text(encoding="utf-8")
    r.check("NaN" not in raw and "Infinity" not in raw, "NaN/Infinity literal in file")
    L = json.loads(raw)
    r.info.append(f"file size {size_mb:.2f} MB")
    if size_mb > 8.0:
        r.w(f"file size {size_mb:.2f} MB > 8 MB target")
    for k in TOP:
        r.check(k in L, f"missing top-level key {k}")
    bad = list(walk_numbers(L))
    r.check(not bad, f"non-finite numbers at {bad[:5]}")
    r.check(L.get("icao") == icao, "icao mismatch")
    arp = L.get("arp", {})
    r.check(all(k in arp for k in ("lat", "lon", "elevation_m")), "arp needs lat/lon/elevation_m")
    r.check(L.get("projection", "").startswith("+proj=aeqd") and f"+lat_0={arp.get('lat')}" in L["projection"],
            "projection must be aeqd centred on the ARP")
    b = L.get("bounds", {})
    r.check(all(k in b for k in ("min_x", "min_y", "max_x", "max_y")) and b["min_x"] < b["max_x"] and
            b["min_y"] < b["max_y"], "bounds malformed")
    prov = L.get("provenance", {})
    r.check(all(k in prov for k in ("osm_timestamp", "license", "notes")), "provenance needs osm_timestamp/license/notes")

    # ---------------- graph
    tg = L["taxi_graph"]
    nodes = {}
    for n in tg["nodes"]:
        r.check(isinstance(n.get("id"), int) and is_pt([n.get("x"), n.get("y")]), f"bad node {n}")
        r.check(n["id"] not in nodes, f"duplicate node id {n['id']}")
        nodes[n["id"]] = (n["x"], n["y"])
    G = nx.Graph()
    G.add_nodes_from(nodes)
    edge_set = {}
    for i, e in enumerate(tg["edges"]):
        for k in ("a", "b", "kind", "ref", "length_m", "points"):
            r.check(k in e, f"edge {i} missing {k}")
        if not r.check(e["a"] in nodes and e["b"] in nodes, f"edge {i} references unknown node"):
            continue
        r.check(e["kind"] in EDGE_KINDS, f"edge {i} bad kind {e['kind']}")
        pts = e["points"]
        r.check(len(pts) >= 2 and all(is_pt(p) for p in pts), f"edge {i} bad points")
        pl = sum(math.dist(pts[j], pts[j + 1]) for j in range(len(pts) - 1))
        r.check(abs(pl - e["length_m"]) <= max(1.0, 0.01 * pl), f"edge {i} length_m {e['length_m']} != polyline {pl:.1f}")
        r.check(math.dist(pts[0], nodes[e["a"]]) <= 0.25 and math.dist(pts[-1], nodes[e["b"]]) <= 0.25,
                f"edge {i} end points do not match its nodes")
        r.check(e["a"] != e["b"], f"edge {i} is a self loop")
        G.add_edge(e["a"], e["b"], length=e["length_m"])
        edge_set.setdefault((min(e["a"], e["b"]), max(e["a"], e["b"])), []).append(e)
    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    main = comps[0] if comps else set()
    r.info.append(f"graph: {len(nodes)} nodes, {len(tg['edges'])} edges, {len(comps)} component(s), "
                  f"largest {len(main)} nodes")
    iso = [n for n in nodes if G.degree(n) == 0]
    r.check(not iso, f"{len(iso)} isolated nodes")

    # ---------------- runways
    rwy_nodes = []
    for rw in L["runways"]:
        for k in ("id", "width_m", "length_m", "surface", "ends", "exits", "source"):
            r.check(k in rw, f"runway {rw.get('id')} missing {k}")
        ends = rw["ends"]
        if not r.check(len(ends) == 2, f"runway {rw['id']} needs 2 ends"):
            continue
        for en in ends:
            for k in ("designator", "x", "y", "heading_true", "threshold_node"):
                r.check(k in en, f"runway end {en.get('designator')} missing {k}")
            r.check(0 <= en["heading_true"] < 360, f"runway end {en['designator']} heading out of range")
            r.check(en["threshold_node"] in main, f"threshold node of {en['designator']} not in main component")
            r.check(math.dist((en["x"], en["y"]), nodes.get(en["threshold_node"], (1e9, 1e9))) < 1.0,
                    f"threshold node of {en['designator']} not at the end coordinates")
            if "end_node" in en:
                r.check(en["end_node"] in main, f"end node of {en['designator']} not in main component")
                rwy_nodes.append(en["end_node"])
            rwy_nodes.append(en["threshold_node"])
            num = int("".join(ch for ch in en["designator"] if ch.isdigit()))
            r.check(abs(((num * 10 + 2) - en["heading_true"] + 180) % 360 - 180) < 8,
                    f"runway end {en['designator']} heading {en['heading_true']} inconsistent with designator")
            ex = [x for x in rw["exits"] if x["from_end"] == en["designator"]]
            r.check(len(ex) >= 1, f"no runway exits for landing {en['designator']}")
            r.info.append(f"runway {en['designator']}: {len(ex)} exits ({sum(1 for x in ex if x['rapid'])} rapid), "
                          f"heading {en['heading_true']}")
        d = abs((ends[0]["heading_true"] - ends[1]["heading_true"]) % 360 - 180)
        r.check(d < 0.5, f"runway {rw['id']} end headings not reciprocal ({d:.2f})")
        for x in rw["exits"]:
            for k in ("node", "from_end", "distance_from_threshold_m", "angle_deg", "rapid"):
                r.check(k in x, f"exit missing {k}")
            r.check(x["node"] in main, f"exit node {x['node']} not in main component")
            r.check(x["distance_from_threshold_m"] > 0, "exit before threshold")
        if rw.get("aip_length_m"):
            r.info.append(f"runway {rw['id']}: OSM {rw['length_m']} m vs AIP {rw['aip_length_m']} m")

    # ---------------- taxiways / aprons / buildings / roads / landuse / context
    for t in L["taxiways"]:
        r.check(t.get("kind") in TAXIWAY_KINDS and len(t.get("points", [])) >= 2 and t.get("width_m", 0) > 0,
                f"bad taxiway {t.get('id')}")
    for a in L["aprons"]:
        r.check(len(a.get("polygon", [])) >= 3 and "holes" in a and "id" in a, f"bad apron {a.get('id')}")
    ids = set()
    kinds = {}
    for bd in L["buildings"]:
        r.check(bd.get("kind") in BUILDING_KINDS, f"building {bd.get('id')} bad kind")
        r.check(len(bd.get("footprint", [])) >= 3 and "holes" in bd, f"building {bd.get('id')} bad footprint")
        r.check(bd.get("height_m", 0) > 0 and bd.get("levels", 0) >= 1, f"building {bd.get('id')} bad height/levels")
        r.check(bd.get("source") in ("osm", "derived"), f"building {bd.get('id')} bad source")
        r.check(bd["id"] not in ids, f"duplicate building id {bd['id']}")
        ids.add(bd["id"])
        kinds[bd["kind"]] = kinds.get(bd["kind"], 0) + 1
    r.info.append("buildings by kind: " + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())))
    for rd in L["roads"]:
        r.check(len(rd.get("points", [])) >= 2 and rd.get("width_m", 0) > 0 and "kind" in rd, "bad road")
    for lu in L["landuse"]:
        r.check(lu.get("kind") in LANDUSE_KINDS and len(lu.get("polygon", [])) >= 3, f"bad landuse {lu.get('kind')}")
    for cb in L["context_buildings"]:
        r.check(len(cb.get("footprint", [])) >= 3 and cb.get("height_m", 0) > 0, "bad context building")
    r.info.append(f"roads {len(L['roads'])}, landuse {len(L['landuse'])}, context buildings {len(L['context_buildings'])}")

    # ---------------- stands
    sids = set()
    reach = {}
    for tn in set(rwy_nodes):
        reach[tn] = nx.node_connected_component(G, tn) if tn in G else set()
    unreachable = 0
    in_main = 0
    for s in L["stands"]:
        for k in ("id", "ref", "x", "y", "heading", "lead_in", "kind", "contact", "bridge_root", "bridge_count",
                  "max_wingspan_m", "size_code", "entry_node", "stop_node", "area", "source"):
            r.check(k in s, f"stand {s.get('id')} missing {k}")
        r.check(s["id"] not in sids, f"duplicate stand id {s['id']}")
        sids.add(s["id"])
        r.check(0 <= s["heading"] < 360, f"stand {s['id']} heading out of range")
        r.check(s["kind"] in STAND_KINDS, f"stand {s['id']} bad kind")
        r.check(s["source"] == "derived" or s["source"].startswith("osm:"), f"stand {s['id']} bad source {s['source']}")
        r.check(0 < s["max_wingspan_m"] <= 80, f"stand {s['id']} wingspan out of range")
        r.check(s["size_code"] == code_for(s["max_wingspan_m"]), f"stand {s['id']} size code inconsistent")
        r.check(s["contact"] == (s["kind"] == "contact"), f"stand {s['id']} contact flag vs kind")
        if s["contact"]:
            r.check(is_pt(s["bridge_root"]) and s["bridge_count"] >= 1, f"contact stand {s['id']} needs bridge data")
            exp = 1 if s["size_code"] in "ABC" else (2 if s["size_code"] in "DE" else 3)
            r.check(s["bridge_count"] == exp, f"stand {s['id']} bridge_count {s['bridge_count']} != {exp}")
        else:
            r.check(s["bridge_count"] == 0, f"remote stand {s['id']} has bridges")
        if s["lead_in"] is not None:
            r.check(len(s["lead_in"]) >= 2 and all(is_pt(p) for p in s["lead_in"]), f"stand {s['id']} bad lead_in")
        sn, en = s["stop_node"], s["entry_node"]
        r.check(sn in nodes and en in nodes, f"stand {s['id']} unknown nodes")
        if sn in nodes:
            r.check(math.dist(nodes[sn], (s["x"], s["y"])) < 0.25, f"stand {s['id']} stop node not at stand")
            in_main += sn in main
        links = edge_set.get((min(sn, en), max(sn, en)), [])
        r.check(any(e["kind"] == "stand_link" for e in links), f"stand {s['id']} has no stand_link edge")
        for tn, comp in reach.items():
            if sn not in comp:
                unreachable += 1
    ns = len(L["stands"])
    r.check(ns > 0, "no stands")
    r.check(in_main >= 0.95 * ns, f"only {in_main}/{ns} stands in the main component")
    r.check(unreachable == 0, f"{unreachable} (stand, runway end) pairs unreachable")
    kinds = {}
    codes = {}
    for s in L["stands"]:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
        codes[s["size_code"]] = codes.get(s["size_code"], 0) + 1
    r.info.append(f"stands {ns}: " + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())) +
                  " | codes " + ", ".join(f"{k} {v}" for k, v in sorted(codes.items())) +
                  f" | derived {sum(1 for s in L['stands'] if s['source'].startswith('derived'))}")
    r.info.append(f"stand stop nodes in main component: {in_main}/{ns}; reachable from all "
                  f"{len(reach)} runway end/threshold nodes: {unreachable == 0}")
    return r


def main():
    icaos = sys.argv[1:] or list(config.AIRPORTS)
    ok = True
    for icao in icaos:
        r = validate(icao)
        status = "PASS" if not r.fail else "FAIL"
        ok &= not r.fail
        print(f"== {icao}: {status}  ({len(r.fail)} failures, {len(r.warn)} warnings)")
        for m in r.info:
            print(f"   - {m}")
        for m in r.warn:
            print(f"   ! warning: {m}")
        for m in r.fail[:40]:
            print(f"   x {m}")
        if len(r.fail) > 40:
            print(f"   x ... {len(r.fail) - 40} more")
    print("ALL PASS" if ok else "SOME CHECKS FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
