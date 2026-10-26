"""Kit contact sheet (true-scale line-up with 1.8 m reference figures) and jet bridge pose renders.
Called from render_previews.py (--mode contact,bridge)."""
import math
import os

import bpy
from mathutils import Matrix, Vector

import render_previews as rp
from eqlib import registry
from eqlib.geo import Geo, box, cylinder, lathe, quad, tube


# --------------------------------------------------------------- bridge posing
def bridge_parts(root):
    objs = {o.name.split('.')[0]: o for o in rp.tree(root)}
    need = ['JB_Rotunda', 'JB_Tunnel_A', 'JB_Tunnel_B', 'JB_Cab', 'JB_DriveColumn', 'JB_DriveColumn_Lift']
    return {k: objs[k] for k in need}, objs


def pose_bridge(root, yaw_deg=0.0, pitch_deg=0.0, t_ext=0.41, cab_yaw_deg=0.0):
    """Reference implementation of the runtime docking math (bridge frame = root frame).
    yaw: tunnel yaw about the rotunda axis; pitch: about Tunnel A's rear floor point;
    t_ext: 0 = B retracted .. 1 = B extended; cab yaw relative to the tunnel, cab kept level."""
    bpy.context.view_layer.update()
    P, objs = bridge_parts(root)
    R0 = root.matrix_world.copy()
    Ri = R0.inverted()

    def local(o):                      # rest matrix in the bridge frame
        return Ri @ o.matrix_world

    A0, B0 = local(P['JB_Tunnel_A']), local(P['JB_Tunnel_B'])
    mount = (Ri @ objs['TUNNEL_A_MOUNT'].matrix_world).translation
    b_min = A0.inverted() @ (Ri @ objs['TUNNEL_B_RETRACTED'].matrix_world).translation
    b_max = A0.inverted() @ (Ri @ objs['TUNNEL_B_EXTENDED'].matrix_world).translation
    cab_piv = B0.inverted() @ (Ri @ objs['CAB_PIVOT'].matrix_world).translation
    col_mnt = B0.inverted() @ (Ri @ objs['DRIVE_COLUMN_MOUNT'].matrix_world).translation
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    Rz = Matrix.Rotation(yaw, 4, 'Z')
    A = Matrix.Translation(Rz @ mount) @ Rz @ Matrix.Rotation(pitch, 4, 'X')
    B = A @ Matrix.Translation(b_min.lerp(b_max, t_ext))
    cab_pos = B @ cab_piv
    CAB = Matrix.Translation(cab_pos) @ Matrix.Rotation(yaw + math.radians(cab_yaw_deg), 4, 'Z')
    m = B @ col_mnt
    COL = Matrix.Translation((m.x, m.y, 0.0)) @ Rz
    LIFT = COL @ Matrix.Translation((0.0, 0.0, m.z))
    for name, M in (('JB_Tunnel_A', A), ('JB_Tunnel_B', B), ('JB_Cab', CAB), ('JB_DriveColumn', COL)):
        P[name].matrix_world = R0 @ M
    bpy.context.view_layer.update()
    P['JB_DriveColumn_Lift'].matrix_world = R0 @ LIFT
    bpy.context.view_layer.update()
    dock = (objs['CAB_DOCK'].matrix_world).translation.copy()
    fwd = (R0 @ CAB).to_3x3() @ Vector((0, 1, 0))
    return dock, fwd


def fuselage(dock, fwd, name='Fuselage'):
    """Generic white narrow-body fuselage section whose door sill sits at `dock` (preview only)."""
    fwd = Vector((fwd.x, fwd.y, 0)).normalized()
    up = Vector((0, 0, 1))
    side = fwd.cross(up).normalized()
    R = 1.98
    centre = dock + fwd * (math.sqrt(R * R - 0.9 * 0.9) + 0.02) + up * 0.9
    rot = Matrix((-fwd, side, up)).transposed().to_4x4()      # local y (lathe axis) -> side
    L = 18.0
    g = Geo()
    g += lathe([(0.0, -L / 2), (R * 0.75, -L / 2 + 0.5), (R * 0.97, -L / 2 + 2.2), (R, -L / 2 + 4.0),
                (R, L / 2 - 4.0), (R * 0.97, L / 2 - 2.2), (R * 0.75, L / 2 - 0.5), (0.0, L / 2)], 40, 'skin', 'y')
    for k in range(-9, 10):
        if abs(k) < 2:
            continue
        g += box(0.02, 0.23, 0.33, (math.sqrt(R * R - 0.55 ** 2) - 0.004, k * 0.53, 0.55), 'win')
    g += box(0.03, 0.86, 1.86, (R - 0.006, 0.0, 0.03), 'door')
    g += box(0.02, 12.0, 0.12, (math.sqrt(R * R - 0.15 ** 2) - 0.006, 0.0, -0.15), 'line')
    mats = {'skin': rp.simple_mat('FUS_skin', (0.86, 0.87, 0.89), 0.32),
            'win': rp.simple_mat('FUS_win', (0.03, 0.04, 0.05), 0.15),
            'door': rp.simple_mat('FUS_door', (0.55, 0.57, 0.60), 0.4),
            'line': rp.simple_mat('FUS_line', (0.10, 0.25, 0.55), 0.4)}
    ob = rp.geo_object(name, g, mats)
    ob.matrix_world = Matrix.Translation(centre) @ rot
    return ob


def render_bridge_poses(samples, scale):
    shots = [
        ('jet_bridge_pose_short', dict(yaw_deg=0, pitch_deg=0, t_ext=0.0, cab_yaw_deg=0), 35, 16, False),
        ('jet_bridge_pose_long', dict(yaw_deg=0, pitch_deg=0, t_ext=1.0, cab_yaw_deg=0), 35, 16, False),
        ('jet_bridge_pose_pitched', dict(yaw_deg=-14, pitch_deg=-4.5, t_ext=0.55, cab_yaw_deg=14), 128, 14, True),
    ]
    for name, pose, az, el, fus in shots:
        rp.reset()
        rp.setup_render(samples=samples, scale=scale)
        rp.setup_world()
        rp.add_ground()
        root = rp.import_glb('jet_bridge', 'LOD0')
        dock, fwd = pose_bridge(root, **pose)
        objs = rp.tree(root)
        if fus:
            fuselage(dock, fwd)
            rp.human('Crew1', loc=(dock.x - 3.0, dock.y - 6.0, 0), yaw=0.6)
        rp.human('Crew0', loc=(-1.0, 3.5, 0), yaw=-0.4)
        lo, hi = rp.world_bbox([o for o in bpy.data.objects if o.type == 'MESH' and o.name != 'Ground'])
        rp.frame_camera(lo, hi, az=az, el=el, margin=0.92)
        rp.render_to(os.path.join(rp.OUT, name + '.png'))
        print('[preview]', name)
    # combined line-up of the three poses
    rp.reset()
    rp.setup_render(samples=samples, scale=scale)
    rp.setup_world()
    rp.add_ground()
    for k, (name, pose, az, el, fus) in enumerate(shots):
        root = rp.import_glb('jet_bridge', 'LOD0')
        root.location = (k * 16.0, 0, 0)
        bpy.context.view_layer.update()
        pose_bridge(root, **pose)
        rp.text_label(name.replace('jet_bridge_pose_', '').upper(), (k * 16.0 - 1.0, -6.0, 0.01), size=1.6)
    rp.human('Crew0', loc=(2.0, 3.0, 0), yaw=-0.4)
    lo, hi = rp.world_bbox([o for o in bpy.data.objects if o.type == 'MESH' and o.name != 'Ground'])
    rp.frame_camera(lo, hi, az=28, el=24, margin=0.92)
    rp.render_to(os.path.join(rp.OUT, 'jet_bridge_poses.png'))
    print('[preview] jet_bridge_poses')


# ------------------------------------------------------------- contact sheet
ROWS = [
    # (row y, label size, [asset names]) -- placed left to right along +X
    (0.0, 0.55, ['runway_edge_light', 'taxiway_edge_light', 'inset_light', 'papi_unit', 'taxi_sign',
                 'approach_light_bar', 'shrub', 'perimeter_fence', 'blast_fence', 'windsock', 'road_light']),
    (14.0, 0.80, ['baggage_tractor', 'baggage_cart', 'uld_dolly', 'gpu_cart', 'follow_me_car', 'car_sedan',
                  'car_suv', 'service_van', 'pushback_tug', 'belt_loader']),
    (32.0, 1.20, ['catering_truck', 'ambulift', 'stairs_truck', 'fuel_hydrant_dispenser', 'fuel_tanker',
                  'arff_tender', 'apron_bus', 'main_deck_loader']),
    (62.0, 1.90, ['jet_bridge', 'jet_bridge_glass', 'date_palm_a', 'date_palm_b', 'date_palm_c',
                  'apron_flood_mast', 'glide_slope_mast', 'ils_localizer']),
]
YAW = math.radians(215.0)
YAW_OVERRIDE = {'ils_localizer': math.radians(250.0), 'perimeter_fence': math.radians(180.0),
                'blast_fence': math.radians(180.0)}


def _footprint(root):
    lo, hi = rp.world_bbox(rp.tree(root))
    return lo, hi


def render_contact(samples, scale):
    rp.reset()
    rp.setup_render(res=(2560, 1440), samples=samples, scale=scale)
    rp.setup_world()
    rp.add_ground()
    row_x0 = {}
    for (ry, lsize, names) in ROWS:
        items = []
        for n in names:
            if not os.path.exists(os.path.join(rp.RAW, n + '.glb')):
                continue
            root = rp.import_glb(n, 'LOD0')
            root.rotation_euler = (0, 0, YAW_OVERRIDE.get(n, YAW))
            bpy.context.view_layer.update()
            lo, hi = _footprint(root)
            lw = len(n) * lsize * 0.56
            items.append((n, root, lo, hi, max(hi.x - lo.x, lw)))
        gap = lsize * 1.2
        total = sum(it[4] for it in items) + gap * (len(items) - 1)
        x = -total / 2
        row_x0[ry] = x
        for (n, root, lo, hi, w) in items:
            cx = x + w / 2
            root.location = (cx - (lo.x + hi.x) / 2, ry - (lo.y + hi.y) / 2, 0)
            bpy.context.view_layer.update()
            lo2, hi2 = _footprint(root)
            rp.text_label(n, (cx, lo2.y - lsize * 1.35, 0.01), size=lsize)
            x += w + gap
    # 1.80 m reference figures (ground crew in hi-vis) at the start of each row and by the bridge
    for k, (ry, lsize, names) in enumerate(ROWS[:3]):
        hx = row_x0[ry] - 1.4 - 0.6 * k
        rp.human(f'HumanRef_{k}', loc=(hx, ry, 0), yaw=0.5)
        rp.text_label('1.80 m', (hx, ry - 1.1 - 0.4 * k, 0.01), size=0.30 + 0.12 * k)
    rp.human('HumanRef_3', loc=(row_x0[62.0] + 2.0, 57.0, 0), yaw=0.5)
    bpy.context.view_layer.update()
    objs = [o for o in bpy.data.objects if o.type in ('MESH', 'FONT') and o.name != 'Ground']
    lo, hi = rp.world_bbox(objs)
    pts = rp.object_corners([o for o in objs if o.type == 'MESH'])
    pts += [o.matrix_world.translation for o in objs if o.type == 'FONT']
    rp.frame_camera(lo, hi, az=168.0, el=31.0, lens=45.0, margin=0.97, points=pts)
    rp.render_to(os.path.join(rp.OUT, 'kit_contact_sheet.png'))
    print('[preview] kit_contact_sheet')
