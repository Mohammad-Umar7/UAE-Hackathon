"""2D polygon utilities for the airport builders (numpy + mathutils, no shapely inside Blender).

Rings are (N, 2) float64 numpy arrays, not closed (first point not repeated), in the airport
ENU frame (x east, y north, metres).  Outer rings are CCW, holes CW unless stated otherwise.
"""
import math
from collections import defaultdict

import numpy as np

try:  # only the triangulation / boolean helpers need Blender
    from mathutils import Vector
    from mathutils import geometry as _mg
except ImportError:  # pragma: no cover - lets pure-Python tools import the module
    Vector = None
    _mg = None


# ------------------------------------------------------------------ basics
def as_ring(pts, eps=1e-6):
    a = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
    if len(a) > 1 and np.linalg.norm(a[0] - a[-1]) < eps:
        a = a[:-1]
    if len(a) < 2:
        return a
    d = np.linalg.norm(a - np.roll(a, 1, axis=0), axis=1)
    return a[d > eps]


def signed_area(r):
    x, y = r[:, 0], r[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def ccw(r):
    return r if signed_area(r) > 0 else r[::-1].copy()


def cw(r):
    return r if signed_area(r) < 0 else r[::-1].copy()


def perimeter(r):
    return float(np.linalg.norm(np.roll(r, -1, axis=0) - r, axis=1).sum())


def centroid(r):
    x, y = r[:, 0], r[:, 1]
    x1, y1 = np.roll(x, -1), np.roll(y, -1)
    c = x * y1 - x1 * y
    a = c.sum() / 2
    if abs(a) < 1e-9:
        return r.mean(axis=0)
    return np.array([((x + x1) * c).sum() / (6 * a), ((y + y1) * c).sum() / (6 * a)])


def bbox(rings):
    a = np.concatenate([np.asarray(r).reshape(-1, 2) for r in rings])
    return a.min(axis=0), a.max(axis=0)


def edges_of(rings):
    A = np.concatenate([r for r in rings])
    B = np.concatenate([np.roll(r, -1, axis=0) for r in rings])
    return A, B


def rot2(v, ang):
    c, s = math.cos(ang), math.sin(ang)
    v = np.asarray(v, float)
    return np.stack([c * v[..., 0] - s * v[..., 1], s * v[..., 0] + c * v[..., 1]], axis=-1)


def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


# --------------------------------------------------------------- distances
def seg_query(P, A, B):
    """Nearest segment for each point: (distance, segment index, parameter t, closest point)."""
    P = np.asarray(P, float).reshape(-1, 2)
    AB = B - A
    L2 = np.maximum((AB ** 2).sum(1), 1e-12)
    n = len(P)
    out_d = np.empty(n)
    out_i = np.empty(n, dtype=np.int64)
    out_t = np.empty(n)
    chunk = max(16, int(1.5e6 // max(1, len(A))))
    for s in range(0, n, chunk):
        p = P[s:s + chunk, None, :]
        AP = p - A[None]
        t = np.clip((AP * AB[None]).sum(2) / L2[None], 0.0, 1.0)
        dx = AP[..., 0] - t * AB[None, :, 0]
        dy = AP[..., 1] - t * AB[None, :, 1]
        d2 = dx * dx + dy * dy
        i = d2.argmin(1)
        k = np.arange(len(i))
        out_i[s:s + chunk] = i
        out_d[s:s + chunk] = np.sqrt(d2[k, i])
        out_t[s:s + chunk] = t[k, i]
    C = A[out_i] + out_t[:, None] * AB[out_i]
    return out_d, out_i, out_t, C


def inside(P, rings):
    """Even-odd point-in-polygon test against all rings (outer + holes)."""
    P = np.asarray(P, float).reshape(-1, 2)
    res = np.zeros(len(P), dtype=bool)
    for r in rings:
        A = r
        B = np.roll(r, -1, axis=0)
        ax, ay, bx, by = A[:, 0][None], A[:, 1][None], B[:, 0][None], B[:, 1][None]
        dy = by - ay
        dy = np.where(np.abs(dy) < 1e-12, 1e-12, dy)
        chunk = max(16, int(2e6 // max(1, len(A))))
        for s in range(0, len(P), chunk):
            px = P[s:s + chunk, 0][:, None]
            py = P[s:s + chunk, 1][:, None]
            cond = (ay > py) != (by > py)
            xint = ax + (py - ay) * (bx - ax) / dy
            cross = cond & (px < xint)
            res[s:s + chunk] ^= (cross.sum(1) % 2 == 1)
    return res


def sdf(P, rings):
    """Signed distance: + inside, - outside."""
    A, B = edges_of(rings)
    d = seg_query(P, A, B)[0]
    return np.where(inside(P, rings), d, -d)


# ------------------------------------------------------------- resampling
def subdivide(r, step, closed=True):
    """Keep every vertex, split edges longer than `step` evenly."""
    pts = []
    n = len(r)
    m = n if closed else n - 1
    for i in range(m):
        a, b = r[i], r[(i + 1) % n]
        L = float(np.linalg.norm(b - a))
        k = max(1, int(math.ceil(L / step - 1e-9)))
        for j in range(k):
            pts.append(a + (b - a) * (j / k))
    if not closed:
        pts.append(r[-1])
    return np.array(pts)


def resample(r, step, closed=True, keep_corners_deg=None):
    """Uniform arc-length resampling.  keep_corners_deg: vertices whose turning angle exceeds
    this are kept exactly (the uniform spacing restarts there)."""
    r = np.asarray(r, float)
    n = len(r)
    if keep_corners_deg is not None:
        corners = [i for i in range(n) if turning_angle(r, i, closed) > math.radians(keep_corners_deg)]
    else:
        corners = []
    if not closed:
        corners = sorted(set([0, n - 1] + corners))
    if not corners:
        seq = np.vstack([r, r[:1]]) if closed else r
        return _resample_open(seq, step, drop_last=closed)
    out = []
    m = len(corners)
    for k in range(m if closed else m - 1):
        i0, i1 = corners[k], corners[(k + 1) % m]
        if closed:
            idx = list(range(i0, i1 + 1)) if i1 > i0 else list(range(i0, n)) + list(range(0, i1 + 1))
        else:
            idx = list(range(i0, i1 + 1))
        seg = r[idx]
        piece = _resample_open(seg, step, drop_last=True)
        out.append(piece)
    if not closed:
        out.append(r[-1:])
    return np.concatenate(out)


def _resample_open(seq, step, drop_last=False):
    d = np.linalg.norm(np.diff(seq, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(d)])
    L = s[-1]
    k = max(1, int(round(L / step)))
    t = np.linspace(0.0, L, k + 1)
    if drop_last:
        t = t[:-1]
    x = np.interp(t, s, seq[:, 0])
    y = np.interp(t, s, seq[:, 1])
    return np.stack([x, y], axis=1)


def turning_angle(r, i, closed=True):
    n = len(r)
    if not closed and (i == 0 or i == n - 1):
        return math.pi
    a, b, c = r[i - 1], r[i], r[(i + 1) % n]
    u, v = b - a, c - b
    lu, lv = np.linalg.norm(u), np.linalg.norm(v)
    if lu < 1e-9 or lv < 1e-9:
        return 0.0
    cosang = float(np.clip(np.dot(u, v) / (lu * lv), -1, 1))
    return math.acos(cosang)


def chaikin(r, iters=1, closed=True):
    for _ in range(iters):
        a = r
        b = np.roll(r, -1, axis=0)
        q = 0.75 * a + 0.25 * b
        s = 0.25 * a + 0.75 * b
        out = np.empty((2 * len(r), 2))
        out[0::2] = q
        out[1::2] = s
        if not closed:
            out = np.vstack([r[:1], out[:-2], r[-1:]])
        r = out
    return r


def laplacian(r, iters=1, lam=0.5, closed=True):
    r = r.copy()
    for _ in range(iters):
        nb = 0.5 * (np.roll(r, 1, axis=0) + np.roll(r, -1, axis=0))
        if closed:
            r = r + lam * (nb - r)
        else:
            r[1:-1] = r[1:-1] + lam * (nb[1:-1] - r[1:-1])
    return r


def simplify(r, tol, closed=True):
    """Douglas-Peucker (closed rings are split at the two most distant points)."""
    r = np.asarray(r, float)
    if len(r) < 4:
        return r

    def dp(seq):
        if len(seq) < 3:
            return [0, len(seq) - 1]
        a, b = seq[0], seq[-1]
        ab = b - a
        L = np.linalg.norm(ab)
        if L < 1e-9:
            d = np.linalg.norm(seq - a, axis=1)
        else:
            d = np.abs(np.cross(ab, seq - a)) / L
        i = int(d.argmax())
        if d[i] <= tol:
            return [0, len(seq) - 1]
        left = dp(seq[:i + 1])
        right = dp(seq[i:])
        return left[:-1] + [i + j for j in right]

    if not closed:
        return r[dp(r)]
    i0 = 0
    i1 = int(np.linalg.norm(r - r[0], axis=1).argmax())
    s1 = r[i0:i1 + 1]
    s2 = np.vstack([r[i1:], r[:1]])
    k1 = dp(s1)
    k2 = dp(s2)
    out = [s1[k] for k in k1[:-1]] + [s2[k] for k in k2[:-1]]
    return np.array(out)


# --------------------------------------------------------------- normals/offset
def edge_normals(r):
    """Outward unit normals of the edges of a CCW ring (edge i = r[i] -> r[i+1])."""
    d = np.roll(r, -1, axis=0) - r
    return unit(np.stack([d[:, 1], -d[:, 0]], axis=1))


def vertex_normals(r, closed=True):
    """Outward bisector normals (CCW ring) and miter scale 1/cos(half angle)."""
    en = edge_normals(r)
    prev = np.roll(en, 1, axis=0)
    if not closed:
        prev[0] = en[0]
        en = en.copy()
        en[-1] = prev[-1]
    n = unit(prev + en)
    cos_half = np.clip((n * en).sum(1), 0.2, 1.0)
    return n, 1.0 / cos_half


def offset(r, d, miter_limit=3.0, closed=True):
    """Offset a CCW ring outward by d (negative = inward), miter joins (clamped)."""
    n, k = vertex_normals(r, closed)
    return r + n * (d * np.minimum(k, miter_limit))[:, None]


def tangents(r, closed=True):
    t = np.roll(r, -1, axis=0) - np.roll(r, 1, axis=0)
    if not closed:
        t[0] = r[1] - r[0]
        t[-1] = r[-1] - r[-2]
    return unit(t)


def arclength(r, closed=True):
    seq = np.vstack([r, r[:1]]) if closed else r
    d = np.linalg.norm(np.diff(seq, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(d)])


# --------------------------------------------------------------- CDT helpers
def _vecs(pts):
    return [Vector((float(x), float(y))) for x, y in pts]


def cdt_full(rings, steiner=None, eps=1e-5):
    """Constrained Delaunay of the convex hull.  Returns verts (N,2), tris (M,3) (CCW) and, per
    triangle, the set of input ring indices whose interior (by winding of a CCW copy) contains it."""
    verts = []
    faces = []
    for r in rings:
        r = ccw(r)
        faces.append(list(range(len(verts), len(verts) + len(r))))
        verts.extend(r.tolist())
    if steiner is not None and len(steiner):
        verts.extend(np.asarray(steiner).tolist())
    ov, oe, of, _, _, origf = _mg.delaunay_2d_cdt(_vecs(verts), [], faces, 0, eps, True)
    V = np.array([(v.x, v.y) for v in ov])
    tris = []
    owners = []
    for f, o in zip(of, origf):
        if len(f) != 3:
            # fan-triangulate (should not happen for output type 0)
            for j in range(1, len(f) - 1):
                tris.append((f[0], f[j], f[j + 1]))
                owners.append(set(o))
            continue
        tris.append(tuple(f))
        owners.append(set(o))
    T = np.array(tris, dtype=np.int64)
    a = V[T[:, 0]]
    b = V[T[:, 1]]
    c = V[T[:, 2]]
    ar = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])
    flip = ar < 0
    T[flip] = T[flip][:, ::-1]
    return V, T, owners


def triangulate(outer, holes=(), steiner=None, eps=1e-5, min_dist=None):
    """Triangulate a polygon with holes; optional interior Steiner points (dropped if outside or
    closer than min_dist to the boundary).  Returns verts (N,2), tris (M,3) CCW."""
    outer = ccw(as_ring(outer))
    holes = [ccw(as_ring(h)) for h in holes]
    rings = [outer] + holes
    if steiner is not None and len(steiner):
        st = np.asarray(steiner, float)
        test = [outer] + [cw(h) for h in holes]
        keep = inside(st, test)
        if min_dist:
            A, B = edges_of(test)
            keep &= seg_query(st, A, B)[0] > min_dist
        steiner = st[keep]
    V, T, owners = cdt_full(rings, steiner, eps)
    sel = [i for i, o in enumerate(owners) if 0 in o and not any(k in o for k in range(1, len(rings)))]
    T = T[sel]
    # compact vertices
    used = np.unique(T)
    remap = -np.ones(len(V), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return V[used], remap[T]


def boundary_loops(V, T):
    """Boundary loops (CCW outer / CW holes, as produced by CCW triangles) of a triangle set."""
    edges = set()
    for a, b, c in T:
        edges.add((a, b))
        edges.add((b, c))
        edges.add((c, a))
    nxt = defaultdict(list)
    for (u, v) in edges:
        if (v, u) not in edges:
            nxt[u].append(v)
    loops = []
    used = set()
    for start in list(nxt.keys()):
        for v0 in nxt[start]:
            if (start, v0) in used:
                continue
            loop = [start]
            used.add((start, v0))
            cur = v0
            guard = 0
            while cur != start and guard < 1000000:
                guard += 1
                loop.append(cur)
                cands = [w for w in nxt[cur] if (cur, w) not in used]
                if not cands:
                    break
                w = cands[0]
                used.add((cur, w))
                cur = w
            if len(loop) >= 3:
                loops.append(V[np.array(loop)])
    return loops


def union(rings, eps=1e-4):
    """Union of simple polygons -> list of rings: [outer (CCW), holes (CW)...] for the largest
    component, plus extra components appended as further CCW rings."""
    V, T, owners = cdt_full([as_ring(r) for r in rings], None, eps)
    sel = [i for i, o in enumerate(owners) if o]
    loops = boundary_loops(V, T[sel])
    loops.sort(key=lambda r: -abs(signed_area(r)))
    return [as_ring(r) for r in loops]


def difference(a, b_rings, eps=1e-4):
    """Polygon a minus polygons b -> loops (outer CCW, holes CW)."""
    rings = [as_ring(a)] + [as_ring(r) for r in b_rings]
    V, T, owners = cdt_full(rings, None, eps)
    sel = [i for i, o in enumerate(owners) if 0 in o and not any(k in o for k in range(1, len(rings)))]
    loops = boundary_loops(V, T[sel])
    loops.sort(key=lambda r: -abs(signed_area(r)))
    return [as_ring(r) for r in loops]


# ------------------------------------------------------------ lobes (opening)
def split_lobes(ring, radius, tol=0.9, min_area=60.0, min_depth=4.0):
    """Morphological-opening style split of a footprint into a body and thin appendages
    ("lobes", e.g. fixed passenger-bridge links drawn as part of a terminal outline).
    A vertex belongs to the body if a disc of `radius` fits inside the polygon touching it.
    Returns (body ring CCW, [lobe dict(ring, neck=(p0, p1), tip=point)])."""
    r = ccw(as_ring(ring))
    n = len(r)
    A, B = edges_of([r])
    nrm, _ = vertex_normals(r)
    inward = -nrm
    best = np.full(n, -1e9)
    for ang in (-50, -25, 0, 25, 50):
        q = r + rot2(inward, math.radians(ang)) * radius
        s = sdf(q, [r])
        best = np.maximum(best, s)
    core = best >= radius - tol
    if core.all() or not core.any():
        return r, []
    # rotate so that index 0 is a core vertex
    k0 = int(np.argmax(core))
    r = np.roll(r, -k0, axis=0)
    core = np.roll(core, -k0)
    runs = []
    i = 0
    while i < n:
        if core[i]:
            i += 1
            continue
        j = i
        while j < n and not core[j]:
            j += 1
        runs.append((i, j - 1))
        i = j
    lobes = []
    drop = np.zeros(n, dtype=bool)
    for (i0, i1) in runs:
        a = r[i0 - 1]
        b = r[(i1 + 1) % n]
        pts = r[i0:i1 + 1]
        lobe = np.vstack([a[None], pts, b[None]])
        ar = abs(signed_area(lobe))
        ab = b - a
        L = np.linalg.norm(ab)
        if L > 1e-9:
            depth = np.abs(np.cross(ab, pts - a)) / L
        else:
            depth = np.linalg.norm(pts - a, axis=1)
        if ar < min_area or depth.max() < min_depth:
            continue
        drop[i0:i1 + 1] = True
        tip = pts[int(depth.argmax())]
        lobes.append(dict(ring=ccw(lobe), neck=(a.copy(), b.copy()), tip=tip.copy(), area=ar,
                          depth=float(depth.max())))
    body = r[~drop]
    return ccw(body), lobes


# ------------------------------------------------------------ misc geometry
def convex_hull(pts):
    P = sorted(set(map(tuple, np.asarray(pts, float).tolist())))
    if len(P) < 3:
        return np.array(P)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower = []
    for p in P:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(P):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def min_rect(pts):
    """Minimum-area oriented rectangle: (centre, unit axis of the long side, length, width)."""
    H = convex_hull(pts)
    best = None
    for i in range(len(H)):
        e = H[(i + 1) % len(H)] - H[i]
        if np.linalg.norm(e) < 1e-9:
            continue
        u = e / np.linalg.norm(e)
        v = np.array([-u[1], u[0]])
        pu = H @ u
        pv = H @ v
        a = (pu.max() - pu.min()) * (pv.max() - pv.min())
        if best is None or a < best[0]:
            best = (a, u, v, pu.min(), pu.max(), pv.min(), pv.max())
    _, u, v, u0, u1, v0, v1 = best
    c = u * (u0 + u1) / 2 + v * (v0 + v1) / 2
    lu, lv = u1 - u0, v1 - v0
    if lv > lu:
        u, v, lu, lv = v, -u, lv, lu
    return c, u, lu, lv


def fit_circle(pts):
    P = np.asarray(pts, float)
    A = np.c_[2 * P, np.ones(len(P))]
    b = (P ** 2).sum(1)
    sol = np.linalg.lstsq(A, b, rcond=None)[0]
    c = sol[:2]
    rad = math.sqrt(max(sol[2] + (c ** 2).sum(), 0.0))
    return c, rad


def project_polyline(P, line):
    """Project points onto an open polyline: (s along the line, signed lateral offset (+ left),
    distance, segment index)."""
    line = np.asarray(line, float)
    A = line[:-1]
    B = line[1:]
    d, i, t, C = seg_query(P, A, B)
    seglen = np.linalg.norm(B - A, axis=1)
    s0 = np.concatenate([[0.0], np.cumsum(seglen)])
    s = s0[i] + t * seglen[i]
    tang = unit(B - A)[i]
    rel = np.asarray(P, float).reshape(-1, 2) - C
    side = np.sign(tang[:, 0] * rel[:, 1] - tang[:, 1] * rel[:, 0])
    return s, side * d, d, i


def polyline_point(line, s):
    line = np.asarray(line, float)
    L = arclength(line, closed=False)
    s = np.clip(s, 0, L[-1])
    x = np.interp(s, L, line[:, 0])
    y = np.interp(s, L, line[:, 1])
    return np.stack([x, y], axis=-1)


def smooth_interp(x, xp, fp):
    """Monotone cubic (PCHIP / Fritsch-Carlson) interpolation, constant outside the range."""
    xp = np.asarray(xp, float)
    fp = np.asarray(fp, float)
    x = np.clip(np.asarray(x, float), xp[0], xp[-1])
    h = np.diff(xp)
    d = np.diff(fp) / h
    m = np.zeros_like(fp)
    m[0], m[-1] = d[0], d[-1]
    for k in range(1, len(fp) - 1):
        if d[k - 1] * d[k] <= 0:
            m[k] = 0.0
        else:
            w1 = 2 * h[k] + h[k - 1]
            w2 = h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])
    i = np.clip(np.searchsorted(xp, x) - 1, 0, len(xp) - 2)
    t = (x - xp[i]) / h[i]
    h00 = 2 * t ** 3 - 3 * t ** 2 + 1
    h10 = t ** 3 - 2 * t ** 2 + t
    h01 = -2 * t ** 3 + 3 * t ** 2
    h11 = t ** 3 - t ** 2
    return h00 * fp[i] + h10 * h[i] * m[i] + h01 * fp[i + 1] + h11 * h[i] * m[i + 1]


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smax(a, b, k):
    """Polynomial smooth maximum."""
    h = np.maximum(k - np.abs(a - b), 0.0)
    return np.maximum(a, b) + h * h / (4 * k)


def hex_points(lo, hi, step):
    """Hexagonal lattice covering the box lo..hi (good Steiner points for CDT)."""
    dy = step * math.sqrt(3) / 2
    ys = np.arange(lo[1], hi[1] + dy, dy)
    pts = []
    for k, y in enumerate(ys):
        off = (step / 2) if (k % 2) else 0.0
        xs = np.arange(lo[0] + off, hi[0] + step, step)
        pts.append(np.stack([xs, np.full_like(xs, y)], axis=1))
    return np.concatenate(pts)
