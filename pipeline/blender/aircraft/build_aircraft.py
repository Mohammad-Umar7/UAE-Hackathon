"""SKYPACT aircraft fleet generator.

Run headless:
  blender --background --factory-startup --python pipeline/blender/aircraft/build_aircraft.py -- [options]

Options (after the `--`):
  --types nb,wb,vla,cargo,biz,reg   types to build (default: all six)
  --views all|none|three_quarter,side,...   preview views to render (default: all)
  --samples 64                      Cycles samples per preview
  --no-export                       build + render only
  --lineup / --no-lineup            render the to-scale line-up (default: when all six are built)
  --lod-sheet                       also render a LOD0/LOD1/LOD2 comparison per type
  --out DIR / --previews DIR        override output folders
"""
import argparse
import importlib
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

for m in ("ac_common", "ac_fuselage", "ac_wing", "ac_engine", "ac_gear", "ac_spec", "ac_materials", "ac_build",
          "ac_render"):
    if m in sys.modules:
        importlib.reload(sys.modules[m])
import ac_build  # noqa: E402
import ac_materials  # noqa: E402
import ac_render  # noqa: E402
from ac_common import make_empty  # noqa: E402

TYPES = ["nb", "wb", "vla", "cargo", "biz", "reg"]
VIEWS = ["three_quarter", "side", "top", "front", "closeup_engine_gear", "closeup_cockpit"]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--types", default=",".join(TYPES))
    p.add_argument("--views", default="all")
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--no-export", action="store_true")
    p.add_argument("--lineup", dest="lineup", action="store_true", default=None)
    p.add_argument("--no-lineup", dest="lineup", action="store_false")
    p.add_argument("--lod-sheet", action="store_true")
    p.add_argument("--out", default=os.path.join(REPO, "pipeline", "build", "raw", "aircraft"))
    p.add_argument("--previews", default=os.path.join(REPO, "pipeline", "previews", "aircraft"))
    return p.parse_args(argv)


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


def subtree(ob):
    out = [ob]
    for c in ob.children:
        out += subtree(c)
    return out


def anchors_for(spec, geo):
    E = geo["empties"]
    fus = geo["fus"]
    eng = E.get("ENGINE_2") if "ENGINE_4" in E else E.get("ENGINE_1")
    lg = spec["gear"]["main"][0]
    gear = np.array([-lg["x"], lg["y"], lg["R"] + 0.4])
    tgt = 0.5 * (eng + gear)
    tgt[2] = max(1.0, 0.5 * (eng[2] + gear[2]))
    dist = np.linalg.norm((eng - gear)[:2])
    rnac = max(e.get("R", e.get("prop_r", 1.5) * 0.5) for e in spec["engines"])
    D = 1.25 * dist + 3.6 * rnac + 4.0
    d = np.array([-0.62, 0.78, 0.06])
    if spec["key"] == "biz":
        d = np.array([-0.80, 0.56, 0.10])
    d = d / np.linalg.norm(d)
    cam = tgt + d * D
    cam[2] = max(cam[2], 0.9)
    V = geo["body"].arrays("M_Cockpit")[0]
    V = V[V[:, 0] < 0]
    gc = V.mean(0)
    ctgt = np.array([0.45 * gc[0], gc[1] - 0.2, gc[2] - 0.25])
    hw = float(fus.f_hw(fus.sp["nose_len"]))
    dc = np.array([-1.0, 1.05, 0.30])
    dc = dc / np.linalg.norm(dc)
    ccam = ctgt + dc * (3.6 * hw + 2.0)
    return dict(engine_gear_target=tgt, engine_gear_cam=cam, engine_gear_lens=30, cockpit_target=ctgt,
                cockpit_cam=ccam, cockpit_lens=42)


def build_type(key, args, mats, tex_dir):
    t0 = time.time()
    mod = importlib.import_module("type_" + key)
    importlib.reload(mod)
    spec = mod.spec()
    clear_scene()
    coll = bpy.context.scene.collection
    root = make_empty(key, (0, 0, 0), None, coll, size=2.0)
    tris = {}
    geos = {}
    stats_all = {}
    for lod in (0, 1, 2):
        res = ac_build.resolve_res(spec, lod)
        geo = ac_build.build_geometry(spec, res)
        geos[lod] = geo
        lp = make_empty("LOD%d" % lod, (0, 0, 0), root, coll, size=1.0)
        st = ac_build.create_objects(spec, geo, lod, lp, coll, mats)
        stats_all[lod] = st
        tris[lod] = int(sum(st.values()))
    lo, hi = ac_build.bbox_of(geos[0])
    dims = dict(length=float(hi[1] - lo[1]), span=float(hi[0] - lo[0]), height=float(hi[2]))
    root["skypact_aircraft"] = key
    root["label"] = spec["label"]
    root["length_m"] = round(dims["length"], 2)
    root["span_m"] = round(dims["span"], 2)
    root["height_m"] = round(dims["height"], 2)
    root["origin"] = "nose-gear tyre contact point"
    print("[%s] dims L=%.2f S=%.2f H=%.2f (target %s) tris %s  (%.1fs)" % (
        key, dims["length"], dims["span"], dims["height"], spec["dims"], tris, time.time() - t0))
    result = dict(key=key, label=spec["label"], dims=dims, target=spec["dims"], tris_built=tris,
                  stats=stats_all, geo0=geos[0], spec=spec, root=root)
    if not args.no_export:
        path = os.path.join(args.out, key + ".glb")
        ac_build.export_glb(root, path)
        ac_build.postprocess_glb(path)
        info = ac_build.glb_stats(path)
        info["file_bytes"] = os.path.getsize(path)
        result["glb"] = info
        print("[%s] exported %s (%.1f KB) lods=%s axle=%s" % (key, path, info["file_bytes"] / 1024.0,
                                                               info["lods"], info["axle_attribute"]))
    return result


def render_type(result, args):
    if args.views == "none":
        return
    views = VIEWS if args.views == "all" else args.views.split(",")
    root = result["root"]
    for ob in subtree(root):
        ob.hide_render = False
    for lp in root.children:
        if lp.name in ("LOD1", "LOD2"):
            for ob in subtree(lp):
                ob.hide_render = True
    pts = []
    for ob in subtree(root):
        if ob.type == "MESH" and not ob.hide_render:
            M = np.array(ob.matrix_world)
            co = np.zeros(len(ob.data.vertices) * 3)
            ob.data.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            co = co @ M[:3, :3].T + M[:3, 3]
            pts.append(co[:: max(1, len(co) // 3000)])
    pts = np.concatenate(pts)
    anchors = anchors_for(result["spec"], result["geo0"])
    ac_render.preview_set(bpy.context.scene, result["key"], pts, anchors, args.previews, views, args.samples)
    if args.lod_sheet:
        lod_sheet(result, args)


def lod_sheet(result, args):
    """Three-quarter renders of LOD0/1/2 next to each other (same camera)."""
    root = result["root"]
    key = result["key"]
    span = result["dims"]["span"]
    lods = {lp.name: lp for lp in root.children}
    for i, name in enumerate(("LOD0", "LOD1", "LOD2")):
        lp = lods[name]
        lp.location = (i * (span + 8.0), 0, 0)
        for ob in subtree(lp):
            ob.hide_render = False
    bpy.context.view_layer.update()
    pts = []
    for ob in subtree(root):
        if ob.type == "MESH":
            M = np.array(ob.matrix_world)
            co = np.zeros(len(ob.data.vertices) * 3)
            ob.data.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
            pts.append(co[:: max(1, len(co) // 2000)])
    pts = np.concatenate(pts)
    lo, hi = pts.min(0), pts.max(0)
    c = 0.5 * (lo + hi)
    sc = bpy.context.scene
    d = np.array([-0.55, 0.80, 0.30])
    pos = ac_render.fit_perspective(pts, c, d, 60, 16 / 9, 0.95)
    ac_render.render_view(sc, os.path.join(args.previews, "%s_lods.png" % key), pos, c, lens=60)
    for lp in lods.values():
        lp.location = (0, 0, 0)
    for name in ("LOD1", "LOD2"):
        for ob in subtree(lods[name]):
            ob.hide_render = True


def _visible_points(objs, step=1500):
    pts = []
    for ob in objs:
        if ob.type == "MESH" and not ob.hide_render:
            M = np.array(ob.matrix_world)
            co = np.zeros(len(ob.data.vertices) * 3)
            ob.data.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
            pts.append(co[:: max(1, len(co) // step)])
    return np.concatenate(pts)


def _label(text, loc, size, rot_cols, coll):
    cu = bpy.data.curves.new("lbl_" + text[:8], "FONT")
    cu.body = text
    cu.size = size
    cu.align_x = "LEFT"
    ob = bpy.data.objects.new("lbl_" + text[:8], cu)
    m = bpy.data.materials.new("lbl_mat")
    if m.node_tree is None:
        m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.02, 0.09, 0.10, 1)
    b.inputs["Roughness"].default_value = 0.9
    cu.materials.append(m)
    from mathutils import Matrix
    R = Matrix([[rot_cols[0][i], rot_cols[1][i], rot_cols[2][i]] for i in range(3)])
    ob.matrix_world = Matrix.Translation(loc) @ R.to_4x4()
    coll.objects.link(ob)
    return ob


def lineup(keys, args, mats):
    """Import the exported GLBs and render them side by side to scale (orthographic)."""
    clear_scene()
    order = [k for k in ("vla", "cargo", "wb", "nb", "reg", "biz") if k in keys]
    items = []
    for k in order:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(args.out, k + ".glb"))
        new = [o for o in bpy.data.objects if o not in before]
        root = next(o for o in new if o.parent is None)
        for ob in new:
            names = [p.name.split(".")[0] for p in _ancestors(ob)] + [ob.name.split(".")[0]]
            if "LOD1" in names or "LOD2" in names:
                ob.hide_render = True
        bpy.context.view_layer.update()
        P = _visible_points(new)
        items.append(dict(key=k, root=root, objs=new, lo=P.min(0), hi=P.max(0)))
    sc = bpy.context.scene
    coll = sc.collection
    # ---- 1) three-quarter row, noses on one line, biggest on the left of the frame
    x = 0.0
    prev = None
    for it in items:
        half = 0.5 * (it["hi"][0] - it["lo"][0])
        if prev is not None:
            x -= prev + half + 5.0
        prev = half
        it["root"].location = (x, -it["hi"][1], 0.0)
    bpy.context.view_layer.update()
    allobjs = [o for it in items for o in it["objs"]]
    pts = _visible_points(allobjs)
    ac_render.setup_engine(sc, args.samples, res=(2400, 1000))
    ac_render.setup_world(sc)
    ac_render.setup_ground(sc, size=8000)
    lo, hi = pts.min(0), pts.max(0)
    c = 0.5 * (lo + hi)
    az, el = math.radians(24), math.radians(27)
    d = np.array([-math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)])
    from mathutils import Vector
    z = Vector(d)
    xax = Vector((0, 0, 1)).cross(z).normalized()
    yax = z.cross(xax)
    Pc = pts - c
    w = np.ptp(Pc @ np.array(xax))
    h = np.ptp(Pc @ np.array(yax))
    ortho = max(w * 1.03, h * 1.10 * 2400 / 1000)
    ac_render.render_view(sc, os.path.join(args.previews, "lineup.png"), c + d * 600, c, ortho=ortho)
    # ---- 2) side-profile sheet: two columns, noses aligned, same scale, labelled
    gnd = bpy.data.objects.get("GROUND")
    if gnd:
        gnd.hide_render = True
    sun = bpy.data.objects.get("SUN")
    if sun is not None:  # stacked rows must not shadow each other
        for owner, attr in ((sun.data, "use_shadow"), (getattr(sun.data, "cycles", None), "cast_shadow")):
            if owner is not None and hasattr(owner, attr):
                setattr(owner, attr, False)
    cols = [items[:3], items[3:]]
    row_h = max(it["hi"][2] for it in items) + 7.0
    col_w = max(it["hi"][1] - it["lo"][1] for it in items) + 14.0
    rot = [(0, -1, 0), (0, 0, 1), (-1, 0, 0)]  # local x -> -Y (image right), local z -> -X (to camera)
    labels = []
    for ci, col in enumerate(cols):
        for ri, it in enumerate(col):
            zoff = (len(col) - 1 - ri) * row_h
            yoff = -ci * col_w
            it["root"].location = (0.0, yoff - it["hi"][1], zoff)
            dims = (it["hi"] - it["lo"])
            txt = "%s   L %.1f m   span %.1f m   H %.1f m" % (it["key"], dims[1], dims[0], it["hi"][2])
            labels.append(_label(txt, Vector((-40.0, yoff, zoff + it["hi"][2] + 1.2)), 2.2, rot, coll))
    bpy.context.view_layer.update()
    pts = _visible_points(allobjs)
    lo, hi = pts.min(0), pts.max(0)
    c = 0.5 * (lo + hi)
    sc.render.resolution_x, sc.render.resolution_y = 2400, 1300
    ext_y = hi[1] - lo[1]
    ext_z = (hi[2] + 4.0) - lo[2]
    ortho = max(ext_y * 1.04, ext_z * 1.06 * 2400 / 1300)
    c[2] += 1.5
    ac_render.render_view(sc, os.path.join(args.previews, "lineup_side.png"), (lo[0] - 300, c[1], c[2]),
                          (c[0], c[1], c[2]), ortho=ortho)


def _ancestors(ob):
    out = []
    p = ob.parent
    while p is not None:
        out.append(p)
        p = p.parent
    return out


def write_manifest(results, args):
    path = os.path.join(args.out, "manifest.json")
    data = {}
    if os.path.exists(path):
        try:
            data = json.load(open(path))
        except Exception:
            data = {}
    data.setdefault("generator", "pipeline/blender/aircraft/build_aircraft.py")
    data.setdefault("types", {})
    data["blender"] = bpy.app.version_string
    data["conventions"] = "docs/CONVENTIONS.md §3, §3.1, §5"
    data["axle_attribute_space"] = ("_AXLE holds each wheel's axle centre in the Wheels node's local space in "
                                    "glTF/three.js axes (Y up): the exporter does not convert custom attributes, "
                                    "so they are stored pre-converted.")
    for r in results:
        g = r.get("glb", {})
        t = r["target"]
        d = r["dims"]
        data["types"][r["key"]] = dict(
            label=r["label"], file="pipeline/build/raw/aircraft/%s.glb" % r["key"],
            file_bytes=g.get("file_bytes"),
            dimensions_m=dict(length=round(d["length"], 2), span=round(d["span"], 2), height=round(d["height"], 2)),
            target_m=t,
            deviation_pct={k: round(100.0 * (d[k] - t[k]) / t[k], 2) for k in ("length", "span", "height")},
            triangles=g.get("lods", {"LOD%d" % k: v for k, v in r["tris_built"].items()}),
            lod_ratio={k: round(v / max(1, g.get("lods", {}).get("LOD0", 1)), 3) for k, v in g.get("lods", {}).items()},
            mesh_nodes=g.get("mesh_nodes"),
            empties=g.get("empties"),
            materials=g.get("materials"),
            axle_attribute=g.get("axle_attribute"),
            origin="nose-gear tyre contact point; nose +Y (Blender) / -Z (three.js)",
        )
    os.makedirs(args.out, exist_ok=True)
    json.dump(data, open(path, "w"), indent=2)
    print("[manifest] wrote", path)


def main():
    args = parse_args()
    keys = [k.strip() for k in args.types.split(",") if k.strip()]
    tex_dir = os.path.join(HERE, "textures")
    ac_materials.make_decal_textures(tex_dir)
    results = []
    for k in keys:
        mats = ac_materials.get_materials(tex_dir)
        r = build_type(k, args, mats, tex_dir)
        render_type(r, args)
        results.append(r)
    if not args.no_export:
        write_manifest(results, args)
    do_lineup = args.lineup if args.lineup is not None else (set(keys) == set(TYPES))
    if do_lineup and args.views != "none":
        lineup(keys if set(keys) == set(TYPES) else TYPES, args, None)
    print("[done]")


if __name__ == "__main__":
    main()
