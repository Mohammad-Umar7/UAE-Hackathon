"""Landing gear: wheels (tyre + hub, merged into `Wheels` with the _AXLE attribute),
struts, bogies, torque links, braces and gear doors."""
import math
import numpy as np
from ac_common import (normalize, grid_normals, needs_flip, superellipse_ring, cylinder, box, dome,
                       blender_to_gltf)


def wheel(mbw, center, R, W, res):
    """Tyre (M_Dark) + hub (M_Metal) around an axle parallel to X through `center`.
    Every vertex carries _AXLE = axle centre in glTF space (see ac_common.blender_to_gltf)."""
    c = np.asarray(center, float)
    ax = blender_to_gltf(c)
    seg = res["wheel_seg"]
    npf = res["tyre_prof"]
    Rr = 0.54 * R
    ar = 0.5 * (R - Rr) + 0.015 * R   # radial half-size of the tyre section
    rc = R - ar                        # tread touches the ground exactly (axle at z = R)
    aw = 0.5 * W
    # phase both rings so a vertex always sits on the tread centre and at the contact point
    ring = superellipse_ring(npf, 2.6, phase=math.pi / 2)
    th = -math.pi / 2 + np.arange(seg) * 2 * math.pi / seg
    ct, st = np.cos(th), np.sin(th)
    # profile point (w, r) -> (x = c.x + w, y = c.y + r cos, z = c.z + r sin)
    G = np.zeros((npf, seg, 3))
    for i, (u, v) in enumerate(ring):
        w = u * aw
        r = rc + v * ar
        G[i, :, 0] = c[0] + w
        G[i, :, 1] = c[1] + r * ct
        G[i, :, 2] = c[2] + r * st
    # normals: superellipse gradient in (w, r), revolved
    Nn = np.zeros_like(G)
    n_exp = 2.6
    for i, (u, v) in enumerate(ring):
        gw = np.sign(u) * abs(u) ** (n_exp - 1) / aw
        gr = np.sign(v) * abs(v) ** (n_exp - 1) / ar
        L = math.hypot(gw, gr) or 1.0
        gw, gr = gw / L, gr / L
        Nn[i, :, 0] = gw
        Nn[i, :, 1] = gr * ct
        Nn[i, :, 2] = gr * st
    mbw.grid(G, "M_Dark", close_u=True, close_v=True, N=Nn, axle=ax)
    # hub: dished wheel with central cap, closed body
    hp = [(-0.40, 0.08), (-0.40, 0.30), (-0.30, 0.44), (-0.45, 1.00),
          (0.45, 1.00), (0.40, 0.30), (0.40, 0.08)]
    if res["hub_simple"]:
        hp = [(-0.42, 0.08), (-0.42, 1.0), (0.42, 1.0), (0.42, 0.08)]
    H = np.zeros((len(hp), seg, 3))
    for i, (w, r) in enumerate(hp):
        H[i, :, 0] = c[0] + w * W
        H[i, :, 1] = c[1] + r * Rr * ct
        H[i, :, 2] = c[2] + r * Rr * st
    ref = H - c[None, None, :]
    ref[:, :, 0] = 0.0
    ref[0, :, :] = 0.0
    ref[-1, :, :] = 0.0
    mbw.grid(H, "M_Metal", close_v=True, ref=("vec", ref.reshape(-1, 3)), axle=ax)
    mbw.fan(c + np.array([hp[0][0] * W - 0.01, 0, 0]), H[0], "M_Metal", np.array([-1.0, 0, 0]), axle=ax)
    mbw.fan(c + np.array([hp[-1][0] * W + 0.01, 0, 0]), H[-1], "M_Metal", np.array([1.0, 0, 0]), axle=ax)


def wheel_pair(mbw, cx, cy, R, W, spacing, res):
    for sx in (-1, 1):
        wheel(mbw, (cx + sx * spacing / 2, cy, R), R, W, res)


def _link(mb, p0, p1, r, res, mat="M_Metal"):
    cylinder(mb, p0, p1, r, res["strut_seg"], mat)


def nose_gear(mb, mbw, ng, res, fus):
    """ng: R, W, spacing, z_attach, strut_r, door_len, door_h"""
    R, W, sp = ng["R"], ng["W"], ng["spacing"]
    za = ng["z_attach"]
    sr = ng["strut_r"]
    wheel_pair(mbw, 0.0, 0.0, R, W, sp, res)
    axle = np.array([0.0, 0.0, R])
    top = np.array([0.0, ng.get("rake", 0.12) * (za - R), za])
    piston_top = axle + (top - axle) * 0.45
    _link(mb, axle + np.array([0, 0.0, 0.05]), piston_top, sr * 0.62, res)  # chrome piston
    _link(mb, piston_top, top, sr, res)
    # axle tube
    _link(mb, axle + np.array([-sp / 2 + W * 0.3, 0, 0]), axle + np.array([sp / 2 - W * 0.3, 0, 0]),
          sr * 0.45, res)
    if res["gear_detail"] >= 1:
        # torque link (front)
        m1 = axle + (top - axle) * 0.25 + np.array([0, sr * 1.6, 0])
        _link(mb, axle + np.array([0, sr * 0.8, sr]), m1, sr * 0.22, res)
        _link(mb, m1, axle + (top - axle) * 0.50 + np.array([0, sr * 0.6, 0]), sr * 0.22, res)
        # drag brace going aft-up into the bay
        b0 = axle + (top - axle) * 0.62
        b1 = np.array([0.0, top[1] - ng.get("brace_len", 1.4), za + 0.1])
        _link(mb, b0, b1, sr * 0.45, res)
        # steering collar
        _link(mb, top + (axle - top) * 0.12, top + (axle - top) * 0.2, sr * 1.35, res)
    if res["gear_detail"] >= 1 and ng.get("door_len", 0) > 0:
        # with the gear down only the small aft doors (hinged at the bay sides) stay open
        dl, dh = ng["door_len"], ng["door_h"]
        yc = top[1] - 0.15 - dl * 0.5
        for sx in (-1, 1):
            x = sx * (ng.get("bay_w", 0.9) / 2 + 0.02)
            zt_ = fus.bottom_point(fus.s_ng - yc)[2] + 0.04
            box(mb, (x, yc, zt_ - dh / 2), (0.025, dl, dh), "M_Paint_Belly")
    # taxi light on the strut
    tl = top + (axle - top) * 0.3 + np.array([0, sr * 1.1, 0])
    dome(mb, tl, (0, 1, 0), sr * 0.55, sr * 0.35, res["light_seg"], "M_Lights", rings=2)
    return dict(taxi=tl, hitch=np.array([0.0, R * 0.95, R * 0.92]))


def main_leg(mb, mbw, lg, res, side):
    """One main gear leg. lg: x, y (bogie centre), R, W, spacing (lateral wheel c-c),
    axles (1, 2 or 3), axle_pitch, z_attach, strut_r, brace (x,y,z) target, door (h, w)."""
    sx = side
    x, y = sx * lg["x"], lg["y"]
    R, W, sp = lg["R"], lg["W"], lg["spacing"]
    na = lg.get("axles", 1)
    pitch = lg.get("axle_pitch", 0.0)
    sr = lg["strut_r"]
    za = lg["z_attach"]
    if na == 1:
        ys = [y]
    elif na == 2:
        ys = [y + pitch / 2, y - pitch / 2]
    else:
        ys = [y + pitch, y, y - pitch]
    for ay in ys:
        wheel_pair(mbw, x, ay, R, W, sp, res)
    axle_z = R
    top = np.array([x + sx * lg.get("cant", 0.0), y + lg.get("rake", 0.0), za])
    if na == 1:
        piv = np.array([x, y, axle_z])
        _link(mb, np.array([x - sp / 2 + W * 0.3, y, axle_z]), np.array([x + sp / 2 - W * 0.3, y, axle_z]),
              sr * 0.5, res)
    else:
        piv = np.array([x, y, axle_z + R * 0.18])
        # bogie beam
        _link(mb, np.array([x, ys[0] + 0.25 * R, axle_z + 0.05]), np.array([x, ys[-1] - 0.25 * R, axle_z + 0.05]),
              sr * 0.55, res)
        for ay in ys:
            _link(mb, np.array([x - sp / 2 + W * 0.3, ay, axle_z]), np.array([x + sp / 2 - W * 0.3, ay, axle_z]),
                  sr * 0.42, res)
    mid = piv + (top - piv) * 0.42
    _link(mb, piv, mid, sr * 0.68, res)          # chrome sliding tube
    _link(mb, mid, top, sr, res)                 # outer cylinder
    if res["gear_detail"] >= 1:
        _link(mb, mid + (top - mid) * 0.05, mid + (top - mid) * 0.12, sr * 1.25, res)
        # torque link (aft side)
        t1 = piv + (mid - piv) * 0.5 + np.array([0, -sr * 1.7, 0])
        _link(mb, piv + np.array([0, -sr * 0.7, 0.05]), t1, sr * 0.25, res)
        _link(mb, t1, mid + np.array([0, -sr * 0.6, 0.1]), sr * 0.25, res)
        b = lg.get("brace")
        if b is not None:
            bt = np.array([sx * b[0], b[1], b[2]])
            _link(mb, mid + (top - mid) * 0.35, bt, sr * 0.42, res)
        if na > 1 and res["gear_detail"] >= 2:
            # pitch trimmer
            _link(mb, mid + np.array([0, sr * 1.2, 0]), np.array([x, ys[0] + 0.2 * R, axle_z + 0.25 * R]),
                  sr * 0.18, res)
    d = lg.get("door")
    if d is not None and res["gear_detail"] >= 1:
        dh, dw = d
        box(mb, (x + sx * (sr + 0.05), top[1] - 0.05, top[2] - dh / 2 - 0.05), (0.04, dw, dh), "M_Paint_Belly")
    return dict(top=top, piv=piv)
