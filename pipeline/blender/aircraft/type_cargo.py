"""cargo - 747-8F-class freighter (original procedural design).
Targets: length 76.3 m, span 68.4 m, height 19.4 m. Short upper-deck hump, visor nose cargo door,
main-deck side cargo door, no cabin windows (a few upper-deck windows), raked tips, four engines,
18 wheels (2 nose + 4 x 4-wheel main bogies)."""
import numpy as np
from ac_spec import row, merge, nose, engine_center_z
from ac_fuselage import Fuselage

KEY = "cargo"


def spec():
    L = 76.25
    s_ng = 7.0
    zb, H, hw = 2.0, 6.6, 3.25
    zt = zb + H
    ztip = 4.31
    y = lambda s: s_ng - s
    hump_top = merge(nose(10.0, ztip + 0.05, 10.2, 1.5), [(25.5, 10.2), (28.0, 10.05), (30.5, 9.55), (32.5, 9.0),
                                                           (34.0, 8.68), (35.5, 8.50), (L, 8.0)])
    fus = dict(
        L=L, nose_len=9.5, tail_start=52.0,
        top=merge(nose(8.0, ztip, zt, 1.8), [(52.0, zt), (58.0, zt), (62.0, 8.55), (66.0, 8.48), (70.0, 8.42),
                                              (73.0, 8.48), (L, 8.65)]),
        bot=merge(nose(4.8, ztip, zb, 1.9), [(52.0, zb), (55.0, 2.15), (58.0, 2.75), (61.0, 3.75), (64.0, 4.95),
                                              (67.0, 6.05), (70.0, 6.95), (73.0, 7.60), (L, 7.95)]),
        hw=merge(nose(7.6, 0.0, hw, 1.8), [(52.0, hw), (55.0, 3.18), (58.0, 2.95), (61.0, 2.58), (64.0, 2.10),
                                           (67.0, 1.58), (70.0, 1.07), (73.0, 0.62), (L, 0.35)]),
        cheat=[(0, 0.475, 0.42), (L, 0.475, 0.42)],
        fairings=[dict(s0=20.0, s1=24.0, s2=44.0, s3=51.0, dw=0.45, dz=0.28, dn=0.8)],
        bubbles=[dict(top=hump_top, hw=[(0, 0.4), (3, 1.5), (6, 2.15), (9, 2.3), (30, 2.3), (35.5, 2.0)], r=2.6,
                      k=0.30, s0=0.0, s1=37.0)],
    )
    wing = dict(
        e_root=0.9, e_ref=hw, e_tip=34.1, le_y=y(27.6), z=3.62,
        sweep=[(0, 40.0), (30.5, 58.0)], dihedral=[(0, 7.0)],
        chord=[(0.9, 15.97), (hw, 14.0), (10.5, 9.0), (30.5, 3.9), (34.1, 1.0)],
        twist=[(0.9, 3.5), (hw, 3.5), (10.5, 1.5), (34.1, -2.5)],
        tc=[(0.9, 0.134), (hw, 0.132), (10.5, 0.11), (30.5, 0.085), (34.1, 0.08)],
        camber=(0.018, 0.45, 0.010), breaks=[30.5],
        tip=dict(kind="cap"),
        canoes=[dict(e=7.6, width=0.50, depth=0.72), dict(e=15.8, width=0.44, depth=0.62),
                dict(e=24.4, width=0.38, depth=0.52), dict(e=28.0, width=0.32, depth=0.44)],
        ailerons=[(25.0, 31.0, 0.78, 0.80)], flaps=[(3.6, 10.3, 0.80, 0.73), (10.7, 24.4, 0.74, 0.77)],
        spoilers=[(4.2, 24.0, 0.58, 0.72, 7)], slats=[(4.0, 33.0, 0.12)],
    )
    eng = []
    for x_eng, s_fan in ((11.9, 32.78), (21.1, 40.68)):
        R, Ln = 1.60, 6.3
        cz = engine_center_z(wing, x_eng, y(s_fan), R, Ln, inlet=0.25, gap=0.10)
        eng.append(dict(kind="turbofan", center=(x_eng, y(s_fan), cz), R=R, L=Ln, inlet=0.25, blades=18,
                        pylon=dict(width=0.72, front=0.32)))
    ht = dict(e_root=0.4, e_ref=1.6, e_tip=11.09, le_y=y(62.0), z=6.4, sweep=[(0, 40.0)], dihedral=[(0, 7.0)],
              chord=[(0.4, 7.4), (1.6, 7.0), (11.09, 2.3)], tc=[(0, 0.11), (11.09, 0.09)],
              elevator=(2.0, 10.6, 0.70, 0.70))
    fin = dict(vertical=True, e_root=7.6, e_ref=8.6, e_tip=19.28, le_y=y(58.5), z=0.0, sweep=[(0, 45.0)],
               chord=[(7.6, 13.5), (8.6, 12.5), (19.28, 4.0)], tc=[(7.6, 0.105), (19.28, 0.09)],
               le_fillet=(1.6, 2.6), rudder=(9.0, 19.0, 0.72, 0.70),
               logo=dict(y0=y(65.9), y1=y(69.9), z0=11.8, z1=15.8))
    floor = 5.05
    # nose cargo door sill: centreline point on the nose skin at main-deck floor height
    f = Fuselage(fus, s_ng)
    lo, hi = 0.0, 3.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if f.section(mid)[1][0] < floor:
            lo = mid
        else:
            hi = mid
    door_nose = (0.0, float(f.y(hi)), floor)
    return dict(
        key=KEY, label="747-8F-class freighter", dims=dict(length=76.3, span=68.4, height=19.4),
        s_ng=s_ng, fus=fus, wing=wing, ht=ht, fin=fin,
        cockpit=[
            dict(c=[("xz", 0.08, 8.10), ("xz", 1.00, 8.02), ("xz", 0.90, 8.76), ("xz", 0.08, 8.88)], n=9),
            dict(c=[("xz", 1.20, 8.02), ("z", 6.60, 8.05), ("z", 6.45, 8.72), ("xz", 1.10, 8.75)], n=9),
            dict(c=[("z", 6.76, 8.06), ("z", 7.45, 8.10), ("z", 7.30, 8.66), ("z", 6.68, 8.70)], n=9),
        ],
        windows=[dict(z=9.05, w=0.22, h=0.32, n=2.7, s=[9.6, 10.2, 10.8])],
        doors=[
            dict(s=9.7, z=floor, w=1.07, h=1.93, n=5.5, lod2=True),
            dict(s=53.0, z=floor, w=3.40, h=3.05, n=6.0, side="L", lod2=True),
            dict(s=15.0, z=2.45, w=2.64, h=1.68, n=5.0, side="R"),
            dict(s=46.0, z=2.55, w=2.64, h=1.68, n=5.0, side="R"),
        ],
        lines=[dict(st=[("t", 3.4, 0.0), ("z", 3.4, 7.45), ("z", 4.6, 7.45), ("z", 6.0, 7.45), ("z", 7.4, 7.45),
                        ("z", 7.4, 6.2), ("z", 7.4, 4.0), ("z", 7.4, 2.6), ("t", 7.4, 0.999)])],
        door_empties={"DOOR_L1": (9.7, floor), "DOOR_MAIN_CARGO": (53.0, floor)},
        extra_empties={"DOOR_NOSE": door_nose},
        engines=eng,
        gear=dict(
            nose=dict(R=0.62, W=0.43, spacing=0.95, z_attach=2.55, strut_r=0.15, rake=0.10, door_len=1.5,
                      door_h=0.8, bay_w=1.2, brace_len=1.8),
            main=[dict(x=5.5, y=-28.0, R=0.66, W=0.53, spacing=1.12, axles=2, axle_pitch=1.47, z_attach=4.2,
                       strut_r=0.24, brace=(3.9, -27.5, 4.0), door=(2.2, 1.4)),
                  dict(x=1.92, y=-31.4, R=0.66, W=0.53, spacing=1.12, axles=2, axle_pitch=1.47, z_attach=2.7,
                       strut_r=0.24, door=(1.6, 1.4))],
        ),
        landing_light=dict(e=6.0),
        beacon_s=30.0, beacon_bottom_s=27.0,
        title=dict(s0=19.0, s1=31.8, z0=5.60, z1=7.20),
    )
