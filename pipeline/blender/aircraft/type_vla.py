"""vla - A380-class double-deck very large aircraft (original procedural design).
Targets: length 72.7 m, span 79.8 m, height 24.1 m. Tall oval double-deck fuselage, four engines,
wingtip fences, 22 main wheels (2 x 4-wheel wing gear + 2 x 6-wheel body gear)."""
from ac_spec import row, merge, nose, engine_center_z

KEY = "vla"


def spec():
    L = 72.72
    s_ng = 6.6
    zb, H, hw = 1.95, 8.41, 3.57
    zt = zb + H
    ztip = 5.05
    y = lambda s: s_ng - s
    fus = dict(
        L=L, nose_len=13.8, tail_start=50.0,
        top=merge([(0, ztip), (0.05, 5.35), (0.2, 5.62), (0.5, 5.86), (1.0, 6.06), (1.6, 6.22), (2.2, 6.38),
                   (2.8, 6.68), (3.3, 7.05), (3.9, 7.55), (4.6, 8.05), (5.5, 8.62), (6.6, 9.18), (8.0, 9.70),
                   (9.6, 10.10), (11.2, 10.30), (12.5, zt)], [(50.0, zt), (55.0, zt), (58.0, 10.25), (61.0, 10.02),
                                                (64.0, 9.68), (67.0, 9.30), (70.0, 9.00), (L, 8.95)]),
        bot=merge([(0, ztip), (0.05, 4.75), (0.2, 4.45), (0.5, 4.05), (1.0, 3.55), (1.6, 3.08), (2.4, 2.62),
                   (3.4, 2.25), (4.6, 2.05), (6.0, 1.97), (7.0, zb)], [(50.0, zb), (53.0, 2.10), (56.0, 2.70), (59.0, 3.70), (62.0, 4.95),
                                              (65.0, 6.18), (68.0, 7.22), (70.5, 7.92), (L, 8.25)]),
        hw=merge([(0, 0.0), (0.05, 0.38), (0.2, 0.72), (0.5, 1.12), (1.0, 1.56), (1.6, 1.94), (2.4, 2.35),
                  (3.4, 2.75), (4.6, 3.10), (6.0, 3.38), (7.5, 3.53), (8.6, hw)], [(50.0, hw), (53.0, 3.52), (56.0, 3.30), (59.0, 2.90), (62.0, 2.36),
                                           (65.0, 1.75), (68.0, 1.12), (70.5, 0.62), (L, 0.35)]),
        kc=[(0, 0.47), (L, 0.47)], n_top=[(0, 2.12), (L, 2.12)], n_bot=[(0, 2.08), (L, 2.08)],
        cheat=[(0, 0.43, 0.385), (L, 0.43, 0.385)],
        fairings=[dict(s0=21.5, s1=26.0, s2=44.0, s3=50.0, dw=0.55, dz=0.30, dn=0.8)],
    )
    wing = dict(
        e_root=0.9, e_ref=hw, e_tip=39.80, le_y=y(27.3), z=4.15,
        sweep=[(0, 35.0)], dihedral=[(0, 5.6)],
        chord=[(0.9, 19.45), (hw, 17.6), (12.4, 11.8), (39.8, 4.1)],
        twist=[(0.9, 3.5), (hw, 3.5), (12.4, 1.5), (39.8, -2.5)],
        tc=[(0.9, 0.135), (hw, 0.133), (12.4, 0.11), (39.8, 0.085)],
        camber=(0.018, 0.45, 0.010),
        tip=dict(kind="fence", up=1.30, down=0.70, sweep=58),
        canoes=[dict(e=8.2, width=0.55, depth=0.80), dict(e=20.4, width=0.48, depth=0.70),
                dict(e=28.5, width=0.42, depth=0.60), dict(e=33.6, width=0.36, depth=0.50)],
        ailerons=[(28.5, 38.8, 0.76, 0.78)], flaps=[(4.0, 12.2, 0.79, 0.72), (12.6, 27.8, 0.73, 0.76)],
        spoilers=[(5.0, 27.0, 0.58, 0.71, 8)], slats=[(4.0, 38.5, 0.12)],
    )
    eng = []
    for x_eng, s_fan in ((15.3, 34.3), (25.6, 41.6)):
        R, Ln = 1.80, 7.0
        cz = engine_center_z(wing, x_eng, y(s_fan), R, Ln, inlet=0.25, gap=0.10)
        eng.append(dict(kind="turbofan", center=(x_eng, y(s_fan), cz), R=R, L=Ln, inlet=0.25, blades=24,
                        pylon=dict(width=0.80, front=0.32)))
    ht = dict(e_root=0.4, e_ref=2.0, e_tip=15.19, le_y=y(57.5), z=6.7, sweep=[(0, 37.0)], dihedral=[(0, 7.0)],
              chord=[(0.4, 9.6), (2.0, 9.0), (15.19, 3.2)], tc=[(0, 0.11), (15.19, 0.09)],
              elevator=(2.4, 14.6, 0.70, 0.70))
    fin = dict(vertical=True, e_root=9.0, e_ref=10.3, e_tip=24.0, le_y=y(54.0), z=0.0, sweep=[(0, 40.0)],
               chord=[(9.0, 14.45), (10.3, 13.6), (24.0, 4.6)], tc=[(9.0, 0.105), (24.0, 0.09)],
               le_fillet=(1.8, 3.2), rudder=(11.2, 23.5, 0.70, 0.68),
               logo=dict(y0=y(61.8), y1=y(66.2), z0=14.9, z1=19.3))
    main_floor, up_floor = 5.10, 8.05
    skip_m = [(8.9, 10.5), (20.2, 21.8), (33.8, 35.4), (46.7, 48.3)]
    skip_u = [(13.6, 15.2), (33.2, 34.8)]
    return dict(
        key=KEY, label="A380-class double-deck", dims=dict(length=72.7, span=79.8, height=24.1),
        s_ng=s_ng, fus=fus, wing=wing, ht=ht, fin=fin,
        cockpit=[
            dict(c=[("xz", 0.08, 6.45), ("xz", 1.05, 6.30), ("xz", 0.95, 7.00), ("xz", 0.08, 7.15)], n=9),
            dict(c=[("xz", 1.30, 6.28), ("z", 4.55, 6.30), ("z", 4.40, 7.00), ("xz", 1.18, 7.02)], n=9),
            dict(c=[("z", 4.72, 6.31), ("z", 5.55, 6.33), ("z", 5.40, 6.95), ("z", 4.62, 6.99)], n=9),
        ],
        windows=[dict(z=main_floor + 0.98, w=0.25, h=0.37, n=2.7, s=row(10.9, 0.533, 120, skip=skip_m, s_max=61.0)),
                 dict(z=up_floor + 0.95, w=0.24, h=0.35, n=2.7, s=row(15.6, 0.533, 100, skip=skip_u, s_max=56.6))],
        doors=[
            dict(s=9.7, z=main_floor, w=1.07, h=1.93, n=5.5, lod2=True),
            dict(s=21.0, z=main_floor, w=1.07, h=1.93, n=5.5),
            dict(s=34.6, z=main_floor, w=1.07, h=1.93, n=5.5),
            dict(s=47.5, z=main_floor, w=1.07, h=1.93, n=5.5),
            dict(s=62.0, z=main_floor, w=1.07, h=1.93, n=5.5),
            dict(s=14.4, z=up_floor, w=1.07, h=1.93, n=5.5),
            dict(s=34.0, z=up_floor, w=1.07, h=1.93, n=5.5),
            dict(s=57.5, z=up_floor, w=1.07, h=1.93, n=5.5),
            dict(s=14.0, z=2.45, w=2.70, h=1.70, n=5.0, side="R"),
            dict(s=52.4, z=2.55, w=2.70, h=1.70, n=5.0, side="R"),
        ],
        lines=[dict(st=[("t", 2.2, 0.004), ("t", 2.2, 0.25), ("t", 2.2, 0.5), ("t", 2.2, 0.75), ("t", 2.2, 0.996)])],
        door_empties={"DOOR_L1": (9.7, main_floor), "DOOR_L2": (21.0, main_floor), "DOOR_UL1": (14.4, up_floor)},
        engines=eng,
        gear=dict(
            nose=dict(R=0.635, W=0.455, spacing=1.05, z_attach=2.65, strut_r=0.16, rake=0.10, door_len=1.6,
                      door_h=0.85, bay_w=1.3, brace_len=1.9),
            main=[dict(x=6.15, y=-30.0, R=0.71, W=0.53, spacing=1.55, axles=2, axle_pitch=1.75, z_attach=4.6,
                       strut_r=0.26, brace=(4.2, -29.5, 4.4), door=(2.4, 1.6)),
                  dict(x=2.65, y=-33.6, R=0.71, W=0.53, spacing=1.55, axles=3, axle_pitch=1.75, z_attach=2.8,
                       strut_r=0.26, door=(1.8, 1.6))],
        ),
        landing_light=dict(e=6.0),
        beacon_s=33.0, beacon_bottom_s=30.0,
        title=dict(s0=15.5, s1=29.9, z0=6.62, z1=8.42),
        res={0: dict(fus_ring=(18, 2, 12), wheel_seg=20, tyre_prof=8, win_seg=12, nose_max_ds=0.26, canoe_n=6),
             1: dict(fus_ring=(10, 1, 6))},
    )
