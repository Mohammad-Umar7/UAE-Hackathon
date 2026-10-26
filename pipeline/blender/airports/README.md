# SKYPACT signature airport architecture (Blender generator)

Procedural, deterministic generator for the signature buildings of the three SKYPACT airports:
Zayed International Terminal A and ATCC tower (OMAA), Dubai International Concourses A-D,
Terminals 1-3 and ATC tower (OMDB), and the domed Sharjah International terminal with its
minaret-like tower (OMSJ). Every model is an original design *inspired by* the real building,
built from code (no imported or downloaded meshes). The OSM footprints in
`data/airports/<ICAO>/layout.json` are the plan geometry, so the buildings line up exactly with
the stands, bridges and taxiways of the twin.

Contract: `docs/CONVENTIONS.md` sections 2-4. Every GLB is modelled **in its airport ENU frame**
(aeqd about the ARP; x east, y north, z up, metres; ground = airfield datum z 0) and exported
`+Y up`, so three.js gets `(x east, y up, z = -north)`. **Place each GLB at the origin with an
identity transform** and hide the layout buildings listed in its `replaces`.

## Run

From the repository root (Blender 5.1, headless only):

```bash
B="C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"

# 1. build every GLB + manifest (~10 s). --only a,b / --icao OMDB to rebuild some; --audit adds the
#    LOD0 ray-cast normal audit; --previews renders the previews of what was built
"$B" --background --factory-startup --python pipeline/blender/airports/build_airports.py -- [--only OMAA_terminal_a] [--icao OMSJ] [--audit] [--previews]

# 2. previews (Cycles GPU/OptiX; imports the exported GLBs, so you see exactly what ships), ~15 min for all
"$B" --background --factory-startup --python pipeline/blender/airports/render_previews.py -- --views day,hero,night --samples 64 --overview
#    options: --only name,... --icao OMAA --scale 0.6 --no-aircraft --overview-only
#             --debug-backface   (any red = a back face visible to the camera = a hole in three.js)

# 3. verify (plain Python + numpy/shapely from pipeline/.venv; --npx adds gltf-transform validate from the npx cache)
pipeline/.venv/Scripts/python pipeline/blender/airports/verify_airports.py [--npx]
```

The build is deterministic (no randomness except seeded RNGs for rooftop plant placement; two
consecutive builds give byte-identical GLBs) and re-runnable; the manifest is merged per asset.
Build ~11 s for all 12 GLBs on the dev laptop; previews ~6-15 s each (RTX 4070, OptiX, 64 samples).

## Outputs

| Path | Content |
|---|---|
| `pipeline/build/raw/airports/<ICAO>_<name>.glb` | 12 raw GLBs (`export_format GLB, export_yup, export_apply, export_extras`, no Draco) |
| `pipeline/build/raw/airports/manifest.json` | per GLB: `icao, file, title, replaces, bbox_enu, triangles` per LOD, `lod_ratios`, `materials` (+ values), nodes, file size; per-airport LOD0 totals vs the 250k budget |
| `pipeline/build/raw/airports/textures/T_Lattice.png` | generated blue-ceramic lattice (OMSJ `M_Accent`), embedded in the OMSJ GLBs |
| `pipeline/build/raw/airports/verify/summary.json` | verifier results (+ `*_validate.txt` with `--npx`) |
| `pipeline/previews/airports/<ICAO>_<name>_{day,hero,night}.png` | oblique three-quarter day view (1-2 km), close hero view, dusk view with `M_GlassLit` / `M_Lights` emissive |
| `pipeline/previews/airports/<ICAO>_overview_{day,night}.png` | all assets of an airport together |
| `pipeline/previews/airports/<ICAO>_<name>_debug_hero.png` | back-face audit renders (white = front faces only) |
| `pipeline/previews/airports/*.jpg` | JPEG copies of the day / hero / night / overview PNGs (PNG previews are gitignored; the repo tracks the JPEGs, as for the aircraft and equipment previews) |

Previews show the GLBs on flat airfield context generated from `layout.json` (runways with
centreline dashes, taxiways with centrelines, aprons, landuse, roads, the remaining layout
buildings and city context as plain extrusions) plus aircraft from `pipeline/build/raw/aircraft`
parked on ~55 % of the contact stands for scale. The context is preview-only and never exported.

## Assets

Triangles are LOD0 / LOD1 / LOD2 (raw GLB). Per-airport LOD0 totals: **OMAA 55,074, OMDB 120,687,
OMSJ 98,820** (budget 250k each).

| GLB | Represents | Triangles | replaces (layout.json ids) |
|---|---|---|---|
| `OMAA_terminal_a` | Terminal A: X plan, dune roof, 18 hall arches, canted pier glazing, 49 fixed links | 51,630 / 16,748 / 4,400 | `osm-r20328079-rest`, `osm-w1246109131`, `osm-w1246109130` |
| `OMAA_tower` | ATCC tower: crescent "dhow-sail" blade on a concrete core, round cab, mast; 5-storey base building | 3,444 / 1,412 / 406 | `osm-w396942818`, `osm-w313959148-rest` |
| `OMDB_concourse_a` | Concourse A: 645 m vaulted concourse, transverse arch ribs, crown skylights, bridge link stubs | 18,728 / 6,755 / 996 | `osm-w231888210` |
| `OMDB_concourse_b` | Concourse B: 924 m vault tapering in plan and height to the ends; south-west annex; bridge link stubs | 24,894 / 8,719 / 1,470 | `osm-w87185819`, `osm-w742271052` |
| `OMDB_concourse_c` | Concourse C: lower concourse, shallow roof, clerestory lanterns, rooftop plant, bridge link stubs | 11,627 / 3,873 / 928 | `osm-w10315513` |
| `OMDB_concourse_d` | Concourse D: linear pier vault + higher central atrium block with glazed lantern, bridge link stubs | 16,622 / 5,561 / 1,196 | `osm-w302538629` |
| `OMDB_terminal_1` | Terminal 1: landside processor, kerb canopy, ogee-arch colonnade (1971 motif), plant | 23,180 / 6,556 / 1,180 | `osm-w98425196` |
| `OMDB_terminal_2` | Terminal 2: low terminal with ribbed shallow roof, kerb canopy | 15,395 / 6,075 / 1,174 | `osm-w98425234` |
| `OMDB_terminal_3` | Terminal 3: the above-ground landside hall strip (vault), departures kerb canopy | 4,840 / 1,472 / 457 | `osm-w98425182` |
| `OMDB_tower` | ATC tower: column with two arched "wings" and buttresses, multilevel cab; B-C junction podium | 5,401 / 1,998 / 770 | `osm-n4481230343`, `osm-w385965965`, `osm-w264966382` |
| `OMSJ_terminal` | Terminal: white domes on drums, pointed-arch lattice screens, crenellated parapets, arcaded rotunda porch, 3 domed annexes | 94,574 / 20,199 / 4,054 | `osm-w182512055`, `osm-w182512051`, `osm-w182601738`, `osm-w203760511`, `osm-w182601954` |
| `OMSJ_tower` | Minaret-like control tower: octagonal arcaded plinth, banded shaft, balcony, glazed cab, cupola + crescent | 4,246 / 1,606 / 542 | `osm-n11146938928` |

### How the geometry is made

* **Draped roof buildings** (`ap_arch.draped_building`): the OSM outline is the roof edge seen
  from above. The roof is a height field `z(x, y)` triangulated over the outline (constrained
  Delaunay with interior Steiner points); a fascia and a soffit run back to the facade line; the
  curtain wall is a ruled surface (optionally canted) with an apron-level band, mullion fins and
  transoms. Concourses use circular-segment vaults over the plan's cross-sections
  (`ap_arch.Sections`, `vault_z`), so vaults follow tapering or kinked plans.
* **Terminal A** (`ap_omaa.py`): the relation outline and its two parts are united; a
  morphological-opening test (12 m disc) separates the pier body from the 49 thin "lobes" (the
  fixed passenger-bridge links drawn in the OSM outline), which become glazed corridors at floor
  5.0 m / roof 8.6 m ending at the stands' `bridge_root` points. Pier axes are snapped to the
  distance-field ridge; along each pier the roof is pulled down at every ~55 m segment (eave
  8.5 -> 16.5 m, crown 19 -> 24.5 m, lower crowns on the narrow N/W piers), giving the arched,
  scalloped dune profile with arch-shaped glazed bays; the rounded pier ends keep a high eave.
  The central hall is a vault of 18 arches parallel to the 319 m landside facade (peak 52 m),
  blended into the piers with a smooth maximum; the arches are expressed as raised ribs with
  skylight bands between alternate arches; crown skylights run along every pier bay.
* **Domes / arcades / towers**: lathe and sweep primitives (`ap_geo.py`): pointed (two-centred)
  and ogee arches, ribbed slightly pointed domes on drums with glazed windows, finials,
  cab glazing leaning outward, obstruction lights.

## Materials (runtime contract)

| Material | Use | Value in the GLB |
|---|---|---|
| `M_Glass` | dark reflective blue-grey glazing (fixed links, small glazing) | `#26323C`, metallic 0.3, roughness 0.1 |
| `M_GlassLit` | the same glazing on large lit areas: facades, skylights, tower cabs, SHJ arch glazing and drum windows | same values, **not emissive in the GLB** - make it emissive at night (previews use warm `(1.0, 0.80, 0.55)`, strength 1.6) |
| `M_Roof` | white / silver metal roofs | `#D3D7DA`, metallic 0.55, roughness 0.32 (OMSJ: white GRP domes `#ECEBE6`, metallic 0.05) |
| `M_Structure` | arches, ribs, mullions, soffits, canopies, tower sails / wings | `#E4E6E8`, metallic 0.15, roughness 0.45 |
| `M_Concrete` | warm light concrete / stone walls | `#D9CFBE`, roughness 0.82 |
| `M_Accent` | OMSJ blue glazed-ceramic lattice screens and tower bands | baked texture `T_Lattice.png` (base `#3A7CC4`) |
| `M_Dark` | apron-level bands, recesses, louvres | `#16191C` |
| `M_Lights` | red aviation obstruction lights (tower masts / cab roofs, hall crown, pier tips, concourse crowns) | `#FF2A1A`, emissive `#FF2010` strength 4 (`KHR_materials_emissive_strength`) |

No other materials are used. `UVMap` is a box projection in metres times a per-material scale
(glass/structure/concrete 0.25 /m, roof 0.1 /m, `M_Accent` 0.4 /m = one lattice tile per 2.5 m),
relative to each mesh node origin; gltf-transform reports the UVs of untextured materials as
`UNUSED_OBJECT` infos (kept on purpose for runtime effects).

## Runtime notes

* Hierarchy: `<name>` (root empty, identity, extras `icao`, `title`, `replaces` (comma
  separated), `frame`) -> `LOD0` / `LOD1` / `LOD2` (identity) -> mesh nodes (one per building
  part, one primitive per material; LOD1/LOD2 names carry `_LOD1` / `_LOD2`). Mesh node origins
  sit at the part's bbox centre at ground level (node translation = ENU offset), which keeps vertex
  values small for 16-bit quantisation in `pipeline/optimize_assets.mjs` (about 2 cm on Terminal A).
* LOD1 is 21-41 % of LOD0, most assets 30-37 % (every fourth mullion fin, no transoms, coarser
  roof and arcs, half the arcade bays), LOD2 4-14 % (silhouette: roof height field, plain facades,
  no details or lights).
  Suggested switching: LOD0 below ~1.2 km, LOD1 to ~4 km, LOD2 beyond.
* OMAA fixed links (corridor floor 5.0 m, roof 8.6 m) end at the OSM lobe tips = `stands[].bridge_root`,
  matching the runtime link boxes (y 5.0-8.2 m) and the jet-bridge rotunda floor (5.0 m). On DXB
  Concourses A-D (roof edge = OSM outline, glass 2.4-3.2 m behind it) short glazed stubs at the same
  section (5.0-8.2 m, 3.4 m wide) run from each `bridge_root` back to the glass, so the runtime link
  boxes always meet the building.
* Roof heights for labels / camera framing: Terminal A hall 52 m (piers 17-25 m), ATCC tower
  115.8 m with mast (cab roof 104 m), DXB Concourse A 42 m, B 39.5 m, C ~22 m, D 27 m (atrium),
  T1 ~22 m, T2 ~14 m, T3 ~18 m, DXB tower 89 m, SHJ domes up to ~35 m (+finial), SHJ tower 35 m
  cab roof / ~44 m finial. `bbox_enu` in the manifest gives exact extents.
* `M_Lights` could blink (the GLB keeps it steady). Big meshes: let them cast and receive shadows.

## Sources (data/reference/airports.md and airports.json)

* OMAA Terminal A (KPF; Hill International; AviationWeek; Dezeen): X plan with four piers; single
  undulating "dune" roof pulled down at each pier segment and draped over the facade; central
  hall roof on 18 arches, largest 180 m span and 52 m high; roof 319 m wide; 50 m glazed landside
  facade; pier glazing canted outward 14.75 deg; OSM relation 20328079 (+ parts) height 53 m.
* OMAA ATCC tower (ADPi / Terrell / Airport Technology / TradeArabia / AIP AD 2.10): 109-110 m
  (AIP obstacle 115.2 m incl. masts), curved crescent / sail / blade shaft, cab on top, 5-storey
  base building; position = OSM footprint centre (the AIP obstacle point is 7.1 m away).
* OMDB (Dubai Airports fact files, BG&E, Al Abbar, Wikipedia): Concourse A 645 x 90.8 m, 42 m,
  arched roof like B; Concourse B 924 m, 90.8 m wide at the middle and 56 m at the ends, 39.5 m,
  structural-steel vaulted roof; Concourse C 780.8 x 66.8 m; Concourse D 700 x 144 m, 27 m, linear
  pier around a central atrium; T1 502 x 125 m with 1971 ogee arches; T2 low single-storey;
  T3 mostly below the apron (OSM maps a 299 x 25 m strip); ATC tower 89 m (AIP 85.6 m), buttressed
  column with arched wings and a multilevel cab, at the B-C junction (OSM node vs AIP: 4.0 m).
* OMSJ (Archnet, Gulf News 2008, Airport Technology): domes of different sizes (steel lattice
  clad in GRP), reinforced-concrete pointed arches infilled with blue glazed-ceramic sun screens,
  control tower "treated as a minaret"; tower height not published.

## Deviations, assumptions and known limitations

* **Extra superseded ids** beyond the brief's list, because the models cover them:
  `osm-w313959148-rest` (ATCC base building), `osm-w742271052` (Concourse B south-west annex),
  `osm-w385965965` (B-C connector = tower podium) and `osm-w264966382` (junction block next to the tower).
* **Heights without a published value** were chosen and are documented above: DXB Concourse C
  (19-22 m), T1 (~22 m), T2 (~14 m), T3 strip (~18 m), annexes (19-24 m); SHJ main body 15 m and
  domes (sized from the plan arcs, kept below the tower); SHJ tower uses the layout's 35 m for the
  cab roof (layout default; the real height is not published) plus cupola and crescent finial.
* Terminal A: the 18 arches are inside the real building (visually separated from the roof); here
  they are expressed as raised ribs on the roof so the rhythm reads from outside. Pier segment
  length (~55 m), eave and crown heights are design estimates. The fixed links follow the OSM
  lobes, including their bulbous rotunda ends.
* DXB tower: the June 2026 UAE-flag livery is **not** modelled (the paint pattern is not documented
  in the references); the tower is white. The wings are an interpretation of "buttressed column
  with arched wings".
* Concourse geometry follows the OSM outlines (e.g. B is 921 x 101 m in OSM vs 924 x 90.8 m in the
  fact file - the OSM outline includes the roof overhang). Concourses A and B share one design
  family ("similar in appearance"); B tapers in plan and height.
* SHJ: the number/size of domes is an interpretation (main, departures, arrivals rotunda over the
  arcaded porch, one per annex, plus small domes over the airside gate modules); the lattice is a
  generic eight-point-star screen, not a survey of the real pattern.
* Glass is a constant material (no mullion texture); mullions, transoms and fins are geometry, so
  at very long range they alias like any thin geometry (LOD1/LOD2 drop them).
* Interiors are not modelled; facades are opaque reflective glass.
* `ap_audit` (build `--audit`) reports "inside hits": faces whose normal ray first meets the back
  of another face. All of them were checked to be buried geometry (roof skin under skylights and
  ribs, panel reveals and frames embedded in walls, links passing through facades); the
  `--debug-backface` renders (camera-ray-only red) show no visible back faces.

## Verification (last run)

`verify_airports.py --npx`: 12/12 GLBs pass - single identity root named after the asset,
`LOD0/LOD1/LOD2` children, contract materials only (`M_Lights` emissive, `M_GlassLit` not), no
NaN / non-unit normals / degenerate triangles, every LOD0 vertex within 4 m of the superseded
footprints (20-21 m where kerb canopies / the T1 colonnade stand in front of the landside facade),
plan bbox IoU >= 0.92 (towers 0.84 on the 18 m derived node footprint, T3 0.84 because of its
12 m canopy on a 25 m strip), per-airport LOD0 <= 250k, and gltf-transform validate: no errors, no
warnings (only `UNUSED_OBJECT` infos for the UVs of untextured materials).

## Code map

| File | Role |
|---|---|
| `build_airports.py` | entry point: build, export, manifest (`--audit`, `--previews`) |
| `render_previews.py` | Cycles previews: GLB import, layout context, parked aircraft, day / hero / night, overviews, back-face debug |
| `verify_airports.py` | contract, budget, placement and validator checks (no Blender) |
| `ap_registry.py` | asset list (collects `ASSETS` from the airport modules) |
| `ap_omaa.py`, `ap_omdb.py`, `ap_omsj.py` | per-airport builders `build(lod) -> [(node, Geo)]` and asset specs (title, replaces, preview cameras) |
| `ap_arch.py` | architectural components: draped roof buildings, sections/vaults, curtain walls, fins, canopies, rooftop plant, arcades, arches, domes, strips, lanterns |
| `ap_geo.py` | polygon-soup mesh builder and primitives (prism, loft, lathe, sweep, tube, arches) |
| `ap_poly.py` | 2D polygons with numpy + mathutils: SDF, resampling, offsets, CDT triangulation, unions, lobe split, min rectangle, circle fit, smooth interpolation |
| `ap_layout.py` | layout / reference loaders and the aeqd projection (Vincenty inverse, matches pyproj to < 1 mm) |
| `ap_materials.py` | contract materials and the lattice texture |
| `ap_scene.py` | Geo -> Blender meshes (UVs, smooth + sharp edges), LOD hierarchy, GLB export |
| `ap_glbinfo.py` | pure-Python GLB reader (manifest, verifier) |
| `ap_audit.py` | LOD0 ray-cast normal audit |
