"""OMAA / AUH Zayed International: Terminal A (midfield, X plan, dune roof) and the ATCC tower.

Original models inspired by the real buildings (KPF Terminal A, ADPi ATCC tower); facts from
data/reference/airports.md (OMAA section):
  * Terminal A: X plan, four piers from a central processor; one continuous undulating metal
    roof ("dune"), pier roofs pulled down at every segment; central hall roof carried on 18
    arches, largest 180 m span / 52 m high; 50 m tall glazed landside facade; roof 319 m wide;
    pier glazing canted outward 14.75 deg.  Plan = OSM relation 20328079 (+ parts).
  * ATCC tower: 109 m (AIP obstacle 115.2 m incl. masts), curved crescent / sail-like blade
    shaft with the control cab on top, on a 5-storey rectangular base building.
"""
import math

import numpy as np

import ap_arch as A
import ap_poly as P2
from ap_geo import Geo, cap, cylinder, lathe, loft, prism, quad, seg_box
from ap_layout import footprint

ICAO = 'OMAA'
TA_IDS = ['osm-r20328079-rest', 'osm-w1246109131', 'osm-w1246109130']
TOWER_IDS = ['osm-w396942818', 'osm-w313959148-rest']

# ---------------------------------------------------------------- parameters
CANT = math.radians(14.75)      # pier glazing canted outward (KPF)
PIER = dict(E_lo=8.5, E_hi=16.5, C_lo=19.0, C_hi=24.5, period=58.0)
HALL_PEAK = 52.0                # Hill / AviationWeek: largest arch 52 m high
N_ARCHES = 18
LOBE_FLOOR, LOBE_ROOF = 5.0, 8.6


def _arch_wave(u):
    """Segment profile along a pier: 0 at the segment joints (roof pulled down), 1 mid-bay."""
    w = 0.5 - 0.5 * np.cos(2 * np.pi * u)
    return w ** 0.6


class TerminalA:
    _inst = None

    @classmethod
    def get(cls):
        if cls._inst is None:
            cls._inst = cls()
        return cls._inst

    def __init__(self):
        P, _ = footprint(ICAO, 'osm-r20328079-rest')
        C, _ = footprint(ICAO, 'osm-w1246109131')
        D, _ = footprint(ICAO, 'osm-w1246109130')
        U = P2.union([P, C, D])[0]
        self.U = P2.ccw(U)
        body, lobes = P2.split_lobes(self.U, 12.0)
        self.body = body
        self.lobes = lobes
        self.C = P2.ccw(C)
        self.D = P2.ccw(D)
        self.A, self.B = P2.edges_of([self.body])
        # landside facade = body boundary along the D sliver (west edge of the hall)
        dA, dB = P2.edges_of([self.D])
        mid = 0.5 * (self.A + self.B)
        dd = P2.seg_query(mid, dA, dB)[0]
        self.land_seg = dd < 4.0
        self.nl_A = self.A[~self.land_seg]
        self.nl_B = self.B[~self.land_seg]
        # hall frame: u along the landside facade, v toward the airside
        d0, d1 = self.D[np.argmin(self.D[:, 1])], self.D[np.argmax(self.D[:, 1])]
        u = (d1 - d0) / np.linalg.norm(d1 - d0)
        v = np.array([u[1], -u[0]])
        if np.dot(v, P2.centroid(self.C) - d0) < 0:
            v = -v
        self.hu, self.hv = u, v
        land = mid[self.land_seg]
        self.hM = land.mean(axis=0)
        self.hM = self.hM - v * 2.0
        # pier axes (root at the hall, tip = centre of the rounded pier end)
        approx = {
            'N': ((-990.0, 2215.0), (-1040.0, 2575.0)),
            'E': ((-700.0, 1990.0), (-251.0, 1889.0)),
            'S': ((-835.0, 1858.0), (-666.0, 1356.0)),
            'W': ((-1080.0, 1915.0), (-1450.0, 1748.0)),
        }
        hub = P2.centroid(self.C)
        self.hub = hub
        self.piers = {}
        for k, (root, tip) in approx.items():
            tip = self._refine_max(np.array(tip), 40.0)
            axis = self._ridge(np.array(root), tip)
            w = P2.sdf(axis, [self.body])
            w = np.clip(P2.laplacian(np.c_[w, w], 3, 0.5, closed=False)[:, 0], 12.0, 60.0)
            line = np.vstack([hub[None], axis])
            wl = np.concatenate([[w[0]], w])
            s = P2.arclength(line, closed=False)
            s_root = s[1]
            L = s[-1] - s_root
            n = max(2, int(round(L / PIER['period'] - 0.5)))
            per = L / (n + 0.5)
            self.piers[k] = dict(line=line, w=wl, s=s, s_root=s_root, period=per, tip=tip,
                                 tip_r=float(w[-1]))

    # ------------------------------------------------------------ helpers
    def _refine_max(self, p, rad):
        g = np.mgrid[-rad:rad + 0.1:2.0, -rad:rad + 0.1:2.0].reshape(2, -1).T + p
        s = P2.sdf(g, [self.body])
        return g[int(np.argmax(s))]

    def _ridge(self, a, b, step=8.0, search=36.0):
        L = np.linalg.norm(b - a)
        d = (b - a) / L
        perp = np.array([-d[1], d[0]])
        n = max(2, int(L / step))
        offs = np.linspace(-search, search, 37)
        pts = []
        for i in range(n + 1):
            c = a + d * (L * i / n)
            cand = c + perp[None] * offs[:, None]
            s = P2.sdf(cand, [self.body])
            pts.append(cand[int(np.argmax(s))])
        pts = np.array(pts)
        pts[0], pts[-1] = a, b
        pts = P2.laplacian(pts, 6, 0.5, closed=False)
        return pts

    # ------------------------------------------------------------ height field
    def pier_field(self, Pts, d_body):
        hs = []
        dists = []
        for k, pr in self.piers.items():
            s, lat, dist, _ = P2.project_polyline(Pts, pr['line'])
            w = np.interp(s, pr['s'], pr['w'])
            t = np.clip(d_body / w, 0.0, 1.0)
            u = (s - pr['s_root']) / pr['period']
            a = np.where(s < pr['s_root'], 0.0, _arch_wave(u))
            E = PIER['E_lo'] + (PIER['E_hi'] - PIER['E_lo']) * a
            Cr = PIER['C_lo'] + (PIER['C_hi'] - PIER['C_lo']) * a ** 0.7
            # narrow piers (N, W ~25-30 m) get a proportionally lower crown
            Cr = E + (Cr - E) * np.clip(w / 26.0, 0.6, 1.0)
            # the rounded pier ends: high glazed rotunda (a == 1 at the tip by construction)
            h = E + (Cr - E) * (1.0 - (1.0 - t) ** 2.2)
            hs.append(h)
            dists.append(dist)
        hs = np.array(hs)
        dists = np.array(dists)
        dmin = dists.min(axis=0)
        wgt = np.exp(-(dists - dmin) / 10.0)
        return (hs * wgt).sum(axis=0) / wgt.sum(axis=0)

    def hall_field(self, Pts):
        rel = Pts - self.hM
        u = rel @ self.hu
        v = rel @ self.hv
        Av = P2.smooth_interp(v, [-30, 0, 70, 130, 210, 290, 360, 430],
                              [44.0, 47.5, 51.0, 52.0, 47.0, 36.0, 26.0, 20.0])
        Sv = P2.smooth_interp(v, [-30, 0, 110, 220, 330, 430], [168, 166, 150, 118, 86, 60])
        x = np.clip(u / Sv, -1.0, 1.0)
        prof = (1.0 - x * x) ** 0.62
        dv = self.arch_spacing
        v0 = self.arch_v0
        ripple = 1.0 - 0.028 * (0.5 - 0.5 * np.cos(2 * np.pi * (v - v0) / dv + np.pi))
        ripple = np.where((v > v0 - dv / 2) & (v < v0 + dv * (N_ARCHES - 0.5)), ripple, 1.0)
        dnl = P2.seg_query(Pts, self.nl_A, self.nl_B)[0]
        F = P2.smoothstep(0.0, 55.0, dnl)
        return Av * prof * ripple * F, u, v

    arch_spacing = 17.0
    arch_v0 = 12.0

    def z(self, Pts):
        Pts = np.asarray(Pts, float).reshape(-1, 2)
        d = np.maximum(P2.sdf(Pts, [self.body]), 0.0)
        hp = self.pier_field(Pts, d)
        hh, _, _ = self.hall_field(Pts)
        return P2.smax(hp, hh, 9.0)

    def landside(self, Pts, tol=4.0):
        dA, dB = P2.edges_of([self.D])
        return P2.seg_query(Pts, dA, dB)[0] < tol


# ======================================================================= Terminal A
def build_terminal_a(lod):
    ta = TerminalA.get()
    zf = ta.z
    land_tol = 4.0

    parts = A.draped_building(
        ta.body, zf, lod, edge_step=4.5, roof_step=5.5, overhang=2.6, fascia=1.3, soffit_drop=0.6,
        base_inset=13.0 * math.tan(CANT), apron_band=5.2, transoms=(9.6, 14.0, 22.0, 30.0, 38.0),
        glass='M_GlassLit', band_mat='M_Dark', mullion_every=1, mullion_w=0.30, mullion_d=0.42,
        keep_corners_deg=35.0, smooth=1)
    R = parts['ring']
    # landside (hall) facade is vertical-ish: pull the base out under the top
    roof = parts['roof']
    geo_main = Geo()
    geo_main += roof
    geo_main += parts['edge']
    geo_main += parts['facade']
    geo_detail = Geo()
    geo_detail += parts['mullions']

    # ---------------------------------------------------------- hall arches (ribs on the roof)
    ribs = Geo()
    sky = Geo()
    hu, hv, hM = ta.hu, ta.hv, ta.hM
    for k in range(N_ARCHES):
        v = ta.arch_v0 + k * ta.arch_spacing
        Sv = float(P2.smooth_interp(v, [-30, 0, 110, 220, 330, 430], [168, 166, 150, 118, 86, 60]))
        us = np.linspace(-Sv * 0.97, Sv * 0.97, 90 if lod == 0 else 40)
        line = hM + np.outer(us, hu) + hv * v
        inside = P2.inside(line, [ta.body]) & (P2.sdf(line, [ta.body]) > 3.5)
        for run in _true_runs(inside):
            if len(run) < 4:
                continue
            seg = line[run]
            zz = zf(seg)
            keep = zz > 20.0
            for r2 in _true_runs(keep):
                if len(r2) < 4:
                    continue
                if lod < 2:
                    ribs += A.drape_strip(seg[r2], zf, 2.0 if lod == 0 else 2.6, 1.1, 1.1, 'M_Structure',
                                          step=4.0 * A.LOD_STEP[lod])
    # skylight bands between the arches (alternate bays), in the high part of the hall
    if lod < 2:
        for k in range(1, N_ARCHES - 1, 2):
            v = ta.arch_v0 + (k + 0.5) * ta.arch_spacing
            Sv = float(P2.smooth_interp(v, [-30, 0, 110, 220, 330, 430], [168, 166, 150, 118, 86, 60]))
            us = np.linspace(-Sv * 0.55, Sv * 0.55, 50)
            line = hM + np.outer(us, hu) + hv * v
            ok = P2.sdf(line, [ta.body]) > 12.0
            for run in _true_runs(ok):
                if len(run) < 4:
                    continue
                sky += A.drape_strip(line[run], zf, 5.0, 0.35, 0.3, 'M_GlassLit', step=5.0 * A.LOD_STEP[lod])
    # skylights along the pier crests (one per bay)
    if lod < 2:
        for key, pr in ta.piers.items():
            line = pr['line']
            s = pr['s']
            per = pr['period']
            nb = int((s[-1] - pr['s_root']) / per)
            for b in range(nb):
                s0 = pr['s_root'] + per * (b + 0.22)
                s1 = pr['s_root'] + per * (b + 0.78)
                ss = np.linspace(s0, s1, 8 if lod == 0 else 4)
                path = P2.polyline_point(line, ss)
                if (P2.sdf(path, [ta.body]) < 8.0).any():
                    continue
                sky += A.drape_strip(path, zf, 4.2, 0.3, 0.3, 'M_GlassLit', step=4.0 * A.LOD_STEP[lod])

    # ---------------------------------------------------------- fixed links (lobes)
    links = Geo()
    nout_body = None
    for lb in ta.lobes:
        ring = lb['ring']
        a, b = lb['neck']
        # outward normal of the neck (toward the lobe tip)
        nn = np.array([b[1] - a[1], -(b[0] - a[0])])
        nn /= max(np.linalg.norm(nn), 1e-9)
        if np.dot(lb['tip'] - (a + b) / 2, nn) < 0:
            nn = -nn
        push = 2.6 + 13.0 * math.tan(CANT) + 2.0
        r2 = ring.copy()
        ia = int(np.argmin(np.linalg.norm(r2 - a, axis=1)))
        ib = int(np.argmin(np.linalg.norm(r2 - b, axis=1)))
        r2[ia] = a - nn * push
        r2[ib] = b - nn * push
        if lod > 0:
            r2 = P2.simplify(r2, 1.2 * lod)
        r2 = P2.ccw(P2.as_ring(r2))
        if len(r2) < 3 or abs(P2.signed_area(r2)) < 20:
            continue
        if lod == 0:
            links += A.walls(r2, LOBE_FLOOR, LOBE_FLOOR + 0.9, 'M_Structure')
            links += A.walls(r2, LOBE_FLOOR + 0.9, LOBE_ROOF - 0.6, 'M_Glass')
            links += A.walls(r2, LOBE_ROOF - 0.6, LOBE_ROOF, 'M_Structure')
            links += cap(r2, LOBE_ROOF, 'M_Roof')
            links += cap(r2, LOBE_FLOOR, 'M_Structure', up=False)
        else:
            links += prism(r2, LOBE_FLOOR, LOBE_ROOF, 'M_Glass', 'M_Roof', 'M_Structure')
        if lod < 2:
            # support / stair core under the rotunda end of the link
            tip = lb['tip']
            cdir = (tip - (a + b) / 2)
            cdir /= max(np.linalg.norm(cdir), 1e-9)
            c = tip - cdir * 4.0
            links += cylinder(c, 1.6, 0.0, LOBE_FLOOR, 10 if lod == 0 else 6, 'M_Concrete', cap0=False, cap1=False)

    out = [('TerminalA_Building', geo_main)]
    det = Geo()
    det += geo_detail
    det += ribs
    out.append(('TerminalA_Structure', det))
    out.append(('TerminalA_Skylights', sky))
    out.append(('TerminalA_Links', links))
    # obstruction lights: hall crown and pier tips
    lights = Geo()
    if lod < 2:
        peak_pts = [ta.hM + ta.hv * v for v in (90.0, 130.0, 170.0)]
        for p in peak_pts:
            lights += A.obstruction_light(p, float(zf(p[None])[0]) + 1.2, 0.7)
        for pr in ta.piers.values():
            p = pr['tip']
            lights += A.obstruction_light(p, float(zf(p[None])[0]) + 1.0, 0.6)
    out.append(('TerminalA_Lights', lights))
    return out


def _true_runs(mask):
    runs = []
    cur = []
    for i, m in enumerate(mask):
        if m:
            cur.append(i)
        elif cur:
            runs.append(np.array(cur))
            cur = []
    if cur:
        runs.append(np.array(cur))
    return runs


# ======================================================================= ATCC tower
TOWER = dict(cab_floor=92.0, cab_top=101.5, roof=104.0, crown=109.0, mast=115.0, core_r=4.3)


def _tower_centre():
    ring, _ = footprint(ICAO, 'osm-w396942818')
    c, r = P2.fit_circle(ring)
    return c, r


def build_tower(lod):
    c, rfoot = _tower_centre()
    base_ring, holes = footprint(ICAO, 'osm-w313959148-rest')
    seg = {0: 40, 1: 20, 2: 10}[lod]
    g = Geo()
    det = Geo()
    glass = Geo()
    # ---- 5-storey technical base building (rectangle around the tower)
    hb = 21.0
    base = P2.ccw(base_ring)
    g += A.walls(base, 0.0, hb + 1.1, 'M_Concrete')
    inner = P2.offset(base, -0.6)
    g += loft([A._c(base, hb + 1.1), A._c(inner, hb + 1.1)], 'M_Structure', closed=True)
    g += A.walls(inner[::-1], hb, hb + 1.1, 'M_Concrete')
    g += cap(inner, hb, 'M_Roof')
    if lod < 2:
        # ribbon windows on every storey (front-only bands pushed out 6 cm)
        nrm, _ = P2.vertex_normals(base)
        for zf in (1.0, 5.2, 9.4, 13.6, 17.8):
            ring = P2.ccw(base)
            lo = np.c_[ring, np.full(len(ring), zf)]
            hi = np.c_[ring, np.full(len(ring), zf + 2.2)]
            nrm2 = P2.vertex_normals(ring)[0]
            glass += A.bands(lo, hi, nrm2, 0.06, 'M_GlassLit', closed=True)
        det += A.rooftop_plant(inner, lambda p: np.full(len(p), hb), 4, 7, lod, size=(6, 11), height=(2.5, 3.5),
                               margin=4.0)
    # ---- concrete core
    H0 = TOWER['cab_floor']
    g += cylinder(c, TOWER['core_r'], hb - 0.5, H0 + 0.5, seg, 'M_Concrete', cap0=False, cap1=False)
    # glazed lift-lobby slot up the core (faces north-west, toward the terminal)
    if lod < 2:
        for brg_slot in (128.0, 218.0, 38.0):   # glazed slots on the three free sides of the core
            az = math.radians(90.0 - brg_slot)
            dd = np.array([math.cos(az), math.sin(az)])
            p = c + dd * (TOWER['core_r'] + 0.05)
            t = np.array([-dd[1], dd[0]])
            pts = [np.r_[p - t * 0.8, hb + 1.5], np.r_[p + t * 0.8, hb + 1.5], np.r_[p + t * 0.8, H0 - 4.5],
                   np.r_[p - t * 0.8, H0 - 4.5]]
            glass += quad(*pts, 'M_GlassLit')
    # ---- the crescent "sail" (dhow sail / curved blade): a thin cambered fin attached along the
    #      core like a sail on a mast; its free edge bows out (crescent in side view) and the tips
    #      meet the core at the base building and under the cab.  It points north-west, toward
    #      Terminal A, so it is seen side-on from the runways and the apron.
    nz = {0: 44, 1: 20, 2: 9}[lod]
    nr = {0: 10, 1: 5, 2: 3}[lod]
    brg = math.radians(308.0)
    d = np.array([math.sin(brg), math.cos(brg)])
    nd = np.array([-d[1], d[0]])
    rc = TOWER['core_r']
    z0s, z1s = hb - 1.0, H0 - 1.2
    zs = np.linspace(z0s, z1s, nz + 1)
    tt = (zs - z0s) / (z1s - z0s)
    reach = 16.5 * np.sin(np.pi * tt) ** 0.65 * (0.70 + 0.40 * tt)
    sections = []
    for k in range(nz + 1):
        r0 = rc - 0.8
        r1 = rc + max(reach[k], 0.5)
        rho = np.linspace(r0, r1, nr + 1)
        f = (rho - r0) / (r1 - r0)
        camber = 3.2 * np.sin(np.pi * f) * min(1.0, reach[k] / 9.0)
        th = (2.8 - 1.9 * f) * (0.6 + 0.4 * min(1.0, reach[k] / 6.0))
        centre = c + np.outer(rho, d) + np.outer(camber, nd)
        left = centre + nd * (th / 2)[:, None]
        right = centre - nd * (th / 2)[:, None]
        ring = np.vstack([right, left[::-1]])
        sections.append(np.c_[ring, np.full(len(ring), zs[k])])
    # both ends are buried (base building roof / cab underside): no caps needed
    g += loft(sections, 'M_Structure', closed=True)
    # ---- control cab: service ring, outward-leaning glazing, roof disc, crown, mast
    zc0, zc1, zr = TOWER['cab_floor'], TOWER['cab_top'], TOWER['roof']
    g += lathe([(0.0, zc0 - 3.5), (7.0, zc0 - 3.4), (10.6, zc0 - 0.6), (11.0, zc0)], seg, (c[0], c[1], 0),
               'M_Structure')
    g += lathe([(11.0, zc0), (11.0, zc0 + 1.0)], seg, (c[0], c[1], 0), 'M_Dark')
    glass += lathe([(11.0, zc0 + 1.0), (12.4, zc1)], seg, (c[0], c[1], 0), 'M_GlassLit')
    if lod < 2:
        nm = {0: 24, 1: 12}[lod]
        for i in range(nm):
            a = 2 * math.pi * i / nm
            p0 = np.array([c[0] + 11.05 * math.cos(a), c[1] + 11.05 * math.sin(a), zc0 + 1.0])
            p1 = np.array([c[0] + 12.45 * math.cos(a), c[1] + 12.45 * math.sin(a), zc1])
            det += seg_box(p0, p1, 0.22, 0.22, 'M_Structure')
    g += lathe([(12.4, zc1), (13.6, zc1 + 0.4), (13.6, zr - 0.9), (12.0, zr), (0.0, zr + 0.4)], seg,
               (c[0], c[1], 0), 'M_Structure')
    # crown: radome / equipment drum and mast
    g += lathe([(5.0, zr + 0.2), (5.0, zr + 2.4), (3.6, TOWER['crown'] - 1.6), (0.0, TOWER['crown'])], seg // 2,
               (c[0], c[1], 0), 'M_Structure', cap0=True)
    g += cylinder(c, 0.35, TOWER['crown'] - 0.5, TOWER['mast'], 8, 'M_Structure', r1=0.12)
    lights = Geo()
    if lod < 2:
        lights += A.obstruction_light(c, TOWER['mast'] + 0.3, 0.45)
        for i in range(4):
            a = math.pi / 4 + i * math.pi / 2
            lights += A.obstruction_light(c + 13.3 * np.array([math.cos(a), math.sin(a)]), zr - 0.2, 0.4)
    out = [('ATCC_Tower', g), ('ATCC_Glazing', glass), ('ATCC_Details', det), ('ATCC_Lights', lights)]
    return out


ASSETS = [
    dict(name='OMAA_terminal_a', icao=ICAO, title='Zayed International Terminal A (midfield, X plan, dune roof)',
         replaces=TA_IDS, build=build_terminal_a, lods=(0, 1, 2),
         preview=dict(target=(-860.0, 1960.0, 12.0), dist=1900.0, az=232.0, el=27.0,
                      hero=dict(target=(-1040.0, 2090.0, 30.0), dist=640.0, az=296.0, el=13.0),
                      night=dict(target=(-930.0, 2000.0, 20.0), dist=1250.0, az=280.0, el=20.0))),
    dict(name='OMAA_tower', icao=ICAO, title='Zayed International ATCC tower (crescent sail shaft) and base building',
         replaces=TOWER_IDS, build=build_tower, lods=(0, 1, 2),
         preview=dict(target=(410.0, 953.0, 52.0), dist=430.0, az=228.0, el=9.0,
                      hero=dict(target=(410.0, 953.0, 88.0), dist=170.0, az=240.0, el=8.0))),
]
