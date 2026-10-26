"""SKYPACT signature airport architecture generator (entry point).

Run headless from the repository root:
  blender --background --factory-startup --python pipeline/blender/airports/build_airports.py -- \
      [--only OMAA_terminal_a,OMDB_tower] [--icao OMAA] [--no-manifest] [--audit] [--previews]

Builds every asset of ap_registry (OMAA, OMDB, OMSJ signature buildings) in the airport ENU
frame (no re-centring: the twin places each GLB at the origin with an identity transform),
exports pipeline/build/raw/airports/<ICAO>_<name>.glb and merges
pipeline/build/raw/airports/manifest.json.  --previews then runs render_previews.py for the
built assets; --audit ray-casts LOD0 for flipped faces.
"""
import argparse
import datetime
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import ap_glbinfo  # noqa: E402
import ap_layout  # noqa: E402
import ap_materials  # noqa: E402
import ap_registry  # noqa: E402
import ap_scene  # noqa: E402

REPO = ap_layout.REPO
OUT = os.path.join(REPO, 'pipeline', 'build', 'raw', 'airports')
TEX = os.path.join(OUT, 'textures')
GENERATOR_VERSION = '1.0.0'
BUDGET_LOD0_PER_AIRPORT = 250000


def build_one(spec, audit=False):
    ap_scene.reset()
    if spec.get('textures'):
        for fn in spec['textures']:
            fn(TEX)
    matlib = ap_materials.MatLib(spec.get('materials'), TEX)
    lods = {}
    t0 = time.time()
    for lod in spec['lods']:
        lods[lod] = spec['build'](lod)
    t1 = time.time()
    props = {
        'skypact_asset': spec['name'],
        'skypact_category': 'airports',
        'icao': spec['icao'],
        'title': spec['title'],
        'replaces': ','.join(spec['replaces']),
        'frame': 'airport ENU (aeqd about the ARP): x east, y north, z up, metres; place at the origin, '
                 'identity transform',
        'skypact_generator': 'pipeline/blender/airports/build_airports.py v' + GENERATOR_VERSION,
    }
    root, stats = ap_scene.assemble(spec['name'], lods, matlib, props)
    path = os.path.join(OUT, spec['name'] + '.glb')
    ap_scene.export_glb(path)
    audit_res = None
    if audit:
        import ap_audit
        audit_res = ap_audit.audit_geo_parts(lods[0])
    return path, stats, t1 - t0, audit_res


def manifest_entry(spec, path):
    info, js, binc = ap_glbinfo.summarize(path)
    lods = info['lods']
    l0 = lods.get('LOD0', {}).get('triangles', 0)
    mats = info['materials']
    over = spec.get('materials') or {}
    mat_desc = {}
    for m in mats:
        d = ap_materials.MatLib(over).defs(m)
        mat_desc[m] = {k: d[k] for k in ('color', 'metal', 'rough', 'emit', 'emit_color', 'tex') if k in d}
    return {
        'name': spec['name'],
        'icao': spec['icao'],
        'file': 'pipeline/build/raw/airports/' + spec['name'] + '.glb',
        'title': spec['title'],
        'replaces': list(spec['replaces']),
        'bbox_enu': {'min': info['bbox_min'], 'max': info['bbox_max']},
        'triangles': {k: v['triangles'] for k, v in lods.items()},
        'lod_ratios': {k: round(v['triangles'] / l0, 3) for k, v in lods.items() if l0},
        'materials': mats,
        'material_values': mat_desc,
        'nodes': [{k: n[k] for k in ('name', 'type', 'parent', 'triangles', 'materials') if k in n}
                  for n in info['nodes']],
        'file_size_bytes': info['file_size_bytes'],
        'notes': spec.get('notes', ''),
    }


def write_manifest(built):
    path = os.path.join(OUT, 'manifest.json')
    old = {}
    if os.path.exists(path):
        try:
            with open(path, encoding='utf-8') as f:
                for a in json.load(f).get('assets', []):
                    old[a['name']] = a
        except Exception:
            old = {}
    specs = ap_registry.assets()
    entries = []
    for spec in specs:
        p = os.path.join(OUT, spec['name'] + '.glb')
        if spec['name'] in built or (spec['name'] not in old and os.path.exists(p)):
            entries.append(manifest_entry(spec, p))
        elif spec['name'] in old and os.path.exists(p):
            entries.append(old[spec['name']])
    per_airport = {}
    for e in entries:
        a = per_airport.setdefault(e['icao'], {'assets': [], 'LOD0': 0, 'LOD1': 0, 'LOD2': 0})
        a['assets'].append(e['name'])
        for k in ('LOD0', 'LOD1', 'LOD2'):
            a[k] += e['triangles'].get(k, 0)
    for icao, a in per_airport.items():
        a['LOD0_budget'] = BUDGET_LOD0_PER_AIRPORT
        a['LOD0_within_budget'] = a['LOD0'] <= BUDGET_LOD0_PER_AIRPORT
    man = {
        'generator': 'pipeline/blender/airports/build_airports.py',
        'generator_version': GENERATOR_VERSION,
        'blender': bpy.app.version_string,
        'generated': datetime.date.today().isoformat(),
        'conventions': 'docs/CONVENTIONS.md sections 2-4',
        'frame': 'Each GLB is modelled in its airport ENU frame (aeqd about the ARP; x east, y north, z up, '
                 'metres; ground = airfield datum z 0) and exported +Y up, so three.js gets (x east, y up, '
                 'z = -north). Place every GLB at the origin with an identity transform. bbox_enu is in ENU.',
        'replaces_note': 'replaces = layout.json building ids that the model supersedes: hide those extrusions '
                         'when the GLB is shown.',
        'hierarchy': '<name> (root empty, extras: icao, title, replaces) -> LOD0 / LOD1 / LOD2 -> mesh nodes '
                     '(LOD1/LOD2 node names carry a _LOD1/_LOD2 suffix); one primitive per material',
        'materials': {
            'M_Glass': 'dark reflective blue-grey glazing (metallic 0.3, roughness 0.1)',
            'M_GlassLit': 'same glazing on large lit glazed areas (facades, skylights, tower cabs): make it '
                          'emissive at night (warm white); not emissive in the GLB',
            'M_Roof': 'white / silver metal roof',
            'M_Structure': 'white / light-grey steel arches, ribs, mullions, soffits, canopies',
            'M_Concrete': 'warm light concrete / stone',
            'M_Accent': 'per-asset accent, see material_values (OMSJ: blue ceramic lattice screens, baked texture '
                        'T_Lattice.png)',
            'M_Dark': 'soffits in shadow, recesses, louvres, apron-level bands',
            'M_Lights': 'aviation obstruction lights (red), emissive in the GLB (strength 4)',
        },
        'uv': 'UVMap: box projection in metres x per-material scale (glass 0.25 /m, roof 0.1 /m, '
              'M_Accent 0.4 /m for the lattice texture), relative to each mesh node origin',
        'per_airport': per_airport,
        'assets': entries,
    }
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(man, f, indent=2)
    return man


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--icao', default='')
    ap.add_argument('--no-manifest', action='store_true')
    ap.add_argument('--audit', action='store_true')
    ap.add_argument('--previews', action='store_true')
    args = ap.parse_args(argv)
    only = {s.strip() for s in args.only.split(',') if s.strip()}
    icaos = {s.strip().upper() for s in args.icao.split(',') if s.strip()}
    built = []
    t_all = time.time()
    for spec in ap_registry.assets():
        if only and spec['name'] not in only:
            continue
        if icaos and spec['icao'] not in icaos:
            continue
        t0 = time.time()
        path, stats, tb, audit = build_one(spec, args.audit)
        built.append(spec['name'])
        print(f"[airports] {spec['name']:22s} {stats}  build {tb:5.1f}s total {time.time() - t0:5.1f}s "
              f"-> {os.path.relpath(path, REPO)}")
        if audit is not None:
            tot = sum(audit['by_part'].values())
            print(f"[audit] {spec['name']}: faces {audit['faces']} inside-hit {tot}  "
                  + ', '.join(f'{k}:{v}' for k, v in list(audit['by_part'].items())[:8]))
    if not args.no_manifest and built:
        man = write_manifest(set(built))
        for icao, a in man['per_airport'].items():
            print(f"[airports] {icao}: LOD0 {a['LOD0']} / {a['LOD0_budget']}  LOD1 {a['LOD1']}  LOD2 {a['LOD2']}")
    print(f'[airports] done in {time.time() - t_all:.1f}s')
    if args.previews and built:
        import render_previews
        render_previews.run(built)


if __name__ == '__main__':
    main()
