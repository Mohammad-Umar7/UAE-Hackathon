"""Generated image textures (numpy -> PNG via bpy.data.images).

All textures are produced procedurally and deterministically, written to
pipeline/build/raw/equipment/textures/ and embedded into the GLBs by the exporter.
Pixel arrays are float32 HxWx4, sRGB encoded, row 0 = bottom (v = 0), like Blender.
"""
import math
import os

import bpy
import numpy as np

# ----------------------------------------------------------------- palettes
# Light lens palette: 4x4 blocks of 16 px in a 64 px texture (u right, v up).
LIGHT_COLORS = {
    'warm': (1.00, 0.93, 0.78), 'cool': (0.90, 0.95, 1.00), 'red': (1.00, 0.10, 0.06),
    'amber': (1.00, 0.55, 0.02), 'blue': (0.16, 0.36, 1.00), 'green': (0.12, 1.00, 0.38),
    'yellow': (1.00, 0.86, 0.22), 'white': (1.00, 1.00, 1.00), 'tail': (0.80, 0.03, 0.03),
    'orange': (1.00, 0.42, 0.04), 'sodium': (1.00, 0.72, 0.38), 'dim': (0.35, 0.35, 0.33),
}
LIGHT_ORDER = ['warm', 'cool', 'red', 'amber', 'blue', 'green', 'yellow', 'white',
               'tail', 'orange', 'sodium', 'dim']

LUGGAGE_COLORS = [
    (0.08, 0.08, 0.09), (0.10, 0.14, 0.30), (0.22, 0.23, 0.25), (0.62, 0.08, 0.08),
    (0.38, 0.06, 0.10), (0.70, 0.72, 0.74), (0.05, 0.40, 0.42), (0.33, 0.17, 0.45),
    (0.35, 0.36, 0.18), (0.66, 0.52, 0.34), (0.85, 0.38, 0.08), (0.85, 0.45, 0.58),
    (0.10, 0.28, 0.70), (0.12, 0.42, 0.22), (0.35, 0.22, 0.13), (0.85, 0.70, 0.12),
]


def palette_uv(index, grid=4):
    col = index % grid
    row = index // grid
    return ((col + 0.5) / grid, (row + 0.5) / grid)


def light_uv(name):
    return palette_uv(LIGHT_ORDER.index(name))


# Decal atlas regions (u0, v0, u1, v1) in UV space
DECAL = {
    'follow_me': (0.0, 0.75, 1.0, 1.0),
    'checker': (0.0, 0.625, 1.0, 0.75),       # 16 x 2 squares
    'wheelchair': (0.0, 0.375, 0.25, 0.625),
    'jet_a1': (0.25, 0.5, 0.75, 0.625),
    'terminal': (0.25, 0.375, 0.75, 0.5),
    'chevron': (0.75, 0.375, 1.0, 0.625),
    'fire_rescue': (0.0, 0.25, 1.0, 0.375),
    'airside': (0.0, 0.125, 0.5, 0.25),
    'no_smoking': (0.5, 0.125, 0.75, 0.25),
    'stop': (0.75, 0.125, 1.0, 0.25),
    'white': (0.75, 0.0, 0.875, 0.125),
    'yellow_solid': (0.875, 0.0, 1.0, 0.125),
}


def srgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


# -------------------------------------------------------------------- utils
def _save(arr, path):
    h, w = arr.shape[:2]
    name = os.path.basename(path)
    img = bpy.data.images.new("__tmp_" + name, w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def _down(a, ss):
    if ss == 1:
        return a
    h, w = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(h, ss, w, ss, *a.shape[2:]).mean(axis=(1, 3))


def _grid(w, h, ss=1):
    ys, xs = np.mgrid[0:h * ss, 0:w * ss].astype(np.float32)
    return (xs + 0.5) / ss, (ys + 0.5) / ss


def _value_noise(w, h, cell, seed, octaves=3):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp = 1.0
    tot = 0.0
    for o in range(octaves):
        c = max(1, int(cell / (2 ** o)))
        gw, gh = w // c + 2, h // c + 2
        g = rng.random((gh, gw)).astype(np.float32)
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        fx, fy = xs / c, ys / c
        x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
        tx, ty = fx - x0, fy - y0
        tx = tx * tx * (3 - 2 * tx)
        ty = ty * ty * (3 - 2 * ty)
        # wrap for tiling
        gx0, gx1 = x0 % (w // c), (x0 + 1) % (w // c)
        gy0, gy1 = y0 % (h // c), (y0 + 1) % (h // c)
        a = g[gy0, gx0] * (1 - tx) + g[gy0, gx1] * tx
        b = g[gy1, gx0] * (1 - tx) + g[gy1, gx1] * tx
        out += amp * (a * (1 - ty) + b * ty)
        tot += amp
        amp *= 0.5
    return out / tot


def _rgba(rgb, alpha=1.0):
    rgb = np.asarray(rgb, np.float32)
    a = np.ones(rgb.shape[:2] + (1,), np.float32) * alpha
    return np.concatenate([rgb, a], axis=2)


# --------------------------------------------------------------- text raster
def text_mask(text, w, h, margin=0.1, bold=0.0, ss=4, align='CENTER', scale_px=None):
    """Rasterise Blender's built-in font into an anti-aliased (h, w) mask."""
    cu = bpy.data.curves.new("__txt", 'FONT')
    cu.body = text
    cu.align_x = align
    cu.align_y = 'CENTER'
    cu.offset = bold
    cu.resolution_u = 6
    ob = bpy.data.objects.new("__txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    co = np.array([v.co[:2] for v in me.vertices], np.float32)
    tris = np.array([lt.vertices[:] for lt in me.loop_triangles], np.int64)
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    mask = np.zeros((h * ss, w * ss), np.float32)
    if len(tris) == 0:
        return _down(mask, ss)
    mn, mx = co.min(0), co.max(0)
    size = mx - mn
    avail = np.array([w * (1 - 2 * margin), h * (1 - 2 * margin)], np.float32)
    if scale_px is not None:          # uniform glyph size (labels): only shrink if too wide
        s = float(min(avail[0] / size[0], scale_px))
    else:
        s = float(min(avail[0] / size[0], avail[1] / size[1]))
    s *= ss
    off = np.array([w * ss / 2, h * ss / 2], np.float32) - (mn + size / 2) * s
    if align == 'LEFT':
        off[0] = w * ss * margin - mn[0] * s
    P = co * s + off
    for t in tris:
        a, b, c = P[t[0]], P[t[1]], P[t[2]]
        x0 = int(max(0, math.floor(min(a[0], b[0], c[0]))))
        x1 = int(min(w * ss - 1, math.ceil(max(a[0], b[0], c[0]))))
        y0 = int(max(0, math.floor(min(a[1], b[1], c[1]))))
        y1 = int(min(h * ss - 1, math.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1].astype(np.float32)
        xs += 0.5
        ys += 0.5
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        l3 = 1 - l1 - l2
        inside = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
        sub = mask[y0:y1 + 1, x0:x1 + 1]
        sub[inside] = 1.0
    return _down(mask, ss)


# ----------------------------------------------------------------- textures
def tex_hazard(path, size=256):
    ss = 4
    x, y = _grid(size, size, ss)
    period = size / 4.0
    s = ((x + y) / period) % 1.0
    m = _down((s < 0.5).astype(np.float32), ss)[..., None]
    yel = np.array(srgb('#F5B800'), np.float32)
    blk = np.array(srgb('#151515'), np.float32)
    n = _value_noise(size, size, 32, 7)[..., None]
    rgb = (yel * m + blk * (1 - m)) * (0.93 + 0.07 * n)
    _save(_rgba(rgb), path)


def tex_palette(path, colors, size=64, grid=4):
    arr = np.zeros((size, size, 4), np.float32)
    b = size // grid
    for i in range(grid * grid):
        col = colors[i] if i < len(colors) else (0.5, 0.5, 0.5)
        cx, cy = i % grid, i // grid
        arr[cy * b:(cy + 1) * b, cx * b:(cx + 1) * b, :3] = col
        arr[cy * b:(cy + 1) * b, cx * b:(cx + 1) * b, 3] = 1.0
    _save(arr, path)


def tex_lights(path):
    tex_palette(path, [LIGHT_COLORS[k] for k in LIGHT_ORDER])


def tex_luggage(path):
    tex_palette(path, LUGGAGE_COLORS)


def _sd_capsule(x, y, a, b, r):
    ax, ay = a
    bx, by = b
    pax, pay = x - ax, y - ay
    bax, bay = bx - ax, by - ay
    h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
    return np.hypot(pax - bax * h, pay - bay * h) - r


def _wheelchair(w, h, ss=4):
    x, y = _grid(w, h, ss)
    x = x / w
    y = y / h
    d = np.hypot(x - 0.535, y - 0.80) - 0.072
    d = np.minimum(d, _sd_capsule(x, y, (0.50, 0.68), (0.46, 0.45), 0.040))
    d = np.minimum(d, _sd_capsule(x, y, (0.49, 0.60), (0.65, 0.60), 0.030))
    d = np.minimum(d, _sd_capsule(x, y, (0.46, 0.45), (0.68, 0.45), 0.040))
    d = np.minimum(d, _sd_capsule(x, y, (0.68, 0.45), (0.76, 0.22), 0.036))
    d = np.minimum(d, _sd_capsule(x, y, (0.76, 0.22), (0.83, 0.22), 0.030))
    r = np.hypot(x - 0.42, y - 0.34)
    ang = np.degrees(np.arctan2(y - 0.34, x - 0.42))
    ring = np.abs(r - 0.20) - 0.028
    gap = (ang > 8) & (ang < 80)
    ring = np.where(gap, 1.0, ring)
    d = np.minimum(d, ring)
    return _down((d < 0).astype(np.float32), ss)


def tex_decals(path, size=1024):
    W = H = size
    arr = np.zeros((H, W, 4), np.float32)

    def region(key):
        u0, v0, u1, v1 = DECAL[key]
        return int(u0 * W), int(v0 * H), int(u1 * W), int(v1 * H)

    def fill(key, rgb, alpha=1.0):
        x0, y0, x1, y1 = region(key)
        arr[y0:y1, x0:x1, :3] = rgb
        arr[y0:y1, x0:x1, 3] = alpha

    def put_mask(key, mask, rgb, inset=0):
        x0, y0, x1, y1 = region(key)
        sub = arr[y0 + inset:y1 - inset, x0 + inset:x1 - inset]
        m = mask[..., None]
        sub[..., :3] = sub[..., :3] * (1 - m) + np.array(rgb, np.float32) * m
        sub[..., 3:4] = np.maximum(sub[..., 3:4], m)

    yellow = srgb('#FFC400')
    black = srgb('#111111')
    white = (1.0, 1.0, 1.0)
    # FOLLOW ME: yellow board, black border + text
    x0, y0, x1, y1 = region('follow_me')
    fill('follow_me', yellow)
    bw = 10
    arr[y0:y0 + bw, x0:x1, :3] = black
    arr[y1 - bw:y1, x0:x1, :3] = black
    arr[y0:y1, x0:x0 + bw, :3] = black
    arr[y0:y1, x1 - bw:x1, :3] = black
    put_mask('follow_me', text_mask("FOLLOW ME", x1 - x0 - 2 * bw, y1 - y0 - 2 * bw, 0.1, 0.035), black, bw)
    # checker 16 x 2
    x0, y0, x1, y1 = region('checker')
    sq = (x1 - x0) // 16
    for i in range(16):
        for j in range(2):
            c = yellow if (i + j) % 2 == 0 else black
            arr[y0 + j * sq:y0 + (j + 1) * sq, x0 + i * sq:x0 + (i + 1) * sq, :3] = c
    arr[y0:y1, x0:x1, 3] = 1.0
    # wheelchair (ISA) white on blue
    x0, y0, x1, y1 = region('wheelchair')
    fill('wheelchair', srgb('#0057A8'))
    put_mask('wheelchair', _wheelchair(x1 - x0, y1 - y0), white)
    # JET A-1 grade marking: black band, white text
    x0, y0, x1, y1 = region('jet_a1')
    fill('jet_a1', black)
    put_mask('jet_a1', text_mask("JET A-1", x1 - x0, y1 - y0, 0.14, 0.03), white)
    # destination display: amber on black
    x0, y0, x1, y1 = region('terminal')
    fill('terminal', srgb('#0A0A0A'))
    put_mask('terminal', text_mask("TERMINAL", x1 - x0, y1 - y0, 0.18, 0.0), srgb('#FFA21F'))
    # red / white chevrons (rear of emergency vehicles)
    x0, y0, x1, y1 = region('chevron')
    xs, ys = _grid(x1 - x0, y1 - y0, 4)
    s = ((np.abs(xs - (x1 - x0) / 2) + ys) / ((x1 - x0) / 4.0)) % 1.0
    m = _down((s < 0.5).astype(np.float32), 4)[..., None]
    arr[y0:y1, x0:x1, :3] = np.array(srgb('#D0101A'), np.float32) * m + np.array(white, np.float32) * (1 - m)
    arr[y0:y1, x0:x1, 3] = 1.0
    # AIRPORT FIRE & RESCUE: white text, transparent background (alpha masked decal)
    x0, y0, x1, y1 = region('fire_rescue')
    put_mask('fire_rescue', text_mask("AIRPORT RESCUE & FIREFIGHTING", x1 - x0, y1 - y0, 0.12, 0.02), white)
    # AIRSIDE OPERATIONS: dark text, transparent
    x0, y0, x1, y1 = region('airside')
    put_mask('airside', text_mask("AIRSIDE OPS", x1 - x0, y1 - y0, 0.12, 0.02), srgb('#1B2A44'))
    # NO SMOKING roundel
    x0, y0, x1, y1 = region('no_smoking')
    xs, ys = _grid(x1 - x0, y1 - y0, 4)
    cx, cy, R = (x1 - x0) / 2, (y1 - y0) / 2, (y1 - y0) * 0.45
    r = np.hypot(xs - cx, ys - cy)
    ringm = (r < R).astype(np.float32)
    bar = (np.abs((xs - cx) + (ys - cy)) < R * 0.16 * 1.41) & (r < R * 0.82)
    redm = ((r > R * 0.82) | bar) & (r < R)
    sub = arr[y0:y1, x0:x1]
    rm = _down(redm.astype(np.float32), 4)[..., None]
    wm = _down(ringm, 4)[..., None]
    sub[..., :3] = np.array(white, np.float32) * wm * (1 - rm) + np.array(srgb('#D0101A'), np.float32) * rm
    sub[..., 3:4] = wm
    fill('white', (0.96, 0.96, 0.95))
    fill('yellow_solid', srgb('#FFC400'))
    # STOP (red board, white text)
    x0, y0, x1, y1 = region('stop')
    fill('stop', srgb('#C8101A'))
    put_mask('stop', text_mask("STOP", x1 - x0, y1 - y0, 0.18, 0.03), white)
    _save(arr, path)


def tex_signface(path, w=512, h=232, text=None, style='location'):
    """Default (neutral) sign face, or a sample text face for previews."""
    if style == 'location':
        bg, fg = srgb('#0D0D0D'), srgb('#FFCC00')
    elif style == 'direction':
        bg, fg = srgb('#FFCC00'), srgb('#0D0D0D')
    else:  # mandatory
        bg, fg = srgb('#C4111B'), (1, 1, 1)
    arr = np.zeros((h, w, 4), np.float32)
    arr[..., :3] = bg
    arr[..., 3] = 1
    b = max(4, h // 26)
    arr[b:b * 2, b:w - b, :3] = fg
    arr[h - 2 * b:h - b, b:w - b, :3] = fg
    arr[b:h - b, b:2 * b, :3] = fg
    arr[b:h - b, w - 2 * b:w - b, :3] = fg
    if text:
        m = text_mask(text, w - 6 * b, h - 6 * b, 0.12, 0.02)[..., None]
        sub = arr[3 * b:h - 3 * b, 3 * b:w - 3 * b]
        sub[..., :3] = sub[..., :3] * (1 - m) + np.array(fg, np.float32) * m
    _save(arr, path)


def tex_frond(path, w=512, h=128, seed=3):
    """Date palm frond wing: u along the frond (base->tip), v across (rachis->edge)."""
    ss = 2
    W, Hh = w * ss, h * ss
    rng = np.random.default_rng(seed)
    mask = np.zeros((Hh, W), np.float32)
    col = np.zeros((Hh, W, 3), np.float32)
    ys, xs = np.mgrid[0:Hh, 0:W].astype(np.float32)
    u = (xs + 0.5) / W
    v = (ys + 0.5) / Hh
    n_leaf = 46
    base_g = np.array(srgb('#5E7046'), np.float32)
    for i in range(n_leaf):
        u0 = 0.12 + 0.86 * i / n_leaf + rng.uniform(-0.006, 0.006)
        # leaflet length profile: short at base and tip
        t = min(1.0, max(0.0, (u0 - 0.12) / 0.86))
        L = 0.55 + 0.45 * math.sin(math.pi * min(1.0, t * 1.15) ** 0.8)
        L *= rng.uniform(0.85, 1.0)
        du = 0.10 + 0.04 * rng.random()
        u1 = u0 + du * L
        v1 = 0.98 * L
        # distance to the segment (u0,0)->(u1,v1) in pixel space
        ax, ay = u0 * W, 0.0
        bx, by = u1 * W, v1 * Hh
        pax, pay = xs - ax, ys - ay
        bax, bay = bx - ax, by - ay
        hh = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
        d = np.hypot(pax - bax * hh, pay - bay * hh)
        width = (5.5 * ss) * (1.0 - 0.75 * hh)
        m = (d < width).astype(np.float32)
        shade = rng.uniform(0.82, 1.12)
        c = base_g * shade * (0.85 + 0.25 * hh)[..., None]
        sel = m > mask
        col[sel] = c[sel]
        mask = np.maximum(mask, m)
    # rachis band along v ~ 0
    rach = (v < 0.045).astype(np.float32) * (u < 0.995)
    col[rach > 0] = np.array(srgb('#9C8F5E'), np.float32)
    mask = np.maximum(mask, rach)
    # base spines region: thin spines
    rgb = _down(col, ss)
    a = _down(mask, ss)
    # avoid dark fringes: premultiplied-ish fill of colour into transparent texels
    rgb = np.where(a[..., None] > 0.01, rgb / np.maximum(a[..., None], 1e-3), base_g)
    rgb = np.clip(rgb, 0, 1)
    _save(np.concatenate([rgb, a[..., None]], axis=2), path)


def tex_trunk(path_c, path_n, w=256, h=512):
    """Date palm trunk with diamond leaf-base (boot) pattern, tiling in u and v."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    nu, nv = 6, 9  # bases around / along
    fu = xs / w * nu
    fv = ys / h * nv
    row = np.floor(fv)
    fu2 = fu + 0.5 * (row % 2)
    cu = fu2 - np.floor(fu2) - 0.5
    cv = fv - row - 0.5
    # rounded diamond (shield) shape
    d = np.abs(cu) * 1.05 + np.abs(cv + 0.12) * 0.95
    height = np.clip(1.0 - d * 1.45, 0, 1) ** 0.35
    # scar lip at the top of each base
    lip = np.exp(-((cv - 0.30) ** 2) / 0.004) * (np.abs(cu) < 0.42)
    noise = _value_noise(w, h, 16, 11, 4)
    fib = _value_noise(w, h, 4, 5, 2)
    hgt = np.clip(height * 0.9 + lip * 0.35 + noise * 0.10 + fib * 0.06, 0, 1)
    light = np.array(srgb('#9A8463'), np.float32)
    dark = np.array(srgb('#2E2318'), np.float32)
    grey = np.array(srgb('#9C9284'), np.float32)
    k = hgt[..., None]
    rgb = dark * (1 - k) + light * k
    rgb = rgb * (1 - 0.35 * (noise[..., None])) + grey * 0.35 * noise[..., None]
    rgb *= (0.9 + 0.2 * fib[..., None])
    _save(_rgba(np.clip(rgb, 0, 1)), path_c)
    # normal map from height (tileable gradients)
    s = 4.0
    dx = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) * s
    dy = (np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)) * s
    n = np.stack([-dx, -dy, np.ones_like(dx)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    _save(_rgba(n * 0.5 + 0.5), path_n)


def _leaves(rng, W, H, n, base, rmin, rmax, region=None, wrap=True):
    rgb = np.zeros((H, W, 3), np.float32)
    a = np.zeros((H, W), np.float32)
    for i in range(n):
        if region is None:
            cx, cy = rng.uniform(0, W), rng.uniform(0, H)
            rr = 0.0
        else:
            rr = (rng.random() ** 0.6) * 0.96
            th = rng.uniform(0, TAU_)
            cx, cy = W / 2 + rr * math.cos(th) * W / 2, H / 2 + rr * math.sin(th) * H / 2
        r = rng.uniform(rmin, rmax) * (1.1 - 0.4 * rr)
        ang = rng.uniform(0, math.pi)
        x0, x1 = int(cx - 9), int(cx + 10)
        y0, y1 = int(cy - 9), int(cy + 10)
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        dx, dy = xx - cx, yy - cy
        ca, sa = math.cos(ang), math.sin(ang)
        px = dx * ca + dy * sa
        py = -dx * sa + dy * ca
        m = (px / r) ** 2 + (py / (r * 0.45)) ** 2 < 1
        light = (0.60 + 0.70 * (1.0 - rr) * rng.uniform(0.55, 1.0)) * (0.85 + 0.30 * (py / r))
        hue = np.array([rng.uniform(0.85, 1.15), rng.uniform(0.95, 1.08), rng.uniform(0.65, 1.0)], np.float32)
        c = np.clip(base * light[..., None] * hue, 0, 1)
        if wrap:
            iy, ix = (yy.astype(int) % H)[m], (xx.astype(int) % W)[m]
        else:
            ok = (yy >= 0) & (yy < H) & (xx >= 0) & (xx < W) & m
            iy, ix = yy.astype(int)[ok], xx.astype(int)[ok]
            c = np.clip(base * light[..., None] * hue, 0, 1)[ok]
            rgb[iy, ix] = c
            a[iy, ix] = 1.0
            continue
        rgb[iy, ix] = c[m]
        a[iy, ix] = 1.0
    return rgb, a


def tex_foliage(path, seed=9):
    """512 x 256: left half = opaque dense leaf surface (bush cores),
    right half = round bush card with alpha (ragged leafy edge)."""
    rng = np.random.default_rng(seed)
    S = 256
    base = np.array(srgb('#3B5A26'), np.float32)
    left, _ = _leaves(rng, S, S, 4200, base * 0.62, 2.6, 5.0)
    bg = np.zeros((S, S, 3), np.float32) + base * 0.25
    left = np.where(left.sum(axis=2, keepdims=True) > 0, left, bg)
    right, ar = _leaves(rng, S, S, 4200, base, 3.2, 7.0, region=True, wrap=False)
    yy0, xx0 = np.mgrid[0:S, 0:S].astype(np.float32)
    rc = np.hypot(xx0 - S / 2, yy0 - S / 2) / (S / 2)
    core = (rc < 0.30) & (ar < 1)
    right[core] = base * 0.45
    ar[core] = 1.0
    right = np.where(ar[..., None] > 0, right, base * 0.6)
    rgb = np.concatenate([left, right], axis=1)
    a = np.concatenate([np.ones((S, S), np.float32), ar], axis=1)
    _save(np.concatenate([rgb, a[..., None]], axis=2), path)


TAU_ = 2 * math.pi


def tex_fence(path, size=128):
    ss = 4
    x, y = _grid(size, size, ss)
    p = size / 8.0
    a = ((x + y) / p) % 1.0
    b = ((x - y) / p) % 1.0
    t = 0.13
    m = ((a < t) | (a > 1 - t) | (b < t) | (b > 1 - t)).astype(np.float32)
    m = _down(m, ss)
    m = np.clip(m * 1.25, 0, 1)
    rgb = np.ones((size, size, 3), np.float32) * np.array(srgb('#8E9499'), np.float32)
    _save(np.concatenate([rgb, m[..., None]], axis=2), path)


def tex_concrete_dummy(path):
    pass


ALL = {
    'T_Hazard.png': tex_hazard,
    'T_Lights.png': tex_lights,
    'T_Luggage.png': tex_luggage,
    'T_Decals.png': tex_decals,
    'T_SignFace.png': lambda p: tex_signface(p, style='location'),
    'T_SignFaceBack.png': lambda p: tex_signface(p, style='location'),
    'T_Frond.png': tex_frond,
    'T_Foliage.png': tex_foliage,
    'T_Fence.png': tex_fence,
}


def ensure_textures(tex_dir, force=False):
    os.makedirs(tex_dir, exist_ok=True)
    for name, fn in ALL.items():
        p = os.path.join(tex_dir, name)
        if force or not os.path.exists(p):
            fn(p)
    pc = os.path.join(tex_dir, 'T_Trunk.png')
    pn = os.path.join(tex_dir, 'T_Trunk_N.png')
    if force or not (os.path.exists(pc) and os.path.exists(pn)):
        tex_trunk(pc, pn)
