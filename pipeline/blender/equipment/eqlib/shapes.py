"""2D profile helpers (side profiles with wheel arches, rounded rectangles...)."""
import math


def arch_profile(y0, y1, z0, z1, arches=(), seg=8, top=None):
    """Side profile (y, z) of a body slab [y0..y1] x [z0..z1] with semicircular wheel
    arch notches cut from the bottom edge.  arches = [(yc, zc, r)].  `top` optionally
    replaces the top edge with a list of (y, z) points from y1 back to y0."""
    pts = [(y0, z0)]
    for (yc, zc, r) in sorted(arches):
        r = min(r, z1 - zc - 0.04)          # never let a notch pierce the top edge
        dz = z0 - zc
        if abs(dz) >= r:
            continue
        p0 = math.asin(dz / r)
        p1 = math.pi - p0
        for k in range(seg + 1):
            ph = p1 + (p0 - p1) * k / seg
            pts.append((yc + r * math.cos(ph), zc + r * math.sin(ph)))
    pts.append((y1, z0))
    if top is None:
        pts += [(y1, z1), (y0, z1)]
    else:
        pts += list(top)
    return pts


def rounded_rect(w, h, r, seg=3, cx=0.0, cy=0.0):
    """CCW rounded rectangle polygon."""
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    pts = []
    corners = [(w / 2 - r, -h / 2 + r, -math.pi / 2), (w / 2 - r, h / 2 - r, 0.0),
               (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi)]
    for (x, y, a0) in corners:
        if seg <= 0 or r <= 0:
            pts.append((cx + x + (r if a0 in (-math.pi / 2, 0.0) else -r) * 0, cy + y))
            continue
        for k in range(seg + 1):
            a = a0 + (math.pi / 2) * k / seg
            pts.append((cx + x + r * math.cos(a), cy + y + r * math.sin(a)))
    if seg <= 0 or r <= 0:
        return [(cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2), (cx - w / 2, cy - h / 2)]
    return pts


def chamfer_poly(pts, d):
    """Cut every corner of a polygon by distance d (simple bevel in 2D)."""
    out = []
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i - 1]
        bx, by = pts[i]
        cx, cy = pts[(i + 1) % n]
        l1 = math.hypot(bx - ax, by - ay)
        l2 = math.hypot(cx - bx, cy - by)
        if l1 < 1e-9 or l2 < 1e-9:
            continue
        t1 = min(d, l1 * 0.45) / l1
        t2 = min(d, l2 * 0.45) / l2
        out.append((bx + (ax - bx) * t1, by + (ay - by) * t1))
        out.append((bx + (cx - bx) * t2, by + (cy - by) * t2))
    return out


def segments_outside(y0, y1, arches, gap=0.02):
    """y intervals of [y0, y1] not covered by wheel arches [(yc, zc, r)]."""
    cuts = sorted((yc - r - gap, yc + r + gap) for (yc, zc, r) in arches)
    out = []
    cur = y0
    for a, b in cuts:
        if a > cur:
            out.append((cur, min(a, y1)))
        cur = max(cur, b)
    if cur < y1:
        out.append((cur, y1))
    return [(a, b) for a, b in out if b - a > 0.05]
