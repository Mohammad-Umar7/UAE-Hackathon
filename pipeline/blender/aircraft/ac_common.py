"""Shared geometry helpers for the SKYPACT aircraft generator.

Pure numpy where possible; Blender (bpy) is only touched in `make_object`.
Coordinates: Blender frame, X = right (starboard), Y = forward (nose), Z = up.
"""
import math
import numpy as np

DEG = math.pi / 180.0


# ----------------------------------------------------------------------------- math

def normalize(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def window(x, a0, a1, b0, b1):
    """Smooth plateau: 0 before a0, ramps to 1 at a1, stays 1 until b0, back to 0 at b1."""
    return smoothstep(a0, a1, x) * (1.0 - smoothstep(b0, b1, x))


def smax(a, b, k):
    """Polynomial smooth maximum (exact max when |a-b| >= k)."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.maximum(a, b) + h * h * k * 0.25


class Pchip:
    """Monotone cubic Hermite interpolation (Fritsch-Carlson). Clamped outside the range."""

    def __init__(self, pts):
        pts = sorted(pts, key=lambda p: p[0])
        x = np.array([p[0] for p in pts], float)
        y = np.array([p[1] for p in pts], float)
        keep = np.concatenate([[True], np.diff(x) > 1e-9])
        x, y = x[keep], y[keep]
        self.x, self.y = x, y
        n = len(x)
        if n == 1:
            self.m = np.zeros(1)
            return
        h = np.diff(x)
        d = np.diff(y) / h
        m = np.zeros(n)
        if n == 2:
            m[:] = d[0]
        else:
            for k in range(1, n - 1):
                if d[k - 1] * d[k] <= 0:
                    m[k] = 0.0
                else:
                    w1 = 2 * h[k] + h[k - 1]
                    w2 = h[k] + 2 * h[k - 1]
                    m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])
            m[0] = self._end(h[0], h[1], d[0], d[1])
            m[-1] = self._end(h[-1], h[-2], d[-1], d[-2])
        self.m = m

    @staticmethod
    def _end(h0, h1, d0, d1):
        m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
        if np.sign(m) != np.sign(d0):
            m = 0.0
        elif np.sign(d0) != np.sign(d1) and abs(m) > abs(3 * d0):
            m = 3 * d0
        return m

    def __call__(self, xq):
        xq = np.asarray(xq, float)
        if len(self.x) == 1:
            return np.full_like(xq, self.y[0])
        xc = np.clip(xq, self.x[0], self.x[-1])
        k = np.clip(np.searchsorted(self.x, xc) - 1, 0, len(self.x) - 2)
        h = self.x[k + 1] - self.x[k]
        t = (xc - self.x[k]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * self.y[k] + (t3 - 2 * t2 + t) * h * self.m[k]
                + (-2 * t3 + 3 * t2) * self.y[k + 1] + (t3 - t2) * h * self.m[k + 1])


class Lin:
    """Piecewise-linear interpolation, clamped."""

    def __init__(self, pts):
        pts = sorted(pts, key=lambda p: p[0])
        self.x = np.array([p[0] for p in pts], float)
        self.y = np.array([p[1] for p in pts], float)

    def __call__(self, xq):
        return np.interp(np.asarray(xq, float), self.x, self.y)


def nose_curve(s0, length, v0, v1, a, n=10, power=2.2):
    """Control points of a superelliptic nose profile from v0 (tip) to v1 over `length`.
    Points are clustered towards the tip so a PCHIP through them stays blunt."""
    pts = []
    for i in range(n + 1):
        u = (i / n) ** power
        f = (1.0 - (1.0 - u) ** a) ** (1.0 / a)
        pts.append((s0 + u * length, v0 + (v1 - v0) * f))
    return pts


def rot_axis(v, axis, ang):
    """Rotate vectors v (...,3) about unit axis by ang (Rodrigues)."""
    axis = normalize(axis)
    v = np.asarray(v, float)
    c, s = math.cos(ang), math.sin(ang)
    return v * c + np.cross(axis, v) * s + np.outer(np.dot(v.reshape(-1, 3), axis), axis).reshape(v.shape) * (1 - c)


def frame_from(direction, up_hint=(0, 0, 1)):
    """Orthonormal frame (d, a, b) with d along `direction`."""
    d = normalize(np.asarray(direction, float))
    up = np.asarray(up_hint, float)
    if abs(np.dot(d, normalize(up))) > 0.95:
        up = np.array([1.0, 0, 0])
    a = normalize(np.cross(up, d))
    b = np.cross(d, a)
    return d, a, b


# ----------------------------------------------------------------------------- airfoils

def naca_thickness(x, t):
    x = np.clip(np.asarray(x, float), 0.0, 1.0)
    return 5 * t * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)


def naca_camber(x, m, p, aft=0.0):
    x = np.asarray(x, float)
    if m > 0 and p > 0:
        yc = np.where(x < p, m / p ** 2 * (2 * p * x - x ** 2), m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x ** 2))
        dy = np.where(x < p, 2 * m / p ** 2 * (p - x), 2 * m / (1 - p) ** 2 * (p - x))
    else:
        yc = np.zeros_like(x)
        dy = np.zeros_like(x)
    if aft:
        # aft loading (supercritical-like): extra camber concentrated near 75% chord
        yc = yc + aft * 6.75 * x ** 2 * (1 - x)
        dy = dy + aft * 6.75 * (2 * x - 3 * x ** 2)
    return yc, dy


def airfoil_pt(xc, t, m=0.0, p=0.4, aft=0.0, upper=True):
    """(x, y) of an airfoil surface at chord fraction(s) xc. Returns arrays."""
    yt = naca_thickness(xc, t)
    yc, dy = naca_camber(xc, m, p, aft)
    th = np.arctan(dy)
    if upper:
        return xc - yt * np.sin(th), yc + yt * np.cos(th)
    return xc + yt * np.sin(th), yc - yt * np.cos(th)


def chord_stations(n, le_cluster=1.0):
    """n chord fractions 0..1 with cosine clustering (dense at LE and TE)."""
    b = np.linspace(0, math.pi, n)
    x = (1 - np.cos(b)) / 2
    if le_cluster != 1.0:
        x = x ** le_cluster
    return x


def airfoil_loop(xs, t, m=0.0, p=0.4, aft=0.0):
    """Open loop: TE(upper) -> LE -> TE(lower). xs ascending 0..1 (includes 0 and 1).
    Returns (K,2) array, K = 2*len(xs)-1, and the chord fraction per point."""
    xu, yu = airfoil_pt(xs, t, m, p, aft, True)
    xl, yl = airfoil_pt(xs, t, m, p, aft, False)
    loop = np.concatenate([np.stack([xu[::-1], yu[::-1]], 1), np.stack([xl[1:], yl[1:]], 1)])
    frac = np.concatenate([xs[::-1], xs[1:]])
    return loop, frac


# ----------------------------------------------------------------------------- normals

def grid_normals(P, close_u=False, close_v=False):
    """Vertex normals of a structured grid P (nu, nv, 3) from central differences.
    Orientation follows the face winding (i,j)->(i+1,j)->(i+1,j+1)->(i,j+1)."""
    P = np.asarray(P, float)
    if close_u:
        du = np.roll(P, -1, 0) - np.roll(P, 1, 0)
    else:
        du = np.empty_like(P)
        du[1:-1] = P[2:] - P[:-2]
        du[0] = P[1] - P[0]
        du[-1] = P[-1] - P[-2]
    if close_v:
        dv = np.roll(P, -1, 1) - np.roll(P, 1, 1)
    else:
        dv = np.empty_like(P)
        dv[:, 1:-1] = P[:, 2:] - P[:, :-2]
        dv[:, 0] = P[:, 1] - P[:, 0]
        dv[:, -1] = P[:, -1] - P[:, -2]
    n = np.cross(du, dv)
    ln = np.linalg.norm(n, axis=-1)
    bad = ln < 1e-12
    if bad.any():
        # fall back to neighbouring rows for collapsed rows/columns
        for _ in range(3):
            if not bad.any():
                break
            idx = np.argwhere(bad)
            for i, j in idx:
                cand = []
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ii, jj = i + di, j + dj
                    if 0 <= ii < P.shape[0] and 0 <= jj < P.shape[1] and not bad[ii, jj]:
                        cand.append(n[ii, jj] / ln[ii, jj])
                if cand:
                    n[i, j] = np.mean(cand, 0)
                    ln[i, j] = np.linalg.norm(n[i, j])
                    bad[i, j] = ln[i, j] < 1e-12
    return normalize(n)


# ----------------------------------------------------------------------------- mesh builder

class MB:
    """Collects triangles/quads per material for one LOD (or one special node).

    Vertices carry explicit normals so that seams between material buckets shade
    continuously (they become custom split normals in Blender)."""

    def __init__(self):
        self.b = {}

    def _bucket(self, mat):
        if mat not in self.b:
            self.b[mat] = {"V": [], "N": [], "F": [], "n": 0, "A": [], "UV": []}
        return self.b[mat]

    def add(self, mat, V, N, F, axle=None, uv=None):
        V = np.asarray(V, float).reshape(-1, 3)
        N = np.asarray(N, float).reshape(-1, 3)
        if len(V) == 0:
            return
        bk = self._bucket(mat)
        base = bk["n"]
        bk["V"].append(V)
        bk["N"].append(normalize(N))
        for f in F:
            bk["F"].append(tuple(int(base + i) for i in f))
        if axle is not None:
            A = np.asarray(axle, float)
            if A.ndim == 1:
                A = np.tile(A, (len(V), 1))
            bk["A"].append(A)
        if uv is not None:
            bk["UV"].append(np.asarray(uv, float).reshape(-1, 2))
        bk["n"] += len(V)

    def add_indexed(self, mat, V, N, faces, **kw):
        faces = np.asarray(faces)
        used = np.unique(faces)
        remap = -np.ones(len(V), int)
        remap[used] = np.arange(len(used))
        extra = {}
        if kw.get("axle") is not None and np.asarray(kw["axle"]).ndim == 2:
            extra["axle"] = np.asarray(kw["axle"])[used]
        elif kw.get("axle") is not None:
            extra["axle"] = kw["axle"]
        if kw.get("uv") is not None:
            extra["uv"] = np.asarray(kw["uv"])[used]
        self.add(mat, V[used], N[used], remap[faces], **extra)

    def grid(self, P, mat, close_u=False, close_v=False, ref=None, N=None, facemat=None,
             axle=None, uv=None):
        """Quad grid. facemat: array (fu, fv) of material names per quad (overrides mat).

        N given  -> taken as the final outward vertex normals; winding is made to agree.
        N absent -> normals from the grid; flipped (with the winding) to agree with `ref`."""
        P = np.asarray(P, float)
        nu, nv = P.shape[:2]
        fu = nu if close_u else nu - 1
        fv = nv if close_v else nv - 1
        if fu <= 0 or fv <= 0:
            return
        Nw = grid_normals(P, close_u, close_v)
        I, J = np.meshgrid(np.arange(fu), np.arange(fv), indexing="ij")
        a = I * nv + J
        b_ = ((I + 1) % nu) * nv + J
        c = ((I + 1) % nu) * nv + (J + 1) % nv
        d = I * nv + (J + 1) % nv
        quads = np.stack([a, b_, c, d], -1).reshape(-1, 4)
        Vf = P.reshape(-1, 3)
        if N is not None:
            Nf = normalize(np.asarray(N, float).reshape(-1, 3))
            if needs_flip(Vf, Nw.reshape(-1, 3), ("vec", Nf)):
                quads = quads[:, ::-1]
        else:
            Nf = Nw.reshape(-1, 3)
            if ref is not None and needs_flip(Vf, Nf, ref):
                quads = quads[:, ::-1]
                Nf = -Nf
        kw = {}
        if axle is not None:
            kw["axle"] = np.asarray(axle, float).reshape(-1, 3) if np.asarray(axle).ndim > 1 else axle
        if uv is not None:
            kw["uv"] = np.asarray(uv, float).reshape(-1, 2)
        if facemat is None:
            self.add_indexed(mat, Vf, Nf, quads, **kw)
        else:
            fm = np.asarray(facemat).reshape(-1)
            for m in np.unique(fm):
                self.add_indexed(str(m), Vf, Nf, quads[fm == m], **kw)

    def fan(self, center, ring, mat, n_center, ring_normals=None, closed=True, ref=None, axle=None):
        ring = np.asarray(ring, float)
        k = len(ring)
        if ring_normals is None:
            ring_normals = np.tile(n_center, (k, 1))
        V = np.vstack([np.asarray(center, float)[None], ring])
        N = np.vstack([np.asarray(n_center, float)[None], ring_normals])
        last = k if closed else k - 1
        F = [(0, 1 + i, 1 + (i + 1) % k) for i in range(last)]
        F = np.array(F)
        if ref is not None and needs_flip(V, N, ref, faces=F):
            F = F[:, ::-1]
        # check winding agrees with supplied normal
        tri = V[F[0]]
        fn = np.cross(tri[1] - tri[0], tri[2] - tri[0])
        if np.dot(fn, n_center) < 0:
            F = F[:, ::-1]
        self.add(mat, V, N, F, axle=axle)

    def poly(self, P, mat, normal=None):
        """Convex planar-ish polygon as a triangle fan with a flat normal."""
        P = np.asarray(P, float)
        if normal is None:
            normal = normalize(np.cross(P[1] - P[0], P[2] - P[0]))
        F = [(0, i, i + 1) for i in range(1, len(P) - 1)]
        fn = np.cross(P[1] - P[0], P[2] - P[0])
        if np.dot(fn, normal) < 0:
            F = [f[::-1] for f in F]
        self.add(mat, P, np.tile(normal, (len(P), 1)), F)

    def merge(self, other):
        for mat, bk in other.b.items():
            if not bk["V"]:
                continue
            V = np.concatenate(bk["V"])
            N = np.concatenate(bk["N"])
            A = np.concatenate(bk["A"]) if bk["A"] else None
            UV = np.concatenate(bk["UV"]) if bk["UV"] else None
            self.add(mat, V, N, bk["F"], axle=A, uv=UV)

    def tri_count(self):
        t = 0
        for bk in self.b.values():
            for f in bk["F"]:
                t += len(f) - 2
        return t

    def arrays(self, mat):
        bk = self.b[mat]
        V = np.concatenate(bk["V"])
        N = np.concatenate(bk["N"])
        A = np.concatenate(bk["A"]) if bk["A"] else None
        UV = np.concatenate(bk["UV"]) if bk["UV"] else None
        return V, N, bk["F"], A, UV


def needs_flip(V, N, ref, faces=None):
    """Decide whether normals N point against the reference 'outward' direction."""
    V = np.asarray(V, float)
    N = np.asarray(N, float)
    kind = ref[0]
    if kind == "point":
        out = V - np.asarray(ref[1], float)
    elif kind == "axis":
        p0 = np.asarray(ref[1], float)
        d = normalize(np.asarray(ref[2], float))
        r = V - p0
        out = r - np.outer(r @ d, d)
    elif kind == "dir":
        out = np.tile(np.asarray(ref[1], float), (len(V), 1))
    elif kind == "vec":
        out = np.asarray(ref[1], float).reshape(-1, 3)
    else:
        raise ValueError(kind)
    s = np.einsum("ij,ij->i", N, out)
    return np.sum(np.sign(s)) < 0


# ----------------------------------------------------------------------------- primitives

def revolve(profile, center, axis, seg, ref_up=(0, 0, 1), phase=0.0, axial_offsets=None):
    """Revolve a profile [(a, r), ...] (a along axis, r radius) around axis.
    Returns grid (n_profile, seg, 3) closed in the second direction.
    axial_offsets: optional callable(j_profile, theta_array) -> extra axial shift."""
    prof = np.asarray(profile, float)
    d, e1, e2 = frame_from(axis, ref_up)
    th = phase + np.arange(seg) * 2 * math.pi / seg
    c, s = np.cos(th), np.sin(th)
    P = np.zeros((len(prof), seg, 3))
    for j, (a, r) in enumerate(prof):
        aa = a
        if axial_offsets is not None:
            aa = a + axial_offsets(j, th)
        P[j] = (np.asarray(center, float)[None] + np.outer(np.atleast_1d(aa) * np.ones(seg), d)
                + np.outer(r * c, e2) + np.outer(r * s, e1))
    return P


def cylinder(mb, p0, p1, r, seg, mat, caps=True, r1=None, axle=None):
    p0 = np.asarray(p0, float)
    p1 = np.asarray(p1, float)
    r1 = r if r1 is None else r1
    d = p1 - p0
    L = np.linalg.norm(d)
    if L < 1e-6:
        return
    P = revolve([(0.0, r), (L, r1)], p0, d, seg)
    mb.grid(P, mat, close_v=True, ref=("axis", p0, d), axle=axle)
    if caps:
        dn = normalize(d)
        for pc, rad, sgn in ((p0, r, -1), (p1, r1, 1)):
            ring = P[0] if sgn < 0 else P[1]
            mb.fan(pc, ring, mat, dn * sgn, axle=axle)


def box(mb, center, size, mat, axes=None, axle=None):
    """Oriented box. axes: 3x3 rows = local x,y,z unit vectors."""
    c = np.asarray(center, float)
    hx, hy, hz = np.asarray(size, float) / 2
    A = np.eye(3) if axes is None else np.asarray(axes, float)
    faces = [((1, 0, 0), (0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
             ((0, 1, 0), (0, 0, 1), (1, 0, 0)), ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
             ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (0, 1, 0), (1, 0, 0))]
    h = np.array([hx, hy, hz])
    for n, u, v in faces:
        n, u, v = np.array(n, float), np.array(u, float), np.array(v, float)
        pts = []
        for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            loc = n * h + su * u * h + sv * v * h
            pts.append(c + A.T @ loc)
        mb.poly(np.array(pts), mat, normal=A.T @ n)


def dome(mb, center, normal, radius, height, seg, mat, rings=3, stretch_dir=None, stretch=1.0):
    """Half-ellipsoid lens sitting on a surface."""
    d, e1, e2 = frame_from(normal)
    if stretch_dir is not None:
        e1 = normalize(np.asarray(stretch_dir, float) - np.dot(stretch_dir, d) * d)
        e2 = np.cross(d, e1)
    pts = []
    nrm = []
    for i in range(rings + 1):
        phi = (math.pi / 2) * i / rings  # 0 = rim, pi/2 = apex
        row = []
        nrow = []
        for k in range(seg):
            t = 2 * math.pi * k / seg
            rr = radius * math.cos(phi)
            p = (np.asarray(center, float) + d * height * math.sin(phi) + e1 * rr * math.cos(t) * stretch
                 + e2 * rr * math.sin(t))
            n = (d * math.sin(phi) / max(height, 1e-6) + (e1 * math.cos(t) / stretch + e2 * math.sin(t))
                 * math.cos(phi) / radius)
            row.append(p)
            nrow.append(n)
        pts.append(row)
        nrm.append(nrow)
    P = np.array(pts[:-1])
    N = normalize(np.array(nrm[:-1]))
    mb.grid(P, mat, close_v=True, N=N, ref=("vec", N.reshape(-1, 3)))
    apex = np.asarray(center, float) + d * height
    mb.fan(apex, P[-1], mat, d, ring_normals=N[-1])


def superellipse_ring(k, n, phase=0.0):
    """k points (u,v) in [-1,1]^2 on |u|^n + |v|^n = 1."""
    t = phase + np.arange(k) * 2 * math.pi / k
    c, s = np.cos(t), np.sin(t)
    u = np.sign(c) * np.abs(c) ** (2.0 / n)
    v = np.sign(s) * np.abs(s) ** (2.0 / n)
    return np.stack([u, v], 1)


def superellipse_ring_arclen(k, n, dense=1440):
    """k points on |u|^n + |v|^n = 1, evenly spaced by arc length (no corner bunching)."""
    D = superellipse_ring(dense, n, phase=math.pi / dense)
    C = np.vstack([D, D[:1]])
    seg = np.linalg.norm(np.diff(C, axis=0), axis=1)
    S = np.concatenate([[0.0], np.cumsum(seg)])
    q = (np.arange(k) + 0.5) * S[-1] / k
    return np.stack([np.interp(q, S, C[:, 0]), np.interp(q, S, C[:, 1])], 1)


def ribbon(mb, pts, nrms, width, offset, mat, closed=True):
    """Thin strip following a 3D polyline lying on a surface (panel lines)."""
    P = np.asarray(pts, float)
    Nn = normalize(np.asarray(nrms, float))
    if closed:
        T = np.roll(P, -1, 0) - np.roll(P, 1, 0)
    else:
        T = np.empty_like(P)
        T[1:-1] = P[2:] - P[:-2]
        T[0] = P[1] - P[0]
        T[-1] = P[-1] - P[-2]
    B = normalize(np.cross(T, Nn))
    base = P + Nn * offset
    G = np.stack([base - B * width / 2, base + B * width / 2], 1)  # (n, 2, 3)
    N = np.stack([Nn, Nn], 1)
    mb.grid(G, mat, close_u=closed, N=N, ref=("vec", N.reshape(-1, 3)))


# ----------------------------------------------------------------------------- Blender objects

def make_object(name, V, N, F, mats, parent, collection, face_mat=None, uv=None, attrs=None):
    """Create a mesh object with custom normals. mats: list of bpy materials."""
    import bpy
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(V, float).tolist(), [], [list(f) for f in F])
    for m in mats:
        me.materials.append(m)
    if face_mat is not None:
        me.polygons.foreach_set("material_index", np.asarray(face_mat, np.int32))
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), bool))
    if uv is not None:
        uvl = me.uv_layers.new(name="UVMap")
        lv = np.zeros(len(me.loops), np.int32)
        me.loops.foreach_get("vertex_index", lv)
        uvl.data.foreach_set("uv", np.asarray(uv, np.float32)[lv].reshape(-1))
    if attrs:
        for key, arr in attrs.items():
            a = me.attributes.new(name=key, type="FLOAT_VECTOR", domain="POINT")
            a.data.foreach_set("vector", np.asarray(arr, np.float32).reshape(-1))
    me.validate(clean_customdata=False)
    me.update()
    me.normals_split_custom_set_from_vertices(normalize(np.asarray(N, float)).tolist())
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    ob.parent = parent
    return ob


def make_empty(name, loc, parent, collection, size=0.3):
    import bpy
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = size
    ob.empty_display_type = "PLAIN_AXES"
    ob.location = tuple(float(v) for v in loc)
    collection.objects.link(ob)
    ob.parent = parent
    return ob


def blender_to_gltf(v):
    """Blender (x, y, z) -> glTF (x, z, -y). Used for raw custom attributes, which the
    glTF exporter writes without axis conversion."""
    v = np.asarray(v, float)
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)
