"""Vegetation and car-park context (instanced): date palms, shrub, sedan, SUV."""
import math
import random

from mathutils import Matrix, Vector

from .geo import TAU, Geo, V, box, box_minmax, lathe, panel, poly, quad, quad_uv, tube
from .parts import ProfileBody, Q, decal, lamp, mirror, outline, rect, wheel
from .scene import Rig
from .shapes import arch_profile
from .textures import light_uv


# ================================================================ date palm
def _trunk(q, H, r_base, r_top, lean, seed, sides, ring_step):
    """Tapered, slightly curved trunk with knobbly leaf-base displacement and cylindrical UVs."""
    rng = random.Random(seed)
    n_r = max(2, int(H / ring_step) + 1)
    lx, ly = lean
    g = Geo()
    verts = []
    rings = []
    phase = rng.uniform(0, TAU)
    for i in range(n_r):
        t = i / (n_r - 1)
        z = H * t
        cx = lx * (t ** 1.6)
        cy = ly * (t ** 1.6)
        r = r_base + (r_top - r_base) * (t ** 0.7)
        if t < 0.08:
            r *= 1.0 + (0.08 - t) * 3.2          # root flare
        ring = []
        for j in range(sides):
            a = TAU * j / sides + phase
            # diamond knobs: offset every other ring by half a column
            if q.l0:
                k = 1.0 + 0.055 * (1 if (i + j) % 2 == 0 else -1) * (0.3 if t < 0.1 else 1.0)
            else:
                k = 1.0
            ring.append(len(verts))
            verts.append(V(cx + r * k * math.cos(a), cy + r * k * math.sin(a), z))
        rings.append((ring, z))
    faces, fuv = [], []
    uu = 2.0                     # texture repeats around the trunk
    vv = 1.0 / 1.2               # one texture tile per 1.2 m
    for i in range(n_r - 1):
        A, za = rings[i]
        B, zb = rings[i + 1]
        for j in range(sides):
            jn = (j + 1) % sides
            faces.append((A[j], A[jn], B[jn], B[j]))
            u0, u1 = uu * j / sides, uu * (j + 1) / sides
            fuv.append(('uv', [(u0, za * vv), (u1, za * vv), (u1, zb * vv), (u0, zb * vv)]))
    g.add(verts, faces, 'M_Trunk', fuv)
    top = V(lx, ly, H)
    return g, top


def _crown_bulb(q, top, r, seg):
    prof = [(r * 0.95, -0.05), (r * 1.25, 0.25), (r * 1.15, 0.55), (r * 0.7, 0.80), (0.0, 0.92)]
    if q.l2:
        prof = [(r, -0.05), (r * 1.2, 0.4), (0.0, 0.85)]
    g = lathe(prof, seg, 'M_Trunk', 'z', tuple(top), uv='cyl', uv_u=2.0, uv_v=0.8)
    return g


def _frond(q, base, az, elev, L, droop, width, segs, rng):
    """Feather frond: rachis curve + two V-angled wings (alpha textured)."""
    d0 = V(math.cos(az) * math.cos(elev), math.sin(az) * math.cos(elev), math.sin(elev))
    pts = []
    for k in range(segs + 1):
        s = k / segs
        p = base + d0 * (L * s)
        p.z -= droop * L * s * s
        pts.append(p)
    g = Geo()
    v_ang = math.radians(rng.uniform(32, 42))
    verts = []
    for k in range(segs + 1):
        s = k / segs
        if k == 0:
            t = (pts[1] - pts[0]).normalized()
        elif k == segs:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[k + 1] - pts[k - 1]).normalized()
        side = t.cross(V(0, 0, 1))
        if side.length < 1e-6:
            side = V(1, 0, 0)
        side.normalize()
        up = side.cross(t).normalized()
        w = width * (0.15 + 0.85 * math.sin(math.pi * min(1.0, s * 1.08) ** 0.75)) if s > 0.08 else width * 0.12
        w *= (1.0 - 0.35 * s)
        left = (side * math.cos(v_ang) + up * math.sin(v_ang)) * w
        right = (-side * math.cos(v_ang) + up * math.sin(v_ang)) * w
        verts.append((pts[k], pts[k] + left, pts[k] + right))
    for k in range(segs):
        s0, s1 = k / segs, (k + 1) / segs
        a, b = verts[k], verts[k + 1]
        # left wing
        g.add([a[0], b[0], b[1], a[1]], [(0, 1, 2, 3)], 'M_Frond',
              ('uv', [(s0, 0.0), (s1, 0.0), (s1, 1.0), (s0, 1.0)]))
        # right wing (mirrored V)
        g.add([b[0], a[0], a[2], b[2]], [(0, 1, 2, 3)], 'M_Frond',
              ('uv', [(s1, 0.0), (s0, 0.0), (s0, 1.0), (s1, 1.0)]))
    return g


def _palm(lod, H, n_fronds, lean, seed, frond_len, dates=False):
    q = Q(lod)
    rng = random.Random(seed)
    rig = Rig()
    sides = q.n(12, 8, 6)
    step = (0.32, 0.75, H / 2)[lod]
    trunk, top = _trunk(q, H, 0.30, 0.22, lean, seed, sides, step)
    g = trunk
    g += _crown_bulb(q, top, 0.26, sides)
    nf = (n_fronds, max(12, int(n_fronds * 0.5)), max(9, n_fronds // 3))[lod]
    segs = (9, 5, 2)[lod]
    golden = math.radians(137.5)
    crown = top + V(0, 0, 0.55)
    for i in range(nf):
        t = i / max(1, nf - 1)
        az = i * golden + rng.uniform(-0.15, 0.15)
        elev = math.radians(68 - 100 * t + rng.uniform(-6, 6))    # young upright -> old drooping
        L = frond_len * (0.78 + 0.30 * math.sin(math.pi * min(1.0, 0.25 + t)) + rng.uniform(-0.06, 0.06))
        droop = 0.22 + 0.50 * t
        base = crown + V(math.cos(az) * 0.12, math.sin(az) * 0.12, -0.35 * t)
        width = 0.78 + 0.12 * rng.random()
        if lod == 2:
            width *= 1.25
        g += _frond(q, base, az, elev, L, droop, width, segs, rng)
    if dates and not q.l2:
        for k in range(4):
            az = TAU * k / 4 + 0.4
            p0 = crown + V(math.cos(az) * 0.25, math.sin(az) * 0.25, -0.45)
            p1 = p0 + V(math.cos(az) * 0.55, math.sin(az) * 0.55, -0.55)
            g += tube([p0, p0.lerp(p1, 0.5) + V(0, 0, 0.12), p1], 0.035, 4, 'M_Trunk')
            blob = lathe([(0.0, -0.35), (0.16, -0.25), (0.20, -0.05), (0.12, 0.10), (0.0, 0.14)], 7 if q.l0 else 5,
                         'M_Trunk', 'z', tuple(p1), uv='cyl', uv_u=1.0, uv_v=1.5)
            g += blob
    rig.node('Body', g, weighted=False, smooth=60.0)
    return rig


def date_palm_a(lod, pose):
    """Young date palm, ~6.5 m."""
    return _palm(lod, 5.2, 30, (0.10, 0.05), 11, 3.5)


def date_palm_b(lod, pose):
    """Mature date palm, ~9.5 m, slight lean."""
    return _palm(lod, 8.2, 34, (0.45, -0.20), 23, 3.9)


def date_palm_c(lod, pose):
    """Tall date palm, ~12.5 m, with date clusters."""
    return _palm(lod, 11.2, 36, (-0.30, 0.35), 37, 4.1, dates=True)


def shrub(lod, pose):
    """Landscaping shrub ~1.5 x 1.3 x 1.0 m: opaque leafy cushion + alpha-masked leaf cards
    around its silhouette (reads from ground and aerial views; ~200 tris, no LODs)."""
    rig = Rig()
    g = Geo()
    rng = random.Random(5)
    H = 0.70
    prof = [(0.0, 0.0), (0.46, 0.03), (0.54, 0.22), (0.48, 0.45), (0.30, 0.64), (0.0, H)]
    core = lathe(prof, 8, 'M_Foliage', 'z')
    core.scale(1.12, 1.0, 1.0)
    fuv = []
    for f in core.f:
        uvs = []
        for k in f:
            p = core.v[k]
            uvs.append((0.02 + 0.46 * (0.5 + 0.5 * p.x / 0.62), 0.02 + 0.46 * (0.5 + 0.5 * p.y / 0.55) + 0.5 * p.z / H))
        fuv.append(('uv', [(min(0.48, u), min(0.98, w)) for (u, w) in uvs]))
    core.fuv = fuv
    g += core

    def card(c, size, yaw, tilt):
        s = size / 2
        q = Geo().add([V(-s, 0, -s), V(s, 0, -s), V(s, 0, s), V(-s, 0, s)], [(0, 1, 2, 3)], 'M_Foliage',
                      ('uv', [(0.5, 0), (1, 0), (1, 1), (0.5, 1)]))
        q.rot('X', tilt)
        q.rot('Z', yaw)
        q.move(*c)
        return q
    # cards tangent to an ellipsoid -> rounded leafy silhouette
    ctr = V(0, 0, 0.42)
    for (el_deg, n, size) in ((-12, 7, 0.78), (22, 7, 0.78), (55, 5, 0.72), (85, 1, 0.75)):
        for k in range(n):
            az = k * TAU / n + rng.uniform(-0.25, 0.25) + el_deg * 0.02
            el = math.radians(el_deg + rng.uniform(-8, 8))
            nrm = V(math.cos(el) * math.cos(az) * 1.15, math.cos(el) * math.sin(az), math.sin(el) * 0.85)
            c = ctr + V(nrm.x * 0.46, nrm.y * 0.46, nrm.z * 0.46)
            g += card(tuple(c), size * rng.uniform(0.9, 1.1), az - math.pi / 2, el)
    rig.node('LOD0', g, weighted=False, smooth=80.0)
    return rig


# ===================================================================== cars
def _car(lod, kind):
    q = Q(lod)
    rig = Rig()
    if kind == 'sedan':
        L, W, H, R, wb = 4.70, 1.82, 1.45, 0.32, 2.78
    else:
        L, W, H, R, wb = 4.80, 1.90, 1.75, 0.36, 2.85
    yf, yr = L / 2, -L / 2
    ya_f, ya_r = wb / 2 + 0.06, -wb / 2 + 0.06
    if kind == 'sedan':
        top = [(yf, 0.42), (yf - 0.04, 0.66), (yf - 0.25, 0.76), (yf - 1.15, 0.86), (yf - 1.85, H - 0.02),
               (yf - 2.00, H), (yr + 1.25, H), (yr + 0.62, 1.02), (yr + 0.12, 0.98), (yr, 0.90), (yr, 0.42)]
        belt = 0.92
    else:
        top = [(yf, 0.48), (yf - 0.05, 0.80), (yf - 0.30, 0.92), (yf - 1.15, 1.00), (yf - 1.85, H - 0.02),
               (yf - 1.98, H), (yr + 0.20, H), (yr + 0.05, H - 0.10), (yr, 1.00), (yr, 0.48)]
        belt = 1.02
    arches = [] if q.l2 else [(ya_f, R, R + 0.04), (ya_r, R, R + 0.04)]
    prof = arch_profile(yr, yf, 0.24, H, arches, q.n(7, 4, 2, lo=2))
    prof = prof[:-2] + top
    body = ProfileBody(q, prof, W, belt, H, tumble=0.16 if kind == 'sedan' else 0.10, bevel=0.08, mat='M_Body',
                       seg2=1)
    if q.l1:
        body.bevel = 0.0
    g = body.shell()
    if not q.l2:
        g += box_minmax(-W / 2 + 0.25, ya_f - 0.35, 0.22, W / 2 - 0.25, ya_f + 0.35, 0.62, 'M_Trim')
        g += box_minmax(-W / 2 + 0.25, ya_r - 0.35, 0.22, W / 2 - 0.25, ya_r + 0.35, 0.62, 'M_Trim')
    # glass
    if kind == 'sedan':
        ws = body.edge_quad(yf - 1.15, 0.86, yf - 1.85, H - 0.02, 0.06, 0.92, 0.10, '+y')
        rg = body.edge_quad(yr + 1.25, H, yr + 0.62, 1.02, 0.08, 0.90, 0.12, '-y')
        side = [(yr + 0.80, belt + 0.04), (yf - 1.20, belt + 0.04), (yf - 1.80, H - 0.07), (yr + 1.22, H - 0.07)]
    else:
        ws = body.edge_quad(yf - 1.15, 1.00, yf - 1.85, H - 0.02, 0.06, 0.92, 0.10, '+y')
        rg = body.edge_quad(yr + 0.05, H - 0.10, yr, 1.00, 0.10, 0.88, 0.12, '-y')
        side = [(yr + 0.22, belt + 0.04), (yf - 1.20, belt + 0.04), (yf - 1.80, H - 0.07), (yr + 0.24, H - 0.07)]
    g += panel(ws, 'M_Glass', offset=0.008)
    g += panel(rg, 'M_Glass', offset=0.008)
    for sx in (-1, 1):
        g += panel(body.side_quad(sx, side), 'M_Glass', offset=0.008)
        if q.l0:
            # B-pillar
            yb = (side[0][0] + side[1][0]) / 2 + 0.15
            g += panel(body.side_quad(sx, [(yb - 0.05, belt + 0.03), (yb + 0.05, belt + 0.03), (yb + 0.05, H - 0.06),
                                           (yb - 0.05, H - 0.06)]), 'M_Trim', offset=0.012)
            g += mirror(body.side(sx, yf - 1.25, belt + 0.10), sx, q, arm=0.07, head=(0.05, 0.10, 0.12), drop=0.0,
                        fwd=0.0, mat='M_Body')
    # bumpers + lights
    g += box_minmax(-W / 2 + 0.04, yf - 0.10, 0.24, W / 2 - 0.04, yf + 0.04, 0.44, 'M_Trim', bevel=q.bev(0.04),
                    seg=q.seg(1, 1))
    g += box_minmax(-W / 2 + 0.04, yr - 0.04, 0.24, W / 2 - 0.04, yr + 0.10, 0.44, 'M_Trim', bevel=q.bev(0.04),
                    seg=q.seg(1, 1))
    if not q.l2:
        zl = top[1][1] - 0.05
        for sx in (-1, 1):
            g += panel(rect('+y', (sx * (W / 2 - 0.25), yf - 0.02, zl), 0.36, 0.10), 'M_Lights', offset=0.01,
                       uv=('pt', *light_uv('cool')))
            g += panel(rect('-y', (sx * (W / 2 - 0.22), yr, top[-2][1] - 0.08 if kind == 'suv' else 0.82), 0.30,
                            0.10), 'M_Lights', offset=0.01, uv=('pt', *light_uv('tail')))
        if q.l0:
            g += panel(rect('+y', (0, yf + 0.002, 0.56), 0.70, 0.14), 'M_Trim', offset=0.004)
    rig.node('Body', g)
    if not q.l2:                      # parked cars: LOD2 is the body silhouette only
        wg = Geo()
        for y in (ya_f, ya_r):
            for sx in (-1, 1):
                wg += wheel((sx * (W / 2 - 0.13), y, R), R, 0.22, q, side=sx, rim=0.64, style='car', nuts=0,
                            seg=14, detail=q.lod + 1, seg2=8)
        rig.node('Wheels', wg, axle=True, weighted=False)
    return rig


def car_sedan(lod, pose):
    return _car(lod, 'sedan')


def car_suv(lod, pose):
    return _car(lod, 'suv')
