"""Polygon-soup mesh builder for the airport architecture (pure Python + numpy).

`Geo` collects vertices, faces and a material name per face.  Faces are CCW seen from the
outside (right-hand normal points out); every visible surface is single sided, so solids are
closed or carry an explicit back face.  Coordinates are the airport ENU frame (x east, y north,
z up, metres).
"""
import math

import numpy as np

from ap_poly import as_ring, ccw, cw, triangulate

TAU = math.tau


class Geo:
    __slots__ = ("v", "f", "m")

    def __init__(self):
        self.v = []   # list of (x, y, z)
        self.f = []   # list of tuples of vertex indices
        self.m = []   # material name per face

    # ---------------------------------------------------------------- build
    def add(self, verts, faces, mat):
        base = len(self.v)
        self.v.extend((float(p[0]), float(p[1]), float(p[2])) for p in verts)
        if isinstance(mat, str):
            for f in faces:
                self.f.append(tuple(base + int(k) for k in f))
                self.m.append(mat)
        else:
            for f, mm in zip(faces, mat):
                self.f.append(tuple(base + int(k) for k in f))
                self.m.append(mm)
        return self

    def merge(self, other):
        if other is None:
            return self
        base = len(self.v)
        self.v.extend(other.v)
        self.f.extend(tuple(base + i for i in f) for f in other.f)
        self.m.extend(other.m)
        return self

    def __iadd__(self, other):
        return self.merge(other)

    def copy(self):
        g = Geo()
        return g.merge(self)

    # ------------------------------------------------------------ transform
    def apply(self, fn):
        V = np.array(self.v, float).reshape(-1, 3)
        if len(V):
            V = fn(V)
            self.v = [tuple(p) for p in V.tolist()]
        return self

    def move(self, x=0.0, y=0.0, z=0.0):
        return self.apply(lambda V: V + np.array([x, y, z]))

    def matrix(self, M):
        """Apply a 4x4 (or 3x3) numpy matrix; flips winding if it mirrors."""
        M = np.asarray(M, float)
        if M.shape == (3, 3):
            M4 = np.eye(4)
            M4[:3, :3] = M
            M = M4
        self.apply(lambda V: (np.c_[V, np.ones(len(V))] @ M.T)[:, :3])
        if np.linalg.det(M[:3, :3]) < 0:
            self.flip()
        return self

    def rot_z(self, ang, about=(0.0, 0.0)):
        c, s = math.cos(ang), math.sin(ang)
        ax, ay = about

        def fn(V):
            x = V[:, 0] - ax
            y = V[:, 1] - ay
            return np.stack([ax + c * x - s * y, ay + s * x + c * y, V[:, 2]], axis=1)
        return self.apply(fn)

    def flip(self):
        self.f = [tuple(reversed(f)) for f in self.f]
        return self

    def set_mat(self, mat):
        self.m = [mat] * len(self.f)
        return self

    # ---------------------------------------------------------------- query
    def ntris(self):
        return sum(len(f) - 2 for f in self.f)

    def bbox(self):
        V = np.array(self.v, float).reshape(-1, 3)
        return V.min(axis=0), V.max(axis=0)

    def empty(self):
        return not self.f


# ======================================================================= helpers
def _P(p):
    return np.asarray(p, float)


def quad(p0, p1, p2, p3, mat):
    return Geo().add([p0, p1, p2, p3], [(0, 1, 2, 3)], mat)


def tri(p0, p1, p2, mat):
    return Geo().add([p0, p1, p2], [(0, 1, 2)], mat)


def loft(rows, mat, closed=False, cap0=False, cap1=False):
    """Quad grid between consecutive polylines (rows[k] are (N,3) arrays with equal N).
    Row direction x row-to-row direction gives the face normal (right-hand rule): for a
    CCW (plan) ring as row 0 at the bottom and the same ring higher as row 1, faces point out."""
    rows = [np.asarray(r, float) for r in rows]
    n = len(rows[0])
    verts = np.concatenate(rows)
    faces = []
    m = n if closed else n - 1
    for k in range(len(rows) - 1):
        a0 = k * n
        b0 = (k + 1) * n
        for i in range(m):
            j = (i + 1) % n
            faces.append((a0 + i, a0 + j, b0 + j, b0 + i))
    g = Geo().add(verts, faces, mat)
    if closed and cap0:
        g.f.append(tuple(range(n - 1, -1, -1)))
        g.m.append(mat)
    if closed and cap1:
        b0 = (len(rows) - 1) * n
        g.f.append(tuple(b0 + i for i in range(n)))
        g.m.append(mat)
    return g


def walls(ring, z0, z1, mat, closed=True):
    """Vertical walls along a (CCW = outward facing) plan polyline.  z0/z1 scalars or arrays."""
    r = np.asarray(ring, float)
    n = len(r)
    z0 = np.broadcast_to(np.asarray(z0, float), (n,))
    z1 = np.broadcast_to(np.asarray(z1, float), (n,))
    lo = np.c_[r, z0]
    hi = np.c_[r, z1]
    return loft([lo, hi], mat, closed=closed)


def cap(outer, z, mat, holes=(), up=True, steiner=None):
    """Flat polygon (with holes) at height z (scalar or callable(xy)->z)."""
    V2, T = triangulate(outer, holes, steiner)
    if callable(z):
        Z = z(V2)
    else:
        Z = np.full(len(V2), float(z))
    V = np.c_[V2, Z]
    faces = T if up else T[:, ::-1]
    return Geo().add(V, faces.tolist(), mat)


def prism(outer, z0, z1, mat_side, mat_top=None, mat_bot=None, holes=(), bottom=True, top=True):
    """Extruded polygon (outer CCW, holes) from z0 to z1 with caps."""
    outer = ccw(as_ring(outer))
    g = Geo()
    g += walls(outer, z0, z1, mat_side)
    for h in holes:
        g += walls(cw(as_ring(h)), z0, z1, mat_side)
    if top:
        g += cap(outer, z1, mat_top or mat_side, holes, up=True)
    if bottom:
        g += cap(outer, z0, mat_bot or mat_side, holes, up=False)
    return g


def box(lo, hi, mat, faces_mask=None):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    if faces_mask is not None:
        faces = [f for f, k in zip(faces, faces_mask) if k]
    return Geo().add(p, faces, mat)


def obox(center, u, lx, ly, z0, z1, mat, bottom=True):
    """Oriented box in plan: centre (x, y), long axis unit u (2D), sizes lx (along u), ly."""
    c = _P(center)[:2]
    u = _P(u)[:2] / np.linalg.norm(_P(u)[:2])
    v = np.array([-u[1], u[0]])
    hx, hy = lx / 2, ly / 2
    ring = np.array([c - u * hx - v * hy, c + u * hx - v * hy, c + u * hx + v * hy, c - u * hx + v * hy])
    return prism(ring, z0, z1, mat, bottom=bottom)


def seg_box(a, b, w, h, mat, z_mode='center'):
    """Box (beam) between 3D points a and b with cross-section w (horizontal) x h (vertical-ish)."""
    a, b = _P(a), _P(b)
    t = b - a
    L = np.linalg.norm(t)
    if L < 1e-9:
        return Geo()
    t = t / L
    up = np.array([0.0, 0.0, 1.0])
    s = np.cross(t, up)
    if np.linalg.norm(s) < 1e-6:
        s = np.array([1.0, 0.0, 0.0])
    return sweep([a, b], rect_profile(w, h), mat, side_hint=s)


def lathe(profile, seg, center=(0, 0, 0), mat='M_Concrete', a0=0.0, a1=TAU, cap0=False, cap1=False,
          phase=0.0, sx=1.0, sy=1.0):
    """Revolve a (r, z) profile (bottom -> top for an outward facing wall) about the vertical
    axis through center.  r == 0 entries become poles.  sx/sy squash into an ellipse."""
    cx, cy, cz = center
    prof = []
    for p in profile:
        if not prof or abs(p[0] - prof[-1][0]) > 1e-6 or abs(p[1] - prof[-1][1]) > 1e-6:
            prof.append(p)
    profile = prof
    full = abs((a1 - a0) - TAU) < 1e-6
    ncol = seg if full else seg + 1
    verts = []
    rings = []
    for (r, h) in profile:
        if r < 1e-7:
            rings.append([len(verts)])
            verts.append((cx, cy, cz + h))
        else:
            ring = []
            for j in range(ncol):
                t = a0 + phase + (a1 - a0) * j / seg
                ring.append(len(verts))
                verts.append((cx + sx * r * math.cos(t), cy + sy * r * math.sin(t), cz + h))
            rings.append(ring)
    faces = []
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        for j in range(seg):
            jn = (j + 1) % ncol if full else j + 1
            if len(A) == 1:
                faces.append((A[0], B[jn], B[j]))
            elif len(B) == 1:
                faces.append((A[j], A[jn], B[0]))
            else:
                faces.append((A[j], A[jn], B[jn], B[j]))
    if full:
        if cap0 and len(rings[0]) > 1:
            faces.append(tuple(reversed(rings[0])))
        if cap1 and len(rings[-1]) > 1:
            faces.append(tuple(rings[-1]))
    return Geo().add(verts, faces, mat)


def cylinder(c, r, z0, z1, seg, mat, r1=None, cap0=True, cap1=True):
    r1 = r if r1 is None else r1
    return lathe([(r, z0), (r1, z1)], seg, (c[0], c[1], 0.0), mat, cap0=cap0, cap1=cap1)


def sphere(c, r, seg=12, rings=8, mat='M_Lights', z0=-1.0, z1=1.0, sz=1.0):
    prof = []
    for i in range(rings + 1):
        t = -math.pi / 2 + math.pi * i / rings
        s = math.sin(t)
        if s < z0 - 1e-6 or s > z1 + 1e-6:
            continue
        prof.append((r * math.cos(t) if abs(math.cos(t)) > 1e-9 else 0.0, r * sz * s))
    g = lathe(prof, seg, (c[0], c[1], c[2]), mat, cap0=prof[0][0] > 1e-6, cap1=prof[-1][0] > 1e-6)
    return g


def frames(path, side_hint=None, closed=False):
    """Tangent / side / normal frames along a 3D path.  If side_hint (3,) is given the side
    vector is kept perpendicular to the tangent closest to it (good for arches in a plane);
    otherwise 'up' is kept as close to +Z as possible."""
    P = np.asarray(path, float)
    n = len(P)
    T = np.zeros_like(P)
    for i in range(n):
        if closed:
            d = P[(i + 1) % n] - P[i - 1]
        elif i == 0:
            d = P[1] - P[0]
        elif i == n - 1:
            d = P[-1] - P[-2]
        else:
            d = P[i + 1] - P[i - 1]
        T[i] = d / max(np.linalg.norm(d), 1e-12)
    S = np.zeros_like(P)
    N = np.zeros_like(P)
    up = np.array([0.0, 0.0, 1.0])
    for i in range(n):
        if side_hint is not None:
            s = np.asarray(side_hint, float)
            s = s - T[i] * np.dot(s, T[i])
        else:
            s = np.cross(T[i], up)
            if np.linalg.norm(s) < 1e-6:
                s = S[i - 1] if i else np.array([1.0, 0.0, 0.0])
        s = s / max(np.linalg.norm(s), 1e-12)
        S[i] = s
        N[i] = np.cross(s, T[i])
    return T, S, N


def sweep(path, profile, mat, side_hint=None, closed_profile=True, closed_path=False, scale=None,
          cap=True):
    """Sweep a 2D profile [(x along side, y along normal)] along a 3D path.  For a CCW profile
    (seen looking along the path) the faces point outward."""
    P = np.asarray(path, float)
    T, S, N = frames(P, side_hint, closed_path)
    prof = np.asarray(profile, float)
    rows = []
    for i in range(len(P)):
        k = 1.0 if scale is None else float(scale[i])
        rows.append(P[i] + np.outer(prof[:, 0] * k, S[i]) + np.outer(prof[:, 1] * k, N[i]))
    # faces: row i (profile ring) -> row i+1 ; profile CCW in the (S, N) plane looking along +T
    # gives outward faces with the ordering (a_i, a_j, b_j, b_i) when ring order runs S -> N.
    g = Geo()
    m = len(prof)
    verts = np.concatenate(rows)
    faces = []
    nseg = len(P) if closed_path else len(P) - 1
    for i in range(nseg):
        i2 = (i + 1) % len(P)
        for j in range(m if closed_profile else m - 1):
            j2 = (j + 1) % m
            faces.append((i * m + j, i2 * m + j, i2 * m + j2, i * m + j2))
    g.add(verts, faces, mat)
    if cap and closed_profile and not closed_path:
        # (S, N, T) is left-handed: the profile in its own order faces -T (start cap)
        g.f.append(tuple(range(m)))
        g.m.append(mat)
        last = (len(P) - 1) * m
        g.f.append(tuple(last + j for j in range(m - 1, -1, -1)))
        g.m.append(mat)
    return g


def tube(path, r, seg, mat, cap=True, closed_path=False, side_hint=None):
    prof = [(r * math.cos(TAU * k / seg), r * math.sin(TAU * k / seg)) for k in range(seg)]
    return sweep(path, prof, mat, side_hint, True, closed_path, None, cap)


def rect_profile(w, h, y0=None):
    """CCW rectangle profile, width w along the side vector, height h along the normal;
    y0 = bottom (default centred)."""
    y0 = -h / 2 if y0 is None else y0
    return [(-w / 2, y0), (w / 2, y0), (w / 2, y0 + h), (-w / 2, y0 + h)]


def heightfield(V2, T, Z, mat, flip=False):
    V = np.c_[np.asarray(V2, float), np.asarray(Z, float)]
    faces = np.asarray(T)[:, ::-1] if flip else np.asarray(T)
    return Geo().add(V, faces.tolist(), mat)


def disc(c, r, seg, mat, normal_up=True):
    cx, cy, cz = c
    pts = [(cx + r * math.cos(TAU * k / seg), cy + r * math.sin(TAU * k / seg), cz) for k in range(seg)]
    face = tuple(range(seg)) if normal_up else tuple(range(seg - 1, -1, -1))
    return Geo().add(pts, [face], mat)


def pointed_arch(span, rise, n=8):
    """Two-centred (pointed) arch: points from the left springing (-span/2, 0) over the apex
    (0, rise) to the right springing (span/2, 0); 2n segments.  rise >= span/2 (rise == span/2
    gives a semicircle, rise == 0.866 span an equilateral gothic arch)."""
    w = float(span)
    h = max(float(rise), w / 2 + 1e-6)
    c = (h * h - w * w / 4) / w          # arc centres at (+c, 0) and (-c, 0)
    R = c + w / 2
    th0 = math.pi
    th1 = math.atan2(h, -c)
    left = []
    for i in range(n + 1):
        th = th0 + (th1 - th0) * i / n
        left.append((c + R * math.cos(th), R * math.sin(th)))
    left[-1] = (0.0, h)
    right = [(-x, y) for (x, y) in reversed(left[:-1])]
    return left + right
