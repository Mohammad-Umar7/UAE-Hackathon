"""wb - 787-9-class wide-body twin (original procedural design).
Targets: length 62.8 m, span 60.1 m, height 17.0 m. Smooth 4-window nose, raked tips, chevrons."""
from ac_spec import row, merge, nose, engine_center_z

KEY = "wb"


def spec():
    L = 62.81
    s_ng = 5.8
    zb, H, hw = 2.10, 5.97, 2.885
    zt = zb + H
    ztip = 4.15
    y = lambda s: s_ng - s
    fus = dict(
        L=L, nose_len=10.2, tail_start=44.0,
        top=merge(nose(9.2, ztip, zt, 1.6), [(44.0, zt), (49.0, zt), (52.0, 8.03), (55.0, 7.93), (58.0, 7.80),
                                               (60.5, 7.69), (L, 7.66)]),
        bot=merge(nose(4.6, ztip, zb, 2.0), [(44.0, zb), (46.5, 2.22), (49.0, 2.62), (52.0, 3.45), (55.0, 4.55),
                                              (58.0, 5.72), (60.5, 6.58), (L, 7.10)]),
        hw=merge(nose(7.6, 0.0, hw, 1.85), [(44.0, hw), (46.5, 2.85), (49.0, 2.70), (52.0, 2.36), (55.0, 1.85),
                                            (58.0, 1.20), (60.5, 0.66), (L, 0.28)]),
        cheat=[(0, 0.475, 0.42), (L, 0.475, 0.42)],
        fairings=[dict(s0=19.0, s1=23.0, s2=37.0, s3=42.5, dw=0.42, dz=0.24, dn=0.7)],
    )
    wing = dict(
        e_root=0.8, e_ref=hw, e_tip=30.0, le_y=y(23.4), z=3.66,
        sweep=[(0, 34.0), (26.5, 52.0)], dihedral=[(0, 6.0)],
        chord=[(0.8, 13.34), (hw, 11.93), (9.6, 7.40), (26.5, 2.10), (30.0, 0.75)],
        twist=[(0.8, 3.5), (hw, 3.5), (9.6, 1.5), (30.0, -2.0)],
        tc=[(0.8, 0.15), (hw, 0.148), (9.6, 0.12), (26.5, 0.10), (30.0, 0.09)],
        camber=(0.018, 0.45, 0.010), breaks=[26.5],
        tip=dict(kind="cap"),
        canoes=[dict(e=6.6, width=0.42, depth=0.62), dict(e=13.4, width=0.38, depth=0.55),
                dict(e=17.6, width=0.34, depth=0.48), dict(e=21.6, width=0.30, depth=0.40)],
        ailerons=[(22.0, 26.8, 0.78, 0.80)], flaps=[(3.1, 9.4, 0.80, 0.72), (10.2, 21.6, 0.73, 0.76)],
        spoilers=[(3.6, 21.0, 0.58, 0.72, 7)], slats=[(3.3, 26.0, 0.12)],
    )
    x_eng, s_fan, R, Ln = 9.75, 25.8, 1.72, 6.9
    cz = engine_center_z(wing, x_eng, y(s_fan), R, Ln, inlet=0.26, gap=0.10)
    ht = dict(e_root=0.3, e_ref=1.5, e_tip=9.9, le_y=y(52.6), z=6.0, sweep=[(0, 36.0)], dihedral=[(0, 7.0)],
              chord=[(0.3, 5.6), (1.5, 5.3), (9.9, 1.8)], tc=[(0, 0.11), (9.9, 0.09)],
              elevator=(1.9, 9.5, 0.70, 0.70))
    fin = dict(vertical=True, e_root=7.3, e_ref=8.0, e_tip=16.9, le_y=y(49.0), z=0.0, sweep=[(0, 40.0)],
               chord=[(7.3, 9.3), (8.0, 9.0), (16.9, 3.0)], tc=[(7.3, 0.105), (16.9, 0.09)],
               le_fillet=(1.4, 2.4), rudder=(8.3, 16.5, 0.70, 0.68),
               logo=dict(y0=y(54.3), y1=y(57.3), z0=10.7, z1=13.7))
    floor = 4.55
    skip = [(6.9, 8.3), (17.7, 19.3), (36.8, 38.4), (54.2, 55.8)]
    win = row(8.6, 0.635, 80, skip=skip, s_max=53.8)
    return dict(
        key=KEY, label="787-9-class wide-body twin", dims=dict(length=62.8, span=60.1, height=17.0),
        s_ng=s_ng, fus=fus, wing=wing, ht=ht, fin=fin,
        cockpit=[
            dict(c=[("xz", 0.07, 6.02), ("xz", 1.18, 5.92), ("xz", 1.02, 6.72), ("xz", 0.07, 6.88)], n=10),
            dict(c=[("xz", 1.40, 5.92), ("z", 5.35, 6.02), ("z", 5.00, 6.78), ("xz", 1.22, 6.74)], n=10),
        ],
        windows=[dict(z=floor + 1.08, w=0.27, h=0.46, n=2.6, s=win)],
        doors=[
            dict(s=7.6, z=floor, w=1.07, h=1.93, n=5.5, lod2=True),
            dict(s=18.5, z=floor, w=1.07, h=1.93, n=5.5),
            dict(s=37.6, z=floor, w=1.07, h=1.93, n=5.5),
            dict(s=55.0, z=floor, w=1.07, h=1.93, n=5.5),
            dict(s=12.6, z=2.55, w=2.70, h=1.70, n=5.0, side="R"),
            dict(s=41.6, z=2.60, w=2.70, h=1.70, n=5.0, side="R"),
        ],
        lines=[dict(st=[("t", 2.15, 0.004), ("t", 2.15, 0.25), ("t", 2.15, 0.5), ("t", 2.15, 0.75),
                        ("t", 2.15, 0.996)])],
        door_empties={"DOOR_L1": (7.6, floor), "DOOR_L2": (18.5, floor)},
        engines=[dict(kind="turbofan", center=(x_eng, y(s_fan), cz), R=R, L=Ln, inlet=0.26, blades=18,
                      chevrons=12, chev_depth=0.045, pylon=dict(width=0.72, front=0.32))],
        gear=dict(
            nose=dict(R=0.51, W=0.40, spacing=0.78, z_attach=2.65, strut_r=0.12, rake=0.10, door_len=1.4,
                      door_h=0.75, bay_w=1.1, brace_len=1.6),
            main=[dict(x=4.9, y=-25.6, R=0.635, W=0.50, spacing=1.40, axles=2, axle_pitch=1.46, z_attach=3.95,
                       strut_r=0.22, brace=(3.3, -25.1, 3.75), door=(1.9, 1.3))],
        ),
        landing_light=dict(e=4.3),
        beacon_s=26.5, beacon_bottom_s=24.0,
        title=dict(s0=11.0, s1=21.4, z0=6.05, z1=7.35),
    )
