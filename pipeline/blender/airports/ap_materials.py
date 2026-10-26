"""glTF-exportable materials for the airport architecture (Principled BSDF, constants or a baked
image).  Material names are a runtime contract:

  M_Glass     dark reflective blue-grey glazing (metallic 0.3, roughness 0.1)
  M_GlassLit  the same glazing on large glazed areas; the runtime makes it emissive at night
  M_Roof      white / silver metal roof
  M_Structure white / light-grey steel arches, ribs, mullions, soffits
  M_Concrete  warm light concrete / stone
  M_Accent    per-asset accent (see ACCENTS; SHJ: blue ceramic lattice screens, baked texture)
  M_Dark      soffits in shadow, recesses, louvres, plant-room grilles
  M_Lights    small emissive aviation obstruction lights (red), emissive in the GLB
"""
import math
import os

import bpy
import numpy as np


def srgb_hex(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def lin(c):
    if isinstance(c, str):
        c = srgb_hex(c)

    def f(x):
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return tuple(f(x) for x in c[:3])


BASE = {
    'M_Glass': dict(color='#26323C', metal=0.3, rough=0.1, uv=0.25),
    'M_GlassLit': dict(color='#26323C', metal=0.3, rough=0.1, uv=0.25),
    'M_Roof': dict(color='#D3D7DA', metal=0.55, rough=0.32, uv=0.1),
    'M_Structure': dict(color='#E4E6E8', metal=0.15, rough=0.45, uv=0.25),
    'M_Concrete': dict(color='#D9CFBE', metal=0.0, rough=0.82, uv=0.25),
    'M_Accent': dict(color='#2F6DB5', metal=0.0, rough=0.35, uv=0.25),
    'M_Dark': dict(color='#16191C', metal=0.1, rough=0.6, uv=0.25),
    'M_Lights': dict(color='#FF2A1A', metal=0.0, rough=0.3, emit_color='#FF2010', emit=4.0, uv=1.0),
}

# allowed names (contract + documented extras)
CONTRACT = ['M_Glass', 'M_GlassLit', 'M_Roof', 'M_Structure', 'M_Concrete', 'M_Accent', 'M_Dark', 'M_Lights']
EXTRAS = []


def _inp(node, *names):
    for n in names:
        s = node.inputs.get(n)
        if s is not None:
            return s
    return None


class MatLib:
    def __init__(self, overrides=None, tex_dir=None):
        self.over = overrides or {}
        self.tex_dir = tex_dir
        self.cache = {}

    def defs(self, name):
        d = dict(BASE.get(name, dict(color='#FF00FF', rough=0.5)))
        d.update(self.over.get(name, {}))
        return d

    def uv_scale(self, name):
        return self.defs(name).get('uv', 0.25)

    def get(self, name):
        if name in self.cache:
            return self.cache[name]
        d = self.defs(name)
        m = bpy.data.materials.new(name)
        try:
            m.use_nodes = True
        except Exception:
            pass
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        col = lin(d.get('color', '#CCCCCC'))
        _inp(bsdf, 'Base Color').default_value = (*col, 1.0)
        _inp(bsdf, 'Metallic').default_value = d.get('metal', 0.0)
        _inp(bsdf, 'Roughness').default_value = d.get('rough', 0.5)
        if d.get('tex'):
            path = os.path.join(self.tex_dir, d['tex'])
            img = bpy.data.images.load(path, check_existing=True)
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            tex.location = (-500, 250)
            nt.links.new(tex.outputs['Color'], _inp(bsdf, 'Base Color'))
        if d.get('emit', 0) > 0:
            _inp(bsdf, 'Emission Color', 'Emission').default_value = (*lin(d.get('emit_color', '#FFFFFF')), 1.0)
            _inp(bsdf, 'Emission Strength').default_value = d['emit']
        m.use_backface_culling = True
        m.diffuse_color = (*col, 1.0)
        m.roughness = d.get('rough', 0.5)
        m.metallic = d.get('metal', 0.0)
        self.cache[name] = m
        return m


# ------------------------------------------------------------------ textures
def lattice_texture(path, size=512, bar='#3A7CC4', bar_hi='#7FB3E6', hole='#0C1622', frame='#E9E4DA'):
    """Blue glazed-ceramic screen with an eight-point-star lattice (khatam-like), one tile per
    texture repeat (the arch screens map 1 UV unit to ~2.5 m).  Written once, deterministic."""
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    n = size
    t = (np.arange(n) + 0.5) / n
    X, Y = np.meshgrid(t, t)
    out = np.zeros((n, n, 3))
    cb, ch, chi, cf = (np.array(srgb_hex(c)) for c in (bar, hole, bar_hi, frame))

    def star_field(x, y):
        # signed "distance" to an 8-point star made of a square and a 45-degree square
        sq = np.maximum(np.abs(x), np.abs(y))
        di = (np.abs(x) + np.abs(y)) / math.sqrt(2)
        return np.minimum(sq, di)

    # 2x2 stars per tile plus the interstitial cross-shaped holes
    bars = np.zeros((n, n), bool)
    holes = np.zeros((n, n), bool)
    for ox in (0.25, 0.75):
        for oy in (0.25, 0.75):
            x = X - ox
            y = Y - oy
            s = star_field(x, y)
            holes |= s < 0.135
            bars |= np.abs(s - 0.155) < 0.022
            bars |= (np.abs(s - 0.06) < 0.012)
    # connecting diagonal and orthogonal straps
    for c in (0.0, 0.5, 1.0):
        bars |= np.abs(X - c) < 0.018
        bars |= np.abs(Y - c) < 0.018
    d1 = np.abs(((X - Y) * 2) % 1.0 - 0.5)
    d2 = np.abs(((X + Y) * 2) % 1.0 - 0.5)
    bars |= (np.abs(d1 - 0.5) < 0.02) | (np.abs(d2 - 0.5) < 0.02)
    out[:] = cb
    out[holes] = ch
    out[holes & (star_field(((X * 2) % 1.0) - 0.5, ((Y * 2) % 1.0) - 0.5) < 0.05)] = cb * 0.8
    out[bars] = chi
    # outer frame of the tile (thin) so panels read as framed screens
    edge = (X < 0.012) | (X > 0.988) | (Y < 0.012) | (Y > 0.988)
    out[edge] = cf
    # subtle glaze variation
    out *= (0.94 + 0.06 * np.sin(X * 37.0) * np.sin(Y * 23.0))[..., None]
    img = bpy.data.images.new('T_Lattice', n, n, alpha=False)
    px = np.ones((n, n, 4), np.float32)
    px[..., :3] = np.clip(out, 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return path
