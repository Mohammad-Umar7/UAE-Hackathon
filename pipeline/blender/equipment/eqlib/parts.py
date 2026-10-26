"""Reusable parts for GSE vehicles, jet bridges and furniture.

Every part takes a `q` (Q) quality object derived from the LOD so detail, bevels and
tessellation scale down consistently: LOD0 full, LOD1 ~30 %, LOD2 silhouette.
"""
import math

from mathutils import Matrix, Vector

from .geo import (TAU, Geo, V, box, box_minmax, cylinder, face_normal, lathe, panel, poly,
                  prism, quad, quad_uv, round_path, tube)
from .textures import DECAL, light_uv


class Q:
    def __init__(self, lod):
        self.lod = lod
        self.l0 = lod == 0
        self.l1 = lod == 1
        self.l2 = lod == 2

    def bev(self, r, r1=None):
        """Bevel radius per LOD: LOD1 keeps (reduced) bevels only on large shells."""
        if self.lod == 0:
            return r
        if self.lod == 1:
            if r1 is not None:
                return r1
            return r * 0.6 if r >= 0.045 else 0.0
        return 0.0

    def seg(self, s0=2, s1=1):
        return (s0, s1, 0)[self.lod]

    def n(self, n0, n1=None, n2=None, lo=6):
        if self.lod == 0:
            return n0
        if self.lod == 1:
            return n1 if n1 is not None else max(lo, n0 // 2)
        return n2 if n2 is not None else max(lo, n0 // 4)


# ---------------------------------------------------------------- face rects
def rect(face, c, w, h):
    """4 corners CCW seen from outside for a rectangle centred at c on an axis face."""
    cx, cy, cz = c
    a, b = w / 2, h / 2
    if face == '+y':
        return [V(cx + a, cy, cz - b), V(cx - a, cy, cz - b), V(cx - a, cy, cz + b), V(cx + a, cy, cz + b)]
    if face == '-y':
        return [V(cx - a, cy, cz - b), V(cx + a, cy, cz - b), V(cx + a, cy, cz + b), V(cx - a, cy, cz + b)]
    if face == '+x':
        return [V(cx, cy - a, cz - b), V(cx, cy + a, cz - b), V(cx, cy + a, cz + b), V(cx, cy - a, cz + b)]
    if face == '-x':
        return [V(cx, cy + a, cz - b), V(cx, cy - a, cz - b), V(cx, cy - a, cz + b), V(cx, cy + a, cz + b)]
    if face == '+z':
        return [V(cx - a, cy - b, cz), V(cx + a, cy - b, cz), V(cx + a, cy + b, cz), V(cx - a, cy + b, cz)]
    if face == '-z':
        return [V(cx - a, cy + b, cz), V(cx + a, cy + b, cz), V(cx + a, cy - b, cz), V(cx - a, cy - b, cz)]
    raise ValueError(face)


def lens(corners, color='warm', offset=0.004):
    u, v = light_uv(color)
    return panel(corners, 'M_Lights', offset=offset, uv=('pt', u, v))


def lamp(face, c, w, h, q, color='warm', depth=0.06, housing='M_Trim', bevel=0.012):
    """Rectangular lamp: housing box behind the face plane + lens on `face`."""
    g = Geo()
    n = {'+y': V(0, 1, 0), '-y': V(0, -1, 0), '+x': V(1, 0, 0), '-x': V(-1, 0, 0),
         '+z': V(0, 0, 1), '-z': V(0, 0, -1)}[face]
    C = V(c)
    if housing and not q.l2:
        size = [w + 0.03, w + 0.03, h + 0.03]
        if face in ('+y', '-y'):
            size = [w + 0.03, depth, h + 0.03]
        elif face in ('+x', '-x'):
            size = [depth, w + 0.03, h + 0.03]
        else:
            size = [w + 0.03, h + 0.03, depth]
        g += box(*size, c=tuple(C - n * depth / 2), mat=housing, bevel=q.bev(bevel), seg=q.seg(1, 1))
    g += lens(rect(face, tuple(C), w, h), color, offset=0.003)
    return g


def round_lamp(c, normal, r, q, color='warm', depth=0.05, housing='M_Trim'):
    g = Geo()
    n = V(normal).normalized()
    seg = q.n(14, 8, 6)
    C = V(c)
    if housing and not q.l2:
        cyl = cylinder(r * 1.18, depth, seg, (0, 0, 0), 'z', housing, cap0=False)
        M = n.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        cyl.transform(M)
        cyl.move(*(C - n * depth))
        g += cyl
    t = n.orthogonal().normalized()
    b = n.cross(t)
    pts = [C + n * 0.003 + (t * math.cos(TAU * i / seg) + b * math.sin(TAU * i / seg)) * r for i in range(seg)]
    u, v = light_uv(color)
    g.add(pts, [tuple(range(seg))], 'M_Lights', ('pt', u, v))
    return g


def decal(face, c, w, h, key, offset=0.004):
    u0, v0, u1, v1 = DECAL[key]
    return panel(rect(face, c, w, h), 'M_Decal', offset=offset, uv=quad_uv(u0, v0, u1, v1))


def decal_region(corners, key, offset=0.004, sub=None):
    u0, v0, u1, v1 = DECAL[key]
    if sub is not None:
        a, b, c2, d = sub
        u0, u1 = u0 + (u1 - u0) * a, u0 + (u1 - u0) * c2
        v0, v1 = v0 + (v1 - v0) * b, v0 + (v1 - v0) * d
    return panel(corners, 'M_Decal', offset=offset, uv=quad_uv(u0, v0, u1, v1))


def hazard_box(x0, y0, z0, x1, y1, z1, q, bevel=0.0):
    return box_minmax(x0, y0, z0, x1, y1, z1, 'M_Hazard', bevel=q.bev(bevel), seg=q.seg(1, 1),
                      uv=('box', 1.25))


def hazard_panel(corners, offset=0.003):
    return panel(corners, 'M_Hazard', offset=offset, uv=('box', 1.25))


def outline(corners, width=0.012, mat='M_Rubber', offset=0.003):
    """Thin border strips along a quad (panel gaps / door lines)."""
    P = [V(p) for p in corners]
    n = face_normal(P)
    g = Geo()
    k = len(P)
    for i in range(k):
        a, b = P[i], P[(i + 1) % k]
        d = (b - a).normalized()
        s = n.cross(d).normalized() * (width / 2)
        g += quad(a - s + n * offset, b - s + n * offset, b + s + n * offset, a + s + n * offset, mat)
    return g


# --------------------------------------------------------------------- beams
def beam(A, B, w, h, mat='M_Trim', up=(0, 0, 1), bevel=0.0, seg=1, cap=True):
    """Rectangular bar from A to B, width w (side), height h (up-ish)."""
    A, B = V(A), V(B)
    d = B - A
    L = d.length
    if L < 1e-6:
        return Geo()
    g = box(w, L, h, (0, L / 2, 0), mat, bevel=bevel, seg=seg)
    y = d.normalized()
    u = V(up)
    if abs(u.dot(y)) > 0.99:
        u = V(1, 0, 0) if abs(y.x) < 0.9 else V(0, 1, 0)
    x = y.cross(u).normalized()
    z = x.cross(y).normalized()
    M = Matrix((x, y, z)).transposed().to_4x4()
    g.transform(M)
    g.move(*A)
    return g


def rod(A, B, r, q, mat='M_Metal', n0=8, cap=True):
    return tube([A, B], r, q.n(n0, max(4, n0 // 2), 4, lo=4), mat, cap=cap)


# -------------------------------------------------------------------- wheels
def wheel(c, R, W, q, side=1, rim=0.60, rim_mat='M_Metal', seg=None, lug=0.0, nuts=None,
          style='road', dual=False, gap=0.03, inner_mat='M_Trim', detail=None, seg2=8):
    """Tyre + rim (+ dual).  side=+1: rim faces +X; -1: faces -X.  Sets _AXLE = c.
    detail: force a cheaper profile set (1 = LOD1 style) independent of the LOD.
    LOD1: 3-band tyre + flat rim disc; LOD2: capped n-gon cylinder (duals merged)."""
    C = V(c)
    if detail is not None and detail > q.lod:
        q = Q(detail)
    if seg is None:
        seg = int(max(14, min(24, R * 40)))
        if R < 0.22:
            seg = 12
    if q.l1:
        seg = max(8, int(round(seg * 0.55)))
    elif q.l2:
        seg = seg2
    g = Geo()
    if q.l2:
        ww = (2 * W + gap) if dual else W
        t = lathe([(R, -ww / 2), (R, ww / 2)], seg, 'M_Rubber', 'z', cap0=True, cap1=True)
        t.transform(Matrix.Rotation(math.pi / 2 * side, 4, 'Y'))
        g += t
        g.move(*C)
        g.set_axle(C)
        return g
    offsets = [0.0]
    if dual:
        offsets = [W / 2 + gap / 2, -(W / 2 + gap / 2)]
    for k, off in enumerate(offsets):
        t = _tyre(R, W, q, seg, lug, rim, style)
        outer = (k == 0)
        if outer:
            t += _rim(R, W, q, seg, rim, rim_mat, nuts, style, inner_mat)
        else:
            t += _rim_inner(R, W, q, seg, rim, inner_mat)
        t.move(0, 0, off)
        t.transform(Matrix.Rotation(math.pi / 2 * side, 4, 'Y'))
        g += t
    g.move(*C)
    g.set_axle(C)
    return g


def _tyre(R, W, q, seg, lug, rim, style):
    w2 = W / 2
    Rr = R * rim
    hs = R - Rr
    if q.l0:
        if style == 'solid':
            prof = [(Rr + 0.02 * hs, -w2 * 0.92), (R - 0.06 * hs, -w2), (R, -w2 * 0.88),
                    (R, w2 * 0.88), (R - 0.06 * hs, w2), (Rr + 0.02 * hs, w2 * 0.92)]
        else:
            prof = [(Rr + 0.02 * hs, -w2 * 0.82), (Rr + 0.55 * hs, -w2), (R - 0.12 * hs, -w2 * 0.94),
                    (R - 0.02 * hs, -w2 * 0.78), (R, -w2 * 0.58), (R, w2 * 0.58), (R - 0.02 * hs, w2 * 0.78),
                    (R - 0.12 * hs, w2 * 0.94), (Rr + 0.55 * hs, w2), (Rr + 0.02 * hs, w2 * 0.82)]
    else:
        prof = [(Rr, -w2 * 0.9), (R - 0.08 * hs, -w2), (R, -w2 * 0.55), (R, w2 * 0.55), (R - 0.08 * hs, w2),
                (Rr, w2 * 0.9)]
        prof = [prof[0], prof[1], prof[4], prof[5]] if seg <= 10 else prof
    g = lathe(prof, seg, 'M_Rubber', 'z')
    if lug > 0 and q.l0:
        # crenellated tread: alternate columns pushed in (no extra triangles)
        step = TAU / seg
        for i, v in enumerate(g.v):
            r = math.hypot(v.x, v.y)
            if r > R * 0.985 - 1e-6:
                j = int(round((math.atan2(v.y, v.x) % TAU) / step)) % seg
                if j % 2 == 1:
                    f = 1.0 - lug
                    g.v[i] = V(v.x * f, v.y * f, v.z)
    return g


def _rim(R, W, q, seg, rim, mat, nuts, style, inner_mat):
    w2 = W / 2
    Rr = R * rim
    z0 = w2 * 0.80
    g = Geo()
    if q.l0:
        if style == 'car':
            prof = [(Rr, z0 - 0.01), (Rr * 0.95, z0 + 0.006), (Rr * 0.86, z0 - 0.012), (Rr * 0.32, z0 - 0.03),
                    (Rr * 0.20, z0 - 0.01), (0, z0 - 0.008)]
        else:
            prof = [(Rr, z0 - 0.01), (Rr * 0.965, z0 + 0.012), (Rr * 0.88, z0 - 0.015),
                    (Rr * 0.46, z0 - 0.075 * W), (Rr * 0.38, z0 - 0.025 * W),
                    (Rr * 0.22, z0 + 0.025 * W), (0, z0 + 0.032 * W)]
        g += lathe(prof, seg, mat, 'z')
        n_nuts = nuts if nuts is not None else (0 if R < 0.25 else (5 if R < 0.40 else 8))
        if n_nuts:
            rn = max(0.012, R * 0.035)
            for k in range(n_nuts):
                a = TAU * k / n_nuts
                pr = Rr * 0.30
                g += cylinder(rn, 0.03 * W + 0.012, 6, (pr * math.cos(a), pr * math.sin(a), z0 - 0.035 * W),
                              'z', 'M_Metal', cap0=False)
        g += Geo().add([V(Rr * 1.001 * math.cos(TAU * j / seg), Rr * 1.001 * math.sin(TAU * j / seg),
                          -w2 * 0.80) for j in range(seg)][::-1], [tuple(range(seg))], inner_mat)
    else:
        # flat rim disc (outer) + inner disc
        z = w2 * 0.9
        g += Geo().add([V(Rr * math.cos(TAU * j / seg), Rr * math.sin(TAU * j / seg), z) for j in range(seg)],
                       [tuple(range(seg))], mat)
        g += Geo().add([V(Rr * math.cos(TAU * j / seg), Rr * math.sin(TAU * j / seg), -z)
                        for j in range(seg)][::-1], [tuple(range(seg))], inner_mat)
    return g


def _rim_inner(R, W, q, seg, rim, mat):
    w2 = W / 2
    Rr = R * rim
    z = w2 * (0.8 if q.l0 else 0.9)
    g = Geo().add([V(Rr * math.cos(TAU * j / seg), Rr * math.sin(TAU * j / seg), z) for j in range(seg)],
                  [tuple(range(seg))], mat)
    g += Geo().add([V(Rr * math.cos(TAU * j / seg), Rr * math.sin(TAU * j / seg), -z) for j in range(seg)][::-1],
                   [tuple(range(seg))], mat)
    return g


def mudguard(c, R, W, q, side=1, a0=0.0, a1=math.pi, mat='M_Rubber', thick=0.025, clear=0.06):
    """Arched fender over a wheel (axle along X) between angles a0..a1 (0 = front +Y,
    pi/2 = top) -- returns closed partial shell."""
    seg = q.n(14, 7, 4)
    r0, r1 = R + clear, R + clear + thick
    w2 = W / 2 + 0.03
    prof = [(r0, -w2), (r1, -w2), (r1, w2), (r0, w2), (r0, -w2)]
    # lathe around z then rotate so z->x; angle 0 should map to +Y
    g = lathe(prof, seg, mat, 'z', a0=a0, a1=a1)
    # end caps
    for ang in (a0, a1):
        ca, sa = math.cos(ang), math.sin(ang)
        pts = [V(r * ca, r * sa, h) for r, h in prof[:-1]]
        if ang == a1:
            pts = pts[::-1]
        g.add(pts, [(0, 1, 2, 3)], mat)
    # orientation: lathe x-axis (angle 0) -> +Y ; lathe y-axis (angle 90) -> +Z ; z -> X
    M = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    g.transform(M)
    g.move(*c)
    return g


# ------------------------------------------------------------------- lights
def beacon(c, q, r=0.085, h=0.15, base_h=0.045, mat='M_Beacon'):
    seg = q.n(12, 8, 6)
    C = V(c)
    g = cylinder(r * 1.2, base_h, seg, tuple(C), 'z', 'M_Trim', cap0=False)
    prof = [(r, 0.0), (r, h * 0.55), (r * 0.78, h * 0.86), (r * 0.40, h), (0, h)]
    if q.l2:
        prof = [(r, 0.0), (r, h * 0.7), (0, h)]
    g += lathe(prof, seg, mat, 'z', (C.x, C.y, C.z + base_h))
    return g


def lightbar(c, length, q, depth=0.28, h=0.12, colors=('M_Beacon',), axis='x'):
    """Low roof light bar (LED) with coloured lens segments."""
    C = V(c)
    g = Geo()
    if axis == 'x':
        g += box(length, depth, h * 0.45, (C.x, C.y, C.z + h * 0.22), 'M_Trim', bevel=q.bev(0.03), seg=q.seg(2, 1))
        g += box(length * 0.98, depth * 0.86, h * 0.6, (C.x, C.y, C.z + h * 0.7), colors[0],
                 bevel=q.bev(0.04), seg=q.seg(2, 1))
    else:
        g += box(depth, length, h * 0.45, (C.x, C.y, C.z + h * 0.22), 'M_Trim', bevel=q.bev(0.03), seg=q.seg(2, 1))
        g += box(depth * 0.86, length * 0.98, h * 0.6, (C.x, C.y, C.z + h * 0.7), colors[0],
                 bevel=q.bev(0.04), seg=q.seg(2, 1))
    return g


def worklight(c, normal, q, w=0.18, h=0.12, color='cool'):
    """Small LED work lamp on a bracket."""
    n = V(normal).normalized()
    C = V(c)
    g = Geo()
    face = {(0, 1, 0): '+y', (0, -1, 0): '-y', (1, 0, 0): '+x', (-1, 0, 0): '-x',
            (0, 0, -1): '-z', (0, 0, 1): '+z'}.get(tuple(round(k) for k in n), '+y')
    g += lamp(face, tuple(C), w, h, q, color, depth=0.07)
    return g


# ----------------------------------------------------------------- mirrors
def mirror(base, side, q, arm=0.28, head=(0.06, 0.20, 0.32), drop=0.05, fwd=0.06, mat='M_Trim'):
    """Truck/van side mirror on a tubular arm. base = mount point on the body side."""
    if q.l2:
        return Geo()
    B = V(base)
    tip = B + V(side * arm, fwd, drop)
    g = Geo()
    if q.l0:
        g += tube([B, B + V(side * arm * 0.55, fwd + 0.02, drop + 0.10), tip], 0.016, 6, 'M_Trim')
    else:
        g += tube([B, tip], 0.016, 4, 'M_Trim')
    hw, hd, hh = head
    cx = tip.x + side * hw * 0.3
    g += box(hw, hd * 0.55, hh, (cx, tip.y + hd * 0.1, tip.z), mat, bevel=q.bev(0.02), seg=q.seg(2, 1))
    # glass facing backwards (-Y)
    g += panel(rect('-y', (cx, tip.y + hd * 0.1 - hd * 0.275, tip.z), hw * 0.8, hh * 0.85), 'M_Glass', offset=0.003)
    return g


# -------------------------------------------------------------- interiors
def seat(c, q, w=0.5, d=0.5, h=0.45, back=0.55, yaw=0.0, mat='M_Rubber'):
    C = V(c)
    g = Geo()
    g += box(w, d, 0.12, (0, 0, h - 0.06), mat, bevel=q.bev(0.035), seg=q.seg(2, 1))
    g += box(w * 0.95, 0.10, back, (0, -d / 2 + 0.05, h + back / 2 - 0.02), mat, bevel=q.bev(0.035), seg=q.seg(2, 1))
    if not q.l2:
        g += box(w * 0.6, d * 0.6, h - 0.12, (0, 0, (h - 0.12) / 2), 'M_Trim')
    if yaw:
        g.rot('Z', yaw)
    g.move(*C)
    return g


def steering(c, q, r=0.19, tilt=0.6):
    if q.l2:
        return Geo()
    C = V(c)
    seg = q.n(14, 8)
    ring = [V(r * math.cos(TAU * i / seg), r * math.sin(TAU * i / seg), 0) for i in range(seg)]
    g = tube(ring + [ring[0]], 0.018, 5 if q.l0 else 4, 'M_Rubber', cap=False)
    g += rod((0, 0, 0), (0, 0, -0.45), 0.025, q, 'M_Trim')
    g.rot('X', tilt)
    g.move(*C)
    return g


# ------------------------------------------------------------------ scissor
def scissor(xh, y0, y1, z0, z1, stages, q, bw=0.09, bh=0.14, mat='M_Trim', cross=True):
    """Scissor lift: two packs (x = +-xh), `stages` crossed arm pairs from z0 to z1.
    Topology independent of z1 (safe for morph targets)."""
    g = Geo()
    dz = (z1 - z0) / stages
    bev = 0.0
    for sx in (-1, 1):
        x = sx * xh
        for s in range(stages):
            za = z0 + s * dz
            zb = za + dz
            g += beam((x - sx * bw * 0.6, y0, za + bh / 2), (x - sx * bw * 0.6, y1, zb - bh / 2), bw, bh, mat,
                      up=(0, 0, 1), bevel=bev)
            g += beam((x + sx * bw * 0.6, y1, za + bh / 2), (x + sx * bw * 0.6, y0, zb - bh / 2), bw, bh, mat,
                      up=(0, 0, 1), bevel=bev)
    if cross and not q.l2:
        n = q.n(8, 6, 4, lo=4)
        for s in range(stages + 1):
            z = z0 + s * dz
            zc = min(max(z, z0 + bh / 2), z1 - bh / 2)
            for yy in (y0, y1):
                g += tube([V(-xh - bw, yy, zc), V(xh + bw, yy, zc)], bw * 0.4, n, 'M_Metal')
            if s < stages:
                zm = z + dz / 2
                g += tube([V(-xh - bw * 1.6, (y0 + y1) / 2, zm), V(xh + bw * 1.6, (y0 + y1) / 2, zm)],
                          bw * 0.45, n, 'M_Metal')
    return g


# -------------------------------------------------------------------- stairs
def stair_flight(p0, p1, width, q, n_steps=None, rails=(True, True), rail_h=0.95,
                 tread_mat='M_Metal', side_mat='M_Trim', rail_mat='M_Metal', riser=False,
                 stringer_h=0.22, landing_top=False, n_posts=None):
    """Straight stair flight. p0 = floor point at the bottom nosing, p1 = floor point at
    the top (landing level).  Steps rise along the horizontal direction p0->p1."""
    p0, p1 = V(p0), V(p1)
    rise = p1.z - p0.z
    run_v = V(p1.x - p0.x, p1.y - p0.y, 0)
    run = run_v.length
    fwd = run_v.normalized()
    side = fwd.cross(V(0, 0, 1)).normalized()  # right-hand side
    if n_steps is None:
        n_steps = max(2, int(round(rise / 0.19)))
    g = Geo()
    hstep = rise / n_steps
    dstep = run / n_steps
    tread_t = 0.04
    if q.l2:
        # one sloped slab
        a = p0 - side * width / 2
        b = p0 + side * width / 2
        c2 = p1 + side * width / 2
        d = p1 - side * width / 2
        g += quad(a, b, c2, d, tread_mat)
        g += quad(d + V(0, 0, -0.18), c2 + V(0, 0, -0.18), b + V(0, 0, -0.18), a + V(0, 0, -0.18), side_mat)
        return g
    M = Matrix((side, fwd, V(0, 0, 1))).transposed().to_4x4()
    for i in range(n_steps - (1 if landing_top else 0)):
        z = p0.z + hstep * (i + 1)
        y = dstep * i + dstep / 2
        st = box(width - 0.02, dstep + 0.03, tread_t, (0, y, 0), tread_mat)
        st.transform(M)
        st.move(p0.x, p0.y, z - tread_t / 2)
        g += st
        if riser and q.l0:
            rs = box(width - 0.04, 0.012, hstep, (0, y - dstep / 2 + 0.006, 0), side_mat)
            rs.transform(M)
            rs.move(p0.x, p0.y, z - hstep / 2)
            g += rs
    # stringers
    for sgn in (-1, 1):
        off = side * sgn * (width / 2 + 0.02)
        a = p0 + off + V(0, 0, 0.0)
        b = p1 + off
        g += beam(a + V(0, 0, -stringer_h * 0.25), b + V(0, 0, -stringer_h * 0.25), 0.03, stringer_h, side_mat,
                  up=(0, 0, 1))
    # handrails
    rn = 6 if q.l0 else 3
    for sgn, on in zip((-1, 1), rails):
        if not on:
            continue
        off = side * sgn * (width / 2 + 0.03)
        a = p0 + off
        b = p1 + off
        top_a = a + V(0, 0, rail_h)
        top_b = b + V(0, 0, rail_h)
        g += tube([top_a - fwd * 0.05, top_b + fwd * 0.05], 0.022, rn, rail_mat, cap=q.l0)
        if q.l0:
            g += tube([a.lerp(b, 0.0) + V(0, 0, rail_h * 0.5), a.lerp(b, 1.0) + V(0, 0, rail_h * 0.5)], 0.016, rn,
                      rail_mat)
        npost = n_posts if n_posts else max(2, int(run / 1.1) + 1)
        if q.l1:
            npost = 2
        for k in range(npost):
            t = k / (npost - 1)
            p = a.lerp(b, t)
            g += tube([p, p + V(0, 0, rail_h)], 0.02, rn, rail_mat, cap=q.l0)
    return g


def guard_rail(points, q, h=1.0, post_every=1.2, r=0.022, mat='M_Metal', mid=True, toe=False):
    """Guard rail along a polyline of floor points (posts + top rail + mid rail)."""
    P = [V(p) for p in points]
    g = Geo()
    rn = 6 if q.l0 else 4
    if q.l2:
        # thin panel as silhouette
        for a, b in zip(P[:-1], P[1:]):
            g += quad(a + V(0, 0, h - 0.04), b + V(0, 0, h - 0.04), b + V(0, 0, h), a + V(0, 0, h), mat)
            g += quad(a + V(0, 0, h), b + V(0, 0, h), b + V(0, 0, h - 0.04), a + V(0, 0, h - 0.04), mat)
        return g
    if q.l1:
        rn = 3
        mid = False
        post_every = post_every * 2.5
    g += tube(round_path([p + V(0, 0, h) for p in P], 0.06, 2 if q.l0 else 0), r, rn, mat, cap=q.l0)
    if mid:
        g += tube([p + V(0, 0, h * 0.5) for p in P], r * 0.8, rn, mat)
    for a, b in zip(P[:-1], P[1:]):
        L = (b - a).length
        n = max(1, int(math.ceil(L / post_every)))
        for k in range(n + 1):
            if k == 0 and a is not P[0]:
                continue
            p = a.lerp(b, k / n)
            g += tube([p, p + V(0, 0, h)], r, rn, mat, cap=q.l0)
        if toe and q.l0:
            d = (b - a).normalized()
            s = d.cross(V(0, 0, 1)) * 0.004
            g += quad(a - s, b - s, b - s + V(0, 0, 0.1), a - s + V(0, 0, 0.1), 'M_Hazard', ('box', 1.25))
            g += quad(b + s, a + s, a + s + V(0, 0, 0.1), b + s + V(0, 0, 0.1), 'M_Hazard', ('box', 1.25))
    return g


def ladder(p0, p1, width, q, rung=0.28, mat='M_Metal'):
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    side = d.cross(V(0, 0, 1))
    if side.length < 1e-6:
        side = V(1, 0, 0)
    side = side.normalized() * width / 2
    g = Geo()
    rn = 6 if q.l0 else 4
    g += tube([p0 - side, p1 - side], 0.018, rn, mat)
    g += tube([p0 + side, p1 + side], 0.018, rn, mat)
    if not q.l2:
        n = max(2, int(d.length / rung))
        for k in range(1, n):
            p = p0.lerp(p1, k / n)
            g += tube([p - side, p + side], 0.013, 4, mat, cap=False)
    return g


# -------------------------------------------------------------- misc parts
def hose_reel(c, r, w, q, axis='x', hose_r=None, mat='M_Trim'):
    """Hose drum with flanges and hose wound on it."""
    C = V(c)
    seg = q.n(18, 10, 6)
    g = Geo()
    hr = hose_r or r * 0.75
    g += lathe([(hr, -w / 2), (hr, w / 2)], seg, 'M_Rubber', 'z', cap0=False, cap1=False)
    if q.l0:
        # wound turns: subtle ridges
        n = 5
        prof = []
        for k in range(n + 1):
            z = -w / 2 + w * k / n
            prof.append((hr + 0.012, z))
            if k < n:
                prof.append((hr, z + w / n * 0.5))
        g = lathe(prof, seg, 'M_Rubber', 'z')
    for s in (-1, 1):
        fl = lathe([(0, s * w / 2), (r, s * w / 2), (r, s * (w / 2 + 0.02)), (0, s * (w / 2 + 0.02))], seg, mat, 'z')
        if s < 0:
            fl = lathe([(0, -(w / 2 + 0.02)), (r, -(w / 2 + 0.02)), (r, -w / 2), (0, -w / 2)], seg, mat, 'z')
        g += fl
    rot = {'x': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'y': Matrix.Rotation(-math.pi / 2, 4, 'X'),
           'z': Matrix.Identity(4)}[axis]
    g.transform(rot)
    g.move(*C)
    return g


def extinguisher(c, q, h=0.55, r=0.075):
    if q.l2:
        return Geo()
    C = V(c)
    seg = q.n(10, 6)
    g = lathe([(r, 0), (r, h * 0.82), (r * 0.6, h * 0.95), (0, h * 0.97)], seg, 'M_Body', 'z', tuple(C), cap0=True)
    if q.l0:
        g += cylinder(0.02, 0.06, 6, (C.x, C.y, C.z + h * 0.95), 'z', 'M_Trim')
    return g


def grille(face, c, w, h, q, slats=5, mat='M_Trim', slat_mat='M_Metal'):
    g = panel(rect(face, c, w, h), mat, offset=0.003)
    if q.l0:
        C = V(c)
        for k in range(slats):
            z = C.z - h / 2 + h * (k + 0.5) / slats
            if face in ('+y', '-y'):
                sgn = 1 if face == '+y' else -1
                g += box(w * 0.94, 0.02, h / slats * 0.35, (C.x, C.y + sgn * 0.012, z), slat_mat)
            else:
                sgn = 1 if face == '+x' else -1
                g += box(0.02, w * 0.94, h / slats * 0.35, (C.x + sgn * 0.012, C.y, z), slat_mat)
    return g


def louvre(face, c, w, h, q, n=8, mat='M_Trim'):
    """Vent louvres: dark recess + slats (horizontal on walls, across Y on +/-z faces)."""
    g = panel(rect(face, c, w, h), 'M_Rubber', offset=0.002)
    if q.l0:
        C = V(c)
        for k in range(n):
            if face in ('+z', '-z'):
                y = C.y - h / 2 + h * (k + 0.5) / n
                sgn = 1 if face == '+z' else -1
                g += box(w * 0.96, h / n * 0.55, 0.012, (C.x, y, C.z + sgn * 0.008), mat)
                continue
            z = C.z - h / 2 + h * (k + 0.5) / n
            if face in ('+x', '-x'):
                sgn = 1 if face == '+x' else -1
                g += box(0.012, w * 0.96, h / n * 0.55, (C.x + sgn * 0.01, C.y, z), mat)
            else:
                sgn = 1 if face == '+y' else -1
                g += box(w * 0.96, 0.012, h / n * 0.55, (C.x, C.y + sgn * 0.01, z), mat)
    return g


def handle(a, b, q, r=0.014, standoff=0.05, normal=(1, 0, 0), mat='M_Metal'):
    """Grab handle: tube with two standoffs."""
    if q.l2:
        return Geo()
    A, B = V(a), V(b)
    n = V(normal).normalized() * standoff
    return tube(round_path([A, A + n, B + n, B], 0.03, 2), r, 6 if q.l0 else 4, mat)


# -------------------------------------------------------------- truck cab
class Cab:
    """Cab-over truck cab built from an extruded side profile with tumblehome.
    Frame: front face at y = yf, floor/bottom at z0, width W, depth D, height H."""

    def __init__(self, q, W=2.3, D=1.9, H=2.05, yf=4.0, z0=0.95, slope=0.30, wsh=0.95,
                 tumble=0.05, bevel=0.07, mat='M_Body', roof_round=0.14, glass_top=0.14):
        self.q = q
        self.W, self.D, self.H, self.yf, self.z0 = W, D, H, yf, z0
        self.slope, self.wsh, self.tumble = slope, wsh, tumble
        self.zt = z0 + H
        self.zw = z0 + wsh
        self.zb = z0 + wsh - 0.02  # belt line
        self.yb = yf - D
        self.mat = mat
        self.bevel = bevel
        self.roof_round = roof_round
        self.glass_top = glass_top

    def xdef(self, x, z):
        if z <= self.zb:
            return x
        k = (z - self.zb) / max(1e-6, self.zt - self.zb)
        return x * (1.0 - self.tumble * k)

    def front_y(self, z):
        """y of the front surface at height z (windshield slope above zw)."""
        if z <= self.zw:
            return self.yf
        t = (z - self.zw) / max(1e-6, (self.zt - 0.10) - self.zw)
        return self.yf - self.slope * min(1.0, t)

    def shell(self):
        q = self.q
        yf, yb, z0, zt, zw = self.yf, self.yb, self.z0, self.zt, self.zw
        rr = self.roof_round
        prof = [(yb, z0), (yf - 0.03, z0), (yf, z0 + 0.22), (yf, zw), (yf - self.slope, zt - 0.10),
                (yf - self.slope - rr, zt), (yb + 0.06, zt), (yb, zt - 0.07)]
        g = prism(prof, 'x', -self.W / 2, self.W / 2, self.mat, bevel=q.bev(self.bevel, 0.04),
                  seg=q.seg(2, 1))
        g.deform(lambda v: V(self.xdef(v.x, v.z), v.y, v.z))
        return g

    def side_pt(self, sx, y, z, out=0.0):
        x = self.xdef(sx * self.W / 2, z)
        return V(x + sx * out, y, z)

    def windshield(self):
        zt = self.zt
        z_lo, z_hi = self.zw + 0.06, zt - self.glass_top
        m = 0.11
        pts = []
        for (sx, z) in ((1, z_lo), (-1, z_lo), (-1, z_hi), (1, z_hi)):
            y = self.front_y(z)
            x = self.xdef(sx * (self.W / 2 - m), z)
            pts.append(V(x, y, z))
        # CCW seen from the front: +x is on the viewer's left -> order (+x lo, -x lo, -x hi, +x hi)
        g = panel(pts, 'M_Glass', offset=0.008, frame=0.035 if not self.q.l2 else 0.0, frame_mat='M_Rubber')
        return g, pts

    def side_window(self, sx, y_back_frac=0.62, top=None, bottom=None):
        zt = self.zt
        z_lo = (self.zw + 0.04) if bottom is None else bottom
        z_hi = (zt - self.glass_top - 0.02) if top is None else top
        yb = self.yf - self.D * y_back_frac
        yf_lo = self.front_y(z_lo) - 0.10
        yf_hi = self.front_y(z_hi) - 0.10
        if sx > 0:
            pts = [self.side_pt(1, yb, z_lo), self.side_pt(1, yf_lo, z_lo), self.side_pt(1, yf_hi, z_hi),
                   self.side_pt(1, yb, z_hi)]
        else:
            pts = [self.side_pt(-1, yf_lo, z_lo), self.side_pt(-1, yb, z_lo), self.side_pt(-1, yb, z_hi),
                   self.side_pt(-1, yf_hi, z_hi)]
        return panel(pts, 'M_Glass', offset=0.008, frame=0.03 if not self.q.l2 else 0.0, frame_mat='M_Rubber')

    def door_lines(self, sx, y_back_frac=0.66):
        if not self.q.l0:
            return Geo()
        z_lo, z_hi = self.z0 + 0.08, self.zt - 0.09
        yb = self.yf - self.D * y_back_frac
        yf_lo = self.yf - 0.06
        yf_hi = self.front_y(z_hi) - 0.06
        zm = self.zw
        ym = self.front_y(zm) - 0.06
        if sx > 0:
            pts = [self.side_pt(1, yb, z_lo), self.side_pt(1, yf_lo, z_lo), self.side_pt(1, ym, zm),
                   self.side_pt(1, yf_hi, z_hi), self.side_pt(1, yb, z_hi)]
        else:
            pts = [self.side_pt(-1, yf_lo, z_lo), self.side_pt(-1, yb, z_lo), self.side_pt(-1, yb, z_hi),
                   self.side_pt(-1, yf_hi, z_hi), self.side_pt(-1, ym, zm)]
        g = Geo()
        n = V(sx, 0, 0)
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            d = (b - a).normalized()
            s = n.cross(d).normalized() * 0.006
            g += quad(a - s + n * 0.004, b - s + n * 0.004, b + s + n * 0.004, a + s + n * 0.004, 'M_Rubber')
        return g

    def build(self, beacons=1, mirrors=True, steps=True, grille_h=0.42, lamps=True, bumper=True,
              marker=True, wipers=True, bumper_mat='M_Trim', visor=False):
        q = self.q
        g = self.shell()
        ws, _ = self.windshield()
        g += ws
        for sx in (-1, 1):
            g += self.side_window(sx)
            g += self.door_lines(sx)
        W, yf, z0, zt = self.W, self.yf, self.z0, self.zt
        if grille_h > 0:
            g += grille('+y', (0, yf, z0 + 0.22 + grille_h / 2 + 0.05), W * 0.46, grille_h, q, slats=4)
        if lamps:
            for sx in (-1, 1):
                g += lamp('+y', (sx * (W / 2 - 0.30), yf, z0 + 0.36), 0.36, 0.17, q, 'warm', depth=0.05)
                if q.l0:
                    g += lamp('+y', (sx * (W / 2 - 0.08), yf, z0 + 0.36), 0.08, 0.15, q, 'amber', depth=0.04)
        if bumper:
            g += box(W + 0.06, 0.22, 0.30, (0, yf + 0.05, z0 - 0.02), bumper_mat, bevel=q.bev(0.05, 0.03),
                     seg=q.seg(2, 1))
            if q.l0:
                for sx in (-1, 1):
                    g += lamp('+y', (sx * (W / 2 - 0.22), yf + 0.162, z0 - 0.02), 0.16, 0.07, q, 'cool',
                              housing=None)
        if mirrors:
            for sx in (-1, 1):
                base = self.side_pt(sx, self.front_y(self.zw + 0.25) - 0.18, self.zw + 0.25)
                g += mirror(base, sx, q, arm=0.30, head=(0.07, 0.22, 0.40), drop=0.10, fwd=0.10)
        if steps and not q.l2:
            for sx in (-1, 1):
                for k, dz in enumerate((-0.30, -0.62)):
                    g += box(0.30, 0.46, 0.035, (sx * (W / 2 - 0.12), yf - 0.55, z0 + dz), 'M_Metal')
                if q.l0:
                    g += handle(self.side_pt(sx, yf - 0.95, z0 + 0.35, 0.0),
                                self.side_pt(sx, yf - 0.95, z0 + 1.15, 0.0), q, normal=(sx, 0, 0))
        if marker and q.l0:
            for k in (-1, 0, 1):
                g += lamp('+y', (k * 0.22, self.front_y(zt - 0.05) - 0.05, zt - 0.03), 0.08, 0.035, q, 'amber',
                          depth=0.03)
        if wipers and q.l0:
            for sx in (-0.45, 0.15):
                a = V(sx * W / 2 * 1.2, self.front_y(self.zw + 0.10) + 0.012, self.zw + 0.10)
                b = a + V(0.55, -0.12 * self.slope, 0.42)
                g += tube([a, b], 0.01, 4, 'M_Rubber')
        if visor:
            g += box(W * 0.94, 0.25, 0.04, (0, self.front_y(zt - 0.05) + 0.06, zt - 0.02), 'M_Trim',
                     bevel=q.bev(0.015), seg=q.seg(1, 1))
        for k in range(beacons):
            x = 0.0 if beacons == 1 else (-1 + 2 * k / (beacons - 1)) * (W / 2 - 0.25)
            g += beacon((x, self.yb + self.D * 0.45, zt), q)
        return g


# ---------------------------------------------------------- truck chassis
def chassis(q, y0, y1, z_top, rail_x=0.43, rail_h=0.26, rail_w=0.08, mat='M_Trim', cross=4):
    g = Geo()
    for sx in (-1, 1):
        g += box_minmax(sx * rail_x - rail_w / 2, y0, z_top - rail_h, sx * rail_x + rail_w / 2, y1, z_top, mat)
    if not q.l2:
        for k in range(cross):
            y = y0 + (y1 - y0) * (k + 0.5) / cross
            g += box_minmax(-rail_x, y - 0.05, z_top - rail_h * 0.8, rail_x, y + 0.05, z_top - 0.02, mat)
    return g


def fuel_tank(c, L, r, q, axis='y', mat='M_Metal'):
    seg = q.n(14, 8, 6)
    prof = [(0, -L / 2), (r * 0.9, -L / 2), (r, -L / 2 + 0.04), (r, L / 2 - 0.04), (r * 0.9, L / 2), (0, L / 2)]
    g = lathe(prof, seg, mat, 'z')
    rot = {'x': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'y': Matrix.Rotation(-math.pi / 2, 4, 'X'),
           'z': Matrix.Identity(4)}[axis]
    g.transform(rot)
    g.move(*c)
    if q.l0:
        for t in (-0.3, 0.3):
            band = lathe([(r + 0.005, -0.02), (r + 0.005, 0.02)], seg, 'M_Trim', 'z')
            band.move(0, 0, t * L)
            band.transform(rot)
            band.move(*c)
            g += band
    return g


def tail_lights(y, z, xs, q, face='-y', w=0.22, h=0.10):
    g = Geo()
    for x in xs:
        g += lamp(face, (x, y, z), w, h, q, 'tail', depth=0.05)
        if q.l0:
            g += lamp(face, (x + (0.0 if x == 0 else math.copysign(0.0, x)), y, z - h - 0.02), w * 0.45, 0.05, q,
                      'amber', depth=0.04)
    return g


# ------------------------------------------------------- profile bodies
class ProfileBody:
    """Vehicle shell from a side profile (y, z) extruded across X with tumblehome above
    `belt` (sides lean in by `tumble` * half-width at the roof) and optional wheel arches.
    Helpers place glass/decals exactly on its planar faces."""

    def __init__(self, q, prof, W, belt, top, tumble=0.06, bevel=0.06, mat='M_Body', seg2=2, x0=None):
        self.q = q
        self.prof = prof
        self.W = W
        self.belt = belt
        self.top = top
        self.tumble = tumble
        self.bevel = bevel
        self.mat = mat
        self.seg2 = seg2

    def k(self, z):
        if z <= self.belt:
            return 1.0
        t = min(1.0, (z - self.belt) / max(1e-6, self.top - self.belt))
        return 1.0 - self.tumble * t

    def shell(self):
        q = self.q
        g = prism(self.prof, 'x', -self.W / 2, self.W / 2, self.mat, bevel=q.bev(self.bevel, self.bevel * 0.6),
                  seg=q.seg(self.seg2, 1))
        g.deform(lambda v: V(v.x * self.k(v.z), v.y, v.z))
        return g

    def side(self, sx, y, z, out=0.0):
        return V(sx * (self.W / 2 * self.k(z) + out), y, z)

    def side_quad(self, sx, pts_yz, out=0.0):
        """pts_yz: 4 (y, z) points CCW as seen from +X (y right, z up)."""
        P = [self.side(sx, y, z, out) for (y, z) in pts_yz]
        if sx < 0:
            P = [P[1], P[0], P[3], P[2]]
        return P

    def glass_side(self, sx, pts_yz, frame=0.03, mat='M_Glass', frame_mat='M_Rubber', offset=0.007):
        return panel(self.side_quad(sx, pts_yz), mat, offset=offset,
                     frame=frame if not self.q.l2 else 0.0, frame_mat=frame_mat)

    def edge_quad(self, ya, za, yb, zb, t0, t1, margin, facing):
        """Quad on the planar face between profile points a=(ya,za) and b=(yb,zb),
        between params t0..t1 along a->b, inset `margin` from the sides.
        facing '+y' (front faces) or '-y' (rear faces) decides corner order."""
        pa = (ya + (yb - ya) * t0, za + (zb - za) * t0)
        pb = (ya + (yb - ya) * t1, za + (zb - za) * t1)
        def P(x_sign, p):
            return V(x_sign * (self.W / 2 * self.k(p[1]) - margin), p[0], p[1])
        lo, hi = (pa, pb) if pa[1] <= pb[1] else (pb, pa)
        if facing == '+y':
            return [P(1, lo), P(-1, lo), P(-1, hi), P(1, hi)]
        return [P(-1, lo), P(1, lo), P(1, hi), P(-1, hi)]

    def top_quad(self, y0, y1, z, margin):
        k = self.k(z)
        hw = self.W / 2 * k - margin
        return [V(-hw, y0, z), V(hw, y0, z), V(hw, y1, z), V(-hw, y1, z)]


def decal_strip_side(body, sx, y0, y1, z0, z1, key, n, offset=0.006):
    """Repeat a decal region n times along a body side between y0..y1."""
    g = Geo()
    for i in range(n):
        ya = y0 + (y1 - y0) * i / n
        yb = y0 + (y1 - y0) * (i + 1) / n
        P = body.side_quad(sx, [(ya, z0), (yb, z0), (yb, z1), (ya, z1)])
        u0, v0, u1, v1 = DECAL[key]
        if sx > 0:
            uv = quad_uv(u0, v0, u1, v1)
        else:
            uv = quad_uv(u0, v0, u1, v1)
        g += panel(P, 'M_Decal', offset=offset, uv=uv)
    return g


def red_uv():
    """UV point inside a solid red area of the decal atlas (for small red parts)."""
    u0, v0, u1, v1 = DECAL['stop']
    return ('pt', u0 + 0.01, v0 + 0.01)


def blue_uv():
    u0, v0, u1, v1 = DECAL['wheelchair']
    return ('pt', u0 + 0.01, v0 + 0.01)


def red_mat_geo(g):
    """Recolour a Geo red by mapping it into the decal atlas red region."""
    g.set_mat('M_Decal')
    g.set_uv(red_uv())
    return g


# ------------------------------------------------------------ detail kit
def hatch(face, c, w, h, q, handle_side=1):
    """Service hatch: panel-gap outline + small recessed handle (LOD0 only)."""
    if not q.l0:
        return Geo()
    g = outline(rect(face, c, w, h), 0.010, 'M_Rubber', 0.003)
    C = V(c)
    n = {'+y': V(0, 1, 0), '-y': V(0, -1, 0), '+x': V(1, 0, 0), '-x': V(-1, 0, 0)}[face]
    t = {'+y': V(-1, 0, 0), '-y': V(1, 0, 0), '+x': V(0, 1, 0), '-x': V(0, -1, 0)}[face]
    p = C + t * (handle_side * (w / 2 - 0.07)) + n * 0.004
    g += panel(rect(face, tuple(p), 0.03, 0.10), 'M_Trim', offset=0.002)
    return g


def marker(face, c, q, color='amber', w=0.07, h=0.035):
    """Side marker / reflector lens."""
    if q.l2:
        return Geo()
    return lens(rect(face, c, w, h), color, offset=0.004)


def skirt(q, y0, y1, hw, z0, z1, arches=(), mat='M_Trim', proud=0.012, ends=True):
    """Two-tone lower band on both sides (and front/rear), cut around wheel arches."""
    from .shapes import segments_outside
    g = Geo()
    if q.l2:
        return g
    for (ya, yb) in segments_outside(y0, y1, arches):
        for sx in (-1, 1):
            x0, x1 = (hw - 0.02, hw + proud) if sx > 0 else (-hw - proud, -hw + 0.02)
            g += box_minmax(x0, ya, z0, x1, yb, z1, mat)
    if ends:
        g += box_minmax(-hw - proud, y1 - 0.02, z0, hw + proud, y1 + proud, z1, mat)
        g += box_minmax(-hw - proud, y0 - proud, z0, hw + proud, y0 + 0.02, z1, mat)
    return g


def seams(face_x, y0, y1, z0, z1, q, pitch=1.0, mat='M_Trim'):
    """Vertical panel seams on a flat side at x = face_x (sign gives the facing)."""
    if not q.l0:
        return Geo()
    g = Geo()
    sx = 1 if face_x > 0 else -1
    n = int((y1 - y0) / pitch)
    for k in range(1, n):
        y = y0 + (y1 - y0) * k / n
        pts = rect('+x' if sx > 0 else '-x', (face_x, y, (z0 + z1) / 2), 0.012, z1 - z0)
        g += panel(pts, mat, offset=0.003)
    return g
