"""Fetch + cache raw OpenStreetMap data for SKYPACT (OMAA, OMDB, OMSJ + national basemap).

Source: the Geofabrik "GCC States" extract (one polite bulk download, ODbL).  On the
retrieval day (2026-10-26) every public Overpass endpoint answered 502/504 "at
capacity", so instead of hammering them the pipeline reads one PBF snapshot and cuts
the areas it needs.  Output is Overpass-like JSON:

  data/airports/<ICAO>/osm_raw.json          airport core box: aeroway, buildings, roads, landuse ...
  data/airports/<ICAO>/osm_context_raw.json  surrounding city box (+ DXB skyline >= 60 m)
  pipeline/osm/cache/national_raw.json       coastline, major roads, places for the national bbox

Element format (differs from Overpass only in the compact geometry encoding):
  {"type":"node","id":1,"lat":..,"lon":..,"tags":{}}
  {"type":"way","id":2,"nodes":[ids],"geometry":[[lon,lat],...],"tags":{}}
  {"type":"relation","id":3,"tags":{},"members":[{"type":"way","ref":..,"role":"outer","geometry":[[lon,lat],..]}]}

Re-running is offline: the PBF is cached in pipeline/osm/cache/ (git-ignored) and the
extracts are only rebuilt with --force.

Usage (from the repo root):
  uv run --project pipeline python pipeline/osm/fetch_osm.py [--force]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402
from osmutil import parse_height  # noqa: E402

# keys that make a way/relation interesting inside the airport core box
CORE_KEYS = (
    "aeroway", "area:aeroway", "building", "building:part", "highway", "landuse", "natural",
    "leisure", "amenity", "water", "waterway", "man_made", "railway", "parking",
)
# keys kept in the surrounding-city box
CONTEXT_KEYS = ("building", "building:part", "highway", "landuse", "natural", "leisure", "water",
                "waterway", "railway", "amenity")
SKIP_HIGHWAY = {
    "footway", "path", "steps", "cycleway", "bridleway", "corridor", "elevator", "proposed",
    "construction", "platform", "bus_stop", "track", "via_ferrata", "escape", "raceway",
    "abandoned", "disused", "emergency_bay", "services", "rest_area",
}
NODE_KEYS = ("aeroway", "place")
# regional features whose bbox merely overlaps an airport box (Arabian Peninsula, Arabian
# Gulf, Rub' al Khali ...) are useless for an airport scene and weigh tens of MB
REGIONAL_NATURAL = {"peninsula", "bay", "strait", "cape", "sea", "isthmus", "ridge", "valley",
                    "desert", "mountain_range", "plateau"}
MAX_SPAN_DEG = 0.25  # ~25 km
NATIONAL_HIGHWAYS = {"motorway", "trunk", "primary", "motorway_link", "trunk_link"}
NATIONAL_PLACES = {"city", "town", "village", "suburb", "island"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------------------- download

def md5sum(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_pbf() -> Path:
    import requests

    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pbf = config.PBF_FILE
    if pbf.exists() and md5sum(pbf) == config.PBF_MD5:
        log(f"using cached {pbf.name}")
        return pbf
    log(f"downloading {config.PBF_URL}")
    delay = 10
    for attempt in range(6):
        try:
            with requests.get(config.PBF_URL, headers={"User-Agent": config.USER_AGENT},
                              stream=True, timeout=120) as r:
                r.raise_for_status()
                tmp = pbf.with_suffix(".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            tmp.replace(pbf)
            break
        except Exception as e:  # network trouble: exponential backoff
            log(f"download failed ({e}); retry in {delay}s")
            time.sleep(delay)
            delay *= 2
    else:
        raise SystemExit("could not download the PBF extract")
    got = md5sum(pbf)
    if got != config.PBF_MD5:
        raise SystemExit(f"md5 mismatch for {pbf}: {got}")
    return pbf


# ---------------------------------------------------------------------------- helpers

def bbox_hit(b, region):
    """b, region = (min_lon, min_lat, max_lon, max_lat)."""
    return not (b[2] < region[0] or b[0] > region[2] or b[3] < region[1] or b[1] > region[3])


def tags_of(o) -> dict:
    return {t.k: t.v for t in o.tags}


def interesting(tags: dict, keys) -> bool:
    return any(k in tags for k in keys)


def is_tall(tags: dict, min_h: float) -> bool:
    h = parse_height(tags.get("height"))
    if h is not None:
        return h >= min_h
    lv = parse_height(tags.get("building:levels"))
    return lv is not None and lv * 3.5 >= min_h


def regional(tags: dict, b) -> bool:
    """True for huge regional features (skipped in the airport extracts)."""
    if tags.get("natural") in REGIONAL_NATURAL or tags.get("place") in ("sea", "ocean", "region", "state",
                                                                        "country", "archipelago"):
        return True
    if tags.get("natural") == "coastline":
        return False
    return (b[2] - b[0]) > MAX_SPAN_DEG or (b[3] - b[1]) > MAX_SPAN_DEG


def context_ok(tags: dict) -> bool:
    if "highway" in tags:
        return tags["highway"] not in SKIP_HIGHWAY
    if "amenity" in tags and not ("building" in tags or tags.get("amenity") == "parking"):
        return False
    return interesting(tags, CONTEXT_KEYS)


# ---------------------------------------------------------------------------- extraction

def extract(pbf: Path):
    import osmium

    airports = config.AIRPORTS
    nat = config.NATIONAL_BBOX
    nat_m = (nat[0] - 0.05, nat[1] - 0.05, nat[2] + 0.05, nat[3] + 0.05)
    skyline = {icao: config.skyline_bbox(icao) for icao in airports}

    out = {icao: {"core": {}, "context": {}} for icao in airports}
    national = {}

    # pass 1: multipolygon relations (no locations needed)
    t0 = time.time()
    rels = {}
    for o in osmium.FileProcessor(str(pbf), osmium.osm.RELATION):
        tags = tags_of(o)
        if tags.get("type") not in ("multipolygon", "boundary") and tags.get("aeroway") != "aerodrome":
            continue
        if tags.get("type") == "boundary" and tags.get("aeroway") != "aerodrome":
            continue
        if not interesting(tags, CORE_KEYS):
            continue
        rels[o.id] = {"type": "relation", "id": o.id, "tags": tags,
                      "members": [{"type": {"n": "node", "w": "way", "r": "relation"}[m.type],
                                   "ref": m.ref, "role": m.role} for m in o.members]}
    member_ways = {m["ref"] for r in rels.values() for m in r["members"] if m["type"] == "way"}
    log(f"pass 1: {len(rels)} candidate multipolygon relations, {len(member_ways)} member ways "
        f"({time.time() - t0:.0f}s)")

    # pass 2: ways with node locations
    t0 = time.time()
    member_geom = {}
    n_ways = 0
    fp = (osmium.FileProcessor(str(pbf), osmium.osm.NODE | osmium.osm.WAY)
          .with_locations()
          .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)))
    for o in fp:
        n_ways += 1
        wid = o.id
        is_member = wid in member_ways
        if not is_member and len(o.tags) == 0:
            continue
        tags = tags_of(o)
        core_int = interesting(tags, CORE_KEYS)
        coast = tags.get("natural") == "coastline"
        nat_road = tags.get("highway") in NATIONAL_HIGHWAYS
        if not (is_member or core_int or coast):
            continue
        try:
            geom = [(round(n.lon, 7), round(n.lat, 7)) for n in o.nodes]
            refs = [n.ref for n in o.nodes]
        except Exception:
            continue  # incomplete way (should not happen inside the extract)
        if len(geom) < 2:
            continue
        xs = [g[0] for g in geom]
        ys = [g[1] for g in geom]
        b = (min(xs), min(ys), max(xs), max(ys))
        if is_member:
            member_geom[wid] = geom
        el = None
        if core_int and not regional(tags, b):
            for icao, ap in airports.items():
                if bbox_hit(b, ap["core_bbox"]):
                    el = el or {"type": "way", "id": wid, "nodes": refs, "geometry": geom, "tags": tags}
                    out[icao]["core"][("way", wid)] = el
                elif bbox_hit(b, ap["context_bbox"]) and context_ok(tags):
                    el = el or {"type": "way", "id": wid, "nodes": refs, "geometry": geom, "tags": tags}
                    out[icao]["context"][("way", wid)] = el
                elif skyline[icao] and bbox_hit(b, skyline[icao]) and \
                        ("building" in tags or "building:part" in tags) and \
                        is_tall(tags, ap["skyline"]["min_height_m"]):
                    el = el or {"type": "way", "id": wid, "nodes": refs, "geometry": geom, "tags": tags}
                    out[icao]["context"][("way", wid)] = el
        if (coast or nat_road) and bbox_hit(b, nat_m):
            national[("way", wid)] = {"type": "way", "id": wid, "geometry": geom, "tags": tags}
    log(f"pass 2: scanned {n_ways} ways ({time.time() - t0:.0f}s)")

    # relations: attach member geometry, assign to regions
    for rid, r in rels.items():
        geoms = []
        for m in r["members"]:
            if m["type"] == "way" and m["ref"] in member_geom:
                m["geometry"] = member_geom[m["ref"]]
                geoms.extend(member_geom[m["ref"]])
        if not geoms:
            continue
        xs = [g[0] for g in geoms]
        ys = [g[1] for g in geoms]
        b = (min(xs), min(ys), max(xs), max(ys))
        tags = r["tags"]
        if regional(tags, b):
            continue
        for icao, ap in airports.items():
            if bbox_hit(b, ap["core_bbox"]):
                out[icao]["core"][("relation", rid)] = r
            elif bbox_hit(b, ap["context_bbox"]) and context_ok(tags):
                out[icao]["context"][("relation", rid)] = r
            elif skyline[icao] and bbox_hit(b, skyline[icao]) and \
                    ("building" in tags or "building:part" in tags) and \
                    is_tall(tags, ap["skyline"]["min_height_m"]):
                out[icao]["context"][("relation", rid)] = r

    # pass 3: tagged nodes (aeroway=*, place=*), filtered in C++
    t0 = time.time()
    fp = osmium.FileProcessor(str(pbf), osmium.osm.NODE).with_filter(osmium.filter.KeyFilter(*NODE_KEYS))
    for o in fp:
        tags = tags_of(o)
        lon, lat = round(o.location.lon, 7), round(o.location.lat, 7)
        el = {"type": "node", "id": o.id, "lat": lat, "lon": lon, "tags": tags}
        if "aeroway" in tags:
            for icao, ap in airports.items():
                if bbox_hit((lon, lat, lon, lat), ap["core_bbox"]):
                    out[icao]["core"][("node", o.id)] = el
        if tags.get("place") in NATIONAL_PLACES and bbox_hit((lon, lat, lon, lat), nat_m):
            national[("node", o.id)] = el
    log(f"pass 3: tagged nodes ({time.time() - t0:.0f}s)")
    return out, national


def write_json(path: Path, elements, extra: dict):
    doc = {
        "version": 0.6,
        "generator": "SKYPACT pipeline/osm/fetch_osm.py (pyosmium) from Geofabrik gcc-states-261025.osm.pbf",
        "osm3s": {
            "timestamp_osm_base": config.PBF_TIMESTAMP,
            "copyright": "The data included in this document is from www.openstreetmap.org. "
                         "The data is made available under ODbL.",
        },
        "extract": extra,
        "elements": elements,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB, {len(elements)} elements)")


def order(d: dict):
    rank = {"node": 0, "way": 1, "relation": 2}
    return [d[k] for k in sorted(d, key=lambda k: (rank[k[0]], k[1]))]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="re-extract even if the caches exist")
    args = ap.parse_args()

    targets = [config.airport_dir(i) / "osm_raw.json" for i in config.AIRPORTS]
    targets += [config.airport_dir(i) / "osm_context_raw.json" for i in config.AIRPORTS]
    targets.append(config.CACHE_DIR / "national_raw.json")
    if all(t.exists() for t in targets) and not args.force:
        log("all raw caches present; nothing to do (use --force to re-extract)")
        return

    pbf = ensure_pbf()
    out, national = extract(pbf)
    src = {"source": config.PBF_URL, "md5": config.PBF_MD5, "osm_timestamp": config.PBF_TIMESTAMP,
           "license": "ODbL 1.0, (c) OpenStreetMap contributors",
           "retrieved": "2026-10-26"}
    for icao, ap in config.AIRPORTS.items():
        d = config.airport_dir(icao)
        write_json(d / "osm_raw.json", order(out[icao]["core"]),
                   {**src, "bbox": ap["core_bbox"], "keys": list(CORE_KEYS)})
        write_json(d / "osm_context_raw.json", order(out[icao]["context"]),
                   {**src, "bbox": ap["context_bbox"], "keys": list(CONTEXT_KEYS),
                    "skyline_bbox": config.skyline_bbox(icao), "skyline": ap.get("skyline"),
                    "note": "elements already in osm_raw.json are not repeated"})
    write_json(config.CACHE_DIR / "national_raw.json", order(national),
               {**src, "bbox": config.NATIONAL_BBOX,
                "content": "natural=coastline, highway in motorway/trunk/primary(+links), place nodes"})


if __name__ == "__main__":
    main()
