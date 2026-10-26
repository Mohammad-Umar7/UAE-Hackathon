// Optimise raw Blender GLB exports for the browser (glTF-Transform: dedup, prune, weld, quantize, meshopt).
// Usage: node pipeline/optimize_assets.mjs [category ...]   (categories: aircraft equipment airports)
// Reads pipeline/build/raw/<category>/*.glb and writes frontend/public/assets/<category>/*.glb

import { readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fe = path.join(root, "frontend", "node_modules");
const req = async (name) => import(pathToFileURL(path.join(fe, name, (await import("node:fs")).existsSync(path.join(fe, name, "dist", "index.modern.js")) ? "dist/index.modern.js" : "dist/index.js")).href);

const { NodeIO } = await import(pathToFileURL(path.join(fe, "@gltf-transform", "core", "dist", "index.modern.js")).href).catch(async () => req("@gltf-transform/core"));
const { ALL_EXTENSIONS } = await import(pathToFileURL(path.join(fe, "@gltf-transform", "extensions", "dist", "index.modern.js")).href).catch(async () => req("@gltf-transform/extensions"));
const fn = await import(pathToFileURL(path.join(fe, "@gltf-transform", "functions", "dist", "index.modern.js")).href).catch(async () => req("@gltf-transform/functions"));
const { MeshoptEncoder, MeshoptDecoder } = await import(pathToFileURL(path.join(fe, "meshoptimizer", "index.js")).href);

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
  "meshopt.decoder": MeshoptDecoder,
});

const cats = process.argv.slice(2).length ? process.argv.slice(2) : ["aircraft", "equipment", "airports"];
for (const cat of cats) {
  const src = path.join(root, "pipeline", "build", "raw", cat);
  const dst = path.join(root, "frontend", "public", "assets", cat);
  let files = [];
  try { files = (await readdir(src)).filter((f) => f.endsWith(".glb")); } catch { continue; }
  await mkdir(dst, { recursive: true });
  for (const f of files) {
    const t0 = Date.now();
    const doc = await io.read(path.join(src, f));
    // Articulated assets (jet bridges) are not quantised or meshopt-compressed (meshopt quantises
    // internally): quantising a leaf mesh node folds the dequantisation scale/offset into that node's
    // transform, which would destroy the part pivots the runtime animates. Every asset keeps its
    // UPPER_SNAKE empties (prune drops empty leaf nodes unless told otherwise).
    const articulated = /^jet_bridge/.test(f);
    await doc.transform(
      fn.dedup(),
      fn.prune({ keepAttributes: true, keepExtras: true, keepLeaves: true }),
      fn.weld(),
      ...(articulated ? [] : [
        fn.quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14, pattern: /^(POSITION|NORMAL|TEXCOORD_\d)$/ }),
        fn.meshopt({ encoder: MeshoptEncoder, level: "medium" }),
      ]),
    );
    const out = path.join(dst, f);
    await io.write(out, doc);
    const a = (await stat(path.join(src, f))).size, b = (await stat(out)).size;
    console.log(`${cat}/${f}: ${(a / 1e6).toFixed(2)} MB → ${(b / 1e6).toFixed(2)} MB (${Date.now() - t0} ms)`);
  }
}
