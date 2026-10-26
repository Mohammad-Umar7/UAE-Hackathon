"""Minimal pure-Python GLB reader used for the manifest and for self-verification.
No bpy dependency: runs in Blender's Python or any Python 3."""
import json
import math
import struct

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67:
        raise ValueError('not a GLB: ' + path)
    off = 12
    js, binc = None, b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        off += 8
        chunk = data[off:off + clen]
        off += clen
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            binc = chunk
    return js, binc, len(data)


def accessor_data(js, binc, idx):
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    fmt, size = COMP[acc['componentType']]
    nc = NCOMP[acc['type']]
    stride = bv.get('byteStride', size * nc)
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    out = []
    for i in range(acc['count']):
        o = base + i * stride
        out.append(struct.unpack_from('<' + fmt * nc, binc, o))
    return out


def _mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def node_matrix(n):
    if 'matrix' in n:
        m = n['matrix']
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = n.get('translation', [0, 0, 0])
    r = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    x, y, z, w = r
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    M = [[R[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)]
    M.append([0, 0, 0, 1])
    return M


def apply(M, p):
    return tuple(M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2] + M[i][3] for i in range(3))


def mesh_tris(js, mi):
    t = 0
    for p in js['meshes'][mi]['primitives']:
        mode = p.get('mode', 4)
        if 'indices' in p:
            n = js['accessors'][p['indices']]['count']
        else:
            n = js['accessors'][p['attributes']['POSITION']]['count']
        if mode == 4:
            t += n // 3
        elif mode in (5, 6):
            t += max(0, n - 2)
    return t


def summarize(path):
    js, binc, size = read_glb(path)
    nodes = js.get('nodes', [])
    scene = js['scenes'][js.get('scene', 0)]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    world = {}

    def walk(i, M):
        W = _mat_mul(M, node_matrix(nodes[i]))
        world[i] = W
        for c in nodes[i].get('children', []):
            walk(c, W)

    I4 = [[1 if r == c else 0 for c in range(4)] for r in range(4)]
    for r in scene['nodes']:
        walk(r, I4)

    def subtree(i):
        out = [i]
        for c in nodes[i].get('children', []):
            out += subtree(c)
        return out

    # glTF (+Y up) -> asset frame (Blender Z up): (x, y, z)_gltf -> (x, -z, y)
    def to_asset(p):
        return (p[0], -p[2], p[1])

    roots = scene['nodes']
    root = roots[0]
    info = {
        'root': nodes[root].get('name'),
        'roots': [nodes[r].get('name') for r in roots],
        'file_size_bytes': size,
        'materials': [m.get('name') for m in js.get('materials', [])],
        'images': [im.get('name') or im.get('uri') for im in js.get('images', [])],
        'extensions_used': js.get('extensionsUsed', []),
        'lods': {},
        'nodes': [],
        'empties': {},
        'morph_targets': {},
        'custom_attributes': {},
    }

    def bbox_of(ids):
        lo = [math.inf] * 3
        hi = [-math.inf] * 3
        for i in ids:
            n = nodes[i]
            if 'mesh' not in n:
                continue
            for p in js['meshes'][n['mesh']]['primitives']:
                acc = js['accessors'][p['attributes']['POSITION']]
                mn, mx = acc['min'], acc['max']
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            q = to_asset(apply(world[i], (cx, cy, cz)))
                            for k in range(3):
                                lo[k] = min(lo[k], q[k])
                                hi[k] = max(hi[k], q[k])
        return lo, hi

    for i, n in enumerate(nodes):
        kind = 'mesh' if 'mesh' in n else 'empty'
        rec = {'name': n.get('name'), 'type': kind,
               'parent': nodes[parent[i]].get('name') if i in parent else None}
        if kind == 'mesh':
            mesh = js['meshes'][n['mesh']]
            rec['triangles'] = mesh_tris(js, n['mesh'])
            rec['materials'] = sorted({js['materials'][p['material']]['name'] for p in mesh['primitives']
                                       if 'material' in p})
            names = (mesh.get('extras') or {}).get('targetNames')
            if names:
                info['morph_targets'][n.get('name')] = names
            attrs = set()
            for p in mesh['primitives']:
                attrs |= {a for a in p['attributes'] if a.startswith('_')}
            if attrs:
                info['custom_attributes'][n.get('name')] = sorted(attrs)
        if n.get('extras'):
            rec['extras'] = n['extras']
        info['nodes'].append(rec)
        if kind == 'empty' and n.get('name') not in ('LOD0', 'LOD1', 'LOD2') and i != root:
            p = to_asset(apply(world[i], (0, 0, 0)))
            t = n.get('translation', [0, 0, 0])
            info['empties'][n.get('name')] = {
                'position_m': [round(c, 4) for c in p],
                'parent': nodes[parent[i]].get('name') if i in parent else None,
                'local_m': [round(c, 4) for c in to_asset(t)],
            }

    for c in nodes[root].get('children', []):
        nm = nodes[c].get('name')
        if nm and nm.startswith('LOD'):
            ids = subtree(c)
            tris = sum(mesh_tris(js, nodes[i]['mesh']) for i in ids if 'mesh' in nodes[i])
            lo, hi = bbox_of(ids)
            info['lods'][nm] = {'triangles': tris, 'bbox_min': [round(v, 4) for v in lo],
                                'bbox_max': [round(v, 4) for v in hi]}
    lo, hi = bbox_of(subtree(root))
    if 'LOD0' in info['lods']:
        lo, hi = info['lods']['LOD0']['bbox_min'], info['lods']['LOD0']['bbox_max']
    info['bbox_min'] = [round(v, 4) for v in lo]
    info['bbox_max'] = [round(v, 4) for v in hi]
    info['dimensions_m'] = {'width_x': round(hi[0] - lo[0], 3), 'length_y': round(hi[1] - lo[1], 3),
                            'height_z': round(hi[2] - lo[2], 3)}
    info['root_extras'] = nodes[root].get('extras', {})
    return info, js, binc


def check_axles(js, binc, tol=0.02):
    """Every vertex of a mesh carrying _AXLE must lie within its wheel: |x - ax| small
    relative to radius and distance in the (y, z) plane (glTF frame) <= radius."""
    report = []
    for ni, n in enumerate(js.get('nodes', [])):
        if 'mesh' not in n:
            continue
        for p in js['meshes'][n['mesh']]['primitives']:
            if '_AXLE' not in p['attributes']:
                continue
            pos = accessor_data(js, binc, p['attributes']['POSITION'])
            ax = accessor_data(js, binc, p['attributes']['_AXLE'])
            maxr = 0.0
            for (x, y, z), (a, b, c) in zip(pos, ax):
                maxr = max(maxr, math.hypot(y - b, z - c))
            report.append({'node': n.get('name'), 'verts': len(pos), 'max_radius_from_axle': round(maxr, 4),
                           'distinct_axles': len({tuple(round(v, 3) for v in a) for a in ax})})
    return report
