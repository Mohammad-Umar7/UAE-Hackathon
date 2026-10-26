"""Build the regional basemap for SKYPACT (lon 54.0-56.0, lat 23.9-25.7) as compact GeoJSON
(EPSG:4326 lon/lat) in data/national/.

Inputs (all cached, the script is offline once fetch_osm.py has run and the Natural Earth
zips are in pipeline/osm/cache/naturalearth/):
  * pipeline/osm/cache/national_raw.json  OSM natural=coastline, motorway/trunk/primary, place nodes (ODbL)
  * Natural Earth 10m urban areas and admin-1 states/provinces (public domain)
  * data/airports/<ICAO>/layout.json      runway centrelines + aerodrome outlines of the 3 airports

Outputs:
  land.geojson, roads.geojson, urban_areas.geojson, emirates.geojson, places.geojson,
  airports.geojson, manifest.json

  uv run --project pipeline python pipeline/osm/build_national.py
"""
from __future__ import annotations

import io
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import shapefile  # noqa: E402  (pyshp)
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, mapping, shape  # noqa: E402
from shapely.ops import linemerge, unary_union  # noqa: E402

import config  # noqa: E402
from osmutil import Projector, coast_faces, load_raw  # noqa: E402

NE_DIR = config.CACHE_DIR / "naturalearth"
NE_URLS = {
    "ne_10m_urban_areas": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_urban_areas.zip",
    "ne_10m_admin_1_states_provinces": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip",
}
BBOX = box(*config.NATIONAL_BBOX)
OUT = config.NATIONAL_DIR
PREC = 5  # decimal places (~1 m)


def log(*a):
    print(*a, flush=True)


def rnd(geom):
    """round coordinates of a GeoJSON-like mapping to PREC decimals."""
    def r(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(c[0], PREC), round(c[1], PREC)]
        return [r(x) for x in c]

    g = dict(geom)
    g["coordinates"] = r(g["coordinates"])
    return g


def fc(features, name, extra=None):
    doc = {"type": "FeatureCollection", "name": name, "crs_note": "EPSG:4326 lon/lat (RFC 7946)",
           "features": features}
    if extra:
        doc.update(extra)
    return doc


def write(name, doc):
    p = OUT / name
    with open(p, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {p} ({p.stat().st_size / 1e6:.2f} MB, {len(doc.get('features', []))} features)")
    return p.stat().st_size


def ensure_ne():
    import requests

    NE_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in NE_URLS.items():
        p = NE_DIR / f"{name}.zip"
        if p.exists() and p.stat().st_size > 1000:
            continue
        log(f"downloading {url}")
        r = requests.get(url, headers={"User-Agent": config.USER_AGENT}, timeout=300)
        r.raise_for_status()
        p.write_bytes(r.content)


def read_shp_zip(path: Path):
    """yield (shapely geometry, record dict) from a zipped shapefile, without extracting."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()

        def member(ext):
            m = next(n for n in names if n.lower().endswith(ext))
            return io.BytesIO(z.read(m))

        rd = shapefile.Reader(shp=member(".shp"), dbf=member(".dbf"), shx=member(".shx"), encoding="utf-8")
        fields = [f[0] for f in rd.fields[1:]]
        for sr in rd.iterShapeRecords():
            try:
                g = shape(sr.shape.__geo_interface__)
            except Exception:
                continue
            yield g, dict(zip(fields, sr.record))


def clip_polys(g, simplify):
    if not g.intersects(BBOX):
        return None
    g = g.intersection(BBOX)
    if simplify:
        g = g.simplify(simplify, preserve_topology=True)
    if g.is_empty:
        return None
    polys = [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and p.area > 0]
    if not polys:
        return None
    return unary_union(polys)


def build_land(raw):
    coast = [LineString(e["geometry"]) for e in raw if e["type"] == "way"
             and e.get("tags", {}).get("natural") == "coastline" and len(e["geometry"]) >= 2]
    land, water = coast_faces(coast, BBOX, eps=1e-5)
    feats = []
    tot = 0
    for g in land:
        g = g.simplify(0.00015, preserve_topology=True)  # ~15 m
        if g.is_empty or g.area < 2e-7:  # drop specks < ~0.2 ha
            continue
        tot += 1
        feats.append({"type": "Feature", "properties": {"kind": "land"}, "geometry": rnd(mapping(g))})
    log(f"land: {len(coast)} coastline ways -> {len(land)} land faces, {len(water)} sea faces, kept {tot}")
    return fc(feats, "land", {"source": "OpenStreetMap natural=coastline (ODbL), land on the left of each way; "
                                        "polygonised and clipped to the bbox, simplified ~15 m"})


def build_roads(raw):
    groups = {}
    for e in raw:
        t = e.get("tags", {})
        hw = t.get("highway")
        if e["type"] != "way" or hw not in ("motorway", "trunk", "primary"):
            continue
        key = (hw, t.get("ref") or "", t.get("name:en") or t.get("name") or "")
        groups.setdefault(key, []).append(LineString(e["geometry"]))
    feats = []
    for (hw, ref, name), lines in sorted(groups.items()):
        merged = linemerge(MultiLineString(lines)) if len(lines) > 1 else lines[0]
        merged = merged.intersection(BBOX)
        if merged.is_empty:
            continue
        merged = merged.simplify(0.0001, preserve_topology=False)  # ~10 m
        parts = [g for g in getattr(merged, "geoms", [merged]) if g.geom_type == "LineString" and g.length > 0]
        if not parts:
            continue
        geom = MultiLineString(parts) if len(parts) > 1 else parts[0]
        props = {"kind": hw}
        if ref:
            props["ref"] = ref
        if name:
            props["name"] = name
        feats.append({"type": "Feature", "properties": props, "geometry": rnd(mapping(geom))})
    log(f"roads: {len(feats)} merged features")
    return fc(feats, "major_roads", {"source": "OpenStreetMap highway=motorway/trunk/primary (ODbL), merged by "
                                               "class+ref+name, simplified ~10 m (both carriageways kept)"})


def build_places(raw):
    rank = {"city": 1, "town": 2, "village": 3, "suburb": 4, "island": 5}
    feats = []
    for e in raw:
        t = e.get("tags", {})
        if e["type"] != "node" or t.get("place") not in rank:
            continue
        p = Point(e["lon"], e["lat"])
        if not BBOX.contains(p):
            continue
        name_en = t.get("name:en") or t.get("int_name")
        if not name_en and t.get("place") in ("village", "suburb", "island"):
            continue
        props = {"name": name_en or t.get("name"), "name_ar": t.get("name:ar") or t.get("name"),
                 "place": t["place"], "rank": rank[t["place"]]}
        try:
            props["population"] = int(str(t.get("population", "")).replace(",", "").split(";")[0])
        except ValueError:
            pass
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Point", "coordinates": [round(e["lon"], PREC), round(e["lat"], PREC)]}})
    feats.sort(key=lambda f: (f["properties"]["rank"], -(f["properties"].get("population") or 0)))
    log(f"places: {len(feats)}")
    return fc(feats, "places", {"source": "OpenStreetMap place=city/town/village/suburb/island nodes (ODbL); "
                                          "villages/suburbs/islands only with an English name"})


def build_urban():
    feats = []
    for g, rec in read_shp_zip(NE_DIR / "ne_10m_urban_areas.zip"):
        c = clip_polys(g, 0.0005)
        if c is None:
            continue
        feats.append({"type": "Feature", "properties": {"kind": "urban", "area_sqkm": rec.get("area_sqkm")},
                      "geometry": rnd(mapping(c))})
    log(f"urban areas: {len(feats)}")
    return fc(feats, "urban_areas", {"source": "Natural Earth 10m urban areas v4.1.0 (public domain), clipped to bbox"})


def build_emirates():
    feats = []
    for g, rec in read_shp_zip(NE_DIR / "ne_10m_admin_1_states_provinces.zip"):
        c = clip_polys(g, 0.0005)
        if c is None:
            continue
        feats.append({"type": "Feature",
                      "properties": {"name": rec.get("name_en") or rec.get("name"), "name_local": rec.get("name_local"),
                                     "iso_3166_2": rec.get("iso_3166_2"), "country": rec.get("admin"),
                                     "adm0_a3": rec.get("adm0_a3")},
                      "geometry": rnd(mapping(c))})
    log(f"admin-1 units in bbox: {[f['properties']['name'] for f in feats]}")
    return fc(feats, "emirates", {"source": "Natural Earth 10m admin-1 states/provinces v5.1.1 (public domain), clipped "
                                            "to bbox; includes the neighbouring Omani governorates inside the bbox"})


def build_airports():
    feats = []
    for icao, ap in config.AIRPORTS.items():
        p = config.AIRPORTS_DIR / icao / "layout.json"
        if not p.exists():
            log(f"  {p} missing - run build_layout.py first")
            continue
        L = json.loads(p.read_text(encoding="utf-8"))
        pr = Projector(L["projection"])
        feats.append({"type": "Feature", "properties": {"kind": "airport", "icao": icao, "iata": ap["iata"],
                                                        "name": ap["name"], "city": ap["city"],
                                                        "elevation_m": ap["arp"]["elevation_m"]},
                      "geometry": {"type": "Point", "coordinates": [ap["arp"]["lon"], ap["arp"]["lat"]]}})
        if L.get("aerodrome_boundary"):
            ring = pr.lonlat(L["aerodrome_boundary"])
            ring.append(ring[0])
            feats.append({"type": "Feature", "properties": {"kind": "aerodrome_boundary", "icao": icao},
                          "geometry": rnd(mapping(Polygon(ring)))})
        for rw in L["runways"]:
            e0, e1 = rw["ends"]
            a = (e0.get("end_x", e0["x"]), e0.get("end_y", e0["y"]))
            b = (e1.get("end_x", e1["x"]), e1.get("end_y", e1["y"]))
            ll = pr.lonlat([a, b])
            feats.append({"type": "Feature",
                          "properties": {"kind": "runway", "icao": icao, "iata": ap["iata"], "runway": rw["id"],
                                         "length_m": rw["length_m"], "width_m": rw["width_m"],
                                         "surface": rw["surface"],
                                         "ends": [{"designator": e["designator"], "heading_true": e["heading_true"]}
                                                  for e in rw["ends"]]},
                          "geometry": {"type": "LineString",
                                       "coordinates": [[round(x, 6), round(y, 6)] for x, y in ll]}})
    log(f"airports: {len(feats)} features")
    return fc(feats, "airports", {"source": "data/airports/<ICAO>/layout.json (OSM centrelines, ODbL); ARP from the "
                                            "GCAA eAIP AD 2.2"})


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ensure_ne()
    raw = load_raw(config.CACHE_DIR / "national_raw.json")["elements"]
    sizes = {}
    sizes["land.geojson"] = write("land.geojson", build_land(raw))
    sizes["roads.geojson"] = write("roads.geojson", build_roads(raw))
    sizes["urban_areas.geojson"] = write("urban_areas.geojson", build_urban())
    sizes["emirates.geojson"] = write("emirates.geojson", build_emirates())
    sizes["places.geojson"] = write("places.geojson", build_places(raw))
    sizes["airports.geojson"] = write("airports.geojson", build_airports())
    manifest = {
        "bbox_lonlat": list(config.NATIONAL_BBOX), "crs": "EPSG:4326 (lon, lat), coordinates rounded to 1e-5 deg",
        "files": {k: {"bytes": v} for k, v in sizes.items()},
        "total_geojson_mb": round(sum(sizes.values()) / 1e6, 2),
        "optional_raster": "s2_mosaic.jpg + s2_mosaic.json (EOX Sentinel-2 cloudless 2016, CC BY 4.0, EPSG:3857)",
        "sources": {
            "osm": "Geofabrik gcc-states-261025.osm.pbf, OSM data up to 2026-10-25T21:21:21Z, ODbL 1.0",
            "natural_earth": "Natural Earth 10m cultural vectors (urban areas, admin-1), public domain",
        },
        "generator": "pipeline/osm/build_national.py",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    log(f"total GeoJSON {sum(sizes.values()) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
