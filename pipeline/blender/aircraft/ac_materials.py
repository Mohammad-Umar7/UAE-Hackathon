"""Runtime-contract materials (CONVENTIONS §3.1) and default decal textures.

All materials are plain Principled BSDF with constant values, except the two decal
materials which use an image texture (base colour + alpha). Colours are linear RGB.
Default look: white top, light-grey belly, deep-teal tail, sand-gold cheatline.
"""
import math
import os
import bpy

MATS = {
    "M_Paint_Top": dict(color=(0.86, 0.87, 0.88), rough=0.26),
    "M_Paint_Belly": dict(color=(0.34, 0.355, 0.37), rough=0.30),
    "M_Paint_Cheatline": dict(color=(0.62, 0.42, 0.15), rough=0.28, metal=0.35),
    "M_Paint_Tail": dict(color=(0.004, 0.105, 0.118), rough=0.28),
    "M_Paint_Engine": dict(color=(0.80, 0.81, 0.82), rough=0.28),
    "M_Wing": dict(color=(0.40, 0.42, 0.44), rough=0.42),
    "M_Metal": dict(color=(0.70, 0.71, 0.72), rough=0.28, metal=1.0),
    "M_Dark": dict(color=(0.018, 0.019, 0.021), rough=0.65),
    "M_Window": dict(color=(0.012, 0.014, 0.018), rough=0.14, metal=0.0),
    "M_Cockpit": dict(color=(0.010, 0.016, 0.022), rough=0.10, metal=0.10),
    "M_Lights": dict(color=(0.85, 0.86, 0.90), rough=0.08, metal=0.0),
    "M_PanelLine": dict(color=(0.16, 0.17, 0.18), rough=0.55),
    "M_TailLogo": dict(color=(1, 1, 1), rough=0.30, image="logo.png"),
    "M_Titles": dict(color=(1, 1, 1), rough=0.30, image="title.png"),
}

TITLE_TEXT = "SKYPACT"
TEAL = (0.004, 0.105, 0.118, 1.0)
GOLD = (0.62, 0.42, 0.15, 1.0)


def _principled(mat):
    if mat.node_tree is None:
        mat.use_nodes = True
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _set(bsdf, name, value):
    if name in bsdf.inputs:
        bsdf.inputs[name].default_value = value


def get_materials(tex_dir):
    out = {}
    for name, d in MATS.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        b = _principled(m)
        _set(b, "Base Color", (*d["color"], 1.0))
        _set(b, "Roughness", d.get("rough", 0.4))
        _set(b, "Metallic", d.get("metal", 0.0))
        m.diffuse_color = (*d["color"], 1.0)
        m.use_backface_culling = True
        if d.get("image"):
            path = os.path.join(tex_dir, d["image"])
            img = bpy.data.images.load(path, check_existing=True)
            nt = m.node_tree
            tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None) or nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            tex.interpolation = "Linear"
            tex.extension = "CLIP"
            nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
            nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
            try:
                m.surface_render_method = "BLENDED"
            except Exception:
                pass
            try:
                m.blend_method = "BLEND"
            except Exception:
                pass
        out[name] = m
    return out


# ----------------------------------------------------------------------------- decal textures

def _emit_mat(name, rgba):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgba
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def _render_flat(scene_objs, width, height, ortho, path):
    """Render emission-only objects with an orthographic top camera to an RGBA PNG."""
    sc = bpy.data.scenes.new("decal_tex")
    for ob in scene_objs:
        sc.collection.objects.link(ob)
    cam_data = bpy.data.cameras.new("decal_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho
    cam = bpy.data.objects.new("decal_cam", cam_data)
    cam.location = (0, 0, 10)
    sc.collection.objects.link(cam)
    sc.camera = cam
    try:
        sc.render.engine = "CYCLES"
    except TypeError:
        pass
    sc.cycles.samples = 16
    sc.cycles.device = "CPU"
    sc.render.film_transparent = True
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = path
    w = bpy.data.worlds.new("decal_world")
    w.color = (0, 0, 0)
    sc.world = w
    bpy.ops.render.render(write_still=True, scene=sc.name)
    for ob in scene_objs + [cam]:
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.scenes.remove(sc)


def make_decal_textures(tex_dir, force=False):
    os.makedirs(tex_dir, exist_ok=True)
    title = os.path.join(tex_dir, "title.png")
    logo = os.path.join(tex_dir, "logo.png")
    if os.path.exists(title) and os.path.exists(logo) and not force:
        return title, logo
    # --- title: wide letter-spaced wordmark in deep teal
    cu = bpy.data.curves.new("title_txt", "FONT")
    cu.body = TITLE_TEXT
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.space_character = 1.18
    cu.shear = 0.12
    cu.offset = 0.035
    cu.size = 1.0
    ob = bpy.data.objects.new("title_txt", cu)
    ob.data.materials.append(_emit_mat("tt_mat", TEAL))
    _render_flat([ob], 1024, 128, 8.2, title)
    # --- logo: sand-gold ring with a stylised three-feather wing on transparent ground
    objs = []
    gold = _emit_mat("lg_mat", GOLD)
    import bmesh
    me = bpy.data.meshes.new("logo_ring")
    bm = bmesh.new()
    n = 96
    ro, ri = 0.95, 0.80
    outer = [bm.verts.new((ro * math.cos(2 * math.pi * k / n), ro * math.sin(2 * math.pi * k / n), 0)) for k in range(n)]
    inner = [bm.verts.new((ri * math.cos(2 * math.pi * k / n), ri * math.sin(2 * math.pi * k / n), 0)) for k in range(n)]
    for k in range(n):
        bm.faces.new((outer[k], outer[(k + 1) % n], inner[(k + 1) % n], inner[k]))
    # three swept feathers (parallelograms with rounded feel), rising to the upper right
    for i, (y0, ln) in enumerate(((-0.30, 1.10), (0.02, 0.95), (0.32, 0.78))):
        t = 0.17
        sk = 0.42
        x0 = -0.62 + 0.08 * i
        pts = [(x0, y0), (x0 + ln, y0 + sk * ln), (x0 + ln - 0.10, y0 + sk * ln + t), (x0 - 0.10, y0 + t)]
        vs = [bm.verts.new((px, py, 0)) for px, py in pts]
        bm.faces.new(vs)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(gold)
    lo = bpy.data.objects.new("logo_mesh", me)
    objs.append(lo)
    _render_flat(objs, 512, 512, 2.0, logo)
    return title, logo
