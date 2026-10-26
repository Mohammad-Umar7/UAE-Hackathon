"""OMDB / DXB Dubai International: Concourses A-D, Terminals 1-3 and the ATC tower.

Original models inspired by the real buildings; facts from data/reference/airports.md (OMDB):
  * Concourse A: 645 x 90.8 m, 42 m, long vaulted / arched metal roof (Dubai Airports fact file)
  * Concourse B: 924 m, 90.8 m wide at the middle tapering to 56 m at the ends, 39.5 m, structural
    steel vaulted roof (BG&E), ~70,000 m2 standing-seam roofing
  * Concourse C: 780.8 x 66.8 m (2000), lower (OSM 22 m); Concourse D: 700 x 144 m, 27 m (2016),
    linear pier around a central atrium
  * Terminal 1: rectangular landside processor 502 x 125 m, 3 floors, 1971 ogee arches retained
  * Terminal 2: low single-storey terminal; Terminal 3: landside processor mostly below the apron,
    OSM maps only a ~299 x 25 m above-ground strip
  * ATC tower: 89 m (AIP obstacle 85.6 m), buttressed central column with arched "wings" and a
    multilevel cab, at the junction of Concourses B and C
"""
import math

import numpy as np

import ap_arch as A
import ap_poly as P2
from ap_geo import Geo, cylinder, lathe, loft, seg_box
from ap_layout import footprint

ICAO = 'OMDB'


def _ring(bid):
    return P2.ccw(footprint(ICAO, bid)[0])


def _sec(ring, ds=2.0, axis=None):
    c, u, L, W = P2.min_rect(ring)
    if axis is not None:
        u = np.asarray(axis, float)
    return A.Sections(ring, u, c, ds), c, u, L, W


def _wmax(sec):
    return max((b - a) / 2 for iv in sec.iv for (a, b) in iv)


def _ribs(sec, zf, spacing, lod, width=1.6, lift=0.9, margin=1.6, start=None):
    g = Geo()
    if lod >= 2:
        return g, []
    s0 = sec.s0 + (spacing / 2 if start is None else start)
    st = list(np.arange(s0, sec.s1 - 4.0, spacing * (2 if lod == 1 else 1)))
    for s in st:
        k = int(np.clip(round((s - sec.st[0]) / sec.ds), 0, len(sec.st) - 1))
        for (a, b) in sec.iv[k]:
            if b - a < 8:
                continue
            ts = np.linspace(a + margin, b - margin, 24 if lod == 0 else 12)
            path = np.array([sec.point(s, t) for t in ts])
            g += A.drape_strip(path, zf, width * (1.3 if lod else 1.0), lift, lift, 'M_Structure', step=3.0)
    return g, st


def _crown_path(sec, s_from, s_to, n=12):
    ss = np.linspace(s_from, s_to, n)
    pts = []
    for s in ss:
        k = int(np.clip(round((s - sec.st[0]) / sec.ds), 0, len(sec.st) - 1))
        a, b = max(sec.iv[k], key=lambda ab: ab[1] - ab[0])
        pts.append(sec.point(s, (a + b) / 2))
    return np.array(pts)


def _skylights(sec, zf, ribs_st, width, lod, gap=3.0, lift=0.35):
    g = Geo()
    if lod >= 2 or len(ribs_st) < 2:
        return g
    for s_a, s_b in zip(ribs_st[:-1], ribs_st[1:]):
        path = _crown_path(sec, s_a + gap, s_b - gap, 8)
        g += A.drape_strip(path, zf, width, lift, lift, 'M_GlassLit', step=4.0 * A.LOD_STEP[lod])
    return g


# ===================================================================== concourses A and B
def _vault_concourse(bid, lod, *, E_mid, C_mid, E_end, rib=24.0, transoms=(12.0, 17.5), apron=6.0, sky=7.0,
                     extra_rings=(), plant=0, seed=1):
    ring = _ring(bid)
    sec, c, u, L, W = _sec(ring)
    wmax = _wmax(sec)

    def E_fn(s, w):
        k = np.clip(w / wmax, 0.0, 1.0)
        return E_end + (E_mid - E_end) * k ** 0.9

    def C_fn(s, w):
        k = np.clip(w / wmax, 0.0, 1.0)
        return E_fn(s, w) + (C_mid - E_mid) * k ** 1.15

    zf = A.vault_z(sec, E_fn, C_fn, flat_top=0.05)
    parts = A.draped_building(ring, zf, lod, edge_step=4.5, roof_step=5.5, overhang=3.2, fascia=1.2,
                              soffit_drop=0.5, apron_band=apron, transoms=transoms, mullion_every=1,
                              keep_corners_deg=25.0)
    main = Geo()
    for k in ('roof', 'edge', 'facade'):
        main += parts[k]
    ribs, st = _ribs(sec, zf, rib, lod)
    struct = Geo()
    struct += parts['mullions']
    struct += ribs
    if lod < 2:
        struct += A.facade_fins_at(parts, sec, st, 1.1, 1.1, 'M_Structure')
    sky_g = _skylights(sec, zf, st, sky, lod)
    struct += A.bridge_stubs(ICAO, parts['ring'], parts['facade_base'], lod)
    return main, struct, sky_g, sec, zf, parts


def build_concourse_a(lod):
    main, struct, sky, sec, zf, parts = _vault_concourse('osm-w231888210', lod, E_mid=24.0, C_mid=42.0, E_end=24.0,
                                                         rib=24.0, transoms=(12.0, 18.0))
    lights = Geo()
    if lod < 2:
        for f in (0.15, 0.5, 0.85):
            p = _crown_path(sec, sec.s0 + (sec.s1 - sec.s0) * f, sec.s0 + (sec.s1 - sec.s0) * f + 1, 2)[0]
            lights += A.obstruction_light(p, float(zf(p[None])[0]) + 1.6, 0.6)
    return [('ConcourseA_Building', main), ('ConcourseA_Structure', struct), ('ConcourseA_Skylights', sky),
            ('ConcourseA_Lights', lights)]


def build_concourse_b(lod):
    main, struct, sky, sec, zf, parts = _vault_concourse('osm-w87185819', lod, E_mid=23.0, C_mid=39.5, E_end=17.0,
                                                         rib=26.0, transoms=(12.0, 17.0))
    # annex on the south-west side (OSM way 742271052): connection building, flat roof
    annex = Geo()
    ring = _ring('osm-w742271052')
    pa = A.draped_building(ring, lambda P: np.full(len(P), 19.0), lod, edge_step=4.5, roof_step=30.0,
                           overhang=1.2, fascia=1.0, apron_band=1.2, transoms=(7.0, 13.0), band_mat='M_Concrete')
    for k in ('roof', 'edge', 'facade', 'mullions'):
        annex += pa[k]
    if lod < 2:
        annex += A.rooftop_plant(pa['facade_top'], lambda P: np.full(len(P), 19.0), 3, 11, lod, size=(6, 10))
    lights = Geo()
    if lod < 2:
        for f in (0.1, 0.5, 0.9):
            p = _crown_path(sec, sec.s0 + (sec.s1 - sec.s0) * f, sec.s0 + (sec.s1 - sec.s0) * f + 1, 2)[0]
            lights += A.obstruction_light(p, float(zf(p[None])[0]) + 1.6, 0.6)
    return [('ConcourseB_Building', main), ('ConcourseB_Structure', struct), ('ConcourseB_Skylights', sky),
            ('ConcourseB_Annex', annex), ('ConcourseB_Lights', lights)]


# ===================================================================== Concourse C
def build_concourse_c(lod):
    ring = _ring('osm-w10315513')
    sec, c, u, L, W = _sec(ring)
    zf = A.vault_z(sec, lambda s, w: np.full(len(s), 15.5), lambda s, w: np.full(len(s), 19.0), flat_top=0.3)
    parts = A.draped_building(ring, zf, lod, edge_step=4.5, roof_step=7.0, overhang=2.4, fascia=1.4,
                              soffit_drop=0.4, apron_band=5.0, transoms=(9.5,), mullion_every=1,
                              keep_corners_deg=25.0, simplify_tol=0.8)
    main = Geo()
    for k in ('roof', 'edge', 'facade'):
        main += parts[k]
    struct = Geo()
    struct += parts['mullions']
    struct += A.bridge_stubs(ICAO, parts['ring'], parts['facade_base'], lod)
    # raised clerestory lantern along the spine (the 22 m crown), broken into long segments
    if lod < 2:
        seg_len = 96.0
        s = sec.s0 + 30.0
        while s + 20 < sec.s1 - 30.0:
            e = min(s + seg_len, sec.s1 - 30.0)
            path = _crown_path(sec, s, e, 10)
            struct += A.crown_lantern(path, zf, 11.0, 2.2, 0.9, lod)
            s = e + 10.0
    if lod < 2:
        struct += A.rooftop_plant(parts['facade_top'], zf, 10 if lod == 0 else 5, 21, lod, size=(7, 13),
                                  height=(2.2, 3.4), margin=4.0, axis=u)
    lights = Geo()
    if lod < 2:
        for f in (0.08, 0.5, 0.92):
            p = _crown_path(sec, sec.s0 + (sec.s1 - sec.s0) * f, sec.s0 + (sec.s1 - sec.s0) * f + 1, 2)[0]
            lights += A.obstruction_light(p, float(zf(p[None])[0]) + 4.0, 0.6)
    return [('ConcourseC_Building', main), ('ConcourseC_Structure', struct), ('ConcourseC_Lights', lights)]


# ===================================================================== Concourse D
def _airside_v(ring, c, u, radius=260.0):
    """Unit vector across the long axis pointing to the apron (mean of nearby contact stands)."""
    from ap_layout import layout
    v = np.array([-u[1], u[0]])
    pts = np.array([(s['x'], s['y']) for s in layout(ICAO)['stands'] if s.get('contact')
                    and np.hypot(s['x'] - c[0], s['y'] - c[1]) < max(radius, 0.6 * P2.perimeter(ring) / 2)])
    if len(pts) and np.dot(pts.mean(axis=0) - c, v) < 0:
        v = -v
    return v


def build_concourse_d(lod):
    """Linear pier (airside band, shallow vault) + higher central atrium block on the landside."""
    ring = _ring('osm-w302538629')
    c, u, L, W = P2.min_rect(ring)
    v = _airside_v(ring, c, u)
    S = (ring - c) @ u
    T = (ring - c) @ v
    t_air = float(np.percentile(T, 92))
    Wp = 46.0
    t_mid = t_air - Wp / 2
    E, Cp = 17.0, 22.5
    H = Cp - E
    Rv = ((Wp / 2) ** 2 + H * H) / (2 * H)
    # atrium = the large landside bulge in the middle of the pier
    deep = T < t_air - Wp - 6.0
    ss = np.sort(S[deep])
    groups = np.split(ss, np.where(np.diff(ss) > 40.0)[0] + 1)
    grp = max(groups, key=lambda g_: g_[-1] - g_[0])
    sa, sb = float(grp[0]), float(grp[-1])
    rA, rB = P2.edges_of([ring])

    def zf(P):
        P = np.asarray(P, float).reshape(-1, 2)
        s = (P - c) @ u
        t = (P - c) @ v
        x = np.clip(np.abs(t - t_mid), 0.0, Wp / 2)
        zp = E + np.sqrt(np.maximum(Rv * Rv - x * x, 0.0)) - (Rv - H)
        zp = np.where(t < t_air - Wp, E, zp)
        d = np.maximum(P2.seg_query(P, rA, rB)[0], 0.0)
        win = P2.smoothstep(sa - 6.0, sa + 30.0, s) * (1.0 - P2.smoothstep(sb - 30.0, sb + 6.0, s))
        za = E + 10.0 * P2.smoothstep(2.0, 34.0, d) ** 0.8 * win
        return P2.smax(zp, za, 3.0)

    parts = A.draped_building(ring, zf, lod, edge_step=4.5, roof_step=5.0, overhang=3.0, fascia=1.2,
                              soffit_drop=0.4, apron_band=5.5, transoms=(11.0,), mullion_every=1,
                              keep_corners_deg=25.0, simplify_tol=0.6)
    main = Geo()
    for k in ('roof', 'edge', 'facade'):
        main += parts[k]
    struct = Geo()
    struct += parts['mullions']
    struct += A.bridge_stubs(ICAO, parts['ring'], parts['facade_base'], lod)
    sky = Geo()
    if lod < 2:
        # transverse ribs across the pier band
        for s in np.arange(S.min() + 14.0, S.max() - 10.0, 20.0 * (2 if lod else 1)):
            ts = np.linspace(t_air - Wp + 2.0, t_air - 2.5, 14)
            path = np.array([c + u * s + v * t for t in ts])
            ok = P2.sdf(path, [ring]) > 1.5
            for run in _true_runs(ok):
                if len(run) >= 3:
                    struct += A.drape_strip(path[run], zf, 1.2, 0.6, 0.6, 'M_Structure', step=3.0)
        # linear rooflight along the pier crown and a big glazed lantern over the atrium
        for s0 in np.arange(S.min() + 24.0, S.max() - 24.0, 40.0):
            if sa - 20 < s0 < sb + 20:
                continue
            path = np.array([c + u * s + v * t_mid for s in (s0, s0 + 16.0)])
            if (P2.sdf(path, [ring]) > 6).all():
                sky += A.drape_strip(path, zf, 5.0, 0.35, 0.35, 'M_GlassLit', step=4.0)
        ta = 0.5 * (t_air - Wp + float(T[deep].min())) if deep.any() else t_mid
        ta = 0.5 * (ta + t_mid)
        path = np.array([c + u * s + v * ta for s in np.linspace(sa + 26.0, sb - 26.0, 10)])
        sky += A.drape_strip(path, zf, 26.0, 0.45, 0.45, 'M_GlassLit', step=4.0)
        struct += A.rooftop_plant(parts['facade_top'], zf, 8 if lod == 0 else 4, 31, lod, size=(6, 11),
                                  height=(2.0, 3.0), margin=5.0, axis=u)
    return [('ConcourseD_Building', main), ('ConcourseD_Structure', struct), ('ConcourseD_Skylights', sky)]


def _true_runs(mask):
    runs, cur = [], []
    for i, m in enumerate(mask):
        if m:
            cur.append(i)
        elif cur:
            runs.append(np.array(cur))
            cur = []
    if cur:
        runs.append(np.array(cur))
    return runs


# ===================================================================== Terminals 1, 2, 3
def _landside_edge(ring, sec, side):
    """Plan polyline of the long facade on one side (side = +1: +v, -1: -v) of the axis."""
    R = A.edge_loop(ring, 4.0, 25.0, simplify_tol=1.0)
    s, t = sec.local(R)
    _, _, _, tm = sec.query(R)
    sel = np.sign(t - tm) == side
    idx = np.where(sel)[0]
    if len(idx) < 2:
        return None
    # keep the longest contiguous run along the ring
    runs = A._runs(sel)
    run = max(runs, key=len)
    line = R[run]
    if np.dot(line[-1] - line[0], sec.u) < 0:
        line = line[::-1]
    return line


def _kerb(ring, sec, side, lod, step=9.0):
    """Landside facade line (resampled) and its outward normals."""
    line = _landside_edge(ring, sec, side)
    if line is None:
        return None, None
    line = P2.resample(line, step if lod == 0 else 2 * step, closed=False)
    t = P2.tangents(line, closed=False)
    out = np.stack([t[:, 1], -t[:, 0]], axis=1)
    if np.dot(out.mean(axis=0), sec.v * side) < 0:
        out = -out
    return line, out


def _kerb_canopy(line, out, depth, z, lod, offset=2.0, col_every=18.0):
    t = P2.tangents(line, closed=False)
    right = np.stack([t[:, 1], -t[:, 0]], axis=1)
    side = 1 if np.dot(right.mean(axis=0), out.mean(axis=0)) > 0 else -1
    return A.canopy_line(line + out * offset, depth, z, 0.9, lod, side=side, col_every=col_every)


def _landside_side(ring, sec, c, u):
    """+1 / -1: the long side of the building facing away from its stands (the kerb side)."""
    v_air = _airside_v(ring, c, u, radius=420.0)
    return -1 if np.dot(v_air, sec.v) > 0 else 1


def build_terminal_1(lod):
    ring = _ring('osm-w98425196')
    sec, c, u, L, W = _sec(ring)
    zf = A.vault_z(sec, lambda s, w: np.full(len(s), 19.0), lambda s, w: np.full(len(s), 21.5), flat_top=0.4)
    parts = A.draped_building(ring, zf, lod, edge_step=4.5, roof_step=14.0, overhang=2.0, fascia=1.8,
                              soffit_drop=0.3, apron_band=1.0, transoms=(6.5, 12.5), band_mat='M_Concrete',
                              mullion_every=1, keep_corners_deg=25.0, simplify_tol=1.0)
    main = Geo()
    for k in ('roof', 'edge', 'facade'):
        main += parts[k]
    struct = Geo()
    struct += parts['mullions']
    # landside: the side facing away from Concourse C (south-west), canopy + ogee-arch colonnade
    cc = P2.centroid(_ring('osm-w10315513'))
    side = -1 if np.dot(cc - c, sec.v) > 0 else 1
    line, out = _kerb(ring, sec, side, lod)
    if line is not None:
        struct += _kerb_canopy(line, out, 14.0, 10.5, lod)
        if lod < 2:
            # ogee-arch colonnade (the 1971 building's motif): free-standing columns + arch heads
            for i in range(len(line)):
                tg = np.array([-out[i][1], out[i][0]])
                struct += A.obox(line[i] + out[i] * 1.2, tg, 0.8, 0.9, 0.0, 4.05, 'M_Structure', bottom=False)
            for i in range(len(line) - 1):
                a = line[i] + out[i] * 1.2
                b = line[i + 1] + out[i] * 1.2
                struct += A.arch_frame(a, b, 4.5, 4.02, 0.6, 0.76, 'M_Structure', curve='ogee', n=8 if lod == 0 else 4,
                                       legs=0.0, nout=out[i])
    struct += A.rooftop_plant(parts['facade_top'], zf, 12 if lod == 0 else 6, 41, lod, size=(8, 16),
                              height=(2.5, 4.0), margin=6.0, axis=u)
    return [('Terminal1_Building', main), ('Terminal1_Structure', struct)]


def build_terminal_2(lod):
    ring = _ring('osm-w98425234')
    sec, c, u, L, W = _sec(ring)
    zf = A.vault_z(sec, lambda s, w: np.full(len(s), 11.5), lambda s, w: np.full(len(s), 14.0), flat_top=0.3)
    parts = A.draped_building(ring, zf, lod, edge_step=4.5, roof_step=14.0, overhang=3.0, fascia=1.2,
                              soffit_drop=0.3, apron_band=0.8, transoms=(5.5,), band_mat='M_Concrete',
                              mullion_every=1, keep_corners_deg=25.0, simplify_tol=1.0)
    main = Geo()
    for k in ('roof', 'edge', 'facade'):
        main += parts[k]
    struct = Geo()
    struct += parts['mullions']
    ribs, st = _ribs(sec, zf, 18.0, lod, width=1.0, lift=0.5)
    struct += ribs
    line, out = _kerb(ring, sec, _landside_side(ring, sec, c, u), lod)
    if line is not None:
        struct += _kerb_canopy(line, out, 11.0, 7.5, lod, offset=3.0)
    struct += A.rooftop_plant(parts['facade_top'], zf, 10 if lod == 0 else 5, 51, lod, size=(6, 12),
                              height=(2.0, 3.0), margin=5.0, axis=u)
    return [('Terminal2_Building', main), ('Terminal2_Structure', struct)]


def build_terminal_3(lod):
    ring = _ring('osm-w98425182')
    sec, c, u, L, W = _sec(ring)
    zf = A.vault_z(sec, lambda s, w: np.full(len(s), 12.0), lambda s, w: np.full(len(s), 18.0), flat_top=0.05)
    parts = A.draped_building(ring, zf, lod, edge_step=4.0, roof_step=4.5, overhang=2.0, fascia=1.0,
                              soffit_drop=0.3, apron_band=0.0, transoms=(4.5, 8.5), mullion_every=1,
                              keep_corners_deg=25.0)
    main = Geo()
    for k in ('roof', 'edge', 'facade'):
        main += parts[k]
    struct = Geo()
    struct += parts['mullions']
    ribs, st = _ribs(sec, zf, 12.0, lod, width=0.9, lift=0.6, margin=0.8)
    struct += ribs
    line, out = _kerb(ring, sec, _landside_side(ring, sec, c, u), lod, step=8.0)
    if line is not None:
        struct += _kerb_canopy(line, out, 12.0, 8.5, lod, offset=2.0, col_every=16.0)
    return [('Terminal3_Building', main), ('Terminal3_Structure', struct)]


# ===================================================================== ATC tower
TOWER = dict(podium=22.0, col_r=4.6, shaft_top=71.0, cab0=73.5, cab1=81.0, roof=83.0, top=89.0)


def build_tower(lod):
    seg = {0: 40, 1: 20, 2: 10}[lod]
    tc, _ = P2.fit_circle(_ring('osm-n4481230343'))
    g = Geo()
    glass = Geo()
    det = Geo()
    # ---- podium: the B-C connector (tower base) and the junction block on the north-east side
    hp = TOWER['podium']
    for bid, h in (('osm-w385965965', hp), ('osm-w264966382', 24.0)):
        ring = _ring(bid)
        pp = A.draped_building(ring, lambda P, h=h: np.full(len(P), h), lod, edge_step=4.5, roof_step=40.0,
                               overhang=1.5, fascia=1.2, apron_band=1.0, transoms=(7.0, 13.0, 18.5),
                               band_mat='M_Concrete', keep_corners_deg=25.0, simplify_tol=0.8)
        for k in ('roof', 'edge', 'facade'):
            g += pp[k]
        det += pp['mullions']
        if bid == 'osm-w264966382' and lod < 2:
            det += A.rooftop_plant(pp['facade_top'], lambda P: np.full(len(P), 24.0), 3, 61, lod, size=(6, 10))
    # ---- central column
    z0 = hp - 0.5
    g += cylinder(tc, TOWER['col_r'], z0, TOWER['cab0'] + 0.5, seg, 'M_Concrete', cap0=False, cap1=False)
    # ---- buttress fins (4) and two big arched "wings" (bird sculpture) aligned with the concourses
    axis = np.array([math.sin(math.radians(121.0)), math.cos(math.radians(121.0))])   # concourse axis
    perp = np.array([-axis[1], axis[0]])
    nz = {0: 30, 1: 14, 2: 7}[lod]
    for dirv in (axis, -axis):
        # wing: an arched blade springing from the podium ~15 m out, bowing outward and sweeping
        # back in to the column under the cab -> a tall arch-shaped opening between wing and column
        top = 67.0
        f = np.linspace(0.0, 1.0, nz + 1)
        P0, P1, P2_ = (15.0, z0), (25.0, z0 + 0.42 * (top - z0)), (TOWER['col_r'] - 0.3, top)
        rho = (1 - f) ** 2 * P0[0] + 2 * f * (1 - f) * P1[0] + f ** 2 * P2_[0]
        zz = (1 - f) ** 2 * P0[1] + 2 * f * (1 - f) * P1[1] + f ** 2 * P2_[1]
        half_r = 2.1 - 0.8 * f
        th = 3.8 - 1.4 * f
        nd = np.array([-dirv[1], dirv[0]])
        secs = []
        for k in range(nz + 1):
            r_in = max(rho[k] - half_r[k], TOWER['col_r'] - 0.6)
            r_out = max(rho[k] + half_r[k], r_in + 0.8)
            p_in = tc + dirv * r_in
            p_out = tc + dirv * r_out
            ring = P2.ccw(np.array([p_in - nd * th[k] / 2, p_out - nd * th[k] / 2, p_out + nd * th[k] / 2,
                                    p_in + nd * th[k] / 2]))
            secs.append(np.c_[ring, np.full(4, zz[k])])
        g += loft(secs, 'M_Structure', closed=True, cap0=True, cap1=True)
    for dirv in (perp, -perp):
        # lower buttresses toward the apron and the landside
        zs = np.linspace(z0, 44.0, nz // 2 + 1)
        f = (zs - z0) / (44.0 - z0)
        r_out = TOWER['col_r'] + 6.5 * (1 - f) ** 1.3 + 0.4
        secs = []
        nd = np.array([-dirv[1], dirv[0]])
        for k in range(len(zs)):
            p_in = tc + dirv * (TOWER['col_r'] - 0.5)
            p_out = tc + dirv * r_out[k]
            ring = P2.ccw(np.array([p_in - nd * 1.0, p_out - nd * 1.0, p_out + nd * 1.0, p_in + nd * 1.0]))
            secs.append(np.c_[ring, np.full(4, zs[k])])
        g += loft(secs, 'M_Structure', closed=True, cap0=True, cap1=True)
    # ---- multilevel cab: equipment drum, visual control room (outward-leaning glazing), roof, crown
    c0, c1, rf = TOWER['cab0'], TOWER['cab1'], TOWER['roof']
    g += lathe([(0.0, c0 - 4.0), (6.0, c0 - 3.9), (8.6, c0 - 2.0), (8.8, c0 - 0.2)], seg, (tc[0], tc[1], 0),
               'M_Structure')
    glass += lathe([(8.8, c0 - 0.2), (8.8, c0 - 1.6)][::-1], seg, (tc[0], tc[1], 0), 'M_Glass')
    g += lathe([(8.8, c0 - 0.2), (8.8, c0 + 0.6)], seg, (tc[0], tc[1], 0), 'M_Dark')
    glass += lathe([(8.8, c0 + 0.6), (10.4, c1)], seg, (tc[0], tc[1], 0), 'M_GlassLit')
    g += lathe([(10.4, c1), (11.4, c1 + 0.4), (11.4, rf - 0.6), (9.0, rf), (0.0, rf + 0.3)], seg,
               (tc[0], tc[1], 0), 'M_Structure')
    if lod < 2:
        nm = {0: 20, 1: 10}[lod]
        for i in range(nm):
            a = 2 * math.pi * (i + 0.5) / nm
            p0 = np.array([tc[0] + 8.85 * math.cos(a), tc[1] + 8.85 * math.sin(a), c0 + 0.6])
            p1 = np.array([tc[0] + 10.45 * math.cos(a), tc[1] + 10.45 * math.sin(a), c1])
            det += seg_box(p0, p1, 0.2, 0.2, 'M_Structure')
    g += lathe([(4.2, rf + 0.2), (4.2, rf + 2.6), (2.6, rf + 3.4), (0.0, rf + 3.6)], seg // 2, (tc[0], tc[1], 0),
               'M_Structure', cap0=True)
    g += cylinder(tc, 0.3, rf + 3.4, TOWER['top'], 8, 'M_Structure', r1=0.1)
    lights = Geo()
    if lod < 2:
        lights += A.obstruction_light(tc, TOWER['top'] + 0.25, 0.4)
        for i in range(4):
            a = i * math.pi / 2
            lights += A.obstruction_light(tc + 11.2 * np.array([math.cos(a), math.sin(a)]), rf - 0.3, 0.38)
    return [('ATC_Tower', g), ('ATC_Glazing', glass), ('ATC_Details', det), ('ATC_Lights', lights)]


ASSETS = [
    dict(name='OMDB_concourse_a', icao=ICAO, title='Dubai International Concourse A (vaulted roof, A380 concourse)',
         replaces=['osm-w231888210'], build=build_concourse_a, lods=(0, 1, 2),
         preview=dict(target=(800.0, -1065.0, 15.0), dist=1250.0, az=200.0, el=24.0,
                      hero=dict(target=(760.0, -1050.0, 22.0), dist=470.0, az=215.0, el=14.0))),
    dict(name='OMDB_concourse_b', icao=ICAO, title='Dubai International Concourse B (924 m vaulted concourse, T3)',
         replaces=['osm-w87185819', 'osm-w742271052'], build=build_concourse_b, lods=(0, 1, 2),
         preview=dict(target=(-275.0, -490.0, 15.0), dist=1500.0, az=205.0, el=25.0,
                      hero=dict(target=(-300.0, -470.0, 22.0), dist=520.0, az=40.0, el=14.0))),
    dict(name='OMDB_concourse_c', icao=ICAO, title='Dubai International Concourse C (Sheikh Rashid Terminal concourse)',
         replaces=['osm-w10315513'], build=build_concourse_c, lods=(0, 1, 2),
         preview=dict(target=(-1050.0, -10.0, 10.0), dist=1300.0, az=30.0, el=25.0,
                      hero=dict(target=(-1000.0, -50.0, 15.0), dist=420.0, az=40.0, el=10.0))),
    dict(name='OMDB_concourse_d', icao=ICAO, title='Dubai International Concourse D (2016, central atrium)',
         replaces=['osm-w302538629'], build=build_concourse_d, lods=(0, 1, 2),
         preview=dict(target=(-2040.0, 560.0, 10.0), dist=1100.0, az=30.0, el=26.0,
                      hero=dict(target=(-2010.0, 560.0, 14.0), dist=520.0, az=25.0, el=15.0))),
    dict(name='OMDB_terminal_1', icao=ICAO, title='Dubai International Terminal 1 (landside processor)',
         replaces=['osm-w98425196'], build=build_terminal_1, lods=(0, 1, 2),
         preview=dict(target=(-1150.0, -400.0, 10.0), dist=1100.0, az=215.0, el=25.0,
                      hero=dict(target=(-1170.0, -420.0, 10.0), dist=380.0, az=225.0, el=9.0))),
    dict(name='OMDB_terminal_2', icao=ICAO, title='Dubai International Terminal 2 (low terminal, north side)',
         replaces=['osm-w98425234'], build=build_terminal_2, lods=(0, 1, 2),
         preview=dict(target=(-740.0, 1470.0, 8.0), dist=1000.0, az=200.0, el=24.0,
                      hero=dict(target=(-740.0, 1470.0, 8.0), dist=360.0, az=30.0, el=9.0))),
    dict(name='OMDB_terminal_3', icao=ICAO, title='Dubai International Terminal 3 (above-ground landside hall)',
         replaces=['osm-w98425182'], build=build_terminal_3, lods=(0, 1, 2),
         preview=dict(target=(-440.0, -790.0, 8.0), dist=700.0, az=215.0, el=20.0,
                      hero=dict(target=(-440.0, -790.0, 8.0), dist=330.0, az=40.0, el=17.0))),
    dict(name='OMDB_tower', icao=ICAO, title='Dubai International ATC tower (buttressed column, arched wings) and B-C junction',
         replaces=['osm-n4481230343', 'osm-w385965965', 'osm-w264966382'], build=build_tower, lods=(0, 1, 2),
         preview=dict(target=(-660.0, -210.0, 40.0), dist=420.0, az=200.0, el=10.0,
                      hero=dict(target=(-688.0, -230.0, 70.0), dist=150.0, az=230.0, el=6.0))),
]
