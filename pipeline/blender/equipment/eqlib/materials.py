"""glTF-exportable materials (Principled BSDF with constants or image textures only).

Material names are a runtime contract (docs/CONVENTIONS.md section 3.2):
  M_Body M_Trim M_Glass M_Rubber M_Metal M_Lights M_Beacon M_Hazard M_SignFace
Extra, documented names used by this kit:
  M_SignFaceBack (back face of taxi signs, UV 0-1), M_Decal (alpha-masked decal atlas),
  M_Luggage (palette), M_Frond / M_Trunk / M_Foliage (vegetation), M_Fence (chain link).
"""
import os

import bpy

from .textures import srgb


def lin(c):
    """sRGB (0-1 or hex) -> linear."""
    if isinstance(c, str):
        c = srgb(c)

    def f(x):
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return tuple(f(x) for x in c[:3])


BASE = {
    'M_Body': dict(color='#E8E9E5', rough=0.36),
    'M_Trim': dict(color='#2C2F33', rough=0.55),
    'M_Glass': dict(color='#0B1116', rough=0.07),
    'M_Rubber': dict(color='#141414', rough=0.86),
    'M_Metal': dict(color='#B3B7BA', rough=0.30, metal=1.0),
    'M_Lights': dict(tex='T_Lights.png', rough=0.12, emit_tex=True, emit=1.0),
    'M_Beacon': dict(color='#FF9A10', rough=0.15, emit_color='#FF8000', emit=2.0),
    'M_Hazard': dict(tex='T_Hazard.png', rough=0.5),
    'M_SignFace': dict(tex='T_SignFace.png', rough=0.45),
    'M_SignFaceBack': dict(tex='T_SignFaceBack.png', rough=0.45),
    'M_Decal': dict(tex='T_Decals.png', rough=0.4, alpha='MASK'),
    'M_Luggage': dict(tex='T_Luggage.png', rough=0.55),
    'M_Frond': dict(tex='T_Frond.png', rough=0.75, alpha='MASK', double=True),
    'M_Trunk': dict(tex='T_Trunk.png', normal='T_Trunk_N.png', rough=0.92),
    'M_Foliage': dict(tex='T_Foliage.png', rough=0.8, alpha='MASK', double=True),
    'M_Fence': dict(tex='T_Fence.png', rough=0.4, metal=0.85, alpha='MASK', double=True),
}


def _inp(node, *names):
    for n in names:
        s = node.inputs.get(n)
        if s is not None:
            return s
    for s in node.inputs:
        if s.identifier in names:
            return s
    return None


class MatLib:
    def __init__(self, tex_dir, overrides=None):
        self.tex_dir = tex_dir
        self.over = overrides or {}
        self.cache = {}

    def defs(self, name):
        d = dict(BASE.get(name, dict(color='#FF00FF', rough=0.5)))
        d.update(self.over.get(name, {}))
        return d

    def image(self, fname, noncolor=False):
        path = os.path.join(self.tex_dir, fname)
        img = bpy.data.images.load(path, check_existing=True)
        if noncolor:
            img.colorspace_settings.name = 'Non-Color'
        return img

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
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        color = lin(d.get('color', '#CCCCCC'))
        _inp(bsdf, 'Base Color').default_value = (*color, 1.0)
        _inp(bsdf, 'Metallic').default_value = d.get('metal', 0.0)
        _inp(bsdf, 'Roughness').default_value = d.get('rough', 0.5)
        if 'spec' in d:
            s = _inp(bsdf, 'Specular IOR Level', 'Specular')
            if s is not None:
                s.default_value = d['spec']
        tex = None
        if 'tex' in d:
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = self.image(d['tex'])
            tex.location = (-500, 250)
            nt.links.new(tex.outputs['Color'], _inp(bsdf, 'Base Color'))
        if d.get('alpha') == 'MASK' and tex is not None:
            rnd = nt.nodes.new('ShaderNodeMath')
            rnd.operation = 'ROUND'
            rnd.location = (-250, 0)
            nt.links.new(tex.outputs['Alpha'], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], _inp(bsdf, 'Alpha'))
            try:
                m.surface_render_method = 'DITHERED'
            except Exception:
                pass
        elif isinstance(d.get('alpha'), float):
            _inp(bsdf, 'Alpha').default_value = d['alpha']
            try:
                m.surface_render_method = 'BLENDED'
            except Exception:
                pass
        if 'normal' in d:
            nimg = nt.nodes.new('ShaderNodeTexImage')
            nimg.image = self.image(d['normal'], noncolor=True)
            nimg.location = (-700, -250)
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.location = (-300, -250)
            nm.inputs['Strength'].default_value = d.get('normal_strength', 1.0)
            nt.links.new(nimg.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], _inp(bsdf, 'Normal'))
        if d.get('emit', 0) > 0:
            ec = _inp(bsdf, 'Emission Color', 'Emission')
            es = _inp(bsdf, 'Emission Strength')
            if d.get('emit_tex') and tex is not None:
                nt.links.new(tex.outputs['Color'], ec)
            else:
                ec.default_value = (*lin(d.get('emit_color', d.get('color', '#FFFFFF'))), 1.0)
            if es is not None:
                es.default_value = d['emit']
        m.use_backface_culling = not d.get('double', False)
        m.diffuse_color = (*color, 1.0)
        m.roughness = d.get('rough', 0.5)
        self.cache[name] = m
        return m
