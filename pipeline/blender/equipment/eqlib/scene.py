"""Scene assembly: Geo -> Blender objects, LOD hierarchy, morph targets, glTF export."""
import math
import os

import bpy
from mathutils import Vector

LOD_NAMES = ('LOD0', 'LOD1', 'LOD2')


class Rig:
    """One LOD of an asset: mesh nodes and empties, all modelled in the asset frame."""

    def __init__(self):
        self.nodes = []
        self.empties = []

    def node(self, name, geo, origin=(0, 0, 0), parent=None, axle=False, weighted=True,
             smooth=46.0, morph=False, props=None):
        self.nodes.append(dict(name=name, geo=geo, origin=Vector(origin), parent=parent,
                               axle=axle, weighted=weighted, smooth=smooth, morph=morph,
                               props=props or {}))
        return geo

    def empty(self, name, pos, parent=None):
        self.empties.append(dict(name=name, pos=Vector(pos), parent=parent))

    def get(self, name):
        for n in self.nodes:
            if n['name'] == name:
                return n
        return None

    def ntris(self):
        return sum(n['geo'].ntris() for n in self.nodes)


# ------------------------------------------------------------------ scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def make_empty(name, parent=None, loc=(0, 0, 0), size=0.25, kind='PLAIN_AXES'):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = kind
    ob.empty_display_size = size
    link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = Vector(loc)
    return ob


def _box_uv(pts, n, s):
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    out = []
    if az >= ax and az >= ay:
        sg = 1.0 if n.z >= 0 else -1.0
        for p in pts:
            out.append((p.x * s * sg, p.y * s))
    elif ax >= ay:
        sg = 1.0 if n.x >= 0 else -1.0
        for p in pts:
            out.append((p.y * s * sg, p.z * s))
    else:
        sg = -1.0 if n.y >= 0 else 1.0
        for p in pts:
            out.append((p.x * s * sg, p.z * s))
    return out


def _newell(pts):
    n = Vector((0, 0, 0))
    k = len(pts)
    for i in range(k):
        a, b = pts[i], pts[(i + 1) % k]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))


def mesh_from_geo(name, geo, matlib, origin=Vector((0, 0, 0)), axle=False, smooth=46.0):
    me = bpy.data.meshes.new(name)
    verts = [tuple(v - origin) for v in geo.v]
    me.from_pydata(verts, [], [list(f) for f in geo.f])
    me.update()
    if len(me.polygons) != len(geo.f):
        raise RuntimeError(f"{name}: polygon count changed ({len(geo.f)} -> {len(me.polygons)})")
    # materials
    names, idx = [], {}
    for m in geo.fm:
        if m not in idx:
            idx[m] = len(names)
            names.append(m)
    for n in names:
        me.materials.append(matlib.get(n))
    me.polygons.foreach_set('material_index', [idx[m] for m in geo.fm])
    # uvs
    uvl = me.uv_layers.new(name='UVMap')
    flat = []
    for fi, f in enumerate(geo.f):
        spec = geo.fuv[fi]
        if spec is None or spec[0] == 'box':
            s = 1.0 if spec is None else spec[1]
            pts = [geo.v[i] for i in f]
            flat.extend(c for uv in _box_uv(pts, _newell(pts), s) for c in uv)
        elif spec[0] == 'pt':
            flat.extend([spec[1], spec[2]] * len(f))
        elif spec[0] == 'uv':
            L = spec[1]
            if len(L) != len(f):
                raise RuntimeError(f"{name}: uv count mismatch on face {fi}")
            flat.extend(c for uv in L for c in uv)
        else:
            raise RuntimeError(spec)
    uvl.data.foreach_set('uv', flat)
    # shading
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth))
    if axle and geo.ax is not None:
        at = me.attributes.new('_AXLE', 'FLOAT_VECTOR', 'POINT')
        vals = []
        for a in geo.ax:
            if a is None:
                vals.extend((0.0, 0.0, 0.0))
            else:
                p = a - origin
                # custom attributes are NOT converted by the glTF exporter: store the axle
                # centre directly in glTF (+Y up) local coordinates: (x, z, -y)
                vals.extend((p.x, p.z, -p.y))
        at.data.foreach_set('vector', vals)
    me.update()
    return me


def bake_weighted_normals(ob):
    mod = ob.modifiers.new('WN', 'WEIGHTED_NORMAL')
    mod.mode = 'FACE_AREA'
    mod.weight = 50
    mod.keep_sharp = True
    mod.thresh = 0.01
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    new = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    name = old.name
    ob.modifiers.remove(mod)
    ob.data = new
    bpy.data.meshes.remove(old)
    new.name = name


def assemble(name, build_fn, matlib, lods=(0, 1, 2), morphs=(), root_props=None):
    """Build the asset hierarchy: root -> LODn -> nodes (+ empties under LOD0)."""
    root = make_empty(name, kind='ARROWS', size=1.0)
    for k, v in (root_props or {}).items():
        root[k] = v
    stats = {}
    nodes_info = {}
    for lod in lods:
        rig = build_fn(lod, {})
        suffix = '' if lod == 0 else f'_LOD{lod}'
        morph_rigs = {m: build_fn(lod, {m: 1.0}) for m in morphs}
        lod_name = LOD_NAMES[lod]
        objs = {}
        origins = {}
        group = None
        # LOD group: a mesh node may itself be named like the group (furniture)
        selfnode = rig.get(lod_name)
        pending = list(rig.nodes)
        if selfnode is None:
            group = make_empty(lod_name, parent=root, size=0.5)
            objs[None] = group
            origins[None] = Vector((0, 0, 0))
        tri = 0
        guard = 0
        while pending:
            guard += 1
            if guard > 1000:
                raise RuntimeError('parent cycle')
            nd = pending.pop(0)
            is_group = (nd['name'] == lod_name)
            pkey = nd['parent']
            if not is_group and pkey not in objs:
                pending.append(nd)
                continue
            oname = nd['name'] if is_group else nd['name'] + suffix
            me = mesh_from_geo(oname, nd['geo'], matlib, nd['origin'], nd['axle'], nd['smooth'])
            ob = bpy.data.objects.new(oname, me)
            link(ob)
            if is_group:
                ob.parent = root
                ob.location = nd['origin']
                objs[None] = ob
                origins[None] = nd['origin']
            else:
                ob.parent = objs[pkey]
                ob.location = nd['origin'] - origins[pkey]
            if nd['weighted']:
                bake_weighted_normals(ob)
            for k, v in nd['props'].items():
                ob[k] = v
            if nd['morph'] and morphs:
                ob.shape_key_add(name='Basis', from_mix=False)
                for m in morphs:
                    mn = morph_rigs[m].get(nd['name'])
                    if mn is None or len(mn['geo'].v) != len(nd['geo'].v):
                        raise RuntimeError(f"{name}/{nd['name']}: morph '{m}' topology mismatch")
                    sk = ob.shape_key_add(name=m, from_mix=False)
                    sk.value = 0.0
                    co = []
                    for v in mn['geo'].v:
                        p = v - nd['origin']
                        co.extend((p.x, p.y, p.z))
                    sk.data.foreach_set('co', co)
                ob.data.shape_keys.use_relative = True
            objs[nd['name']] = ob
            origins[nd['name']] = nd['origin']
            tri += nd['geo'].ntris()
        if lod == 0:
            for e in rig.empties:
                pkey = e['parent']
                par = objs[pkey] if pkey in objs else objs[None]
                porg = origins[pkey] if pkey in origins else origins[None]
                make_empty(e['name'], parent=par, loc=e['pos'] - porg, size=0.2)
        stats[lod_name] = tri
        nodes_info[lod_name] = [n['name'] for n in rig.nodes]
    return root, stats


def export_glb(path, tangents=False):
    """tangents=True only for assets whose materials use a normal map (glTF validator rule)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=True,
        export_extras=True, export_attributes=True, export_texcoords=True, export_normals=True,
        export_tangents=tangents, export_materials='EXPORT', export_cameras=False,
        export_lights=False, export_animations=False, export_image_format='AUTO',
        use_selection=False, export_draco_mesh_compression_enable=False, export_morph=True,
        export_morph_normal=True)
