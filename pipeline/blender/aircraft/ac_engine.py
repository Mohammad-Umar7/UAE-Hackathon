"""Engines: revolved turbofan nacelles, pylons, turboprop nacelles and propellers."""
import math
import numpy as np
from ac_common import (DEG, Pchip, normalize, grid_normals, needs_flip, frame_from, superellipse_ring,
                       airfoil_loop, chord_stations)


def _revolve_grid(prof, center, axis, seg, phase=0.0):
    """prof: (n,2) (a, r). Returns grid (n, seg, 3) and the frame."""
    d, e1, e2 = frame_from(axis, (0, 0, 1))
    th = phase + np.arange(seg) * 2 * math.pi / seg
    P = (center[None, None, :] + prof[:, 0][:, None, None] * d[None, None, :]
         + (prof[:, 1][:, None] * np.cos(th)[None, :])[:, :, None] * e2[None, None, :]
         + (prof[:, 1][:, None] * np.sin(th)[None, :])[:, :, None] * e1[None, None, :])
    return P, d, e1, e2, th


def _add_revolved(mb, P, row_sign, row_mat, center, d):
    """row_sign: +1 rows whose normals point away from the axis, -1 towards, 0 ignore.
    row_mat: material per profile segment (len n-1)."""
    N = grid_normals(P, False, True)
    r = P - center[None, None, :]
    radial = r - (r @ d)[:, :, None] * d[None, None, :]
    ref = radial * np.asarray(row_sign, float)[:, None, None]
    if needs_flip(P.reshape(-1, 3), N.reshape(-1, 3), ("vec", ref.reshape(-1, 3))):
        N = -N
    fm = np.tile(np.asarray(row_mat)[:, None], (1, P.shape[1]))
    mb.grid(P, row_mat[0], close_v=True, N=N, facemat=fm)
    return N


def turbofan(mb, eng, res):
    """eng: center (fan-face centre), R (max nacelle radius), L (nacelle length),
    inlet (lip-to-fan fraction of L), chevrons (count), core (core-cowl fraction),
    plug (plug fraction), blades."""
    c = np.asarray(eng["center"], float)
    axis = normalize(np.asarray(eng.get("axis", (0, 1, 0)), float))
    R = eng["R"]
    Ln = eng["L"]
    seg = res["nac_seg"]
    L_in = eng.get("inlet", 0.24) * Ln
    R_hl = eng.get("r_hl", 0.90) * R
    R_th = eng.get("r_th", 0.82) * R
    R_fan = eng.get("r_fan", 0.85) * R
    e_in = 0.085 * Ln
    e_out = 0.10 * Ln
    R_lo = R_hl + (R - R_hl) * 0.62
    a_ne = L_in - Ln
    R_ne = eng.get("r_noz", 0.76) * R
    n_lip = res["nac_lip"]
    # ---- outer shell profile ------------------------------------------------
    duct_a = np.linspace(0.0, L_in - e_in, max(3, n_lip // 2 + 1))
    duct_r = R_fan + (R_th - R_fan) * (0.5 - 0.5 * np.cos(np.linspace(0, math.pi, len(duct_a))))
    psi = np.linspace(-math.pi / 2, math.pi / 2, 2 * n_lip + 1)[1:]
    lip_a = np.where(psi < 0, L_in - e_in * (1 - np.cos(psi)), L_in - e_out * (1 - np.cos(psi)))
    lip_r = np.where(psi < 0, R_hl + (R_hl - R_th) * np.sin(psi), R_hl + (R_lo - R_hl) * np.sin(psi))
    cowl = Pchip([(-(L_in - e_out), R_lo), (-(L_in - 0.36 * Ln), R), (-(a_ne + 0.30 * Ln), 0.955 * R),
                  (-(a_ne + 0.10 * Ln), 0.86 * R), (-a_ne, R_ne)])
    n_cowl = res["nac_cowl"]
    ca = -np.linspace(-(L_in - e_out), -a_ne, n_cowl + 1)[1:]
    cr = cowl(-ca)
    inner_a = a_ne + np.array([0.0, 0.08, 0.2]) * Ln
    inner_r = np.array([R_ne - 0.02 * R, R_ne + 0.02 * R, 0.86 * R])
    prof = np.concatenate([np.stack([duct_a, duct_r], 1), np.stack([lip_a, lip_r], 1), np.stack([ca, cr], 1)])
    n_duct, n_lp, n_cw = len(duct_a), len(lip_a), len(ca)
    te_idx = len(prof) - 1
    prof = np.concatenate([prof, np.stack([inner_a, inner_r], 1)])
    P, d, e1, e2, th = _revolve_grid(prof, c, axis, seg)
    nchev = eng.get("chevrons", 0)
    if nchev:
        depth = eng.get("chev_depth", 0.06) * Ln
        ph = (th * nchev / (2 * math.pi)) % 1.0
        tri = 1.0 - np.abs(ph * 2 - 1.0)  # 0..1 peaks
        for j, w in ((te_idx, 1.0), (te_idx - 1, 0.35), (te_idx + 1, 0.9), (te_idx + 2, 0.2)):
            P[j] -= (depth * w * tri)[:, None] * d[None, :]
            # immersion: peaks bend slightly inwards
            r = P[j] - c[None]
            rad = r - (r @ d)[:, None] * d[None, :]
            P[j] -= normalize(rad) * (0.015 * R * w * tri)[:, None]
    sign = np.zeros(len(prof))
    sign[:n_duct] = -1
    sign[n_duct + n_lp // 2 + 1: n_duct + n_lp + n_cw] = 1
    sign[te_idx + 1:] = -1
    half = n_lp // 2
    n_in_dark = max(0, int(round(half * 0.35)))
    n_metal = (half - n_in_dark) + max(1, int(round(half * 0.4))) + 1
    mats = (["M_Dark"] * (n_duct - 1 + n_in_dark) + ["M_Metal"] * n_metal
            + ["M_Paint_Engine"] * (n_lp + 1 - n_metal - n_in_dark) + ["M_Paint_Engine"] * (n_cw - 1)
            + ["M_Dark"] * 3)
    mats = mats[: len(prof) - 1]
    _add_revolved(mb, P, sign, mats, c, d)
    if res.get("panel_lines", 0) >= 1:
        a_r = L_in - 0.52 * Ln
        r_r = float(cowl(-a_r))
        ring = c[None] + a_r * d[None] + np.outer(r_r * np.cos(th), e2) + np.outer(r_r * np.sin(th), e1)
        nr = normalize(np.outer(np.cos(th), e2) + np.outer(np.sin(th), e1))
        from ac_common import ribbon
        ribbon(mb, ring, nr, res["line_w"], res["off_panel"], "M_PanelLine", closed=True)
    # ---- core cowl + core nozzle --------------------------------------------
    core_len = eng.get("core", 0.17) * Ln
    a_ce = a_ne - core_len
    R_cc = eng.get("r_core", 0.57) * R
    R_ce = eng.get("r_core_exit", 0.40) * R
    cc = Pchip([(a_ne + 0.18 * Ln, 0.66 * R), (a_ne, R_cc), (a_ce, R_ce)])
    n_cc = res["nac_core"]
    cca = np.linspace(a_ne + 0.18 * Ln, a_ce, n_cc + 2)
    ccr = cc(cca)
    prof2 = np.concatenate([np.stack([cca, ccr], 1), [[a_ce + 0.05 * Ln, R_ce * 0.93], [a_ce + 0.12 * Ln, R_ce * 0.9]]])
    P2, d, e1, e2, th = _revolve_grid(prof2, c, axis, seg)
    sign2 = np.ones(len(prof2))
    sign2[-2:] = -1
    mats2 = ["M_Metal"] * (len(cca) - 1) + ["M_Dark"] * 2
    _add_revolved(mb, P2, sign2, mats2, c, d)
    # ---- plug ---------------------------------------------------------------
    pl = eng.get("plug", 0.13) * Ln
    a_pt = a_ce - pl
    n_pl = res["nac_plug"]
    q = np.linspace(0, 1, n_pl + 1)
    pa = a_ce + 0.06 * Ln - (0.06 * Ln + pl) * q
    pr = 0.33 * R * np.sqrt(np.maximum(1 - q ** 1.6, 0)) * (1 - 0.15 * q)
    pr[-1] = 0.004 * R
    P3, d, e1, e2, th = _revolve_grid(np.stack([pa, pr], 1), c, axis, max(8, seg // 2))
    _add_revolved(mb, P3, np.ones(len(pa)), ["M_Metal"] * (len(pa) - 1), c, d)
    tip = c + d * (a_pt - 0.004 * R)
    mb.fan(tip, P3[-1], "M_Metal", -d)
    # ---- fan face, spinner, blades -------------------------------------------
    R_sp = 0.30 * R
    disc = np.array([[-0.03 * R, R_sp * 0.95], [-0.03 * R, R_fan * 1.01]])
    P4, d, e1, e2, th = _revolve_grid(disc, c, axis, seg)
    mb.grid(P4, "M_Dark", close_v=True, ref=("dir", d))
    n_sp = res["nac_spinner"]
    q = np.linspace(0, 1, n_sp + 1)
    L_sp = eng.get("spinner", 0.95) * R_sp
    sa = 0.02 * R + L_sp * q
    sr = R_sp * (1 - q ** 1.9) ** 0.62
    sr[-1] = 0.01 * R_sp
    P5, d, e1, e2, th = _revolve_grid(np.stack([sa, sr], 1), c, axis, max(8, seg // 2))
    _add_revolved(mb, P5, np.ones(len(sa)), ["M_Metal"] * (len(sa) - 1), c, d)
    mb.fan(c + d * (0.02 * R + L_sp + 0.004), P5[-1], "M_Metal", d)
    nb = res["fan_blades"] and eng.get("blades", 22)
    if nb:
        fan_blades(mb, c, d, e1, e2, R_sp * 0.92, R_fan * 0.985, nb, R, res)
    return dict(center=c, axis=d, R=R, L_in=L_in, a_ne=a_ne, a_ce=a_ce, a_pt=a_pt, cowl=cowl, R_ne=R_ne,
                R_ce=R_ce, R_lo=R_lo, e_out=e_out)


def fan_blades(mb, c, d, e1, e2, r0, r1, nb, R, res):
    nr = res["blade_nr"]
    rs = np.linspace(r0, r1, nr)
    for k in range(nb):
        th0 = 2 * math.pi * k / nb
        rows = []
        for r in rs:
            q = (r - r0) / (r1 - r0)
            beta = (38 + 26 * q) * DEG  # stagger from axial
            ch = (0.30 - 0.10 * q) * R
            tk = (0.035 - 0.02 * q) * R
            pts = []
            for u, v in ((-1, 0), (0, 1), (1, 0), (0, -1)):
                ax = 0.05 * R + 0.5 * ch * u * math.cos(beta) - v * tk * 0.5 * math.sin(beta)
                tg = 0.5 * ch * u * math.sin(beta) + v * tk * 0.5 * math.cos(beta)
                th = th0 + tg / r + 0.25 * q * q
                pts.append(c + d * ax + r * (math.cos(th) * e2 + math.sin(th) * e1))
            rows.append(pts)
        G = np.array(rows)
        mid = G.mean(axis=1)
        ref = G - mid[:, None, :]
        mb.grid(G, "M_Metal", close_v=True, ref=("vec", ref.reshape(-1, 3)))
        mb.fan(G[-1].mean(0), G[-1], "M_Metal", normalize(G[-1].mean(0) - c - d * np.dot(G[-1].mean(0) - c, d)))


def pylon_under_wing(mb, nac, pf_wing, x_eng, res, width, front_frac=0.30, mat="M_Wing"):
    """Pylon from the nacelle top to the wing lower surface (engine axis ~ +Y)."""
    c = nac["center"]
    d = nac["axis"]
    Ln_front = nac["L_in"]
    a_front = Ln_front - front_frac * (Ln_front - nac["a_ne"])
    a_rear = nac["a_pt"] - 0.05 * (Ln_front - nac["a_ne"])
    n = res["pylon_n"]
    seg = res["pylon_seg"]
    e = abs(x_eng)
    le_y = pf_wing.le_y(e)
    ch = pf_wing.chord(e)

    def wing_low(y):
        xi = (le_y - y) / ch
        if xi < 0.0:
            p = pf_wing.point(e, 0.0, False)
            return p[2] - 0.15 * xi * ch * 0.05
        xi = min(xi, 1.0)
        return pf_wing.point(e, xi, False)[2]

    def nac_top(a):
        if a >= nac["a_ne"]:
            return c[2] + float(nac["cowl"](-a)) * 0.92
        if a >= nac["a_ce"]:
            t = (nac["a_ne"] - a) / max(nac["a_ne"] - nac["a_ce"], 1e-3)
            return c[2] + (0.57 + (0.40 - 0.57) * t) * nac["R"] * 0.9
        return c[2] + 0.3 * nac["R"]

    a_le = le_y - c[1]
    rows = []
    qs = np.linspace(0, 1, n + 2)[1:-1]
    for q in qs:
        a = a_front + (a_rear - a_front) * q
        y = c[1] + a
        zb = nac_top(a)
        zw = wing_low(y) + 0.10
        # front portion rises from the nacelle to the wing leading edge
        if a > a_le:
            t = (a_front - a) / max(a_front - a_le, 1e-3)
            zt = zb + (zw - zb) * (0.25 + 0.75 * math.sin(min(t, 1.0) * math.pi / 2))
        else:
            zt = zw
        if a < nac["a_ce"]:
            t = (nac["a_ce"] - a) / max(nac["a_ce"] - a_rear, 1e-3)
            zb = zb + (zw - 0.3 - zb) * t ** 1.2
        hw = 0.5 * width * math.sin(math.pi * min(q ** 0.55, 1.0)) ** 0.5
        zc = 0.5 * (zb + zt)
        hh = max(0.5 * (zt - zb), 0.05)
        ring = superellipse_ring(seg, 3.2)
        rows.append([[x_eng + u * hw, y, zc + v * hh] for u, v in ring])
    G = np.array(rows)
    mid = G.mean(axis=1)
    ref = G - mid[:, None, :]
    ref[:, :, 1] = 0
    mb.grid(G, mat, close_v=True, ref=("vec", ref.reshape(-1, 3)))
    mb.fan(G[0].mean(0) + d * 0.15, G[0], mat, d)
    mb.fan(G[-1].mean(0) - d * 0.25, G[-1], mat, -d)


def stub_pylon(mb, x0, x1, y_le, chord, z, tc, res, mat="M_Wing"):
    """Horizontal stub pylon (rear-mounted engines) from x0 to x1 (right side, mirrored)."""
    xs = chord_stations(max(6, res["af_n"] // 2))
    loop, frac = airfoil_loop(xs, tc)
    rows = []
    for x in np.linspace(x0, x1, 4):
        rows.append([[x, y_le - u * chord, z + v * chord] for u, v in loop])
    G = np.array(rows)
    ref = np.zeros_like(G)
    n = len(xs)
    ref[:, :n - 1, 2] = 1
    ref[:, n:, 2] = -1
    for m in (1.0, -1.0):
        M = np.array([m, 1, 1])
        mb.grid(G * M, mat, ref=("vec", (ref).reshape(-1, 3)))


def turboprop_nacelle(mb, tp, res, pf_wing):
    """ATR-style nacelle hanging under a high wing. tp: hub (x,y,z), length, width, depth."""
    hx, hy, hz = tp["hub"]
    Ln = tp["length"]
    W = tp["width"]
    D = tp["depth"]
    r0 = tp["r_front"]
    n = res["tp_n"]
    seg = res["tp_seg"]
    e = abs(hx)
    le_y = pf_wing.le_y(e)
    ch = pf_wing.chord(e)

    def wing_mid(y):
        xi = min(max((le_y - y) / ch, 0.0), 1.0)
        pu = pf_wing.point(e, xi, True)
        pl = pf_wing.point(e, xi, False)
        return 0.5 * (pu[2] + pl[2])

    y0 = hy - tp.get("gap", 0.28)
    rows = []
    qs = np.concatenate([[0.0, 0.015, 0.04], np.linspace(0.08, 1.0, n)])
    for q in qs:
        y = y0 - q * Ln
        grow = math.sin(min(q / 0.40, 1.0) * math.pi / 2) ** 0.9
        tail = 1.0 - max(0.0, (q - 0.56) / 0.44) ** 1.5
        hw = r0 + (0.5 * W - r0) * grow
        hw *= max(tail, 0.0) ** 0.6
        zb = hz - r0 - (D - r0) * grow
        zb = zb + (hz - zb) * (1 - max(tail, 0.0)) * 0.7
        zt_w = wing_mid(y) if (le_y + 0.3) > y > (le_y - ch - 0.1) else None
        zt_c = hz + r0 + (0.25 * W) * grow
        if zt_w is not None:
            zt = max(zt_c, zt_w)
        else:
            zt = zt_c
            if y < le_y - ch:
                zt = wing_mid(le_y - ch) - 0.05
        zt = max(zt, zb + 0.05)
        zc = 0.5 * (zt + zb)
        hh = 0.5 * (zt - zb)
        hw = max(hw, 0.02)
        ring = superellipse_ring(seg, 2.3)
        rows.append([[hx + u * hw, y, zc + v * hh] for u, v in ring])
    G = np.array(rows)
    mid = G.mean(axis=1)
    ref = G - mid[:, None, :]
    ref[:, :, 1] = 0
    mb.grid(G, "M_Paint_Engine", close_v=True, ref=("vec", ref.reshape(-1, 3)))
    mb.fan(np.array([hx, y0 + 0.02, hz]), G[0], "M_Dark", (0, 1, 0))
    mb.fan(G[-1].mean(0) + np.array([0, -0.2, 0]), G[-1], "M_Paint_Engine", (0, -1, 0))
    # chin intake scoop
    iy = y0 - 0.35
    iz = hz - r0 - 0.18
    ring = superellipse_ring(max(8, seg // 2), 2.4)
    lip = np.array([[hx + u * 0.27, iy, iz + v * 0.15] for u, v in ring])
    back = np.array([[hx + u * 0.24, iy - 0.6, iz + 0.05 + v * 0.13] for u, v in ring])
    G2 = np.stack([lip, back], 0)
    ref2 = G2 - np.array([hx, 0, iz])[None, None]
    ref2[:, :, 1] = 0
    mb.grid(G2, "M_Paint_Engine", close_v=True, ref=("vec", ref2.reshape(-1, 3)))
    mb.fan(np.array([hx, iy - 0.05, iz]), lip, "M_Dark", (0, 1, 0))
    # exhaust stack (outboard side)
    sx = hx + np.sign(hx) * (0.5 * W - 0.02)
    sy = le_y - 0.35 * ch
    sz = hz - 0.15
    ex = np.sign(hx)
    ring = superellipse_ring(max(8, seg // 2), 2.2)
    a = np.array([[sx, sy + u * 0.32, sz + v * 0.20] for u, v in ring])
    b = np.array([[sx + ex * 0.18, sy - 0.18 + u * 0.28, sz + v * 0.17] for u, v in ring])
    G3 = np.stack([a, b], 0)
    ref3 = G3 - np.array([0, sy, sz])[None, None]
    ref3[:, :, 0] = 0
    mb.grid(G3, "M_Metal", close_v=True, ref=("vec", ref3.reshape(-1, 3)))
    mb.fan(b.mean(0) - np.array([ex * 0.05, 0, 0]), b, "M_Dark", (ex, -0.5, 0))


def propeller(mb, radius, nb, res, r_spinner=0.32, l_spinner=0.75):
    """Propeller in local hub coordinates (spin axis +Y). Blades M_Dark, spinner M_Paint_Engine."""
    seg = res["prop_spinner_seg"]
    q = np.linspace(0, 1, res["prop_spinner_n"] + 1)
    sa = -0.30 + (l_spinner + 0.30) * q
    sr = r_spinner * np.where(q < 0.3, 1.0, (1 - ((q - 0.3) / 0.7) ** 2.0) ** 0.55)
    sr[-1] = 0.006
    P, d, e1, e2, th = _revolve_grid(np.stack([sa, sr], 1), np.zeros(3), np.array([0, 1.0, 0]), seg)
    _add_revolved(mb, P, np.ones(len(sa)), ["M_Paint_Engine"] * (len(sa) - 1), np.zeros(3), d)
    mb.fan(np.array([0, sa[-1] + 0.004, 0]), P[-1], "M_Paint_Engine", (0, 1, 0))
    mb.fan(np.array([0, sa[0] - 0.004, 0]), P[0], "M_Paint_Engine", (0, -1, 0))
    nr = res["prop_nr"]
    xs = chord_stations(res["prop_af"])
    r0 = r_spinner * 0.75
    for k in range(nb):
        a0 = 2 * math.pi * k / nb
        rows = []
        for i in range(nr):
            u = i / (nr - 1)
            r = r0 + (radius - r0) * u
            beta = (58 - 40 * u ** 0.8) * DEG  # pitch angle from the rotation plane
            ch = 0.20 + 0.16 * math.sin(math.pi * min(u * 1.25, 1.0)) - 0.10 * u ** 4
            if u > 0.92:
                ch *= math.sqrt(max(1 - ((u - 0.92) / 0.08) ** 2, 0.04))
            tc = 0.16 - 0.12 * u
            loop, frac = airfoil_loop(xs, tc, 0.03, 0.4)
            sweep = 0.06 * u ** 2
            pts = []
            for x, y in loop:
                xc = (x - 0.35 - sweep / max(ch, 0.05)) * ch
                yc = y * ch
                # chord inclined by beta from the rotation plane; LE leads for positive spin
                # about +Y (clockwise seen from behind) and the cambered face points forward.
                tang = -xc * math.cos(beta) - yc * math.sin(beta)
                axial = -xc * math.sin(beta) + yc * math.cos(beta)
                ang = a0 - tang / r
                pts.append([r * math.cos(ang), axial + 0.05, r * math.sin(ang)])
            rows.append(pts)
        G = np.array(rows)
        n = len(xs)
        mid = G.mean(axis=1)
        ref = G - mid[:, None, :]
        mb.grid(G, "M_Dark", ref=("vec", ref.reshape(-1, 3)))
        tipc = G[-1].mean(0)
        mb.fan(tipc, G[-1][:-1], "M_Dark", normalize(tipc * np.array([1, 0, 1])), closed=True)
