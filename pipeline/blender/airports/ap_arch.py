"""Reusable architectural components (all in the airport ENU frame, metres).

The central piece is `draped_building`: a building whose roof is a smooth height field z(x, y)
over the OSM outline (the outline is the roof edge seen from above, so the model lines up with
stands, bridges and taxiways), with a fascia, a soffit back to the facade line, and a (canted)
curtain wall with mullions, transoms and an apron-level band.
"""
import math
import random

import numpy as np

import ap_poly as P2
from ap_geo import (Geo, cylinder, heightfield, lathe, loft, obox, prism, quad,  # noqa: F401 (re-exported)
                    sphere, sweep, walls)

LOD_STEP = {0: 1.0, 1: 2.0, 2: 4.0}


# ------------------------------------------------------------------ outlines
def edge_loop(outline, step, keep_corners_deg=28.0, simplify_tol=0.0, smooth=0):
    r = P2.ccw(P2.as_ring(outline))
    if simplify_tol > 0:
        r = P2.ccw(P2.simplify(r, simplify_tol))
    if smooth:
        r = P2.laplacian(r, smooth, 0.5)
    return P2.ccw(P2.resample(r, step, closed=True, keep_corners_deg=keep_corners_deg))


def _c(xy, z):
    xy = np.asarray(xy, float)
    z = np.broadcast_to(np.asarray(z, float), (len(xy),))
    return np.c_[xy, z]


# ------------------------------------------------------------- curtain walls
def fins(bottom, top, tang, nout, width, depth, mat):
    """Open mullion fins (front + two sides) between matching bottom/top 3D points."""
    g = Geo()
    verts = []
    faces = []
    for pb, pt, t, n in zip(bottom, top, tang, nout):
        t3 = np.array([t[0], t[1], 0.0]) * (width / 2)
        n3 = np.array([n[0], n[1], 0.0]) * depth
        bL, bR, tL, tR = pb - t3, pb + t3, pt - t3, pt + t3
        k = len(verts)
        verts.extend([bL, bR, tR, tL, bL + n3, bR + n3, tR + n3, tL + n3])
        faces.append((k + 4, k + 5, k + 6, k + 7))      # front
        faces.append((k + 0, k + 4, k + 7, k + 3))      # left side (-t)
        faces.append((k + 5, k + 1, k + 2, k + 6))      # right side (+t)
        faces.append((k + 3, k + 7, k + 6, k + 2))      # top cap (up)
    if faces:
        g.add(verts, faces, mat)
    return g


def bands(rows_lo, rows_hi, nout, offset, mat, closed=True):
    """Front-only strips between two 3D polylines, pushed `offset` outward (transoms, spandrels)."""
    n3 = np.c_[nout, np.zeros(len(nout))] * offset
    return loft([np.asarray(rows_lo) + n3, np.asarray(rows_hi) + n3], mat, closed=closed)


def ruled_facade(base, top, zb, zt, levels, mats, closed=True):
    """Facade surface between a base polyline (z = zb) and a top polyline (z = zt, per vertex);
    `levels` are absolute heights where the material changes (clamped below zt - 0.3).
    mats has len(levels) + 1 entries (bottom to top).  Returns (Geo, point_at(z) function)."""
    base = np.asarray(base, float)
    top = np.asarray(top, float)
    zb = np.broadcast_to(np.asarray(zb, float), (len(base),))
    zt = np.broadcast_to(np.asarray(zt, float), (len(base),))

    def at(z):
        z = np.broadcast_to(np.asarray(z, float), (len(base),))
        z = np.minimum(np.maximum(z, zb), zt)
        f = ((z - zb) / np.maximum(zt - zb, 1e-6))[:, None]
        return np.c_[base + (top - base) * f, z]

    rows = [at(zb)]
    for lv in levels:
        rows.append(at(np.minimum(lv, zt - 0.3)))
    rows.append(at(zt))
    g = Geo()
    for k in range(len(rows) - 1):
        g += loft([rows[k], rows[k + 1]], mats[k], closed=closed)
    return g, at


# --------------------------------------------------------- draped building
def draped_building(outline, zfn, lod, *, edge_step=4.5, roof_step=6.0, overhang=3.0, fascia=1.4,
                    soffit_drop=0.5, base_inset=0.0, apron_band=5.0, transoms=(), glass='M_GlassLit',
                    band_mat='M_Dark', roof_mat='M_Roof', soffit_mat='M_Structure',
                    mullion_mat='M_Structure', mullion_every=1, mullion_w=0.32, mullion_d=0.45,
                    keep_corners_deg=28.0, simplify_tol=0.0, smooth=0, facade_top_fn=None,
                    glass_fn=None, ring=None):
    """Returns dict(roof=Geo, edge=Geo, facade=Geo, mullions=Geo, ring=R, facade_base=B,
    facade_top=F, zs=soffit z, at=facade point function)."""
    s = LOD_STEP[lod]
    R = ring if ring is not None else edge_loop(outline, edge_step * s, keep_corners_deg, simplify_tol, smooth)
    nout, miter = P2.vertex_normals(R)
    miter = np.minimum(miter, 2.2)
    tang = P2.tangents(R)
    E = zfn(R)
    # ---- roof height field
    lo, hi = R.min(axis=0), R.max(axis=0)
    rs = roof_step * s
    st = P2.hex_points(lo, hi, rs)
    V2, T = P2.triangulate(R, [], st, min_dist=0.45 * rs)
    roof = heightfield(V2, T, zfn(V2), roof_mat)
    # ---- fascia + soffit
    zf = E - fascia
    edge = loft([_c(R, zf), _c(R, E)], roof_mat, closed=True)
    F = R - nout * (overhang * miter)[:, None]
    zs = zf - soffit_drop
    if facade_top_fn is not None:
        zs = np.minimum(zs, facade_top_fn(R))
    edge += loft([_c(F, zs), _c(R, zf)], soffit_mat, closed=True)
    # ---- facade (ruled, optionally canted: base further inside than the top)
    B = R - nout * ((overhang + base_inset) * miter)[:, None]
    levels = [apron_band] if apron_band > 0 else []
    mats = ([band_mat] if apron_band > 0 else []) + [glass]
    facade, at = ruled_facade(B, F, 0.0, zs, levels, mats)
    if glass_fn is not None:
        # recolour glass faces whose centre fails glass_fn(xy, z) -> opaque band material
        V = np.array(facade.v)
        newm = []
        for f, m in zip(facade.f, facade.m):
            if m == glass:
                c = V[list(f)].mean(axis=0)
                newm.append(glass if glass_fn(c[:2], c[2]) else band_mat)
            else:
                newm.append(m)
        facade.m = newm
    # ---- mullions and transoms
    mull = Geo()
    if mullion_every and lod < 2:
        every = mullion_every * (4 if lod == 1 else 1)
        idx = np.arange(0, len(R), every)
        z0 = np.full(len(R), apron_band if apron_band > 0 else 0.0)
        bot = at(z0)[idx]
        top = at(zs - 0.05)[idx]
        ok = (top[:, 2] - bot[:, 2]) > 1.0
        mull += fins(bot[ok], top[ok], tang[idx][ok], nout[idx][ok], mullion_w * (1.6 if lod else 1.0),
                     mullion_d, mullion_mat)
        tz = list(transoms) if lod == 0 else []
        for z in tz:
            lo_ = at(np.full(len(R), z - 0.16))
            hi_ = at(np.full(len(R), z + 0.16))
            valid = (zs - z) > 0.8
            # split into runs of valid vertices
            for run in _runs(valid):
                if len(run) < 2:
                    continue
                closed = len(run) == len(R)
                mull += bands(lo_[run], hi_[run], nout[run], 0.07, mullion_mat, closed=closed)
    return dict(roof=roof, edge=edge, facade=facade, mullions=mull, ring=R, facade_base=B,
                facade_top=F, zs=zs, E=E, nout=nout, tang=tang, at=at)


def _runs(mask):
    """Index runs of True in a cyclic boolean mask (a fully True mask -> one closed run)."""
    n = len(mask)
    if mask.all():
        return [np.arange(n)]
    if not mask.any():
        return []
    start = int(np.argmin(mask))  # a False index
    runs = []
    cur = []
    for k in range(1, n + 1):
        i = (start + k) % n
        if mask[i]:
            cur.append(i)
        else:
            if cur:
                runs.append(np.array(cur))
            cur = []
    if cur:
        runs.append(np.array(cur))
    return runs


# ------------------------------------------------------------ flat roofs
def flat_roof_box(outline, h, lod, *, parapet=1.2, parapet_w=0.6, wall='M_Concrete', roof='M_Roof',
                  coping='M_Structure', edge_step=None, simplify_tol=0.0):
    """Closed box building with a parapet (outline = outer face of the walls)."""
    r = P2.ccw(P2.as_ring(outline))
    if simplify_tol > 0:
        r = P2.ccw(P2.simplify(r, simplify_tol))
    if edge_step:
        r = P2.ccw(P2.resample(r, edge_step * LOD_STEP[lod], True, 25.0))
    g = Geo()
    g += walls(r, 0.0, h + parapet, wall)
    inner = P2.offset(r, -parapet_w)
    g += loft([_c(r, h + parapet), _c(inner, h + parapet)], coping, closed=True)  # coping (up)
    g += walls(inner[::-1], h, h + parapet, wall)                                    # inner face
    from ap_geo import cap
    g += cap(inner, h, roof)
    return g, r, inner


# ------------------------------------------------------------- cross-sections
class Sections:
    """Cross-sections of a plan polygon perpendicular to an axis: stations every ds along u, each
    with the list of (t0, t1) intervals (t along v = u rotated +90 deg) inside the polygon."""

    def __init__(self, ring, u, origin, ds=2.0):
        u = np.asarray(u, float)
        self.u = u / np.linalg.norm(u)
        self.v = np.array([-self.u[1], self.u[0]])
        self.o = np.asarray(origin, float)
        r = P2.as_ring(ring)
        S = (r - self.o) @ self.u
        T = (r - self.o) @ self.v
        S2, T2 = np.roll(S, -1), np.roll(T, -1)
        self.s0, self.s1 = float(S.min()), float(S.max())
        self.ds = ds
        self.st = np.arange(self.s0 + 1e-3, self.s1, ds)
        if len(self.st) == 0 or self.st[-1] < self.s1 - 1e-3:
            self.st = np.append(self.st, self.s1 - 1e-3)
        self.iv = []
        for s in self.st:
            m = (S - s) * (S2 - s) < 0
            t = T[m] + (s - S[m]) * (T2[m] - T[m]) / (S2[m] - S[m])
            t = np.sort(t)
            iv = [(float(t[k]), float(t[k + 1])) for k in range(0, len(t) - 1, 2)]
            self.iv.append(iv)
        # fill empty stations with the nearest non-empty one
        ne = [k for k, iv in enumerate(self.iv) if iv]
        for k, iv in enumerate(self.iv):
            if not iv:
                j = min(ne, key=lambda q: abs(q - k))
                self.iv[k] = self.iv[j]

    def local(self, P):
        P = np.asarray(P, float).reshape(-1, 2)
        rel = P - self.o
        return rel @ self.u, rel @ self.v

    def query(self, P):
        """(s, t, half-width w, interval centre tm) per point (interval containing t, or nearest)."""
        s, t = self.local(P)
        k = np.clip(np.rint((s - self.st[0]) / self.ds).astype(int), 0, len(self.st) - 1)
        w = np.empty(len(s))
        tm = np.empty(len(s))
        for i in range(len(s)):
            best = None
            for (a, b) in self.iv[k[i]]:
                d = 0.0 if a <= t[i] <= b else min(abs(t[i] - a), abs(t[i] - b))
                if best is None or d < best[0]:
                    best = (d, a, b)
            w[i] = (best[2] - best[1]) / 2
            tm[i] = (best[2] + best[1]) / 2
        return s, t, w, tm

    def point(self, s, t):
        return self.o + self.u * s + self.v * t


def vault_z(sec, E_fn, C_fn, flat_top=0.0):
    """Circular-segment vault over the polygon's cross-sections: eave E(s, w) at the edges,
    crown C(s, w) on the interval centre line.  flat_top widens the crown (0..0.6)."""
    def z(P):
        s, t, w, tm = sec.query(P)
        E = E_fn(s, w)
        C = C_fn(s, w)
        H = np.maximum(C - E, 0.05)
        we = np.maximum(w * (1.0 - flat_top), 1.0)
        R = (we * we + H * H) / (2 * H)
        x = np.clip(np.abs(t - tm) - w * flat_top, 0.0, we)
        return E + np.sqrt(np.maximum(R * R - x * x, 0.0)) - (R - H)
    return z


def facade_fins_at(parts, sec, stations, width, depth, mat, z0=0.0):
    """Heavy structural fins on the facade at given stations (both sides of every interval)."""
    R = parts['ring']
    s, t = sec.local(R)
    at = parts['at']
    zs = parts['zs']
    g = Geo()
    tang = parts['tang']
    nout = parts['nout']
    for sr in stations:
        near = np.abs(s - sr) < sec.ds * 2.6
        if not near.any():
            continue
        idx = np.where(near)[0]
        # split by side: positive / negative t relative to the local centre
        _, _, _, tm = sec.query(R[idx])
        for side in (1, -1):
            cand = idx[np.sign(t[idx] - tm) == side]
            if len(cand) == 0:
                continue
            i = cand[int(np.argmin(np.abs(s[cand] - sr)))]
            bot = at(np.full(len(R), z0))[i]
            top = at(zs - 0.05)[i]
            if top[2] - bot[2] < 2.0:
                continue
            g += fins(bot[None], top[None], tang[i][None], nout[i][None], width, depth, mat)
    return g


# ------------------------------------------------------------- bridge stubs
def bridge_stubs(icao, ring, facade_base, lod, z0=5.0, z1=8.2, width=3.4, max_d=8.0):
    """Short glazed link stubs from each contact stand's `bridge_root` (on the OSM roof outline) back
    to the facade glass, at the runtime fixed-link section (floor 5.0 m, top 8.2 m, 3.4 m wide), so
    the runtime link boxes that end at bridge_root always meet the building."""
    from ap_layout import layout
    if lod >= 2:
        return Geo()
    R = P2.ccw(P2.as_ring(ring))
    rA, rB = P2.edges_of([R])
    fA, fB = P2.edges_of([P2.ccw(P2.as_ring(facade_base))])
    g = Geo()
    for st in layout(icao)['stands']:
        br = st.get('bridge_root')
        if not br or not st.get('contact'):
            continue
        p = np.asarray(br, float)
        if P2.seg_query(p[None], rA, rB)[0][0] > max_d:
            continue
        d, _, _, C = P2.seg_query(p[None], fA, fB)
        L = float(d[0])
        if L < 0.6 or L > 16.0:
            continue
        u = (C[0] - p) / L
        end = C[0] + u * 1.2
        g += prism(_rect(p, end, width), z0, z1, 'M_Glass', 'M_Roof', 'M_Structure')
    return g


def _rect(a, b, w):
    a, b = np.asarray(a, float), np.asarray(b, float)
    u = (b - a) / max(np.linalg.norm(b - a), 1e-9)
    v = np.array([-u[1], u[0]]) * (w / 2)
    return P2.ccw(np.array([a - v, b - v, b + v, a + v]))


# ------------------------------------------------------------- roof furniture
def rooftop_plant(region, zfn, n, seed, lod, size=(8, 14), height=(2.5, 4.0), margin=6.0,
                  mat='M_Structure', grille='M_Dark', axis=None):
    """Plant rooms / AHU boxes scattered (deterministically) on a roof region."""
    if lod >= 2 or n <= 0:
        return Geo()
    rng = random.Random(seed)
    r = P2.ccw(P2.as_ring(region))
    lo, hi = r.min(axis=0), r.max(axis=0)
    A, B = P2.edges_of([r])
    g = Geo()
    placed = []
    tries = 0
    if axis is None:
        _, axis, _, _ = P2.min_rect(r)
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    while len(placed) < n and tries < n * 60:
        tries += 1
        p = np.array([rng.uniform(lo[0], hi[0]), rng.uniform(lo[1], hi[1])])
        lx = rng.uniform(*size)
        ly = rng.uniform(size[0] * 0.6, size[0])
        hh = rng.uniform(*height)
        rad = 0.5 * math.hypot(lx, ly)
        if not P2.inside(p[None], [r])[0]:
            continue
        if P2.seg_query(p[None], A, B)[0][0] < rad + margin:
            continue
        if any(np.linalg.norm(p - q) < rad + rq + 3.0 for q, rq in placed):
            continue
        z = float(zfn(p[None])[0])
        corners = np.array([p + axis * sx * lx / 2 + np.array([-axis[1], axis[0]]) * sy * ly / 2
                            for sx in (-1, 1) for sy in (-1, 1)])
        zc = zfn(corners)
        z0 = float(zc.min()) - 0.3
        z1 = float(zc.max()) + hh
        g += obox(p, axis, lx, ly, z0, z1, mat, bottom=False)
        if lod == 0:
            # louvre band on the two long faces
            v = np.array([-axis[1], axis[0]])
            for sy in (-1, 1):
                c = p + v * sy * (ly / 2 + 0.05)
                a = c - axis * (lx * 0.42)
                b = c + axis * (lx * 0.42)
                za, zb = z1 - hh * 0.75, z1 - hh * 0.2
                pts = [np.r_[a, za], np.r_[b, za], np.r_[b, zb], np.r_[a, zb]]
                if sy > 0:      # a->b runs along +axis: the quad faces -v unless reversed
                    pts = [pts[1], pts[0], pts[3], pts[2]]
                g += quad(*pts, grille)
        placed.append((p, rad))
    return g


def obstruction_light(p, z, r=0.55, seg=8):
    return sphere((p[0], p[1], z), r, seg, 4, 'M_Lights')


def canopy_line(line, depth, z, thick, lod, *, side=1, col_every=18.0, col_r=0.35, mat='M_Structure',
                soffit='M_Structure', col_mat='M_Structure', closed=False):
    """Kerb canopy: a slab offset to one side of a plan polyline, on columns."""
    L = np.asarray(line, float)
    t = P2.tangents(L, closed)
    nrm = np.stack([t[:, 1], -t[:, 0]], axis=1) * side
    inner = L
    outer = L + nrm * depth
    ring = np.vstack([inner, outer[::-1]])
    ring = P2.ccw(ring)
    g = prism(ring, z - thick, z, mat, mat, soffit)
    if lod < 2 and col_every > 0:
        s = P2.arclength(L, closed=False)
        k = max(1, int(s[-1] // (col_every * (2 if lod else 1))))
        for i in range(k + 1):
            q = P2.polyline_point(L, s[-1] * i / k)
            j = int(np.clip(np.searchsorted(s, s[-1] * i / k), 0, len(L) - 1))
            c = q + nrm[j] * depth * 0.72
            g += cylinder(c, col_r, 0.0, z - thick, 8 if lod == 0 else 6, col_mat, cap0=False, cap1=False)
    return g


def crown_lantern(path2d, zfn, width, h_glass, h_fascia, lod, glass='M_GlassLit', roof='M_Roof',
                  fascia='M_Structure', step=4.0, sink=0.6):
    """Raised clerestory lantern following a roof crown line: glazed sides, fascia, flat-ish top."""
    p = P2.resample(np.asarray(path2d, float), step * LOD_STEP[lod], closed=False)
    t = P2.tangents(p, closed=False)
    nrm = np.stack([-t[:, 1], t[:, 0]], axis=1)
    L = p + nrm * width / 2
    Rr = p - nrm * width / 2
    zb = np.minimum(zfn(L), zfn(Rr)) - sink
    zc = zfn(p)
    z1 = zc + h_glass
    z2 = z1 + h_fascia
    g = Geo()
    for side, pts in ((1, L), (-1, Rr)):
        lo = np.c_[pts, zb]
        mid = np.c_[pts, z1]
        hi = np.c_[pts, z2]
        if side < 0:     # right side: faces -nrm with rows ordered along the path
            g += loft([lo, mid], glass)
            g += loft([mid, hi], fascia)
        else:            # left side: reverse the path direction to face +nrm
            g += loft([lo[::-1], mid[::-1]], glass)
            g += loft([mid[::-1], hi[::-1]], fascia)
    g += loft([np.c_[Rr, z2], np.c_[L, z2]], roof)
    # end caps
    for i, sgn in ((0, -1), (-1, 1)):
        a, b = Rr[i], L[i]
        quad_pts = [np.r_[a, zb[i]], np.r_[b, zb[i]], np.r_[b, z2[i]], np.r_[a, z2[i]]]
        if sgn < 0:
            quad_pts = quad_pts[::-1]
        g += quad(*quad_pts, fascia)
    return g


def ogee_arch(span, rise, n=10):
    """Ogee arch from the left springing to the right: each half is a cubic Bezier that leaves the
    springing vertically (convex, like a round arch), turns inward and rises concavely to a pointed
    apex with a vertical tangent (the S-curve of the classic ogee)."""
    half = span / 2
    P0 = np.array([-half, 0.0])
    P1 = np.array([-half, 0.62 * rise])
    P2_ = np.array([-0.02 * half, 0.38 * rise])
    P3 = np.array([0.0, rise])
    pts = []
    for i in range(n + 1):
        t = i / n
        q = (1 - t) ** 3 * P0 + 3 * (1 - t) ** 2 * t * P1 + 3 * (1 - t) * t * t * P2_ + t ** 3 * P3
        pts.append((float(q[0]), float(q[1])))
    pts[-1] = (0.0, rise)
    right = [(-x, y) for (x, y) in reversed(pts[:-1])]
    return pts + right


def arch_frame(base_a, base_b, rise, z0, prof_w, prof_d, mat, curve='pointed', n=8, legs=0.0, nout=None,
               open_back=False):
    """Arch outline (pointed / ogee / round) between two plan points, standing in the vertical plane
    through them, swept with a rectangular profile (legs = straight jambs below the springing)."""
    a = np.asarray(base_a, float)
    b = np.asarray(base_b, float)
    span = float(np.linalg.norm(b - a))
    if span < 0.5:
        return Geo()
    d = (b - a) / span
    mid = (a + b) / 2
    if curve == 'ogee':
        prof = ogee_arch(span, rise, n)
    elif curve == 'round':
        prof = [(-span / 2 * math.cos(math.pi * i / (2 * n)), span / 2 * math.sin(math.pi * i / (2 * n)))
                for i in range(2 * n + 1)]
    else:
        from ap_geo import pointed_arch
        prof = pointed_arch(span, rise, n)
    pts = []
    if legs > 0:
        pts.append(np.r_[mid + d * prof[0][0], z0])
    for x, y in prof:
        pts.append(np.r_[mid + d * x, z0 + legs + y])
    if legs > 0:
        pts.append(np.r_[mid + d * prof[-1][0], z0])
    side = np.r_[-d[1], d[0], 0.0] if nout is None else np.r_[nout[0], nout[1], 0.0]
    sec = [(-prof_d / 2, -prof_w / 2), (prof_d / 2, -prof_w / 2), (prof_d / 2, prof_w / 2), (-prof_d / 2, prof_w / 2)]
    pts = np.array(pts)
    # pointed and ogee arches have a cusp at the apex: sweep the two halves separately so the
    # profile never folds through the cusp
    halves = [pts]
    if curve in ('pointed', 'ogee'):
        k = int(np.argmax(pts[:, 2]))
        left, right = pts[:k + 1].copy(), pts[k:].copy()
        if open_back and len(left) > 1 and len(right) > 1:
            # let the halves overlap a little past the apex so their open ends stay hidden
            e = 0.6 * prof_w
            tl = left[-1] - left[-2]
            tr = right[0] - right[1]
            left = np.vstack([left, left[-1] + tl / max(np.linalg.norm(tl), 1e-9) * e])
            right = np.vstack([right[0] + tr / max(np.linalg.norm(tr), 1e-9) * e, right])
        halves = [left, right]
    g = Geo()
    for h in halves:
        if len(h) < 2:
            continue
        if open_back:   # the back face lies against the wall: sweep only the three visible faces
            g += sweep(h, sec, mat, side_hint=side, closed_profile=False, cap=False)
        else:
            g += sweep(h, sec, mat, side_hint=side)
    return g


def arcade(ring, z0, bay, leg, rise, lod, *, pier=1.2, offset=0.08, panel='M_Accent', frame='M_Structure',
           frame_w=0.45, frame_d=0.35, closed=True, n=6, min_bay=None, keep_corners_deg=25.0, curve='pointed',
           glass_frac=0.0, glass='M_GlassLit', frame_lod1=False, sides=True, side_mat='M_Concrete'):
    """Pointed-arch panels (lattice screens) along a facade polyline (CCW = outward), one per bay,
    with a swept frame around each arch (LOD0, and LOD1 if frame_lod1).  glass_frac > 0 glazes the
    lower part of every opening (lit at night) and keeps the screen in the arch head."""
    from ap_geo import pointed_arch
    R0 = P2.as_ring(ring)
    R0f = P2.subdivide(R0, 1.0, closed=closed)
    R = P2.resample(R0, bay, closed=closed, keep_corners_deg=keep_corners_deg)
    m = len(R) if closed else len(R) - 1
    g = Geo()
    nseg = n if lod == 0 else max(3, n // 2)
    for i in range(m):
        a = R[i]
        b = R[(i + 1) % len(R)]
        L = float(np.linalg.norm(b - a))
        if L < (min_bay or bay * 0.55):
            continue
        t = (b - a) / L
        nrm = np.array([t[1], -t[0]])
        span = L - pier
        if span < 0.8:
            continue
        mid = (a + b) / 2
        # the wall may bulge out beyond the chord (curved walls): push the panel out by the sagitta
        ia = int(np.argmin(np.linalg.norm(R0f - a, axis=1)))
        ib = int(np.argmin(np.linalg.norm(R0f - b, axis=1)))
        seg_idx = np.arange(ia, ib + 1) if ib >= ia else np.r_[np.arange(ia, len(R0f)), np.arange(0, ib + 1)]
        if len(seg_idx) > len(R0f) // 2:
            seg_idx = np.array([ia, ib])
        w_ = (R0f[seg_idx] - a) @ nrm
        dev = float(np.clip(w_.max(), 0.0, 0.25 * L))
        off_i = offset + dev
        h_rise = min(rise, span * 0.95) if curve == 'pointed' else span / 2
        prof = pointed_arch(span, max(h_rise, span / 2 + 0.01), nseg) if curve == 'pointed' else \
            [(-span / 2 * math.cos(math.pi * k / (2 * nseg)), span / 2 * math.sin(math.pi * k / (2 * nseg)))
             for k in range(2 * nseg + 1)]
        hs = leg * glass_frac
        if hs > 0.05:
            low = [(-span / 2, 0.0), (span / 2, 0.0), (span / 2, hs), (-span / 2, hs)]
            g.add([np.r_[mid + t * x + nrm * off_i, z0 + y] for (x, y) in low], [(0, 1, 2, 3)], glass)
        uv = [(-span / 2, hs), (span / 2, hs)] + [(x, leg + y) for (x, y) in reversed(prof)]
        uv = [p for k, p in enumerate(uv) if k == 0 or np.hypot(p[0] - uv[k - 1][0], p[1] - uv[k - 1][1]) > 1e-4]
        pts = [np.r_[mid + t * x + nrm * off_i, z0 + y] for (x, y) in uv]
        g.add(pts, [tuple(range(len(pts)))], panel)
        if lod == 0 and sides:
            # close the reveal between the (straight) panel and the (possibly curved) wall
            back = np.r_[nrm, 0.0] * (off_i + 0.12)
            ring_pts = ([np.r_[mid + t * x + nrm * off_i, z0 + y] for (x, y) in low] if hs > 0.05 else []) + pts
            outline = [np.r_[mid + t * x + nrm * off_i, z0 + y] for (x, y) in
                       ([(-span / 2, 0.0), (span / 2, 0.0)] + [(x, leg + y) for (x, y) in reversed(prof)])]
            outline = [p for k, p in enumerate(outline) if k == 0 or np.linalg.norm(p - outline[k - 1]) > 1e-4]
            m_ = len(outline)
            verts_ = outline + [p - back for p in outline]
            faces_ = [(k, m_ + k, m_ + (k + 1) % m_, (k + 1) % m_) for k in range(m_)]
            g.add(verts_, faces_, side_mat)
        if frame and (lod == 0 or (lod == 1 and frame_lod1)):
            fd = frame_d + dev
            fo = offset - 0.12 + fd / 2
            g += arch_frame(mid - t * span / 2 + nrm * fo, mid + t * span / 2 + nrm * fo,
                            max(h_rise, span / 2 + 0.01), z0, frame_w, fd, frame, 'pointed' if curve == 'pointed' else 'round',
                            nseg if lod == 0 else 3, legs=leg, nout=nrm, open_back=True)
    return g


def dome(c, r, rise, z0, lod, *, drum_h=0.0, drum_r=None, mat='M_Roof', drum_mat='M_Concrete', windows=0,
         win_mat='M_GlassLit', finial=True, finial_mat='M_Structure', ribs=0, rib_mat='M_Structure', base_ring=True):
    """Slightly pointed dome on an optional drum with arched windows and a finial."""
    from ap_geo import pointed_arch
    seg = {0: 48, 1: 24, 2: 12}[lod]
    nprof = {0: 12, 1: 7, 2: 4}[lod]
    g = Geo()
    drum_r = r if drum_r is None else drum_r
    zd = z0 + drum_h
    if drum_h > 0:
        g += cylinder((c[0], c[1]), drum_r, z0, zd, seg, drum_mat, cap0=False, cap1=False)
        if base_ring and lod < 2:
            g += lathe([(drum_r, zd - 0.6), (drum_r + 0.5, zd - 0.5), (drum_r + 0.5, zd + 0.3), (r, zd + 0.3)],
                       seg, (c[0], c[1], 0), 'M_Structure')
        if windows and lod < 2:
            ring = np.array([[c[0] + drum_r * math.cos(2 * math.pi * k / windows),
                              c[1] + drum_r * math.sin(2 * math.pi * k / windows)] for k in range(windows)])
            bay = 2 * drum_r * math.sin(math.pi / windows)
            g += arcade(ring, z0 + 0.15 * drum_h, bay * 0.999, drum_h * 0.35, drum_h * 0.45, lod, pier=bay * 0.35,
                        panel=win_mat, frame=None if lod else 'M_Structure', frame_w=0.3, frame_d=0.25,
                        min_bay=bay * 0.5, keep_corners_deg=None)
        zd += 0.3
    half = pointed_arch(2 * r, rise, nprof)
    k0 = len(half) // 2
    prof = [(x, y) for (x, y) in half[k0:]][::-1]      # (r, z) from the springing up to the apex
    prof = [(abs(x), zd + y) for (x, y) in prof]
    prof[-1] = (0.0, prof[-1][1])
    g += lathe(prof, seg, (c[0], c[1], 0), mat)
    top = prof[-1][1]
    if ribs and lod < 2:
        for k in range(ribs):
            a = 2 * math.pi * k / ribs
            pts = [np.array([c[0] + (rr + 0.12) * math.cos(a), c[1] + (rr + 0.12) * math.sin(a), zz])
                   for (rr, zz) in prof[:-1]]
            pts.append(np.array([c[0], c[1], top + 0.1]))
            g += sweep(np.array(pts), [(-0.25, -0.1), (0.25, -0.1), (0.25, 0.35), (-0.25, 0.35)], rib_mat,
                       side_hint=np.array([-math.sin(a), math.cos(a), 0.0]))
    if finial:
        g += cylinder((c[0], c[1]), 0.35, top - 0.3, top + 2.2, 8, finial_mat, r1=0.15)
        g += sphere((c[0], c[1], top + 0.9), 0.55, 8, 4, finial_mat)
        if lod < 2:
            # crescent finial: a small swept arc
            arc = [np.array([c[0], c[1] + 0.9 * math.cos(t), top + 3.0 + 0.9 * math.sin(t)])
                   for t in np.linspace(0.82 * math.pi, 2.18 * math.pi, 11)]
            g += sweep(np.array(arc), [(-0.12, -0.12), (0.12, -0.12), (0.12, 0.12), (-0.12, 0.12)], finial_mat,
                       side_hint=np.array([1.0, 0.0, 0.0]))
    return g, top


def drape_strip(path2d, zfn, width, lift, thick, mat, step=4.0):
    """A strip (skylight band, rib) following a roof height field along a plan path.  The sides
    always reach 0.25 m below the roof surface so no open underside is ever visible."""
    thick = max(thick, lift + 0.25)
    p = np.asarray(path2d, float)
    p = P2.resample(p, step, closed=False)
    t = P2.tangents(p, closed=False)
    nrm = np.stack([-t[:, 1], t[:, 0]], axis=1)
    left = p + nrm * width / 2
    right = p - nrm * width / 2
    zl = zfn(left) + lift
    zr = zfn(right) + lift
    zc = zfn(p) + lift
    top_l = np.c_[left, zl]
    top_r = np.c_[right, zr]
    g = Geo()
    # top surface (normal up): rows right -> left along the path
    g += loft([top_r, top_l], mat)
    if thick > 0:
        g += loft([top_r - [0, 0, thick], top_r], mat)        # right side faces -nrm
        g += loft([top_l, top_l - [0, 0, thick]], mat)        # left side faces +nrm
        # end caps (start faces -t, end faces +t)
        for i, sgn in ((0, -1), (-1, 1)):
            r_hi, l_hi = top_r[i], top_l[i]
            r_lo, l_lo = r_hi - [0, 0, thick], l_hi - [0, 0, thick]
            pts = [r_lo, l_lo, l_hi, r_hi] if sgn > 0 else [l_lo, r_lo, r_hi, l_hi]
            g += quad(*pts, mat)
    return g
