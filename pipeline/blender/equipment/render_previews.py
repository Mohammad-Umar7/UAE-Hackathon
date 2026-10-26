"""Preview renders for the equipment kit (imports the exported GLBs, so what you see is
exactly what ships).

  blender --background --factory-startup --python pipeline/blender/equipment/render_previews.py -- \
      [--only a,b] [--mode assets,contact,bridge,lods] [--samples 96] [--scale 1.0]

Outputs pipeline/previews/equipment/<name>_threequarter.png, kit_contact_sheet.png,
jet_bridge_pose_*.png, <name>_lods.png.
"""
import argparse
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from eqlib import registry  # noqa: E402
from eqlib.geo import Geo, box, cylinder, lathe, sphere, tube  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
RAW = os.path.join(REPO, 'pipeline', 'build', 'raw', 'equipment')
OUT = os.path.join(REPO, 'pipeline', 'previews', 'equipment')
TEX = os.path.join(RAW, 'textures')


# ------------------------------------------------------------------ setup
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_render(res=(1280, 720), samples=96, scale=1.0):
    sc = bpy.context.scene
    try:
        sc.render.engine = 'CYCLES'
    except TypeError as e:
        print('engine error', e)
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = dev
            prefs.get_devices()
            ok = False
            for d in prefs.devices:
                d.use = d.type == dev
                ok = ok or d.use
            if ok:
                sc.cycles.device = 'GPU'
                break
        except Exception:
            continue
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 8
    sc.render.resolution_x = int(res[0] * scale)
    sc.render.resolution_y = int(res[1] * scale)
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    vs = sc.view_settings
    vts = [i.identifier for i in vs.bl_rna.properties['view_transform'].enum_items]
    for cand in ('Khronos PBR Neutral', 'AgX', 'Filmic', 'Standard'):
        if cand in vts:
            vs.view_transform = cand
            break
    vs.exposure = -0.85


def setup_world(sun_elev=42.0, sun_rot=335.0, strength=0.13):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('Sky')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    sky = nt.nodes.new('ShaderNodeTexSky')
    types = [i.identifier for i in sky.bl_rna.properties['sky_type'].enum_items]
    for cand in ('MULTIPLE_SCATTERING', 'SINGLE_SCATTERING', 'NISHITA', 'HOSEK_WILKIE'):
        if cand in types:
            sky.sky_type = cand
            break
    try:
        sky.sun_elevation = math.radians(sun_elev)
        sky.sun_rotation = math.radians(sun_rot)
        sky.altitude = 50.0
        sky.air_density = 1.2
        sky.aerosol_density = 1.6
        sky.sun_disc = True
        sky.sun_size = math.radians(1.2)
    except Exception as e:
        print('sky props', e)
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])


def ground_material():
    m = bpy.data.materials.new('PreviewGround')
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    brick = nt.nodes.new('ShaderNodeTexBrick')
    brick.offset = 0.0
    brick.inputs['Scale'].default_value = 1.0
    brick.inputs['Mortar Size'].default_value = 0.004
    brick.inputs['Brick Width'].default_value = 5.0
    brick.inputs['Row Height'].default_value = 5.0
    brick.inputs['Color1'].default_value = (0.30, 0.30, 0.285, 1)
    brick.inputs['Color2'].default_value = (0.27, 0.27, 0.26, 1)
    brick.inputs['Mortar'].default_value = (0.12, 0.12, 0.115, 1)
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.35
    noise.inputs['Detail'].default_value = 8.0
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 0.35
    nt.links.new(tc.outputs['Object'], brick.inputs['Vector'])
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    nt.links.new(brick.outputs['Color'], mix.inputs['A'])
    nt.links.new(noise.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.88
    return m


def add_ground(size=30000.0, z=0.0):
    me = bpy.data.meshes.new('Ground')
    h = size / 2
    me.from_pydata([(-h, -h, z), (h, -h, z), (h, h, z), (-h, h, z)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new('Ground', me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(ground_material())
    return ob


def simple_mat(name, color, rough=0.6, metal=0.0, emit=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 1.0
    return m


def geo_object(name, geo, mats):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in geo.v], [], [list(f) for f in geo.f])
    names = []
    for m in geo.fm:
        if m not in names:
            names.append(m)
    for n in names:
        me.materials.append(mats[n])
    me.polygons.foreach_set('material_index', [names.index(m) for m in geo.fm])
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(40))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def human(name='HumanRef', loc=(0, 0, 0), yaw=0.0, vest=True):
    """1.80 m ground-crew reference figure (preview only)."""
    g = Geo()
    skin, cloth, hv, shoe = 'skin', 'cloth', 'vest', 'shoe'
    # legs
    for sx in (-1, 1):
        g += tube([(sx * 0.10, 0, 0.08), (sx * 0.105, 0.0, 0.50), (sx * 0.11, 0, 0.90)], 0.075, 10, cloth)
        g += box(0.12, 0.27, 0.08, (sx * 0.10, 0.05, 0.04), shoe, bevel=0.03, seg=2)
    # torso
    g += lathe([(0.0, 0.86), (0.17, 0.88), (0.19, 1.05), (0.21, 1.30), (0.20, 1.42), (0.13, 1.50),
                (0.06, 1.53), (0.0, 1.53)], 14, hv if vest else cloth, 'z')
    g.scale(1.0, 0.62, 1.0)
    # arms
    for sx in (-1, 1):
        g += tube([(sx * 0.22, 0, 1.44), (sx * 0.27, 0.02, 1.15), (sx * 0.28, 0.06, 0.88)], 0.055, 8, hv if vest else cloth)
        g += sphere(0.055, 8, 4, (sx * 0.28, 0.07, 0.84), skin)
    # neck + head + cap
    g += cylinder(0.055, 0.10, 10, (0, 0, 1.50), 'z', skin)
    g += sphere(0.105, 14, 8, (0, 0.01, 1.68), skin, sz=1.18)
    g += sphere(0.112, 14, 8, (0, 0.0, 1.71), 'cap', z0=0.05)
    g += box(0.16, 0.10, 0.015, (0, 0.11, 1.72), 'cap')
    mats = {skin: simple_mat('HR_skin', (0.45, 0.30, 0.22), 0.55),
            cloth: simple_mat('HR_cloth', (0.05, 0.07, 0.12), 0.8),
            hv: simple_mat('HR_vest', (1.0, 0.33, 0.02), 0.6),
            shoe: simple_mat('HR_shoe', (0.03, 0.03, 0.03), 0.6),
            'cap': simple_mat('HR_cap', (0.05, 0.06, 0.10), 0.7)}
    g.rot('Z', yaw)
    g.move(*loc)
    ob = geo_object(name, g, mats)
    # top of head = 1.80
    return ob


def text_label(txt, loc, size=0.6, rot_z=0.0, color=(0.02, 0.02, 0.025), align='CENTER'):
    cu = bpy.data.curves.new('lbl_' + txt, 'FONT')
    cu.body = txt
    cu.align_x = align
    cu.size = size
    cu.offset = size * 0.035
    ob = bpy.data.objects.new('lbl_' + txt, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    cu.materials.append(simple_mat('LabelMat', color, 0.7))
    return ob


# ----------------------------------------------------------------- import
def import_glb(name, lod='LOD0'):
    path = os.path.join(RAW, name + '.glb')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = next(o for o in new if o.parent is None and o.name.startswith(name))
    keep = None
    for c in list(root.children):
        base = c.name.split('.')[0]
        if base.startswith('LOD'):
            if base == lod:
                keep = c
            elif lod is not None:
                _delete_tree(c)
    return root


def _delete_tree(ob):
    for c in list(ob.children):
        _delete_tree(c)
    bpy.data.objects.remove(ob, do_unlink=True)


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    found = False
    for o in objs:
        if o.type != 'MESH':
            continue
        found = True
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    if not found:
        return Vector((0, 0, 0)), Vector((1, 1, 1))
    return lo, hi


def tree(ob):
    out = [ob]
    for c in ob.children:
        out += tree(c)
    return out


def frame_camera(lo, hi, az=35.0, el=20.0, lens=50.0, margin=0.86, aspect=16 / 9, name='Cam', target_z=None,
                 points=None):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.sensor_width = 36.0
    cam_data.sensor_fit = 'HORIZONTAL'
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    a, e = math.radians(az), math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
    fwd = -d
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd).normalized()
    tan_h = math.tan(math.atan(18.0 / lens)) * margin
    tan_v = tan_h / aspect
    corners = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    if points:
        corners = [Vector(p) for p in points]
    c = (lo + hi) / 2
    if target_z is not None:
        c.z = target_z
    for _ in range(3):
        D = 0.0
        for p in corners:
            r = p - c
            x, y, z = r.dot(right), r.dot(up), r.dot(d)
            D = max(D, z + abs(x) / tan_h, z + abs(y) / tan_v)
        # recentre on projected extents
        xs, ys = [], []
        for p in corners:
            r = p - c
            depth = D - r.dot(d)
            xs.append(r.dot(right) / depth)
            ys.append(r.dot(up) / depth)
        cx = (min(xs) + max(xs)) / 2
        cy = (min(ys) + max(ys)) / 2
        c = c + right * cx * D + up * cy * D
    cam.location = c + d * D
    cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    cam_data.clip_start = max(0.01, D * 0.01)
    cam_data.clip_end = 60000.0                 # keep the 30 km ground plane up to the horizon
    return cam


def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------ modes
def debug_backfaces(objs):
    """Replace single-sided materials by white-front / red-back shading (three.js culls back faces,
    so any red visible in a render is a hole or a flipped face at runtime)."""
    dm = bpy.data.materials.new('DBG_Backface')
    try:
        dm.use_nodes = True
    except Exception:
        pass
    nt = dm.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    dif = nt.nodes.new('ShaderNodeBsdfDiffuse')
    dif.inputs['Color'].default_value = (0.8, 0.8, 0.8, 1)
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (1, 0, 0, 1)
    em.inputs['Strength'].default_value = 3.0
    mix = nt.nodes.new('ShaderNodeMixShader')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(geo.outputs['Backfacing'], mix.inputs[0])
    nt.links.new(dif.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if m is not None and m.use_backface_culling:
                slot.material = dm


DEBUG_BACKFACE = False


def render_asset(name, samples, scale, az=35.0, el=18.0, suffix='threequarter', lod='LOD0'):
    reset()
    setup_render(samples=samples, scale=scale)
    spec = registry.by_name(name)
    if spec is not None:
        az = spec.preview.get('az', az)
        el = spec.preview.get('el', el)
    setup_world()
    add_ground()
    root = import_glb(name, lod)
    if DEBUG_BACKFACE:
        debug_backfaces(tree(root))
        suffix = 'debug_' + suffix
    lo, hi = world_bbox(tree(root))
    size = hi - lo
    if spec is not None and spec.category == 'furniture' and size.length < 1.5:
        el = 24.0
    out = os.path.join(OUT, f'{name}_{suffix}.png')
    if size.z > 3.0 and size.z > 2.2 * max(size.x, size.y):
        # tall thin asset: full view (left) + close-up of the top (right)
        sc = bpy.context.scene
        W, H = sc.render.resolution_x, sc.render.resolution_y
        sc.render.resolution_x = W // 2
        cam = frame_camera(lo, hi, az=az, el=12.0, aspect=(W / 2) / H, margin=0.9)
        tmp_a = out[:-4] + '__a.png'
        render_to(tmp_a)
        bpy.data.objects.remove(cam, do_unlink=True)
        top = hi.z - max(1.2, 0.18 * size.z)
        objs = [o for o in tree(root) if o.type == 'MESH']
        hlo = Vector((lo.x, lo.y, top))
        frame_camera(hlo, hi, az=az, el=22.0, aspect=(W / 2) / H, margin=0.85)
        tmp_b = out[:-4] + '__b.png'
        render_to(tmp_b)
        sc.render.resolution_x = W
        _hstack([tmp_a, tmp_b], out)
        os.remove(tmp_a)
        os.remove(tmp_b)
        return
    frame_camera(lo, hi, az=az, el=el)
    render_to(out)


def _hstack(paths, out):
    import numpy as np
    arrs = []
    for p in paths:
        img = bpy.data.images.load(p, check_existing=False)
        w, h = img.size
        a = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(a)
        bpy.data.images.remove(img)
        arrs.append(a.reshape(h, w, 4))
    arr = np.concatenate(arrs, axis=1)
    arr[:, arrs[0].shape[1] - 1:arrs[0].shape[1] + 1, :3] = 0.08
    h, w = arr.shape[:2]
    im = bpy.data.images.new('hstack', w, h, alpha=True)
    im.pixels.foreach_set(arr.ravel())
    im.filepath_raw = out
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def render_lods(name, samples, scale):
    reset()
    setup_render(samples=samples, scale=scale)
    setup_world()
    add_ground()
    roots = []
    w = None
    for k, lod in enumerate(('LOD0', 'LOD1', 'LOD2')):
        root = import_glb(name, lod)
        lo, hi = world_bbox(tree(root))
        w = (hi.x - lo.x) * 1.35 + 0.5
        root.location.x = (1 - k) * w
        roots.append(root)
    bpy.context.view_layer.update()
    objs = [o for r in roots for o in tree(r)]
    lo, hi = world_bbox(objs)
    frame_camera(lo, hi, az=28.0, el=16.0)
    render_to(os.path.join(OUT, f'{name}_lods.png'))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--mode', default='assets')
    ap.add_argument('--samples', type=int, default=96)
    ap.add_argument('--scale', type=float, default=1.0)
    ap.add_argument('--debug-backface', action='store_true')
    ap.add_argument('--az', type=float, default=35.0)
    ap.add_argument('--el', type=float, default=18.0)
    ap.add_argument('--outdir', default='')
    args = ap.parse_args(argv)
    global DEBUG_BACKFACE, OUT
    DEBUG_BACKFACE = args.debug_backface
    if args.outdir:
        OUT = args.outdir
    only = [s.strip() for s in args.only.split(',') if s.strip()]
    modes = {m.strip() for m in args.mode.split(',')}
    names = [s.name for s in registry.ASSETS if (not only or s.name in only)
             and os.path.exists(os.path.join(RAW, s.name + '.glb'))]
    t0 = time.time()
    if 'assets' in modes:
        for n in names:
            t = time.time()
            render_asset(n, args.samples, args.scale, az=args.az, el=args.el)
            print(f'[preview] {n} {time.time() - t:.1f}s')
    if 'lods' in modes:
        for n in names:
            spec = registry.by_name(n)
            if spec and len(spec.lods) == 3:
                render_lods(n, args.samples, args.scale)
                print(f'[preview] lods {n}')
    if 'contact' in modes:
        import kit_sheet
        kit_sheet.render_contact(args.samples, args.scale)
    if 'grid' in modes:
        render_grid()
    if 'bridge' in modes:
        import kit_sheet
        kit_sheet.render_bridge_poses(args.samples, args.scale)
    print(f'[preview] done {time.time() - t0:.1f}s')



def object_corners(objs):
    pts = []
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    return pts


def render_grid(cols=6, cell=(426, 240)):
    """Tile every <name>_threequarter.png into kit_grid.png with name labels."""
    import numpy as np
    import montage
    files = [os.path.join(OUT, s.name + '_threequarter.png') for s in registry.ASSETS]
    files = [f for f in files if os.path.exists(f)]
    cw, ch = cell
    lh = 26
    rows = (len(files) + cols - 1) // cols
    W, H = cols * cw, rows * (ch + lh)
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[..., :3] = 0.06
    canvas[..., 3] = 1
    for i, f in enumerate(files):
        r, c = i // cols, i % cols
        img = montage.resize(montage.load(f), cw, ch)
        y_top = H - (r + 1) * (ch + lh)
        canvas[y_top + lh:y_top + lh + ch, c * cw:(c + 1) * cw] = img
        name = os.path.basename(f).replace('_threequarter.png', '')
        canvas[y_top:y_top + lh, c * cw:(c + 1) * cw] = montage.label_strip(name, cw, lh)
    im = bpy.data.images.new('grid', W, H, alpha=True)
    im.pixels.foreach_set(canvas.ravel())
    im.filepath_raw = os.path.join(OUT, 'kit_grid.png')
    im.file_format = 'PNG'
    im.save()
    print('[preview] kit_grid', W, H)


if __name__ == '__main__':
    main()
