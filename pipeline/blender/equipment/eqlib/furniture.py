"""Airfield furniture: very low triangle counts, instanced thousands of times, no LODs.

Each asset exports root -> LOD0 (a single mesh node; optional child nodes / empties).
Origin on the ground at the footprint centre, front (+Y) = the direction the light / sign
face points.  Light lenses use M_Lights with palette UVs (emissive at night).
"""
import math

from mathutils import Matrix, Vector

from .geo import (TAU, Geo, V, box, box_minmax, cylinder, lathe, panel, poly, prism, quad, quad_uv,
                  round_path, strip, tube)
from .parts import Q, beam, rect
from .scene import Rig
from .textures import light_uv


def _lamp_uv(color):
    return ('pt', *light_uv(color))


def _elevated_light(lens_color, total_h, dome=True):
    g = Geo()
    s = 8
    g += cylinder(0.10, 0.03, s, (0, 0, 0), 'z', 'M_Metal', cap0=False)                   # base can flange
    g += cylinder(0.045, 0.09, s, (0, 0, 0.03), 'z', 'M_Trim', cap0=False, cap1=False)     # frangible coupling
    g += cylinder(0.026, total_h - 0.22, 6, (0, 0, 0.12), 'z', 'M_Metal', cap0=False, cap1=False)  # stem
    zh = total_h - 0.10
    g += lathe([(0.03, zh), (0.075, zh + 0.01), (0.075, zh + 0.055), (0.0, zh + 0.055)], s, 'M_Body', 'z')
    if dome:
        g += lathe([(0.066, zh + 0.055), (0.066, zh + 0.075), (0.045, zh + 0.098), (0.0, total_h)], s, 'M_Lights',
                   'z', uv=_lamp_uv(lens_color))
    else:
        g += lathe([(0.066, zh + 0.055), (0.066, total_h - 0.01), (0.0, total_h)], s, 'M_Lights', 'z',
                   uv=_lamp_uv(lens_color))
    return g


def runway_edge_light(lod, pose):
    """Elevated runway edge light (0.36 m), bidirectional white lens, frangible coupling."""
    rig = Rig()
    g = _elevated_light('white', 0.36, dome=False)
    rig.node('LOD0', g, weighted=False)
    return rig


def taxiway_edge_light(lod, pose):
    """Elevated taxiway edge light (0.30 m) with omnidirectional blue dome lens."""
    rig = Rig()
    g = _elevated_light('blue', 0.30, dome=True)
    rig.node('LOD0', g, weighted=False)
    return rig


def inset_light(lod, pose):
    """Flush inset (in-pavement) light: 0.30 m disc, 2 prism windows facing +Y / -Y."""
    rig = Rig()
    g = Geo()
    g += lathe([(0.15, 0.0), (0.15, 0.008), (0.135, 0.018), (0.0, 0.020)], 12, 'M_Metal', 'z')
    for sy in (-1, 1):
        y = sy * 0.06
        pts = [V(-0.045, y, 0.0205), V(0.045, y, 0.0205), V(0.045, y + sy * 0.03, 0.0205), V(-0.045, y + sy * 0.03, 0.0205)]
        if sy < 0:
            pts = [pts[1], pts[0], pts[3], pts[2]]
        g += poly(pts if sy > 0 else pts, 'M_Lights', _lamp_uv('white'))
    rig.node('LOD0', g, weighted=False)
    return rig


def approach_light_bar(lod, pose):
    """Approach light crossbar (4.2 m) with 5 PAR lamps on a 2.0 m frangible mast; lamps aim +Y."""
    rig = Rig()
    g = Geo()
    zb = 2.0
    g += box(0.45, 0.45, 0.04, (0, 0, 0.02), 'M_Metal')
    g += cylinder(0.055, zb - 0.04, 8, (0, 0, 0.04), 'z', 'M_Body', cap0=False, cap1=False)
    g += box(4.2, 0.07, 0.07, (0, 0, zb), 'M_Metal')
    for k in range(5):
        x = -2.0 + k * 1.0
        g += box(0.04, 0.05, 0.12, (x, 0.05, zb + 0.08), 'M_Metal')
        lamp = lathe([(0.0, -0.10), (0.085, -0.08), (0.095, 0.0), (0.0, 0.0)], 8, 'M_Trim', 'z', cap0=False)
        lens = lathe([(0.088, 0.0), (0.0, 0.012)], 8, 'M_Lights', 'z', uv=_lamp_uv('white'))
        part = lamp + lens
        part.transform(Matrix.Rotation(-math.pi / 2 + math.radians(4.0), 4, 'X'))
        part.move(x, 0.12, zb + 0.16)
        g += part
    rig.node('LOD0', g, weighted=False)
    rig.empty('LAMP_AIM', (0, 1.0, zb + 0.16))
    return rig


def papi_unit(lod, pose):
    """PAPI light housing unit on adjustable frangible legs; two lenses aim +Y."""
    rig = Rig()
    g = Geo()
    hz = 0.42
    g += box_minmax(-0.45, -0.32, hz, 0.45, 0.30, hz + 0.40, 'M_Body')
    # visor / hood
    g += prism([(-0.48, hz + 0.40), (0.48, hz + 0.40), (0.48, hz + 0.44), (-0.48, hz + 0.44)], 'y', 0.30, 0.46, 'M_Body')
    for x in (-0.20, 0.20):
        g += cylinder(0.12, 0.06, 10, (x, 0.30, hz + 0.20), 'y', 'M_Trim', cap0=False, cap1=False)
        g += lathe([(0.0, 0.0), (0.11, 0.0)][::-1], 10, 'M_Lights', 'y', (x, 0.355, hz + 0.20), uv=_lamp_uv('white'))
    for (x, y) in ((-0.38, -0.25), (0.38, -0.25), (-0.38, 0.22), (0.38, 0.22)):
        g += cylinder(0.022, hz, 6, (x, y, 0.0), 'z', 'M_Metal', cap0=False)
        g += box(0.12, 0.12, 0.02, (x, y, 0.01), 'M_Metal')
    g += box_minmax(-0.42, -0.28, hz - 0.05, 0.42, 0.26, hz, 'M_Metal')
    rig.node('LOD0', g, weighted=False)
    return rig


def windsock(lod, pose):
    """6 m windsock mast with a 3.6 m orange/white sock on a child node 'Sock' (yaw about Z at the mast top)."""
    rig = Rig()
    g = Geo()
    H = 6.0
    g += box(0.50, 0.50, 0.05, (0, 0, 0.025), 'M_Metal')
    g += cylinder(0.08, 0.6, 8, (0, 0, 0.05), 'z', 'M_Metal', cap0=False, cap1=False)
    g += cylinder(0.055, H - 0.6, 8, (0, 0, 0.65), 'z', 'M_Metal', cap0=False, cap1=True)
    g += box(0.18, 0.12, 0.10, (0.0, 0.0, 0.95), 'M_Metal')          # hinge (tilt-down) bracket
    g += lathe([(0.04, H + 0.05), (0.045, H + 0.10), (0.0, H + 0.14)], 6, 'M_Lights', 'z', uv=_lamp_uv('red'))
    rig.node('LOD0', g, weighted=False)
    # sock: frame ring + cone made of 5 bands, drooping slightly, pointing +Y (downwind)
    s = Geo()
    piv = V(0, 0, H - 0.25)
    n_seg = 10
    L = 3.6
    r0, r1 = 0.45, 0.22
    rings = 6
    pts = []
    for i in range(rings):
        t = i / (rings - 1)
        y = 0.25 + L * t
        z = -0.55 * t * t
        r = r0 + (r1 - r0) * t
        pts.append((y, z, r))
    ring_v = []
    for (y, z, r) in pts:
        ring_v.append([V(r * math.cos(TAU * j / n_seg), y, z + r * math.sin(TAU * j / n_seg)) for j in range(n_seg)])
    for i in range(rings - 1):
        mat = 'M_Body' if i % 2 == 0 else 'M_Trim'
        A, B = ring_v[i], ring_v[i + 1]
        for j in range(n_seg):
            jn = (j + 1) % n_seg
            s += quad(A[j], B[j], B[jn], A[jn], mat)
    # mouth frame
    s += tube([V(r0 * math.cos(TAU * j / n_seg), 0.25, r0 * math.sin(TAU * j / n_seg)) for j in range(n_seg + 1)],
              0.015, 4, 'M_Metal', cap=False)
    s += tube([V(0, 0.0, 0.0), V(0, 0.25, 0.0)], 0.02, 4, 'M_Metal')
    s.move(*piv)
    rig.node('Sock', s, origin=piv, parent='LOD0', weighted=False)
    return rig


def apron_flood_mast(lod, pose):
    """30 m apron floodlight mast, octagonal taper, 10-luminaire head ring (lamps on M_Lights)."""
    rig = Rig()
    g = Geo()
    H = 30.0
    g += box(1.4, 1.4, 0.30, (0, 0, 0.15), 'M_Trim')                     # foundation plinth
    g += cylinder(0.50, 0.05, 8, (0, 0, 0.30), 'z', 'M_Metal', cap0=False)
    g += lathe([(0.40, 0.35), (0.16, H)], 8, 'M_Metal', 'z', phase=math.pi / 8)
    g += panel(rect('+y', (0, 0.392, 1.2), 0.32, 0.85), 'M_Trim', offset=0.003)
    # head: ring frame + 10 floodlights tilted down/outwards
    ring = lathe([(0.0, H - 0.12), (1.75, H - 0.12), (1.75, H + 0.04), (0.0, H + 0.04)], 10, 'M_Metal', 'z',
                 phase=math.pi / 10)
    g += ring
    n = 10
    for k in range(n):
        a = TAU * k / n
        d = V(math.cos(a), math.sin(a), 0)
        c = d * 1.95 + V(0, 0, H - 0.05)
        lum = box(0.78, 0.20, 0.58, (0, 0, 0), 'M_Trim')
        lum += quad(V(0.36, 0.101, -0.26), V(-0.36, 0.101, -0.26), V(-0.36, 0.101, 0.26), V(0.36, 0.101, 0.26),
                    'M_Lights', _lamp_uv('warm'))
        lum.transform(Matrix.Rotation(-math.radians(58), 4, 'X'))
        lum.transform(Matrix.Rotation(a - math.pi / 2, 4, 'Z'))
        lum.move(*c)
        g += lum
    g += cylinder(0.025, 1.4, 4, (0, 0, H + 0.04), 'z', 'M_Metal', cap0=False)
    g += lathe([(0.06, H + 0.30), (0.06, H + 0.38), (0.0, H + 0.43)], 6, 'M_Lights', 'z', uv=_lamp_uv('red'))
    rig.node('LOD0', g, weighted=False)
    rig.empty('LIGHT_HEAD', (0, 0, H - 0.3))
    return rig


def taxi_sign(lod, pose):
    """Airfield guidance sign box 2.4 x 1.1 m (face).  Front face (+Y) M_SignFace UV 0-1,
    back face (-Y) M_SignFaceBack UV 0-1 (reads correctly from behind)."""
    rig = Rig()
    g = Geo()
    w, h, d = 2.4, 1.1, 0.30
    z0 = 0.32
    x0, x1 = -w / 2, w / 2
    y0, y1 = -d / 2, d / 2
    z1 = z0 + h
    fr = 0.05
    # housing (top, bottom, ends) slightly larger than the faces
    g += box_minmax(x0 - fr, y0, z0 - fr, x1 + fr, y1, z0, 'M_Trim')
    g += box_minmax(x0 - fr, y0, z1, x1 + fr, y1, z1 + fr, 'M_Trim')
    g += quad(V(x0 - fr, y1, z0), V(x0 - fr, y0, z0), V(x0 - fr, y0, z1), V(x0 - fr, y1, z1), 'M_Trim')
    g += quad(V(x1 + fr, y0, z0), V(x1 + fr, y1, z0), V(x1 + fr, y1, z1), V(x1 + fr, y0, z1), 'M_Trim')
    # bezel strips around the faces
    for (yy, sgn) in ((y1, 1), (y0, -1)):
        for (a, b) in (((x0 - fr, z0), (x0, z1)), ((x1, z0), (x1 + fr, z1))):
            pts = rect('+y' if sgn > 0 else '-y', ((a[0] + b[0]) / 2, yy, (a[1] + b[1]) / 2), b[0] - a[0], b[1] - a[1])
            g += poly(pts, 'M_Trim')
    # faces (UV 0-1)
    front = rect('+y', (0, y1, (z0 + z1) / 2), w, h)
    g += poly(front, 'M_SignFace', quad_uv(0, 0, 1, 1))
    back = rect('-y', (0, y0, (z0 + z1) / 2), w, h)
    g += poly(back, 'M_SignFaceBack', quad_uv(0, 0, 1, 1))
    # frangible legs with base pads
    for x in (-0.85, 0.85):
        g += cylinder(0.035, z0 - fr, 6, (x, 0, 0.0), 'z', 'M_Metal', cap0=False, cap1=False)
        g += box(0.22, 0.22, 0.03, (x, 0, 0.015), 'M_Metal')
    rig.node('LOD0', g, weighted=False)
    rig.empty('FACE_FRONT', (0, y1, (z0 + z1) / 2))
    return rig


def ils_localizer(lod, pose):
    """ILS localizer antenna array: 14 log-periodic dipole antennas on a 26 m frame, radiating +Y."""
    rig = Rig()
    g = Geo()
    n = 14
    span = 26.0
    hb = 1.10
    for k in range(n):
        x = -span / 2 + span * k / (n - 1)
        # post (triangular prism, no caps)
        g += lathe([(0.05, 0.0), (0.04, 1.70)], 3, 'M_Metal', 'z', (x, 0, 0))
        # boom along Y
        g += lathe([(0.03, -0.75), (0.03, 0.75)], 4, 'M_Metal', 'y', (x, 0.0, 1.85))
        # dipole elements (flat bars, double-sided material)
        for e in range(5):
            y = -0.65 + e * 0.32
            half = 0.95 - e * 0.15
            g += quad(V(x - half, y - 0.02, 1.85), V(x + half, y - 0.02, 1.85), V(x + half, y + 0.02, 1.85),
                      V(x - half, y + 0.02, 1.85), 'M_Metal')
    g += box(span + 0.4, 0.08, 0.10, (0, -0.15, hb), 'M_Trim')
    # equipment shelter behind the array
    g += box_minmax(14.5, -8.5, 0.0, 17.0, -6.5, 2.5, 'M_Body')
    g += prism([(14.4, 2.5), (17.1, 2.5), (17.1, 2.62), (14.4, 2.74)], 'y', -8.6, -6.4, 'M_Trim')
    rig.node('LOD0', g, weighted=False)
    return rig


def glide_slope_mast(lod, pose):
    """Glide slope lattice mast (15 m, red/white bands) with 3 antenna panels facing +Y + shelter."""
    rig = Rig()
    g = Geo()
    H = 15.0
    r = 0.42
    legs = [V(r * math.cos(a), r * math.sin(a), 0) for a in (math.pi / 2, math.pi / 2 + TAU / 3, math.pi / 2 + 2 * TAU / 3)]
    bays = 8
    for i, p in enumerate(legs):
        g += lathe([(0.035, 0.0), (0.035, H)], 3, 'M_Metal', 'z', tuple(p))
    for b in range(bays):
        z0 = H * b / bays
        z1 = H * (b + 1) / bays
        mat = 'M_Body' if b % 2 == 0 else 'M_Trim'
        for i in range(3):
            a, c = legs[i], legs[(i + 1) % 3]
            n = (a + c) / 2
            n.z = 0
            n.normalize()
            off = n * 0.01
            p0, p1 = a + V(0, 0, z0) + off, c + V(0, 0, z1) + off
            d = (p1 - p0).normalized()
            s = d.cross(n).normalized() * 0.025
            g += quad(p0 - s, p0 + s, p1 + s, p1 - s, mat)
    for (z, w) in ((5.0, 1.0), (8.5, 1.0), (12.0, 1.0)):
        g += box(0.9, 0.06, 0.06, (0, 0.30, z), 'M_Metal')
        g += box(0.8, 0.25, 1.1, (0, 0.55, z), 'M_Body')
    g += lathe([(0.06, H), (0.06, H + 0.08), (0.0, H + 0.14)], 6, 'M_Lights', 'z', uv=_lamp_uv('red'))
    g += box_minmax(-1.2, -3.6, 0.0, 1.2, -1.6, 2.5, 'M_Trim')
    g += prism([(-1.3, 2.5), (1.3, 2.5), (1.3, 2.62), (-1.3, 2.74)], 'y', -3.7, -1.5, 'M_Metal')
    g += panel(rect('+x', (1.2, -2.6, 1.0), 0.9, 2.0), 'M_Metal', offset=0.003)
    rig.node('LOD0', g, weighted=False)
    return rig


def blast_fence(lod, pose):
    """Jet blast deflector fence segment, 6.0 m long (tiles along X), 4.0 m high; blast side +Y."""
    rig = Rig()
    g = Geo()
    L = 6.0
    x0, x1 = -L / 2, L / 2
    H = 4.0
    # louvres inclined to deflect upward (double sided)
    n = 8
    for k in range(n):
        zc = 0.55 + (H - 0.8) * k / (n - 1)
        a = math.radians(38)
        dy, dz = 0.30 * math.cos(a), 0.30 * math.sin(a)
        p0 = (0.0 + dy, zc - dz)
        p1 = (0.0 - dy, zc + dz)
        g += quad(V(x0, p0[0], p0[1]), V(x1, p0[0], p0[1]), V(x1, p1[0], p1[1]), V(x0, p1[0], p1[1]), 'M_Body')
        g += quad(V(x1, p0[0], p0[1]), V(x0, p0[0], p0[1]), V(x0, p1[0], p1[1]), V(x1, p1[0], p1[1]), 'M_Body')
    # posts (one per segment start + mid) and rear struts
    for x in (x0 + 0.08, 0.0):
        g += box_minmax(x - 0.08, -0.35, 0.0, x + 0.08, -0.20, H, 'M_Metal')
        g += beam(V(x, -0.28, H * 0.75), V(x, -2.2, 0.0), 0.10, 0.10, 'M_Metal')
    g += box_minmax(x0, -0.6, 0.0, x1, 0.6, 0.25, 'M_Trim')
    g += box_minmax(x0, -0.36, H - 0.05, x1, -0.18, H + 0.12, 'M_Hazard', uv=('box', 1.25))
    rig.node('LOD0', g, weighted=False)
    return rig


def perimeter_fence(lod, pose):
    """Security fence segment, 3.0 m long (tiles along X): post, chain-link mesh (alpha), Y-outrigger
    with barbed wires on top; secure side -Y, outrigger leans +Y."""
    rig = Rig()
    g = Geo()
    L, H = 3.0, 2.4
    x0, x1 = -L / 2, L / 2
    s = 1.0 / 0.4
    mesh = [V(x0, 0, 0.05), V(x1, 0, 0.05), V(x1, 0, H), V(x0, 0, H)]
    uv = ('uv', [(x0 * s, 0.05 * s), (x1 * s, 0.05 * s), (x1 * s, H * s), (x0 * s, H * s)])
    g += poly(mesh, 'M_Fence', uv)
    g += lathe([(0.04, 0.0), (0.04, H + 0.05)], 6, 'M_Metal', 'z', (x0, 0, 0), cap1=True)
    g += lathe([(0.022, x0), (0.022, x1)], 4, 'M_Metal', 'x', (0, 0, H))
    # outrigger + 3 wires
    a = V(x0, 0, H + 0.05)
    b = V(x0, 0.32, H + 0.40)
    g += beam(a, b, 0.03, 0.03, 'M_Metal', up=(1, 0, 0))
    for k in range(3):
        t = (k + 1) / 3
        p = a.lerp(b, t)
        g += quad(V(x0, p.y - 0.005, p.z), V(x1, p.y - 0.005, p.z), V(x1, p.y + 0.005, p.z + 0.012),
                  V(x0, p.y + 0.005, p.z + 0.012), 'M_Metal')
    g += box_minmax(x0, -0.08, -0.02, x1, 0.08, 0.06, 'M_Trim')
    rig.node('LOD0', g, weighted=False)
    return rig


def road_light(lod, pose):
    """Landside / service road street light: 10 m tapered pole, 1.6 m outreach arm, LED head (+Y)."""
    rig = Rig()
    g = Geo()
    H = 10.0
    g += cylinder(0.16, 0.05, 8, (0, 0, 0), 'z', 'M_Metal', cap0=False)
    g += lathe([(0.10, 0.05), (0.06, H)], 8, 'M_Metal', 'z')
    arm = round_path([V(0, 0, H - 0.4), V(0, 0.15, H + 0.05), V(0, 1.6, H + 0.25)], 0.3, 3)
    g += tube(arm, 0.04, 6, 'M_Metal')
    head = box(0.32, 0.72, 0.10, (0, 1.85, H + 0.25), 'M_Trim')
    head += quad(V(-0.13, 2.17, H + 0.199), V(0.13, 2.17, H + 0.199), V(0.13, 1.55, H + 0.199),
                 V(-0.13, 1.55, H + 0.199), 'M_Lights', _lamp_uv('warm'))
    g += head
    g += panel(rect('+y', (0, 0.095, 0.9), 0.10, 0.35), 'M_Trim', offset=0.002)
    rig.node('LOD0', g, weighted=False)
    rig.empty('LIGHT_HEAD', (0, 1.85, H + 0.19))
    return rig
