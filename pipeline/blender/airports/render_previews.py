"""Preview renders of the signature airport architecture (imports the exported GLBs, so what you see
is what ships), placed on simple flat airfield context built from layout.json (runways, taxiways,
aprons, landuse, roads, the other layout buildings as plain extrusions) with a few aircraft from
pipeline/build/raw/aircraft parked on contact stands for scale.  The context is preview-only.

  blender --background --factory-startup --python pipeline/blender/airports/render_previews.py -- \
      [--only OMAA_terminal_a] [--views day,hero,night] [--samples 64] [--scale 1.0] \
      [--overview] [--debug-backface] [--no-aircraft]

Outputs pipeline/previews/airports/<ICAO>_<name>_<view>.png (+ <ICAO>_overview_<view>.png).
"""
import argparse
import hashlib
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import ap_layout  # noqa: E402
import ap_poly as P2  # noqa: E402
import ap_registry  # noqa: E402
from ap_geo import Geo, cap, prism  # noqa: E402

REPO = ap_layout.REPO
RAW = os.path.join(REPO, 'pipeline', 'build', 'raw', 'airports')
AIRCRAFT = os.path.join(REPO, 'pipeline', 'build', 'raw', 'aircraft')
OUT = os.path.join(REPO, 'pipeline', 'previews', 'airports')


# ------------------------------------------------------------------ setup
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _AC.clear()


def setup_render(res=(1600, 900), samples=64, scale=1.0, exposure=-0.6):
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
    sc.cycles.adaptive_threshold = 0.03
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPTIX'
    except Exception:
        try:
            sc.cycles.denoiser = 'OPENIMAGEDENOISE'
        except Exception:
            pass
    sc.cycles.max_bounces = 5
    sc.render.resolution_x = int(res[0] * scale)
    sc.render.resolution_y = int(res[1] * scale)
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    vs = sc.view_settings
    vts = [i.identifier for i in vs.bl_rna.properties['view_transform'].enum_items]
    for cand in ('AgX', 'Filmic', 'Standard'):
        if cand in vts:
            vs.view_transform = cand
            break
    looks = [i.identifier for i in vs.bl_rna.properties['look'].enum_items]
    for cand in ('AgX - Medium High Contrast', 'Medium High Contrast', 'None'):
        if cand in looks:
            vs.look = cand
            break
    vs.exposure = exposure


def setup_world(mode='day', sun_az=215.0, sun_el=38.0):
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
    el = sun_el if mode == 'day' else -3.5
    try:
        sky.sun_elevation = math.radians(el)
        # sun_rotation is a compass azimuth (0 = sun in the north (+Y), 90 deg = east (+X)); calibrated
        # with a pole-shadow test render in Blender 5.1
        sky.sun_rotation = math.radians(sun_az % 360.0)
        sky.altitude = 120.0
        sky.air_density = 1.3
        sky.aerosol_density = 2.2 if mode == 'day' else 1.5
        sky.sun_disc = mode == 'day'
        sky.sun_size = math.radians(0.8)
    except Exception as e:
        print('sky props', e)
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 0.16 if mode == 'day' else 0.9
    out = nt.nodes.new('ShaderNodeOutputWorld')
    if mode == 'day':
        nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    else:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'ADD'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['B'].default_value = (0.004, 0.006, 0.014, 1)
        nt.links.new(sky.outputs['Color'], mix.inputs['A'])
        nt.links.new(mix.outputs['Result'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])


# ------------------------------------------------------------------ materials
def pmat(name, color, rough=0.8, metal=0.0, noise=0.0, scale=0.02, emit=None, strength=1.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if noise > 0:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = scale
        nz.inputs['Detail'].default_value = 6.0
        ramp = nt.nodes.new('ShaderNodeMix')
        ramp.data_type = 'RGBA'
        ramp.blend_type = 'MULTIPLY'
        ramp.inputs['Factor'].default_value = noise
        ramp.inputs['A'].default_value = (*color, 1)
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        nt.links.new(nz.outputs['Color'], ramp.inputs['B'])
        nt.links.new(ramp.outputs['Result'], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (*color, 1)
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def geo_object(name, geo, mats):
    me = bpy.data.meshes.new(name)
    me.from_pydata(geo.v, [], [list(f) for f in geo.f])
    names = []
    for m in geo.m:
        if m not in names:
            names.append(m)
    for n in names:
        me.materials.append(mats[n])
    me.polygons.foreach_set('material_index', [names.index(m) for m in geo.m])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------------ context
def ribbon(points, width, z, mat):
    p = P2.as_ring(points)
    if len(p) < 2:
        return Geo()
    t = P2.tangents(p, closed=False)
    nrm = np.stack([-t[:, 1], t[:, 0]], axis=1) * (width / 2)
    left = np.c_[p + nrm, np.full(len(p), z)]
    right = np.c_[p - nrm, np.full(len(p), z)]
    from ap_geo import loft
    return loft([right, left], mat)


def build_context(icao, focus, radius, hide_ids, aircraft=True):
    L = ap_layout.layout(icao)
    fx, fy = focus

    def near(pts, r=radius):
        a = np.asarray(pts, float).reshape(-1, 2)
        return np.any(np.hypot(a[:, 0] - fx, a[:, 1] - fy) < r)

    mats = {
        'ground': pmat('C_Ground', (0.50, 0.40, 0.27), 0.95, noise=0.35, scale=0.004),
        'grass': pmat('C_Grass', (0.24, 0.30, 0.13), 0.95, noise=0.4, scale=0.01),
        'sand': pmat('C_Sand', (0.56, 0.45, 0.31), 0.95, noise=0.3, scale=0.006),
        'park': pmat('C_Park', (0.20, 0.20, 0.21), 0.9),
        'water': pmat('C_Water', (0.05, 0.12, 0.16), 0.08),
        'apron': pmat('C_Apron', (0.52, 0.51, 0.49), 0.85, noise=0.18, scale=0.03),
        'taxi': pmat('C_Taxi', (0.16, 0.16, 0.165), 0.88),
        'line': pmat('C_Line', (0.75, 0.55, 0.05), 0.6),
        'runway': pmat('C_Runway', (0.11, 0.11, 0.115), 0.9),
        'rwline': pmat('C_RwLine', (0.85, 0.85, 0.85), 0.6),
        'road': pmat('C_Road', (0.19, 0.19, 0.2), 0.9),
        'bldg': pmat('C_Bldg', (0.68, 0.67, 0.64), 0.85),
        'bldg_roof': pmat('C_BldgRoof', (0.6, 0.6, 0.58), 0.8),
        'city': pmat('C_City', (0.70, 0.66, 0.58), 0.9),
    }
    g = Geo()
    # ground
    R = radius * 2.2
    g.add([(fx - R, fy - R, -0.05), (fx + R, fy - R, -0.05), (fx + R, fy + R, -0.05), (fx - R, fy + R, -0.05)],
          [(0, 1, 2, 3)], 'ground')
    for lu in L.get('landuse', []):
        kind = lu.get('kind')
        m = {'grass': 'grass', 'landscaping': 'grass', 'sand': 'sand', 'parking': 'park', 'water': 'water'}.get(kind)
        if not m or not near(lu['polygon']):
            continue
        try:
            g += cap(lu['polygon'], 0.02 if m != 'park' else 0.03, m, lu.get('holes') or [])
        except Exception:
            pass
    for ap in L.get('aprons', []):
        if not near(ap['polygon'], radius * 1.5):
            continue
        try:
            g += cap(ap['polygon'], 0.06, 'apron', ap.get('holes') or [])
        except Exception:
            pass
    for t in L.get('taxiways', []):
        if not near(t['points'], radius * 1.5):
            continue
        g += ribbon(t['points'], t.get('width_m', 23.0), 0.09, 'taxi')
        g += ribbon(t['points'], 0.4, 0.11, 'line')
    for r in L.get('runways', []):
        ends = r['ends']
        a = np.array([ends[0].get('end_x', ends[0]['x']), ends[0].get('end_y', ends[0]['y'])])
        b = np.array([ends[1].get('end_x', ends[1]['x']), ends[1].get('end_y', ends[1]['y'])])
        g += ribbon([a, b], r.get('width_m', 60.0), 0.12, 'runway')
        d = (b - a) / np.linalg.norm(b - a)
        Lr = np.linalg.norm(b - a)
        k = 0.0
        while k < Lr - 60:
            g += ribbon([a + d * (k + 30), a + d * (k + 60)], 0.9, 0.14, 'rwline')
            k += 60.0
    for rd in L.get('roads', []):
        if rd.get('kind') in ('footway', 'path', 'pedestrian', 'rail', 'steps', 'cycleway'):
            continue
        if not near(rd['points']):
            continue
        g += ribbon(rd['points'], max(4.0, rd.get('width_m', 7.0)), 0.04, 'road')
    hide = set(hide_ids)
    for b in L.get('buildings', []):
        if b['id'] in hide or not near(b['footprint']):
            continue
        try:
            h = max(4.0, float(b.get('height_m') or 8.0))
            g += prism(b['footprint'], 0.0, h, 'bldg', 'bldg_roof', None, b.get('holes') or [], bottom=False)
        except Exception:
            pass
    for b in L.get('context_buildings', []):
        if not near(b['footprint'], radius * 1.6):
            continue
        try:
            h = max(3.0, float(b.get('height_m') or 8.0))
            g += prism(b['footprint'], 0.0, h, 'city', 'city', None, [], bottom=False)
        except Exception:
            pass
    ob = geo_object('Context', g, mats)
    if aircraft:
        place_aircraft(icao, focus, radius * 1.3)
    return ob


_AC = {}


def _load_aircraft(key):
    if key in _AC:
        return _AC[key]
    path = os.path.join(AIRCRAFT, key + '.glb')
    if not os.path.exists(path):
        _AC[key] = None
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = next(o for o in new if o.parent is None)
    bpy.context.view_layer.update()
    inv = root.matrix_world.inverted()
    parts = []
    for o in new:
        if o.type != 'MESH':
            continue
        anc = o
        lod = None
        while anc is not None:
            if anc.name.split('.')[0] in ('LOD0', 'LOD1', 'LOD2'):
                lod = anc.name.split('.')[0]
            anc = anc.parent
        if lod == 'LOD1':
            parts.append((o.data, inv @ o.matrix_world))
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    _AC[key] = parts
    return parts


def place_aircraft(icao, focus, radius, share=0.55):
    L = ap_layout.layout(icao)
    fx, fy = focus
    for st in L.get('stands', []):
        if not st.get('contact'):
            continue
        if math.hypot(st['x'] - fx, st['y'] - fy) > radius:
            continue
        hsh = int(hashlib.md5(st['id'].encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
        if hsh > share:
            continue
        span = st.get('max_wingspan_m') or 36
        key = 'vla' if span >= 72 and hsh < 0.15 else ('wb' if span >= 52 else 'nb')
        parts = _load_aircraft(key)
        if not parts:
            continue
        M = Matrix.Translation((st['x'], st['y'], 0.0)) @ Matrix.Rotation(-math.radians(st['heading']), 4, 'Z')
        for data, rel in parts:
            o = bpy.data.objects.new('AC_' + st['id'], data)
            bpy.context.scene.collection.objects.link(o)
            o.matrix_world = M @ rel


# ------------------------------------------------------------------ assets
def import_asset(name, lod='LOD0'):
    path = os.path.join(RAW, name + '.glb')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = next(o for o in new if o.parent is None)
    for c in list(root.children):
        base = c.name.split('.')[0]
        if base.startswith('LOD') and base != lod:
            _delete_tree(c)
    return root


def _delete_tree(ob):
    for c in list(ob.children):
        _delete_tree(c)
    bpy.data.objects.remove(ob, do_unlink=True)


def tree(ob):
    out = [ob]
    for c in ob.children:
        out += tree(c)
    return out


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def night_materials(objs, glass_strength=1.6):
    seen = set()
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.name in seen:
                continue
            seen.add(m.name)
            base = m.name.split('.')[0]
            b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if b is None:
                continue
            if base == 'M_GlassLit':
                b.inputs['Emission Color'].default_value = (1.0, 0.80, 0.55, 1)
                b.inputs['Emission Strength'].default_value = glass_strength
            elif base == 'M_Lights':
                b.inputs['Emission Strength'].default_value = 40.0


def debug_backfaces(objs):
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
    # only camera rays see the red: otherwise hidden back faces would tint neighbours by bounce light
    lp = nt.nodes.new('ShaderNodeLightPath')
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(geo.outputs['Backfacing'], mul.inputs[0])
    nt.links.new(lp.outputs['Is Camera Ray'], mul.inputs[1])
    nt.links.new(mul.outputs[0], mix.inputs[0])
    nt.links.new(dif.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            slot.material = dm


# ------------------------------------------------------------------ cameras
def place_camera(target, dist, az, el, lens=50.0, name='Cam'):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.sensor_width = 36.0
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    a, e = math.radians(az), math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
    t = Vector(target)
    cam.location = t + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    cam_data.clip_start = max(0.5, dist * 0.002)
    cam_data.clip_end = 80000.0
    return cam


def fit_distance(lo, hi, az, el, lens=50.0, aspect=16 / 9, margin=0.82, target=None):
    a, e = math.radians(az), math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
    fwd = -d
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd).normalized()
    tan_h = 18.0 / lens * margin
    tan_v = tan_h / aspect
    c = (lo + hi) / 2 if target is None else Vector(target)
    corners = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    D = 0.0
    for p in corners:
        r = p - c
        x, y, z = r.dot(right), r.dot(up), r.dot(d)
        D = max(D, z + abs(x) / tan_h, z + abs(y) / tan_v)
    return c, D


def render_to(path, jpg=True):
    """Render to PNG (gitignored) plus a JPEG copy (what the repo tracks) unless it is a debug view."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if jpg and '_debug_' not in os.path.basename(path):
        s = sc.render.image_settings
        s.file_format = 'JPEG'
        s.quality = 86
        bpy.data.images['Render Result'].save_render(filepath=path[:-4] + '.jpg', scene=sc)
        s.file_format = 'PNG'


# ------------------------------------------------------------------ main
def render_asset(spec, views, samples, scale, debug=False, aircraft=True):
    pv = spec.get('preview', {})
    name = spec['name']
    icao = spec['icao']
    hide = set(spec['replaces'])
    # other assets of the same airport are shown too (so neighbours look right), unless missing
    others = [a for a in ap_registry.assets() if a['icao'] == icao and a['name'] != name
              and os.path.exists(os.path.join(RAW, a['name'] + '.glb'))]
    for a in others:
        hide |= set(a['replaces'])
    for view in views:
        t0 = time.time()
        reset()
        setup_render(samples=samples, scale=scale, exposure=EXPOSURE_DAY if view != 'night' else EXPOSURE_NIGHT)
        mode = 'night' if view == 'night' else 'day'
        root = import_asset(name)
        objs = tree(root)
        for a in others:
            objs_o = tree(import_asset(a['name']))
            if view == 'night':
                night_materials(objs_o)
        lo, hi = world_bbox(objs)
        size = hi - lo
        if view == 'night' and 'night' in pv:
            nv = pv['night']
            az, el = nv['az'], nv['el']
            target, D = Vector(nv['target']), nv['dist']
        elif view in ('day', 'night'):
            az = pv.get('az', 215.0)
            el = pv.get('el', 26.0)
            if 'target' in pv:
                target, D = Vector(pv['target']), pv['dist']
            else:
                target, D = fit_distance(lo, hi, az, el, margin=pv.get('margin', 0.80))
                D = max(D, pv.get('min_dist', 0.0))
        else:
            h = pv.get('hero', {})
            az = h.get('az', pv.get('az', 215.0) + 25)
            el = h.get('el', 14.0)
            target = Vector(h.get('target', ((lo + hi) / 2)[:]))
            D = h.get('dist', max(size.x, size.y) * 0.45)
        sun_az = pv.get('sun_az', az - 75.0) if view != 'hero' else pv.get('hero', {}).get('sun_az', az - 75.0)
        setup_world(mode, sun_az, pv.get('sun_el', 36.0))
        focus = (float(target[0]), float(target[1]))
        radius = max(1500.0, D * 1.3)
        build_context(icao, focus, radius, hide, aircraft=aircraft and view != 'night_noac')
        if view == 'night':
            night_materials(objs)
        if debug:
            debug_backfaces(objs)
        place_camera(target, D, az, el, lens=pv.get('lens', 50.0))
        suffix = ('debug_' if debug else '') + view
        out = os.path.join(OUT, f'{name}_{suffix}.png')
        render_to(out)
        print(f'[preview] {name} {view} {time.time() - t0:.1f}s -> {os.path.relpath(out, REPO)}')


EXPOSURE_DAY = -1.25
EXPOSURE_NIGHT = 0.0

OVERVIEW = {
    'OMAA': dict(target=(-380.0, 1480.0, 0.0), dist=3300.0, az=205.0, el=30.0),
    'OMDB': dict(target=(-650.0, -150.0, 0.0), dist=4300.0, az=205.0, el=34.0),
    'OMSJ': dict(target=(560.0, -880.0, 0.0), dist=1500.0, az=200.0, el=28.0),
}


def render_overview(icao, views, samples, scale, aircraft=True):
    specs = [a for a in ap_registry.assets() if a['icao'] == icao and os.path.exists(os.path.join(RAW, a['name'] + '.glb'))]
    if not specs:
        return
    ov = OVERVIEW[icao]
    for view in views:
        if view == 'hero':
            continue
        t0 = time.time()
        reset()
        setup_render(samples=samples, scale=scale, exposure=EXPOSURE_DAY if view != 'night' else EXPOSURE_NIGHT)
        setup_world('night' if view == 'night' else 'day', ov['az'] - 75.0, 36.0)
        hide = set()
        for s in specs:
            objs = tree(import_asset(s['name']))
            hide |= set(s['replaces'])
            if view == 'night':
                night_materials(objs)
        build_context(icao, ov['target'][:2], ov['dist'] * 1.1, hide, aircraft=aircraft)
        place_camera(ov['target'], ov['dist'], ov['az'], ov['el'])
        out = os.path.join(OUT, f'{icao}_overview_{view}.png')
        render_to(out)
        print(f'[preview] {icao} overview {view} {time.time() - t0:.1f}s')


def run(names=None, views=('day', 'hero', 'night'), samples=64, scale=1.0, debug=False, aircraft=True,
        overview=False):
    specs = [a for a in ap_registry.assets() if (not names or a['name'] in names)
             and os.path.exists(os.path.join(RAW, a['name'] + '.glb'))]
    for spec in specs:
        render_asset(spec, views, samples, scale, debug, aircraft)
    if overview:
        for icao in sorted({s['icao'] for s in specs}):
            render_overview(icao, views, samples, scale, aircraft)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--icao', default='')
    ap.add_argument('--views', default='day,hero,night')
    ap.add_argument('--samples', type=int, default=64)
    ap.add_argument('--scale', type=float, default=1.0)
    ap.add_argument('--debug-backface', action='store_true')
    ap.add_argument('--no-aircraft', action='store_true')
    ap.add_argument('--overview', action='store_true')
    ap.add_argument('--overview-only', action='store_true')
    args = ap.parse_args(argv)
    names = [s.strip() for s in args.only.split(',') if s.strip()]
    icaos = {s.strip().upper() for s in args.icao.split(',') if s.strip()}
    if icaos:
        names = [a['name'] for a in ap_registry.assets() if a['icao'] in icaos and (not names or a['name'] in names)]
    views = [v.strip() for v in args.views.split(',') if v.strip()]
    if args.overview_only:
        for icao in sorted(icaos or {'OMAA', 'OMDB', 'OMSJ'}):
            render_overview(icao, views, args.samples, args.scale, not args.no_aircraft)
        return
    run(names, views, args.samples, args.scale, args.debug_backface, not args.no_aircraft, args.overview)


if __name__ == '__main__':
    main()
