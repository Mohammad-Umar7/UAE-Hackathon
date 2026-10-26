"""Normal-orientation audit for single-sided architecture (three.js culls back faces).

For every face of the LOD0 parts a ray is cast from just in front of the face along its normal.
If the first thing it meets is the BACK of another face, the face sits inside a closed volume:
either it is flipped (pointing into the building) or it is buried inside / under another part
(e.g. roof skin under a skylight strip, facade glass where a fixed link passes through) and is
therefore hidden.  The report groups these hits by (face part -> hit part) and distance so the two
cases can be told apart; the debug-backface preview (render_previews.py --debug-backface) is the
visual cross-check (any red = a visible back face = a hole at runtime).
"""
from collections import Counter

from mathutils import Vector
from mathutils.bvhtree import BVHTree


def audit_geo_parts(parts, far=4000.0, eps=0.02, max_report=40):
    verts, polys, owner = [], [], []
    for item in parts:
        name, g = item[0], item[1]
        if g is None or g.empty():
            continue
        base = len(verts)
        verts.extend(g.v)
        for f, m in zip(g.f, g.m):
            polys.append([base + i for i in f])
            owner.append((name, m))
    bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)
    bad = []
    cnt = Counter()
    pairs = Counter()
    for fi, f in enumerate(polys):
        pts = [Vector(verts[i]) for i in f]
        n = Vector((0, 0, 0))
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        if n.length < 1e-9:
            continue
        n.normalize()
        c = sum(pts, Vector()) / len(pts)
        loc, nh, idx, dist = bvh.ray_cast(c + n * eps, n, far)
        if loc is None:
            continue
        if nh.dot(n) > 0.05:
            cnt[owner[fi]] += 1
            band = 'near<2m' if dist < 2.0 else ('mid<20m' if dist < 20.0 else 'far')
            pairs[(f'{owner[fi][0]}/{owner[fi][1]}', f'{owner[idx][0]}/{owner[idx][1]}', band)] += 1
            if len(bad) < max_report:
                bad.append((owner[fi][0], owner[fi][1], tuple(round(x, 1) for x in c), round(dist, 2),
                            owner[idx][0], owner[idx][1]))
    return {'faces': len(polys), 'bad': bad,
            'by_part': {f'{k[0]}/{k[1]}': v for k, v in cnt.most_common()},
            'pairs': [(a, b, band, v) for (a, b, band), v in pairs.most_common(30)]}
