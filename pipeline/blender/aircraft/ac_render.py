"""Preview rendering (Cycles GPU) for generated aircraft."""
import math
import os

import numpy as np
import bpy
from mathutils import Matrix, Vector


def enum_ids(owner, prop):
    try:
        return [i.identifier for i in owner.bl_rna.properties[prop].enum_items]
    except Exception:
        return []


def setup_engine(scene, samples=64, res=(1280, 720)):
    try:
        scene.render.engine = "CYCLES"
    except TypeError as e:
        print("[render] CYCLES not accepted:", e)
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        chosen = None
        for t in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = t
                prefs.get_devices()
                ok = False
                for d in prefs.devices:
                    d.use = d.type == t
                    ok = ok or d.use
                if ok:
                    chosen = t
                    break
            except Exception:
                continue
        scene.cycles.device = "GPU" if chosen else "CPU"
        print("[render] cycles device:", chosen or "CPU")
    except Exception as e:
        print("[render] device setup failed:", e)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPTIX" if "OPTIX" in enum_ids(scene.cycles, "denoiser") else "OPENIMAGEDENOISE"
    except Exception:
        pass
    scene.cycles.max_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    vts = enum_ids(scene.view_settings, "view_transform")
    if "AgX" in vts:
        scene.view_settings.view_transform = "AgX"
        looks = enum_ids(scene.view_settings, "look")
        for lk in ("AgX - Medium High Contrast", "AgX - Base Contrast", "None"):
            if lk in looks:
                scene.view_settings.look = lk
                break
    scene.view_settings.exposure = 0.0


def setup_world(scene, sun_elev=38.0, sun_az=-140.0, strength=0.085, sun_strength=5.2):
    w = bpy.data.worlds.get("SKY") or bpy.data.worlds.new("SKY")
    if w.node_tree is None:
        w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    sky = nt.nodes.new("ShaderNodeTexSky")
    types = enum_ids(sky, "sky_type")
    for t in ("MULTIPLE_SCATTERING", "SINGLE_SCATTERING", "NISHITA", "HOSEK_WILKIE", "PREETHAM"):
        if t in types:
            sky.sky_type = t
            break
    for attr, val in (("sun_elevation", math.radians(sun_elev)), ("sun_rotation", math.radians(sun_az)),
                      ("sun_disc", False), ("altitude", 50.0), ("air_density", 1.0), ("dust_density", 1.6)):
        if hasattr(sky, attr):
            try:
                setattr(sky, attr, val)
            except Exception:
                pass
    bg.inputs["Strength"].default_value = strength
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    scene.world = w
    sun = bpy.data.objects.get("SUN")
    if sun is None:
        ld = bpy.data.lights.new("SUN", "SUN")
        sun = bpy.data.objects.new("SUN", ld)
        scene.collection.objects.link(sun)
    sun.data.energy = sun_strength
    sun.data.color = (1.0, 0.955, 0.89)
    sun.data.angle = math.radians(1.2)
    # direction: light travels from the sun towards the scene
    el, az = math.radians(sun_elev), math.radians(sun_az)
    d = Vector((math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)))
    sun.rotation_euler = d.to_track_quat("Z", "Y").to_euler()


def setup_ground(scene, size=3000.0):
    ob = bpy.data.objects.get("GROUND")
    if ob is None:
        me = bpy.data.meshes.new("GROUND")
        h = size / 2
        me.from_pydata([(-h, -h, 0), (h, -h, 0), (h, h, 0), (-h, h, 0)], [], [(0, 1, 2, 3)])
        ob = bpy.data.objects.new("GROUND", me)
        scene.collection.objects.link(ob)
        m = bpy.data.materials.new("ground_mat")
        if m.node_tree is None:
            m.use_nodes = True
        nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Roughness"].default_value = 0.88
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 0.35
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (0.26, 0.245, 0.225, 1)
        ramp.color_ramp.elements[1].color = (0.34, 0.32, 0.295, 1)
        nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
        me.materials.append(m)
    return ob


def look_at(cam, pos, target, up=(0, 0, 1)):
    pos = Vector(pos)
    f = (Vector(target) - pos).normalized()
    z = -f
    x = Vector(up).cross(z)
    if x.length < 1e-6:
        x = Vector((1, 0, 0)).cross(z)
    x.normalize()
    y = z.cross(x)
    M = Matrix((x, y, z)).transposed()
    cam.matrix_world = Matrix.Translation(pos) @ M.to_4x4()


def get_camera(scene):
    cam = bpy.data.objects.get("PREVIEW_CAM")
    if cam is None:
        cd = bpy.data.cameras.new("PREVIEW_CAM")
        cam = bpy.data.objects.new("PREVIEW_CAM", cd)
        scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.clip_start = 0.05
    cam.data.clip_end = 5000
    return cam


def fit_perspective(points, target, direction, lens, aspect, margin=0.92, sensor=36.0):
    d = np.asarray(direction, float)
    d = d / np.linalg.norm(d)
    z = d  # from target to camera
    up = np.array([0, 0, 1.0])
    x = np.cross(up, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    tan_h = (sensor / 2) / lens
    tan_v = tan_h / aspect
    r = points - np.asarray(target, float)
    rx, ry, rz = r @ x, r @ y, r @ z
    D = max(np.max(rz + np.abs(rx) / (tan_h * margin)), np.max(rz + np.abs(ry) / (tan_v * margin)))
    return np.asarray(target, float) + d * D


def render_view(scene, path, cam_pos, target, lens=None, ortho=None, up=(0, 0, 1)):
    cam = get_camera(scene)
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens or 50
        cam.data.sensor_width = 36.0
        cam.data.sensor_fit = "HORIZONTAL"
    look_at(cam, cam_pos, target, up)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render] wrote", path)


def preview_set(scene, key, pts, anchors, out_dir, views=None, samples=64):
    """pts: (n,3) LOD0 vertex sample; anchors: dict with 'engine', 'gear', 'cockpit' points."""
    setup_engine(scene, samples)
    setup_world(scene)
    setup_ground(scene)
    os.makedirs(out_dir, exist_ok=True)
    lo, hi = pts.min(0), pts.max(0)
    c = 0.5 * (lo + hi)
    ext = hi - lo
    aspect = scene.render.resolution_x / scene.render.resolution_y
    views = views or ["three_quarter", "side", "top", "front", "closeup_engine_gear", "closeup_cockpit"]
    out = []
    for v in views:
        p = os.path.join(out_dir, "%s_%s.png" % (key, v))
        if v == "three_quarter":
            az, el = math.radians(38), math.radians(13)
            d = np.array([-math.sin(az), math.cos(az), math.tan(el)])
            tgt = c + np.array([0, 0, -0.18 * ext[2]])
            pos = fit_perspective(pts, tgt, d, 55, aspect, 0.94)
            render_view(scene, p, pos, tgt, lens=55)
        elif v == "side":
            o = max(ext[1] * 1.06, ext[2] * aspect * 1.12)
            render_view(scene, p, (lo[0] - 200, c[1], c[2]), (c[0], c[1], c[2]), ortho=o)
        elif v == "top":
            # nose to the left (as in the side view), starboard wing at the top of the frame
            o = max(ext[1] * 1.05, ext[0] * 1.05 * aspect)
            render_view(scene, p, (c[0], c[1], hi[2] + 300), (c[0], c[1], 0), ortho=o, up=(1, 0, 0))
        elif v == "front":
            o = max(ext[0] * 1.06, ext[2] * aspect * 1.12)
            render_view(scene, p, (c[0], hi[1] + 300, c[2]), (c[0], c[1], c[2]), ortho=o)
        elif v == "closeup_engine_gear":
            tgt = np.asarray(anchors["engine_gear_target"], float)
            pos = np.asarray(anchors["engine_gear_cam"], float)
            render_view(scene, p, pos, tgt, lens=anchors.get("engine_gear_lens", 32))
        elif v == "closeup_cockpit":
            tgt = np.asarray(anchors["cockpit_target"], float)
            pos = np.asarray(anchors["cockpit_cam"], float)
            render_view(scene, p, pos, tgt, lens=anchors.get("cockpit_lens", 45))
        out.append(p)
    return out
