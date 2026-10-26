/**
 * Texture helpers for the digital twin.
 * - Poly Haven CC0 pavement/ground sets (public/textures) are loaded once and "neutralised"
 *   (greyscale, mean-normalised) so the material colour sets the albedo of each surface.
 * - Facade, decal and marking textures are drawn procedurally on canvases (no external assets).
 */

import * as THREE from "three";
import { AIRLINES } from "@/core/airlines";

const loader = new THREE.ImageLoader();
const cache = new Map<string, Promise<THREE.Texture>>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: false })!];
}

function finish(t: THREE.Texture, srgb: boolean, repeat = true): THREE.Texture {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Greyscale + mean-normalised diffuse map (mean ≈ `mean`, contrast scaled by `contrast`). */
export function neutralMap(url: string, mean = 0.82, contrast = 1.0): Promise<THREE.Texture> {
  const key = `n:${url}:${mean}:${contrast}`;
  if (!cache.has(key)) {
    cache.set(key, loader.loadAsync(url).then((img) => {
      const [c, g] = canvas(img.width, img.height);
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const avg = sum / (px.length / 4) || 1;
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const v = Math.max(0, Math.min(255, 255 * (mean + ((l - avg) / 255) * contrast)));
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      g.putImageData(d, 0, 0);
      return finish(new THREE.CanvasTexture(c), true);
    }));
  }
  return cache.get(key)!;
}

export function dataMap(url: string): Promise<THREE.Texture> {
  const key = `d:${url}`;
  if (!cache.has(key)) cache.set(key, new THREE.TextureLoader().loadAsync(url).then((t) => finish(t, false)));
  return cache.get(key)!;
}

export interface SurfaceSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

export async function surfaceSet(name: string, mean = 0.82, contrast = 1.0): Promise<SurfaceSet> {
  const base = `/textures/${name}`;
  const [map, normalMap, roughnessMap] = await Promise.all([
    neutralMap(`${base}/diff.jpg`, mean, contrast), dataMap(`${base}/nor.jpg`), dataMap(`${base}/rough.jpg`),
  ]);
  return { map, normalMap, roughnessMap };
}

// ------------------------------------------------------------------ facades

/**
 * Curtain-wall module (4 m wide × 4.2 m storey): mullions, transoms, spandrel band and glass.
 * Returns colour + emissive maps; the emissive map lights the glazing at night.
 */
export function facadeTextures(kind: "glass" | "concrete" | "metal"): { map: THREE.Texture; emissive: THREE.Texture } {
  const key = `facade:${kind}`;
  const hit = facadeCache.get(key);
  if (hit) return hit;
  const S = 256;
  const [c, g] = canvas(S, S);
  const [ce, ge] = canvas(S, S);
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, S, S);
  if (kind === "glass") {
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, "#5d7286");
    grad.addColorStop(0.55, "#33475a");
    grad.addColorStop(1, "#24313e");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#d9dde1"; // mullions
    for (const x of [0, S / 2]) g.fillRect(x, 0, 6, S);
    g.fillRect(0, 0, S, 10); // slab edge
    g.fillStyle = "#c3c8cd";
    g.fillRect(0, S * 0.5 - 2, S, 4); // transom
    const eg = ge.createLinearGradient(0, 0, 0, S);
    eg.addColorStop(0, "#5c4a2c");
    eg.addColorStop(1, "#c79a55");
    ge.fillStyle = eg;
    ge.fillRect(6, 10, S / 2 - 8, S - 12);
    ge.fillRect(S / 2 + 6, 10, S / 2 - 8, S - 12);
  } else if (kind === "metal") {
    g.fillStyle = "#c9cdd1";
    g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 16) {
      g.fillStyle = "#aeb3b8";
      g.fillRect(x, 0, 3, S);
      g.fillStyle = "#e1e4e7";
      g.fillRect(x + 3, 0, 2, S);
    }
  } else {
    g.fillStyle = "#d8d2c6";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#3a4652";
    g.fillRect(S * 0.12, S * 0.3, S * 0.76, S * 0.42);
    g.fillStyle = "#c7c0b2";
    g.fillRect(0, 0, S, 8);
    ge.fillStyle = "#b8904f";
    ge.fillRect(S * 0.12, S * 0.3, S * 0.76, S * 0.42);
  }
  const out = { map: finish(new THREE.CanvasTexture(c), true), emissive: finish(new THREE.CanvasTexture(ce), true) };
  facadeCache.set(key, out);
  return out;
}
const facadeCache = new Map<string, { map: THREE.Texture; emissive: THREE.Texture }>();

// ------------------------------------------------------------------ aircraft decals

export const DECAL_ROWS = 16;
export const AIRLINE_ROW: Record<string, number> = Object.fromEntries(Object.keys(AIRLINES).map((k, i) => [k, i]));

/** Fuselage titles: one 1024×128 row per airline, top row first (glTF UV convention, flipY = false). */
export function titleAtlas(): THREE.Texture {
  if (titleTex) return titleTex;
  const W = 1024, H = 128;
  const [c, g] = canvas(W, H * DECAL_ROWS);
  for (const [code, a] of Object.entries(AIRLINES)) {
    const row = AIRLINE_ROW[code];
    const y = row * H;
    const name = a.name.toUpperCase();
    g.fillStyle = a.livery.title;
    g.textAlign = "center";
    g.textBaseline = "middle";
    let size = 92;
    g.font = `700 ${size}px "Inter Variable", Inter, "Segoe UI", Arial, sans-serif`;
    // letter-spaced, fit to the strip
    const spacing = 0.12;
    const measure = () => g.measureText(name).width + spacing * size * (name.length - 1);
    while (measure() > W * 0.94 && size > 30) { size -= 4; g.font = `700 ${size}px "Inter Variable", Inter, "Segoe UI", Arial, sans-serif`; }
    let x = W / 2 - measure() / 2;
    g.textAlign = "left";
    for (const ch of name) {
      g.fillText(ch, x, y + H / 2 + 4);
      x += g.measureText(ch).width + spacing * size;
    }
  }
  titleTex = finish(new THREE.CanvasTexture(c), true, false);
  titleTex.flipY = false;
  titleTex.needsUpdate = true;
  return titleTex;
}
let titleTex: THREE.Texture | null = null;

/** Tail emblems: 4×4 grid of 256 px cells, one per airline (original abstract symbols). */
export function logoAtlas(): THREE.Texture {
  if (logoTex) return logoTex;
  const C = 256;
  const [c, g] = canvas(C * 4, C * 4);
  for (const [code, a] of Object.entries(AIRLINES)) {
    const i = AIRLINE_ROW[code];
    g.save();
    g.translate((i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2);
    drawEmblem(g, code, a.livery.tailAccent, a.livery.top, C * 0.42);
    g.restore();
  }
  logoTex = finish(new THREE.CanvasTexture(c), true, false);
  logoTex.flipY = false;
  logoTex.needsUpdate = true;
  return logoTex;
}
let logoTex: THREE.Texture | null = null;

function drawEmblem(g: CanvasRenderingContext2D, code: string, accent: string, light: string, r: number) {
  g.fillStyle = accent;
  g.strokeStyle = accent;
  g.lineJoin = "round";
  g.lineCap = "round";
  const star = (n: number, ro: number, ri: number, rot = -Math.PI / 2) => {
    g.beginPath();
    for (let k = 0; k < n * 2; k++) {
      const rr = k % 2 ? ri : ro;
      const a = rot + (k * Math.PI) / n;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  };
  switch (code) {
    case "SQR": { // stylised falcon wing sweep
      g.beginPath();
      g.moveTo(-r * 0.9, r * 0.55);
      g.quadraticCurveTo(-r * 0.1, -r * 0.2, r * 0.95, -r * 0.85);
      g.quadraticCurveTo(r * 0.35, -r * 0.05, r * 0.2, r * 0.75);
      g.quadraticCurveTo(-r * 0.2, r * 0.25, -r * 0.9, r * 0.55);
      g.fill();
      g.fillStyle = light;
      g.beginPath();
      g.arc(r * 0.42, -r * 0.42, r * 0.09, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "MJL": star(8, r, r * 0.62); g.fillStyle = light; star(8, r * 0.42, r * 0.26, -Math.PI / 2 + Math.PI / 8); break;
    case "DNE": {
      g.lineWidth = r * 0.16;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        const y0 = -r * 0.45 + k * r * 0.42;
        g.moveTo(-r * 0.9, y0 + r * 0.2);
        g.bezierCurveTo(-r * 0.4, y0 - r * 0.3, r * 0.2, y0 + r * 0.45, r * 0.9, y0 - r * 0.05);
        g.stroke();
      }
      break;
    }
    case "SHR": {
      g.beginPath(); g.arc(0, -r * 0.1, r * 0.48, Math.PI, 0); g.fill();
      g.beginPath(); g.moveTo(-r, r * 0.55); g.quadraticCurveTo(0, r * 0.05, r, r * 0.55); g.lineTo(r, r * 0.8); g.lineTo(-r, r * 0.8); g.fill();
      break;
    }
    case "GFL": {
      g.lineWidth = r * 0.2;
      g.beginPath(); g.arc(0, 0, r * 0.75, Math.PI * 0.15, Math.PI * 1.55); g.stroke();
      g.beginPath(); g.arc(0, 0, r * 0.32, Math.PI * 0.15, Math.PI * 1.55); g.stroke();
      break;
    }
    case "NJC": star(5, r, r * 0.42); break;
    case "FCX": {
      g.beginPath();
      g.moveTo(0, -r); g.lineTo(r * 0.75, r * 0.75); g.lineTo(0, r * 0.35); g.lineTo(-r * 0.75, r * 0.75); g.closePath(); g.fill();
      break;
    }
    case "MPX": {
      g.lineWidth = r * 0.11;
      g.beginPath(); g.arc(0, 0, r * 0.85, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.ellipse(0, 0, r * 0.38, r * 0.85, 0, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.85, 0); g.lineTo(r * 0.85, 0); g.stroke();
      break;
    }
    case "BRL": {
      g.lineWidth = r * 0.14;
      for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(0, r * 0.9, r * (0.55 + k * 0.32), Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
      break;
    }
    case "DCW": {
      g.beginPath();
      g.moveTo(-r * 0.95, r * 0.25);
      g.quadraticCurveTo(0, -r * 0.95, r * 0.95, -r * 0.35);
      g.quadraticCurveTo(r * 0.1, -r * 0.2, -r * 0.2, r * 0.6);
      g.closePath();
      g.fill();
      break;
    }
    default: { // SLK and any new carrier: silk ribbon
      g.lineWidth = r * 0.22;
      g.beginPath();
      g.moveTo(-r * 0.9, r * 0.5);
      g.bezierCurveTo(-r * 0.3, -r * 0.9, r * 0.3, r * 0.9, r * 0.9, -r * 0.5);
      g.stroke();
    }
  }
}

// ------------------------------------------------------------------ misc

/** Soft radial sprite used for ground light pools (night apron lighting). */
export function poolTexture(): THREE.Texture {
  if (poolTex) return poolTex;
  const S = 128;
  const [c, g] = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  poolTex = finish(new THREE.CanvasTexture(c), true, false);
  return poolTex;
}
let poolTex: THREE.Texture | null = null;
