# SKYPACT airside equipment kit (Blender generator)

Procedural, reproducible generator for the airside equipment of the SKYPACT digital twin: jet
bridges, 16 GSE vehicles, 13 airfield furniture items, date palms / shrub and car-park cars.
Everything is built from code (no hand-made source files, no downloaded assets): geometry with
bmesh/mathutils, textures with numpy, materials as glTF-friendly Principled BSDF.

Contract: `docs/CONVENTIONS.md` sections 2, 3 and 3.2 (metres, Blender +Y forward / +Z up,
origin on the ground at the footprint centre, glTF `+Y up` export, `LOD0/LOD1/LOD2` under a root
named after the asset, empties under `LOD0`, material names as runtime contract).

## Quick start

Run from the repository root (Windows paths shown; Blender 5.1, headless):

```bash
B="C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"

# 1. build every GLB + manifest (about 10 s); --only a,b to rebuild some; --force-textures to regenerate PNGs
"$B" --background --factory-startup --python pipeline/blender/equipment/build_equipment.py -- [--only jet_bridge] [--force-textures]

# 2. previews (Cycles GPU; imports the exported GLBs, so you see exactly what ships)
"$B" --background --factory-startup --python pipeline/blender/equipment/render_previews.py -- --mode assets,bridge,contact,grid [--samples 96] [--only name]
#    other modes: lods (LOD0/1/2 side by side), --debug-backface (red = back face visible = hole in three.js)

# 3. verify (contract checks + gltf-transform inspect/validate for every file)
python pipeline/blender/equipment/verify_glbs.py            # --skip-npx for the fast contract-only pass
```

Outputs

| Path | Content |
|---|---|
| `pipeline/build/raw/equipment/<name>.glb` | raw GLB exports (37 files), textures embedded |
| `pipeline/build/raw/equipment/manifest.json` | per asset: dimensions, bbox, triangles per LOD, LOD ratios, materials, textures, nodes, empties (asset-frame and parent-local positions), morph targets, custom attributes, file size |
| `pipeline/build/raw/equipment/textures/*.png` | generated textures (inputs of the GLBs) |
| `pipeline/build/raw/equipment/verify/` | `gltf-transform inspect` / `validate` logs and `summary.json` |
| `pipeline/previews/equipment/<name>_threequarter.png` | three-quarter render per asset (tall masts: full view + head close-up) |
| `pipeline/previews/equipment/kit_contact_sheet.png` | whole kit at true scale with 1.80 m ground-crew reference figures |
| `pipeline/previews/equipment/kit_grid.png` | all three-quarter renders tiled with names |
| `pipeline/previews/equipment/jet_bridge_pose_{short,long,pitched}.png`, `jet_bridge_poses.png` | bridge retracted / extended / pitched and docked to a generic narrow-body door |
| `pipeline/previews/equipment/<name>_lods.png` | LOD0 / LOD1 / LOD2 side by side (selected assets) |

## Generator layout

| File | Role |
|---|---|
| `build_equipment.py` | entry point: build, export, manifest |
| `render_previews.py`, `kit_sheet.py`, `montage.py` | Cycles previews, contact sheet, bridge poses, grids |
| `verify_glbs.py` | verification (no Blender needed) |
| `audit_normals.py` | dev tool: ray-cast audit for flipped single-sided faces (all LODs) |
| `eqlib/geo.py` | `Geo` polygon soup + primitives (box/prism with bevels, lathe, tube, panels) |
| `eqlib/parts.py` | reusable parts: wheels (3 LOD styles), truck cab, profile bodies, lamps, beacons, mirrors, stairs, guard rails, scissor lifts, hose reels, hazard panels, decals |
| `eqlib/gse.py`, `jetbridge.py`, `furniture.py`, `vegetation.py` | asset builders `build(lod, pose) -> Rig` |
| `eqlib/materials.py`, `textures.py` | material library and procedural textures |
| `eqlib/scene.py` | Geo -> mesh (UVs, smooth + sharp edges, baked weighted normals, `_AXLE`, shape keys), hierarchy, export |
| `eqlib/registry.py` | asset list: builder, LODs, morphs, default colours, empties documentation |
| `eqlib/glbinfo.py` | pure-Python GLB reader used by the manifest and the verifier |

Shared helpers were kept inside `equipment/` (not `pipeline/blender/common/`) so other workstreams'
code is untouched; they can be promoted to `common/` later.

## Asset catalogue

Dimensions are the LOD0 bounding box (L along Y x W along X x H), mirrors / handrails included.
Triangles are LOD0 / LOD1 / LOD2 (furniture and the shrub ship LOD0 only). Sizes are raw,
unoptimised GLBs (meshopt/texture compression happens in `pipeline/optimize_assets.mjs`).

| Asset | Category | L x W x H (m) | Triangles | GLB | Extras |
|---|---|---|---|---|---|
| `jet_bridge` | jet_bridge | 29.14 x 9.08 x 8.24 | 10147 / 3205 / 857 | 805 KB | parts JB_*; empties TUNNEL_A_MOUNT, TUNNEL_B_RETRACTED/EXTENDED, CAB_PIVOT, DRIVE_COLUMN_MOUNT, CAB_DOCK, BEACON |
| `jet_bridge_glass` | jet_bridge | 29.14 x 9.08 x 8.24 | 9561 / 3315 / 987 | 787 KB | same contract, glazed tunnels (alpha-blended M_Glass) |
| `pushback_tug` | gse | 7.94 x 3.45 x 1.77 | 7028 / 1660 / 276 | 468 KB | towbarless, nose-wheel cradle; TOW_HITCH, BEACON |
| `baggage_tractor` | gse | 3.38 x 1.60 x 2.25 | 5058 / 1262 / 406 | 363 KB | TOW_HITCH, BEACON |
| `baggage_cart` | gse | 4.74 x 1.65 x 2.16 | 4248 / 948 / 260 | 290 KB | luggage load; TOW_EYE, TOW_HITCH |
| `uld_dolly` | gse | 3.30 x 2.15 x 2.17 | 2238 / 684 / 196 | 269 KB | LD3 (AKE) container; TOW_EYE, TOW_HITCH |
| `belt_loader` | gse | 8.08 x 2.00 x 3.09 | 5126 / 1522 / 374 | 455 KB | morph Raise (belt top 2.2 -> 4.0 m); BELT_TOP |
| `catering_truck` | gse | 9.08 x 3.05 x 4.06 | 6736 / 1814 / 330 | 666 KB | morphs Raise (+4.40 m), Extend (+2.50 m); PLATFORM_EDGE |
| `fuel_hydrant_dispenser` | gse | 8.09 x 2.88 x 3.35 | 8100 / 1984 / 482 | 620 KB | filter vessel, reels, inlet hose + coupler; HYDRANT_COUPLER |
| `fuel_tanker` | gse | 10.77 x 3.15 x 3.65 | 11048 / 2962 / 390 | 781 KB | 6x4, elliptical tank; HOSE_REEL |
| `gpu_cart` | gse | 3.94 x 1.65 x 1.93 | 4014 / 810 / 176 | 297 KB | 400 Hz cable coil; TOW_EYE, CABLE_PLUG |
| `stairs_truck` | gse | 8.82 x 2.74 x 6.01 | 5848 / 1656 / 486 | 577 KB | morph Raise (platform 3.4 -> 5.8 m); PLATFORM_EDGE |
| `ambulift` | gse | 9.49 x 3.05 x 4.15 | 6698 / 1858 / 330 | 676 KB | PRM high-lift: morphs Raise (+6.40 m, floor up to 7.85 m), Extend (+1.60 m) |
| `follow_me_car` | gse | 4.98 x 2.19 x 2.57 | 4152 / 1070 / 352 | 350 KB | checker band, FOLLOW ME roof sign, 2 beacons + light bar |
| `arff_tender` | gse | 13.15 x 3.85 x 4.10 | 9546 / 2346 / 366 | 661 KB | 6x6, roof + bumper turrets; TURRET |
| `apron_bus` | gse | 14.10 x 3.67 x 3.19 | 4330 / 1122 / 250 | 365 KB | 3 doors right / 2 left; DOOR_R1..3, DOOR_L1..2 |
| `main_deck_loader` | gse | 12.06 x 3.60 x 3.22 | 4308 / 1296 / 332 | 496 KB | morphs Raise (bridge + cab +4.60 m), RaiseRear (+4.60 m) |
| `service_van` | gse | 6.09 x 2.42 x 2.70 | 3742 / 962 / 206 | 356 KB | roof rack, ladder, light bar |
| `runway_edge_light` | furniture | 0.20 x 0.20 x 0.36 | 114 | 10 KB | white lens |
| `taxiway_edge_light` | furniture | 0.20 x 0.20 x 0.30 | 130 | 10 KB | blue dome lens |
| `inset_light` | furniture | 0.30 x 0.30 x 0.02 | 64 | 5 KB | flush disc, 2 prism windows |
| `approach_light_bar` | furniture | 0.45 x 4.20 x 2.26 | 300 | 20 KB | 5 lamps aim +Y; LAMP_AIM |
| `papi_unit` | furniture | 0.78 x 0.96 x 0.86 | 208 | 17 KB | lenses aim +Y |
| `windsock` | furniture | 4.10 x 0.92 x 6.19 | 272 | 21 KB | child node `Sock` (yaw about Z) |
| `apron_flood_mast` | furniture | 4.52 x 4.50 x 31.44 | 260 | 20 KB | 30 m, 10 floodlights on M_Lights; LIGHT_HEAD |
| `taxi_sign` | furniture | 0.30 x 2.50 x 1.47 | 88 | 16 KB | face 2.4 x 1.1 m, M_SignFace / M_SignFaceBack UV 0-1 |
| `ils_localizer` | furniture | 9.35 x 31.05 x 2.74 | 372 | 28 KB | 14 LPDA antennas + shelter |
| `glide_slope_mast` | furniture | 4.38 x 2.60 x 15.15 | 182 | 16 KB | lattice mast, 3 panels, shelter |
| `blast_fence` | furniture | 2.84 x 6.00 x 4.15 | 104 | 35 KB | 6.0 m segment, tiles along X |
| `perimeter_fence` | furniture | 0.41 x 3.04 x 2.83 | 56 | 9 KB | 3.0 m segment, tiles along X |
| `road_light` | furniture | 2.37 x 0.32 x 10.30 | 122 | 10 KB | LIGHT_HEAD |
| `date_palm_a` | vegetation | 6.83 x 6.61 x 8.38 | 1548 / 452 / 122 | 632 KB | young palm |
| `date_palm_b` | vegetation | 7.62 x 7.54 x 11.76 | 1908 / 556 / 130 | 652 KB | mature, leaning |
| `date_palm_c` | vegetation | 8.08 x 7.40 x 14.65 | 2468 / 840 / 138 | 686 KB | tall, date clusters |
| `shrub` | vegetation | 1.38 x 1.42 x 1.04 | 104 | 220 KB | leaf cards + core |
| `car_sedan` | context | 4.78 x 1.99 x 1.44 | 930 / 264 / 80 | 76 KB | M_Body = paint (tint per instance) |
| `car_suv` | context | 4.88 x 2.09 x 1.74 | 918 / 260 / 76 | 76 KB | M_Body = paint |

Budgets met: vehicles LOD0 2.2k-11k (2k-15k), jet bridge 14.2k for all three LODs (<= 20k),
furniture 56-372 (20-400), palms <= 2.5k (<= 4k).

## Runtime contract (frontend notes)

### Hierarchy and naming

```
<asset>                      root empty (glTF extras: skypact_asset, skypact_category, lods, morph_targets...)
  LOD0                       empty  (furniture / shrub: LOD0 is the mesh itself)
    Body | Wheels | Lift     meshes (one per role; multi-material -> three.js Group of Meshes)
    UPPER_SNAKE empties      attachment points (only under LOD0)
  LOD1                       Body_LOD1, Wheels_LOD1, Lift_LOD1
  LOD2                       Body_LOD2, Wheels_LOD2, Lift_LOD2
```

Names inside `LOD1`/`LOD2` carry an `_LOD1`/`_LOD2` suffix because three.js `GLTFLoader` would
otherwise rename duplicates to `Name_1`, `Name_2` unpredictably. Match by prefix or append the
suffix. LOD1 is 20-35 % and LOD2 3.5-10 % of LOD0 (see `manifest.json -> lod_ratios`); the few
values under the ~25 % / ~5 % guideline are vehicles whose LOD0 budget is dominated by detailed
wheels (LOD1/LOD2 use 3-band and capped-cylinder wheels), i.e. cheaper, not coarser.

### Wheels: `_AXLE`

Every `Wheels*` mesh has a custom vertex attribute `_AXLE` (VEC3 float; three.js exposes it as
`geometry.attributes._axle`) holding that wheel's axle centre. Blender's glTF exporter does not
convert custom attributes to +Y up, so the generator stores the value already in glTF / three.js
local coordinates `(x, y_up, z = -forward)`. Spin each vertex about the local X axis through
`_axle` (same scheme as the aircraft `Wheels` in CONVENTIONS 3.1). Duals are merged at LOD2.

### Lift morph targets

`Lift*` meshes (belt loader boom, catering box, ambulift cabin, stairs, main deck loader platforms)
carry morph targets. Weight 0 is the exported transport pose, 1 the full range (table above / manifest
`notes`). Interpolation is linear, which is visually exact for translations and close enough for
the scissor arms. Apply the same weights to all three LODs; a raised lift can leave the base
bounding sphere, so expand it or set `frustumCulled = false` on raised instances.

```js
lift.traverse(o => { if (o.isMesh && o.morphTargetDictionary) {
  o.morphTargetInfluences[o.morphTargetDictionary.Raise] = t;   // 0..1
}});
```

### Jet bridge runtime contract

Bridge frame: rotunda centre on the ground at the origin, bridge along +Y (three.js -Z).
Each LOD group contains `JB_Rotunda`, `JB_Tunnel_A`, `JB_Tunnel_B`, `JB_DriveColumn` (with child
`JB_DriveColumn_Lift`), `JB_Cab` (suffixed in LOD1/LOD2). All parts are siblings, so the runtime
sets each one's transform in the bridge frame. Key numbers: rotunda floor 5.0 m, A and B 14 m
long, B travels 3.5-12.0 m along A (rest 7.0) riding 7 cm above A's floor, cab pivot 13.3 m
along B, drive column mount 11.0 m along B, cab bumper face (`CAB_DOCK`) 3.22 m ahead of the pivot.
Rotunda centre to bumper: 21.5-30.0 m. B always fits inside A (clearances >= 1.5 cm, brush seal
in A's front collar). Recommended limits: A yaw +-90 deg (service stairs sit in the rear-left
quadrant); pitch -8..+6 deg (below about -5 deg the inner lift columns extend under the bogie
frame, largely hidden by bogie and tyres; above +6 deg they leave the sleeves); cab yaw +-45 deg
relative to the tunnel (beyond that the cab head meets tunnel B).

Reference implementation (used for `jet_bridge_pose_*.png`, `kit_sheet.py: pose_bridge`):

```js
// UP = (0,1,0), X = (1,0,0); `parts` = the five JB_* nodes (+ JB_DriveColumn_Lift) of one LOD group
// rest constants: read once from LOD0 empties (Object3D.position = parent-local, three.js axes)
const mount = TUNNEL_A_MOUNT.position;       // in root space (JB_Rotunda sits at the origin)
const bMin = TUNNEL_B_RETRACTED.position, bMax = TUNNEL_B_EXTENDED.position;   // A-local
const pivot = CAB_PIVOT.position, colMount = DRIVE_COLUMN_MOUNT.position;      // B-local
function pose(parts, yaw, pitch, t, cabYaw) {        // radians; t in [0,1]
  const qYaw = new Quaternion().setFromAxisAngle(UP, yaw);
  const qA = qYaw.clone().multiply(new Quaternion().setFromAxisAngle(X, pitch)); // +pitch raises the far end
  parts.A.position.copy(mount).applyQuaternion(qYaw);  parts.A.quaternion.copy(qA);
  parts.B.position.copy(bMin).lerp(bMax, t).applyQuaternion(qA).add(parts.A.position);
  parts.B.quaternion.copy(qA);
  parts.Cab.position.copy(pivot).applyQuaternion(qA).add(parts.B.position);
  parts.Cab.quaternion.setFromAxisAngle(UP, yaw + cabYaw);          // cab stays level
  const m = colMount.clone().applyQuaternion(qA).add(parts.B.position);
  parts.Column.position.set(m.x, 0, m.z);  parts.Column.quaternion.copy(qYaw);
  parts.Lift.position.set(0, m.y, 0);      // child of the column: yoke top meets B's underside
}
```

To dock, solve yaw / pitch / t / cabYaw so that `CAB_DOCK` (cab-local, floor level, bumper face)
coincides with the aircraft `DOOR_*` sill and the cab faces the fuselage.

### Materials

Contract names (CONVENTIONS 3.2): `M_Body` (recolourable paint; default per asset: white GSE,
yellow tractor/loader, blue cart, red ARFF, light grey bridges), `M_Trim` (secondary paint /
plastics), `M_Glass` (dark glass; alpha 0.28 BLEND in `jet_bridge_glass`, panes double-faced),
`M_Rubber`, `M_Metal`, `M_Lights`, `M_Beacon` (amber, emissive strength 2), `M_Hazard`
(black/yellow stripe texture, box-projected at 0.2 m stripe pitch), `M_SignFace`.

Extra names used by this kit: `M_SignFaceBack` (taxi-sign back face, UV 0-1), `M_Decal`
(alpha-masked 1024 px atlas: FOLLOW ME, checker band, wheelchair symbol, JET A-1, TERMINAL LED
display, chevrons, AIRPORT RESCUE & FIREFIGHTING, solid white / yellow / red patches),
`M_Luggage` (16-colour palette), `M_Trunk` (colour + normal map), `M_Frond` and `M_Foliage`
(alpha MASK, double-sided), `M_Fence` (alpha MASK chain link, double-sided).

`M_Lights` uses a 4x4 colour palette texture as base colour and emissive (emissive factor 1):
each lens maps to one texel block (warm / cool white, red, tail red, amber, blue, green...),
so one material covers head, tail and indicator lights. Light lenses are lit by default; dim or
boost `emissiveIntensity` for day/night. The inset light lens is white so it can be tinted per
light colour group (clone the material per colour).

Only constant Principled values and generated image textures are used; the files need the
`KHR_materials_emissive_strength` extension only. No Draco (as required).

### Signs, decals, furniture specifics

* `taxi_sign`: front face (+Y) `M_SignFace` and back face `M_SignFaceBack`, both UV 0-1 with text
  reading correctly from each side; default textures are a neutral black face with a yellow border.
* Fences tile along X from the origin (blast fence 6.0 m, perimeter fence 3.0 m; one post per
  segment). `windsock`: rotate child `Sock` about local Z (pivot at the mast top) to point downwind (+Y).
* Approach lights, PAPI and the ILS localizer aim / radiate towards +Y.

## Verification

`verify_glbs.py` (latest run): 37/37 assets pass. For every GLB it runs
`npx --yes @gltf-transform/cli inspect` and `... validate` (Khronos validator: 0 errors, 0
warnings; INFO only: empty attachment nodes, TEXCOORD_0 on untextured primitives) and checks root
name, LOD children, empties under LOD0 and UPPER_SNAKE_CASE, jet-bridge parts in every LOD,
material names, `_AXLE` sanity (max vertex distance from axle = wheel radius), morph target
default weights = 0, triangle budgets and LOD ratios. Face winding was audited twice because
three.js culls back faces: visually with `render_previews.py --debug-backface` (red = visible back
face) and geometrically with `audit_normals.py` (every face of every LOD, all directions; the
remaining hits are thin trim panels in front of solids longer than its 6 m probe, checked by hand).

## Deviations from CONVENTIONS / notes

1. Jet bridge LODs: CONVENTIONS lists the five parts; here every `LODn` group contains the full part
   set (LOD1/LOD2 names suffixed) plus a child `JB_DriveColumn_Lift` so the lift column can
   telescope without stretching the tyres. The runtime poses the parts of the visible LOD (or all three).
2. Mesh/part names inside LOD1/LOD2 carry `_LOD1`/`_LOD2` suffixes (convention silent on this).
3. Extra materials beyond section 3.2 (listed above); `M_Lights` is a palette texture, not a constant.
4. `_AXLE` (defined for aircraft) is also used for vehicles and stored in glTF (+Y up) coordinates.
5. Lifting vehicles expose morph targets (`Raise`, `Extend`, `RaiseRear`) on a `Lift` node.
6. Furniture and the shrub ship `LOD0` only (the convention allows instanced furniture to skip LODs).
7. Tunnel B's origin is on its own floor; B rides 7 cm above A's floor (the empties include it).
8. Window / decal / panel-line quads float 3-12 mm proud of the body; at grazing angles a hairline
   gap may be visible (they are culled from behind).
9. Generic, unbranded designs inspired by common equipment classes; no manufacturer liveries.
