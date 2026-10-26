"""SKYPACT airside equipment kit generator.

Run headless (from the repo root):
  blender --background --factory-startup --python pipeline/blender/equipment/build_equipment.py -- [--only a,b] [--force-textures]

Outputs:
  pipeline/build/raw/equipment/<name>.glb      raw GLB exports (one per asset)
  pipeline/build/raw/equipment/textures/*.png  generated textures (embedded in the GLBs)
  pipeline/build/raw/equipment/manifest.json   dimensions, triangle counts, materials, nodes
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

from eqlib import glbinfo, materials, registry, scene, textures  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(REPO, 'pipeline', 'build', 'raw', 'equipment')
TEX = os.path.join(OUT, 'textures')
GENERATOR_VERSION = '1.0.0'


def build_one(spec):
    scene.reset()
    matlib = materials.MatLib(TEX, spec.colors)
    props = {
        'skypact_asset': spec.name,
        'skypact_category': spec.category,
        'skypact_generator': 'pipeline/blender/equipment/build_equipment.py v' + GENERATOR_VERSION,
        'units': 'metres; origin ground centre of footprint; front +Y (Blender) = -Z (three.js)',
        'lods': len(spec.lods),
    }
    if spec.morphs:
        props['morph_targets'] = list(spec.morphs)
    for k, v in spec.extras.items():
        props[k] = v
    root, stats = scene.assemble(spec.name, spec.fn, matlib, spec.lods, spec.morphs, props)
    path = os.path.join(OUT, spec.name + '.glb')
    tangents = any('normal' in matlib.defs(n) for n in matlib.cache)
    scene.export_glb(path, tangents=tangents)
    return path, stats


def write_manifest():
    assets = []
    for spec in registry.ASSETS:
        path = os.path.join(OUT, spec.name + '.glb')
        if not os.path.exists(path):
            continue
        info, js, binc = glbinfo.summarize(path)
        lods = info['lods']
        l0 = lods.get('LOD0', {}).get('triangles', 0)
        entry = {
            'name': spec.name,
            'category': spec.category,
            'file': 'pipeline/build/raw/equipment/' + spec.name + '.glb',
            'description': spec.desc,
            'dimensions_m': info['dimensions_m'],
            'bbox_min_m': info['bbox_min'],
            'bbox_max_m': info['bbox_max'],
            'triangles': {k: v['triangles'] for k, v in lods.items()},
            'triangles_total': sum(v['triangles'] for v in lods.values()),
            'lod_ratios': {k: round(v['triangles'] / l0, 3) for k, v in lods.items() if l0},
            'materials': info['materials'],
            'textures': info['images'],
            'nodes': [{k: n[k] for k in ('name', 'type', 'parent', 'triangles', 'materials') if k in n}
                      for n in info['nodes']],
            'empties': {k: dict(v, meaning=spec.empties.get(k, '')) for k, v in info['empties'].items()},
            'morph_targets': info['morph_targets'],
            'custom_attributes': info['custom_attributes'],
            'file_size_bytes': info['file_size_bytes'],
        }
        if spec.extras:
            entry['notes'] = spec.extras
        assets.append(entry)
    man = {
        'generator': 'pipeline/blender/equipment/build_equipment.py',
        'generator_version': GENERATOR_VERSION,
        'blender': bpy.app.version_string,
        'conventions': 'docs/CONVENTIONS.md sections 2, 3, 3.2',
        'frame': 'asset frame = Blender (x right, y forward, z up), metres; glTF/three.js: x, y=up, z=-forward',
        'empties_note': 'position_m = asset frame, rest pose; local_m = offset from the parent node (asset axes)',
        'runtime_notes': {
            'lods': 'root -> LOD0/LOD1/LOD2; node names inside LOD1/LOD2 carry a _LOD1/_LOD2 suffix; '
                    'empties exist only under LOD0; furniture/shrub have LOD0 only',
            'wheels': 'Wheels* meshes carry _AXLE (VEC3 float, glTF/three.js local coordinates, Y up): '
                      'spin each vertex about the local X axis through its _AXLE point',
            'morphs': 'Lift* meshes carry morph targets (mesh.extras.targetNames); weight 0 = transport pose, '
                      '1 = full range; apply the same weights to Lift, Lift_LOD1 and Lift_LOD2',
            'lights': 'M_Lights uses a colour palette texture as base colour and emissive (emissive on); '
                      'M_Beacon is the amber rotating beacon (emissive strength 2)',
            'signs': 'taxi_sign: M_SignFace (front, +Y) and M_SignFaceBack (back) faces are UV 0-1 for runtime text',
            'jet_bridge': 'see pipeline/blender/equipment/README.md "Jet bridge runtime contract"',
        },
        'assets': assets,
    }
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(man, f, indent=2)
    return man


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--force-textures', action='store_true')
    ap.add_argument('--no-manifest', action='store_true')
    args = ap.parse_args(argv)
    only = {s.strip() for s in args.only.split(',') if s.strip()}
    scene.reset()
    textures.ensure_textures(TEX, force=args.force_textures)
    t_all = time.time()
    for spec in registry.ASSETS:
        if only and spec.name not in only:
            continue
        t0 = time.time()
        path, stats = build_one(spec)
        print(f"[equipment] {spec.name:28s} {stats}  {time.time() - t0:5.1f}s -> {os.path.relpath(path, REPO)}")
    if not args.no_manifest:
        write_manifest()
        print('[equipment] manifest written')
    print(f"[equipment] done in {time.time() - t_all:.1f}s")


if __name__ == '__main__':
    main()
