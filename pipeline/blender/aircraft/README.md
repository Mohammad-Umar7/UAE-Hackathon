# SKYPACT aircraft generator

Reproducible, fully procedural generator for the six SKYPACT aircraft types
(`docs/CONVENTIONS.md` §3, §3.1, §5). Every type is an original design *inspired by* a public
aircraft category. All geometry is built from parametric lofts: there are no imported meshes
and no copies of manufacturer data.

| Output | Path |
|---|---|
| Raw GLBs (LOD0/LOD1/LOD2 under a root named after the key) | `pipeline/build/raw/aircraft/<key>.glb` |
| Manifest (dimensions, triangles per LOD, empties, materials, file size) | `pipeline/build/raw/aircraft/manifest.json` |
| Previews: `three_quarter`, `side`, `top`, `front`, `closeup_engine_gear`, `closeup_cockpit` | `pipeline/previews/aircraft/<key>_<view>.png` |
| Line-ups to scale (3/4 row and side-profile sheet with dimensions) | `pipeline/previews/aircraft/lineup.png`, `lineup_side.png` |
| LOD comparison (LOD0 / LOD1 / LOD2 side by side), optional | `pipeline/previews/aircraft/<key>_lods.png` |

## Run

Blender 5.1 (tested with 5.1.2, Python 3.13). Run headless from the repo root:

```bash
BLENDER="C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
# everything: six GLBs + previews + line-ups + manifest  (~5 min on an RTX 4070 laptop)
"$BLENDER" --background --factory-startup --python pipeline/blender/aircraft/build_aircraft.py
# one type, two views, quick
"$BLENDER" --background --factory-startup --python pipeline/blender/aircraft/build_aircraft.py -- --types nb --views side,three_quarter --samples 32
# geometry + export only
"$BLENDER" --background --factory-startup --python pipeline/blender/aircraft/build_aircraft.py -- --views none
# verify the exported files (plain Python 3 + numpy, no Blender needed)
python pipeline/blender/aircraft/verify_glb.py pipeline/build/raw/aircraft
npx --yes @gltf-transform/cli inspect pipeline/build/raw/aircraft/nb.glb
```

Options after `--`:

| Option | Default | Meaning |
|---|---|---|
| `--types` | `nb,wb,vla,cargo,biz,reg` | Types to build. |
| `--views` | `all` | `all`, `none` or a comma list of the view names above. |
| `--samples` | `64` | Cycles samples per preview (OptiX denoised). |
| `--no-export` | off | Build and render without writing GLBs or the manifest. |
| `--lineup` / `--no-lineup` | on when all six types are built | Render the line-ups, which import the exported GLBs. |
| `--lod-sheet` | off | Also render `<key>_lods.png`. |
| `--out`, `--previews` | repo paths | Output folders. |

The manifest is merged per type, so rebuilding one type keeps the entries for the others.
Rendering uses Cycles on the GPU (OptiX, then CUDA) and falls back to the CPU. Engine, sky-model,
view-transform and denoiser identifiers are read from Blender at runtime.

## Code map

| File | Role |
|---|---|
| `build_aircraft.py` | Entry point: CLI, per-type build, export, previews, line-ups, manifest. |
| `ac_build.py` | `RES` table (resolution per LOD), assembly of one LOD from a spec, Blender objects (merged per material, `Wheels`, `PROP_*`, decals, empties), GLB export and post-processing. |
| `ac_common.py` | Math (PCHIP, NACA airfoils), the `MB` mesh builder with explicit vertex normals, primitives, ribbons (panel lines), object creation. |
| `ac_fuselage.py` | Fuselage loft and surface-mapped overlays: cockpit glazing, cabin windows, door outlines, panel lines, title decals. |
| `ac_wing.py` | Planform-driven lifting surfaces (wing, stabilisers, fin), tip devices (sharklet, blended winglet, raked tip, fence, rounded cap), flap-track fairings, control-surface lines, fin logo decal. |
| `ac_engine.py` | Revolved turbofan (lip, inlet, fan and spinner with blades, bypass nozzle with optional chevrons, core cowl, plug), pylons, turboprop nacelle, 6-blade propeller. |
| `ac_gear.py` | Tyres and hubs (`_AXLE`), oleo struts, bogies, torque links, braces, gear doors. |
| `ac_materials.py` | The 14 contract materials and the default decal textures (`textures/title.png`, `textures/logo.png`, rendered once by Blender). |
| `ac_render.py` | Preview lighting (multiple-scattering sky and sun), apron ground plane, fitted cameras. |
| `ac_spec.py` | Helpers for spec files (window rows, nose curves, engine height from the wing). |
| `type_<key>.py` | One spec per aircraft: profiles, planforms, engines, gear, windows, doors, decals. |
| `verify_glb.py` | Contract checks on the exported GLBs. |

### How the geometry is built

* **Fuselage.** Cross-sections are two superellipse halves sharing a max-width line, optionally
  with a belly-fairing or sponson bulge and an upper "bubble" (the 747-style hump, or the ATR
  wing-root fairing). Top, bottom and half-width are PCHIP curves along the station `s` (metres
  aft of the nose tip). Each ring is resampled by arc length with landmark vertices at the
  cheatline boundaries, so `M_Paint_Top`, `M_Paint_Cheatline` and `M_Paint_Belly` meet on exact
  edge loops. Vertex normals come from the whole loft, so the paint seams shade continuously.
  The nose rings are capped at 0.20 m spacing in LOD0. The tail cone ends in an APU exhaust.
* **Overlays** (glazing, windows, panel lines, decals) are mapped onto the analytic surface and
  offset along the normal: about 6–12 mm in LOD0, 2 cm in LOD1, and 4–5 cm in LOD2. Window and
  door boundaries are resampled by arc length so that long edges follow the curved skin.
* **Wings and tails** are lofted from NACA-4-digit sections with aft camber (supercritical-like),
  with sweep, taper, dihedral, washout and the yehudi trailing-edge kink. A bare-metal leading-edge
  strip is used on the jets; the ATR gets black de-icing boots (`M_Dark`). Panel lines mark
  ailerons, flaps, spoilers, slats, elevators and the rudder.
* **Engines.** Each nacelle is a single revolved profile, with materials assigned per profile
  segment: dark inlet, metal lip, painted cowl, dark bypass duct. A cowl split line, a metal core
  cowl and plug, a spinner and twisted fan blades complete it. The `wb` nozzle has 12 chevrons.
  The engine height is derived from the wing (`ac_spec.engine_center_z`), so the nacelle tucks
  under the leading edge. Pylons are lofted between the nacelle and the wing.

## Types

| Key | Inspired by | L / span / H (m), target | Built | LOD0 / LOD1 / LOD2 tris | Signature features |
|---|---|---|---|---|---|
| `nb` | A320neo family | 37.6 / 35.8 / 11.8 | 37.57 / 35.80 / 11.75 | 53,456 / 13,796 / 2,736 | Classic 6-window cockpit, sharklets, 2+4 wheels. |
| `wb` | 787-9 | 62.8 / 60.1 / 17.0 | 62.81 / 60.20 / 17.04 | 59,388 / 15,828 / 3,112 | Smooth 4-window nose, raked tips, chevron nozzles, 2+8 wheels. |
| `vla` | A380 | 72.7 / 79.8 / 24.1 | 72.72 / 80.08 / 24.21 | 78,424 / 24,104 / 5,724 | Tall oval double deck, bulbous nose, 4 engines, wingtip fences, 2+20 wheels. |
| `cargo` | 747-8F | 76.3 / 68.4 / 19.4 | 76.25 / 68.40 / 19.46 | 75,330 / 19,824 / 4,924 | Upper-deck hump, visor nose-door line, side cargo door, 3 upper-deck windows, raked tips, 2+16 wheels. |
| `biz` | G650 | 30.4 / 30.4 / 7.8 | 30.49 / 30.44 / 7.77 | 51,152 / 13,054 / 2,718 | Sleek nose, large oval windows, rear-mounted engines, T-tail with bullet fairing, blended winglets. |
| `reg` | ATR 72 | 27.2 / 27.1 / 7.7 | 27.17 / 27.16 / 7.65 | 41,934 / 11,444 / 2,520 | High wing on a root fairing, T-tail with dorsal fin, 6-blade `PROP_L`/`PROP_R`, gear in sponsons, de-icing boots. |

All dimensions are within 0.7% of target (`manifest.json` → `deviation_pct`). LOD1 is 25–31% of
LOD0 and LOD2 is 5–7%. LOD2 drops windows, decals and gear detail but keeps every other material
slot, including a `Wheels` node with `_AXLE`.

### Tuning

* **Shapes.** Edit the type file. Profiles are `(s, value)` point lists. Cockpit window corners
  can be given as `("z", s, z)` (side view), `("xz", x, z)` (front view, which solves for the
  station), or `("t", s, t)`, where `t` is the arc fraction from the top centreline. Window rows
  use `ac_spec.row(start, pitch, count, skip=[door ranges])`.
* **Resolution.** Edit `ac_build.RES`, or override it per type with
  `spec["res"] = {lod: {...}}` (`vla` uses this to stay at 80k triangles).
* **Colours.** Preview defaults live in `ac_materials.MATS`. The runtime recolours `M_Paint_*`.

## Contract notes (read these before wiring the runtime)

* **Hierarchy.** Root node `<key>`, then `LOD0`, `LOD1`, `LOD2`. Within each LOD there is one mesh
  node per material (`LODn_<Material>`), plus `Wheels`, `TITLE_L/R` and `LOGO_L/R` (LOD0/1),
  `PROP_L/R` (`reg`), and the empties (LOD0 only). Node names repeat across LODs; Blender's
  uniqueness suffixes are stripped after export. three.js will append `_1`/`_2` to duplicate
  names, so look nodes up inside each LOD subtree (recent three.js versions keep the original glTF name in
  `userData.name`).
  The root carries extras: `length_m`, `span_m`, `height_m`, `origin`.
* **Origin and axes.** Origin is the nose-gear tyre contact point. Blender +Y is the nose, so in
  three.js the nose is −Z. Tyres touch y = 0 exactly; `verify_glb.py` checks this.
* **`_AXLE`.** The Blender glTF exporter writes custom attributes **without** axis conversion,
  so the generator stores the values pre-converted. In the GLB, `_AXLE` and `POSITION` are in
  the same glTF/three.js local space (Y up). The spin axis is local X in both conventions.
  Verified: the number of distinct `_AXLE` values equals the wheel count in every LOD, and every
  wheel vertex lies within its radius about X through its axle.
* **Propellers.** `PROP_L` and `PROP_R` have their origin at the hub and an identity rotation. The
  spin axis is Blender local +Y, which is **local −Z in three.js** (`prop.rotation.z`). Positive
  rotation about Blender +Y is clockwise seen from behind, and the blade leading edges lead in
  that direction.
* **Engines.** `ENGINE_1..n` are numbered from left (−X) to right. They mark fan-face centres, or
  the propeller hub on `reg`.
* **Decals.** `TITLE_*` and `LOGO_*` follow the UV rule: on the L side u runs nose→tail, on the
  R side tail→nose, and v runs upward. Both materials embed default textures (a "SKYPACT"
  wordmark and a gold emblem) with `alphaMode: BLEND`. The runtime swaps in each airline's
  textures.
* **Single-sided.** All materials are single-sided (`doubleSided` false). Winding is checked
  against the stored normals (no reversed faces).
* **Decal-like overlays.** Windows, glazing, panel lines and decals float a few millimetres above
  the skin, so at long range they can z-fight. If they flicker, use `polygonOffset` on those
  materials or a logarithmic depth buffer.

## Known limitations and deviations

* `reg` `DOOR_L1` is placed at the **rear**-left passenger door, which is how ATR-type aircraft
  board. The front-left door on this type is a cargo door.
* `cargo` has no `DOOR_L2`. It has `DOOR_L1` (main-deck crew door), `DOOR_NOSE` (visor sill,
  centreline) and `DOOR_MAIN_CARGO` (left side cargo door sill).
* No modifier stack. Geometry is generated directly at its final resolution with explicit smooth
  normals (custom split normals), which replaces subdivision, bevel and weighted-normal passes.
* Paint meshes have no UVs, since the colours are constant. Only the decal meshes are UV-mapped.
* Landing gear is down and static. Gear bays, cabin interiors and flight-deck interiors are not
  modelled, and the inlet ducts end at the fan disc.
* Wingtip devices (sharklets, winglets, fences) use `M_Paint_Tail`, as a styling choice.
* There are no image textures other than the two decals, and no normal maps. Fine skin detail is
  real geometry.
* Self-contained by design: nothing is written to `pipeline/blender/common/`.
