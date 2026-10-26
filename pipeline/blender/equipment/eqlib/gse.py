"""Ground support equipment (GSE) vehicles.

Every builder has the signature build(lod, pose) -> Rig and models in the asset frame:
origin on the ground at the centre of the footprint, front = +Y, up = +Z, metres.
Nodes per LOD: Body (static), Wheels (_AXLE attribute), optional Lift (morph targets).
`pose` holds morph target weights (e.g. {'Raise': 1.0}); geometry topology never depends
on pose, only vertex positions of morph nodes do.
"""
import math
import random

from mathutils import Matrix, Vector

from .geo import (TAU, Geo, V, bezier_path, box, box_minmax, cylinder, lathe, panel, poly, prism,
                  quad, quad_uv, rail, round_path, sag_path, sphere, strip, tube)
from .parts import (Cab, ProfileBody, Q, beacon, beam, blue_uv, chassis, decal, decal_region, hatch, marker,
                    seams, skirt,
                    decal_strip_side, extinguisher, fuel_tank, grille, guard_rail, handle, hazard_box,
                    hazard_panel, hose_reel, ladder, lamp, lens, lightbar, louvre, mirror, mudguard, outline,
                    rect, red_mat_geo, red_uv, rod, round_lamp, scissor, seat, stair_flight, steering,
                    tail_lights, wheel, worklight)
from .scene import Rig
from .shapes import arch_profile, chamfer_poly, rounded_rect, segments_outside
from .textures import DECAL, light_uv


def _wheels(q, axles, R, W, track, dual_axles=(), **kw):
    g = Geo()
    for y in axles:
        for sx in (-1, 1):
            g += wheel((sx * track, y, R), R, W, q, side=sx, dual=(y in dual_axles), **kw)
    return g


def _liner(q, x, y0, y1, z0, z1):
    """Dark wheel-well block hiding see-through between arch cut-outs."""
    if q.l2:
        return Geo()
    return box_minmax(-x, y0, z0, x, y1, z1, 'M_Trim')


def _morph(pose, key):
    return float(pose.get(key, 0.0))


def _extinguisher_red(c, q, h=0.55, r=0.075):
    g = extinguisher(c, q, h, r)
    return red_mat_geo(g) if g.f else g


def _chevron_rear(q, y, x0, x1, z0, z1):
    if q.l2:
        return Geo()
    u0, v0, u1, v1 = DECAL['chevron']
    return panel(rect('-y', ((x0 + x1) / 2, y, (z0 + z1) / 2), x1 - x0, z1 - z0), 'M_Decal', offset=0.004,
                 uv=quad_uv(u0, v0, u1, v1))


# =========================================================== pushback tug
def pushback_tug(lod, pose):
    """Towbarless pushback tug (narrow/wide-body), 7.6 x 3.3 x 1.6 m, nose-wheel cradle at the rear."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R, Wt = 0.43, 0.40
    yf, yr, xw = 2.45, -2.45, 1.22
    zb, zd = 0.26, 1.02
    arch_r = R + 0.05
    aseg = q.n(9, 5, 2, lo=2)
    # front section (full width) with front wheel arches
    front_top = [(3.80, 0.82), (3.66, zd), (1.05, zd)]
    prof = arch_profile(1.05, 3.80, zb, zd, [] if q.l2 else [(yf, R, arch_r)], aseg, top=front_top)
    g += prism(prof, 'x', -1.65, 1.65, 'M_Body', bevel=q.bev(0.06, 0.035), seg=q.seg(2, 1))
    # side arms with rear wheel arches
    for sx in (-1, 1):
        prof = arch_profile(-3.80, 1.15, zb, zd, [] if q.l2 else [(yr, R, arch_r)], aseg,
                            top=[(1.15, zd), (-3.62, zd), (-3.80, zd - 0.16)])
        x0, x1 = (0.74, 1.65) if sx > 0 else (-1.65, -0.74)
        g += prism(prof, 'x', x0, x1, 'M_Body', bevel=q.bev(0.05, 0.03), seg=q.seg(2, 1))
    # wheel-well liners
    if not q.l2:
        g += box_minmax(-0.80, yf - 0.55, zb, 0.80, yf + 0.55, zd - 0.12, 'M_Trim')
        for sx in (-1, 1):
            g += box_minmax(sx * 0.80 - 0.04, yr - 0.55, zb, sx * 0.80 + 0.04, yr + 0.55, zd - 0.05, 'M_Trim')
    # lower dark band / skirt + under tray
    g += box_minmax(-1.55, -3.6, 0.14, 1.55, 3.6, zb + 0.02, 'M_Trim') if q.l2 else Geo()
    if not q.l2:
        g += box_minmax(-1.50, 1.2, 0.16, 1.50, 3.55, zb + 0.01, 'M_Trim')
        for sx in (-1, 1):
            g += box_minmax(sx * 0.80 - (0.0 if sx > 0 else 0.75), -3.55, 0.16,
                            sx * 0.80 + (0.75 if sx > 0 else 0.0), 1.2, zb + 0.01, 'M_Trim')
    # cradle: ramp plate, nose-wheel stop, clamp paddles
    if not q.l2:
        g += box_minmax(-0.72, -3.70, 0.03, 0.72, 0.85, 0.09, 'M_Metal')
        if q.l0:
            for k in range(9):
                y = -3.4 + k * 0.45
                g += box_minmax(-0.70, y, 0.09, 0.70, y + 0.05, 0.11, 'M_Trim')
        g += box_minmax(-0.74, 0.55, 0.09, 0.74, 1.15, 0.86, 'M_Trim', bevel=q.bev(0.04), seg=q.seg(2, 1))
        g += box_minmax(-0.62, 0.42, 0.20, 0.62, 0.56, 0.70, 'M_Rubber', bevel=q.bev(0.03), seg=q.seg(2, 1))
        g += hazard_box(-0.74, 1.13, 0.86, 0.74, 1.17, 0.92, q) if q.l0 else Geo()
        for sx in (-1, 1):
            # hydraulic clamp paddles folded along the inner walls
            g += box_minmax(sx * 0.66 - 0.05, -3.45, 0.22, sx * 0.66 + 0.05, -2.10, 0.62, 'M_Hazard',
                            bevel=q.bev(0.02), seg=q.seg(1, 1), uv=('box', 1.25))
            g += cylinder(0.07, 0.42, q.n(10, 6), (sx * 0.62, -2.05, 0.20), 'z', 'M_Metal')
            # arm end caps with hazard striping + tail lights
            g += hazard_panel(rect('-y', (sx * 1.195, -3.80, 0.62), 0.86, 0.38))
            g += lamp('-y', (sx * 1.40, -3.80, 0.88), 0.16, 0.06, q, 'tail', depth=0.03)
            g += lamp('-y', (sx * 0.95, -3.80, 0.88), 0.12, 0.06, q, 'amber', depth=0.03)
            # work lights looking into the cradle
            g += lamp('-x' if sx > 0 else '+x', (sx * 0.74, -1.2, 0.85), 0.16, 0.08, q, 'cool', depth=0.04)
    # operator cab (front left, sunk into the deck): white lower shell, black glasshouse, white roof cap
    cx0, cx1 = -1.58, -0.28
    lower = [(1.45, 0.98), (3.30, 0.98), (3.36, 1.10), (3.34, 1.15), (1.45, 1.15)]
    g += prism(lower, 'x', cx0, cx1, 'M_Body', bevel=q.bev(0.04, 0.02), seg=q.seg(2, 1))
    gh = [(1.50, 1.14), (3.33, 1.14), (3.20, 1.55), (3.10, 1.60), (1.56, 1.60), (1.50, 1.56)]
    g += prism(gh, 'x', cx0 + 0.03, cx1 - 0.03, 'M_Trim', bevel=q.bev(0.03, 0.015), seg=q.seg(2, 1))

    def fy(z):
        return 3.33 + (3.20 - 3.33) * (z - 1.14) / (1.55 - 1.14)
    zl, zh = 1.18, 1.52
    xa, xb = cx1 - 0.10, cx0 + 0.10
    ws = [V(xa, fy(zl), zl), V(xb, fy(zl), zl), V(xb, fy(zh), zh), V(xa, fy(zh), zh)]
    g += panel(ws, 'M_Glass', offset=0.006, frame=0.0)
    for sx, xx in ((-1, cx0 + 0.03), (1, cx1 - 0.03)):
        for (ya, yb) in ((1.62, 2.38), (2.48, 3.12)):
            yb_hi = min(yb, fy(1.52) - 0.08)
            pts = [V(xx, ya, 1.18), V(xx, yb, 1.18), V(xx, yb_hi, 1.52), V(xx, ya, 1.52)]
            if sx < 0:
                pts = [pts[1], pts[0], pts[3], pts[2]]
            g += panel(pts, 'M_Glass', offset=0.006)
    g += panel(rect('-y', ((cx0 + cx1) / 2, 1.50, 1.36), 1.05, 0.30), 'M_Glass', offset=0.006)
    roof = [(1.40, 1.60), (3.16, 1.60), (3.22, 1.63), (3.14, 1.68), (1.46, 1.68), (1.40, 1.65)]
    g += prism(roof, 'x', cx0 - 0.04, cx1 + 0.04, 'M_Body', bevel=q.bev(0.02), seg=q.seg(1, 1))
    g += lightbar(((cx0 + cx1) / 2, 2.05, 1.68), 0.80, q, depth=0.20, h=0.09)
    if not q.l2:
        for sx in (-0.35, 0.35):
            g += lamp('+y', ((cx0 + cx1) / 2 + sx, 3.17, 1.64), 0.14, 0.05, q, 'cool', depth=0.04)
        # cab door outline, step and grab handle on the right side of the cab
        if q.l0:
            g += outline([V(cx1 - 0.0, 1.62, 1.00), V(cx1, 2.40, 1.00), V(cx1, 2.40, 1.58), V(cx1, 1.62, 1.58)],
                         0.010, 'M_Rubber', 0.006)
            g += handle((cx1 + 0.01, 2.50, 1.06), (cx1 + 0.01, 2.50, 1.45), q, normal=(1, 0, 0))
    # two-tone lower band, hatches and side markers
    g += skirt(q, -3.80, 3.80, 1.65, zb, zb + 0.20, [] if q.l2 else [(yf, R, arch_r), (yr, R, arch_r)], ends=False)
    if not q.l2:
        for sx in (-1, 1):
            face = '+x' if sx > 0 else '-x'
            g += hatch(face, (sx * 1.65, -0.9, 0.72), 0.95, 0.36, q)
            g += hatch(face, (sx * 1.65, 3.15, 0.66), 0.55, 0.30, q)
            g += marker(face, (sx * 1.65, 3.55, 0.52), q)
            g += marker(face, (sx * 1.65, -3.55, 0.52), q)
            g += marker(face, (sx * 1.65, 0.6, 0.52), q, 'tail', 0.06, 0.03)
            # walkway tread plates on the arm tops
            g += panel(rect('+z', (sx * 1.2, -1.2, zd + 0.001), 0.70, 1.8), 'M_Metal', offset=0.002)
    rig_beacon = ((cx0 + cx1) / 2, 2.05, 1.80)
    # engine / battery hood (front right) with louvres
    if not q.l2:
        g += louvre('+z', (0.85, 2.35, zd + 0.002), 1.0, 1.4, q, n=10)
        g += louvre('+x', (1.652, 0.0, 0.66), 1.2, 0.36, q, n=4)
        g += louvre('-x', (-1.652, 0.0, 0.66), 1.2, 0.36, q, n=4)
        g += outline(rect('+z', (0.85, 2.35, zd + 0.003), 1.2, 1.6), 0.012)
    # front: bumper, lamps, tow points
    g += box_minmax(-1.62, 3.78, 0.32, 1.62, 3.98, 0.62, 'M_Rubber', bevel=q.bev(0.04, 0.025), seg=q.seg(2, 1))
    if not q.l2:
        g += hazard_panel(rect('+y', (0, 3.80, 0.72), 3.0, 0.12))
        for sx in (-1, 1):
            g += lamp('+y', (sx * 1.25, 3.80, 0.86), 0.26, 0.10, q, 'warm', depth=0.04)
            g += lamp('+y', (sx * 0.80, 3.80, 0.86), 0.10, 0.08, q, 'amber', depth=0.03)
            if q.l0:
                g += cylinder(0.05, 0.16, 8, (sx * 0.45, 3.98, 0.47), 'y', 'M_Metal')
                g += box_minmax(sx * 1.66, 0.4, 0.42, sx * 1.70, 1.0, 0.46, 'M_Metal')
                g += handle((sx * 1.66, 1.25, 0.55), (sx * 1.66, 1.25, 0.95), q, normal=(sx, 0, 0))
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, (yf, yr), R, Wt, xw, rim=0.55, seg=26, lug=0.035, nuts=8), axle=True,
             weighted=False)
    rig.empty('TOW_HITCH', (0, -0.30, 0.0))
    rig.empty('BEACON', rig_beacon)
    return rig


# =========================================================== baggage tractor
def baggage_tractor(lod, pose):
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R, Wt, track = 0.27, 0.21, 0.56
    yfa, yra = 0.90, -0.92
    hw = 0.68
    arches = [] if q.l2 else [(yfa, R, R + 0.07), (yra, R, R + 0.07)]
    top = [(1.48, 0.86), (1.36, 0.95), (0.42, 0.97), (-1.40, 0.97)]
    prof = arch_profile(-1.42, 1.48, 0.30, 0.97, arches, seg=q.n(8, 4, 2, lo=2), top=top)
    g += prism(prof, 'x', -hw, hw, 'M_Body', bevel=q.bev(0.045, 0.025), seg=q.seg(2, 1))
    # dark lower chassis band
    for (ya_, yb_) in segments_outside(-1.40, 1.46, arches):
        g += box_minmax(-hw + 0.03, ya_, 0.17, hw - 0.03, yb_, 0.31, 'M_Trim', bevel=q.bev(0.02), seg=q.seg(1, 1))
    g += _liner(q, hw - 0.26, yfa - 0.36, yfa + 0.36, 0.17, R + 0.32)
    g += _liner(q, hw - 0.26, yra - 0.36, yra + 0.36, 0.17, R + 0.32)
    # cab greenhouse with black pillars look
    cab_prof = [(-1.05, 0.97), (0.36, 0.97), (0.44, 1.06), (0.31, 1.90), (0.22, 1.99), (-0.98, 1.99),
                (-1.05, 1.92)]
    cab = prism(cab_prof, 'x', -0.63, 0.63, 'M_Body', bevel=q.bev(0.05, 0.03), seg=q.seg(2, 1))
    tumble = lambda x, z: x * (1 - 0.04 * max(0.0, (z - 1.0) / 0.99))
    cab.deform(lambda v: V(tumble(v.x, v.z), v.y, v.z))
    g += cab

    def fy(z):
        return 0.44 + (0.31 - 0.44) * (z - 1.06) / (1.90 - 1.06)
    zl, zh = 1.11, 1.85
    ws = [V(tumble(0.54, zl), fy(zl), zl), V(tumble(-0.54, zl), fy(zl), zl), V(tumble(-0.54, zh), fy(zh), zh),
          V(tumble(0.54, zh), fy(zh), zh)]
    g += panel(ws, 'M_Glass', offset=0.007, frame=0.035 if not q.l2 else 0, frame_mat='M_Rubber')
    for sx in (-1, 1):
        for (ya, yb) in ((-0.22, fy(1.12) - 0.08), (-0.97, -0.32)):
            z0, z1 = 1.10, 1.86
            yb_hi = min(yb, fy(z1) - 0.08)
            pts = [V(tumble(sx * 0.63, z0), ya, z0), V(tumble(sx * 0.63, z0), yb, z0),
                   V(tumble(sx * 0.63, z1), yb_hi, z1), V(tumble(sx * 0.63, z1), ya, z1)]
            if sx < 0:
                pts = [pts[1], pts[0], pts[3], pts[2]]
            g += panel(pts, 'M_Glass', offset=0.007, frame=0.03 if not q.l2 else 0, frame_mat='M_Rubber')
        if q.l0:
            d = [V(tumble(sx * 0.63, 1.0), -0.26, 1.0), V(tumble(sx * 0.63, 1.0), 0.37, 1.0),
                 V(tumble(sx * 0.63, 1.94), 0.25, 1.94), V(tumble(sx * 0.63, 1.94), -0.26, 1.94)]
            if sx < 0:
                d = [d[1], d[0], d[3], d[2]]
            g += outline(d, 0.01)
            g += handle((sx * 0.67, -0.32, 1.08), (sx * 0.67, -0.32, 1.55), q, normal=(sx, 0, 0))
            g += box_minmax(sx * 0.6, -0.05, 1.42, sx * 0.66, 0.05, 1.46, 'M_Trim')
    g += panel(rect('-y', (0, -1.05, 1.50), 1.02, 0.64), 'M_Glass', offset=0.007,
               frame=0.03 if not q.l2 else 0, frame_mat='M_Rubber')
    # roof
    g += box_minmax(-0.67, -1.10, 1.97, 0.67, 0.30, 2.05, 'M_Trim', bevel=q.bev(0.025, 0.015), seg=q.seg(2, 1))
    g += beacon((0.0, -0.55, 2.05), q)
    if not q.l2:
        for sx in (-1, 1):
            g += lamp('-y', (sx * 0.42, -1.11, 2.00), 0.16, 0.06, q, 'cool', depth=0.05)
    # front
    g += box_minmax(-0.72, 1.46, 0.22, 0.72, 1.62, 0.46, 'M_Rubber', bevel=q.bev(0.035, 0.02), seg=q.seg(2, 1))
    if not q.l2:
        g += louvre('+y', (0, 1.481, 0.64), 0.62, 0.15, q, n=5)
        for sx in (-1, 1):
            g += round_lamp((sx * 0.48, 1.48, 0.70), (0, 1, 0), 0.075, q, 'warm')
            if q.l0:
                g += lamp('+y', (sx * 0.48, 1.48, 0.56), 0.10, 0.05, q, 'amber', depth=0.03)
            g += mirror((sx * 0.60, 0.33, 1.55), sx, q, arm=0.16, head=(0.05, 0.14, 0.20), drop=0.0, fwd=0.04)
        if q.l0:
            g += outline(rect('+z', (0, 0.95, 0.972), 1.10, 0.75), 0.01)
            g += box_minmax(-0.08, 1.62, 0.30, 0.08, 1.70, 0.38, 'M_Metal')
    # wheel flares
    for y in (yfa, yra):
        for sx in (-1, 1):
            g += mudguard((sx * (track + 0.02), y, R), R, Wt + 0.05, q, side=sx, a0=0.2, a1=math.pi - 0.2,
                          mat='M_Rubber', thick=0.03, clear=0.06)
    if not q.l2:
        for sx in (-1, 1):
            g += box_minmax(sx * 0.64, -0.52, 0.42, sx * 0.76, 0.30, 0.47, 'M_Metal')
            if q.l0:
                g += lamp('+x' if sx > 0 else '-x', (sx * hw, 1.3, 0.72), 0.06, 0.04, q, 'amber', depth=0.02)
    # rear counterweight block on the rear deck, side hatches and markers
    g += box_minmax(-0.64, -1.40, 0.97, 0.64, -1.07, 1.30, 'M_Trim', bevel=q.bev(0.03), seg=q.seg(2, 1))
    if not q.l2:
        for sx in (-1, 1):
            face = '+x' if sx > 0 else '-x'
            g += hatch(face, (sx * hw, -0.98, 0.66), 0.55, 0.40, q)
            g += marker(face, (sx * hw, 1.30, 0.60), q)
            g += marker(face, (sx * hw, -1.30, 0.60), q, 'tail', 0.06, 0.03)
    # rear: hitch, bumper, lights, hazard
    g += box_minmax(-0.70, -1.52, 0.24, 0.70, -1.40, 0.54, 'M_Trim', bevel=q.bev(0.02), seg=q.seg(1, 1))
    if not q.l2:
        g += hazard_panel(rect('-y', (0, -1.52, 0.39), 1.34, 0.24))
        g += box_minmax(-0.13, -1.68, 0.32, 0.13, -1.52, 0.48, 'M_Metal', bevel=q.bev(0.01), seg=q.seg(1, 1))
        g += cylinder(0.025, 0.32, q.n(8, 6), (0, -1.62, 0.26), 'z', 'M_Metal')
        g += tail_lights(-1.402, 0.80, (-0.50, 0.50), q, w=0.15, h=0.08)
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, (yfa, yra), R, Wt, track, rim=0.55, nuts=5), axle=True, weighted=False)
    rig.empty('TOW_HITCH', (0, -1.62, 0.40))
    rig.empty('BEACON', (0, -0.55, 2.16))
    return rig


# ============================================================== carts
def _drawbar(q, y_axle, y_eye, z_eye, half=0.42, z_axle=0.30):
    g = Geo()
    eye = V(0, y_eye, z_eye)
    rn = 8 if q.l0 else 4
    for sx in (-1, 1):
        g += tube([V(sx * half, y_axle, z_axle), V(sx * 0.10, y_eye - 0.35, z_eye), eye - V(0, 0.12, 0)],
                  0.03, rn, 'M_Trim')
    if not q.l2:
        ring = [eye + V(0.09 * math.cos(TAU * i / 12), 0.09 * math.sin(TAU * i / 12) + 0.02, 0) for i in range(12)]
        g += tube(ring + [ring[0]], 0.02, 6 if q.l0 else 4, 'M_Metal', cap=False)
        if q.l0:
            g += tube([eye - V(0, 0.30, 0), eye - V(0, 0.30, -0.25), eye - V(0, 0.42, -0.30)], 0.016, 6, 'M_Hazard')
    return g


def _hitch(q, y, z):
    if q.l2:
        return Geo()
    g = box_minmax(-0.10, y - 0.16, z - 0.07, 0.10, y, z + 0.07, 'M_Metal')
    g += cylinder(0.02, 0.24, 6, (0, y - 0.09, z - 0.10), 'z', 'M_Metal')
    return g


def _suitcase(c, size, yaw, col, q, rng):
    sx, sy, sz = size
    g = box(sx, sy, sz, (0, 0, sz / 2), 'M_Luggage', bevel=q.bev(min(0.04, min(size) * 0.25)),
            seg=q.seg(2, 1), uv=('pt', *col))
    if q.l0:
        # carry handle on top + corner wheels band
        g += tube([V(-0.08, 0, sz), V(-0.08, 0, sz + 0.04), V(0.08, 0, sz + 0.04), V(0.08, 0, sz)], 0.012, 4,
                  'M_Trim', cap=False)
        g += box(sx * 1.002, sy * 1.002, 0.02, (0, 0, sz * 0.5), 'M_Trim')
    g.rot('Z', yaw)
    g.move(*c)
    return g


def _duffel(c, L, r, yaw, col, q):
    seg = q.n(10, 5, 4)
    prof = [(0.0, -L / 2), (r * 0.7, -L / 2 + 0.02), (r, -L / 2 + r * 0.5), (r, L / 2 - r * 0.5),
            (r * 0.7, L / 2 - 0.02), (0.0, L / 2)]
    g = lathe(prof, seg, 'M_Luggage', 'y', uv=('pt', *col))
    g.scale(1.0, 1.0, 0.75)
    g.rot('Z', yaw)
    g.move(c[0], c[1], c[2] + r * 0.75)
    return g


def _luggage_load(q, x0, x1, y0, y1, z, seed, layers=2):
    from .textures import palette_uv
    rng = random.Random(seed)
    g = Geo()
    sizes = [(0.72, 0.48, 0.28), (0.64, 0.42, 0.25), (0.55, 0.38, 0.22), (0.78, 0.52, 0.30)]
    for layer in range(layers):
        y = y0 + 0.02
        zz = z + layer * 0.31
        while y < y1 - 0.40:
            x = x0 + 0.02
            row_d = 0.0
            while x < x1 - 0.35:
                if rng.random() < 0.18 and layer == layers - 1:
                    x += 0.3
                    continue
                col = palette_uv(rng.randrange(16))
                if rng.random() < 0.22:
                    L, r = rng.uniform(0.50, 0.65), rng.uniform(0.14, 0.17)
                    if x + 2 * r > x1:
                        break
                    g += _duffel((x + r, y + L / 2, zz), L, r, 0.0 + rng.uniform(-0.1, 0.1), col, q)
                    x += 2 * r + 0.03
                    row_d = max(row_d, L)
                else:
                    sx, sy, sz = rng.choice(sizes)
                    if rng.random() < 0.5:
                        sx, sy = sy, sx
                    if x + sx > x1 or y + sy > y1:
                        x += 0.2
                        continue
                    g += _suitcase((x + sx / 2, y + sy / 2, zz), (sx, sy, sz), rng.uniform(-0.06, 0.06), col, q, rng)
                    x += sx + 0.03
                    row_d = max(row_d, sy)
            y += max(row_d, 0.35) + 0.04
    return g


def baggage_cart(lod, pose):
    """Covered baggage cart (open sides), 3.2 m body + drawbar, with luggage."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R, Wt, track = 0.21, 0.13, 0.60
    ya, yb = 1.05, -1.05
    L2, hw = 1.60, 0.77
    zdeck = 0.56
    # frame + deck
    g += box_minmax(-hw, -L2, zdeck - 0.06, hw, L2, zdeck, 'M_Metal', bevel=q.bev(0.012), seg=q.seg(1, 1))
    g += box_minmax(-hw - 0.02, -L2 - 0.02, zdeck - 0.16, hw + 0.02, L2 + 0.02, zdeck - 0.06, 'M_Body',
                    bevel=q.bev(0.015), seg=q.seg(1, 1))
    if not q.l2:
        for sx in (-1, 1):
            g += box_minmax(sx * 0.45 - 0.04, -L2, zdeck - 0.30, sx * 0.45 + 0.04, L2, zdeck - 0.16, 'M_Trim')
        for y in (ya, yb):
            g += box_minmax(-0.66, y - 0.05, R - 0.03, 0.66, y + 0.05, R + 0.03, 'M_Trim')
            if q.l0:
                g += cylinder(0.18, 0.06, 12, (0, y, zdeck - 0.36), 'z', 'M_Trim')
    # posts, roof, side rails, front bulkhead
    zr = 2.02
    for sx in (-1, 1):
        for sy in (-1, 1):
            g += box_minmax(sx * (hw - 0.03) - 0.03, sy * (L2 - 0.03) - 0.03, zdeck, sx * (hw - 0.03) + 0.03,
                            sy * (L2 - 0.03) + 0.03, zr, 'M_Body')
        if not q.l2:
            for z in (0.95, 1.40):
                g += box_minmax(sx * (hw - 0.03) - 0.02, -L2, z - 0.025, sx * (hw - 0.03) + 0.02, L2, z + 0.025,
                                'M_Body')
            # rolled-up curtains under the roof edge
            g += cylinder(0.075, 2 * L2 - 0.1, q.n(10, 6), (sx * (hw - 0.02), -L2 + 0.05, zr - 0.10), 'y', 'M_Trim')
    seg_r = q.n(6, 3, 1, lo=1)
    roof_pts = []
    for k in range(seg_r + 1):
        t = k / seg_r
        x = -hw - 0.04 + (2 * hw + 0.08) * t
        z = zr + 0.10 * math.sin(math.pi * t)
        roof_pts.append((x, z))
    roof_prof = roof_pts + [(p[0], p[1] + 0.035) for p in reversed(roof_pts)]
    g += prism(roof_prof, 'y', -L2 - 0.04, L2 + 0.04, 'M_Body', bevel=q.bev(0.01), seg=q.seg(1, 1), min_angle=0.6)
    # front bulkhead (mesh panel) + rear bar
    g += box_minmax(-hw, L2 - 0.03, zdeck, hw, L2, 1.55, 'M_Body')
    if not q.l2:
        g += box_minmax(-hw, -L2, 1.05, hw, -L2 + 0.04, 1.10, 'M_Body')
        g += tail_lights(-L2 - 0.005, zdeck - 0.10, (-0.62, 0.62), q, w=0.10, h=0.05)
        g += hazard_panel(rect('+y', (0, L2 + 0.002, 0.48), 1.50, 0.12))
        g += hazard_panel(rect('-y', (0, -L2 - 0.022, 0.48), 1.50, 0.12))
    # luggage
    if not q.l2:
        g += _luggage_load(q, -hw + 0.06, hw - 0.06, -L2 + 0.08, L2 - 0.10, zdeck, seed=7 + lod * 0, layers=2)
    else:
        g += box_minmax(-hw + 0.08, -L2 + 0.1, zdeck, hw - 0.08, L2 - 0.1, zdeck + 0.55, 'M_Luggage',
                        uv=('pt', 0.375, 0.125))
    g += _drawbar(q, ya, L2 + 1.25, 0.42)
    g += _hitch(q, -L2, 0.42)
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, (ya, yb), R, Wt, track, rim=0.55, style='solid', nuts=0), axle=True,
             weighted=False)
    rig.empty('TOW_EYE', (0, L2 + 1.25, 0.42))
    rig.empty('TOW_HITCH', (0, -L2 - 0.09, 0.42))
    return rig


def _ld3(q):
    """LD3 (AKE) container on its own frame, base centred at the origin."""
    g = Geo()
    prof = [(-0.78, 0.0), (0.78, 0.0), (0.78, 0.18), (1.23, 0.80), (1.23, 1.63), (-0.78, 1.63)]
    shell = prism(prof, 'y', -0.765, 0.765, 'M_Metal', bevel=q.bev(0.03, 0.02), seg=q.seg(2, 1))
    g += shell
    if not q.l2:
        # corner extrusions / base rail
        g += box_minmax(-0.80, -0.78, 0.0, 0.80, 0.78, 0.06, 'M_Trim')
        if q.l0:
            for z in (0.55, 1.10):
                g += box_minmax(-0.795, -0.70, z - 0.02, -0.785, 0.70, z + 0.02, 'M_Metal')
            for y in (-0.38, 0.0, 0.38):
                g += beam(V(0.79, y, 0.20), V(1.24, y, 0.81), 0.03, 0.02, 'M_Metal', up=(1, 0, 0))
        # curtain door on -Y (front panel area minus the contour)
        g += panel(rect('-y', (0.0, -0.767, 0.825), 1.40, 1.45), 'M_Body', offset=0.003)
        if q.l0:
            for z in (0.45, 0.85, 1.25):
                g += box_minmax(-0.72, -0.78, z - 0.02, 0.72, -0.765, z + 0.02, 'M_Trim')
            # ID plate
            g += panel(rect('-y', (-0.45, -0.772, 1.45), 0.30, 0.10), 'M_Decal', offset=0.002,
                       uv=('pt', 0.02, 0.98))
    return g


def uld_dolly(lod, pose):
    """ULD dolly (roller deck, drawbar) carrying an LD3 container."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R, Wt, track = 0.19, 0.12, 0.62
    ya, yb = 0.62, -0.62
    hw, L2, zd = 0.90, 0.88, 0.50
    g += box_minmax(-hw, -L2, zd - 0.14, hw, L2, zd - 0.03, 'M_Body', bevel=q.bev(0.015), seg=q.seg(1, 1))
    if not q.l2:
        for sx in (-1, 1):
            g += box_minmax(sx * 0.40 - 0.04, -L2, zd - 0.26, sx * 0.40 + 0.04, L2, zd - 0.14, 'M_Trim')
        for y in (ya, yb):
            g += box_minmax(-0.66, y - 0.05, R - 0.03, 0.66, y + 0.05, R + 0.03, 'M_Trim')
        # roller bed
        n = 11 if q.l0 else 5
        for k in range(n):
            y = -L2 + 0.08 + (2 * L2 - 0.16) * k / (n - 1)
            g += cylinder(0.032, 2 * hw - 0.16, q.n(8, 4, lo=4), (-hw + 0.08, y, zd), 'x', 'M_Metal')
        # side / end stops
        for sx in (-1, 1):
            for sy in (-1, 1):
                g += box_minmax(sx * hw - 0.05 * (sx > 0), sy * L2 - 0.05 * (sy > 0), zd - 0.03,
                                sx * hw + 0.05 * (sx < 0), sy * L2 + 0.05 * (sy < 0), zd + 0.14, 'M_Hazard',
                                uv=('box', 1.25))
        g += hazard_panel(rect('+y', (0, L2 + 0.002, zd - 0.09), 1.7, 0.10))
        g += tail_lights(-L2 - 0.003, zd - 0.09, (-0.75, 0.75), q, w=0.08, h=0.05)
    else:
        g += box_minmax(-hw + 0.05, -L2 + 0.05, zd - 0.03, hw - 0.05, L2 - 0.05, zd + 0.03, 'M_Metal')
    c = _ld3(q)
    c.move(0, 0, zd + 0.035)
    g += c
    g += _drawbar(q, ya, L2 + 1.25, 0.40, half=0.40, z_axle=R)
    g += _hitch(q, -L2, 0.40)
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, (ya, yb), R, Wt, track, rim=0.55, style='solid', nuts=0), axle=True,
             weighted=False)
    rig.empty('TOW_EYE', (0, L2 + 1.25, 0.40))
    rig.empty('TOW_HITCH', (0, -L2 - 0.09, 0.40))
    return rig


# =============================================================== belt loader
def belt_loader(lod, pose):
    """Self-propelled conveyor belt loader; Lift morph 'Raise' lifts the belt front 2.2 -> 4.0 m."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R, Wt, track = 0.31, 0.21, 0.80
    yf, yr = 2.55, -2.45
    hw = 0.98
    # chassis body
    arches = [] if q.l2 else [(yf, R, R + 0.07), (yr, R, R + 0.07)]
    prof = arch_profile(-3.55, 3.45, 0.30, 0.92, arches, q.n(8, 4, 2, lo=2),
                        top=[(3.45, 0.80), (3.32, 0.92), (-3.40, 0.92), (-3.55, 0.82)])
    g += prism(prof, 'x', -hw, hw, 'M_Body', bevel=q.bev(0.04, 0.025), seg=q.seg(2, 1))
    g += _liner(q, hw - 0.30, yf - 0.40, yf + 0.40, 0.30, 0.70)
    g += _liner(q, hw - 0.30, yr - 0.40, yr + 0.40, 0.30, 0.70)
    g += box_minmax(-hw + 0.05, -3.4, 0.18, hw - 0.05, 3.3, 0.31, 'M_Trim')
    # front and rear bumpers
    g += box_minmax(-hw, 3.43, 0.30, hw, 3.58, 0.55, 'M_Rubber', bevel=q.bev(0.03), seg=q.seg(2, 1))
    g += box_minmax(-hw, -3.70, 0.30, hw, -3.53, 0.55, 'M_Rubber', bevel=q.bev(0.03), seg=q.seg(2, 1))
    if not q.l2:
        g += hazard_panel(rect('+y', (0, 3.452, 0.70), 1.7, 0.16))
        for sx in (-1, 1):
            g += round_lamp((sx * 0.72, 3.45, 0.70), (0, 1, 0), 0.07, q, 'warm')
            g += tail_lights(-3.552, 0.70, (sx * 0.72,), q, w=0.12, h=0.07)
            g += mudguard((sx * (track + 0.02), yf, R), R, Wt + 0.05, q, side=sx, a0=0.25, a1=math.pi - 0.25,
                          thick=0.025, clear=0.055)
            g += mudguard((sx * (track + 0.02), yr, R), R, Wt + 0.05, q, side=sx, a0=0.25, a1=math.pi - 0.25,
                          thick=0.025, clear=0.055)
    # driver station (left, mid): seat, wheel, dash, canopy
    dx = -0.62
    if not q.l2:
        g += box_minmax(-hw, -0.75, 0.92, -0.25, 0.55, 1.02, 'M_Trim')
        g += seat((dx, -0.30, 0.95), q, w=0.48, d=0.45, h=0.42, back=0.50)
        g += box_minmax(-hw + 0.05, 0.30, 0.95, -0.30, 0.55, 1.30, 'M_Trim', bevel=q.bev(0.03), seg=q.seg(2, 1))
        g += steering((dx, 0.18, 1.55), q, r=0.17, tilt=0.9)
        for (px, py) in ((-hw + 0.04, -0.72), (-hw + 0.04, 0.52), (-0.30, -0.72), (-0.30, 0.52)):
            g += box_minmax(px - 0.02, py - 0.02, 1.02, px + 0.02, py + 0.02, 2.12, 'M_Metal')
    g += box_minmax(-hw - 0.03, -0.80, 2.10, -0.24, 0.62, 2.15, 'M_Trim', bevel=q.bev(0.02), seg=q.seg(1, 1))
    g += beacon((-0.62, -0.10, 2.15), q)
    if not q.l2:
        # small windscreen only (open sides), dashboard and controls
        g += panel(rect('+y', (dx, 0.53, 1.78), 0.58, 0.40), 'M_Glass', offset=0.004, frame=0.02,
                   frame_mat='M_Rubber')
        g += lamp('+y', (-0.80, 0.63, 2.05), 0.12, 0.06, q, 'cool', depth=0.04)
        g += marker('-x', (-hw, 2.9, 0.75), q)
        g += marker('-x', (-hw, -2.9, 0.75), q)
        g += marker('+x', (hw, 2.9, 0.75), q)
        g += marker('+x', (hw, -2.9, 0.75), q)
        g += hatch('+x', (hw, 0.6, 0.62), 1.2, 0.42, q)
        g += hatch('-x', (-hw, -1.5, 0.62), 1.2, 0.42, q)
    g += skirt(q, -3.55, 3.45, hw, 0.30, 0.42, arches)
    # hydraulic strut bases on chassis (static)
    for y in (-0.6, 1.7):
        g += box_minmax(-0.10 + 0.25, y - 0.12, 0.92, 0.10 + 0.25, y + 0.12, 1.05, 'M_Trim')
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, (yf, yr), R, Wt, track, rim=0.55, nuts=5), axle=True, weighted=False)
    # ---- conveyor boom (Lift, morph Raise)
    t = _morph(pose, 'Raise')
    piv = V(0.25, -3.95, 0.62)
    front_z = 2.20 + (4.00 - 2.20) * t
    Lb = 7.9
    ang = math.asin((front_z - piv.z) / Lb)
    dirv = V(0, math.cos(ang), math.sin(ang))
    up = V(0, -math.sin(ang), math.cos(ang))
    M = Matrix((V(1, 0, 0), dirv, up)).transposed().to_4x4()
    boom = Geo()
    bw = 0.86
    boom += box_minmax(-bw / 2, 0.0, -0.20, -bw / 2 + 0.08, Lb, 0.06, 'M_Body', bevel=q.bev(0.015), seg=q.seg(1, 1))
    boom += box_minmax(bw / 2 - 0.08, 0.0, -0.20, bw / 2, Lb, 0.06, 'M_Body', bevel=q.bev(0.015), seg=q.seg(1, 1))
    boom += box_minmax(-bw / 2 + 0.08, 0.05, -0.02, bw / 2 - 0.08, Lb - 0.05, 0.02, 'M_Rubber')
    boom += box_minmax(-bw / 2 + 0.06, 0.2, -0.22, bw / 2 - 0.06, Lb - 0.2, -0.16, 'M_Trim')
    if q.l0:
        for k in range(14):
            yy = 0.3 + (Lb - 0.6) * k / 13
            boom += box_minmax(-bw / 2 + 0.10, yy, 0.02, bw / 2 - 0.10, yy + 0.04, 0.045, 'M_Rubber')
    for yy in (0.0, Lb):
        boom += cylinder(0.11, bw - 0.16, q.n(12, 6), (-bw / 2 + 0.08, yy, -0.02), 'x', 'M_Metal')
    if not q.l2:
        # handrails along the upper part (both sides)
        for sx in (-1, 1):
            x = sx * (bw / 2 - 0.03)
            pts = [V(x, Lb * 0.42, 0.06), V(x, Lb * 0.42, 0.95), V(x, Lb - 0.25, 0.95), V(x, Lb - 0.25, 0.06)]
            boom += rail(pts, 0.022, 6 if q.l0 else 4, corner=0.08)
            if q.l0:
                boom += tube([V(x, Lb * 0.42, 0.50), V(x, Lb - 0.25, 0.50)], 0.016, 6, 'M_Metal')
        # front end: bumper pads + hazard + light
        boom += box_minmax(-bw / 2 - 0.04, Lb + 0.05, -0.22, bw / 2 + 0.04, Lb + 0.20, -0.06, 'M_Rubber',
                           bevel=q.bev(0.02), seg=q.seg(1, 1))
        boom += hazard_box(-bw / 2 - 0.005, Lb - 0.9, -0.20, -bw / 2 + 0.005, Lb - 0.02, 0.06, q)
        boom += hazard_box(bw / 2 - 0.005, Lb - 0.9, -0.20, bw / 2 + 0.005, Lb - 0.02, 0.06, q)
        boom += lamp('+y', (0.0, Lb + 0.20, -0.14), 0.18, 0.07, q, 'cool', depth=0.03)
    boom.transform(M)
    boom.move(*piv)
    # struts from chassis to boom
    for (yb_, s) in ((-0.6, 0.38), (1.7, 0.66)):
        top = piv + dirv * (Lb * s) - up * 0.20
        boom += beam(V(0.25, yb_, 1.0), top, 0.10, 0.10, 'M_Metal', up=(1, 0, 0))
        boom += beam(V(0.25, yb_, 1.0), V(0.25, yb_, 1.0).lerp(top, 0.55), 0.14, 0.14, 'M_Trim', up=(1, 0, 0))
    rig.node('Lift', boom, morph=True, weighted=False)
    rig.empty('BELT_TOP', piv + dirv * (Lb + 0.2))
    rig.empty('BEACON', (-0.62, -0.10, 2.30))
    return rig


# ========================================================== truck helpers
def _truck_base(q, g, cab, y_rear, z_rail, R, front_y, rear_ys, track, track_r, dual=True, rail_x=0.43):
    g += cab.build(beacons=0)
    g += chassis(q, y_rear + 0.1, cab.yf - 0.25, z_rail, rail_x=rail_x)
    if not q.l2:
        # rear under-run bar with lights
        g += box_minmax(-1.05, y_rear - 0.02, 0.40, 1.05, y_rear + 0.10, 0.52, 'M_Trim')
        g += tail_lights(y_rear - 0.02, 0.62, (-0.95, 0.95), q, w=0.20, h=0.09)
        # side under-run guards between axles
        for sx in (-1, 1):
            ya = front_y - R - 0.25
            yb = max(rear_ys) + R + 0.25
            if ya - yb > 0.6:
                for z in (0.45, 0.70):
                    g += box_minmax(sx * 1.16, yb, z - 0.03, sx * 1.20, ya, z + 0.03, 'M_Metal')
        # mudguards over rear wheels
        for y in rear_ys:
            for sx in (-1, 1):
                g += mudguard((sx * track_r, y, R), R, 0.62 if dual else 0.32, q, side=sx, a0=0.15,
                              a1=math.pi - 0.15, thick=0.02, clear=0.08)
    return g


# ============================================================ catering truck
def catering_truck(lod, pose):
    """High-loader catering truck: scissor-lift box body (Raise +4.4 m) with front platform (Extend +2.5 m)."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R = 0.47
    cab = Cab(q, W=2.36, D=1.85, H=2.12, yf=4.45, z0=0.98, slope=0.26, mat='M_Body')
    fy_ax, ry_ax = 3.35, -2.35
    _truck_base(q, g, cab, -4.40, 0.98, R, fy_ax, (ry_ax,), 1.00, 0.92)
    g += beacon((0.0, cab.yb + 0.8, cab.zt), q)
    # scissor subframe
    g += box_minmax(-1.05, -4.30, 0.98, 1.05, 2.45, 1.10, 'M_Trim', bevel=q.bev(0.015), seg=q.seg(1, 1))
    if not q.l2:
        # stabiliser legs (stowed) with striped feet
        for sx in (-1, 1):
            for y in (-4.1, 2.2):
                g += box_minmax(sx * 1.05, y - 0.07, 0.55, sx * 1.20, y + 0.07, 1.05, 'M_Trim')
                g += hazard_box(sx * 1.05, y - 0.11, 0.48, sx * 1.22, y + 0.11, 0.55, q)
        g += _extinguisher_red((1.10, 1.9, 1.12), q)
    rig.node('Body', g)
    rig.node('Wheels', _cat_wheels(q, fy_ax, ry_ax, R), axle=True, weighted=False)
    # ---- Lift: box + scissor + platform
    t = _morph(pose, 'Raise')
    e = _morph(pose, 'Extend')
    lift = Geo()
    z0 = 1.42 + 4.40 * t
    by0, by1, bhw = -4.42, 2.05, 1.24
    bh = 2.45
    box_g = Geo()
    box_g += box_minmax(-bhw, by0, z0, bhw, by1, z0 + bh, 'M_Body', bevel=q.bev(0.05, 0.03), seg=q.seg(2, 1))
    box_g += box_minmax(-bhw - 0.02, by0 - 0.02, z0 - 0.14, bhw + 0.02, by1 + 0.02, z0 + 0.02, 'M_Trim',
                        bevel=q.bev(0.015), seg=q.seg(1, 1))
    if not q.l2:
        # corner posts, roof rail, doors
        for sx in (-1, 1):
            for yy in (by0, by1):
                box_g += box_minmax(sx * bhw - 0.04, yy - 0.04, z0, sx * bhw + 0.04, yy + 0.04, z0 + bh, 'M_Metal')
        box_g += box_minmax(-bhw - 0.02, by0, z0 + bh - 0.06, bhw + 0.02, by1, z0 + bh + 0.02, 'M_Metal')
        # roller shutter on the right side and the rear
        sd = rect('+x', (bhw, -1.1, z0 + 1.05), 1.4, 1.9)
        box_g += panel(sd, 'M_Body', offset=0.008)
        box_g += outline(sd, 0.025, 'M_Trim', 0.01)
        if q.l0:
            for k in range(12):
                zz = z0 + 0.12 + k * 0.155
                box_g += box_minmax(bhw + 0.005, -1.78, zz, bhw + 0.012, -0.42, zz + 0.012, 'M_Trim')
        rd = rect('-y', (0, by0, z0 + 1.10), 1.5, 2.0)
        box_g += panel(rd, 'M_Body', offset=0.008)
        box_g += outline(rd, 0.025, 'M_Trim', 0.01)
        # front door (to platform)
        fd = rect('+y', (0, by1, z0 + 1.05), 1.0, 1.95)
        box_g += outline(fd, 0.025, 'M_Trim', 0.006)
        box_g += panel(rect('+y', (0, by1, z0 + 1.55), 0.5, 0.5), 'M_Glass', offset=0.006)
        box_g += beacon((-bhw + 0.25, by1 - 0.25, z0 + bh + 0.02), q, r=0.07, h=0.12)
        box_g += beacon((bhw - 0.25, by1 - 0.25, z0 + bh + 0.02), q, r=0.07, h=0.12)
        for sx in (-1, 1):
            box_g += lamp('+y', (sx * 0.85, by1, z0 + bh - 0.20), 0.18, 0.08, q, 'cool', depth=0.04)
            box_g += lamp('-y', (sx * 1.05, by0, z0 + 0.25), 0.12, 0.07, q, 'tail', depth=0.03)
        box_g += hazard_panel(rect('+y', (0, by1 + 0.022, z0 - 0.06), 2.4, 0.14))
        box_g += hazard_panel(rect('-y', (0, by0 - 0.022, z0 - 0.06), 2.4, 0.14))
    lift += box_g
    # front platform (stowed inside the box floor front, Extend slides it out)
    pe = 2.50 * e
    pl = Geo()
    py0, py1 = 0.80, 2.00
    pl += box_minmax(-1.10, py0, z0 + 0.02, 1.10, py1, z0 + 0.10, 'M_Metal')
    pl += box_minmax(-1.10, py1 - 0.02, z0 - 0.05, 1.10, py1 + 0.12, z0 + 0.10, 'M_Rubber', bevel=q.bev(0.02),
                     seg=q.seg(1, 1))
    if not q.l2:
        for sx in (-1, 1):
            pl += guard_rail([V(sx * 1.06, py0 + 0.1, z0 + 0.10), V(sx * 1.06, py1 - 0.05, z0 + 0.10)], q, h=1.05)
    pl.move(0, pe, 0)
    lift += pl
    # scissor (single stage) from the subframe to the box floor
    lift += scissor(0.80, -3.70, 1.40, 1.12, z0 - 0.14, 1, q, bw=0.10, bh=0.16)
    rig.node('Lift', lift, morph=True, weighted=False)
    rig.empty('PLATFORM_EDGE', (0, py1 + 0.12, 1.42 + 0.10))
    rig.empty('BEACON', (0, cab.yb + 0.8, cab.zt + 0.2))
    return rig


def _cat_wheels(q, fy, ry, R):
    g = Geo()
    for sx in (-1, 1):
        g += wheel((sx * 1.0, fy, R), R, 0.30, q, side=sx, rim=0.56, nuts=8)
        g += wheel((sx * 0.92, ry, R), R, 0.28, q, side=sx, rim=0.56, nuts=8, dual=True)
    return g


# ========================================================== hydrant dispenser
def fuel_hydrant_dispenser(lod, pose):
    """Hydrant dispenser truck: filter vessel, hose reels, inlet hose + coupler, elevating platform."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R = 0.42
    cab = Cab(q, W=2.20, D=1.70, H=2.00, yf=3.95, z0=0.88, slope=0.24)
    fy_ax, ry_ax = 2.95, -1.60
    _truck_base(q, g, cab, -3.95, 0.88, R, fy_ax, (ry_ax,), 0.95, 0.88)
    g += beacon((0.0, cab.yb + 0.75, cab.zt), q)
    # equipment body
    hw = 1.20
    y0, y1 = -3.90, 1.95
    g += box_minmax(-hw, y0, 0.90, hw, y1, 1.02, 'M_Trim')
    # left cabinet (full length) and right cabinet (middle) with roller shutters
    for (x0, x1, ya, yb, face, doors) in ((-hw, -0.15, y0 + 0.05, 1.70, '-x', (-2.75, -0.95, 0.85)),
                                          (0.15, hw, -1.70, 0.62, '+x', (-0.95, 0.05))):
        g += box_minmax(x0, ya, 1.02, x1, yb, 2.05, 'M_Body', bevel=q.bev(0.04, 0.02), seg=q.seg(2, 1))
        if not q.l2:
            xf = x0 if face == '-x' else x1
            for yy in doors:
                wdt = 1.55 if face == '-x' else 0.95
                sd = rect(face, (xf, yy, 1.53), wdt, 0.88)
                g += panel(sd, 'M_Body', offset=0.006)
                g += outline(sd, 0.02, 'M_Trim', 0.009)
                if q.l0:
                    xa, xb = (xf, xf + 0.012) if face == '+x' else (xf - 0.012, xf)
                    for k in range(7):
                        zz = 1.14 + k * 0.115
                        g += box_minmax(xa, yy - wdt / 2 + 0.03, zz, xb, yy + wdt / 2 - 0.03, zz + 0.012, 'M_Trim')
            g += decal(face, (xf, (ya + yb) / 2, 1.88), 0.80, 0.20, 'jet_a1')
    # filter / water separator vessel behind the cab (right) + pipework
    g += lathe([(0.0, 1.02), (0.36, 1.02), (0.38, 1.10), (0.38, 2.20), (0.32, 2.36), (0.12, 2.45), (0.0, 2.45)],
               q.n(18, 10, 8), 'M_Metal', 'z', (0.70, 1.22, 0.0))
    if not q.l2:
        g += cylinder(0.08, 0.20, q.n(10, 6), (0.70, 1.22, 2.45), 'z', 'M_Trim')
        g += tube(round_path([V(0.70, 1.22, 1.30), V(0.70, 0.75, 1.30), V(0.70, 0.62, 1.30)], 0.1, 2), 0.06,
                  q.n(8, 5), 'M_Metal')
        g += _extinguisher_red((1.12, 1.75, 1.03), q)
        g += _extinguisher_red((-1.12, y0 + 0.30, 1.03), q)
        g += decal('+y', (0, cab.yf + 0.165, 0.86), 0.62, 0.15, 'jet_a1')
        g += decal('-y', (0, y0 - 0.04, 0.80), 0.62, 0.15, 'jet_a1')
    # hydrant inlet hose reel (rear right, exposed) + hose looping down to a parked coupler
    reel_c = V(0.66, -2.65, 1.62)
    g += hose_reel(tuple(reel_c), 0.58, 0.62, q, axis='x', hose_r=0.46)
    if not q.l2:
        for yy in (-3.30, -2.00):
            g += box_minmax(0.24, yy - 0.04, 1.02, 0.32, yy + 0.04, 2.25, 'M_Trim')
            g += box_minmax(1.00, yy - 0.04, 1.02, 1.08, yy + 0.04, 2.25, 'M_Trim')
        hose = [reel_c + V(0.35, 0.10, -0.42), V(1.22, -2.30, 1.05), V(1.30, -2.05, 0.62), V(1.30, -2.6, 0.38),
                V(1.27, -3.25, 0.40), V(1.22, -3.62, 0.62), V(1.18, -3.70, 0.86)]
        g += tube(round_path(hose, 0.22, 3 if q.l0 else 1), 0.058, 8 if q.l0 else 5, 'M_Rubber')
        g += cylinder(0.12, 0.26, q.n(12, 6), (1.18, -3.70, 0.86), 'z', 'M_Metal')
        g += box_minmax(1.06, -3.86, 0.70, 1.32, -3.56, 0.86, 'M_Trim')
        g += cylinder(0.09, 0.12, q.n(10, 6), (1.18, -3.70, 1.12), 'z', 'M_Hazard', uv=('box', 1.25))
    # delivery hose reel (rear left) feeding the platform
    g += hose_reel((-0.55, -3.30, 1.48), 0.42, 0.75, q, axis='x', hose_r=0.33)
    # elevating platform (lowered) over the rear with handrails, deadman box, ladder
    pz = 2.30
    g += box_minmax(-1.15, y0 + 0.10, pz - 0.08, 1.15, -1.75, pz, 'M_Metal')
    g += box_minmax(-1.05, y0 + 0.20, 2.05, 1.05, -1.85, pz - 0.08, 'M_Trim')
    if not q.l2:
        g += guard_rail([V(-1.12, -1.78, pz), V(-1.12, y0 + 0.13, pz), V(1.12, y0 + 0.13, pz), V(1.12, -1.78, pz)],
                        q, h=1.0)
        g += ladder(V(-0.95, y0 - 0.05, 0.42), V(-0.95, y0 - 0.05, pz), 0.42, q)
        g += box_minmax(0.70, -2.10, pz, 0.98, -1.86, pz + 1.05, 'M_Trim', bevel=q.bev(0.02), seg=q.seg(1, 1))
        if q.l0:
            g += lamp('-y', (0.84, -2.101, pz + 0.85), 0.10, 0.08, q, 'green', depth=0.02)
            # delivery hose up to a nozzle parked on the rail
            hose2 = [V(-0.55, -3.30 + 0.15, 1.48 + 0.33), V(-0.55, -2.60, 2.15), V(-0.30, -2.30, pz + 0.30),
                     V(0.10, -2.15, pz + 0.85), V(0.30, -1.95, pz + 0.95)]
            g += tube(round_path(hose2, 0.2, 2), 0.035, 6, 'M_Rubber')
            g += cylinder(0.05, 0.22, 8, (0.30, -1.95, pz + 0.95), 'y', 'M_Metal')
    rig.node('Body', g)
    rig.node('Wheels', _disp_wheels(q, fy_ax, ry_ax, R), axle=True, weighted=False)
    rig.empty('BEACON', (0, cab.yb + 0.75, cab.zt + 0.2))
    rig.empty('HYDRANT_COUPLER', (1.18, -0.35, 0.80))
    return rig


def _disp_wheels(q, fy, ry, R):
    g = Geo()
    for sx in (-1, 1):
        g += wheel((sx * 0.95, fy, R), R, 0.27, q, side=sx, rim=0.56, nuts=6)
        g += wheel((sx * 0.86, ry, R), R, 0.26, q, side=sx, rim=0.56, nuts=6, dual=True)
    return g


# ================================================================ fuel tanker
def fuel_tanker(lod, pose):
    """6x4 aviation refueller with elliptical tank, top walkway, rear hose cabinet."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R = 0.52
    cab = Cab(q, W=2.46, D=2.05, H=2.30, yf=5.20, z0=1.05, slope=0.28)
    fy_ax = 4.05
    rear = (-1.95, -3.35)
    _truck_base(q, g, cab, -5.20, 1.05, R, fy_ax, rear, 1.03, 0.94)
    g += beacon((0.0, cab.yb + 0.9, cab.zt), q)
    # tank: elliptical, dished ends
    seg = q.n(28, 14, 8)
    L2 = 3.10
    prof = [(0.0, -L2), (0.62, -L2 + 0.03), (0.86, -L2 + 0.12), (0.97, -L2 + 0.28), (1.0, -L2 + 0.45),
            (1.0, L2 - 0.45), (0.97, L2 - 0.28), (0.86, L2 - 0.12), (0.62, L2 - 0.03), (0.0, L2)]
    if q.l2:
        prof = [(0.0, -L2), (0.9, -L2 + 0.15), (1.0, -L2 + 0.45), (1.0, L2 - 0.45), (0.9, L2 - 0.15), (0.0, L2)]
    tank = lathe(prof, seg, 'M_Body', 'y')
    tank.scale(1.22, 1.0, 0.88)
    tc = V(0, -1.25, 2.18)
    tank.move(*tc)
    g += tank
    if not q.l2:
        # stiffener bands
        for yy in (-2.0, -0.7, 0.6):
            band = lathe([(1.006, -0.05), (1.006, 0.05)], seg, 'M_Trim', 'y')
            band.scale(1.22, 1.0, 0.88)
            band.move(tc.x, tc.y + yy, tc.z)
            g += band
        # saddles to the chassis
        for yy in (-3.5, -1.2, 1.1):
            g += box_minmax(-0.85, yy - 0.12, 1.05, 0.85, yy + 0.12, 1.55, 'M_Trim')
        # top walkway grating + fold-down rails + manlids
        g += box_minmax(-0.40, tc.y - 2.6, tc.z + 0.86, 0.40, tc.y + 2.6, tc.z + 0.90, 'M_Metal')
        for yy in (-1.6, 0.0, 1.6):
            g += cylinder(0.25, 0.08, q.n(14, 8), (0, tc.y + yy, tc.z + 0.86), 'z', 'M_Metal')
            if q.l0:
                g += cylinder(0.18, 0.05, 12, (0, tc.y + yy, tc.z + 0.94), 'z', 'M_Trim')
        for sx in (-1, 1):
            g += guard_rail([V(sx * 0.38, tc.y - 2.5, tc.z + 0.90), V(sx * 0.38, tc.y + 2.5, tc.z + 0.90)], q, h=0.55,
                            post_every=1.25, mid=False)
        # JET A-1 placards and side band decals
        for sx in (-1, 1):
            g += decal('+x' if sx > 0 else '-x', (sx * 1.225, tc.y + 1.3, tc.z + 0.05), 0.95, 0.24, 'jet_a1',
                       offset=0.01)
        g += decal('-y', (0, -5.25, 2.25), 0.62, 0.15, 'jet_a1')
    # rear cabinet with hose reels, meters, platform step
    cy0, cy1 = -5.15, -4.40
    g += box_minmax(-1.22, cy0, 1.05, -0.60, cy1, 2.45, 'M_Body', bevel=q.bev(0.03), seg=q.seg(2, 1))
    g += box_minmax(0.60, cy0, 1.05, 1.22, cy1, 2.45, 'M_Body', bevel=q.bev(0.03), seg=q.seg(2, 1))
    g += box_minmax(-1.22, cy0, 2.40, 1.22, cy1, 2.52, 'M_Body', bevel=q.bev(0.02), seg=q.seg(1, 1))
    g += box_minmax(-0.60, cy1 - 0.08, 1.05, 0.60, cy1, 2.40, 'M_Trim')
    if not q.l2:
        g += hose_reel((0.0, -4.78, 2.02), 0.36, 1.05, q, axis='x', hose_r=0.27)
        g += hose_reel((0.0, -4.78, 1.38), 0.30, 1.05, q, axis='x', hose_r=0.22)
        g += box_minmax(-1.22, cy0 - 0.25, 0.62, 1.22, cy0, 0.68, 'M_Metal')
        g += hazard_panel(rect('-y', (0, cy0 - 0.252, 0.52), 2.30, 0.16))
        g += box_minmax(-1.22, cy0 - 0.25, 0.44, 1.22, cy0 - 0.20, 0.62, 'M_Trim')
        g += ladder(V(0.95, cy0 - 0.03, 0.70), V(0.95, cy0 - 0.03, 3.05), 0.40, q)
        g += _extinguisher_red((-1.0, cy1 + 0.25, 0.40), q)
        g += _extinguisher_red((1.0, cy1 + 0.25, 0.40), q)
    rig.node('Body', g)
    wg = Geo()
    for sx in (-1, 1):
        wg += wheel((sx * 1.03, fy_ax, R), R, 0.32, q, side=sx, rim=0.56, nuts=10)
        for y in rear:
            wg += wheel((sx * 0.94, y, R), R, 0.30, q, side=sx, rim=0.56, nuts=10, dual=True)
    rig.node('Wheels', wg, axle=True, weighted=False)
    rig.empty('BEACON', (0, cab.yb + 0.9, cab.zt + 0.2))
    rig.empty('HOSE_REEL', (0.0, -4.78, 2.02))
    return rig


# ==================================================================== GPU
def gpu_cart(lod, pose):
    """Towable 90 kVA diesel ground power unit with 400 Hz cable."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R, Wt, track = 0.28, 0.18, 0.60
    ya, yb = 0.85, -0.85
    hw, L2 = 0.72, 1.30
    zb, zt = 0.52, 1.55
    g += box_minmax(-0.65, -L2 + 0.05, 0.38, 0.65, L2 - 0.05, zb, 'M_Trim')
    prof = rounded_rect(2 * hw, zt - zb, 0.14 if not q.l2 else 0.0, q.n(3, 2, 0, lo=0), 0.0, (zb + zt) / 2)
    body = prism(prof, 'y', -L2, L2, 'M_Body', bevel=q.bev(0.03), seg=q.seg(1, 1), min_angle=0.7)
    g += body
    if not q.l2:
        # access doors with louvres on both sides
        for sx in (-1, 1):
            face = '+x' if sx > 0 else '-x'
            for yy in (-0.65, 0.65):
                d = rect(face, (sx * hw, yy, 1.02), 1.15, 0.78)
                g += outline(d, 0.015, 'M_Trim', 0.004)
                g += louvre(face, (sx * hw, yy, 1.02), 0.85, 0.40, q, n=8)
                if q.l0:
                    g += box_minmax(sx * hw, yy + 0.45, 1.20, sx * (hw + 0.025), yy + 0.52, 1.24, 'M_Metal')
        # control panel (rear) with window
        g += panel(rect('-y', (0, -L2, 1.08), 0.80, 0.55), 'M_Trim', offset=0.005)
        g += panel(rect('-y', (0, -L2, 1.12), 0.55, 0.32), 'M_Glass', offset=0.009, frame=0.02, frame_mat='M_Metal')
        g += tail_lights(-L2 - 0.002, 0.62, (-0.55, 0.55), q, w=0.12, h=0.06)
        # exhaust + lifting eye + fuel cap
        g += cylinder(0.05, 0.30, q.n(10, 6), (0.40, -0.70, zt - 0.02), 'z', 'M_Metal')
        if q.l0:
            g += tube([V(0.40, -0.70, zt + 0.28), V(0.40, -0.80, zt + 0.33)], 0.05, 8, 'M_Metal')
            ring = [V(0.0, 0.0 + 0.10 * math.cos(TAU * i / 10), zt + 0.12 + 0.10 * math.sin(TAU * i / 10))
                    for i in range(10)]
            g += tube(ring + [ring[0]], 0.018, 5, 'M_Metal', cap=False)
            g += cylinder(0.06, 0.03, 10, (-0.45, 0.8, zt - 0.01), 'z', 'M_Trim')
        # 400 Hz cable coiled on a cradle (front-right) + plug
        g += box_minmax(hw, 0.40, 0.75, hw + 0.18, 1.15, 0.80, 'M_Trim')
        n = 4 if q.l0 else 2
        for k in range(n):
            ring = [V(hw + 0.09 + 0.02 * k, 0.78 + 0.32 * math.cos(TAU * i / 14),
                      1.05 + 0.26 * math.sin(TAU * i / 14)) for i in range(14)]
            g += tube(ring + [ring[0]], 0.028, 6 if q.l0 else 4, 'M_Rubber', cap=False)
        g += tube([V(hw + 0.09, 0.95, 0.80), V(hw + 0.15, 1.20, 0.55), V(hw + 0.10, 1.32, 0.40)], 0.028,
                  6 if q.l0 else 4, 'M_Rubber')
        g += cylinder(0.06, 0.18, q.n(10, 6), (hw + 0.10, 1.32, 0.22), 'z', 'M_Hazard', uv=('box', 1.25))
        g += hazard_panel(rect('+y', (0, L2 + 0.002, 0.45), 1.3, 0.10))
    g += _drawbar(q, ya, L2 + 1.20, 0.42, half=0.42, z_axle=R)
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, (ya, yb), R, Wt, track, rim=0.55, nuts=5), axle=True, weighted=False)
    rig.empty('TOW_EYE', (0, L2 + 1.20, 0.42))
    rig.empty('CABLE_PLUG', (hw + 0.10, 1.32, 0.22))
    return rig


# ============================================================== stairs truck
def stairs_truck(lod, pose):
    """Self-propelled passenger stairs; Lift morph 'Raise' moves the top platform 3.4 -> 5.8 m."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R = 0.40
    fy_ax, ry_ax = 3.05, -2.70
    # chassis + low half cab (front left)
    g += chassis(q, -4.10, 3.95, 0.78, rail_x=0.50)
    cab = Cab(q, W=1.25, D=1.65, H=1.50, yf=4.30, z0=0.70, slope=0.20, glass_top=0.10, tumble=0.03)
    cg = cab.build(beacons=0, steps=False, marker=False, wipers=q.l0, grille_h=0.25, bumper=False)
    cg.move(-0.55, 0, 0)
    g += cg
    g += box_minmax(-1.22, 4.18, 0.48, 1.22, 4.42, 0.78, 'M_Rubber', bevel=q.bev(0.03), seg=q.seg(2, 1))
    # right-front engine box
    g += box_minmax(0.12, 2.6, 0.78, 1.18, 4.20, 1.45, 'M_Body', bevel=q.bev(0.04), seg=q.seg(2, 1))
    if not q.l2:
        g += louvre('+x', (1.181, 3.4, 1.12), 1.0, 0.40, q, n=5)
        g += round_lamp((0.85, 4.21, 1.10), (0, 1, 0), 0.08, q, 'warm')
        for sx in (-1, 1):
            g += mudguard((sx * 0.98, fy_ax, R), R, 0.30, q, side=sx, a0=0.15, a1=math.pi - 0.15, thick=0.02)
            g += mudguard((sx * 0.98, ry_ax, R), R, 0.30, q, side=sx, a0=0.15, a1=math.pi - 0.15, thick=0.02)
        g += box_minmax(-1.15, -4.15, 0.55, 1.15, -4.02, 0.72, 'M_Trim')
        g += tail_lights(-4.152, 0.64, (-1.0, 1.0), q, w=0.14, h=0.07)
        g += hazard_panel(rect('-y', (0, -4.155, 0.48), 2.2, 0.12))
    # lifting frame base
    g += box_minmax(-0.95, -3.9, 0.78, 0.95, 2.5, 0.92, 'M_Trim')
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, (fy_ax, ry_ax), R, 0.28, 0.98, rim=0.56, nuts=6), axle=True, weighted=False)
    # ---- stair unit (Lift)
    t = _morph(pose, 'Raise')
    ztop = 3.40 + 2.40 * t
    sw = 1.55
    lift = Geo()
    p_top_y0, p_top_y1 = 2.55, 4.15
    bottom = V(0, -3.95 - 0.6 * t, 0.62 + 0.30 * t)
    top_edge = V(0, p_top_y0, ztop)
    n_steps = 18
    lift += stair_flight(bottom, top_edge, sw, q, n_steps=n_steps, rails=(True, True), rail_h=1.0,
                         tread_mat='M_Metal', side_mat='M_Body', riser=True, stringer_h=0.32, n_posts=6)
    # side cheek plates (below the nosing line) + under-frame truss
    for sx in (-1, 1):
        a = bottom + V(sx * (sw / 2 + 0.06), 0, -0.16)
        b = top_edge + V(sx * (sw / 2 + 0.06), 0, -0.16)
        lift += beam(a, b, 0.05, 0.26, 'M_Body', up=(0, 0, 1))
        a2 = bottom + V(sx * (sw / 2 - 0.10), 0.35, -0.75)
        b2 = top_edge + V(sx * (sw / 2 - 0.10), -0.40, -0.75)
        lift += beam(a2, b2, 0.10, 0.14, 'M_Trim', up=(0, 0, 1))
        if not q.l2:
            nb = 5
            for k in range(nb):
                p = a.lerp(b, (k + 0.5) / nb) + V(-sx * 0.16, 0, -0.10)
                p2 = a2.lerp(b2, (k + 1.0) / nb)
                lift += beam(p, p2, 0.06, 0.06, 'M_Trim', up=(1, 0, 0))
    # bottom landing step
    lift += box_minmax(-sw / 2, bottom.y - 0.45, bottom.z - 0.30, sw / 2, bottom.y + 0.02, bottom.z - 0.26, 'M_Metal')
    # top platform with guard rails, bumper and canopy
    lift += box_minmax(-sw / 2 - 0.08, p_top_y0, ztop - 0.16, sw / 2 + 0.08, p_top_y1, ztop, 'M_Metal')
    lift += box_minmax(-sw / 2 - 0.08, p_top_y0, ztop - 0.36, sw / 2 + 0.08, p_top_y1, ztop - 0.16, 'M_Body',
                       bevel=q.bev(0.02), seg=q.seg(1, 1))
    lift += box_minmax(-sw / 2 - 0.10, p_top_y1, ztop - 0.30, sw / 2 + 0.10, p_top_y1 + 0.14, ztop - 0.02,
                       'M_Rubber', bevel=q.bev(0.03), seg=q.seg(2, 1))
    for sx in (-1, 1):
        lift += guard_rail([V(sx * (sw / 2 + 0.04), p_top_y0, ztop), V(sx * (sw / 2 + 0.04), p_top_y1 - 0.05, ztop)],
                           q, h=1.05)
    # canopy over the platform
    for sx in (-1, 1):
        for yy in (p_top_y0 + 0.05, p_top_y1 - 0.10):
            lift += box_minmax(sx * (sw / 2 + 0.05) - 0.03, yy - 0.03, ztop, sx * (sw / 2 + 0.05) + 0.03, yy + 0.03,
                               ztop + 2.15, 'M_Body')
    lift += box_minmax(-sw / 2 - 0.15, p_top_y0 - 0.10, ztop + 2.15, sw / 2 + 0.15, p_top_y1 + 0.05, ztop + 2.22,
                       'M_Body', bevel=q.bev(0.02), seg=q.seg(1, 1))
    lift += beacon((0, (p_top_y0 + p_top_y1) / 2, ztop + 2.22), q)
    if not q.l2:
        lift += hazard_panel(rect('+y', (0, p_top_y1 + 0.142, ztop - 0.16), sw + 0.2, 0.22))
        for sx in (-1, 1):
            lift += lamp('+y', (sx * 0.6, p_top_y1 + 0.02, ztop + 2.12), 0.14, 0.06, q, 'cool', depth=0.04)
    # hydraulic lifting struts (front) from the frame to under the platform
    for sx in (-1, 1):
        a = V(sx * 0.70, 2.0, 0.95)
        b = V(sx * 0.70, p_top_y0 + 0.4, ztop - 0.36)
        lift += beam(a, a.lerp(b, 0.6), 0.16, 0.16, 'M_Trim', up=(1, 0, 0))
        lift += beam(a, b, 0.09, 0.09, 'M_Metal', up=(1, 0, 0))
        # rear pivot links
        c = V(sx * 0.70, -3.6, 0.92)
        d = bottom.lerp(top_edge, 0.12) + V(sx * 0.70, 0, -0.30)
        lift += beam(c, d, 0.10, 0.12, 'M_Trim', up=(1, 0, 0))
    rig.node('Lift', lift, morph=True, weighted=False)
    rig.empty('PLATFORM_EDGE', (0, p_top_y1 + 0.14, 3.40))
    rig.empty('BEACON', (0, (p_top_y0 + p_top_y1) / 2, 3.40 + 2.40))
    return rig


# ================================================================== ambulift
def ambulift(lod, pose):
    """PRM high-lift vehicle: windowed cabin on a scissor lift (Raise +6.4 m), front platform (Extend)."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R = 0.47
    cab = Cab(q, W=2.36, D=1.90, H=2.15, yf=4.62, z0=0.98, slope=0.26)
    fy_ax, ry_ax = 3.50, -2.30
    _truck_base(q, g, cab, -4.55, 0.98, R, fy_ax, (ry_ax,), 1.00, 0.92)
    g += beacon((0.0, cab.yb + 0.8, cab.zt), q)
    g += box_minmax(-1.05, -4.45, 0.98, 1.05, 2.55, 1.10, 'M_Trim')
    if not q.l2:
        for sx in (-1, 1):
            for y in (-4.25, 2.35):
                g += box_minmax(sx * 1.05, y - 0.07, 0.55, sx * 1.20, y + 0.07, 1.05, 'M_Trim')
                g += hazard_box(sx * 1.05, y - 0.11, 0.48, sx * 1.22, y + 0.11, 0.55, q)
        g += decal('+y', (0.0, cab.yf + 0.17, cab.z0 + 0.62), 0.22, 0.22, 'wheelchair')
    rig.node('Body', g)
    rig.node('Wheels', _cat_wheels(q, fy_ax, ry_ax, R), axle=True, weighted=False)
    t = _morph(pose, 'Raise')
    e = _morph(pose, 'Extend')
    lift = Geo()
    z0 = 1.45 + 6.40 * t
    by0, by1, bhw, bh = -4.55, 2.15, 1.26, 2.40
    lift += box_minmax(-bhw, by0, z0, bhw, by1, z0 + bh, 'M_Body', bevel=q.bev(0.06, 0.035), seg=q.seg(2, 1))
    lift += box_minmax(-bhw - 0.02, by0 - 0.02, z0 - 0.14, bhw + 0.02, by1 + 0.02, z0 + 0.02, 'M_Trim',
                       bevel=q.bev(0.015), seg=q.seg(1, 1))
    if not q.l2:
        # windows along both sides, accessibility decals, doors
        for sx in (-1, 1):
            face = '+x' if sx > 0 else '-x'
            for yy in (-3.35, -1.85, -0.35):
                lift += panel(rect(face, (sx * bhw, yy, z0 + 1.45), 1.15, 0.70), 'M_Glass', offset=0.008,
                              frame=0.035, frame_mat='M_Rubber')
            lift += decal(face, (sx * bhw, 1.10, z0 + 1.30), 0.62, 0.62, 'wheelchair', offset=0.008)
            lift += box_minmax(sx * bhw - 0.01 * sx, by0, z0 + 0.55, sx * (bhw + 0.012), by1, z0 + 0.62, 'M_Trim')
        rd = rect('-y', (0, by0, z0 + 1.10), 1.30, 2.05)
        lift += outline(rd, 0.03, 'M_Trim', 0.008)
        lift += panel(rect('-y', (0, by0, z0 + 1.55), 0.80, 0.55), 'M_Glass', offset=0.008)
        lift += decal('-y', (0, by0, z0 + 0.55), 0.40, 0.40, 'wheelchair', offset=0.009)
        fd = rect('+y', (0, by1, z0 + 1.05), 1.10, 2.00)
        lift += outline(fd, 0.03, 'M_Trim', 0.006)
        lift += panel(rect('+y', (0, by1, z0 + 1.55), 0.70, 0.55), 'M_Glass', offset=0.008)
        for sx in (-1, 1):
            lift += beacon((sx * (bhw - 0.25), by1 - 0.25, z0 + bh), q, r=0.07, h=0.12)
            lift += lamp('+y', (sx * 0.85, by1, z0 + bh - 0.18), 0.18, 0.08, q, 'cool', depth=0.04)
            lift += lamp('-y', (sx * 1.05, by0, z0 + 0.25), 0.12, 0.07, q, 'tail', depth=0.03)
        lift += hazard_panel(rect('+y', (0, by1 + 0.022, z0 - 0.06), 2.4, 0.14))
        # rear tail-lift platform (folded up) with hinge
        lift += box_minmax(-0.85, by0 - 0.14, z0 - 0.05, 0.85, by0 - 0.04, z0 + 1.35, 'M_Metal')
        lift += hazard_panel(rect('-y', (0, by0 - 0.14, z0 + 1.30), 1.70, 0.08))
        # roof AC unit
        lift += box_minmax(-0.70, -2.4, z0 + bh, 0.70, -0.9, z0 + bh + 0.28, 'M_Body', bevel=q.bev(0.05), seg=q.seg(2, 1))
        if q.l0:
            lift += louvre('+z', (0, -1.65, z0 + bh + 0.281), 1.1, 1.1, q, n=6)
    # front platform with handrails (Extend)
    pe = 1.60 * e
    pl = Geo()
    py0, py1 = 1.0, 2.15
    pl += box_minmax(-1.15, py0, z0 + 0.0, 1.15, py1, z0 + 0.08, 'M_Metal')
    pl += box_minmax(-1.15, py1 - 0.02, z0 - 0.06, 1.15, py1 + 0.12, z0 + 0.08, 'M_Rubber', bevel=q.bev(0.02),
                     seg=q.seg(1, 1))
    if not q.l2:
        for sx in (-1, 1):
            pl += guard_rail([V(sx * 1.10, py0 + 0.1, z0 + 0.08), V(sx * 1.10, py1 - 0.05, z0 + 0.08)], q, h=1.05)
    pl.move(0, pe, 0)
    lift += pl
    lift += scissor(0.82, -3.85, 1.45, 1.12, z0 - 0.14, 1, q, bw=0.11, bh=0.17)
    rig.node('Lift', lift, morph=True, weighted=False)
    rig.empty('PLATFORM_EDGE', (0, py1 + 0.12, 1.45 + 0.08))
    rig.empty('BEACON', (0, cab.yb + 0.8, cab.zt + 0.2))
    return rig


# ============================================================ follow-me car
def _suv_body(q, L=4.85, W=1.90, H=1.86, R=0.39, wb=2.85, hood=0.98, mat='M_Body', kind='suv'):
    """Returns (ProfileBody, Geo) for an SUV-like body centred on the origin."""
    yf, yr = L / 2, -L / 2
    ya_f, ya_r = wb / 2 + 0.05, -wb / 2 + 0.05
    if kind == 'suv':
        top = [(yf, 0.62), (yf - 0.05, 0.88), (yf - 0.30, hood), (yf - 1.20, hood + 0.06), (yf - 1.95, H - 0.02),
               (yf - 2.05, H), (yr + 0.18, H), (yr + 0.04, H - 0.10), (yr, 1.05), (yr, 0.55)]
    elif kind == 'sedan':
        top = [(yf, 0.55), (yf - 0.06, 0.75), (yf - 0.30, 0.82), (yf - 1.20, 0.92), (yf - 1.95, H - 0.02),
               (yf - 2.10, H), (yr + 1.30, H), (yr + 0.70, 1.05), (yr + 0.15, 1.0), (yr, 0.92), (yr, 0.55)]
    else:  # van
        top = [(yf, 0.58), (yf - 0.06, 0.92), (yf - 0.45, 1.10), (yf - 0.95, 1.30), (yf - 1.45, H - 0.08),
               (yf - 1.62, H), (yr + 0.08, H), (yr, H - 0.10), (yr, 0.55)]
    arches = [] if q.l2 else [(ya_f, R, R + 0.05), (ya_r, R, R + 0.05)]
    prof = arch_profile(yr, yf, 0.32, H, arches, q.n(9, 5, 2, lo=2))
    # replace the top with the shaped roof line (from front back to rear)
    prof = prof[:-2] + [p for p in top]
    belt = {'suv': 1.06, 'sedan': 0.93, 'van': 1.12}[kind]
    tumble = {'suv': 0.10, 'sedan': 0.14, 'van': 0.06}[kind]
    body = ProfileBody(q, prof, W, belt, H, tumble=tumble, bevel=0.07, mat=mat)
    return body, ya_f, ya_r


def follow_me_car(lod, pose):
    """Airside FOLLOW ME SUV: yellow, checker band, roof sign, beacons and light bar."""
    q = Q(lod)
    rig = Rig()
    L, W, H, R = 4.85, 1.92, 1.86, 0.39
    body, ya_f, ya_r = _suv_body(q, L, W, H, R, 2.85)
    g = body.shell()
    yf, yr = L / 2, -L / 2
    g += _liner(q, W / 2 - 0.28, ya_f - 0.42, ya_f + 0.42, 0.30, 0.80)
    g += _liner(q, W / 2 - 0.28, ya_r - 0.42, ya_r + 0.42, 0.30, 0.80)
    # windshield + rear glass
    ws = body.edge_quad(yf - 1.20, 1.04, yf - 1.95, H - 0.02, 0.08, 0.90, 0.10, '+y')
    g += panel(ws, 'M_Glass', offset=0.008, frame=0.03 if not q.l2 else 0, frame_mat='M_Rubber')
    rg = body.edge_quad(yr + 0.04, H - 0.10, yr, 1.05, 0.10, 0.85, 0.12, '-y')
    g += panel(rg, 'M_Glass', offset=0.008, frame=0.03 if not q.l2 else 0, frame_mat='M_Rubber')
    # side glass: front door, rear door, quarter
    for sx in (-1, 1):
        g += body.glass_side(sx, [(yf - 2.05, 1.12), (yf - 1.30, 1.12), (yf - 1.88, 1.70), (yf - 2.05, 1.70)])
        g += body.glass_side(sx, [(yf - 3.05, 1.12), (yf - 2.15, 1.12), (yf - 2.15, 1.70), (yf - 3.05, 1.70)])
        g += body.glass_side(sx, [(yr + 0.25, 1.12), (yf - 3.15, 1.12), (yf - 3.15, 1.70), (yr + 0.32, 1.70)])
        if q.l0:
            for (ya, yb) in ((yf - 2.10, yf - 1.20), (yf - 3.10, yf - 2.10)):
                g += outline(body.side_quad(sx, [(ya, 0.40), (yb, 0.40), (yb, 1.74), (ya, 1.74)], 0.0), 0.008,
                             'M_Rubber', 0.004)
                g += box_minmax(sx * (W / 2 * body.k(1.0)) - (0.0 if sx > 0 else 0.02), ya + 0.12, 0.98,
                                sx * (W / 2 * body.k(1.0)) + (0.02 if sx > 0 else 0.0), ya + 0.27, 1.01, 'M_Trim')
        # checker band along the side
        if not q.l2:
            g += decal_strip_side(body, sx, yr + 0.15, yf - 0.20, 0.80, 0.96, 'checker', 4)
        g += mirror(body.side(sx, yf - 1.35, 1.18), sx, q, arm=0.10, head=(0.06, 0.12, 0.17), drop=0.02, fwd=0.02)
    # bumpers, grille, lights
    g += box_minmax(-W / 2 + 0.02, yf - 0.12, 0.30, W / 2 - 0.02, yf + 0.06, 0.62, 'M_Trim', bevel=q.bev(0.05, 0.03),
                    seg=q.seg(2, 1))
    g += box_minmax(-W / 2 + 0.02, yr - 0.06, 0.30, W / 2 - 0.02, yr + 0.12, 0.60, 'M_Trim', bevel=q.bev(0.05, 0.03),
                    seg=q.seg(2, 1))
    if not q.l2:
        g += grille('+y', (0, yf + 0.002, 0.78), 0.80, 0.18, q, slats=3)
        for sx in (-1, 1):
            g += lamp('+y', (sx * 0.70, yf - 0.01, 0.80), 0.32, 0.12, q, 'warm', depth=0.04)
            g += lamp('+y', (sx * 0.62, yf + 0.062, 0.44), 0.14, 0.05, q, 'amber', housing=None)
            g += lamp('-y', (sx * 0.78, yr - 0.002, 0.95), 0.16, 0.24, q, 'tail', depth=0.04)
        if q.l0:
            g += box_minmax(-0.30, yr - 0.02, 0.98, 0.30, yr + 0.02, 1.02, 'M_Metal')
            g += decal('-y', (0, yr - 0.004, 1.15), 0.45, 0.13, 'airside')
    # roof bars + sign box + beacons + light bar
    zr = H
    for sx in (-1, 1):
        g += box_minmax(sx * 0.62 - 0.03, yr + 0.55, zr - 0.01, sx * 0.62 + 0.03, yf - 2.25, zr + 0.06, 'M_Trim')
    for yy in (-0.95, 0.05):
        g += box_minmax(-0.72, yy - 0.03, zr + 0.05, 0.72, yy + 0.03, zr + 0.10, 'M_Trim')
    sz0, sz1 = zr + 0.10, zr + 0.52
    sy0, sy1 = -0.95, 0.15
    g += box_minmax(-0.66, sy0, sz0, 0.66, sy1, sz1, 'M_Body', bevel=q.bev(0.03, 0.02), seg=q.seg(2, 1))
    u0, v0, u1, v1 = DECAL['follow_me']
    g += panel(rect('-y', (0, sy0, (sz0 + sz1) / 2), 1.24, 0.36), 'M_Decal', offset=0.005, uv=quad_uv(u0, v0, u1, v1))
    g += panel(rect('+y', (0, sy1, (sz0 + sz1) / 2), 1.24, 0.36), 'M_Decal', offset=0.005, uv=quad_uv(u0, v0, u1, v1))
    if not q.l2:
        for sx in (-1, 1):
            g += decal_region(rect('+x' if sx > 0 else '-x', (sx * 0.66, (sy0 + sy1) / 2, (sz0 + sz1) / 2), 1.0, 0.30),
                              'checker', offset=0.005, sub=(0.0, 0.0, 0.5, 1.0))
    g += lightbar((0, 0.75 - 0.0, zr + 0.10), 1.30, q, depth=0.26, h=0.11)
    for sx in (-1, 1):
        g += beacon((sx * 0.45, (sy0 + sy1) / 2, sz1), q, r=0.08, h=0.14)
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, (ya_f, ya_r), R, 0.26, 0.80, rim=0.62, style='car', nuts=6), axle=True,
             weighted=False)
    rig.empty('BEACON', (0.45, (sy0 + sy1) / 2, sz1 + 0.1))
    rig.empty('BEACON_2', (-0.45, (sy0 + sy1) / 2, sz1 + 0.1))
    return rig


# ============================================================ ARFF tender
def arff_tender(lod, pose):
    """6x6 airport rescue & firefighting vehicle with roof turret and bumper turret (~12 x 3 x 3.7 m)."""
    q = Q(lod)
    rig = Rig()
    R, Wt, track = 0.69, 0.52, 1.05
    axles = (3.75, -1.55, -3.15)
    W = 3.0
    yf, yr = 6.0, -6.0
    zb = 0.92
    top = [(yf + 0.10, 0.95), (yf + 0.14, 1.32), (yf - 0.20, 1.80), (yf - 0.50, 1.98), (yf - 1.35, 3.12),
           (yf - 1.65, 3.32), (yr + 0.12, 3.32), (yr, 3.20), (yr, 0.70)]
    arches = [] if q.l2 else [(y, R, R + 0.13) for y in axles]
    prof = arch_profile(yr, yf, zb, 3.3, arches, q.n(10, 6, 2, lo=2))
    prof = prof[:-2] + top
    body = ProfileBody(q, prof, W, 1.75, 3.30, tumble=0.035, bevel=0.08, mat='M_Body')
    g = body.shell()
    for y in axles:
        g += _liner(q, W / 2 - 0.42, y - 0.70, y + 0.70, zb - 0.1, 1.62)
    g += box_minmax(-1.05, yr + 0.3, 0.52, 1.05, yf - 0.5, zb + 0.02, 'M_Trim')
    if not q.l2:
        # white reflective band + side markers
        for sx in (-1, 1):
            g += decal_strip_side(body, sx, yr + 0.15, yf - 2.25, 1.62, 1.72, 'white', 1, offset=0.012)
            for yy in (-5.6, -2.35, 0.9, 4.9):
                g += marker('+x' if sx > 0 else '-x', (sx * W / 2, yy, 1.10), q)
    # windshield (panoramic) + cab side windows
    ws = body.edge_quad(yf - 0.50, 1.98, yf - 1.35, 3.12, 0.05, 0.93, 0.10, '+y')
    g += panel(ws, 'M_Glass', offset=0.01, frame=0.05 if not q.l2 else 0, frame_mat='M_Rubber')
    if not q.l2:
        # sloped front fascia: light clusters + grille
        fz = body.edge_quad(yf + 0.14, 1.32, yf - 0.20, 1.80, 0.12, 0.88, 0.25, '+y')
        g += panel(fz, 'M_Trim', offset=0.006)
    for sx in (-1, 1):
        g += body.glass_side(sx, [(yf - 2.15, 1.95), (yf - 0.62, 1.95), (yf - 1.40, 3.00), (yf - 2.15, 3.00)])
        g += body.glass_side(sx, [(2.20, 1.95), (yf - 2.30, 1.95), (yf - 2.30, 3.00), (2.20, 3.00)])
        if q.l0:
            for (ya, yb) in ((yf - 2.2, yf - 0.55), (2.15, yf - 2.25)):
                g += outline(body.side_quad(sx, [(ya, 0.95), (yb, 0.95), (yb, 3.05), (ya, 3.05)]), 0.012, 'M_Rubber')
            g += handle(body.side(sx, yf - 2.23, 1.10), body.side(sx, yf - 2.23, 1.90), q, normal=(sx, 0, 0))
        # equipment lockers with roller shutters between the arches
        if not q.l2:
            for (ya, yb) in ((-0.55, 2.25), (-5.85, -4.05)):
                pts = [(ya, 1.05), (yb, 1.05), (yb, 3.00), (ya, 3.00)]
                sq = body.side_quad(sx, pts, 0.0)
                g += outline(sq, 0.02, 'M_Trim', 0.006)
                if q.l0:
                    for k in range(12):
                        zz = 1.12 + k * 0.155
                        g += panel(body.side_quad(sx, [(ya + 0.05, zz), (yb - 0.05, zz), (yb - 0.05, zz + 0.02),
                                                       (ya + 0.05, zz + 0.02)]), 'M_Trim', offset=0.008)
            g += decal_region(body.side_quad(sx, [(-3.95, 2.62), (-0.70, 2.62), (-0.70, 2.86), (-3.95, 2.86)]),
                              'fire_rescue', offset=0.012)
            # steps under the cab doors
            for dz in (0.62, 1.02):
                g += box_minmax(sx * (W / 2 - 0.02) - (0.25 if sx > 0 else 0), yf - 1.95, dz,
                                sx * (W / 2 - 0.02) + (0.0 if sx > 0 else 0.25), yf - 1.15, dz + 0.04, 'M_Metal')
        g += mirror(body.side(sx, yf - 0.95, 2.35), sx, q, arm=0.38, head=(0.08, 0.26, 0.50), drop=0.05, fwd=0.15)
    # front: bumper with turret, lights, tow eyes
    g += box_minmax(-W / 2 + 0.02, yf + 0.02, 0.78, W / 2 - 0.02, yf + 0.32, 1.16, 'M_Trim', bevel=q.bev(0.06, 0.03),
                    seg=q.seg(2, 1))
    if not q.l2:
        for sx in (-1, 1):
            g += round_lamp((sx * 1.08, yf + 0.03, 1.48), (0, 0.80, 0.60), 0.11, q, 'warm')
            g += round_lamp((sx * 0.80, yf - 0.02, 1.55), (0, 0.80, 0.60), 0.09, q, 'warm')
            g += lamp('+y', (sx * 1.30, yf + 0.12, 1.20), 0.12, 0.10, q, 'amber', depth=0.04)
            g += lamp('+y', (sx * 0.62, yf + 0.322, 0.96), 0.22, 0.08, q, 'cool', housing=None)
            for k in range(3):
                g += lamp('+y', (sx * (0.25 + k * 0.18), yf - 1.62, 3.30), 0.12, 0.05, q, 'amber' if k else 'blue',
                          depth=0.03) if q.l0 else Geo()
        g += grille('+y', (0, yf + 0.12, 1.18), 1.3, 0.22, q, slats=3)
        # bumper turret
        g += cylinder(0.18, 0.20, q.n(12, 8), (0.0, yf + 0.30, 1.16), 'z', 'M_Metal')
        g += tube([V(0, yf + 0.30, 1.36), V(0, yf + 0.55, 1.40), V(0, yf + 0.95, 1.38)], 0.06, q.n(10, 6), 'M_Metal')
    # roof: turret (monitor), light bars, walkway, beacons
    g += cylinder(0.34, 0.22, q.n(16, 10), (0.0, 3.45, 3.32), 'z', 'M_Trim')
    g += lathe([(0.28, 0.0), (0.28, 0.20), (0.19, 0.34), (0.0, 0.36)], q.n(14, 8), 'M_Metal', 'z', (0, 3.45, 3.54))
    g += tube([V(0, 3.50, 3.74), V(0, 3.95, 3.92), V(0, 4.85, 3.98)], 0.08, q.n(12, 6), 'M_Metal')
    g += lathe([(0.08, 0.0), (0.12, 0.20), (0.0, 0.22)], q.n(12, 6), 'M_Trim', 'y', (0, 4.85, 3.98))
    g += lightbar((0, 2.35, 3.32), 2.3, q, depth=0.30, h=0.12)
    if not q.l2:
        g += box_minmax(-0.55, -5.6, 3.20, 0.55, 1.8, 3.24, 'M_Metal')
        for sx in (-1, 1):
            g += guard_rail([V(sx * 1.38, -5.7, 3.20), V(sx * 1.38, 1.9, 3.20)], q, h=0.35, post_every=1.9, mid=False)
            g += beacon((sx * 1.25, yr + 0.30, 3.20), q, r=0.09, h=0.15)
        # rear: chevrons, ladder, lights
        g += _chevron_rear(q, yr - 0.002, -1.35, 1.35, 1.02, 1.70)
        g += ladder(V(1.05, yr - 0.05, 0.95), V(1.05, yr - 0.05, 3.22), 0.42, q)
        g += tail_lights(yr - 0.003, 1.75, (-1.25, 1.25), q, w=0.20, h=0.10)
        g += box_minmax(-1.4, yr - 0.20, 0.80, 1.4, yr, 0.98, 'M_Trim')
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, axles, R, Wt, track, rim=0.52, seg=28, lug=0.05, nuts=10), axle=True,
             weighted=False)
    rig.empty('TURRET', (0, 5.07, 3.98))
    rig.empty('BEACON', (1.25, yr + 0.30, 3.35))
    return rig


# =============================================================== apron bus
def apron_bus(lod, pose):
    """Low-floor wide airside apron bus (13.9 x 3.0 x 2.95 m), doors both sides."""
    q = Q(lod)
    rig = Rig()
    L, W, H = 13.9, 3.0, 2.95
    yf, yr = L / 2, -L / 2
    R = 0.42
    axles = (4.75, -4.65)
    zb = 0.24
    top = [(yf, 0.30), (yf + 0.02, 0.95), (yf - 0.08, 2.55), (yf - 0.28, H), (yr + 0.28, H), (yr + 0.08, 2.55),
           (yr, 0.95), (yr, 0.30)]
    arches = [] if q.l2 else [(y, R, R + 0.07) for y in axles]
    prof = arch_profile(yr, yf, zb, H, arches, q.n(9, 5, 2, lo=2))
    prof = prof[:-2] + top[::-1][::-1]
    body = ProfileBody(q, prof, W, 0.95, H, tumble=0.02, bevel=0.14, mat='M_Body')
    g = body.shell()
    for y in axles:
        g += _liner(q, W / 2 - 0.30, y - 0.50, y + 0.50, zb - 0.05, 0.92)
    # windscreens
    g += panel(body.edge_quad(yf + 0.02, 0.95, yf - 0.08, 2.55, 0.06, 0.96, 0.16, '+y'), 'M_Glass', offset=0.01,
               frame=0.05 if not q.l2 else 0, frame_mat='M_Rubber')
    g += panel(body.edge_quad(yr + 0.08, 2.55, yr, 0.95, 0.04, 0.94, 0.16, '-y'), 'M_Glass', offset=0.01,
               frame=0.05 if not q.l2 else 0, frame_mat='M_Rubber')
    # side glazing with doors: right (+X) 3 doors, left (-X) 2 doors
    doors = {1: (3.55, 0.0, -3.55), -1: (2.3, -2.3)}
    dw = 1.60
    for sx in (-1, 1):
        ds = doors[sx]
        spans = []
        cur = yr + 0.55
        for d in sorted(ds):
            spans.append((cur, d - dw / 2 - 0.12))
            cur = d + dw / 2 + 0.12
        spans.append((cur, yf - 0.55))
        for (ya, yb) in spans:
            if yb - ya < 0.3:
                continue
            n = max(1, int(round((yb - ya) / 1.45)))
            for k in range(n):
                y0 = ya + (yb - ya) * k / n + 0.04
                y1 = ya + (yb - ya) * (k + 1) / n - 0.04
                g += body.glass_side(sx, [(y0, 1.0), (y1, 1.0), (y1, 2.52), (y0, 2.52)], frame=0.045,
                                     frame_mat='M_Rubber')
        for d in ds:
            # double glass door
            for half in (-1, 1):
                y0 = d + (0.0 if half > 0 else -dw / 2) + 0.03
                y1 = d + (dw / 2 if half > 0 else 0.0) - 0.03
                g += body.glass_side(sx, [(y0, 0.36), (y1, 0.36), (y1, 2.45), (y0, 2.45)], frame=0.06,
                                     frame_mat='M_Trim')
            if not q.l2:
                g += panel(body.side_quad(sx, [(d - dw / 2 - 0.06, 2.50), (d + dw / 2 + 0.06, 2.50),
                                               (d + dw / 2 + 0.06, 2.58), (d - dw / 2 - 0.06, 2.58)]), 'M_Lights',
                           offset=0.008, uv=('pt', *light_uv('amber')))
        if not q.l2:
            # lower skirt panel line + marker lights
            g += panel(body.side_quad(sx, [(yr + 0.3, 0.30), (yf - 0.3, 0.30), (yf - 0.3, 0.34), (yr + 0.3, 0.34)]),
                       'M_Trim', offset=0.006)
            for yy in (-5.5, -1.8, 1.8, 5.5):
                g += panel(body.side_quad(sx, [(yy - 0.05, 0.60), (yy + 0.05, 0.60), (yy + 0.05, 0.66),
                                               (yy - 0.05, 0.66)]), 'M_Lights', offset=0.006,
                           uv=('pt', *light_uv('amber')))
        g += mirror(body.side(sx, yf - 0.25, 2.30), sx, q, arm=0.30, head=(0.07, 0.20, 0.36), drop=-0.15, fwd=0.25)
    # front / rear details
    if not q.l2:
        for sx in (-1, 1):
            g += lamp('+y', (sx * 1.10, yf + 0.02, 0.62), 0.38, 0.14, q, 'warm', depth=0.05)
            g += lamp('-y', (sx * 1.15, yr - 0.002, 0.75), 0.22, 0.30, q, 'tail', depth=0.04)
        # LED destination display behind the top of the windscreen
        disp = body.edge_quad(yf + 0.02, 0.95, yf - 0.08, 2.55, 0.80, 0.93, 0.85, '+y')
        u0, v0, u1, v1 = DECAL['terminal']
        g += panel(disp, 'M_Decal', offset=0.016, uv=quad_uv(u0, v0, u1, v1))
        # dark lower skirt band
        g += skirt(q, yr + 0.30, yf - 0.30, W / 2 * 0.995, 0.24, 0.50, [(y, R, R + 0.07) for y in axles], ends=False)
        g += box_minmax(-W / 2 + 0.1, yf - 0.05, 0.28, W / 2 - 0.1, yf + 0.10, 0.45, 'M_Trim', bevel=q.bev(0.04),
                        seg=q.seg(2, 1))
        g += box_minmax(-W / 2 + 0.1, yr - 0.10, 0.28, W / 2 - 0.1, yr + 0.05, 0.45, 'M_Trim', bevel=q.bev(0.04),
                        seg=q.seg(2, 1))
    # roof AC pods
    for yy in (2.2, -2.2):
        g += box_minmax(-0.85, yy - 1.0, H - 0.02, 0.85, yy + 1.0, H + 0.24, 'M_Body', bevel=q.bev(0.10, 0.06),
                        seg=q.seg(2, 1))
        if q.l0:
            for xx in (-0.40, 0.40):
                g += lathe([(0.0, 0.0), (0.28, 0.0)], 14, 'M_Trim', 'z', (xx, yy, H + 0.241))
    g += beacon((0, -0.0, H), q, r=0.08, h=0.13)
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, axles, R, 0.30, 1.18, rim=0.56, nuts=8), axle=True, weighted=False)
    rig.empty('BEACON', (0, 0, H + 0.15))
    for k, d in enumerate(sorted(doors[1])):
        rig.empty(f'DOOR_R{k + 1}', (W / 2, d, 0.36))
    for k, d in enumerate(sorted(doors[-1])):
        rig.empty(f'DOOR_L{k + 1}', (-W / 2, d, 0.36))
    return rig


# ========================================================== main deck loader
def main_deck_loader(lod, pose):
    """Main deck cargo loader: front bridge + operator cab (Raise) and rear platform (RaiseRear)."""
    q = Q(lod)
    rig = Rig()
    g = Geo()
    R, Wt = 0.38, 0.30
    axles = (4.55, -4.55)
    track = 1.55
    hw = 1.80
    # low chassis frame
    g += box_minmax(-hw, -6.0, 0.30, hw, 6.0, 0.62, 'M_Body', bevel=q.bev(0.04, 0.025), seg=q.seg(2, 1))
    g += box_minmax(-hw + 0.08, -5.9, 0.18, hw - 0.08, 5.9, 0.31, 'M_Trim')
    if not q.l2:
        for y in axles:
            for sx in (-1, 1):
                g += mudguard((sx * track, y, R), R, Wt + 0.05, q, side=sx, a0=0.2, a1=math.pi - 0.2, thick=0.025,
                              clear=0.07)
        g += hazard_panel(rect('+y', (0, 6.0, 0.46), 3.4, 0.18))
        g += hazard_panel(rect('-y', (0, -6.0, 0.46), 3.4, 0.18))
        for sx in (-1, 1):
            g += round_lamp((sx * 1.55, 6.0, 0.46), (0, 1, 0), 0.06, q, 'warm', housing=None)
            g += tail_lights(-6.002, 0.46, (sx * 1.55,), q, w=0.12, h=0.07)
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, axles, R, Wt, track, rim=0.55, style='solid', nuts=6), axle=True, weighted=False)
    tf = _morph(pose, 'Raise')
    tr = _morph(pose, 'RaiseRear')
    lift = Geo()
    dw = 1.75
    # rear platform
    zr = 0.80 + 4.60 * tr
    ry0, ry1 = -5.85, -0.25
    lift += box_minmax(-dw, ry0, zr - 0.18, dw, ry1, zr - 0.04, 'M_Body', bevel=q.bev(0.03), seg=q.seg(1, 1))
    if not q.l2:
        nr = 14 if q.l0 else 6
        for k in range(nr):
            y = ry0 + 0.2 + (ry1 - ry0 - 0.4) * k / (nr - 1)
            lift += cylinder(0.045, 2 * dw - 0.4, q.n(8, 4, lo=4), (-dw + 0.2, y, zr - 0.02), 'x', 'M_Metal')
        for sx in (-1, 1):
            lift += box_minmax(sx * dw - 0.09 * (sx > 0), ry0, zr - 0.04, sx * dw + 0.09 * (sx < 0), ry1, zr + 0.22,
                               'M_Hazard', uv=('box', 1.25))
        lift += box_minmax(-dw, ry0 - 0.06, zr - 0.04, dw, ry0, zr + 0.30, 'M_Trim')
    lift += scissor(1.30, -5.20, -0.90, 0.62, zr - 0.18, 1, q, bw=0.12, bh=0.18)
    # front bridge platform + operator cab
    zf = 1.00 + 4.60 * tf
    fy0, fy1 = 0.05, 5.90
    lift += box_minmax(-dw, fy0, zf - 0.20, dw, fy1, zf - 0.04, 'M_Body', bevel=q.bev(0.03), seg=q.seg(1, 1))
    lift += box_minmax(-dw - 0.05, fy1, zf - 0.22, dw + 0.05, fy1 + 0.15, zf, 'M_Rubber', bevel=q.bev(0.03),
                       seg=q.seg(2, 1))
    if not q.l2:
        nr = 12 if q.l0 else 5
        for k in range(nr):
            y = fy0 + 0.2 + (fy1 - fy0 - 1.6) * k / (nr - 1)
            lift += cylinder(0.045, 2 * dw - 1.4, q.n(8, 4, lo=4), (-dw + 1.2, y, zf - 0.02), 'x', 'M_Metal')
        # ball mat area at the front
        lift += box_minmax(-dw + 1.2, fy1 - 1.3, zf - 0.05, dw - 0.2, fy1 - 0.1, zf - 0.01, 'M_Metal')
        lift += hazard_panel(rect('+y', (0, fy1 + 0.152, zf - 0.11), 3.5, 0.18))
        lift += guard_rail([V(dw - 0.05, fy0 + 0.3, zf - 0.04), V(dw - 0.05, fy1 - 0.2, zf - 0.04)], q, h=0.55,
                           post_every=1.5, mid=False)
    # operator cab (left side of the bridge)
    cx0, cx1, cy0, cy1 = -dw, -dw + 1.15, 3.10, 5.35
    lift += box_minmax(cx0, cy0, zf - 0.04, cx1, cy1, zf + 1.95, 'M_Body', bevel=q.bev(0.05, 0.03), seg=q.seg(2, 1))
    lift += panel(rect('+y', ((cx0 + cx1) / 2, cy1, zf + 1.30), 0.95, 1.05), 'M_Glass', offset=0.008,
                  frame=0.03 if not q.l2 else 0, frame_mat='M_Rubber')
    lift += panel(rect('+x', (cx1, (cy0 + cy1) / 2, zf + 1.30), 1.9, 1.05), 'M_Glass', offset=0.008,
                  frame=0.03 if not q.l2 else 0, frame_mat='M_Rubber')
    lift += panel(rect('-x', (cx0, (cy0 + cy1) / 2, zf + 1.30), 1.9, 1.05), 'M_Glass', offset=0.008,
                  frame=0.03 if not q.l2 else 0, frame_mat='M_Rubber')
    lift += box_minmax(cx0 - 0.04, cy0 - 0.04, zf + 1.95, cx1 + 0.04, cy1 + 0.04, zf + 2.02, 'M_Trim',
                       bevel=q.bev(0.015), seg=q.seg(1, 1))
    lift += beacon(((cx0 + cx1) / 2, (cy0 + cy1) / 2, zf + 2.02), q)
    if not q.l2:
        lift += lamp('+y', ((cx0 + cx1) / 2, cy1 + 0.01, zf + 2.08), 0.30, 0.08, q, 'cool', depth=0.05)
    lift += scissor(1.30, 0.70, 4.90, 0.62, zf - 0.20, 1, q, bw=0.12, bh=0.18)
    rig.node('Lift', lift, morph=True, weighted=False)
    rig.empty('BRIDGE_EDGE', (0, fy1 + 0.15, 1.00))
    rig.empty('BEACON', ((cx0 + cx1) / 2, (cy0 + cy1) / 2, 1.00 + 2.15))
    return rig


# ================================================================ service van
def service_van(lod, pose):
    """Airside maintenance van (5.9 x 2.0 x 2.55 m) with roof beacon and rack."""
    q = Q(lod)
    rig = Rig()
    L, W, H, R = 5.93, 2.02, 2.52, 0.37
    body, ya_f, ya_r = _suv_body(q, L, W, H, R, 3.66, kind='van')
    g = body.shell()
    yf, yr = L / 2, -L / 2
    g += _liner(q, W / 2 - 0.28, ya_f - 0.42, ya_f + 0.42, 0.30, 0.80)
    g += _liner(q, W / 2 - 0.28, ya_r - 0.42, ya_r + 0.42, 0.30, 0.80)
    ws = body.edge_quad(yf - 0.95, 1.30, yf - 1.45, H - 0.08, 0.04, 0.95, 0.10, '+y')
    g += panel(ws, 'M_Glass', offset=0.008, frame=0.035 if not q.l2 else 0, frame_mat='M_Rubber')
    for sx in (-1, 1):
        g += body.glass_side(sx, [(yf - 1.95, 1.22), (yf - 1.05, 1.22), (yf - 1.40, 1.90), (yf - 1.95, 1.90)])
        if q.l0:
            g += outline(body.side_quad(sx, [(yf - 2.0, 0.42), (yf - 0.98, 0.42), (yf - 1.38, 1.98),
                                             (yf - 2.0, 1.98)]), 0.008, 'M_Rubber', 0.004)
            if sx > 0:
                g += outline(body.side_quad(sx, [(yf - 3.40, 0.42), (yf - 2.10, 0.42), (yf - 2.10, 2.05),
                                                 (yf - 3.40, 2.05)]), 0.008, 'M_Rubber', 0.004)
                g += box_minmax(W / 2 * body.k(1.6) - 0.01, yf - 3.40, 1.98, W / 2 * body.k(1.6) + 0.02, yr + 0.3,
                                2.01, 'M_Trim')
        g += mirror(body.side(sx, yf - 1.05, 1.30), sx, q, arm=0.16, head=(0.06, 0.16, 0.26), drop=0.08, fwd=0.04)
        if not q.l2:
            g += panel(body.side_quad(sx, [(yr + 0.25, 0.86), (yf - 0.25, 0.86), (yf - 0.25, 0.94), (yr + 0.25, 0.94)]),
                       'M_Hazard', offset=0.005, uv=('box', 1.25))
    g += box_minmax(-W / 2 + 0.02, yf - 0.10, 0.30, W / 2 - 0.02, yf + 0.08, 0.60, 'M_Trim', bevel=q.bev(0.05, 0.03),
                    seg=q.seg(2, 1))
    g += box_minmax(-W / 2 + 0.02, yr - 0.08, 0.30, W / 2 - 0.02, yr + 0.10, 0.58, 'M_Trim', bevel=q.bev(0.05, 0.03),
                    seg=q.seg(2, 1))
    if not q.l2:
        g += grille('+y', (0, yf + 0.003, 0.76), 0.85, 0.20, q, slats=3)
        for sx in (-1, 1):
            g += lamp('+y', (sx * 0.72, yf - 0.005, 0.86), 0.34, 0.13, q, 'warm', depth=0.04)
            g += lamp('-y', (sx * 0.86, yr - 0.002, 1.05), 0.12, 0.40, q, 'tail', depth=0.04)
        # rear doors split line + chevrons
        g += box_minmax(-0.01, yr - 0.006, 0.62, 0.01, yr, 2.30, 'M_Rubber')
        for sx in (-1, 1):
            g += hazard_panel(rect('-y', (sx * 0.48, yr, 0.75), 0.80, 0.16))
        g += decal('-y', (0, yr - 0.004, 1.55), 0.80, 0.20, 'airside')
    # roof rack + beacon + ladder
    if not q.l2:
        for sx in (-1, 1):
            g += box_minmax(sx * 0.80 - 0.03, yr + 0.30, H, sx * 0.80 + 0.03, yf - 1.70, H + 0.10, 'M_Metal')
        for k in range(5):
            y = yr + 0.30 + (yf - 1.70 - yr - 0.30) * k / 4
            g += box_minmax(-0.83, y - 0.02, H + 0.08, 0.83, y + 0.02, H + 0.12, 'M_Metal')
        g += ladder(V(0.40, yr + 0.40, H + 0.16), V(0.40, yf - 1.85, H + 0.16), 0.38, q)
    g += lightbar((0, yf - 1.55, H), 1.20, q, depth=0.26, h=0.11)
    rig.node('Body', g)
    rig.node('Wheels', _wheels(q, (ya_f, ya_r), R, 0.24, 0.86, rim=0.58, style='car', nuts=6), axle=True,
             weighted=False)
    rig.empty('BEACON', (0, yf - 1.55, H + 0.15))
    return rig
