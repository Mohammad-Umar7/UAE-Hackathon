"""Geo -> Blender meshes, LOD hierarchy and glTF export for the airport architecture.

Hierarchy (glTF):  <asset> (root empty at the ENU origin, extras)
                     LOD0 / LOD1 / LOD2 (empties at the origin)
                       <Node>, <Node>_LOD1, ... (one mesh per building part, one primitive per
                       material; mesh origin = part bbox centre at ground level, so vertex
                       coordinates stay small and the node translation carries the ENU offset)
"""
import math
import os

import bpy
import numpy as np

LOD_NAMES = ('LOD0', 'LOD1', 'LOD2')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def make_empty(name, parent=None, loc=(0, 0, 0), size=10.0):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = 'PLAIN_AXES'
    ob.empty_display_size = size
    link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    return ob


def _uvs(me, matlib, mat_names):
    nl = len(me.loops)
    npoly = len(me.polygons)
    if nl == 0:
        return
    vi = np.empty(nl, np.int32)
    me.loops.foreach_get('vertex_index', vi)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    pn = np.empty(npoly * 3)
    me.polygons.foreach_get('normal', pn)
    pn = pn.reshape(-1, 3)
    lt = np.empty(npoly, np.int32)
    me.polygons.foreach_get('loop_total', lt)
    mi = np.empty(npoly, np.int32)
    me.polygons.foreach_get('material_index', mi)
    scales = np.array([matlib.uv_scale(n) for n in mat_names] or [0.25])
    pol = np.repeat(np.arange(npoly), lt)
    n = pn[pol]
    p = co[vi]
    s = scales[mi[pol]]
    ax = np.abs(n)
    zdom = (ax[:, 2] >= ax[:, 0]) & (ax[:, 2] >= ax[:, 1])
    xdom = (~zdom) & (ax[:, 0] >= ax[:, 1])
    ydom = ~(zdom | xdom)
    u = np.empty(nl)
    v = np.empty(nl)
    sg = np.where(n[:, 2] >= 0, 1.0, -1.0)
    u[zdom] = p[zdom, 0] * sg[zdom]
    v[zdom] = p[zdom, 1]
    sg = np.where(n[:, 0] >= 0, 1.0, -1.0)
    u[xdom] = p[xdom, 1] * sg[xdom]
    v[xdom] = p[xdom, 2]
    sg = np.where(n[:, 1] >= 0, -1.0, 1.0)
    u[ydom] = p[ydom, 0] * sg[ydom]
    v[ydom] = p[ydom, 2]
    uv = np.stack([u * s, v * s], axis=1)
    layer = me.uv_layers.new(name='UVMap')
    layer.data.foreach_set('uv', uv.ravel())


def mesh_from_geo(name, geo, matlib, origin, smooth_deg=32.0):
    V = np.asarray(geo.v, float) - np.asarray(origin, float)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], [list(f) for f in geo.f])
    me.update()
    names = []
    idx = {}
    for m in geo.m:
        if m not in idx:
            idx[m] = len(names)
            names.append(m)
    for n in names:
        me.materials.append(matlib.get(n))
    if len(me.polygons) != len(geo.f):
        raise RuntimeError(f'{name}: polygon count changed {len(geo.f)} -> {len(me.polygons)}')
    me.polygons.foreach_set('material_index', [idx[m] for m in geo.m])
    _uvs(me, matlib, names)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth_deg))
    me.update()
    return me


def assemble(asset, lods, matlib, root_props=None, smooth_deg=32.0):
    """lods: {lod_index: [(node_name, Geo, dict(smooth=deg)?), ...]} -> root object, stats."""
    root = make_empty(asset, size=50.0)
    for k, v in (root_props or {}).items():
        root[k] = v
    stats = {}
    for lod, parts in sorted(lods.items()):
        grp = make_empty(LOD_NAMES[lod], parent=root, size=20.0)
        tri = 0
        for item in parts:
            node, geo = item[0], item[1]
            opts = item[2] if len(item) > 2 else {}
            if geo is None or geo.empty():
                continue
            lo, hi = geo.bbox()
            org = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0.0])
            oname = node if lod == 0 else f'{node}_LOD{lod}'
            me = mesh_from_geo(oname, geo, matlib, org, opts.get('smooth', smooth_deg))
            ob = bpy.data.objects.new(oname, me)
            link(ob)
            ob.parent = grp
            ob.location = tuple(org)
            tri += geo.ntris()
        stats[LOD_NAMES[lod]] = tri
    return root, stats


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=True,
        export_extras=True, export_attributes=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials='EXPORT', export_cameras=False,
        export_lights=False, export_animations=False, export_image_format='AUTO',
        use_selection=False, export_draco_mesh_compression_enable=False, export_morph=False)
