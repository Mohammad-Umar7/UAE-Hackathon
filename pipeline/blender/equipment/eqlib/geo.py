"""Procedural mesh construction helpers.

`Geo` is a light polygon soup (vertices, faces, per-face material name and UV spec)
that primitives return and that is merged/transformed freely before being turned into
a single Blender mesh per node (see scene.py).  Only bmesh/mathutils are used here, no
operators, so everything is deterministic and fast in background mode.

UV specs (per face):
    None            -> box projection, 1 UV unit per metre (computed from final positions)
    ('box', s)      -> box projection, s UV units per metre
    ('pt', u, v)    -> every corner at (u, v)  (palette textures)
    ('uv', [...])   -> explicit per-corner list
Winding: faces are counter-clockwise seen from outside (right-hand rule normal).
"""
import math

import bmesh
from mathutils import Matrix, Vector

TAU = math.tau


def V(*a):
    if len(a) == 1:
        return Vector(a[0])
    return Vector(a)


def quad_uv(u0, v0, u1, v1):
    return ('uv', [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


class Geo:
    __slots__ = ("v", "f", "fm", "fuv", "ax")

    def __init__(self):
        self.v = []
        self.f = []
        self.fm = []
        self.fuv = []
        self.ax = None  # optional per-vertex Vector (wheel axle centres)

    # ------------------------------------------------------------------ build
    def add(self, verts, faces, mat, uv=None):
        base = len(self.v)
        self.v.extend(Vector(p) for p in verts)
        for i, face in enumerate(faces):
            self.f.append(tuple(base + k for k in face))
            self.fm.append(mat if isinstance(mat, str) else mat[i])
            self.fuv.append(uv[i] if isinstance(uv, list) else uv)
        if self.ax is not None:
            self.ax.extend([None] * len(verts))
        return self

    def merge(self, other, M=None):
        if other is None:
            return self
        base = len(self.v)
        if M is None:
            self.v.extend(v.copy() for v in other.v)
        else:
            self.v.extend(M @ v for v in other.v)
        self.f.extend(tuple(base + i for i in f) for f in other.f)
        self.fm.extend(other.fm)
        self.fuv.extend(other.fuv)
        if other.ax is not None or self.ax is not None:
            if self.ax is None:
                self.ax = [None] * base
            if other.ax is None:
                self.ax.extend([None] * len(other.v))
            else:
                for a in other.ax:
                    self.ax.append(None if a is None else (a.copy() if M is None else M @ a))
        return self

    def __iadd__(self, other):
        return self.merge(other)

    def __add__(self, other):
        g = Geo()
        g.merge(self)
        g.merge(other)
        return g

    def copy(self):
        g = Geo()
        return g.merge(self)

    # -------------------------------------------------------------- transform
    def transform(self, M):
        self.v = [M @ v for v in self.v]
        if self.ax is not None:
            self.ax = [None if a is None else M @ a for a in self.ax]
        # a mirroring matrix flips winding
        if M.to_3x3().determinant() < 0:
            self.flip()
        return self

    def move(self, x=0.0, y=0.0, z=0.0):
        d = Vector((x, y, z))
        self.v = [v + d for v in self.v]
        if self.ax is not None:
            self.ax = [None if a is None else a + d for a in self.ax]
        return self

    def rot(self, axis, ang, about=(0, 0, 0)):
        c = Vector(about)
        M = Matrix.Translation(c) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-c)
        return self.transform(M)

    def scale(self, sx, sy=None, sz=None, about=(0, 0, 0)):
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        c = Vector(about)
        M = Matrix.Translation(c) @ Matrix.Diagonal((sx, sy, sz, 1.0)) @ Matrix.Translation(-c)
        return self.transform(M)

    def flip(self):
        self.f = [tuple(reversed(f)) for f in self.f]
        out = []
        for s in self.fuv:
            if s is not None and s[0] == 'uv':
                out.append(('uv', list(reversed(s[1]))))
            else:
                out.append(s)
        self.fuv = out
        return self

    def mirrored_x(self):
        """Return a copy mirrored across the YZ plane (x -> -x)."""
        g = self.copy()
        g.transform(Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0)))
        return g

    def mirrored_y(self):
        g = self.copy()
        g.transform(Matrix.Diagonal((1.0, -1.0, 1.0, 1.0)))
        return g

    def deform(self, fn):
        """Apply fn(Vector)->Vector to every vertex."""
        self.v = [fn(v.copy()) for v in self.v]
        return self

    def set_mat(self, mat):
        self.fm = [mat] * len(self.f)
        return self

    def set_uv(self, spec):
        self.fuv = [spec] * len(self.f)
        return self

    def set_axle(self, centre):
        self.ax = [Vector(centre)] * len(self.v)
        return self

    # ------------------------------------------------------------------ query
    def ntris(self):
        return sum(len(f) - 2 for f in self.f)

    def bbox(self):
        if not self.v:
            return Vector((0, 0, 0)), Vector((0, 0, 0))
        xs = [v.x for v in self.v]
        ys = [v.y for v in self.v]
        zs = [v.z for v in self.v]
        return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


# ======================================================================= bmesh
def geo_from_bm(bm, mat, uv=None):
    g = Geo()
    bm.verts.index_update()
    g.v = [v.co.copy() for v in bm.verts]
    for f in bm.faces:
        g.f.append(tuple(v.index for v in f.verts))
        g.fm.append(mat)
        g.fuv.append(uv)
    return g


def bm_from_geo(g):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in g.v]
    for f in g.f:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    return bm


def _edge_filter(name):
    if name is None or name == 'all':
        return lambda a, b, bb: True
    if callable(name):
        return name
    if name in ('x', 'y', 'z'):
        k = 'xyz'.index(name)

        def f(a, b, bb):
            d = b - a
            return abs(d[k]) > 0.9 * d.length
        return f
    if name == 'notz':
        return lambda a, b, bb: abs((b - a).z) < 0.9 * (b - a).length
    if name == 'top':
        return lambda a, b, bb: min(a.z, b.z) > bb[1].z - 1e-4
    if name == 'nobottom':
        return lambda a, b, bb: max(a.z, b.z) > bb[0].z + 1e-4
    if name == 'vertical':
        return lambda a, b, bb: abs((b - a).z) > 0.9 * (b - a).length
    raise ValueError(name)


def bevel_bm(bm, offset, seg, edges='all', min_angle=0.5, convex_only=True):
    if offset <= 0 or seg <= 0:
        return
    bm.normal_update()
    xs = [v.co for v in bm.verts]
    bb = (Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs))),
          Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs))))
    flt = _edge_filter(edges)
    sel = []
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        try:
            ang = e.calc_face_angle()
        except ValueError:
            continue
        if ang < min_angle:
            continue
        if convex_only and not e.is_convex:
            continue
        if flt(e.verts[0].co, e.verts[1].co, bb):
            sel.append(e)
    if not sel:
        return
    vs = list({v for e in sel for v in e.verts})
    bmesh.ops.bevel(bm, geom=sel + vs, offset=offset, offset_type='OFFSET', segments=seg,
                    profile=0.5, affect='EDGES', clamp_overlap=True)


# ================================================================= primitives
def box(sx, sy, sz, c=(0, 0, 0), mat='M_Body', bevel=0.0, seg=1, uv=None, edges='all'):
    """Axis aligned box centred at c."""
    cx, cy, cz = c
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    if bevel > 0 and seg > 0:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((sx, sy, sz, 1.0)))
        bevel_bm(bm, min(bevel, 0.49 * min(sx, sy, sz)), seg, edges)
        bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
        g = geo_from_bm(bm, mat, uv)
        bm.free()
        return g
    p = [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz), (cx + hx, cy + hy, cz - hz),
         (cx - hx, cy + hy, cz - hz), (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
         (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return Geo().add(p, faces, mat, uv)


def box_minmax(x0, y0, z0, x1, y1, z1, mat='M_Body', bevel=0.0, seg=1, uv=None, edges='all'):
    return box(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0),
               ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), mat, bevel, seg, uv, edges)


def _poly_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def _axis_pt(axis, p, q, a):
    if axis == 'x':
        return Vector((a, p, q))
    if axis == 'y':
        return Vector((p, a, q))
    return Vector((p, q, a))


def prism(poly, axis, a0, a1, mat='M_Body', bevel=0.0, seg=1, uv=None, edges='all',
          min_angle=0.5):
    """Extrude 2D polygon along an axis.
    axis 'x': poly points are (y, z); 'y': (x, z); 'z': (x, y)."""
    pts = list(poly)
    # orientation: make cap at a1 face +axis
    area = _poly_area(pts)
    # for axis y, (x,z) CCW gives -y normal -> reverse logic
    want_ccw = axis in ('x', 'z')
    if (area > 0) != want_ccw:
        pts = pts[::-1]
    n = len(pts)
    lo = [_axis_pt(axis, p, q, min(a0, a1)) for p, q in pts]
    hi = [_axis_pt(axis, p, q, max(a0, a1)) for p, q in pts]
    verts = lo + hi
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    g = Geo().add(verts, faces, mat, uv)
    if bevel > 0 and seg > 0:
        bm = bm_from_geo(g)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bevel_bm(bm, bevel, seg, edges, min_angle)
        g = geo_from_bm(bm, mat, uv)
        bm.free()
    return g


def lathe(profile, seg, mat='M_Body', axis='z', c=(0, 0, 0), uv=None, cap0=False, cap1=False,
          a0=0.0, a1=TAU, uv_u=1.0, uv_v=1.0, phase=0.0):
    """Revolve a (r, h) profile around `axis` through c.
    Profile is ordered so that the outside lies on the right of the direction of travel
    in the (r right, h up) half plane (i.e. bottom -> top for an outward facing wall).
    r == 0 points become poles.  cap0/cap1 close the first/last ring with an n-gon
    (cap0 faces -axis, cap1 faces +axis).
    uv='cyl' gives cylindrical UVs (u = around * uv_u, v = h * uv_v)."""
    full = abs((a1 - a0) - TAU) < 1e-6
    ncol = seg if full else seg + 1
    verts = []
    rings = []
    for (r, h) in profile:
        if r < 1e-7:
            rings.append([len(verts)])
            verts.append(Vector((0.0, 0.0, h)))
        else:
            ring = []
            for j in range(ncol):
                t = a0 + phase + (a1 - a0) * j / seg
                ring.append(len(verts))
                verts.append(Vector((r * math.cos(t), r * math.sin(t), h)))
            rings.append(ring)
    faces = []
    fuv = []
    cyl = (uv == 'cyl')

    def U(j):
        return uv_u * j / seg

    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        vA, vB = uv_v * profile[i][1], uv_v * profile[i + 1][1]
        if len(A) == 1 and len(B) == 1:
            continue
        for j in range(seg):
            jn = (j + 1) % ncol if full else j + 1
            if len(A) == 1:
                faces.append((A[0], B[jn], B[j]))
                fuv.append(('uv', [(U(j + 0.5), vA), (U(j + 1), vB), (U(j), vB)]))
            elif len(B) == 1:
                faces.append((A[j], A[jn], B[0]))
                fuv.append(('uv', [(U(j), vA), (U(j + 1), vA), (U(j + 0.5), vB)]))
            else:
                faces.append((A[j], A[jn], B[jn], B[j]))
                fuv.append(('uv', [(U(j), vA), (U(j + 1), vA), (U(j + 1), vB), (U(j), vB)]))
    if full:
        if cap0 and len(rings[0]) > 1:
            faces.append(tuple(reversed(rings[0])))
            fuv.append(None)
        if cap1 and len(rings[-1]) > 1:
            faces.append(tuple(rings[-1]))
            fuv.append(None)
    g = Geo().add(verts, faces, mat, fuv if cyl else uv)
    if axis == 'x':
        g.transform(Matrix.Rotation(math.pi / 2, 4, 'Y'))
    elif axis == 'y':
        g.transform(Matrix.Rotation(-math.pi / 2, 4, 'X'))
    elif axis == '-x':
        g.transform(Matrix.Rotation(-math.pi / 2, 4, 'Y'))
    elif axis == '-y':
        g.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    elif axis == '-z':
        g.transform(Matrix.Rotation(math.pi, 4, 'X'))
    g.move(*c)
    return g


def cylinder(r, h, seg=16, c=(0, 0, 0), axis='z', mat='M_Metal', cap0=True, cap1=True, uv=None,
             bevel=0.0, r1=None):
    """Cylinder (or frustum when r1 given) from h=0..h along axis, base centred at c."""
    r1 = r if r1 is None else r1
    if bevel > 0:
        b = min(bevel, 0.45 * min(r, r1), 0.45 * h)
        prof = [(r - b, 0.0), (r - b * 0.29, b * 0.29), (r, b), (r1, h - b),
                (r1 - b * 0.29, h - b * 0.29), (r1 - b, h)]
    else:
        prof = [(r, 0.0), (r1, h)]
    return lathe(prof, seg, mat, axis, c, uv, cap0=cap0, cap1=cap1)


def sphere(r, seg=12, rings=6, c=(0, 0, 0), mat='M_Metal', z0=-1.0, z1=1.0, uv=None, sz=1.0):
    """UV sphere (optionally truncated: z0/z1 in -1..1 of the polar range)."""
    prof = []
    for i in range(rings + 1):
        t = -math.pi / 2 + math.pi * i / rings
        s = math.sin(t)
        if s < z0 - 1e-6 or s > z1 + 1e-6:
            continue
        prof.append((r * math.cos(t), r * sz * s))
    cap0 = prof[0][0] > 1e-6
    cap1 = prof[-1][0] > 1e-6
    return lathe(prof, seg, mat, 'z', c, uv, cap0=cap0, cap1=cap1)


def quad(p0, p1, p2, p3, mat='M_Body', uv=None):
    return Geo().add([p0, p1, p2, p3], [(0, 1, 2, 3)], mat, uv)


def poly(points, mat='M_Body', uv=None):
    return Geo().add(points, [tuple(range(len(points)))], mat, uv)


def face_normal(pts):
    n = Vector((0, 0, 0))
    for i in range(len(pts)):
        a = Vector(pts[i])
        b = Vector(pts[(i + 1) % len(pts)])
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))


def panel(corners, mat='M_Glass', offset=0.006, frame=0.0, frame_mat='M_Rubber', frame_offset=None,
          uv=None, double=False):
    """Flat quad on a surface, corners CCW seen from the front, pushed `offset` along its
    normal.  Optional border ring of width `frame` (slightly prouder)."""
    P = [Vector(p) for p in corners]
    n = face_normal(P)
    g = Geo()
    if frame > 0:
        fo = offset + 0.004 if frame_offset is None else frame_offset
        cen = sum(P, Vector()) / len(P)
        inner = []
        for i in range(4):
            a = P[i]
            b = P[(i + 1) % 4]
            d = P[(i - 1) % 4]
            u = (b - a).normalized()
            w = (d - a).normalized()
            inner.append(a + u * frame + w * frame)
        outer = [p + n * fo for p in P]
        inn = [p + n * fo for p in inner]
        for i in range(4):
            j = (i + 1) % 4
            g.add([outer[i], outer[j], inn[j], inn[i]], [(0, 1, 2, 3)], frame_mat)
        glass = [p + n * offset for p in inner]
    else:
        glass = [p + n * offset for p in P]
    g.add(glass, [(0, 1, 2, 3)], mat, uv)
    if double:
        g.add(glass[::-1], [(0, 1, 2, 3)], mat, uv)
    return g


def disc(c, normal, r, seg=12, mat='M_Lights', uv=None, offset=0.0):
    n = Vector(normal).normalized()
    t = n.orthogonal().normalized()
    b = n.cross(t)
    C = Vector(c) + n * offset
    pts = [C + (t * math.cos(TAU * i / seg) + b * math.sin(TAU * i / seg)) * r for i in range(seg)]
    return Geo().add(pts, [tuple(range(seg))], mat, uv)


# ============================================================= paths & tubes
def round_path(points, radius, steps=3):
    pts = [Vector(p) for p in points]
    if len(pts) < 3 or radius <= 0 or steps <= 0:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        A, P, B = pts[i - 1], pts[i], pts[i + 1]
        u = A - P
        w = B - P
        lu, lw = u.length, w.length
        if lu < 1e-9 or lw < 1e-9:
            continue
        u /= lu
        w /= lw
        cosang = max(-1.0, min(1.0, u.dot(w)))
        theta = math.acos(cosang)
        if theta > math.pi - 1e-3:
            out.append(P)
            continue
        d = radius / math.tan(theta / 2)
        d = min(d, 0.45 * lu, 0.45 * lw)
        S = P + u * d
        E = P + w * d
        for k in range(steps + 1):
            t = k / steps
            q = (1 - t) ** 2 * S + 2 * (1 - t) * t * P + t * t * E
            out.append(q)
    out.append(pts[-1])
    return out


def sag_path(p0, p1, sag, n=8):
    p0, p1 = Vector(p0), Vector(p1)
    out = []
    for i in range(n + 1):
        t = i / n
        p = p0.lerp(p1, t)
        p.z -= sag * 4 * t * (1 - t)
        out.append(p)
    return out


def bezier_path(p0, c0, c1, p1, n=10):
    p0, c0, c1, p1 = map(Vector, (p0, c0, c1, p1))
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        out.append(mt ** 3 * p0 + 3 * mt * mt * t * c0 + 3 * mt * t * t * c1 + t ** 3 * p1)
    return out


def tube(path, radius, seg=6, mat='M_Metal', cap=True, uv=None, radii=None, closed=False):
    """Sweep a circle along a polyline with parallel-transport frames."""
    P = [Vector(p) for p in path]
    n = len(P)
    if n < 2:
        return Geo()
    T = []
    for i in range(n):
        if closed:
            d = (P[(i + 1) % n] - P[i - 1])
        elif i == 0:
            d = P[1] - P[0]
        elif i == n - 1:
            d = P[-1] - P[-2]
        else:
            d = (P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
        T.append(d.normalized() if d.length > 1e-9 else Vector((0, 0, 1)))
    N0 = T[0].orthogonal().normalized()
    # prefer an "up"-ish start normal for nicer seams
    up = Vector((0, 0, 1))
    if abs(T[0].dot(up)) < 0.95:
        N0 = (up - T[0] * T[0].dot(up)).normalized()
    Ns = [N0]
    for i in range(1, n):
        Np = Ns[-1]
        t0, t1 = T[i - 1], T[i]
        ax = t0.cross(t1)
        if ax.length > 1e-9:
            ang = math.acos(max(-1.0, min(1.0, t0.dot(t1))))
            Np = Matrix.Rotation(ang, 3, ax.normalized()) @ Np
        Np = (Np - t1 * t1.dot(Np)).normalized()
        Ns.append(Np)
    verts = []
    for i in range(n):
        r = radius if radii is None else radii[i]
        N = Ns[i]
        B = T[i].cross(N)
        for k in range(seg):
            phi = TAU * k / seg
            off = (N * math.cos(phi) + B * math.sin(phi)) * r
            verts.append(P[i] + off)
    faces = []
    rng = n if closed else n - 1
    for i in range(rng):
        i2 = (i + 1) % n
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append((i * seg + k, i * seg + k2, i2 * seg + k2, i2 * seg + k))
    if cap and not closed:
        faces.append(tuple(range(seg - 1, -1, -1)))
        faces.append(tuple((n - 1) * seg + k for k in range(seg)))
    return Geo().add(verts, faces, mat, uv)


def strip(path, width, up=(0, 0, 1), mat='M_Body', uv=None, twist=None):
    """Flat ribbon along a path (single sided, normal ~ `up`)."""
    P = [Vector(p) for p in path]
    U = Vector(up)
    verts = []
    n = len(P)
    for i in range(n):
        d = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized()
        s = d.cross(U).normalized()
        w = width[i] if isinstance(width, (list, tuple)) else width
        verts.append(P[i] - s * w / 2)
        verts.append(P[i] + s * w / 2)
    faces = []
    for i in range(n - 1):
        faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    g = Geo().add(verts, faces, mat, uv)
    return g


# ============================================================ compound bits
def rail(points, r=0.022, seg=6, mat='M_Metal', corner=0.08, steps=2, cap=True):
    """Handrail tube along points with rounded corners."""
    return tube(round_path(points, corner, steps), r, seg, mat, cap=cap)


def posts_and_rail(p_start, p_end, height, n_posts, r=0.021, seg=6, mat='M_Metal', mid=True,
                   post_r=None):
    """Guard rail between two floor points: posts + top rail (+ mid rail)."""
    g = Geo()
    a, b = Vector(p_start), Vector(p_end)
    post_r = r if post_r is None else post_r
    for i in range(n_posts):
        t = i / max(1, n_posts - 1)
        p = a.lerp(b, t)
        g += tube([p, p + Vector((0, 0, height))], post_r, seg, mat)
    g += tube([a + Vector((0, 0, height)), b + Vector((0, 0, height))], r, seg, mat)
    if mid:
        g += tube([a + Vector((0, 0, height * 0.5)), b + Vector((0, 0, height * 0.5))], r * 0.8, seg, mat)
    return g
