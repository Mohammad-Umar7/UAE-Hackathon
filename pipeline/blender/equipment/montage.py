"""Tile preview PNGs into grids (used for the kit overview sheet and for review).

  blender --background --factory-startup --python pipeline/blender/equipment/montage.py -- \
      --out pipeline/previews/equipment/kit_grid.png --cols 6 --cell 480x270 [--label] files...
"""
import argparse
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def load(path):
    img = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def resize(a, w, h):
    H, W = a.shape[:2]
    ys = (np.arange(h) + 0.5) * H / h - 0.5
    xs = (np.arange(w) + 0.5) * W / w - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, H - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, W - 1)
    y1 = np.clip(y0 + 1, 0, H - 1)
    x1 = np.clip(x0 + 1, 0, W - 1)
    fy = (ys - y0)[:, None, None]
    fx = (xs - x0)[None, :, None]
    # box prefilter for strong downscales
    k = max(1, int(W / w / 1.5))
    if k > 1:
        pad = np.pad(a, ((0, k), (0, k), (0, 0)), mode='edge')
        acc = np.zeros_like(a)
        for dy in range(k):
            for dx in range(k):
                acc += pad[dy:dy + H, dx:dx + W]
        a = acc / (k * k)
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return top * (1 - fy) + bot * fy


def label_strip(text, w, h):
    from eqlib.textures import text_mask
    m = text_mask(text, w, h, margin=0.12, bold=0.0, scale_px=h * 0.62)
    out = np.zeros((h, w, 4), np.float32)
    out[..., :3] = 0.08
    out[..., 3] = 1
    out[..., :3] += m[..., None] * 0.85
    return out


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--cols', type=int, default=2)
    ap.add_argument('--cell', default='640x360')
    ap.add_argument('--label', action='store_true')
    ap.add_argument('files', nargs='+')
    a = ap.parse_args(argv)
    cw, ch = (int(v) for v in a.cell.split('x'))
    lh = int(ch * 0.11) if a.label else 0
    n = len(a.files)
    rows = (n + a.cols - 1) // a.cols
    W, H = a.cols * cw, rows * (ch + lh)
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[..., :3] = 0.06
    canvas[..., 3] = 1
    for i, f in enumerate(a.files):
        r, c = i // a.cols, i % a.cols
        img = resize(load(f), cw, ch)
        # Blender rows are bottom-up: row 0 of the grid at the top
        y_top = H - (r + 1) * (ch + lh)
        canvas[y_top + lh:y_top + lh + ch, c * cw:(c + 1) * cw] = img
        if lh:
            name = os.path.splitext(os.path.basename(f))[0].replace('_threequarter', '')
            canvas[y_top:y_top + lh, c * cw:(c + 1) * cw] = label_strip(name, cw, lh)
    out = bpy.data.images.new('montage', W, H, alpha=True)
    out.pixels.foreach_set(canvas.ravel())
    out.filepath_raw = os.path.abspath(a.out)
    out.file_format = 'PNG'
    out.save()
    print('[montage]', a.out, W, H)


if __name__ == '__main__':
    main()
