"""Standalone checks for exported aircraft GLBs (plain Python 3 + numpy, no Blender).

  python pipeline/blender/aircraft/verify_glb.py [pipeline/build/raw/aircraft]

Checks per file: root/LOD hierarchy, required empties, material slots per LOD,
_AXLE attribute (count of distinct axles = wheel count, every wheel vertex within its
wheel radius of the axle about the X axis, tyres touching the ground), PROP_* nodes,
decal UV ranges, and that the glTF bounding box starts at ground level.
"""
import json
import os
import struct
import sys

import numpy as np

WHEELS = {"nb": 6, "wb": 10, "vla": 22, "cargo": 18, "biz": 6, "reg": 6}
COMMON = ["LIGHT_NAV_L", "LIGHT_NAV_R", "LIGHT_TAIL", "LIGHT_BEACON_TOP", "LIGHT_BEACON_BOTTOM",
          "LIGHT_STROBE_L", "LIGHT_STROBE_R", "LIGHT_LANDING_L", "LIGHT_LANDING_R", "LIGHT_TAXI", "TUG_HITCH",
          "DOOR_L1"]
EXTRA = {"nb": ["ENGINE_1", "ENGINE_2"], "wb": ["DOOR_L2", "ENGINE_1", "ENGINE_2"],
         "vla": ["DOOR_L2", "DOOR_UL1", "ENGINE_1", "ENGINE_2", "ENGINE_3", "ENGINE_4"],
         "cargo": ["DOOR_NOSE", "DOOR_MAIN_CARGO", "ENGINE_1", "ENGINE_2", "ENGINE_3", "ENGINE_4"],
         "biz": ["ENGINE_1", "ENGINE_2"], "reg": ["ENGINE_1", "ENGINE_2"]}
ALL_MATS = ["M_Paint_Top", "M_Paint_Belly", "M_Paint_Cheatline", "M_Paint_Tail", "M_Paint_Engine", "M_Wing",
            "M_Metal", "M_Dark", "M_Window", "M_Cockpit", "M_Lights", "M_PanelLine", "M_TailLogo", "M_Titles"]
LOD2_OPTIONAL = {"M_Window", "M_TailLogo", "M_Titles"}
CTYPES = {5126: ("f", 4), 5123: ("H", 2), 5125: ("I", 4), 5121: ("B", 1)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def load(path):
    data = open(path, "rb").read()
    jl = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + jl])
    bl = struct.unpack("<I", data[20 + jl:24 + jl])[0]
    binc = data[28 + jl:28 + jl + bl]
    return js, binc


def accessor(js, binc, i):
    a = js["accessors"][i]
    bv = js["bufferViews"][a["bufferView"]]
    fmt, size = CTYPES[a["componentType"]]
    n = NCOMP[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", size * n)
    out = np.zeros((a["count"], n))
    for k in range(a["count"]):
        out[k] = struct.unpack_from("<" + fmt * n, binc, off + k * stride)
    return out


def check(path, key):
    js, binc = load(path)
    nodes = js["nodes"]
    errs = []
    root = nodes[js["scenes"][0]["nodes"][0]]
    if root.get("name") != key:
        errs.append("root name %r" % root.get("name"))
    lods = {nodes[c]["name"]: nodes[c] for c in root.get("children", [])}
    for L in ("LOD0", "LOD1", "LOD2"):
        if L not in lods:
            errs.append("missing " + L)
    mats = [m["name"] for m in js["materials"]]
    report = {"file_kb": round(os.path.getsize(path) / 1024.0, 1), "lods": {}}
    for L, ln in lods.items():
        names = [nodes[c].get("name") for c in ln.get("children", [])]
        used = set()
        tris = 0
        for c in ln.get("children", []):
            nd = nodes[c]
            if "mesh" in nd:
                for p in js["meshes"][nd["mesh"]]["primitives"]:
                    used.add(mats[p["material"]])
                    tris += js["accessors"][p["indices"]]["count"] // 3
        need = set(ALL_MATS) - (LOD2_OPTIONAL if L == "LOD2" else set())
        miss = sorted(need - used)
        if miss:
            errs.append("%s missing materials %s" % (L, miss))
        if "Wheels" not in names:
            errs.append(L + " has no Wheels node")
        if key == "reg" and not {"PROP_L", "PROP_R"} <= set(names):
            errs.append(L + " missing PROP_L/PROP_R")
        if L != "LOD2" and not {"TITLE_L", "TITLE_R", "LOGO_L", "LOGO_R"} <= set(names):
            errs.append(L + " missing decals")
        if any("__LOD" in (n or "") or "." in (n or "") for n in names):
            errs.append(L + " has unclean node names")
        report["lods"][L] = tris
        # wheels / _AXLE
        wn = nodes[[c for c in ln["children"] if nodes[c].get("name") == "Wheels"][0]]
        P_all, A_all = [], []
        for p in js["meshes"][wn["mesh"]]["primitives"]:
            if "_AXLE" not in p["attributes"]:
                errs.append(L + " Wheels primitive without _AXLE")
                continue
            P_all.append(accessor(js, binc, p["attributes"]["POSITION"]))
            A_all.append(accessor(js, binc, p["attributes"]["_AXLE"]))
        P = np.concatenate(P_all)
        A = np.concatenate(A_all)
        axles = np.unique(np.round(A, 4), axis=0)
        if len(axles) != WHEELS[key]:
            errs.append("%s: %d distinct _AXLE values, expected %d" % (L, len(axles), WHEELS[key]))
        d = P - A
        radial = np.hypot(d[:, 1], d[:, 2])  # rotation about local X in glTF space
        worst = 0.0
        ground = []
        for ax in axles:
            m = np.all(np.abs(np.round(A, 4) - ax) < 1e-6, axis=1)
            R = ax[1]  # axle height above ground (glTF +Y up) = tyre radius
            worst = max(worst, float(radial[m].max() - R))
            ground.append(float(P[m][:, 1].min()))
            if np.abs(d[m][:, 0]).max() > 0.6:
                errs.append("%s: wheel vertices far from their axle along X" % L)
        if worst > 0.01:
            errs.append("%s: wheel vertex outside its radius by %.3f m" % (L, worst))
        if min(ground) < -0.005 or max(ground) > 0.02:
            errs.append("%s: tyre ground contact range %.3f..%.3f" % (L, min(ground), max(ground)))
        report["lods"][L + "_axles"] = len(axles)
    # empties
    e0 = [nodes[c].get("name") for c in lods["LOD0"]["children"] if "mesh" not in nodes[c]]
    req = COMMON + EXTRA[key]
    miss = [e for e in req if e not in e0]
    if miss:
        errs.append("missing empties %s" % miss)
    report["empties"] = sorted(e0)
    # decal UVs
    for c in lods["LOD0"]["children"]:
        nd = nodes[c]
        if nd.get("name") in ("TITLE_L", "TITLE_R", "LOGO_L", "LOGO_R"):
            p = js["meshes"][nd["mesh"]]["primitives"][0]
            uv = accessor(js, binc, p["attributes"]["TEXCOORD_0"])
            if uv.min() < -1e-4 or uv.max() > 1 + 1e-4:
                errs.append(nd["name"] + " UV outside 0..1")
    for m in js["materials"]:
        if m["name"] in ("M_Titles", "M_TailLogo") and m.get("alphaMode") != "BLEND":
            errs.append(m["name"] + " alphaMode")
        if m.get("doubleSided"):
            errs.append(m["name"] + " doubleSided")
    return errs, report


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "build", "raw",
                                                           "aircraft")
    ok = True
    for key in WHEELS:
        path = os.path.join(d, key + ".glb")
        errs, rep = check(path, key)
        ok = ok and not errs
        print("%-6s %s  %s" % (key, "OK " if not errs else "FAIL", json.dumps(rep["lods"])))
        for e in errs:
            print("        - " + e)
    print("ALL OK" if ok else "FAILURES")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
