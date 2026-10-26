"""Small helpers shared by the OSM pipeline scripts (tag parsing, multipolygon assembly,
projection)."""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

_NUM = re.compile(r"[-+]?\d+(?:[.,]\d+)?")


def parse_height(v) -> float | None:
    """Parse OSM height-like values: '25', '25 m', '25m', '82 ft', "82'", '12;14' -> metres."""
    if v is None:
        return None
    s = str(v).strip().lower()
    if not s:
        return None
    s = s.split(";")[0]
    m = _NUM.search(s)
    if not m:
        return None
    try:
        x = float(m.group(0).replace(",", "."))
    except ValueError:
        return None
    if "ft" in s or "'" in s or "feet" in s:
        x *= 0.3048
    if not math.isfinite(x) or x < 0 or x > 1000:
        return None
    return x


def parse_width(v) -> float | None:
    w = parse_height(v)
    if w is None or w <= 0 or w > 200:
        return None
    return w


def load_raw(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def assemble_rings(segments: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """Join way segments (lists of coordinate tuples) into closed rings by matching endpoints.
    Unclosable leftovers are closed forcibly if they are nearly closed, else dropped."""
    rings = []
    segs = [list(s) for s in segments if len(s) >= 2]
    # closed segments are rings already
    open_segs = []
    for s in segs:
        if s[0] == s[-1] and len(s) >= 4:
            rings.append(s)
        else:
            open_segs.append(s)
    while open_segs:
        cur = open_segs.pop()
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(open_segs):
                if s[0] == cur[-1]:
                    cur = cur + s[1:]
                elif s[-1] == cur[-1]:
                    cur = cur + s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s + cur[1:]
                elif s[0] == cur[0]:
                    cur = s[::-1] + cur[1:]
                else:
                    continue
                open_segs.pop(i)
                changed = True
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
        elif len(cur) >= 3:
            # nearly closed?  (endpoints within ~1e-5 deg)
            if abs(cur[0][0] - cur[-1][0]) < 1e-5 and abs(cur[0][1] - cur[-1][1]) < 1e-5:
                rings.append(cur + [cur[0]])
    return rings


def element_polygons(el: dict):
    """Return a list of (outer_ring, [inner_rings]) in lon/lat for a closed way or a
    multipolygon relation element; [] if the element is not an area."""
    if el["type"] == "way":
        g = [tuple(p) for p in el.get("geometry", [])]
        if len(g) >= 4 and g[0] == g[-1]:
            return [(g, [])]
        return []
    if el["type"] == "relation":
        outers, inners = [], []
        for m in el.get("members", []):
            if m.get("type") != "way" or "geometry" not in m:
                continue
            seg = [tuple(p) for p in m["geometry"]]
            (inners if m.get("role") == "inner" else outers).append(seg)
        outer_rings = assemble_rings(outers)
        inner_rings = assemble_rings(inners)
        if not outer_rings:
            return []
        from shapely.geometry import Polygon, Point

        res = []
        polys = [Polygon(r) for r in outer_rings]
        assigned = [[] for _ in polys]
        for ir in inner_rings:
            p = Point(ir[0])
            for k, op in enumerate(polys):
                if op.is_valid and op.contains(p):
                    assigned[k].append(ir)
                    break
        for r, holes in zip(outer_rings, assigned):
            res.append((r, holes))
        return res
    return []


class Projector:
    """lon/lat <-> local ENU (aeqd centred on the ARP)."""

    def __init__(self, proj_string: str):
        from pyproj import CRS, Transformer

        crs = CRS.from_proj4(proj_string)
        self.fwd = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        self.inv = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

    def xy(self, coords):
        """coords: iterable of (lon, lat) -> list of (x, y)."""
        coords = list(coords)
        if not coords:
            return []
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        xs, ys = self.fwd.transform(lons, lats)
        return list(zip(xs, ys))

    def lonlat(self, pts):
        pts = list(pts)
        if not pts:
            return []
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        lo, la = self.inv.transform(xs, ys)
        return list(zip(lo, la))


def coast_faces(coast_lines, clip, eps=0.5):
    """Split polygon `clip` into land and water faces using OSM natural=coastline lines
    (OSM rule: land lies on the LEFT of the way direction, water on the right).
    coast_lines: shapely LineStrings in the same CRS as clip.  eps: sampling offset.
    Returns (land_polys, water_polys)."""
    import numpy as np
    import shapely
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union
    from shapely.strtree import STRtree

    pieces = []
    samples, labels = [], []
    for ln in coast_lines:
        if not ln.intersects(clip):
            continue
        c = ln.intersection(clip)
        pieces.append(c)
        coords = list(ln.coords)
        for a, b in zip(coords[:-1], coords[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy)
            if L == 0:
                continue
            seg = LineString([a, b])
            if not seg.intersects(clip):
                continue
            part = seg.intersection(clip)
            parts = [part] if part.geom_type == "LineString" else [g for g in getattr(part, "geoms", [])
                                                                   if g.geom_type == "LineString"]
            nx_, ny_ = -dy / L, dx / L  # left normal
            for p in parts:
                if p.length < eps * 0.5:
                    continue
                m = p.interpolate(0.5, normalized=True)
                samples.append((m.x + nx_ * eps, m.y + ny_ * eps))
                labels.append(1)  # land
                samples.append((m.x - nx_ * eps, m.y - ny_ * eps))
                labels.append(0)  # water
    if not pieces:
        return [clip], []
    noded = unary_union(pieces + [clip.boundary])
    faces = [f for f in polygonize(noded) if f.area > 0]
    if not faces:
        return [clip], []
    tree = STRtree(faces)
    pts = shapely.points(np.array(samples))
    inp, fidx = tree.query(pts, predicate="intersects")
    votes = np.zeros((len(faces), 2))
    lab = np.array(labels)
    np.add.at(votes, (fidx, lab[inp]), 1)
    land, water = [], []
    for i, f in enumerate(faces):
        if votes[i].sum() == 0:
            # no sample: inherit from the nearest sample
            j = int(np.argmin([(s[0] - f.representative_point().x) ** 2 + (s[1] - f.representative_point().y) ** 2
                               for s in samples]))
            is_land = labels[j] == 1
        else:
            is_land = votes[i][1] >= votes[i][0]
        (land if is_land else water).append(f)
    return land, water
