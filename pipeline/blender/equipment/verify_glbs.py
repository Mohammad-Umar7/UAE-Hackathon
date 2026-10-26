"""Verify the exported equipment GLBs.

  python pipeline/blender/equipment/verify_glbs.py [--skip-npx] [--only a,b]

For every asset in the registry manifest:
  * runs `npx --yes @gltf-transform/cli inspect <file>` and `... validate <file>`
    (logs in pipeline/build/raw/equipment/verify/), counts validator errors / warnings;
  * checks the CONVENTIONS contract with a pure-Python GLB reader: root node name, LOD0/1/2
    children, empties only under LOD0, jet-bridge part names, material names, _AXLE wheel
    attribute sanity, morph target names and default weights, triangle budgets, LOD ratios.
Writes verify/summary.json and prints a table.  Exit code 1 if anything fails.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from eqlib import glbinfo  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
RAW = os.path.join(REPO, 'pipeline', 'build', 'raw', 'equipment')
LOGS = os.path.join(RAW, 'verify')
ANSI = re.compile(r'\x1b\[[0-9;]*m')

CONTRACT_MATS = {'M_Body', 'M_Trim', 'M_Glass', 'M_Rubber', 'M_Metal', 'M_Lights', 'M_Beacon', 'M_Hazard',
                 'M_SignFace'}
EXTRA_MATS = {'M_SignFaceBack', 'M_Decal', 'M_Luggage', 'M_Frond', 'M_Trunk', 'M_Foliage', 'M_Fence'}
JB_PARTS = ['JB_Rotunda', 'JB_Tunnel_A', 'JB_Tunnel_B', 'JB_DriveColumn', 'JB_Cab']
BUDGET = {'gse': (2000, 15000), 'jet_bridge': (0, 20000), 'furniture': (20, 400), 'vegetation': (0, 4000),
          'context': (0, 4000)}


def npx(args):
    exe = 'npx.cmd' if os.name == 'nt' else 'npx'
    p = subprocess.run([exe, '--yes', '@gltf-transform/cli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return p.returncode, ANSI.sub('', p.stdout + p.stderr)


def check_asset(a, skip_npx):
    name = a['name']
    path = os.path.join(REPO, a['file'])
    res = {'name': name, 'ok': True, 'problems': []}

    def bad(msg):
        res['ok'] = False
        res['problems'].append(msg)

    info, js, binc = glbinfo.summarize(path)
    nodes = js['nodes']
    root = nodes[js['scenes'][0]['nodes'][0]]
    if root.get('name') != name:
        bad(f"root node is {root.get('name')!r}, expected {name!r}")
    lod_names = [nodes[c].get('name') for c in root.get('children', [])]
    exp = ['LOD0', 'LOD1', 'LOD2'] if len(a['triangles']) == 3 else ['LOD0']
    if sorted(lod_names) != exp:
        bad(f'LOD children {lod_names} != {exp}')
    # empties must live under LOD0
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i

    def lod_of(i):
        while i in parent:
            nm = nodes[i].get('name', '')
            if nm in ('LOD0', 'LOD1', 'LOD2'):
                return nm
            i = parent[i]
        return nodes[i].get('name')
    for i, n in enumerate(nodes):
        if 'mesh' not in n and n.get('name') not in ('LOD0', 'LOD1', 'LOD2') and i in parent:
            if lod_of(i) != 'LOD0':
                bad(f"empty {n.get('name')} not under LOD0")
            if not re.fullmatch(r'[A-Z0-9_]+', n.get('name', '')):
                bad(f"empty name {n.get('name')} is not UPPER_SNAKE_CASE")
    # jet bridge part contract (in every LOD group)
    names = {n.get('name') for n in nodes}
    if a['category'] == 'jet_bridge':
        for lod in ('', '_LOD1', '_LOD2'):
            for p in JB_PARTS:
                if p + lod not in names:
                    bad(f'missing part {p + lod}')
    # materials
    for m in info['materials']:
        if m not in CONTRACT_MATS | EXTRA_MATS:
            bad(f'unexpected material {m}')
    # wheels
    axles = glbinfo.check_axles(js, binc)
    for r in axles:
        if r['max_radius_from_axle'] > 0.8:
            bad(f"_AXLE sanity: {r['node']} vertex {r['max_radius_from_axle']} m from its axle")
    res['axle_check'] = axles
    # morph targets: names and default weight 0
    for mi, m in enumerate(js.get('meshes', [])):
        tn = (m.get('extras') or {}).get('targetNames')
        if tn:
            w = m.get('weights', [0] * len(tn))
            if any(abs(x) > 1e-6 for x in w):
                bad(f"mesh {m.get('name')} default morph weights {w} (expected 0)")
    # budgets
    lo, hi = BUDGET[a['category']]
    t0 = a['triangles']['LOD0']
    if not (lo <= t0 <= hi) and a['category'] != 'jet_bridge':
        bad(f'LOD0 triangles {t0} outside budget {lo}-{hi}')
    if a['category'] == 'jet_bridge' and a['triangles_total'] > hi:
        bad(f"jet bridge total triangles {a['triangles_total']} > {hi}")
    if len(a['triangles']) == 3:
        r1, r2 = a['lod_ratios']['LOD1'], a['lod_ratios']['LOD2']
        if not (0.20 <= r1 <= 0.38):
            bad(f'LOD1 ratio {r1}')
        if not (0.035 <= r2 <= 0.12):
            bad(f'LOD2 ratio {r2}')
    # gltf-transform
    if not skip_npx:
        os.makedirs(LOGS, exist_ok=True)
        rc, out = npx(['inspect', path])
        with open(os.path.join(LOGS, name + '_inspect.txt'), 'w', encoding='utf-8') as f:
            f.write(out)
        if rc != 0:
            bad('gltf-transform inspect failed')
        rc, out = npx(['validate', path])
        with open(os.path.join(LOGS, name + '_validate.txt'), 'w', encoding='utf-8') as f:
            f.write(out)
        sec = {}
        for key in ('ERROR', 'WARNING', 'INFO', 'HINT'):
            m = re.search(r'\n ' + key + r'\n[^\n]*\n(.*?)(?=\n [A-Z]+\n|\Z)', out, re.S)
            body = m.group(1) if m else ''
            sec[key] = 0 if 'No ' in body[:200] and 'found' in body[:200] else len(
                [ln for ln in body.splitlines() if ln.startswith('│') and 'code' not in ln])
        res['validator'] = sec
        if rc != 0 or sec['ERROR'] or sec['WARNING']:
            bad(f"validator errors={sec['ERROR']} warnings={sec['WARNING']}")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--skip-npx', action='store_true')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    with open(os.path.join(RAW, 'manifest.json'), encoding='utf-8') as f:
        man = json.load(f)
    only = {s for s in a.only.split(',') if s}
    results = []
    for asset in man['assets']:
        if only and asset['name'] not in only:
            continue
        r = check_asset(asset, a.skip_npx)
        results.append(r)
        v = r.get('validator', {})
        tri = asset['triangles']
        print(f"{'OK ' if r['ok'] else 'BAD'} {asset['name']:26s} tris {str(list(tri.values())):24s} "
              f"validator E{v.get('ERROR', '-')} W{v.get('WARNING', '-')} I{v.get('INFO', '-')}  "
              + '; '.join(r['problems']))
    os.makedirs(LOGS, exist_ok=True)
    with open(os.path.join(LOGS, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2)
    nbad = sum(1 for r in results if not r['ok'])
    print(f'{len(results) - nbad}/{len(results)} assets passed')
    sys.exit(1 if nbad else 0)


if __name__ == '__main__':
    main()
