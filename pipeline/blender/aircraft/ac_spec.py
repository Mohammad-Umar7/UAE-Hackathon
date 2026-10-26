"""Helpers for writing aircraft type specs (pure python, no bpy)."""
import math
from ac_common import nose_curve, airfoil_pt, DEG
from ac_wing import Planform


def row(s0, pitch, count, skip=(), s_max=1e9):
    out = []
    for i in range(count):
        s = s0 + i * pitch
        if s > s_max:
            break
        if any(a <= s <= b for a, b in skip):
            continue
        out.append(round(s, 4))
    return out


def merge(*parts):
    pts = {}
    for p in parts:
        for s, v in p:
            pts[round(s, 4)] = v
    return sorted(pts.items())


def nose(length, v0, v1, a, n=14, power=2.0):
    return nose_curve(0.0, length, v0, v1, a, n=n, power=power)


def engine_center_z(wing, x_eng, y_fan, R, L, inlet=0.24, gap=0.10):
    """Highest nacelle centre height that keeps the nacelle top `gap` below the wing
    lower surface at the wing leading edge (approximate cowl radius there)."""
    pf = Planform(wing)
    le_y = pf.le_y(x_eng)
    p = pf.point(x_eng, 0.02, upper=False)
    a = le_y - y_fan  # axial distance forward of the fan face (negative = behind)
    L_in = inlet * L
    a_max = L_in - 0.36 * L
    a_ne = L_in - L
    # same cowl law as ac_engine.turbofan (piecewise approx)
    if a >= a_max:
        r = 1.0
    elif a >= a_ne + 0.30 * L:
        t = (a_max - a) / (a_max - (a_ne + 0.30 * L))
        r = 1.0 - 0.045 * t
    else:
        t = (a_ne + 0.30 * L - a) / (0.20 * L)
        r = 0.955 - 0.095 * min(t, 1.0)
    return p[2] - gap - r * R


def lower_surface_z(wing, e, y):
    pf = Planform(wing)
    xi = (pf.le_y(e) - y) / pf.chord(e)
    xi = min(max(xi, 0.0), 1.0)
    return pf.point(e, xi, upper=False)[2]
