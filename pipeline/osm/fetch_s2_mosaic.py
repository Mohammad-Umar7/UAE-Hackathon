"""Stitch a Sentinel-2 cloudless mosaic for the national bbox (optional basemap texture).

Layer: EOX "s2cloudless_3857" — "Sentinel-2 cloudless layer for 2016 by EOX - 3857".
Its WMTS capabilities (https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml, checked
2026-10-26) state: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains
modified Copernicus Sentinel data 2016) released under Creative Commons Attribution 4.0
International License".  Only the 2016 and 2017 layers are CC BY 4.0 (2018 and later are
CC BY-NC-SA 4.0 and must NOT be used); the 2017 layer has no coverage over most of the UAE
at z11 (EOX returns 1-bit PNG placeholders), so the 2016 layer is used.  The script
refuses to run if the live capabilities no longer say CC BY 4.0 for the chosen layer, and
refuses placeholder tiles.

Required attribution: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH
(Contains modified Copernicus Sentinel data 2016)", CC BY 4.0.

Output: data/national/s2_mosaic.jpg + data/national/s2_mosaic.json (exact EPSG:3857 and
lon/lat bounds of the stitched tile grid, which is slightly larger than the bbox).
Tiles are cached in pipeline/osm/cache/s2tiles/ so re-runs are offline.

  uv run --project pipeline python pipeline/osm/fetch_s2_mosaic.py [--zoom 11]
"""
from __future__ import annotations

import argparse
import io
import json
import math
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402

LAYER = "s2cloudless_3857"
CAPS_URL = "https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml"
TILE_URL = "https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"
R = 6378137.0
ORIGIN = math.pi * R  # 20037508.342789244


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def tile_bounds_3857(x, y, z):
    size = 2 * ORIGIN / 2 ** z
    minx = -ORIGIN + x * size
    maxy = ORIGIN - y * size
    return minx, maxy - size, minx + size, maxy


def merc_to_lonlat(mx, my):
    lon = mx / R * 180.0 / math.pi
    lat = math.degrees(2 * math.atan(math.exp(my / R)) - math.pi / 2)
    return lon, lat


def check_license(session):
    r = session.get(CAPS_URL, timeout=60)
    r.raise_for_status()
    s = r.text
    for m in re.finditer(r"<Layer>(.*?)</Layer>", s, re.S):
        blk = m.group(1)
        ident = re.search(r"<ows:Identifier>(.*?)</ows:Identifier>", blk)
        if ident and ident.group(1) == LAYER:
            ab = re.search(r"<ows:Abstract>(.*?)</ows:Abstract>", blk, re.S)
            ab = ab.group(1) if ab else ""
            if "creativecommons.org/licenses/by/4.0" in ab and "by-nc" not in ab:
                title = re.search(r"<ows:Title>(.*?)</ows:Title>", blk).group(1)
                return title, re.sub(r"&lt;.*?&gt;|<.*?>", "", ab)
            raise SystemExit(f"{LAYER} is not CC BY 4.0 according to the capabilities: {ab[:200]}")
    raise SystemExit(f"{LAYER} not found in capabilities")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom", type=int, default=11)
    args = ap.parse_args()
    z = args.zoom
    import requests
    from PIL import Image

    lon0, lat0, lon1, lat1 = config.NATIONAL_BBOX
    fx0, fy0 = lonlat_to_tile(lon0, lat1, z)  # top-left
    fx1, fy1 = lonlat_to_tile(lon1, lat0, z)  # bottom-right
    x0, y0, x1, y1 = int(fx0), int(fy0), int(fx1), int(fy1)
    nx_, ny_ = x1 - x0 + 1, y1 - y0 + 1
    tiles_dir = config.CACHE_DIR / "s2tiles" / LAYER / str(z)
    tiles_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = config.USER_AGENT
    def cached(x, y):
        return (tiles_dir / f"{y}_{x}.jpg").exists() or (tiles_dir / f"{y}_{x}.nodata").exists()

    need = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1) if not cached(x, y)]
    title, abstract = ("(cached)", "")
    if need:
        title, abstract = check_license(session)
        print("license check OK:", title)
    for (x, y) in need:
        url = TILE_URL.format(layer=LAYER, z=z, y=y, x=x)
        delay = 2
        for attempt in range(6):
            try:
                r = session.get(url, timeout=60)
                r.raise_for_status()
                im = Image.open(io.BytesIO(r.content))
                if im.format != "JPEG":
                    # EOX answers areas without imagery (open sea) with a 1-bit PNG placeholder
                    (tiles_dir / f"{y}_{x}.nodata").write_bytes(r.content)
                    print(f"no imagery: {url}")
                    break
                im.verify()
                (tiles_dir / f"{y}_{x}.jpg").write_bytes(r.content)
                break
            except Exception as e:
                print("retry", url, e)
                time.sleep(delay)
                delay *= 2
        else:
            raise SystemExit(f"failed: {url}")
        time.sleep(0.15)  # be polite
    import numpy as np

    tiles, nodata = {}, []
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            f = tiles_dir / f"{y}_{x}.jpg"
            if f.exists():
                tiles[(x, y)] = Image.open(f).convert("RGB")
            else:
                nodata.append([x, y])
    # flat fill colour for no-imagery tiles: median of water-like pixels (blue > red) of valid tiles
    px = np.concatenate([np.asarray(t).reshape(-1, 3) for t in tiles.values()])
    water = px[(px[:, 2].astype(int) > px[:, 0].astype(int) + 10)]
    fill = tuple(int(v) for v in np.median(water if len(water) else px, axis=0))
    mosaic = Image.new("RGB", (nx_ * 256, ny_ * 256), fill)
    for (x, y), im in tiles.items():
        mosaic.paste(im, ((x - x0) * 256, (y - y0) * 256))
    # EOX paints no-imagery parts of partially covered sea tiles flat navy (24, 44, 77):
    # recolour those pixels with the same flat sea fill so the open sea looks uniform
    arr = np.asarray(mosaic).astype(np.int16)
    navy = np.array([24, 44, 77], dtype=np.int16)
    mask = np.abs(arr - navy).sum(axis=2) <= 18
    arr[mask] = fill
    mosaic = Image.fromarray(arr.astype(np.uint8))
    recoloured = int(mask.sum())
    out = config.NATIONAL_DIR / "s2_mosaic.jpg"
    config.NATIONAL_DIR.mkdir(parents=True, exist_ok=True)
    mosaic.save(out, quality=82, optimize=True, progressive=True)
    minx, _, _, maxy = tile_bounds_3857(x0, y0, z)
    _, miny, maxx, _ = tile_bounds_3857(x1, y1, z)
    w_lon, s_lat = merc_to_lonlat(minx, miny)
    e_lon, n_lat = merc_to_lonlat(maxx, maxy)
    meta = {
        "image": "s2_mosaic.jpg",
        "width_px": mosaic.width, "height_px": mosaic.height,
        "crs": "EPSG:3857",
        "bounds_3857": {"min_x": minx, "min_y": miny, "max_x": maxx, "max_y": maxy},
        "bounds_lonlat": {"west": w_lon, "south": s_lat, "east": e_lon, "north": n_lat},
        "note": "Pixels are square in EPSG:3857 (Web Mercator); latitude is NOT linear in pixel rows. "
                "Row r (0 = top) centre: my = max_y - (r + 0.5) * (max_y - min_y) / height_px; "
                "lat = degrees(2*atan(exp(my/6378137)) - pi/2).",
        "requested_bbox_lonlat": list(config.NATIONAL_BBOX),
        "zoom": z, "tiles": {"x": [x0, x1], "y": [y0, y1]},
        "pixel_size_m_3857": (maxx - minx) / mosaic.width,
        "nodata_tiles": {"count": len(nodata), "xy": nodata, "fill_rgb": list(fill),
                         "recoloured_nodata_pixels": recoloured,
                         "note": "tiles without imagery in the layer (open sea) and EOX's navy no-data pixels "
                                 "inside partially covered sea tiles are filled with one flat sea colour"},
        "source": {"layer": LAYER, "title": title,
                   "wmts": "https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml",
                   "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
                   "attribution": "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH "
                                  "(Contains modified Copernicus Sentinel data 2016)",
                   "retrieved": "2026-10-26"},
    }
    (config.NATIONAL_DIR / "s2_mosaic.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB, {mosaic.width}x{mosaic.height})")


if __name__ == "__main__":
    main()
