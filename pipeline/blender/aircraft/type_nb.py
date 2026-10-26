"""nb - A320neo-family-class narrow-body (original procedural design).
Targets: length 37.6 m, span 35.8 m, height 11.8 m. Classic 6-window cockpit, sharklets."""
from ac_spec import row, merge, nose, engine_center_z

KEY = "nb"


def spec():
    L = 37.57
    s_ng = 5.07
    zb, H, hw = 1.70, 4.14, 1.975
    zt = zb + H
    ztip = 3.22
    y = lambda s: s_ng - s
    fus = dict(
        L=L, nose_len=6.9, tail_start=25.5,
        top=merge(nose(6.8, ztip, zt, 1.55), [(25.5, zt), (29.0, zt), (31.0, 5.80), (33.0, 5.70), (35.0, 5.53),
                                               (36.6, 5.36), (L, 5.29)]),
        bot=merge(nose(4.2, ztip, zb, 1.9), [(25.5, zb), (27.5, 1.80), (29.5, 2.08), (31.5, 2.55), (33.5, 3.22),
                                              (35.5, 4.05), (36.8, 4.58), (L, 4.85)]),
        hw=merge(nose(6.0, 0.0, hw, 1.8), [(25.5, hw), (27.5, 1.95), (29.5, 1.83), (31.5, 1.60), (33.5, 1.26),
                                           (35.5, 0.80), (36.8, 0.43), (L, 0.22)]),
        cheat=[(0, 0.475, 0.415), (L, 0.475, 0.415)],
        fairings=[dict(s0=10.6, s1=13.2, s2=21.0, s3=25.2, dw=0.30, dz=0.16, dn=0.7)],
    )
    wing = dict(
        e_root=0.6, e_ref=hw, e_tip=17.05, le_y=y(12.85), z=2.70,
        sweep=[(0, 27.5)], dihedral=[(0, 5.1)],
        chord=[(0.6, 6.82), (hw, 6.10), (6.3, 3.85), (17.05, 1.50)],
        twist=[(0.6, 3.0), (hw, 3.0), (6.3, 1.2), (17.05, -1.6)],
        tc=[(0.6, 0.155), (hw, 0.15), (6.3, 0.125), (17.05, 0.105)],
        camber=(0.018, 0.45, 0.010),
        tip=dict(kind="sharklet", radius=0.55, cant=80, length=1.95, sweep=38, sweep_in=30, tip_chord=0.42,
                 tip_tc=0.08),
        canoes=[dict(e=4.3, width=0.32, depth=0.42), dict(e=8.4, width=0.30, depth=0.40),
                dict(e=11.6, width=0.26, depth=0.34)],
        ailerons=[(12.6, 16.4, 0.76, 0.77)],
        flaps=[(2.15, 6.3, 0.79, 0.70), (6.3, 12.5, 0.72, 0.74)],
        spoilers=[(3.0, 12.3, 0.56, 0.69, 5)],
        slats=[(2.3, 16.6, 0.12)],
    )
    x_eng, s_fan, R, Ln = 5.75, 12.80, 1.19, 5.0
    cz = engine_center_z(wing, x_eng, y(s_fan), R, Ln, gap=0.08)
    ht = dict(e_root=0.25, e_ref=1.2, e_tip=6.22, le_y=y(32.2), z=4.30, sweep=[(0, 33.0)],
              dihedral=[(0, 6.0)], chord=[(0.25, 3.55), (1.2, 3.35), (6.22, 1.25)],
              tc=[(0, 0.11), (6.22, 0.09)], elevator=(1.6, 5.9, 0.70, 0.70))
    fin = dict(vertical=True, e_root=5.2, e_ref=5.80, e_tip=11.66, le_y=y(29.6), z=0.0, sweep=[(0, 40.0)],
               chord=[(5.2, 5.90), (5.80, 5.75), (11.66, 1.95)], tc=[(5.2, 0.105), (11.66, 0.09)],
               le_fillet=(0.9, 1.6), rudder=(6.05, 11.35, 0.70, 0.66),
               logo=dict(y0=y(32.95), y1=y(34.95), z0=7.4, z1=9.4))
    win = row(7.25, 0.533, 60, s_max=29.7)
    return dict(
        key=KEY, label="A320neo-class narrow-body", dims=dict(length=37.6, span=35.8, height=11.8),
        s_ng=s_ng, fus=fus, wing=wing, ht=ht, fin=fin,
        cockpit=[
            dict(c=[("t", 1.95, 0.022), ("z", 2.42, 4.47), ("z", 2.98, 4.83), ("t", 2.78, 0.022)], n=9),
            dict(c=[("z", 2.55, 4.47), ("z", 3.50, 4.46), ("z", 3.42, 4.92), ("z", 3.10, 4.86)], n=9),
            dict(c=[("z", 3.63, 4.46), ("z", 4.30, 4.47), ("z", 4.12, 4.92), ("z", 3.55, 4.93)], n=9),
        ],
        windows=[dict(z=4.42, w=0.23, h=0.32, n=2.8, s=win)],
        doors=[
            dict(s=6.05, z=3.42, w=0.81, h=1.85, n=5.5, lod2=True),
            dict(s=31.55, z=3.42, w=0.81, h=1.85, n=5.5),
            dict(s=15.55, z=3.92, w=0.51, h=0.92, n=4.5, minor=True),
            dict(s=16.45, z=3.92, w=0.51, h=0.92, n=4.5, minor=True),
            dict(s=9.0, z=1.98, w=1.80, h=1.22, n=5.0, side="R"),
            dict(s=24.3, z=2.02, w=1.80, h=1.22, n=5.0, side="R"),
        ],
        lines=[dict(st=[("t", 1.72, 0.004), ("t", 1.72, 0.25), ("t", 1.72, 0.5), ("t", 1.72, 0.75),
                        ("t", 1.72, 0.996)])],
        door_empties={"DOOR_L1": (6.05, 3.42)},
        engines=[dict(kind="turbofan", center=(x_eng, y(s_fan), cz), R=R, L=Ln, inlet=0.24, blades=18,
                      pylon=dict(width=0.55, front=0.30))],
        gear=dict(
            nose=dict(R=0.38, W=0.22, spacing=0.56, z_attach=2.05, strut_r=0.085, rake=0.10, door_len=1.0,
                      door_h=0.55, bay_w=0.75, brace_len=1.2),
            main=[dict(x=3.795, y=-12.64, R=0.585, W=0.43, spacing=0.93, axles=1, z_attach=2.95, strut_r=0.15,
                       brace=(2.1, -12.3, 2.85), door=(1.5, 0.95))],
        ),
        landing_light=dict(e=2.9),
        beacon_s=15.0, beacon_bottom_s=13.2,
        title=dict(s0=9.0, s1=15.4, z0=4.70, z1=5.50),
        res={2: dict(fus_ring=(6, 1, 4))},
        views=dict(engine_target=None),
    )
