"""biz - G650-class long-range business jet (original procedural design).
Targets: length 30.4 m, span 30.4 m, height 7.8 m. Sleek pointed nose, large oval windows,
rear fuselage-mounted engines, T-tail, blended winglets."""
from ac_spec import row, merge, nose

KEY = "biz"


def spec():
    L = 30.41
    s_ng = 3.2
    zb, H, hw = 0.98, 2.86, 1.36
    zt = zb + H
    ztip = 2.10
    y = lambda s: s_ng - s
    fus = dict(
        L=L, nose_len=6.0, tail_start=17.5,
        top=merge(nose(5.8, ztip, zt, 1.5), [(17.5, zt), (22.0, zt), (24.5, 3.78), (26.5, 3.62), (28.5, 3.45),
                                               (29.6, 3.37), (L, 3.34)]),
        bot=merge(nose(4.0, ztip, zb, 1.7), [(17.5, zb), (19.5, 1.10), (21.5, 1.42), (23.5, 1.85), (25.5, 2.30),
                                              (27.5, 2.68), (29.2, 2.88), (L, 2.98)]),
        hw=merge(nose(5.2, 0.0, hw, 1.5), [(17.5, hw), (19.5, 1.34), (21.5, 1.26), (23.5, 1.10), (25.5, 0.88),
                                           (27.5, 0.60), (29.2, 0.34), (L, 0.18)]),
        cheat=[(0, 0.46, 0.40), (L, 0.46, 0.40)],
        fairings=[dict(s0=10.2, s1=11.8, s2=17.4, s3=19.8, dw=0.22, dz=0.12, dn=0.6)],
    )
    wing = dict(
        e_root=0.4, e_ref=hw, e_tip=14.35, le_y=y(12.2), z=1.52,
        sweep=[(0, 38.0)], dihedral=[(0, 3.0)],
        chord=[(0.4, 7.15), (hw, 6.4), (4.0, 4.6), (14.35, 1.35)],
        twist=[(0.4, 3.0), (hw, 3.0), (4.0, 1.5), (14.35, -2.0)],
        tc=[(0.4, 0.13), (hw, 0.128), (4.0, 0.11), (14.35, 0.09)],
        camber=(0.02, 0.45, 0.008),
        tip=dict(kind="winglet", radius=0.45, cant=72, length=1.45, sweep=50, sweep_in=38, tip_chord=0.40,
                 tip_tc=0.08),
        canoes=[dict(e=4.6, width=0.18, depth=0.26), dict(e=8.0, width=0.16, depth=0.22)],
        ailerons=[(10.0, 13.6, 0.76, 0.78)], flaps=[(1.6, 4.0, 0.78, 0.72), (4.0, 9.6, 0.72, 0.75)],
        spoilers=[(4.4, 9.4, 0.60, 0.71, 3)], slats=[],
    )
    x_eng, s_fan, R, Ln = 2.42, 20.4, 0.80, 4.6
    ht = dict(e_root=0.0, e_ref=0.0, e_tip=5.0, le_y=y(26.6), z=7.47, sweep=[(0, 30.0)], dihedral=[(0, -1.5)],
              chord=[(0.0, 2.2), (5.0, 1.0)], tc=[(0, 0.10), (5.0, 0.09)], elevator=(0.5, 4.7, 0.70, 0.70))
    fin = dict(vertical=True, e_root=2.9, e_ref=3.84, e_tip=7.45, le_y=y(23.6), z=0.0, sweep=[(0, 44.0)],
               chord=[(2.9, 4.6), (3.84, 4.4), (7.45, 2.7)], tc=[(2.9, 0.11), (7.45, 0.10)],
               le_fillet=(0.6, 0.9), rudder=(4.1, 7.2, 0.70, 0.68), tip="none",
               bullet=dict(y0=y(26.0), y1=y(30.3), z=7.47, r=0.30),
               logo=dict(y0=y(25.95), y1=y(27.55), z0=4.55, z1=6.15))
    floor = zb + 0.55
    return dict(
        key=KEY, label="G650-class business jet", dims=dict(length=30.4, span=30.4, height=7.8),
        s_ng=s_ng, fus=fus, wing=wing, ht=ht, fin=fin,
        cockpit=[
            dict(c=[("xz", 0.05, 2.95), ("xz", 0.76, 2.78), ("xz", 0.60, 3.32), ("xz", 0.05, 3.46)], n=10),
            dict(c=[("z", 2.40, 2.76), ("z", 3.80, 2.81), ("z", 3.68, 3.31), ("z", 3.42, 3.33)], n=10),
            dict(c=[("z", 3.92, 2.83), ("z", 4.48, 2.86), ("z", 4.38, 3.26), ("z", 3.84, 3.28)], n=10),
        ],
        windows=[dict(z=floor + 0.92, w=0.62, h=0.47, n=2.25, s=row(6.35, 1.02, 13, s_max=18.6))],
        doors=[
            dict(s=4.95, z=floor, w=0.91, h=1.72, n=5.5, side="L", lod2=True),
            dict(s=13.6, z=floor + 0.45, w=0.51, h=0.92, n=4.5, side="R", minor=True),
            dict(s=19.7, z=floor + 0.2, w=0.70, h=0.75, n=5.0, side="L"),
        ],
        lines=[dict(st=[("t", 1.25, 0.004), ("t", 1.25, 0.25), ("t", 1.25, 0.5), ("t", 1.25, 0.75),
                        ("t", 1.25, 0.996)])],
        door_empties={"DOOR_L1": (4.95, floor)},
        engines=[dict(kind="turbofan", center=(x_eng, y(s_fan), 3.25), R=R, L=Ln, inlet=0.24, blades=24,
                      pylon=dict(kind="stub", x0=0.9, x1=2.1, y_le=y(21.3), chord=2.1, z=3.15, tc=0.12))],
        gear=dict(
            nose=dict(R=0.27, W=0.18, spacing=0.42, z_attach=1.30, strut_r=0.065, rake=0.08, door_len=0.7,
                      door_h=0.35, bay_w=0.55, brace_len=0.8),
            main=[dict(x=2.15, y=-13.4, R=0.44, W=0.28, spacing=0.40, axles=1, z_attach=1.62, strut_r=0.09,
                       brace=(1.3, -13.1, 1.5), door=(0.9, 0.7))],
        ),
        landing_light=dict(e=2.2),
        beacon_s=13.0, beacon_bottom_s=12.0,
        title=dict(s0=7.0, s1=12.6, z0=2.95, z1=3.65),
    )
