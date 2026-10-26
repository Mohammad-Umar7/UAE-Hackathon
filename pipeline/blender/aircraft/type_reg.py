"""reg - ATR 72-class twin turboprop (original procedural design).
Targets: length 27.2 m, span 27.1 m, height 7.7 m. Blunt nose, high wing on a dorsal root fairing,
T-tail with large dorsal fin, under-wing turboprop nacelles with 6-blade propellers (PROP_L/PROP_R),
main gear in fuselage sponsons, black de-icing boots on the leading edges."""
from ac_spec import row, merge, nose

KEY = "reg"


def spec():
    L = 27.17
    s_ng = 2.3
    zb, H, hw = 0.75, 2.90, 1.43
    zt = zb + H
    ztip = 1.92
    y = lambda s: s_ng - s
    fus = dict(
        L=L, nose_len=4.6, tail_start=17.0,
        top=merge([(0, ztip), (0.05, 2.12), (0.2, 2.30), (0.5, 2.46), (0.9, 2.58), (1.3, 2.68), (1.7, 2.86),
                   (2.1, 3.08), (2.6, 3.32), (3.2, 3.52), (3.9, 3.62), (4.5, zt)], [(17.0, zt), (21.0, zt), (23.0, 3.60), (25.0, 3.50), (26.4, 3.38),
                                               (L, 3.31)]),
        bot=merge(nose(2.9, ztip, zb, 1.9), [(17.0, zb), (19.0, 0.86), (21.0, 1.18), (23.0, 1.68), (25.0, 2.30),
                                              (26.4, 2.72), (L, 2.95)]),
        hw=merge(nose(3.7, 0.0, hw, 1.85), [(17.0, hw), (19.0, 1.40), (21.0, 1.28), (23.0, 1.04), (25.0, 0.68),
                                            (26.4, 0.36), (L, 0.18)]),
        cheat=[(0, 0.44, 0.385), (L, 0.44, 0.385)],
        # main-gear sponsons on the lower sides
        fairings=[dict(s0=10.3, s1=11.6, s2=14.6, s3=16.6, dw=0.80, dz=0.08, dn=0.3)],
        # wing-root fairing on top of the cabin
        bubbles=[dict(top=[(9.6, 3.2), (10.9, 3.98), (14.6, 3.98), (16.4, 3.45), (17.5, 3.0)],
                      hw=[(9.6, 1.25), (17.5, 1.25)], r=0.95, k=0.22, s0=9.6, s1=17.5)],
    )
    wing = dict(
        e_root=0.0, e_ref=0.0, e_tip=13.48, le_y=y(11.55), z=4.13,
        sweep=[(0, 0.0), (4.9, 3.5)], dihedral=[(0, 0.0), (4.9, 2.5)],
        chord=[(0.0, 2.57), (4.9, 2.57), (13.48, 1.41)],
        twist=[(0.0, 2.0), (4.9, 2.0), (13.48, -1.0)],
        tc=[(0.0, 0.18), (4.9, 0.17), (13.48, 0.13)],
        camber=(0.03, 0.40, 0.0), le_mat="M_Dark", le_frac=0.075,
        tip=dict(kind="cap"), canoes=[],
        ailerons=[(10.0, 13.1, 0.72, 0.73)], flaps=[(1.5, 4.7, 0.70, 0.70), (5.1, 9.8, 0.71, 0.72)],
        spoilers=[(6.0, 9.0, 0.56, 0.68, 1)], slats=[],
    )
    ht = dict(e_root=0.0, e_ref=0.0, e_tip=3.66, le_y=y(24.45), z=7.43, sweep=[(0, 10.0)], dihedral=[(0, 0.0)],
              chord=[(0.0, 1.75), (3.66, 1.0)], tc=[(0, 0.12), (3.66, 0.10)], le_mat="M_Dark", le_frac=0.07,
              elevator=(0.5, 3.4, 0.68, 0.68))
    fin = dict(vertical=True, e_root=2.8, e_ref=3.6, e_tip=7.41, le_y=y(20.8), z=0.0, sweep=[(0, 33.0)],
               chord=[(2.8, 4.45), (3.6, 4.2), (7.41, 2.0)], tc=[(2.8, 0.12), (7.41, 0.11)],
               le_fillet=(1.7, 3.4), rudder=(3.9, 7.2, 0.66, 0.62), tip="none", le_mat="M_Dark", le_frac=0.06,
               bullet=dict(y0=y(23.3), y1=y(26.5), z=7.43, r=0.22),
               logo=dict(y0=y(22.55), y1=y(24.05), z0=4.45, z1=5.95))
    floor = zb + 0.62
    skip = [(3.4, 5.1), (19.6, 21.0)]
    return dict(
        key=KEY, label="ATR 72-class turboprop", dims=dict(length=27.2, span=27.1, height=7.7),
        s_ng=s_ng, fus=fus, wing=wing, ht=ht, fin=fin,
        cockpit=[
            dict(c=[("xz", 0.06, 2.72), ("xz", 0.86, 2.60), ("xz", 0.74, 3.12), ("xz", 0.06, 3.26)], n=9),
            dict(c=[("z", 2.02, 2.60), ("z", 2.98, 2.63), ("z", 2.88, 3.13), ("z", 2.76, 3.15)], n=9),
            dict(c=[("z", 3.06, 2.63), ("z", 3.55, 2.64), ("z", 3.46, 3.06), ("z", 3.02, 3.08)], n=9),
        ],
        windows=[dict(z=floor + 0.95, w=0.24, h=0.34, n=2.7, s=row(5.6, 0.80, 20, skip=skip, s_max=19.4))],
        doors=[
            dict(s=20.3, z=floor, w=0.72, h=1.75, n=5.5, side="L", lod2=True),
            dict(s=4.25, z=floor, w=1.27, h=1.53, n=5.0, side="L"),
            dict(s=20.3, z=floor, w=0.62, h=1.40, n=5.0, side="R"),
            dict(s=5.40, z=floor + 0.45, w=0.51, h=0.91, n=4.5, side="R", minor=True),
        ],
        lines=[dict(st=[("t", 1.2, 0.004), ("t", 1.2, 0.25), ("t", 1.2, 0.5), ("t", 1.2, 0.75),
                        ("t", 1.2, 0.996)])],
        door_empties={"DOOR_L1": (20.3, floor)},
        engines=[dict(kind="turboprop", hub=(4.10, y(9.05), 3.27), center=(4.10, y(9.05), 3.27), length=6.4,
                      width=0.92, depth=1.08, r_front=0.38, prop_r=1.965, blades=6, spinner_r=0.34,
                      spinner_l=0.72)],
        gear=dict(
            nose=dict(R=0.225, W=0.15, spacing=0.36, z_attach=1.10, strut_r=0.055, rake=0.06, door_len=0.6,
                      door_h=0.3, bay_w=0.5, brace_len=0.7),
            main=[dict(x=2.0, y=-10.77, R=0.43, W=0.25, spacing=0.42, axles=1, z_attach=1.25, strut_r=0.10, cant=-0.28,
                       brace=(1.55, -10.5, 1.15))],
        ),
        landing_light=dict(e=2.6),
        beacon_s=12.5, beacon_bottom_s=12.0,
        title=dict(s0=15.3, s1=19.6, z0=2.62, z1=3.16),
    )
