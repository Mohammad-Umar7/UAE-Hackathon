"""Dev tool: find faces that are probably flipped (three.js culls back faces).

  blender --background --factory-startup --python pipeline/blender/equipment/audit_normals.py -- [--only a,b]

Heuristic per face of every single-sided LOD0 mesh: cast a ray from the face centre along its
normal and one against it.  A face whose FRONT is blocked within `near` metres while its BACK is
open (nothing within `far`) is almost certainly a panel/cap wound the wrong way.  Prints a
per-asset count and the worst offenders (material, centre).
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

from eqlib import registry  # noqa: E402
from eqlib.geo import face_normal  # noqa: E402
from eqlib.materials import BASE  # noqa: E402

DOUBLE = {k for k, v in BASE.items() if v.get('double')}


def audit(spec, near=0.03, far=6.0, touch=0.0015, lod=0):
    rig = spec.fn(lod, {})
    verts, polys, mats = [], [], []
    for nd in rig.nodes:
        g = nd['geo']
        base = len(verts)
        verts += [tuple(v) for v in g.v]
        polys += [[base + i for i in f] for f in g.f]
        mats += g.fm
    double = set(DOUBLE)
    for k, v in spec.colors.items():
        if v.get('double'):
            double.add(k)
    bvh = BVHTree.FromPolygons(verts, polys)
    bad = []
    for fi, f in enumerate(polys):
        if mats[fi] in double:
            continue
        pts = [Vector(verts[i]) for i in f]
        n = face_normal(pts)
        c = sum(pts, Vector()) / len(pts)
        o_front = c + n * 1e-4
        o_back = c - n * 1e-4
        hf = bvh.ray_cast(o_front, n, near)
        hb = bvh.ray_cast(o_back, -n, far)
        if hf[0] is not None and hf[3] > touch and hb[0] is None:
            bad.append((mats[fi], tuple(round(x, 2) for x in c), round(hf[3], 3)))
    return len(polys), bad


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    a = ap.parse_args(argv)
    only = {s for s in a.only.split(',') if s}
    for spec in registry.ASSETS:
        if only and spec.name not in only:
            continue
        for lod in spec.lods:
            n, bad = audit(spec, lod=lod)
            print(f'[audit] {spec.name:26s} LOD{lod} faces {n:6d} suspicious {len(bad)}')
            for b in bad[:12]:
                print('         ', b)


if __name__ == '__main__':
    main()
