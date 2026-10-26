"""Lifting surfaces: wings, horizontal/vertical stabilisers, wingtip devices,
flap-track fairings and control-surface panel lines.

A surface is described by a Planform: functions of the span coordinate `e` (metres,
x for wings/stabilisers, z for the fin) giving leading-edge position, chord, twist,
thickness ratio and dihedral. Sections are streamwise NACA-style airfoils.
"""
import math
import numpy as np
from ac_common import (DEG, Pchip, Lin, normalize, airfoil_loop, airfoil_pt, chord_stations,
                       grid_normals, needs_flip, ribbon)


def _seg_integral(segs, e0, e):
    """Integral of tan(angle) over [e0, e] for piecewise-constant angle segments [(e_start, deg)]."""
    segs = sorted(segs)
    total = 0.0
    lo, hi, sgn = (e0, e, 1.0) if e >= e0 else (e, e0, -1.0)
    for i, (es, ang) in enumerate(segs):
        ee = segs[i + 1][0] if i + 1 < len(segs) else 1e9
        if i == 0:
            es = -1e9
        a, b = max(lo, es), min(hi, ee)
        if b > a:
            total += (b - a) * math.tan(ang * DEG)
    return sgn * total


class Planform:
    def __init__(self, sp):
        self.sp = sp
        self.vertical = sp.get("vertical", False)
        self.e_root = sp["e_root"]
        self.e_ref = sp["e_ref"]
        self.e_tip = sp["e_tip"]
        self.f_chord = Lin(sp["chord"])
        self.f_twist = Pchip(sp.get("twist", [(0, 0.0), (1, 0.0)]))
        self.f_tc = Pchip(sp["tc"])
        self.cam = sp.get("camber", (0.0, 0.4, 0.0))
        self.sweep = sp["sweep"]
        self.dih = sp.get("dihedral", [(0, 0.0)])
        self.le_fillet = sp.get("le_fillet")  # (height, extra_chord) dorsal fin style

    def le_y(self, e):
        y = self.sp["le_y"] - _seg_integral(self.sweep, self.e_ref, e)
        if self.le_fillet:
            h, extra = self.le_fillet
            f = max(0.0, 1.0 - (e - self.e_root) / h)
            y += extra * f ** 2.2
        return y

    def chord(self, e):
        c = float(self.f_chord(e))
        if self.le_fillet:
            h, extra = self.le_fillet
            f = max(0.0, 1.0 - (e - self.e_root) / h)
            c += extra * f ** 2.2
        return c

    def z(self, e):
        return self.sp["z"] + _seg_integral(self.dih, self.e_ref, e)

    def section(self, e, tc_scale=1.0):
        tw = float(self.f_twist(e)) * DEG
        c = self.chord(e)
        if self.vertical:
            le = np.array([self.sp.get("x", 0.0), self.le_y(e), e])
            cdir = np.array([0.0, -1.0, 0.0])
            udir = np.array([1.0, 0.0, 0.0])
        else:
            le = np.array([e, self.le_y(e), self.z(e)])
            cdir = np.array([0.0, -math.cos(tw), -math.sin(tw)])
            udir = np.array([0.0, -math.sin(tw), math.cos(tw)])
        m, p, aft = self.cam
        return dict(le=le, cdir=cdir, udir=udir, chord=c, tc=float(self.f_tc(e)) * tc_scale, m=m, p=p, aft=aft,
                    e=e)

    def point(self, e, xi, upper=True):
        s = self.section(e)
        x, y = airfoil_pt(np.atleast_1d(xi), s["tc"], s["m"], s["p"], s["aft"], upper)
        return s["le"] + x[0] * s["chord"] * s["cdir"] + y[0] * s["chord"] * s["udir"]

    def frame(self, e, xi, upper=True):
        de = 0.01
        dx = 0.002
        p = self.point(e, xi, upper)
        pe = self.point(e + de, xi, upper) - self.point(e - de, xi, upper)
        px = self.point(e, min(xi + dx, 1.0), upper) - self.point(e, max(xi - dx, 0.0), upper)
        n = normalize(np.cross(px, pe))
        u = self.section(e)["udir"]
        if (np.dot(n, u) < 0) == upper:
            n = -n
        return p, n

    def span_stations(self, n_span):
        e0, e1 = self.e_root, self.e_tip
        brk = sorted(set([e0, e1] + [e for e, _ in self.sp["chord"] if e0 < e < e1]
                         + [e for e in self.sp.get("breaks", []) if e0 < e < e1]))
        L = e1 - e0
        out = [e0]
        for a, b in zip(brk[:-1], brk[1:]):
            k = max(1, int(round(n_span * (b - a) / L)))
            out += list(np.linspace(a, b, k + 1)[1:])
        return out


def section_loop(sec, xs, tc_override=None):
    tc = sec["tc"] if tc_override is None else tc_override
    loop, frac = airfoil_loop(xs, max(tc, 1e-5), sec["m"], sec["p"], sec["aft"])
    if tc_override is not None and tc_override <= 1e-6:
        # collapse onto the camber line
        n = len(xs)
        loop[:, 1] = np.concatenate([loop[:n, 1][::-1] * 0, loop[n:, 1] * 0])
        from ac_common import naca_camber
        yc, _ = naca_camber(loop[:, 0], sec["m"], sec["p"], sec["aft"])
        loop[:, 1] = yc
    P = sec["le"][None] + np.outer(loop[:, 0] * sec["chord"], sec["cdir"]) + np.outer(loop[:, 1] * sec["chord"], sec["udir"])
    return P, frac


def loft(mb, stations, xs, mirror=False, le_frac=0.0, le_mat=None, cap_normal=True):
    """stations: list of section dicts (+ 'mat', optional 'tc_force'). Builds an open grid."""
    rows = []
    for st in stations:
        P, frac = section_loop(st, xs, st.get("tc_force"))
        rows.append(P)
    G = np.array(rows)  # (ns, K, 3)
    K = G.shape[1]
    n = len(xs)
    N = grid_normals(G, False, False)
    # reference outward: upper -> +udir, lower -> -udir
    ref = np.zeros_like(G)
    for i, st in enumerate(stations):
        ref[i, :n - 1] = st["udir"]
        ref[i, n:] = -st["udir"]
        ref[i, n - 1] = -st["cdir"]
    if needs_flip(G.reshape(-1, 3), N.reshape(-1, 3), ("vec", ref.reshape(-1, 3))):
        N = -N
    if cap_normal and stations[-1].get("tc_force", 1.0) <= 1e-6:
        d = normalize(G[-1] - G[-2])
        N[-1] = normalize(d + 0.15 * N[-2])
    fm = np.empty((len(stations) - 1, K - 1), dtype=object)
    fr = np.concatenate([xs[::-1], xs[1:]])
    for i in range(len(stations) - 1):
        base = stations[i].get("mat", "M_Wing")
        for j in range(K - 1):
            f = 0.5 * (fr[j] + fr[j + 1])
            fm[i, j] = le_mat if (le_mat and f < le_frac and stations[i].get("le_ok", True)) else base
    fm = fm.astype(str)
    mb.grid(G, "M_Wing", N=N, facemat=fm)
    if mirror:
        m = np.array([-1.0, 1, 1])
        mb.grid(G * m, "M_Wing", N=N * m, facemat=fm)
    return G


def cap_stations(sec_tip, span_dir, r_cap, n_cap, mat):
    """Rounded tip closure beyond sec_tip along span_dir."""
    out = []
    t0 = sec_tip["tc"]
    for k in range(1, n_cap + 1):
        phi = (math.pi / 2) * k / n_cap
        st = dict(sec_tip)
        st["le"] = sec_tip["le"] + span_dir * r_cap * math.sin(phi) + sec_tip["cdir"] * sec_tip["chord"] * 0.04 * math.sin(phi) ** 2
        st["chord"] = sec_tip["chord"] * (1 - 0.06 * math.sin(phi) ** 2)
        f = math.cos(phi)
        st["tc_force"] = t0 * f if k < n_cap else 0.0
        st["tc"] = t0 * f
        st["mat"] = mat
        st["le_ok"] = False
        out.append(st)
    return out


def winglet_stations(sec_tip, gamma0, p, mat, n_bend, n_str):
    """Blended winglet / sharklet: bend from dihedral gamma0 to cant p['cant'] with radius
    p['radius'], then a straight swept panel of length p['length']."""
    R = p["radius"]
    g1 = p["cant"] * DEG
    Lb = R * max(g1 - gamma0, 0.01)
    Ls = p["length"]
    Ltot = Lb + Ls
    c0 = sec_tip["chord"]
    c1 = p["tip_chord"]
    t0 = sec_tip["tc"]
    t1 = p.get("tip_tc", 0.08)
    sw0 = p.get("sweep_in", 30.0) * DEG
    sw1 = p["sweep"] * DEG
    out = []
    ls = list(np.linspace(0, Lb, n_bend + 1)[1:]) + list(Lb + np.linspace(0, Ls, n_str + 1)[1:])
    pos = np.array(sec_tip["le"], float)
    prev_l = 0.0
    gam_prev = gamma0
    y_acc = 0.0
    for l in ls:
        # integrate path
        steps = 6
        for k in range(steps):
            la = prev_l + (l - prev_l) * (k + 0.5) / steps
            g = gamma0 + (la / R if la < Lb else (g1 - gamma0))
            sw = sw0 + (sw1 - sw0) * min(1.0, la / max(Lb, 1e-6)) ** 0.7
            dl = (l - prev_l) / steps
            pos = pos + np.array([math.cos(g) * dl, -math.tan(sw) * dl, math.sin(g) * dl])
        prev_l = l
        g = gamma0 + (l / R if l < Lb else (g1 - gamma0))
        q = l / Ltot
        st = dict(sec_tip)
        st["le"] = pos.copy()
        st["chord"] = c0 + (c1 - c0) * (q ** 0.85)
        st["tc"] = t0 + (t1 - t0) * min(1.0, q * 1.5)
        st["udir"] = np.array([-math.sin(g), 0.0, math.cos(g)])
        st["cdir"] = np.array([0.0, -1.0, 0.0])
        st["m"] = sec_tip["m"] * (1 - q)
        st["aft"] = 0.0
        st["mat"] = mat
        st["le_ok"] = False
        out.append(st)
    span_dir = np.array([math.cos(g1), 0.0, math.sin(g1)])
    out += cap_stations(out[-1], span_dir, out[-1]["chord"] * out[-1]["tc"] * 0.5, 3, mat)
    return out


def build_wing(mb, pf, res, mirror=True, mat="M_Wing", le_mat="M_Metal", le_frac=0.035, tip=None,
               dev_mat="M_Paint_Tail"):
    """Main panel from e_root to e_tip + tip device/cap. Returns the station list."""
    xs = chord_stations(res["af_n"])
    es = pf.span_stations(res["span_n"])
    sts = []
    for e in es:
        s = pf.section(e)
        s["mat"] = mat
        sts.append(s)
    tip = tip or {"kind": "cap"}
    last = sts[-1]
    if pf.vertical:
        span_dir = np.array([0.0, 0.0, 1.0])
    else:
        g = math.atan(_seg_integral(pf.dih, pf.e_tip - 0.01, pf.e_tip) / 0.01)
        span_dir = np.array([math.cos(g), 0.0, math.sin(g)])
    kind = tip.get("kind", "cap")
    if kind in ("sharklet", "winglet"):
        g0 = math.atan2(span_dir[2], span_dir[0])
        sts += winglet_stations(last, g0, tip, dev_mat, res["wl_bend"], res["wl_str"])
    elif kind != "none":
        thick = last["chord"] * last["tc"] * 0.5
        sts += cap_stations(last, span_dir, max(thick, 0.02), res["cap_n"], mat)
    loft(mb, sts, xs, mirror=mirror, le_frac=le_frac, le_mat=le_mat)
    return sts


def fence(mb, base_le, chord0, chord1, height, sweep, direction, tc, res, mat, mirror=True):
    """Small vertical-ish lifting plate (wingtip fence) from base_le going `direction` (+1 up / -1 down)."""
    xs = chord_stations(max(5, res["af_n"] // 2))
    n = max(2, res["span_n"] // 6)
    sts = []
    for k in range(n + 1):
        q = k / n
        st = dict(le=base_le + np.array([0.0, -math.tan(sweep * DEG) * height * q, direction * height * q]),
                  cdir=np.array([0.0, -1.0, 0.0]), udir=np.array([-1.0, 0.0, 0.0]),
                  chord=chord0 + (chord1 - chord0) * q, tc=tc, m=0.0, p=0.4, aft=0.0, mat=mat)
        sts.append(st)
    span_dir = np.array([0.0, 0.0, float(direction)])
    sts += cap_stations(sts[-1], span_dir, sts[-1]["chord"] * tc * 0.5, 2, mat)
    # root closure: extend slightly into the wing (hidden)
    root = dict(sts[0])
    root["le"] = sts[0]["le"] - span_dir * 0.15
    sts.insert(0, root)
    loft(mb, sts, xs, mirror=mirror)


# ----------------------------------------------------------------------------- details

def panel_line(mb, pf, path, width, offset, mirror=True, mat="M_PanelLine", n_sub=6):
    """path: list of (e, xi, upper) vertices, densified linearly in (e, xi)."""
    dense = []
    for a, b in zip(path[:-1], path[1:]):
        for k in range(n_sub):
            t = k / n_sub
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2]))
    dense.append(path[-1])
    P, N = [], []
    for e, xi, up in dense:
        p, n = pf.frame(e, min(max(xi, 0.0), 1.0), up)
        P.append(p)
        N.append(n)
    P, N = np.array(P), np.array(N)
    ribbon(mb, P, N, width, offset, mat, closed=False)
    if mirror:
        m = np.array([-1.0, 1, 1])
        ribbon(mb, P * m, N * m, width, offset, mat, closed=False)


def control_surface(mb, pf, e0, e1, xi0, xi1, width, offset, sides=("u", "l"), mirror=True, n_sub=8):
    """Outline of a trailing-edge surface: hinge line from (e0, xi0) to (e1, xi1) and the
    two side edges running to the trailing edge."""
    for sd in sides:
        up = sd == "u"
        panel_line(mb, pf, [(e0, 0.995, up), (e0, xi0, up), (e1, xi1, up), (e1, 0.995, up)], width, offset,
                   mirror, n_sub=n_sub)


def spoiler_panels(mb, pf, e0, e1, xi_f, xi_r, count, width, offset, mirror=True):
    es = np.linspace(e0, e1, count + 1)
    for a, b in zip(es[:-1], es[1:]):
        panel_line(mb, pf, [(a, xi_r, True), (a, xi_f, True), (b, xi_f, True), (b, xi_r, True)], width, offset,
                   mirror, n_sub=3)


def flap_track_fairing(mb, pf, e, xi0, ext, width, depth, res, mat="M_Wing", mirror=True):
    """Canoe fairing under the wing at span e, from chord fraction xi0 to ext past the TE."""
    n_q = res["canoe_n"]
    seg = res["canoe_seg"]
    sec = pf.section(e)
    side = np.array([1.0, 0.0, 0.0])
    rows = []
    qs = np.linspace(0.0, 1.0, n_q + 2)[1:-1]
    xi_end = 1.0 + ext
    for q in qs:
        xi = xi0 + (xi_end - xi0) * q
        shp = math.sin(math.pi * min(q ** 0.75, 1.0)) ** 0.55
        a = 0.5 * width * shp
        b = depth * shp
        if xi <= 1.0:
            base = pf.point(e, xi, upper=False)
        else:
            te = pf.point(e, 1.0, upper=False)
            base = te + sec["cdir"] * (xi - 1.0) * sec["chord"]
            base = base + sec["udir"] * (xi - 1.0) / ext * 0.35 * depth
        up = sec["udir"]
        cap = 0.18 * b + 0.05
        th = np.linspace(0, 2 * math.pi, seg, endpoint=False)
        ring = []
        for t in th:
            c, s = math.cos(t), math.sin(t)
            h = cap if s > 0 else b
            ring.append(base + side * a * c + up * h * s)
        rows.append(ring)
    G = np.array(rows)
    axis_p = G.mean(axis=1)
    ref = G - axis_p[:, None, :]
    N = grid_normals(G, False, True)
    if needs_flip(G.reshape(-1, 3), N.reshape(-1, 3), ("vec", ref.reshape(-1, 3))):
        N = -N
    front = pf.point(e, xi0 - 0.02, upper=False)
    rear = G[-1].mean(0) + sec["cdir"] * 0.06 * sec["chord"]
    for mm in ([1.0, 1, 1], [-1.0, 1, 1]) if mirror else ([1.0, 1, 1],):
        m = np.array(mm)
        mb.grid(G * m, mat, close_v=True, N=N * m)
        mb.fan(front * m, G[0] * m, mat, -sec["cdir"] * m, ring_normals=N[0] * m)
        mb.fan(rear * m, G[-1] * m, mat, sec["cdir"] * m, ring_normals=N[-1] * m)


def surface_decal(pf, y0, y1, z0, z1, ns, nz, offset, side):
    """Grid on a vertical planform (fin) between y0..y1 (nose..tail) and z0..z1.
    side -1 = port (-X), +1 = starboard (+X). UV per the SKYPACT decal rule."""
    P = np.zeros((ns, nz, 3))
    N = np.zeros((ns, nz, 3))
    UV = np.zeros((ns, nz, 2))
    for i in range(ns):
        y = y0 + (y1 - y0) * i / (ns - 1)
        for j in range(nz):
            z = z0 + (z1 - z0) * j / (nz - 1)
            xi = (pf.le_y(z) - y) / pf.chord(z)
            p, n = pf.frame(z, min(max(xi, 0.0), 1.0), upper=(side > 0))
            P[i, j] = p + n * offset
            N[i, j] = n
            u = i / (ns - 1)  # i runs nose -> tail
            UV[i, j] = (u if side < 0 else 1.0 - u, j / (nz - 1))
    return P, N, UV
