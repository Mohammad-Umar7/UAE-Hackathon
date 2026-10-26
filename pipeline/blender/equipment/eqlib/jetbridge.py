"""Apron-drive passenger boarding bridge (CONVENTIONS section 3.2 part contract).

Bridge frame: rotunda centre on the ground at the origin, bridge extends along +Y.
Parts (each a node under LODn; LOD1/LOD2 copies carry an _LODn suffix):
  JB_Rotunda      fixed; column, drum, roof, fixed-link stub, service stairs. Floor z = 5.0
  JB_Tunnel_A     outer tunnel, origin = rear end, floor centreline, length 14 m
  JB_Tunnel_B     inner (telescoping) tunnel, same origin rule, length 14 m; fits inside A
  JB_DriveColumn  wheel bogie + lift column sleeves, origin on the ground under the column
    JB_DriveColumn_Lift  inner columns + yoke, origin at the yoke top (translate Z at runtime)
  JB_Cab          cab head + bellows canopy + bumper, origin = rotation pivot, floor centreline
Rest pose (exported): level, B extended 7.0 m out of A, cab straight.
"""
import math

from mathutils import Matrix, Vector

from .geo import (TAU, Geo, V, box, box_minmax, cylinder, lathe, panel, poly, prism, quad,
                  quad_uv, rail, round_path, sag_path, strip, tube)
from .parts import (Q, beacon, beam, guard_rail, hazard_box, hazard_panel, lamp, lens, louvre, outline,
                    rect, rod, round_lamp, stair_flight, wheel)
from .scene import Rig

FLOOR = 5.0
ROT_R = 2.10
A_MOUNT = 1.45            # A origin distance from the rotunda centre at yaw 0
A_LEN = B_LEN = 14.0
A_HW, A_Z0, A_Z1, A_CROWN = 1.33, -0.42, 2.62, 0.07
A_IN_HW, A_IN_TOP = 1.23, 2.50
B_HW, B_Z0, B_Z1, B_CROWN = 1.15, -0.05, 2.36, 0.04
B_ENV = 1.19             # max half width of B incl. ribs and frames (A collar opening 1.205)
B_RIDE = 0.07             # B floor sits 7 cm above A floor (rollers)
B_MIN, B_MAX, B_REST = 3.5, 12.0, 7.0
CAB_PIVOT_Y = 13.30       # on B
COLUMN_Y = 11.00          # on B (underside)
CAB_DOCK_Y = 3.22         # bumper face, cab local


def rest_origins():
    a = V(0, A_MOUNT, FLOOR)
    b = a + V(0, B_REST, B_RIDE)
    cab = b + V(0, CAB_PIVOT_Y, 0)
    col = V(b.x, b.y + COLUMN_Y, 0.0)
    lift = V(col.x, col.y, b.z + B_Z0 - 0.08)
    return dict(A=a, B=b, CAB=cab, COL=col, LIFT=lift)


# ------------------------------------------------------------ corrugation
def ribbed_wall(y0, y1, z0, z1, xb, depth, pitch, mat, q, skip=()):
    """+X facing corrugated wall (vertical trapezoid ribs) on plane x = xb.
    `skip` = [(ya, yb)] intervals replaced by flat proud panels (returned as list)."""
    g = Geo()
    flats = []
    n = int(round((y1 - y0) / pitch))
    pitch = (y1 - y0) / n
    cells = []
    for k in range(n):
        ya = y0 + k * pitch
        yb = ya + pitch
        hit = None
        for (sa, sb) in skip:
            if yb > sa and ya < sb:
                hit = (sa, sb)
        cells.append((ya, yb, hit))
    # group consecutive non-skipped cells into runs
    runs = []
    cur = []
    for c in cells:
        if c[2] is None:
            cur.append(c)
        else:
            if cur:
                runs.append(cur)
                cur = []
            if not flats or flats[-1][1] < c[0] - 1e-6:
                flats.append([c[0], c[1]])
            else:
                flats[-1][1] = c[1]
    if cur:
        runs.append(cur)
    xt = xb + depth
    if q.l0:
        for run in runs:
            ys, xs = [], []
            for (ya, yb, _) in run:
                p = yb - ya
                ys += [ya, ya + 0.30 * p, ya + 0.40 * p, ya + 0.90 * p]
                xs += [xb, xb, xt, xt]
            ys.append(run[-1][1])
            xs.append(xb)
            for i in range(len(ys) - 1):
                g += quad(V(xs[i], ys[i], z0), V(xs[i + 1], ys[i + 1], z0), V(xs[i + 1], ys[i + 1], z1),
                          V(xs[i], ys[i], z1), mat)
    else:
        for run in runs:
            ya, yb = run[0][0], run[-1][1]
            g += quad(V(xt * 0.5 + xb * 0.5, ya, z0), V(xt * 0.5 + xb * 0.5, yb, z0),
                      V(xt * 0.5 + xb * 0.5, yb, z1), V(xt * 0.5 + xb * 0.5, ya, z1), mat)
    for (ya, yb) in flats:
        xf = xt if q.l0 else xt * 0.5 + xb * 0.5
        g += quad(V(xf, ya, z0), V(xf, yb, z0), V(xf, yb, z1), V(xf, ya, z1), mat)
        if q.l0:
            g += quad(V(xb, ya, z0), V(xf, ya, z0), V(xf, ya, z1), V(xb, ya, z1), mat)
            g += quad(V(xf, yb, z0), V(xb, yb, z0), V(xb, yb, z1), V(xf, yb, z1), mat)
    return g, [(a, b) for a, b in flats], xt


def _sym(g):
    """g modelled for +X side -> both sides."""
    out = Geo()
    out += g
    out += g.mirrored_x()
    return out


def roof_profile(hw, z1, crown, over=0.05):
    return [(-hw - over, z1 - 0.06), (hw + over, z1 - 0.06), (hw + over, z1), (hw * 0.55, z1 + crown * 0.8),
            (0.0, z1 + crown), (-hw * 0.55, z1 + crown * 0.8), (-hw - over, z1)]


def collar_ring(outer, inner, y, mat):
    """Planar frame between two closed (x,z) loops with equal point counts, facing +Y."""
    g = Geo()
    n = len(outer)
    for i in range(n):
        j = (i + 1) % n
        a, b = outer[i], outer[j]
        c, d = inner[j], inner[i]
        g += quad(V(a[0], y, a[1]), V(d[0], y, d[1]), V(c[0], y, c[1]), V(b[0], y, b[1]), mat)
    return g


def _loop(hw, z0, z1, crown):
    return [(-hw, z0), (hw, z0), (hw, z1), (hw * 0.55, z1 + crown * 0.8), (0.0, z1 + crown),
            (-hw * 0.55, z1 + crown * 0.8), (-hw, z1)]


# ------------------------------------------------------------------ tunnels
def tunnel(q, L, hw, z0, z1, crown, in_hw, in_top, glass, kind, windows=(3.6, 10.2)):
    """Generic tunnel shell in local frame (origin rear end, floor centreline, +Y)."""
    g = Geo()
    rail_b = 0.30   # bottom chord height
    rail_t = 0.24   # top fascia height
    depth = 0.035
    proud = 0.05 if kind == 'A' else depth      # B must stay inside A's collar opening
    fx = 0.02 if kind == 'A' else 0.005          # end-frame extra
    y0, y1 = 0.12, L - 0.12   # end frames occupy the extremities
    # --- side walls
    side = Geo()
    if glass:
        kick = 0.48
        top_band = z1 - 0.40
        # solid kick panel + top band (outer)
        side += box_minmax(hw - 0.06, y0, z0 + rail_b, hw, y1, kick, 'M_Body')
        side += box_minmax(hw - 0.06, y0, top_band, hw, y1, z1 - rail_t, 'M_Body')
        # mullions
        nm = max(2, int(round((y1 - y0) / 1.40)))
        for k in range(nm + 1):
            y = y0 + (y1 - y0) * k / nm
            if q.l0:
                side += box_minmax(hw - 0.07, y - 0.045, kick, hw + 0.02, y + 0.045, top_band, 'M_Trim')
            elif q.l1:
                side += quad(V(hw + 0.02, y - 0.045, kick), V(hw + 0.02, y + 0.045, kick),
                             V(hw + 0.02, y + 0.045, top_band), V(hw + 0.02, y - 0.045, top_band), 'M_Trim')
        # glass (double sided pane)
        gp = [V(hw - 0.03, y0, kick), V(hw - 0.03, y1, kick), V(hw - 0.03, y1, top_band), V(hw - 0.03, y0, top_band)]
        side += panel(gp, 'M_Glass', offset=0.0, double=True)
        # inner faces of kick + band (visible through the glass)
        side += quad(V(in_hw, y1, 0.0), V(in_hw, y0, 0.0), V(in_hw, y0, kick), V(in_hw, y1, kick), 'M_Body')
        side += quad(V(in_hw, y1, top_band), V(in_hw, y0, top_band), V(in_hw, y0, in_top), V(in_hw, y1, in_top),
                     'M_Body')
        if q.l0:
            # handrail inside (only the innermost tunnel; A must stay clear for B)
            if kind == 'B':
                side += tube([V(in_hw - 0.06, y0 + 0.2, 0.95), V(in_hw - 0.06, y1 - 0.2, 0.95)], 0.02, 6, 'M_Metal')
    else:
        win = [] if q.l2 else [(w - 0.55, w + 0.55) for w in windows]
        rw, flats, xt = ribbed_wall(y0, y1, z0 + rail_b, z1 - rail_t, hw, depth, 0.30, 'M_Body', q, skip=win)
        side += rw
        if not q.l2:
            for (ya, yb) in flats:
                yc = (ya + yb) / 2
                xf = xt if q.l0 else hw + depth * 0.5
                pts = [V(xf, yc - 0.42, 1.05), V(xf, yc + 0.42, 1.05), V(xf, yc + 0.42, 1.95), V(xf, yc - 0.42, 1.95)]
                side += panel(pts, 'M_Glass', offset=0.006, frame=0.05, frame_mat='M_Trim')
    # bottom chord and top fascia rails (proud of the ribs, hide rib ends)
    bev = q.bev(0.025, 0.015)
    side += box_minmax(hw - 0.10, 0.0, z0, hw + proud, L, z0 + rail_b, 'M_Trim', bevel=bev, seg=q.seg(1, 1))
    side += box_minmax(hw - 0.10, 0.0, z1 - rail_t, hw + proud, L, z1, 'M_Body', bevel=bev, seg=q.seg(1, 1))
    g += _sym(side)
    # --- roof
    g += prism(roof_profile(hw, z1, crown, proud + 0.01), 'y', 0.0, L, 'M_Body', bevel=q.bev(0.02), seg=q.seg(1, 1))
    # --- underside (floor plate) and interior surfaces
    g += quad(V(-hw + 0.08, L, z0 + 0.02), V(hw - 0.08, L, z0 + 0.02), V(hw - 0.08, 0, z0 + 0.02),
              V(-hw + 0.08, 0, z0 + 0.02), 'M_Trim')
    if glass:
        g += quad(V(-in_hw, 0, 0.0), V(in_hw, 0, 0.0), V(in_hw, L, 0.0), V(-in_hw, L, 0.0), 'M_Rubber')
        g += quad(V(-in_hw, L, in_top), V(in_hw, L, in_top), V(in_hw, 0, in_top), V(-in_hw, 0, in_top), 'M_Body')
        if not q.l2:
            g += quad(V(-0.12, L - 0.4, in_top - 0.01), V(0.12, L - 0.4, in_top - 0.01), V(0.12, 0.4, in_top - 0.01),
                      V(-0.12, 0.4, in_top - 0.01), 'M_Lights', ('pt', 0.125, 0.125))
    if not q.l2:
        # under-floor cross members + longitudinal beams
        for sx in (-1, 1):
            g += box_minmax(sx * (hw * 0.62) - 0.07, 0.2, z0 - 0.10, sx * (hw * 0.62) + 0.07, L - 0.2, z0 + 0.02,
                            'M_Trim')
        if q.l0:
            for k in range(1, int(L / 1.75)):
                y = k * 1.75
                g += box_minmax(-hw + 0.1, y - 0.05, z0 - 0.06, hw - 0.1, y + 0.05, z0 + 0.02, 'M_Trim')
    # --- end frames
    outer = _loop(hw + proud + fx, z0 - 0.01, z1 + 0.01, crown)
    if kind == 'A':
        inner = _loop(B_ENV + 0.015, B_RIDE + B_Z0 - 0.03, B_RIDE + B_Z1 + 0.03, B_CROWN)
        g += _band(outer, L - 0.16, L, 'M_Trim')
        g += collar_ring(outer, inner, L, 'M_Trim')
        if q.l0:
            # brush seal visible in the gap around B
            g += collar_ring(inner, _loop(B_ENV + 0.002, B_RIDE + B_Z0 - 0.012, B_RIDE + B_Z1 + 0.012, B_CROWN),
                             L + 0.006, 'M_Rubber')
        # rear: closed end inside the rotunda (two-sided so it reads from inside a glass tunnel)
        rear = [V(x, 0.05, z) for (x, z) in outer]
        g += poly(rear[::-1], 'M_Trim')
        g += poly(rear, 'M_Trim').move(0, 0.02, 0)
        g += _band(outer, 0.0, 0.12, 'M_Trim')
    else:
        # B: front end goes into the cab drum (closed), rear end rides inside A (open ring)
        g += _band(outer, L - 0.12, L, 'M_Trim')
        front = [V(x, L, z) for (x, z) in outer]
        g += poly(front[::-1], 'M_Trim')
        inner_r = _loop(in_hw, 0.0, in_top, 0.0)
        g += _band(outer, 0.0, 0.12, 'M_Trim')
        g += collar_ring(outer, inner_r, 0.0, 'M_Trim').flip()
    # --- cable / conduit tray along the +X side (A only, B must slide inside A)
    if not q.l2 and kind == 'A':
        g += box_minmax(hw + proud, 0.3, z1 - rail_t - 0.20, hw + proud + 0.10, L - 0.3, z1 - rail_t - 0.06, 'M_Metal')
    if q.l0:
        # roof drip edge lights / marker
        g += lamp('+y', (hw - 0.15, L + 0.002, z1 - 0.12), 0.10, 0.06, q, 'amber', depth=0.03) if kind == 'A' else Geo()
    return g


def _band(loop, ya, yb, mat):
    """Closed outward band following an (x,z) loop between ya and yb."""
    g = Geo()
    n = len(loop)
    for i in range(n):
        j = (i + 1) % n
        a, b = loop[i], loop[j]
        g += quad(V(a[0], ya, a[1]), V(b[0], ya, b[1]), V(b[0], yb, b[1]), V(a[0], yb, a[1]), mat)
    # orientation: loop is CCW in (x,z) seen from +Y ... ensure outward by flipping
    return g.flip()


def pca_unit(q, y0, y1, z_top, hw=0.95, h=1.0):
    """Pre-conditioned air unit hung under the tunnel."""
    g = Geo()
    g += box_minmax(-hw, y0, z_top - h, hw, y1, z_top - 0.10, 'M_Body', bevel=q.bev(0.04, 0.02), seg=q.seg(2, 1))
    if not q.l2:
        for sx in (-1, 1):
            # hangers
            for y in (y0 + 0.2, y1 - 0.2):
                g += box_minmax(sx * (hw - 0.15) - 0.04, y - 0.04, z_top - 0.12, sx * (hw - 0.15) + 0.04, y + 0.04,
                                z_top + 0.02, 'M_Trim')
        if q.l0:
            g += louvre('+x', (hw + 0.001, (y0 + y1) / 2 - 0.5, z_top - h / 2 - 0.05), 0.8, 0.55, q, n=9)
            g += louvre('-x', (-hw - 0.001, (y0 + y1) / 2 - 0.5, z_top - h / 2 - 0.05), 0.8, 0.55, q, n=9)
        if q.l0:
            # condenser fan grilles on the bottom
            for yy in ((y0 + y1) / 2 + 0.55,):
                for sx in (-0.45, 0.45):
                    # profile travelling outwards at constant h -> faces point down (-Z)
                    g += lathe([(0.0, 0.0), (0.33, 0.0)], 16, 'M_Rubber', 'z', (sx, yy, z_top - h - 0.002))
            g += outline(rect('+x', (hw + 0.002, (y0 + y1) / 2 + 0.55, z_top - h / 2 - 0.05), 0.9, 0.7), 0.012)
            # duct to the tunnel
            g += cylinder(0.22, 0.25, 12, (0, y1 - 0.35, z_top - 0.12), 'z', 'M_Trim')
    return g


# --------------------------------------------------------------- rotunda
def rotunda(q, glass=False):
    g = Geo()
    seg = q.n(48, 20, 10)
    cseg = q.n(20, 10, 6)
    # base plate + column + capital
    g += box(1.3, 1.3, 0.06, (0, 0, 0.03), 'M_Trim', bevel=q.bev(0.02), seg=q.seg(1, 1))
    if q.l0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                g += cylinder(0.035, 0.06, 6, (sx * 0.5, sy * 0.5, 0.06), 'z', 'M_Metal')
    g += cylinder(0.42, 4.15, cseg, (0, 0, 0.06), 'z', 'M_Trim', cap0=False, cap1=False)
    g += lathe([(0.42, 4.15), (0.75, 4.30), (1.55, 4.44), (2.17, 4.50), (0.0, 4.50)], seg // 2 if not q.l2 else 12,
               'M_Trim', 'z')
    # drum: skirt band, fluted wall, fascia
    g += lathe([(2.16, 4.50), (2.18, 4.55), (2.18, 4.98), (2.12, 5.0)] if not q.l2 else
               [(2.18, 4.50), (2.18, 5.0)], seg, 'M_Body', 'z')
    wall = lathe([(2.11, 5.0), (2.11, 7.52)], seg, 'M_Body', 'z')
    if q.l0:
        step = TAU / seg
        for i, v in enumerate(wall.v):
            j = int(round((math.atan2(v.y, v.x) % TAU) / step)) % seg
            if j % 2 == 1:
                wall.v[i] = V(v.x * 1.016, v.y * 1.016, v.z)
    g += wall
    g += lathe([(2.12, 7.52), (2.19, 7.54), (2.19, 7.84), (2.25, 7.86), (2.25, 7.92), (1.2, 8.06), (0.0, 8.10)]
               if not q.l2 else [(2.11, 7.52), (2.25, 7.90), (0.0, 8.10)], seg, 'M_Body', 'z')
    # fixed-link stub towards the terminal (-Y)
    stub_hw = 1.30
    sp = _loop(stub_hw, FLOOR - 0.40, FLOOR + 2.60, 0.06)
    g += _band([(x, z) for x, z in sp], -3.30, -1.20, 'M_Body')
    g += poly([V(x, -3.30, z) for (x, z) in sp], 'M_Trim')
    g += _band(_loop(stub_hw + 0.06, FLOOR - 0.44, FLOOR + 2.64, 0.06), -3.42, -3.30, 'M_Trim')
    g += poly([V(x, -3.42, z) for (x, z) in _loop(stub_hw + 0.06, FLOOR - 0.44, FLOOR + 2.64, 0.06)], 'M_Trim')
    if not q.l2:
        # stub ribs
        rw, _, _ = ribbed_wall(-3.25, -1.85, FLOOR - 0.10, FLOOR + 2.36, stub_hw, 0.03, 0.30, 'M_Body', q)
        g += _sym(rw)
        # drum windows (rear quarter) and service door at the stair landing
        for ang in (200.0, 340.0):
            a = math.radians(ang)
            c = V(2.15 * math.cos(a), 2.15 * math.sin(a), 6.35)
            t = V(-math.sin(a), math.cos(a), 0)
            pts = [c - t * 0.32 + V(0, 0, -0.55), c + t * 0.32 + V(0, 0, -0.55), c + t * 0.32 + V(0, 0, 0.55),
                   c - t * 0.32 + V(0, 0, 0.55)]
            g += panel(pts, 'M_Glass', offset=0.0, frame=0.05, frame_mat='M_Trim')
        a = math.radians(236.0)
        c = V(2.15 * math.cos(a), 2.15 * math.sin(a), FLOOR + 1.05)
        t = V(-math.sin(a), math.cos(a), 0)
        door = [c - t * 0.46 + V(0, 0, -1.05), c + t * 0.46 + V(0, 0, -1.05), c + t * 0.46 + V(0, 0, 1.05),
                c - t * 0.46 + V(0, 0, 1.05)]
        g += panel(door, 'M_Trim', offset=0.0, frame=0.05, frame_mat='M_Trim', frame_offset=0.02)
        if q.l0:
            n = V(math.cos(a), math.sin(a), 0)
            win = [c - t * 0.2 + V(0, 0, 0.35), c + t * 0.2 + V(0, 0, 0.35), c + t * 0.2 + V(0, 0, 0.8),
                   c - t * 0.2 + V(0, 0, 0.8)]
            g += panel(win, 'M_Glass', offset=0.012)
            g += tube([c + t * 0.32 + n * 0.02, c + t * 0.32 + n * 0.08], 0.012, 4, 'M_Metal')
        # flood lights on the drum facing the apron
        for ang in (55.0, 125.0):
            a = math.radians(ang)
            c = V(2.22 * math.cos(a), 2.22 * math.sin(a), 7.62)
            g += box(0.30, 0.22, 0.14, tuple(c + V(math.cos(a), math.sin(a), 0) * 0.08), 'M_Trim',
                     bevel=q.bev(0.02), seg=q.seg(1, 1))
            g += round_lamp(tuple(c + V(math.cos(a), math.sin(a), 0) * 0.19 + V(0, 0, -0.02)),
                            (math.cos(a), math.sin(a), -0.35), 0.09, q, 'warm', housing=None)
    # service stairs (two flights, rear-left quadrant)
    g += service_stairs(q)
    return g


def _saw_stairs(x0, x1, yc, z_at_x0, z_at_x1, width, n=13):
    """LOD1 stair flight: stepped (sawtooth) profile extruded across the flight width."""
    pts = []
    up = z_at_x1 > z_at_x0
    zlo, zhi = min(z_at_x0, z_at_x1), max(z_at_x0, z_at_x1)
    dz = (zhi - zlo) / n
    dx = (x1 - x0) / n
    # profile in (x, z): step tops from the low end to the high end
    xs = [x0 + dx * k for k in range(n + 1)]
    if not up:
        xs = xs[::-1]
    for k in range(n):
        xa, xb = xs[k], xs[k + 1]
        z = zlo + dz * (k + 1)
        pts += [(xa, z), (xb, z)]
    pts.append((xs[-1], zhi - 0.25))
    pts.append((xs[0], zlo - 0.25))
    pp = [(p[0], p[1]) for p in pts]
    from .geo import prism as _prism
    g = _prism([(x, z) for (x, z) in pp], 'y', yc - width / 2, yc + width / 2, 'M_Metal')
    return g


def service_stairs(q):
    """Two-flight switchback service stair from the apron to the rotunda door (rear-left)."""
    g = Geo()
    lw = 1.10
    L1 = (-2.21, -2.97, -0.91, -1.67)      # top landing in front of the door (z = FLOOR)
    L2 = (-6.81, -4.12, -5.61, -1.87)      # mid landing (z = FLOOR / 2)
    for (x0, y0, x1, y1), z in ((L1, FLOOR), (L2, FLOOR / 2)):
        g += box_minmax(x0, y0, z - 0.12, x1, y1, z, 'M_Metal')
        if not q.l2:
            g += box_minmax(x0, y0, z - 0.24, x1, y0 + 0.08, z - 0.12, 'M_Trim')
            g += box_minmax(x0, y1 - 0.08, z - 0.24, x1, y1, z - 0.12, 'M_Trim')
        for (px, py) in ((x0 + 0.1, y0 + 0.1), (x1 - 0.1, y0 + 0.1), (x0 + 0.1, y1 - 0.1), (x1 - 0.1, y1 - 0.1)):
            if math.hypot(px, py) < 2.25 or q.l2:
                continue
            g += box_minmax(px - 0.06, py - 0.06, 0.0, px + 0.06, py + 0.06, z - 0.12, 'M_Trim')
    if q.l1:
        g += _saw_stairs(-5.61, -2.21, -2.42, FLOOR / 2, FLOOR, lw)
        g += _saw_stairs(-5.61, -2.21, -3.57, FLOOR / 2, 0.0, lw)
        for yy in (-2.42, -3.57):
            for sx in (-1, 1):
                y = yy + sx * (lw / 2 + 0.03)
                if yy == -2.42:
                    a, b = V(-5.61, y, FLOOR / 2 + 1.0), V(-2.21, y, FLOOR + 1.0)
                else:
                    a, b = V(-5.61, y, FLOOR / 2 + 1.0), V(-2.21, y, 1.0)
                g += tube([a, b], 0.022, 3, 'M_Metal', cap=False)
    else:
        g += stair_flight((-5.61, -2.42, FLOOR / 2), (-2.21, -2.42, FLOOR), lw, q, rails=(True, True))
        g += stair_flight((-2.21, -3.57, 0.0), (-5.61, -3.57, FLOOR / 2), lw, q, rails=(True, True))
    if not q.l2:
        g += guard_rail([(-0.95, -2.97, FLOOR), (-2.21, -2.97, FLOOR)], q, h=1.05)
        g += guard_rail([(-2.21, -1.67, FLOOR), (-1.45, -1.67, FLOOR)], q, h=1.05)
        g += guard_rail([(-5.61, -1.87, FLOOR / 2), (-6.81, -1.87, FLOOR / 2), (-6.81, -4.12, FLOOR / 2),
                         (-5.61, -4.12, FLOOR / 2)], q, h=1.05)
    return g


# ------------------------------------------------------------------- cab
def _u_loop(hw, zb, zt, r, seg):
    """Open U outline (x,z) from bottom-left up, across the top and down to bottom-right."""
    pts = [(-hw, zb)]
    for k in range(seg + 1):
        a = math.pi - (math.pi / 2) * k / seg
        pts.append((-hw + r + r * math.cos(a), zt - r + r * math.sin(a)))
    for k in range(seg + 1):
        a = math.pi / 2 - (math.pi / 2) * k / seg
        pts.append((hw - r + r * math.cos(a), zt - r + r * math.sin(a)))
    pts.append((hw, zb))
    return pts


def bellows(q, y0, y1, hw_out, hw_in, zb, zt_out, zt_in, folds=7):
    g = Geo()
    cseg = q.n(3, 2, 1, lo=1)
    out = _u_loop(hw_out, zb, zt_out, 0.28, cseg)
    inn = _u_loop(hw_in, zb, zt_in, 0.18, cseg)
    nrings = folds * 2 + 1 if not q.l2 else 2
    rings = []
    for k in range(nrings):
        t = k / (nrings - 1)
        y = y0 + (y1 - y0) * t
        o = 0.10 if (k % 2 == 1 and not q.l2) else 0.0
        ring = []
        for i, (x, z) in enumerate(out):
            # outward normal of the U at this point
            if i == 0 or i == len(out) - 1:
                nx, nz = (-1 if x < 0 else 1), 0.0
            else:
                ax, az = out[i - 1]
                bx, bz = out[i + 1]
                tx, tz = bx - ax, bz - az
                ln = math.hypot(tx, tz)
                nx, nz = -tz / ln, tx / ln
                # ensure outward (away from opening centre)
                if nx * x + nz * (z - zb - 1.0) < 0:
                    nx, nz = -nx, -nz
            ring.append(V(x + nx * o, y, z + nz * o))
        rings.append(ring)
    for k in range(nrings - 1):
        A, B = rings[k], rings[k + 1]
        for i in range(len(out) - 1):
            g += quad(A[i], A[i + 1], B[i + 1], B[i], 'M_Rubber')
    # inner liner (faces into the door opening)
    for i in range(len(inn) - 1):
        a, b = inn[i], inn[i + 1]
        g += quad(V(a[0], y1, a[1]), V(b[0], y1, b[1]), V(b[0], y0, b[1]), V(a[0], y0, a[1]), 'M_Rubber')
    # front contact pad (U-shaped frame facing the fuselage)
    pad = 0.10
    for i in range(len(out) - 1):
        a, b = out[i], out[i + 1]
        c, d = inn[i + 1], inn[i]
        g += quad(V(a[0], y1, a[1]), V(b[0], y1, b[1]), V(c[0], y1, c[1]), V(d[0], y1, d[1]), 'M_Rubber')
    return g


def cab(q, glass=False):
    g = Geo()
    seg = q.n(32, 14, 8)
    R = 1.60
    zb, zt = -0.42, 2.62
    # rotating drum around the pivot
    g += lathe([(R, zb), (R, zt)], seg, 'M_Body', 'z')
    g += lathe([(0.0, zb), (R, zb)], seg, 'M_Trim', 'z')
    if not q.l2:
        g += lathe([(R - 0.01, 0.95), (R + 0.04, 0.95), (R + 0.04, 1.05), (R - 0.01, 1.05)], seg, 'M_Trim', 'z')
        g += lathe([(R - 0.01, zb), (R + 0.03, zb), (R + 0.03, zb + 0.22), (R - 0.01, zb + 0.22)], seg, 'M_Trim', 'z')
    g += lathe([(R + 0.06, zt), (R + 0.06, zt + 0.08), (0.0, zt + 0.12)], seg, 'M_Trim', 'z')
    # head: chamfered plan prism
    hw, yb, yf, ch = 1.72, 0.10, 2.30, 0.45
    plan = [(-hw, yb), (hw, yb), (hw, yf - ch), (hw - ch, yf), (-hw + ch, yf), (-hw, yf - ch)]
    g += prism(plan, 'z', zb, zt, 'M_Body', bevel=q.bev(0.05, 0.03), seg=q.seg(2, 1))
    # roof cap over the head
    plan_r = [(-hw - 0.05, yb - 0.05), (hw + 0.05, yb - 0.05), (hw + 0.05, yf - ch), (hw - ch + 0.03, yf + 0.06),
              (-hw + ch - 0.03, yf + 0.06), (-hw - 0.05, yf - ch)]
    g += prism(plan_r, 'z', zt, zt + 0.10, 'M_Trim', bevel=q.bev(0.02), seg=q.seg(1, 1))
    # corner windows on the chamfers (operator views)
    for sx in (-1, 1):
        a = V(sx * hw, 0, 0) + V(0, yf - ch, 0)
        b = V(sx * (hw - ch), yf, 0)
        d = (b - a)
        lo, hi = 0.85, 2.15
        p0 = a + d * 0.16
        p1 = a + d * 0.84
        pts = [V(p0.x, p0.y, lo), V(p1.x, p1.y, lo), V(p1.x, p1.y, hi), V(p0.x, p0.y, hi)]
        if sx < 0:
            pts = [pts[1], pts[0], pts[3], pts[2]]
        g += panel(pts, 'M_Glass', offset=0.008, frame=0.04 if not q.l2 else 0, frame_mat='M_Rubber')
    # side windows
    for sx in (-1, 1):
        c = (sx * hw, 1.05, 1.55)
        g += panel(rect('+x' if sx > 0 else '-x', c, 0.95, 0.85), 'M_Glass', offset=0.008,
                   frame=0.04 if not q.l2 else 0, frame_mat='M_Rubber')
    # control station bay (left side): small projecting box with its own window
    if not q.l2:
        g += box_minmax(-hw - 0.32, 1.25, 0.70, -hw + 0.02, 1.95, 1.95, 'M_Body', bevel=q.bev(0.04, 0.02),
                        seg=q.seg(2, 1))
        g += panel(rect('+y', (-hw - 0.15, 1.95, 1.40), 0.24, 0.85), 'M_Glass', offset=0.008, frame=0.025,
                   frame_mat='M_Rubber')
        g += panel(rect('-x', (-hw - 0.32, 1.62, 1.40), 0.50, 0.85), 'M_Glass', offset=0.008, frame=0.025,
                   frame_mat='M_Rubber')
        if q.l0:
            g += panel(rect('-z', (-hw - 0.15, 1.62, 0.70), 0.22, 0.45), 'M_Glass', offset=0.008)
    # service door (+X side)
    if q.l0:
        d = rect('+x', (hw, 0.55, 0.95), 0.80, 1.95)
        g += outline(d, 0.015, 'M_Trim', 0.004)
        g += panel(rect('+x', (hw, 0.55, 1.55), 0.42, 0.50), 'M_Glass', offset=0.008)
        g += tube([V(hw + 0.02, 0.85, 0.95), V(hw + 0.07, 0.85, 0.95), V(hw + 0.07, 0.85, 1.25),
                   V(hw + 0.02, 0.85, 1.25)], 0.012, 4, 'M_Metal')
    # floor platform under the canopy + bumper + hazard edge
    by0, by1 = yf, 3.04
    g += box_minmax(-1.36, by0 - 0.05, -0.30, 1.36, by1, 0.0, 'M_Trim', bevel=q.bev(0.02), seg=q.seg(1, 1))
    if not q.l2:
        g += hazard_panel(rect('+y', (0, by1, -0.15), 2.70, 0.26))
        for sx in (-1, 1):
            g += hazard_panel(rect('+x' if sx > 0 else '-x', (sx * 1.36, (by0 + by1) / 2, -0.15), by1 - by0, 0.26))
    g += box_minmax(-1.12, by1, -0.27, 1.12, CAB_DOCK_Y, -0.03, 'M_Rubber', bevel=q.bev(0.05, 0.03), seg=q.seg(2, 1))
    # bellows / flexible canopy + dark doorway / door leaf behind it
    g += bellows(q, yf, by1 - 0.02, 1.30, 0.98, 0.0, 2.52, 2.28, folds=7 if not q.l1 else 3)
    g += panel(rect('+y', (0, yf, 1.12), 1.90, 2.24), 'M_Rubber', offset=0.004)
    if not q.l2:
        g += panel(rect('+y', (0.0, yf, 1.10), 1.05, 2.05), 'M_Trim', offset=0.008)
        g += panel(rect('+y', (0.0, yf, 1.55), 0.55, 0.60), 'M_Glass', offset=0.012)
    # roof equipment: flood lights + beacon
    if not q.l2:
        for sx in (-1, 1):
            c = V(sx * 0.95, yf - 0.10, zt + 0.16)
            g += box(0.32, 0.18, 0.16, tuple(c), 'M_Trim', bevel=q.bev(0.02), seg=q.seg(1, 1))
            g += round_lamp(tuple(c + V(0, 0.091, -0.01)), (0, 1, -0.25), 0.07, q, 'cool', housing=None)
    g += beacon((0.0, 0.6, zt + 0.12), q, r=0.10, h=0.17)
    # under-floor: leveller wheel arm + hose basket
    if not q.l2:
        g += box_minmax(-1.0, 0.3, zb - 0.16, 1.0, 1.9, zb, 'M_Trim')
        if q.l0:
            # PCA hose basket with coiled hose
            g += box_minmax(-1.25, -1.0, zb - 0.62, -0.25, 0.9, zb - 0.58, 'M_Metal')
            for sx in (-1.25, -0.29):
                g += box_minmax(sx, -1.0, zb - 0.62, sx + 0.04, 0.9, zb - 0.16, 'M_Metal')
            for k in range(3):
                z = zb - 0.50 + k * 0.11
                ring = [V(-0.75 + 0.40 * math.cos(TAU * i / 14), -0.05 + 0.85 * math.sin(TAU * i / 14), z)
                        for i in range(14)]
                g += tube(ring + [ring[0]], 0.075, 8, 'M_Rubber', cap=False)
    if glass:
        g += quad(V(-hw + 0.1, yb + 0.1, 0.005), V(hw - 0.1, yb + 0.1, 0.005), V(hw - 0.1, yf - 0.1, 0.005),
                  V(-hw + 0.1, yf - 0.1, 0.005), 'M_Rubber')
    return g


# ------------------------------------------------------------ drive column
def drive_column(q):
    g = Geo()
    Rw, Ww, xw = 0.46, 0.36, 0.66
    # bogie frame
    g += box_minmax(-0.45, -0.62, 0.30, 0.45, 0.62, 1.00, 'M_Body', bevel=q.bev(0.05, 0.03), seg=q.seg(2, 1))
    if not q.l2:
        for sx in (-1, 1):
            # gearbox / motor
            g += cylinder(0.22, 0.20, q.n(14, 8), (sx * 0.45, 0, Rw), 'x' if sx > 0 else '-x', 'M_Trim')
            g += cylinder(0.16, 0.42, q.n(12, 8), (sx * 0.30, -0.35, 0.75), 'y', 'M_Trim')
            # wheel guards with hazard striping
            g += box_minmax(sx * xw - 0.24, -0.62, 0.98, sx * xw + 0.24, 0.62, 1.04, 'M_Body', bevel=q.bev(0.02),
                            seg=q.seg(1, 1))
            g += hazard_box(sx * xw - 0.24, 0.62, 0.70, sx * xw + 0.24, 0.66, 1.04, q)
            g += hazard_box(sx * xw - 0.24, -0.66, 0.70, sx * xw + 0.24, -0.62, 1.04, q)
            for sy in (-1, 1):
                g += box_minmax(sx * xw - 0.24, sy * 0.62 - 0.02, 0.70, sx * xw + 0.24, sy * 0.62 + 0.02, 1.0, 'M_Body')
    # turntable + crossbeam
    g += cylinder(0.58, 0.12, q.n(24, 12, 8), (0, 0, 1.00), 'z', 'M_Trim')
    g += box_minmax(-0.70, -0.32, 1.12, 0.70, 0.32, 1.42, 'M_Body', bevel=q.bev(0.03), seg=q.seg(1, 1))
    # outer sleeves
    for sx in (-1, 1):
        x = sx * 0.42
        g += box_minmax(x - 0.17, -0.17, 1.42, x + 0.17, 0.17, 3.05, 'M_Body', bevel=q.bev(0.02), seg=q.seg(1, 1))
        if not q.l2:
            g += box_minmax(x - 0.20, -0.20, 2.92, x + 0.20, 0.20, 3.10, 'M_Trim', bevel=q.bev(0.01), seg=q.seg(1, 1))
            g += hazard_box(x - 0.175, -0.175, 1.42, x + 0.175, 0.175, 1.82, q)
    if q.l0:
        # electrical cabinet + cable
        g += box_minmax(0.60, -0.15, 1.45, 0.82, 0.15, 2.25, 'M_Trim', bevel=0.02, seg=1)
        g += lamp('+y', (0.0, 0.33, 1.27), 0.18, 0.08, q, 'amber', depth=0.03)
        g += beacon((0.0, -0.25, 1.42), q, r=0.07, h=0.12)
    # wheels (solid tyres)
    for sx in (-1, 1):
        w = wheel((sx * xw, 0.0, Rw), Rw, Ww, q, side=sx, rim=0.55, style='solid', rim_mat='M_Body', nuts=8)
        w.ax = None
        g += w
    return g


def drive_lift(q):
    """Inner columns + yoke; origin at the yoke top (local z = 0)."""
    g = Geo()
    for sx in (-1, 1):
        x = sx * 0.42
        g += box_minmax(x - 0.12, -0.12, -3.90, x + 0.12, 0.12, -0.28, 'M_Metal')
    g += box_minmax(-1.05, -0.32, -0.30, 1.05, 0.32, 0.0, 'M_Body', bevel=q.bev(0.03), seg=q.seg(1, 1))
    if not q.l2:
        g += box_minmax(-0.62, -0.20, -0.42, 0.62, 0.20, -0.30, 'M_Trim')
    return g


# ---------------------------------------------------------------- builder
def make(glass):
    def build(lod, pose):
        q = Q(lod)
        rig = Rig()
        o = rest_origins()
        rig.node('JB_Rotunda', rotunda(q, glass), origin=(0, 0, 0))
        ta = tunnel(q, A_LEN, A_HW, A_Z0, A_Z1, A_CROWN, A_IN_HW, A_IN_TOP, glass, 'A')
        if not q.l2:
            ta += pca_unit(q, 8.6, 11.4, A_Z0)
        rig.node('JB_Tunnel_A', ta.move(*o['A']), origin=o['A'])
        tb = tunnel(q, B_LEN, B_HW, B_Z0, B_Z1, B_CROWN, B_HW - 0.07, B_Z1 - 0.10, glass, 'B', windows=(5.0, 11.8))
        if not q.l2:
            # drive-column mounting frame under B
            tb += box_minmax(-1.10, COLUMN_Y - 0.40, B_Z0 - 0.08, 1.10, COLUMN_Y + 0.40, B_Z0, 'M_Trim')
        rig.node('JB_Tunnel_B', tb.move(*o['B']), origin=o['B'])
        rig.node('JB_DriveColumn', drive_column(q).move(*o['COL']), origin=o['COL'])
        rig.node('JB_DriveColumn_Lift', drive_lift(q).move(*o['LIFT']), origin=o['LIFT'], parent='JB_DriveColumn')
        rig.node('JB_Cab', cab(q, glass).move(*o['CAB']), origin=o['CAB'])
        rig.empty('TUNNEL_A_MOUNT', (0, A_MOUNT, FLOOR), parent='JB_Rotunda')
        rig.empty('TUNNEL_B_RETRACTED', o['A'] + V(0, B_MIN, B_RIDE), parent='JB_Tunnel_A')
        rig.empty('TUNNEL_B_EXTENDED', o['A'] + V(0, B_MAX, B_RIDE), parent='JB_Tunnel_A')
        rig.empty('CAB_PIVOT', o['B'] + V(0, CAB_PIVOT_Y, 0), parent='JB_Tunnel_B')
        rig.empty('DRIVE_COLUMN_MOUNT', o['B'] + V(0, COLUMN_Y, B_Z0 - 0.08), parent='JB_Tunnel_B')
        rig.empty('CAB_DOCK', o['CAB'] + V(0, CAB_DOCK_Y, 0), parent='JB_Cab')
        rig.empty('BEACON', o['CAB'] + V(0, 0.6, 2.9), parent='JB_Cab')
        return rig
    return build


jet_bridge = make(False)
jet_bridge_glass = make(True)
