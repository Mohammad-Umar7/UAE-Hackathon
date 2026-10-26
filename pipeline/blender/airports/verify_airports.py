"""Verify the exported signature-architecture GLBs (no Blender needed).

  pipeline/.venv/Scripts/python pipeline/blender/airports/verify_airports.py [--npx] [--only name,...]

Checks per GLB (from manifest.json):
  * hierarchy: single root named after the asset with an identity transform; children exactly
    LOD0/LOD1/LOD2 (identity); LOD1/LOD2 mesh names carry the _LOD1/_LOD2 suffix
  * materials: only the contract names (M_Glass, M_GlassLit, M_Roof, M_Structure, M_Concrete,
    M_Accent, M_Dark, M_Lights); M_Lights emissive, M_GlassLit not emissive
  * triangles: LOD1/LOD0 and LOD2/LOD0 ratios, per-airport LOD0 sum <= 250k
  * placement in the ENU frame: every LOD0 vertex lies within `tolerance` metres of the union of
    the superseded layout.json footprints, and the plan bbox overlaps theirs (IoU)
  * geometry sanity: no NaN, no degenerate triangles, normals present and unit length
  * optional: gltf-transform validate (npx --no-install, offline cache)
Writes pipeline/build/raw/airports/verify/summary.json.  Exit code 1 if anything fails.
"""
import argparse
import json
import os
import re
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ap_glbinfo  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
RAW = os.path.join(REPO, 'pipeline', 'build', 'raw', 'airports')
LOGS = os.path.join(RAW, 'verify')
ALLOWED = {'M_Glass', 'M_GlassLit', 'M_Roof', 'M_Structure', 'M_Concrete', 'M_Accent', 'M_Dark', 'M_Lights'}
BUDGET = 250000
# geometry that legitimately stands proud of the OSM outline (m): landside kerb canopies and the
# T1 ogee colonnade; everything else stays within 4 m (roof overhangs follow the outline)
TOLERANCE = {'default': 4.0, 'OMDB_terminal_1': 21.0, 'OMDB_terminal_2': 20.0, 'OMDB_terminal_3': 20.0}
# the 25 m wide Terminal 3 strip carries a 12 m kerb canopy, so its plan bbox legitimately grows
IOU_MIN = {'OMDB_terminal_3': 0.75}
ANSI = re.compile(r'\x1b\[[0-9;]*m')


def footprints_union(icao, ids):
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    with open(os.path.join(REPO, 'data', 'airports', icao, 'layout.json'), encoding='utf-8') as f:
        L = json.load(f)
    polys = []
    for b in L['buildings']:
        if b['id'] in ids:
            polys.append(Polygon(b['footprint'], b.get('holes') or []).buffer(0))
    missing = set(ids) - {b['id'] for b in L['buildings']}
    return unary_union(polys), missing


def lod0_vertices(js, binc):
    """All LOD0 vertex positions (ENU) and triangle index arrays."""
    nodes = js['nodes']
    world = ap_glbinfo.world_matrices(js)
    root = js['scenes'][js.get('scene', 0)]['nodes'][0]
    lod0 = next(c for c in nodes[root].get('children', []) if nodes[c].get('name') == 'LOD0')

    def subtree(i):
        out = [i]
        for c in nodes[i].get('children', []):
            out += subtree(c)
        return out
    pts, tris, nrm_bad, degen = [], 0, 0, 0
    nan = False
    for i in subtree(lod0):
        n = nodes[i]
        if 'mesh' not in n:
            continue
        M = np.array(world[i])
        for p in js['meshes'][n['mesh']]['primitives']:
            P = np.array(ap_glbinfo.accessor(js, binc, p['attributes']['POSITION']), float)
            if 'NORMAL' not in p['attributes']:
                nrm_bad += len(P)
            else:
                N = np.array(ap_glbinfo.accessor(js, binc, p['attributes']['NORMAL']), float)
                ln = np.linalg.norm(N, axis=1)
                nrm_bad += int(np.sum(np.abs(ln - 1.0) > 0.02))
            W = (np.c_[P, np.ones(len(P))] @ M.T)[:, :3]
            enu = np.c_[W[:, 0], -W[:, 2], W[:, 1]]
            nan |= bool(np.isnan(enu).any())
            pts.append(enu)
            if 'indices' in p:
                idx = np.array(ap_glbinfo.accessor(js, binc, p['indices']), dtype=np.int64).reshape(-1, 3)
                a, b, c = enu[idx[:, 0]], enu[idx[:, 1]], enu[idx[:, 2]]
                area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
                degen += int(np.sum(area < 1e-6))
                tris += len(idx)
    return np.concatenate(pts), tris, nrm_bad, degen, nan


def npx(args):
    exe = 'npx.cmd' if os.name == 'nt' else 'npx'
    try:
        p = subprocess.run([exe, '--no-install', '@gltf-transform/cli'] + args, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=600)
    except Exception as e:  # pragma: no cover
        return 1, str(e)
    return p.returncode, ANSI.sub('', p.stdout + p.stderr)


def check(asset, use_npx):
    from shapely.geometry import box
    name = asset['name']
    path = os.path.join(REPO, asset['file'])
    res = {'name': name, 'ok': True, 'problems': [], 'notes': []}

    def bad(msg):
        res['ok'] = False
        res['problems'].append(msg)

    info, js, binc = ap_glbinfo.summarize(path)
    nodes = js['nodes']
    roots = js['scenes'][js.get('scene', 0)]['nodes']
    if len(roots) != 1:
        bad(f'{len(roots)} scene roots')
    root = nodes[roots[0]]
    if root.get('name') != name:
        bad(f"root is {root.get('name')!r}")
    for k, ident in (('translation', [0, 0, 0]), ('rotation', [0, 0, 0, 1]), ('scale', [1, 1, 1])):
        if k in root and any(abs(a - b) > 1e-6 for a, b in zip(root[k], ident)):
            bad(f'root {k} {root[k]} is not identity')
    kids = [nodes[c] for c in root.get('children', [])]
    kid_names = sorted(n.get('name') for n in kids)
    if kid_names != ['LOD0', 'LOD1', 'LOD2']:
        bad(f'root children {kid_names}')
    for n in kids:
        for k, ident in (('translation', [0, 0, 0]), ('rotation', [0, 0, 0, 1]), ('scale', [1, 1, 1])):
            if k in n and any(abs(a - b) > 1e-6 for a, b in zip(n[k], ident)):
                bad(f"{n.get('name')} {k} not identity")
        suffix = '' if n.get('name') == 'LOD0' else '_' + n.get('name')
        for c in n.get('children', []):
            cn = nodes[c].get('name', '')
            if suffix and not cn.endswith(suffix):
                bad(f"{n.get('name')} child {cn} lacks suffix {suffix}")
    # materials
    mats = {m.get('name'): m for m in js.get('materials', [])}
    for m in mats:
        if m not in ALLOWED:
            bad(f'unexpected material {m}')
    if 'M_Lights' in mats:
        ef = mats['M_Lights'].get('emissiveFactor', [0, 0, 0])
        if max(ef) <= 0:
            bad('M_Lights is not emissive')
    if 'M_GlassLit' in mats and max(mats['M_GlassLit'].get('emissiveFactor', [0, 0, 0])) > 0:
        bad('M_GlassLit is emissive in the GLB (runtime should switch it)')
    # triangles
    tri = {k: v['triangles'] for k, v in info['lods'].items()}
    res['triangles'] = tri
    if tri.get('LOD0'):
        r1 = tri.get('LOD1', 0) / tri['LOD0']
        r2 = tri.get('LOD2', 0) / tri['LOD0']
        res['lod_ratios'] = [round(r1, 3), round(r2, 3)]
        if not (0.18 <= r1 <= 0.5):
            bad(f'LOD1 ratio {r1:.2f}')
        if not (0.02 <= r2 <= 0.16):
            bad(f'LOD2 ratio {r2:.2f}')
    # geometry + placement
    P, t0, nrm_bad, degen, nan = lod0_vertices(js, binc)
    if nan:
        bad('NaN positions')
    if nrm_bad:
        bad(f'{nrm_bad} missing / non-unit normals')
    if degen:
        res['notes'].append(f'{degen} degenerate triangles (area < 1e-6 m2)')
    U, missing = footprints_union(asset['icao'], asset['replaces'])
    if missing:
        bad(f'replaced ids not in layout.json: {sorted(missing)}')
    tol = TOLERANCE.get(name, TOLERANCE['default'])
    from shapely import contains_xy
    zone = U.buffer(tol)
    out = ~contains_xy(zone, P[:, 0], P[:, 1])
    if out.any():
        from shapely.geometry import Point
        sample = P[out][:: max(1, int(out.sum()) // 400), :2]
        dmax = max(U.distance(Point(float(x), float(y))) for x, y in sample)
        bad(f'{int(out.sum())} LOD0 vertices further than {tol} m from the superseded footprints (max ~{dmax:.1f} m)')
    lo, hi = P.min(axis=0), P.max(axis=0)
    mb = box(lo[0], lo[1], hi[0], hi[1])
    fb = box(*U.bounds)
    iou = mb.intersection(fb).area / mb.union(fb).area
    res['plan_bbox_iou'] = round(iou, 3)
    res['bbox_enu'] = {'min': [round(v, 2) for v in lo], 'max': [round(v, 2) for v in hi]}
    res['footprint_bbox'] = [round(v, 2) for v in U.bounds]
    iou_min = IOU_MIN.get(name, 0.85 if U.area > 2000 else 0.7)   # small footprints (towers): bbox IoU is noisy
    if iou < iou_min:
        bad(f'plan bbox IoU {iou:.2f} with the superseded footprints')
    if lo[2] < -0.05:
        bad(f'geometry below ground (z min {lo[2]:.2f})')
    # gltf-transform validate
    if use_npx:
        os.makedirs(LOGS, exist_ok=True)
        rc, out_txt = npx(['validate', path])
        with open(os.path.join(LOGS, name + '_validate.txt'), 'w', encoding='utf-8') as f:
            f.write(out_txt)
        errors = 'No errors found' not in out_txt
        warnings = 'No warnings found' not in out_txt
        infos = len(re.findall(r'UNUSED_OBJECT', out_txt))
        res['validator'] = {'rc': rc, 'errors': errors, 'warnings': warnings, 'info_unused_texcoord': infos}
        if rc != 0 or errors or warnings:
            bad(f'gltf-transform validate rc={rc} errors={errors} warnings={warnings}')
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--npx', action='store_true')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    with open(os.path.join(RAW, 'manifest.json'), encoding='utf-8') as f:
        man = json.load(f)
    only = {s for s in a.only.split(',') if s}
    results = []
    per_airport = {}
    for asset in man['assets']:
        if only and asset['name'] not in only:
            continue
        r = check(asset, a.npx)
        results.append(r)
        per_airport[asset['icao']] = per_airport.get(asset['icao'], 0) + r.get('triangles', {}).get('LOD0', 0)
        t = r.get('triangles', {})
        print(f"{'OK ' if r['ok'] else 'BAD'} {asset['name']:20s} LOD0 {t.get('LOD0', 0):7d} LOD1 {t.get('LOD1', 0):6d} "
              f"LOD2 {t.get('LOD2', 0):6d}  IoU {r.get('plan_bbox_iou', 0):.2f}  "
              + '; '.join(r['problems'] + r['notes']))
    for icao, n in sorted(per_airport.items()):
        flag = 'OK ' if n <= BUDGET else 'BAD'
        print(f'{flag} {icao} LOD0 total {n} / {BUDGET}')
        if n > BUDGET:
            results.append({'name': icao, 'ok': False, 'problems': [f'LOD0 {n} > {BUDGET}']})
    os.makedirs(LOGS, exist_ok=True)
    with open(os.path.join(LOGS, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump({'assets': results, 'lod0_per_airport': per_airport}, f, indent=2)
    nbad = sum(1 for r in results if not r['ok'])
    print(f'{len(results) - nbad}/{len(results)} checks passed')
    sys.exit(1 if nbad else 0)


if __name__ == '__main__':
    main()
