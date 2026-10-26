"""Debug rendering of a layout.json (matplotlib)."""
from __future__ import annotations

import math

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.collections import LineCollection, PatchCollection  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402
from matplotlib.patches import Polygon as MplPolygon  # noqa: E402
from shapely.geometry import LineString  # noqa: E402

EDGE_COLORS = {"runway": "#000000", "taxiway": "#1f5fd6", "taxilane": "#00a6a6", "stand_link": "#d61fbf"}
SIZE_COLORS = {"A": "#9e9e9e", "B": "#8bc34a", "C": "#2e7d32", "D": "#ff9800", "E": "#e53935", "F": "#6a1b9a"}
BUILDING_COLORS = {"terminal": "#f2c14e", "concourse": "#f5a623", "hangar": "#7e8ca3", "cargo": "#a47148",
                   "tower": "#ff1744", "fire_station": "#ff6f00", "car_park": "#b0bec5", "other": "#c9b79c"}
LANDUSE_COLORS = {"grass": "#cde8b5", "sand": "#f3e6c4", "water": "#a9d3f5", "parking": "#e0e0e0",
                  "landscaping": "#b9dfa0"}


def _poly_patches(items, key="polygon", holes_key="holes"):
    out = []
    for it in items:
        ring = it.get(key) or it.get("footprint")
        if ring and len(ring) >= 3:
            out.append(MplPolygon(ring, closed=True))
    return out


def plot_layout(layout: dict, out_png, view=None, figsize=40, dpi=100, label_stands=True, title=None):
    b = layout["bounds"]
    if view is None:
        pad = 150
        view = (b["min_x"] - pad, b["min_y"] - pad, b["max_x"] + pad, b["max_y"] + pad)
    vx0, vy0, vx1, vy1 = view
    aspect = (vy1 - vy0) / max(1.0, (vx1 - vx0))
    fw = figsize if aspect <= 1 else figsize / aspect
    fh = fw * aspect + 0.8
    fig, ax = plt.subplots(figsize=(fw, fh), dpi=dpi)
    ax.set_facecolor("#fbf6ea")

    def inview(pts):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return not (max(xs) < vx0 or min(xs) > vx1 or max(ys) < vy0 or min(ys) > vy1)

    # landuse
    for kind, col in LANDUSE_COLORS.items():
        items = [l for l in layout.get("landuse", []) if l["kind"] == kind and inview(l["polygon"])]
        if items:
            ax.add_collection(PatchCollection(_poly_patches(items), facecolor=col, edgecolor="none", zorder=1))
    # context buildings
    ctx = [c for c in layout.get("context_buildings", []) if inview(c["footprint"])]
    if ctx:
        ax.add_collection(PatchCollection(_poly_patches(ctx), facecolor="#d8d2c8", edgecolor="#b5aea3",
                                          linewidth=0.2, zorder=2))
    # roads
    segs = [r["points"] for r in layout.get("roads", []) if r["kind"] != "rail" and inview(r["points"])]
    ax.add_collection(LineCollection(segs, colors="#9a9a9a", linewidths=0.6, zorder=2))
    rails = [r["points"] for r in layout.get("roads", []) if r["kind"] == "rail" and inview(r["points"])]
    ax.add_collection(LineCollection(rails, colors="#6d4c41", linewidths=0.8, linestyles="dashed", zorder=2))
    # aprons
    ap = [a for a in layout.get("aprons", []) if inview(a["polygon"])]
    ax.add_collection(PatchCollection(_poly_patches(ap), facecolor="#c4c4c4", edgecolor="#8a8a8a",
                                      linewidth=0.4, zorder=3))
    # taxiway pavement
    for t in layout.get("taxiways", []):
        if len(t["points"]) < 2 or not inview(t["points"]):
            continue
        poly = LineString(t["points"]).buffer(t["width_m"] / 2, cap_style=1)
        if poly.geom_type == "Polygon":
            ax.add_patch(MplPolygon(list(poly.exterior.coords), closed=True, facecolor="#b3b3b3",
                                    edgecolor="none", zorder=3.5))
    # runways
    for r in layout.get("runways", []):
        e0, e1 = r["ends"]
        p0 = (e0.get("end_x", e0["x"]), e0.get("end_y", e0["y"]))
        p1 = (e1.get("end_x", e1["x"]), e1.get("end_y", e1["y"]))
        poly = LineString([p0, p1]).buffer(r["width_m"] / 2, cap_style=2)
        ax.add_patch(MplPolygon(list(poly.exterior.coords), closed=True, facecolor="#555555", edgecolor="none",
                                zorder=4))
    # buildings
    for kind, col in BUILDING_COLORS.items():
        items = [bd for bd in layout.get("buildings", []) if bd["kind"] == kind and inview(bd["footprint"])]
        if items:
            ax.add_collection(PatchCollection(_poly_patches(items), facecolor=col, edgecolor="#5d4037",
                                              linewidth=0.4, zorder=5))
    for bd in layout.get("buildings", []):
        if bd["kind"] in ("terminal", "concourse", "tower", "cargo", "hangar") and bd.get("name") and inview(bd["footprint"]):
            xs = [p[0] for p in bd["footprint"]]
            ys = [p[1] for p in bd["footprint"]]
            ax.text(sum(xs) / len(xs), sum(ys) / len(ys), bd["name"][:28], fontsize=6, ha="center",
                    va="center", color="#3e2723", zorder=9)
    # graph edges
    nodes = {n["id"]: (n["x"], n["y"]) for n in layout["taxi_graph"]["nodes"]}
    for kind, col in EDGE_COLORS.items():
        segs = [e["points"] for e in layout["taxi_graph"]["edges"] if e["kind"] == kind and inview(e["points"])]
        lw = {"runway": 1.6, "taxiway": 1.0, "taxilane": 0.9, "stand_link": 0.7}[kind]
        ax.add_collection(LineCollection(segs, colors=col, linewidths=lw, zorder=6))
    der = [e["points"] for e in layout["taxi_graph"]["edges"] if e.get("source") == "derived"
           and e["kind"] != "stand_link" and inview(e["points"])]
    if der:
        ax.add_collection(LineCollection(der, colors="#ff00ff", linewidths=2.2, linestyles="dotted", zorder=6.5))
    xs = [p[0] for p in nodes.values()]
    ys = [p[1] for p in nodes.values()]
    ax.scatter(xs, ys, s=1.5, c="#222222", zorder=7, linewidths=0)
    # taxiway refs
    done = set()
    for e in layout["taxi_graph"]["edges"]:
        if e["kind"] in ("taxiway", "taxilane") and e.get("ref") and inview(e["points"]):
            L = e.get("length_m", 0)
            if L < 120:
                continue
            key = (e["ref"], round(e["points"][0][0] / 400), round(e["points"][0][1] / 400))
            if key in done:
                continue
            done.add(key)
            mid = LineString(e["points"]).interpolate(0.5, normalized=True)
            ax.text(mid.x, mid.y, e["ref"], fontsize=5, color="#0d47a1", zorder=8,
                    bbox=dict(boxstyle="round,pad=0.1", fc="white", ec="none", alpha=0.6))
    # stands
    for s in layout.get("stands", []):
        if not (vx0 <= s["x"] <= vx1 and vy0 <= s["y"] <= vy1):
            continue
        col = SIZE_COLORS.get(s["size_code"], "#000")
        mk = "o" if s["kind"] == "contact" else ("s" if s["kind"] == "remote" else ("D" if s["kind"] == "cargo" else "^"))
        ax.scatter([s["x"]], [s["y"]], s=22, c=col, marker=mk, zorder=10, edgecolors="black", linewidths=0.3)
        h = math.radians(s["heading"])
        ax.plot([s["x"], s["x"] + 14 * math.sin(h)], [s["y"], s["y"] + 14 * math.cos(h)], color=col, lw=1.0, zorder=10)
        if s.get("bridge_root"):
            ax.plot([s["bridge_root"][0]], [s["bridge_root"][1]], marker="x", color="#d50000", ms=3, zorder=10)
        if label_stands:
            ax.text(s["x"] + 3, s["y"] + 3, s["id"], fontsize=4.5, color="#000", zorder=11,
                    alpha=0.9 if s.get("source", "").startswith("osm") else 0.7,
                    style="normal" if s.get("source", "").startswith("osm") else "italic")
    # runway end labels
    for r in layout.get("runways", []):
        for e in r["ends"]:
            ax.plot([e["x"]], [e["y"]], marker="*", color="#ffeb3b", ms=12, mec="black", zorder=12)
            ax.text(e["x"], e["y"] + 40, f"{e['designator']}\n{e['heading_true']:.1f}°T", fontsize=10,
                    ha="center", color="black", weight="bold", zorder=12,
                    bbox=dict(boxstyle="round", fc="#fff59d", ec="black", lw=0.5))
            if "end_x" in e and (abs(e["end_x"] - e["x"]) > 1 or abs(e["end_y"] - e["y"]) > 1):
                ax.plot([e["end_x"]], [e["end_y"]], marker="|", color="black", ms=14, zorder=12)
        for ex in r.get("exits", []):
            n = nodes.get(ex["node"])
            if n and ex.get("rapid"):
                ax.plot([n[0]], [n[1]], marker="o", mfc="none", mec="#00c853", ms=7, mew=1.2, zorder=12)
    ax.set_xlim(vx0, vx1)
    ax.set_ylim(vy0, vy1)
    ax.set_aspect("equal")
    ax.grid(True, color="#e0d8c8", lw=0.4)
    ax.set_xlabel("x east [m]  (aeqd about ARP)")
    ax.set_ylabel("y north [m]")
    title = title or f"{layout['icao']}/{layout['iata']} {layout['name']}  —  layout.json debug"
    ax.set_title(title, fontsize=16)
    handles = [Line2D([0], [0], color=c, lw=2, label=f"edge: {k}") for k, c in EDGE_COLORS.items()]
    handles.append(Line2D([0], [0], color="#ff00ff", lw=2, ls="dotted", label="edge: derived gap bridge"))
    handles += [Line2D([0], [0], marker="o", color="w", markerfacecolor=c, markeredgecolor="k", ms=8,
                       label=f"stand code {k}") for k, c in SIZE_COLORS.items()]
    handles += [Line2D([0], [0], marker=m, color="w", markerfacecolor="#ccc", markeredgecolor="k", ms=8, label=l)
                for m, l in (("o", "contact"), ("s", "remote"), ("D", "cargo"), ("^", "ga"))]
    handles += [Patch(facecolor=c, edgecolor="#5d4037", label=f"bldg: {k}") for k, c in BUILDING_COLORS.items()]
    handles.append(Line2D([0], [0], marker="o", mfc="none", mec="#00c853", color="w", ms=8, label="rapid exit node"))
    ax.legend(handles=handles, loc="upper left", fontsize=9, framealpha=0.85, ncol=2)
    fig.subplots_adjust(left=0.03, right=0.995, bottom=0.03, top=0.97)
    fig.savefig(out_png)
    plt.close(fig)
