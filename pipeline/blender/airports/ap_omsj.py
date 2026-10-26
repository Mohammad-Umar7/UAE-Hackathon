"""OMSJ / SHJ Sharjah International: the 1977 domed passenger terminal and its minaret-like tower.

Original model inspired by the real building; facts from data/reference/airports.md (OMSJ):
  * Islamic-style composition of domes of different sizes (Archnet: four, housing the main
    concourse, arrivals, departures and VIP; Gulf News: three), steel-lattice domes clad in GRP
  * reinforced-concrete structure with pointed arches infilled with blue glazed-ceramic sun screens
  * the original control tower is "treated as a minaret" completing the composition; its height is
    not published (layout.json default 35 m is used for the cab roof, + finial)
Plan = OSM ways 182512055 (Terminal 1), 182512051 (arcaded rotunda porch), 182601738, 203760511,
182601954 (adjoining terminal buildings) and node 11146938928 (tower).  The landside arcs of the
main outline fit circles (r 64.8 m, 62.2 m, 28.5 m): the two big ones are read as the curved
landside halls under the main and departures domes, the small one as the domed arcaded rotunda.
"""
import math

import numpy as np

import ap_arch as A
import ap_poly as P2
from ap_geo import Geo, cap, cylinder, lathe, loft, prism, quad
from ap_layout import footprint

ICAO = 'OMSJ'
T1 = 'osm-w182512055'
PORCH = 'osm-w182512051'
ANNEX = ['osm-w182601738', 'osm-w203760511', 'osm-w182601954']
TOWER = 'osm-n11146938928'

H_MAIN = 15.0          # flat-roofed main body
ACCENT = dict(M_Accent=dict(color='#3A7CC4', tex='T_Lattice.png', rough=0.3, metal=0.0, uv=0.4),
              M_Roof=dict(color='#ECEBE6', metal=0.05, rough=0.38, uv=0.1))   # white GRP domes / roofs


def _ring(bid):
    return P2.ccw(footprint(ICAO, bid)[0])


def _arcs():
    """Circle fits of the three landside arcs of the main outline (centre, radius)."""
    r = footprint(ICAO, T1)[0]
    pts = r.tolist()

    def seg(a, b):
        ia = min(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]))
        ib = min(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - b[0], pts[i][1] - b[1]))
        if ia <= ib:
            return np.array(pts[ia:ib + 1])
        return np.array(pts[ia:] + pts[:ib + 1])
    big_w = P2.fit_circle(seg((385.1, -799.5), (415.8, -870.5)))
    small = P2.fit_circle(seg((415.0, -880.0), (460.7, -897.6)))
    big_e = P2.fit_circle(seg((468.4, -902.3), (539.9, -891.9)))
    return big_w, small, big_e


def _walls_with_arcades(ring, h, lod, *, bay=7.5, leg=5.2, rise=4.6, z0=1.0, parapet=1.4, merlons=True):
    """White concrete box (outline = wall face) with a parapet, flat white roof and pointed-arch
    lattice screens on every bay."""
    g = Geo()
    det = Geo()
    r = P2.ccw(P2.as_ring(ring))
    rr = A.edge_loop(r, 3.0 if lod == 0 else 6.0, 25.0, simplify_tol=0.4)
    g += A.walls(rr, 0.0, h + parapet, 'M_Concrete')
    inner = P2.offset(rr, -0.7)
    g += loft([A._c(rr, h + parapet), A._c(inner, h + parapet)], 'M_Structure', closed=True)
    g += A.walls(inner[::-1], h, h + parapet, 'M_Concrete')
    g += cap(inner, h, 'M_Roof')
    if lod < 2:
        det += A.arcade(rr, z0, bay * (1 if lod == 0 else 2), leg, rise, lod, pier=1.6, glass_frac=0.55,
                        frame_lod1=True)
        # upper band of small arched clerestory windows (glazed, lit at night)
        if h > 11:
            det += A.arcade(rr, z0 + leg + rise + 1.2, bay / 2 * (1 if lod == 0 else 2), 0.8, 1.6, lod, pier=1.0,
                            panel='M_GlassLit', frame=None, offset=0.06)
        if merlons and lod == 0:
            # stepped crenellation along the parapet top (small blocks every 3 m)
            pts = P2.resample(rr, 3.0, closed=True, keep_corners_deg=25.0)
            nrm, _ = P2.vertex_normals(pts)
            tg = P2.tangents(pts)
            for p, n, t in zip(pts[::2], nrm[::2], tg[::2]):
                c = p - n * 0.35
                det += A.obox(c, t, 1.2, 0.7, h + parapet, h + parapet + 0.8, 'M_Concrete', bottom=False)
    return g, det, inner


def build_terminal(lod):
    (cw, rw), (cs, rs), (ce, re) = _arcs()
    main = Geo()
    det = Geo()
    domes = Geo()
    # ---- main body (the whole T1 outline), flat roof at 15 m with arcades
    g, d, inner = _walls_with_arcades(_ring(T1), H_MAIN, lod)
    main += g
    det += d
    # ---- main dome over the big west hall, departures dome over the east hall
    zr = H_MAIN
    gd, top_main = A.dome(cw, 22.5, 15.5, zr, lod, drum_h=4.2, drum_r=21.0, windows=16 if lod == 0 else 8,
                          ribs=16 if lod == 0 else 0)
    domes += gd
    gd, _ = A.dome(ce + (cw - ce) * 0.05, 16.0, 12.0, zr, lod, drum_h=3.6, drum_r=15.0, windows=12 if lod == 0 else 6,
                   ribs=12 if lod == 0 else 0)
    domes += gd
    # ---- arrivals rotunda (small arc) with its arcaded porch (OSM way 182512051)
    gd, _ = A.dome(cs, 14.0, 10.5, zr, lod, drum_h=3.0, drum_r=13.0, windows=10 if lod == 0 else 5)
    domes += gd
    porch = _ring(PORCH)
    pr = A.edge_loop(porch, 2.5 if lod == 0 else 5.0, 30.0, simplify_tol=0.5)
    main += prism(pr, 7.8, 9.0, 'M_Concrete', 'M_Roof', 'M_Structure')
    if lod < 2:
        # columns on the outer scalloped edge (the OSM notches are the column positions)
        outer = P2.resample(P2.ccw(P2.as_ring(porch)), 4.0 if lod == 0 else 8.0, True)
        for p in outer:
            if np.linalg.norm(p - cs) > rs + 3.5:
                det += cylinder(p, 0.45, 0.0, 7.8, 8, 'M_Concrete', cap0=False, cap1=False)
    # ---- small domes over the airside gate modules (sawtooth NE facade)
    ring = _ring(T1)
    gates = _gate_modules(ring)
    for c in gates:
        gd, _ = A.dome(c, 6.5, 6.0, zr + 1.4, lod, drum_h=2.0, drum_r=6.0, finial=lod < 2)
        domes += gd
    # ---- adjoining terminal buildings, each with its own dome
    for bid, hh, dr in ((ANNEX[0], 12.0, 11.0), (ANNEX[1], 12.0, 9.0), (ANNEX[2], 12.0, 11.0)):
        g, d, inn = _walls_with_arcades(_ring(bid), hh, lod, bay=6.5, leg=4.5, rise=3.8)
        main += g
        det += d
        ctr = _inner_centre(_ring(bid))
        gd, _ = A.dome(ctr, dr, dr * 0.9, hh, lod, drum_h=3.0, drum_r=dr - 0.8, windows=8 if lod == 0 else 0)
        domes += gd
    # ---- rooftop plant hidden behind the parapet of the main body (away from the domes)
    if lod < 2:
        keep_out = [(cw, 30.0), (ce, 24.0), (cs, 21.0)] + [(c, 9.0) for c in gates]
        det += _plant_avoid(inner, H_MAIN, keep_out, 6 if lod == 0 else 3, lod)
    lights = Geo()
    if lod < 2:
        lights += A.obstruction_light(cw, top_main + 6.4, 0.5)
    return [('Terminal_Building', main), ('Terminal_Domes', domes), ('Terminal_Details', det),
            ('Terminal_Lights', lights)]


def _inner_centre(ring):
    lo, hi = ring.min(axis=0), ring.max(axis=0)
    g = np.mgrid[lo[0]:hi[0]:2.0, lo[1]:hi[1]:2.0].reshape(2, -1).T
    s = P2.sdf(g, [ring])
    return g[int(np.argmax(s))]


def _gate_modules(ring):
    """Centres of the protruding gate modules of the sawtooth airside facade (the side facing the
    contact stands)."""
    from ap_layout import layout
    c, u, L, W = P2.min_rect(ring)
    v = np.array([-u[1], u[0]])
    st = np.array([(s['x'], s['y']) for s in layout(ICAO)['stands'] if s.get('contact')
                   and np.hypot(s['x'] - c[0], s['y'] - c[1]) < 300.0])
    side = 1.0 if (len(st) == 0 or np.dot(st.mean(axis=0) - c, v) > 0) else -1.0
    tt = ((ring - c) @ v) * side
    s = (ring - c) @ u
    sel = tt > tt.max() - 14.0
    pts = ring[sel]
    ss = s[sel]
    order = np.argsort(ss)
    pts, ss = pts[order], ss[order]
    out = []
    i = 0
    while i < len(pts):
        j = i
        while j + 1 < len(pts) and ss[j + 1] - ss[i] < 30.0:
            j += 1
        grp = pts[i:j + 1]
        if len(grp) >= 2 and ss[j] - ss[i] > 12.0:
            cc = grp.mean(axis=0) - v * side * 12.0
            if P2.sdf(cc[None], [ring])[0] > 7.0:
                out.append(cc)
        i = j + 1
    return out


def _plant_avoid(region, z, keep_out, n, lod, seed=5):
    import random
    rng = random.Random(seed)
    r = P2.ccw(P2.as_ring(region))
    lo, hi = r.min(axis=0), r.max(axis=0)
    A_, B_ = P2.edges_of([r])
    g = Geo()
    placed = 0
    tries = 0
    c, u, _, _ = P2.min_rect(r)
    while placed < n and tries < 400:
        tries += 1
        p = np.array([rng.uniform(lo[0], hi[0]), rng.uniform(lo[1], hi[1])])
        if not P2.inside(p[None], [r])[0] or P2.seg_query(p[None], A_, B_)[0][0] < 9.0:
            continue
        if any(np.linalg.norm(p - q) < rq + 7.0 for q, rq in keep_out):
            continue
        lx, ly = rng.uniform(6, 10), rng.uniform(4, 7)
        g += A.obox(p, u, lx, ly, z - 0.2, z + rng.uniform(1.8, 2.6), 'M_Structure', bottom=False)
        keep_out.append((p, 6.0))
        placed += 1
    return g


# ======================================================================= tower (minaret)
TW = dict(base_h=9.0, shaft_top=29.0, cab0=29.6, cab1=34.0, roof=35.0, top=41.0)


def build_tower(lod):
    c, rf = P2.fit_circle(_ring(TOWER))
    seg = {0: 32, 1: 16, 2: 8}[lod]
    g = Geo()
    det = Geo()
    glass = Geo()
    # octagonal plinth with arched panels
    oct_r = 8.6
    octo = np.array([[c[0] + oct_r * math.cos(math.pi / 8 + k * math.pi / 4),
                      c[1] + oct_r * math.sin(math.pi / 8 + k * math.pi / 4)] for k in range(8)])
    g += prism(octo, 0.0, TW['base_h'], 'M_Concrete', 'M_Roof', None, bottom=False)
    if lod < 2:
        det += A.arcade(octo, 1.0, 2 * oct_r * math.sin(math.pi / 8) * 0.999, 3.6, 3.0, lod, pier=1.4,
                        keep_corners_deg=10.0, min_bay=1.0)
    # tapering round shaft with blue ceramic bands
    zs = [TW['base_h'], 14.0, 14.8, 20.0, 20.8, 26.0, 26.8, TW['shaft_top']]
    rad = lambda z: 4.6 - 0.9 * (z - TW['base_h']) / (TW['shaft_top'] - TW['base_h'])
    g += lathe([(rad(zs[0]), zs[0]), (rad(zs[-1]), zs[-1])], seg, (c[0], c[1], 0), 'M_Concrete')
    for k in (1, 3, 5):
        # proud blue ceramic bands: closed rings (bottom, face, top) around the shaft
        r0, r1 = rad(zs[k]), rad(zs[k + 1])
        g += lathe([(r0 - 0.05, zs[k]), (r0 + 0.14, zs[k]), (r1 + 0.14, zs[k + 1]), (r1 - 0.05, zs[k + 1])], seg,
                   (c[0], c[1], 0), 'M_Accent')
    # vertical slit windows on the shaft
    if lod < 2:
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            for z_a, z_b in ((10.5, 13.2), (15.8, 19.2), (21.8, 25.2)):
                r1 = rad(z_a) + 0.04
                d = np.array([math.cos(a), math.sin(a)])
                t = np.array([-d[1], d[0]])
                p = c + d * r1
                glass += quad(np.r_[p - t * 0.35, z_a], np.r_[p + t * 0.35, z_a], np.r_[p + t * 0.35, z_b],
                              np.r_[p - t * 0.35, z_b], 'M_GlassLit')
    # corbelled balcony (sherefe) ring under the cab
    g += lathe([(rad(TW['shaft_top']), TW['shaft_top'] - 0.2), (5.2, TW['shaft_top'] + 0.3),
                (6.6, TW['cab0'] - 0.1), (6.9, TW['cab0'])], seg, (c[0], c[1], 0), 'M_Concrete')
    g += lathe([(6.9, TW['cab0']), (6.9, TW['cab0'] + 0.5)], seg, (c[0], c[1], 0), 'M_Structure')
    # balcony floor between the cab glazing and the balustrade
    g += lathe([(6.75, TW['cab0'] + 0.5), (5.5, TW['cab0'] + 0.5)], seg, (c[0], c[1], 0), 'M_Concrete')
    # balcony balustrade (low ring wall)
    g += lathe([(6.9, TW['cab0'] + 0.5), (6.9, TW['cab0'] + 1.1), (6.7, TW['cab0'] + 1.1), (6.7, TW['cab0'] + 0.5)],
               seg, (c[0], c[1], 0), 'M_Concrete')
    # glazed cab
    glass += lathe([(5.6, TW['cab0'] + 0.5), (6.0, TW['cab1'])], seg, (c[0], c[1], 0), 'M_GlassLit')
    if lod < 2:
        for k in range(12 if lod == 0 else 6):
            a = 2 * math.pi * k / (12 if lod == 0 else 6)
            p0 = np.r_[c[0] + 5.62 * math.cos(a), c[1] + 5.62 * math.sin(a), TW['cab0'] + 0.5]
            p1 = np.r_[c[0] + 6.02 * math.cos(a), c[1] + 6.02 * math.sin(a), TW['cab1']]
            from ap_geo import seg_box
            det += seg_box(p0, p1, 0.18, 0.18, 'M_Structure')
    # roof slab and pointed cupola with finial
    g += lathe([(6.0, TW['cab1']), (7.0, TW['cab1'] + 0.2), (7.0, TW['roof']), (5.0, TW['roof'] + 0.1),
                (0.0, TW['roof'] + 0.1)], seg, (c[0], c[1], 0), 'M_Concrete')
    gd, top = A.dome(c, 4.6, 4.8, TW['roof'], lod, mat='M_Roof', finial=True)
    g += gd
    lights = Geo()
    if lod < 2:
        lights += A.obstruction_light(c, top + 4.3, 0.35)
        for k in range(4):
            a = k * math.pi / 2
            lights += A.obstruction_light(c + 7.2 * np.array([math.cos(a), math.sin(a)]), TW['roof'] + 0.2, 0.32)
    return [('Tower_Minaret', g), ('Tower_Glazing', glass), ('Tower_Details', det), ('Tower_Lights', lights)]


def _lattice(tex_dir):
    import os
    import ap_materials
    ap_materials.lattice_texture(os.path.join(tex_dir, 'T_Lattice.png'))


ASSETS = [
    dict(name='OMSJ_terminal', icao=ICAO, title='Sharjah International passenger terminal (domes, pointed arches, '
                                                 'blue ceramic screens)',
         replaces=[T1, PORCH] + ANNEX, build=build_terminal, lods=(0, 1, 2), materials=ACCENT, textures=[_lattice],
         preview=dict(target=(520.0, -860.0, 10.0), dist=820.0, az=205.0, el=22.0,
                      hero=dict(target=(470.0, -850.0, 18.0), dist=300.0, az=200.0, el=9.0))),
    dict(name='OMSJ_tower', icao=ICAO, title='Sharjah International minaret-like control tower',
         replaces=[TOWER], build=build_tower, lods=(0, 1, 2), materials=ACCENT, textures=[_lattice],
         preview=dict(target=(583.0, -851.0, 20.0), dist=210.0, az=200.0, el=8.0,
                      hero=dict(target=(583.0, -851.0, 31.0), dist=70.0, az=215.0, el=6.0))),
]
