"""Fuselage loft + surface-mapped overlays (windows, doors, decals).

Stations are measured with `s` = metres aft of the nose tip. Blender y = s_ng - s.
Each cross-section is two superellipse halves (upper/lower) sharing the max-width line,
optionally with a belly-fairing bulge (lower half) and an upper bubble (747-style hump /
high-wing root fairing). Sections are resampled by arc length with landmark vertices at
the cheatline boundaries, so the paint regions are exact edge loops of the loft.
"""
import math
import numpy as np
from ac_common import (Pchip, normalize, window, smax, superellipse_ring, superellipse_ring_arclen, ribbon,
                       needs_flip)

M_TOP, M_BELLY, M_CHEAT = "M_Paint_Top", "M_Paint_Belly", "M_Paint_Cheatline"


class Fuselage:
    def __init__(self, spec, s_ng):
        self.sp = spec
        self.L = spec["L"]
        self.s_ng = s_ng
        L = self.L
        self.f_top = Pchip(spec["top"])
        self.f_bot = Pchip(spec["bot"])
        self.f_hw = Pchip(spec["hw"])
        self.f_kc = Pchip(spec.get("kc", [(0, 0.5), (L, 0.5)]))
        self.f_nt = Pchip(spec.get("n_top", [(0, 2.0), (L, 2.0)]))
        self.f_nb = Pchip(spec.get("n_bot", [(0, 2.0), (L, 2.0)]))
        ch = spec.get("cheat", [(0, 0.47, 0.42), (L, 0.47, 0.42)])
        self.f_c1 = Pchip([(c[0], c[1]) for c in ch])
        self.f_c2 = Pchip([(c[0], c[2]) for c in ch])
        self.bubbles = []
        for b in spec.get("bubbles", []):
            self.bubbles.append(dict(top=Pchip(b["top"]), hw=Pchip(b["hw"]), r=b["r"], k=b.get("k", 0.25),
                                     s0=b.get("s0", -1e9), s1=b.get("s1", 1e9)))
        self.fairings = spec.get("fairings", [])
        self._cache = {}
        self.z_tip = float(self.f_top(0.0))

    # ------------------------------------------------------------------ sections
    def y(self, s):
        return self.s_ng - np.asarray(s, float)

    def main_tb(self, s):
        return float(self.f_top(s)), float(self.f_bot(s))

    def section(self, s, M=721):
        """Dense right half-curve from top (0) to bottom (-1): x, z, cumulative arc length."""
        key = round(float(s), 4)
        c = self._cache.get(key)
        if c is not None:
            return c
        s = float(s)
        zt, zb = self.main_tb(s)
        hw = max(float(self.f_hw(s)), 1e-4)
        H = max(zt - zb, 1e-4)
        zc = zb + float(self.f_kc(s)) * H
        ht = max(zt - zc, 1e-4)
        hb = max(zc - zb, 1e-4)
        nt = float(self.f_nt(s))
        nb = float(self.f_nb(s))
        fw = fd = fn = 0.0
        for f in self.fairings:
            e = float(window(s, f["s0"], f["s1"], f["s2"], f["s3"]))
            fw += f.get("dw", 0.0) * e
            fd += f.get("dz", 0.0) * e
            fn += f.get("dn", 0.0) * e
        nb_e = nb + fn
        # cluster samples a little near top/bottom
        u = np.linspace(0, 1, M)
        th = math.pi * (u - 0.12 * np.sin(2 * math.pi * u) / (2 * math.pi) * 0.0)
        st = np.abs(np.sin(th))
        ct = np.cos(th)
        up = th <= math.pi / 2
        x = np.where(up, hw * st ** (2.0 / nt), hw * st ** (2.0 / nb_e))
        z = np.where(up, zc + ht * np.abs(ct) ** (2.0 / nt), zc - hb * np.abs(ct) ** (2.0 / nb_e))
        if fw or fd:
            g = np.sin(2 * (th - math.pi / 2)) ** 2
            g = np.where(up, 0.0, g)
            x = x + fw * g
            z = z - np.where(up, 0.0, fd * np.abs(ct) ** 1.5)
        for b in self.bubbles:
            if not (b["s0"] <= s <= b["s1"]):
                continue
            ztop = float(b["top"](s))
            wh = min(float(b["hw"](s)), 0.95 * hw)
            r = b["r"]
            if wh < 0.05 or ztop < zc:
                continue
            zhc = ztop - r
            q = np.clip(x / wh, 0, 1)
            zb_ = np.where(x < wh, zhc + r * np.sqrt(np.maximum(1 - q ** 2, 0)), -1e9)
            z = np.where(up, smax(z, zb_, b["k"]), z)
        # enforce monotone decreasing z (numerical safety)
        z = np.minimum.accumulate(z)
        seg = np.hypot(np.diff(x), np.diff(z))
        S = np.concatenate([[0.0], np.cumsum(seg)])
        out = (x, z, S)
        self._cache[key] = out
        return out

    def ring_half(self, s, nA, nB, nC):
        """Right half from top to bottom with landmark points at the cheatline boundaries."""
        x, z, S = self.section(s)
        zt, zb = self.main_tb(s)
        H = zt - zb
        z1 = zb + float(self.f_c1(s)) * H
        z2 = zb + float(self.f_c2(s)) * H
        # z is non-increasing along S
        S1 = float(np.interp(-z1, -z, S))
        S2 = float(np.interp(-z2, -z, S))
        S1 = min(max(S1, 0.02 * S[-1]), 0.96 * S[-1])
        S2 = min(max(S2, S1 + 0.005 * S[-1]), 0.98 * S[-1])
        Sa = np.linspace(0, S1, nA + 1)
        Sb = np.linspace(S1, S2, nB + 1)[1:]
        Sc = np.linspace(S2, S[-1], nC + 1)[1:]
        Ss = np.concatenate([Sa, Sb, Sc])
        return np.interp(Ss, S, x), np.interp(Ss, S, z)

    # ------------------------------------------------------------------ surface mapping
    def t_of_z(self, s, z):
        x_, z_, S = self.section(s)
        return float(np.interp(-z, -z_, S) / S[-1])

    def t_of_x(self, s, xq):
        """Upper half only: x grows from 0 at the top to max width."""
        x_, z_, S = self.section(s)
        k = int(np.argmax(x_))
        xs = np.maximum.accumulate(x_[: k + 1])
        return float(np.interp(xq, xs, S[: k + 1]) / S[-1])

    def s_of_xz(self, x_t, z_t, s_max=None):
        """Front-view projection: nose station where the skin passes through (x_t, z_t)."""
        lo, hi = 1e-3, (s_max or self.sp["nose_len"] * 1.6)
        for _ in range(48):
            mid = 0.5 * (lo + hi)
            x_, z_, S = self.section(mid)
            if z_t > z_[0] or z_t < z_[-1]:
                xm = -1.0
            else:
                xm = float(np.interp(-z_t, -z_, x_))
            if xm < x_t:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    def to_st(self, spec):
        kind, s, v = spec
        if kind == "z":
            return (s, self.t_of_z(s, v))
        if kind == "x":
            return (s, self.t_of_x(s, v))
        if kind == "xz":  # ("xz", x, z): front-view corner on the nose
            ss = self.s_of_xz(s, v)
            return (ss, self.t_of_z(ss, v))
        return (s, v)

    def point(self, s, t):
        x_, z_, S = self.section(s)
        St = t * S[-1]
        return np.array([np.interp(St, S, x_), float(self.y(s)), np.interp(St, S, z_)])

    def frame(self, s, t, ds=0.05, dt=0.012):
        p = self.point(s, t)
        ps = self.point(s + ds, t) - self.point(max(s - ds, 1e-3), t)
        pt = self.point(s, min(t + dt, 1.0)) - self.point(s, max(t - dt, 0.0))
        n = normalize(np.cross(ps, pt))
        r = np.array([p[0], 0.0, p[2] - self.z_center(s)])
        if np.dot(n, r) < 0:
            n = -n
        return p, n

    def z_center(self, s):
        zt, zb = self.main_tb(s)
        return zb + float(self.f_kc(s)) * (zt - zb)

    def surface_pts(self, st_list, offset):
        P, N = [], []
        for s, t in st_list:
            p, n = self.frame(s, t)
            P.append(p + n * offset)
            N.append(n)
        return np.array(P), np.array(N)

    # ------------------------------------------------------------------ loft
    def stations(self, res):
        sp = self.sp
        L = self.L
        s_ne = sp["nose_len"]
        s_t0 = sp["tail_start"]
        n_nose = res["fus_n_nose"]
        eps = sp.get("tip_eps", 0.012)
        u = np.linspace(0, 1, n_nose + 1)
        nose = eps + (s_ne - eps) * u ** 1.9
        ds = L * res["fus_ds"]
        n_cab = max(1, int(math.ceil((s_t0 - s_ne) / ds)))
        cab = np.linspace(s_ne, s_t0, n_cab + 1)[1:]
        dst = L * res["fus_ds_tail"]
        n_tail = max(2, int(math.ceil((L - s_t0) / dst)))
        tt = np.linspace(0, 1, n_tail + 1)[1:]
        tail = s_t0 + (L - s_t0) * (1 - (1 - tt) ** 1.15)
        S = np.concatenate([nose, cab, tail])
        cap = res.get("nose_max_ds")
        if cap:
            dense = [S]
            lim = s_ne * 1.05
            for a, b in zip(S[:-1], S[1:]):
                if a < lim and b - a > cap:
                    k = int(math.ceil((b - a) / cap))
                    dense.append(a + (b - a) * np.arange(1, k) / k)
            S = np.sort(np.concatenate(dense))
        extra = [e for e in sp.get("extra_stations", []) if eps < e < L]
        if res.get("lod", 0) == 0 and extra:
            S = np.unique(np.concatenate([S, extra]))
        return np.unique(np.round(S, 5))

    def build(self, mb, res):
        nA, nB, nC = res["fus_ring"]
        nh = nA + nB + nC
        Nr = 2 * nh
        S = self.stations(res)
        rings = np.zeros((len(S), Nr, 3))
        for i, s in enumerate(S):
            xr, zr = self.ring_half(s, nA, nB, nC)
            y = float(self.y(s))
            rings[i, : nh + 1, 0] = xr
            rings[i, : nh + 1, 2] = zr
            rings[i, nh + 1:, 0] = -xr[1:nh][::-1]
            rings[i, nh + 1:, 2] = zr[1:nh][::-1]
            rings[i, :, 1] = y
        seg_mat = []
        for j in range(Nr):
            k = j if j < nh else Nr - 1 - j
            seg_mat.append(M_TOP if k < nA else (M_CHEAT if k < nA + nB else M_BELLY))
        seg_mat = np.array(seg_mat)
        fm = np.tile(seg_mat, (len(S) - 1, 1))
        zc = np.array([self.z_center(s) for s in S])
        out = rings.copy()
        out[:, :, 1] = 0.0
        out[:, :, 2] -= zc[:, None]
        from ac_common import grid_normals
        N = grid_normals(rings, False, True)
        if needs_flip(rings.reshape(-1, 3), N.reshape(-1, 3), ("vec", out.reshape(-1, 3))):
            N = -N
        mb.grid(rings, M_TOP, close_v=True, N=N, facemat=fm)
        self.rings, self.ring_N, self.S = rings, N, S
        # nose cap
        tip = np.array([0.0, float(self.y(0.0)), self.z_tip])
        r0 = rings[0]
        for mat in np.unique(seg_mat):
            idx = [j for j in range(Nr) if seg_mat[j] == mat]
            V = [tip]
            Nn = [np.array([0.0, 1.0, 0.0])]
            F = []
            for j in idx:
                a = len(V)
                V += [r0[j], r0[(j + 1) % Nr]]
                Nn += [N[0, j], N[0, (j + 1) % Nr]]
                F.append((0, a, a + 1))
            V = np.array(V)
            Nn = np.array(Nn)
            F = np.array(F)
            fn = np.cross(V[F[0, 1]] - V[0], V[F[0, 2]] - V[0])
            if np.dot(fn, [0, 1, 0]) < 0:
                F = F[:, ::-1]
            mb.add(mat, V, Nn, F)
        # APU exhaust at tail end
        last = rings[-1]
        cz = zc[-1]
        cy = float(self.y(S[-1]))
        center = np.array([0.0, cy, cz])
        inner = center + (last - center) * 0.72
        A = np.stack([last, inner], 0)
        mb.grid(A, "M_Metal", close_v=True, ref=("dir", (0, -1, 0)))
        depth = max(0.25, 0.9 * np.linalg.norm(last[0] - center))
        deep = inner + np.array([0, depth, 0])
        T = np.stack([inner, deep], 0)
        mb.grid(T, "M_Dark", close_v=True, ref=("vec", np.tile(center, (2 * Nr, 1)) - T.reshape(-1, 3)))
        mb.fan(center + np.array([0, depth, 0]), deep, "M_Dark", np.array([0, -1.0, 0]))
        return rings

    # ------------------------------------------------------------------ overlays
    def _map_quad(self, corners_st, uv):
        c = np.asarray(corners_st, float)
        u, v = uv[:, 0], uv[:, 1]
        st = (np.outer((1 - u) * (1 - v), c[0]) + np.outer(u * (1 - v), c[1]) + np.outer(u * v, c[2])
              + np.outer((1 - u) * v, c[3]))
        return st

    def patch(self, mb, corners, n_exp, kseg, nrings, offset, mat, sides=(1, -1)):
        """Superellipse disc inside a bilinear quad given by 4 corner specs (kind, s, v).
        Corner order: front-low, rear-low, rear-high, front-high (any consistent loop)."""
        cst = [self.to_st(c) for c in corners]
        ring = superellipse_ring_arclen(kseg, n_exp)
        rows = []
        for r in range(1, nrings + 1):
            f = r / nrings
            uv = 0.5 + 0.5 * ring * f
            rows.append(self._map_quad(cst, uv))
        center_st = self._map_quad(cst, np.array([[0.5, 0.5]]))[0]
        P = np.zeros((nrings, kseg, 3))
        N = np.zeros((nrings, kseg, 3))
        for i, row in enumerate(rows):
            pp, nn = self.surface_pts(row, offset)
            P[i], N[i] = pp, nn
        pc, nc = self.surface_pts([center_st], offset)
        for sd in sides:
            m = np.array([sd, 1, 1])
            Pm, Nm = P * m, N * m
            if nrings > 1:
                mb.grid(Pm, mat, close_v=True, N=Nm, ref=("vec", Nm.reshape(-1, 3)))
            mb.fan(pc[0] * m, Pm[0], mat, nc[0] * m, ring_normals=Nm[0])

    def window_row(self, mb, row, kseg, offset, mat="M_Window", sides=(1, -1)):
        w, h, n = row["w"], row["h"], row.get("n", 2.8)
        ring = superellipse_ring_arclen(kseg, n)
        for sc in row["s"]:
            zc = row["z"] if not callable(row["z"]) else row["z"](sc)
            pts = [(sc - u * w / 2, self.t_of_z(sc - u * w / 2, zc + v * h / 2)) for u, v in ring]
            P, N = self.surface_pts(pts, offset)
            pc, nc = self.surface_pts([(sc, self.t_of_z(sc, zc))], offset)
            for sd in sides:
                m = np.array([sd, 1, 1])
                mb.fan(pc[0] * m, P * m, mat, nc[0] * m, ring_normals=N * m)

    def outline(self, mb, s_c, z_c, w, h, n_exp, kseg, width, offset, mat="M_PanelLine", sides=(1, -1),
                step=0.06):
        dense = superellipse_ring(720, n_exp, phase=math.pi / 720)
        dense = dense * np.array([w / 2, h / 2])
        seg = np.linalg.norm(np.roll(dense, -1, 0) - dense, axis=1)
        S = np.concatenate([[0.0], np.cumsum(seg)])
        n = max(kseg, int(math.ceil(S[-1] / step)))
        Sq = np.linspace(0, S[-1], n, endpoint=False)
        closed = np.vstack([dense, dense[:1]])
        u = np.interp(Sq, S, closed[:, 0])
        v = np.interp(Sq, S, closed[:, 1])
        pts = [(s_c - uu, self.t_of_z(s_c - uu, z_c + vv)) for uu, vv in zip(u, v)]
        P, N = self.surface_pts(pts, 0.0)
        for sd in sides:
            m = np.array([sd, 1, 1])
            ribbon(mb, P * m, N * m, width, offset, mat, closed=True)

    def polyline_sz(self, mb, pts_sz, width, offset, mat="M_PanelLine", sides=(1, -1), closed=False, step=0.06):
        """Panel line through (s, z) points (side view), densified to ~step metres."""
        pts = np.asarray(pts_sz, float)
        dense = []
        rng = len(pts) if closed else len(pts) - 1
        for i in range(rng):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            k = max(2, int(math.ceil(np.linalg.norm(b - a) / step)))
            for j in range(k):
                dense.append(a + (b - a) * j / k)
        if not closed:
            dense.append(pts[-1])
        st = [(s, self.t_of_z(s, z)) for s, z in dense]
        P, N = self.surface_pts(st, 0.0)
        for sd in sides:
            m = np.array([sd, 1, 1])
            ribbon(mb, P * m, N * m, width, offset, mat, closed=closed)

    def line_st(self, mb, st_pts, width, offset, mat="M_PanelLine", sides=(1, -1), closed=False, step=0.06):
        """Panel line through (s, t) points, densified (t measured along the half-section)."""
        st_pts = [tuple(p) for p in st_pts]
        dense = []
        rng = len(st_pts) if closed else len(st_pts) - 1
        for i in range(rng):
            a, b = np.array(st_pts[i]), np.array(st_pts[(i + 1) % len(st_pts)])
            per = self.section(0.5 * (a[0] + b[0]))[2][-1]
            ln = math.hypot(b[0] - a[0], (b[1] - a[1]) * per)
            k = max(2, int(math.ceil(ln / step)))
            for j in range(k):
                dense.append(tuple(a + (b - a) * j / k))
        if not closed:
            dense.append(st_pts[-1])
        P, N = self.surface_pts(dense, 0.0)
        for sd in sides:
            m = np.array([sd, 1, 1])
            ribbon(mb, P * m, N * m, width, offset, mat, closed=closed)

    def decal_strip(self, s0, s1, z0, z1, ns, nz, offset, side):
        """Grid conforming to the fuselage between stations s0..s1 and heights z0..z1.
        Returns P (ns, nz, 3), N, UV following the SKYPACT decal rule."""
        P = np.zeros((ns, nz, 3))
        N = np.zeros((ns, nz, 3))
        UV = np.zeros((ns, nz, 2))
        for i in range(ns):
            s = s0 + (s1 - s0) * i / (ns - 1)
            for j in range(nz):
                z = z0 + (z1 - z0) * j / (nz - 1)
                p, n = self.frame(s, self.t_of_z(s, z))
                P[i, j] = p + n * offset
                N[i, j] = n
                u = i / (ns - 1)
                UV[i, j] = (u if side < 0 else 1.0 - u, j / (nz - 1))
        m = np.array([side, 1, 1])
        return P * m, N * m, UV

    def skin_point(self, s, z, side):
        """Point on the skin at station s, height z on side (-1 left, +1 right)."""
        p, n = self.frame(s, self.t_of_z(s, z))
        m = np.array([side, 1, 1])
        return p * m, n * m

    def top_point(self, s, t=0.0):
        p, n = self.frame(s, max(t, 1e-3))
        p[0] = 0.0
        return p

    def bottom_point(self, s):
        p, n = self.frame(s, 1.0 - 1e-3)
        p[0] = 0.0
        return p
