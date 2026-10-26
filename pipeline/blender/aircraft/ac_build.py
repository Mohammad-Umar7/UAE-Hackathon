"""Assemble an aircraft from a type spec, create LOD0/1/2 Blender objects, export GLB."""
import json
import math
import os
import re
import struct

import numpy as np
import bpy

from ac_common import MB, make_object, make_empty, normalize, dome, revolve, cylinder
from ac_fuselage import Fuselage
from ac_wing import (Planform, build_wing, fence, control_surface, spoiler_panels, panel_line,
                     flap_track_fairing, surface_decal)
from ac_engine import turbofan, pylon_under_wing, stub_pylon, turboprop_nacelle, propeller
from ac_gear import nose_gear, main_leg

RES = {
    0: dict(lod=0, fus_ring=(20, 2, 14), fus_n_nose=26, fus_ds=1 / 70, fus_ds_tail=1 / 110,
            af_n=20, span_n=24, cap_n=3, wl_bend=6, wl_str=5,
            nac_seg=48, nac_lip=6, nac_cowl=10, nac_core=4, nac_plug=6, nac_spinner=6, fan_blades=True,
            blade_nr=5, pylon_n=12, pylon_seg=12, canoe_n=8, canoe_seg=10,
            wheel_seg=24, tyre_prof=10, hub_simple=False, strut_seg=10, gear_detail=2,
            windows=True, win_seg=14, cockpit_seg=36, cockpit_rings=4, panel_lines=2, decals=True,
            light_seg=10, tp_n=14, tp_seg=20, prop_spinner_seg=20, prop_spinner_n=7, prop_nr=8, prop_af=7,
            off_window=0.006, off_cockpit=0.012, off_panel=0.006, off_decal=0.009, line_w=0.022, nose_max_ds=0.2,
            door_seg=32, chevrons=True, line_step=0.06),
    1: dict(lod=1, fus_ring=(11, 1, 7), fus_n_nose=12, fus_ds=1 / 30, fus_ds_tail=1 / 46,
            af_n=10, span_n=11, cap_n=1, wl_bend=3, wl_str=2,
            nac_seg=24, nac_lip=2, nac_cowl=5, nac_core=1, nac_plug=2, nac_spinner=2, fan_blades=False,
            blade_nr=2, pylon_n=5, pylon_seg=6, canoe_n=3, canoe_seg=6,
            wheel_seg=14, tyre_prof=6, hub_simple=True, strut_seg=6, gear_detail=1,
            windows=True, win_seg=8, cockpit_seg=10, cockpit_rings=1, panel_lines=1, decals=True,
            light_seg=6, tp_n=7, tp_seg=12, prop_spinner_seg=12, prop_spinner_n=3, prop_nr=5, prop_af=4,
            off_window=0.02, off_cockpit=0.025, off_panel=0.018, off_decal=0.022, line_w=0.05, nose_max_ds=0.6,
            door_seg=12, chevrons=True, line_step=0.2),
    2: dict(lod=2, fus_ring=(5, 1, 3), fus_n_nose=5, fus_ds=1 / 7, fus_ds_tail=1 / 9,
            af_n=4, span_n=3, cap_n=1, wl_bend=1, wl_str=1,
            nac_seg=8, nac_lip=1, nac_cowl=2, nac_core=1, nac_plug=1, nac_spinner=1, fan_blades=False,
            blade_nr=2, pylon_n=2, pylon_seg=4, canoe_n=0, canoe_seg=4,
            wheel_seg=8, tyre_prof=4, hub_simple=True, strut_seg=4, gear_detail=0,
            windows=False, win_seg=4, cockpit_seg=6, cockpit_rings=1, panel_lines=0, decals=False,
            light_seg=4, tp_n=3, tp_seg=6, prop_spinner_seg=6, prop_spinner_n=2, prop_nr=3, prop_af=3,
            off_window=0.05, off_cockpit=0.04, off_panel=0.04, off_decal=0.05, line_w=0.12,
            door_seg=8, chevrons=False, line_step=0.6),
}

LIGHT_SIZE = {"nav": 0.09, "strobe": 0.07, "beacon": 0.11, "landing": 0.16, "tail": 0.07, "taxi": 0.08}


# ----------------------------------------------------------------------------- geometry

def resolve_res(spec, lod):
    res = dict(RES[lod])
    res.update(spec.get("res", {}).get(lod, {}))
    return res


def build_geometry(spec, res):
    body = MB()
    wheels = MB()
    props = {}
    decals = {}
    E = {}  # empties
    s_ng = spec["s_ng"]
    fus = Fuselage(spec["fus"], s_ng)
    fus.build(body, res)
    lod = res["lod"]

    # --- glazing, windows, doors
    for w in spec.get("cockpit", []):
        fus.patch(body, w["c"], w.get("n", 10), res["cockpit_seg"], res["cockpit_rings"], res["off_cockpit"],
                  "M_Cockpit")
    if res["windows"]:
        for row in spec.get("windows", []):
            if row.get("lod_max", 2) >= lod:
                fus.window_row(body, row, res["win_seg"], res["off_window"])
    for d in spec.get("doors", []):
        need = 2 if d.get("minor") else 1
        if res["panel_lines"] >= need or (lod == 2 and d.get("lod2")):
            sides = {"both": (1, -1), "L": (-1,), "R": (1,)}[d.get("side", "both")]
            fus.outline(body, d["s"], d["z"] + d["h"] / 2, d["w"], d["h"], d.get("n", 5.0), res["door_seg"],
                        res["line_w"], res["off_panel"], sides=sides, step=res["line_step"])
    if res["panel_lines"] >= 1:
        for ln in spec.get("lines", []):
            sides = {"both": (1, -1), "L": (-1,), "R": (1,)}[ln.get("side", "both")]
            if "sz" in ln:
                fus.polyline_sz(body, ln["sz"], res["line_w"], res["off_panel"], sides=sides,
                                closed=ln.get("closed", False), step=res["line_step"])
            else:
                fus.line_st(body, [fus.to_st(c) for c in ln["st"]], res["line_w"], res["off_panel"], sides=sides,
                            closed=ln.get("closed", False), step=res["line_step"])

    # --- wing
    W = spec["wing"]
    pf = Planform(W)
    sts = build_wing(body, pf, res, mirror=True, mat="M_Wing", le_mat=W.get("le_mat", "M_Metal"),
                     le_frac=W.get("le_frac", 0.035), tip=W.get("tip"), dev_mat=W.get("dev_mat", "M_Paint_Tail"))
    tipst = pf.section(pf.e_tip)
    tip = W.get("tip", {})
    if tip.get("kind") == "fence":
        le = tipst["le"] + np.array([0.06, 0.0, 0.0])
        c = tipst["chord"]
        fence(body, le + np.array([0, 0.25 * c, 0.0]), c * 1.25, c * 0.22, tip["up"], tip.get("sweep", 58), 1, 0.07,
              res, W.get("dev_mat", "M_Paint_Tail"))
        fence(body, le + np.array([0, 0.25 * c, 0.0]), c * 0.8, c * 0.18, tip["down"], tip.get("sweep", 58), -1,
              0.07, res, W.get("dev_mat", "M_Paint_Tail"))
    if res["canoe_n"] > 0:
        for cf in W.get("canoes", []):
            flap_track_fairing(body, pf, cf["e"], cf.get("xi0", 0.55), cf.get("ext", 0.32), cf["width"],
                               cf["depth"], res)
    if res["panel_lines"] >= 1:
        lw, lo = res["line_w"], res["off_panel"]
        for a in W.get("ailerons", []):
            control_surface(body, pf, *a, lw, lo)
        for f in W.get("flaps", []):
            control_surface(body, pf, *f, lw, lo)
        if res["panel_lines"] >= 2:
            for sp in W.get("spoilers", []):
                spoiler_panels(body, pf, *sp, lw, lo)
            for sl in W.get("slats", []):
                e0, e1, xi = sl
                panel_line(body, pf, [(e0, xi, True), (e1, xi, True)], lw, lo)

    # --- horizontal stabiliser
    H = spec["ht"]
    pf_ht = Planform(H)
    build_wing(body, pf_ht, res, mirror=True, mat=H.get("mat", "M_Wing"), le_mat=H.get("le_mat"),
               le_frac=H.get("le_frac", 0.04), tip={"kind": "cap"})
    if res["panel_lines"] >= 1 and "elevator" in H:
        control_surface(body, pf_ht, *H["elevator"], res["line_w"], res["off_panel"])

    # --- fin
    F = spec["fin"]
    pf_fin = Planform(F)
    build_wing(body, pf_fin, res, mirror=False, mat="M_Paint_Tail", le_mat=F.get("le_mat"),
               le_frac=F.get("le_frac", 0.04), tip={"kind": F.get("tip", "cap")})
    if res["panel_lines"] >= 1 and "rudder" in F:
        e0, e1, x0, x1 = F["rudder"]
        for up in (True, False):
            panel_line(body, pf_fin, [(e0, 0.995, up), (e0, x0, up), (e1, x1, up), (e1, 0.995, up)],
                       res["line_w"], res["off_panel"], mirror=False, n_sub=8)
    if "bullet" in F:
        b = F["bullet"]
        y0, y1, z, r = b["y0"], b["y1"], b["z"], b["r"]
        n = 10 if lod == 0 else 4
        L = y0 - y1
        prof = []
        for i in range(n + 1):
            q = i / n
            rr = r * (math.sin(math.pi * min(q / 0.35, 1.0) / 2) ** 0.7) * (1 - max(0, (q - 0.55) / 0.45) ** 1.8)
            prof.append((L * q, max(rr, 0.004)))
        P = revolve(prof, np.array([0.0, y0, z]), np.array([0, -1.0, 0]), max(8, res["nac_seg"] // 2))
        body.grid(P, "M_Paint_Tail", close_v=True, ref=("axis", np.array([0, y0, z]), np.array([0, 1.0, 0])))
        body.fan(np.array([0, y0 + 0.003, z]), P[0], "M_Paint_Tail", (0, 1, 0))
        body.fan(np.array([0, y1 - 0.003, z]), P[-1], "M_Paint_Tail", (0, -1, 0))

    # --- engines
    engs = []
    for eng in spec["engines"]:
        sides = (1, -1) if eng.get("mirror", True) else (1,)
        for sd in sides:
            e = dict(eng)
            cx, cy, cz = eng["center"]
            e["center"] = (sd * cx, cy, cz)
            if eng["kind"] == "turbofan":
                if not res["chevrons"]:
                    e["chevrons"] = 0
                nac = turbofan(body, e, res)
                py = eng.get("pylon")
                if py and py.get("kind", "wing") == "wing":
                    pylon_under_wing(body, nac, pf, sd * cx, res, py["width"], py.get("front", 0.30))
                elif py and py["kind"] == "stub":
                    pass
                engs.append((sd * cx, np.array(e["center"], float)))
            elif eng["kind"] == "turboprop":
                hx, hy, hz = eng["hub"]
                e["hub"] = (sd * hx, hy, hz)
                turboprop_nacelle(body, e, res, pf)
                name = "PROP_R" if sd > 0 else "PROP_L"
                pm = MB()
                propeller(pm, eng["prop_r"], eng.get("blades", 6), res, eng.get("spinner_r", 0.32),
                          eng.get("spinner_l", 0.75))
                hub = np.array(e["hub"], float)
                props[name] = (pm, hub)
                engs.append((sd * hx, hub))
    for eng in spec["engines"]:
        py = eng.get("pylon")
        if py and py.get("kind") == "stub":
            stub_pylon(body, py["x0"], py["x1"], py["y_le"], py["chord"], py["z"], py.get("tc", 0.12), res)
    engs.sort(key=lambda t: t[0])
    for i, (_, c) in enumerate(engs):
        E["ENGINE_%d" % (i + 1)] = c

    # --- gear
    G = spec["gear"]
    ng = nose_gear(body, wheels, G["nose"], res, fus)
    E["LIGHT_TAXI"] = ng["taxi"] + np.array([0, 0.03, 0])
    E["TUG_HITCH"] = ng["hitch"]
    for lg in G["main"]:
        for sd in (1, -1):
            main_leg(body, wheels, lg, res, sd)

    # --- empties: doors
    for name, (s, z) in spec.get("door_empties", {}).items():
        p, n = fus.skin_point(s, z, -1)
        E[name] = p
    for name, p in spec.get("extra_empties", {}).items():
        E[name] = np.array(p, float)

    # --- lights
    tip_le = tipst["le"]
    tip_c = tipst["chord"]
    for sd, nm in ((-1, "L"), (1, "R")):
        m = np.array([sd, 1, 1])
        nav = (tip_le + np.array([0.04, -0.12 * tip_c, -0.02])) * m
        strobe = (tip_le + np.array([0.04, -0.62 * tip_c, 0.0])) * m
        E["LIGHT_NAV_" + nm] = nav
        E["LIGHT_STROBE_" + nm] = strobe
        dome(body, nav, (sd, 0.25, 0), LIGHT_SIZE["nav"], LIGHT_SIZE["nav"] * 0.7, res["light_seg"], "M_Lights",
             rings=2)
        dome(body, strobe, (sd, -0.3, 0), LIGHT_SIZE["strobe"], LIGHT_SIZE["strobe"] * 0.6, res["light_seg"],
             "M_Lights", rings=2)
        ll = spec.get("landing_light")
        if ll:
            e = ll["e"]
            p = pf.point(e, 0.02, upper=False) + np.array([0, -0.05, -0.04])
            E["LIGHT_LANDING_" + nm] = p * m
            dome(body, p * m, (0, 1, -0.25), LIGHT_SIZE["landing"], 0.06, res["light_seg"], "M_Lights", rings=2)
    s_b = spec.get("beacon_s", fus.L * 0.45)
    top = fus.top_point(s_b)
    E["LIGHT_BEACON_TOP"] = top + np.array([0, 0, 0.02])
    dome(body, top, (0, 0, 1), LIGHT_SIZE["beacon"], 0.10, res["light_seg"], "M_Lights", rings=2)
    bot = fus.bottom_point(spec.get("beacon_bottom_s", s_b - 2.0))
    E["LIGHT_BEACON_BOTTOM"] = bot - np.array([0, 0, 0.02])
    dome(body, bot, (0, 0, -1), LIGHT_SIZE["beacon"], 0.10, res["light_seg"], "M_Lights", rings=2)
    sL = fus.L - 0.06
    tl = fus.top_point(sL, 0.02)
    E["LIGHT_TAIL"] = tl + np.array([0, -0.05, 0.02])
    dome(body, tl, (0, -0.6, 0.8), LIGHT_SIZE["tail"], 0.05, res["light_seg"], "M_Lights", rings=2)

    # --- decals
    if res["decals"]:
        t = spec["title"]
        ns, nz = (24, 9) if lod == 0 else (8, 4)
        for sd, nm in ((-1, "TITLE_L"), (1, "TITLE_R")):
            P, N, UV = fus.decal_strip(t["s0"], t["s1"], t["z0"], t["z1"], ns, nz, res["off_decal"], sd)
            m = MB()
            m.grid(P, "M_Titles", N=N, uv=UV.reshape(-1, 2))
            decals[nm] = m
        lg = F["logo"]
        for sd, nm in ((-1, "LOGO_L"), (1, "LOGO_R")):
            P, N, UV = surface_decal(pf_fin, lg["y0"], lg["y1"], lg["z0"], lg["z1"], 6, 6, res["off_decal"], sd)
            m = MB()
            m.grid(P, "M_TailLogo", N=N, uv=UV.reshape(-1, 2))
            decals[nm] = m
    return dict(body=body, wheels=wheels, props=props, decals=decals, empties=E, fus=fus, pf=pf,
                pf_ht=pf_ht, pf_fin=pf_fin)


# ----------------------------------------------------------------------------- Blender objects

def _suffix(name, lod):
    return name if lod == 0 else "%s__LOD%d" % (name, lod)


def create_objects(spec, geo, lod, parent, coll, mats):
    stats = {}
    body = geo["body"]
    for mat in sorted(body.b.keys()):
        V, N, F, A, UV = body.arrays(mat)
        name = "LOD%d_%s" % (lod, mat[2:] if mat.startswith("M_") else mat)
        make_object(name, V, N, F, [mats[mat]], parent, coll)
        stats[mat] = sum(len(f) - 2 for f in F)
    # wheels: one object, two materials, _AXLE attribute
    wb = geo["wheels"]
    Vs, Ns, Fs, As, FM = [], [], [], [], []
    base = 0
    mlist = []
    for mi, mat in enumerate(sorted(wb.b.keys())):
        V, N, F, A, UV = wb.arrays(mat)
        Vs.append(V)
        Ns.append(N)
        As.append(A)
        Fs += [tuple(i + base for i in f) for f in F]
        FM += [mi] * len(F)
        mlist.append(mats[mat])
        base += len(V)
    make_object(_suffix("Wheels", lod), np.concatenate(Vs), np.concatenate(Ns), Fs, mlist, parent, coll,
                face_mat=FM, attrs={"_AXLE": np.concatenate(As)})
    stats["Wheels"] = sum(len(f) - 2 for f in Fs)
    for name, (pm, hub) in geo["props"].items():
        Vs, Ns, Fs, FM, mlist = [], [], [], [], []
        base = 0
        for mi, mat in enumerate(sorted(pm.b.keys())):
            V, N, F, A, UV = pm.arrays(mat)
            Vs.append(V)
            Ns.append(N)
            Fs += [tuple(i + base for i in f) for f in F]
            FM += [mi] * len(F)
            mlist.append(mats[mat])
            base += len(V)
        ob = make_object(_suffix(name, lod), np.concatenate(Vs), np.concatenate(Ns), Fs, mlist, parent, coll,
                         face_mat=FM)
        ob.location = tuple(float(v) for v in hub)
        stats[name] = sum(len(f) - 2 for f in Fs)
    for name, dm in geo["decals"].items():
        mat = list(dm.b.keys())[0]
        V, N, F, A, UV = dm.arrays(mat)
        make_object(_suffix(name, lod), V, N, F, [mats[mat]], parent, coll, uv=UV)
        stats[name] = sum(len(f) - 2 for f in F)
    if lod == 0:
        for name, p in sorted(geo["empties"].items()):
            make_empty(name, p, parent, coll, size=0.4)
    return stats


def bbox_of(geo):
    pts = []
    for mb in [geo["body"], geo["wheels"]]:
        for mat in mb.b:
            pts.append(mb.arrays(mat)[0])
    for name, (pm, hub) in geo["props"].items():
        for mat in pm.b:
            pts.append(pm.arrays(mat)[0] + hub)
    P = np.concatenate(pts)
    return P.min(0), P.max(0)


# ----------------------------------------------------------------------------- export

def export_glb(root, path):
    bpy.ops.object.select_all(action="DESELECT")

    def sel(o):
        o.select_set(True)
        for c in o.children:
            sel(c)

    sel(root)
    bpy.context.view_layer.objects.active = root
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_extras=True, export_attributes=True,
                              export_materials="EXPORT", export_image_format="AUTO", export_cameras=False,
                              export_lights=False, export_animations=False, export_texcoords=True,
                              export_normals=True, export_draco_mesh_compression_enable=False)


def read_glb(path):
    data = open(path, "rb").read()
    jl = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + jl])
    rest = data[20 + jl:]
    return js, rest


def write_glb(path, js, rest):
    j = json.dumps(js, separators=(",", ":")).encode("utf8")
    j += b" " * ((4 - len(j) % 4) % 4)
    total = 12 + 8 + len(j) + len(rest)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(j), 0x4E4F534A))
        f.write(j)
        f.write(rest)


def postprocess_glb(path):
    """Strip the __LODn uniqueness suffixes from node/mesh names and make decal materials
    alpha-blended. Returns per-LOD triangle counts and the node summary."""
    js, rest = read_glb(path)
    pat = re.compile(r"__LOD\d$")
    for n in js.get("nodes", []):
        if "name" in n:
            n["name"] = pat.sub("", n["name"])
    for m in js.get("meshes", []):
        if "name" in m:
            m["name"] = pat.sub("", m["name"])
    for m in js.get("materials", []):
        if m.get("name") in ("M_Titles", "M_TailLogo"):
            m["alphaMode"] = "BLEND"
            m.pop("alphaCutoff", None)
    write_glb(path, js, rest)
    return js


def glb_stats(path):
    js, rest = read_glb(path)
    nodes = js["nodes"]
    acc = js["accessors"]

    def tris(mi):
        t = 0
        for p in js["meshes"][mi]["primitives"]:
            if "indices" in p:
                t += acc[p["indices"]]["count"] // 3
            else:
                t += acc[p["attributes"]["POSITION"]]["count"] // 3
        return t

    def walk(i):
        n = nodes[i]
        t = tris(n["mesh"]) if "mesh" in n else 0
        for c in n.get("children", []):
            t += walk(c)
        return t

    out = {}
    scene = js["scenes"][js.get("scene", 0)]
    roots = scene["nodes"]
    info = {"lods": {}, "empties": [], "materials": [m["name"] for m in js.get("materials", [])],
            "axle_attribute": False, "mesh_nodes": {}}
    for r in roots:
        info["root"] = nodes[r].get("name")
        for c in nodes[r].get("children", []):
            nm = nodes[c].get("name", "")
            if nm.startswith("LOD"):
                info["lods"][nm] = walk(c)
                info["mesh_nodes"][nm] = [nodes[k].get("name") for k in nodes[c].get("children", [])
                                          if "mesh" in nodes[k]]
                if nm == "LOD0":
                    info["empties"] = sorted(nodes[k].get("name") for k in nodes[c].get("children", [])
                                             if "mesh" not in nodes[k] and not nodes[k].get("children"))
    for m in js["meshes"]:
        if m.get("name") == "Wheels":
            for p in m["primitives"]:
                if "_AXLE" in p["attributes"]:
                    info["axle_attribute"] = True
    return info
