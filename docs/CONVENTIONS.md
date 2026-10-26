# SKYPACT — shared engineering conventions

Every workstream (data pipeline, Blender assets, backend simulation, frontend 3D) follows this file.
If something here is wrong or missing, fix it here first and then update the code.

## 1. Repository layout

```
backend/                 Python 3.11 (uv) — FastAPI, simulation, CP-SAT solver, agents, approvals
frontend/                Next.js + TypeScript + React Three Fiber
  public/assets/         optimized runtime assets (GLB, textures) served to the browser
pipeline/
  osm/                   OpenStreetMap download + geoprocessing scripts (Python)
  blender/
    common/              shared Blender helpers (materials, export, preview rendering)
    aircraft/            aircraft generator scripts
    equipment/           jet bridge, GSE, airfield furniture generator scripts
    airports/            per-airport airfield + terminal builders
  build/raw/             raw Blender GLB exports (before optimization)  [not committed]
  previews/              PNG preview renders of generated assets (for review)
data/
  airports/<ICAO>/       layout.json (+ raw OSM extract, debug plots)
  national/              regional basemap data (coastline, roads, urban areas)
  reference/             researched public reference facts with source URLs
docs/                    documentation
```

Never write outside your workstream's folders without coordinating. Do not run `git commit`; the lead commits.

## 2. Units, time and coordinates

* Units: metres, seconds, degrees. Headings are **true** headings in degrees, clockwise from true north, range [0, 360).
* Simulation time: integer/float **seconds since 00:00 local time (GST, UTC+4) on the synthetic scenario day**. Values above 86400 mean "next day".
* Each airport has a local tangent-plane frame (ENU) centred on its Aerodrome Reference Point (ARP):
  * projection: `+proj=aeqd +lat_0=<ARP lat> +lon_0=<ARP lon> +datum=WGS84 +units=m`
  * `x` = metres east, `y` = metres north, `z` = metres up. Ground (airfield datum) is `z = 0`.
* Blender scenes use the same frame directly: Blender `(X, Y, Z) = (east, north, up)`.
* glTF export uses the default `+Y up` conversion, so in three.js: `three.x = east`, `three.y = up`, `three.z = -north`.
  * Layout point `(x, y)` → `new Vector3(x, 0, -y)`.
  * An object whose forward axis is Blender `+Y` faces three.js `-Z`. To face heading `θ` (deg): `object.rotation.y = -θ · π/180`.

## 3. Asset conventions (Blender → glTF)

* Real-world scale in metres. Apply all transforms before export. Shade smooth with sharp edges where appropriate (use "Smooth by Angle" / auto smooth around 30–40°).
* Forward = Blender `+Y`; up = `+Z`; left = `-X`, right = `+X`.
* Export: `bpy.ops.export_scene.gltf(export_format='GLB', export_yup=True, export_apply=True, export_extras=True, export_attributes=True, ...)`, no Draco (optimization is done afterwards by `pipeline/optimize_assets.mjs` with gltf-transform/meshopt).
* Raw exports go to `pipeline/build/raw/<category>/<name>.glb`. Optimized runtime copies go to `frontend/public/assets/<category>/<name>.glb`.
* Materials must be glTF-exportable: Principled BSDF with constant values or image textures only. Procedural textures must be baked to images first.
* Material names are part of the runtime contract (the frontend finds materials by name to recolour, add weather wetness, or switch emissive lights at night). Use the names listed per asset type below.
* Every asset has `LOD0` (full detail), `LOD1` (~25–35% triangles) and `LOD2` (~5–10% triangles, silhouette only) as top-level child nodes of a root node named after the asset. Instanced small furniture may skip LODs.
* Empties (nodes without meshes) mark runtime attachment points. They live under `LOD0` and are named exactly as specified (UPPER_SNAKE_CASE).
* Preview renders: `pipeline/previews/<category>/<name>_<view>.png` (three-quarter, side, top, close-up).

### 3.1 Aircraft

Origin = **nose-gear tyre contact point** (x = 0 on the centreline, y = 0 at the nose-gear axle, z = 0 = ground with gear down). The nose points `+Y`. Stand stop points and taxi paths in `layout.json` are nose-gear positions, so placing an aircraft is: origin at the point, rotation from heading.

Material slots (runtime recolours `M_Paint_*` per airline):

| Material | Use |
|---|---|
| `M_Paint_Top` | upper fuselage (default white gloss) |
| `M_Paint_Belly` | lower fuselage below the cheatline (default light grey) |
| `M_Paint_Cheatline` | thin band along the fuselage |
| `M_Paint_Tail` | vertical stabiliser (and tail-cone sweep if styled) |
| `M_Paint_Engine` | engine nacelle outer cowling |
| `M_Wing` | wings, horizontal stabiliser, pylons (grey paint) |
| `M_Metal` | bare metal: inlet lips, exhaust cones, gear struts, leading-edge strips |
| `M_Dark` | tyres, inlet interiors, fan face, de-icing boots |
| `M_Window` | cabin windows (dark gloss) |
| `M_Cockpit` | cockpit glazing |
| `M_Lights` | light lenses (emissive at runtime) |
| `M_PanelLine` | door outlines / control-surface hinge gaps (dark, slightly inset) |
| `M_TailLogo` | decal quads `LOGO_L`, `LOGO_R` on the fin, UV 0–1 each |
| `M_Titles` | decal strips `TITLE_L`, `TITLE_R` on the upper fuselage, UV 0–1 each |

Decal UV rule: text drawn normally (left-to-right, upright) in a 0–1 texture must read correctly on both sides. On `TITLE_L`/`LOGO_L` (port side) `u` increases nose→tail; on `TITLE_R`/`LOGO_R` (starboard side) `u` increases tail→nose; `v` increases upward.

Required empties under `LOD0`: `DOOR_L1` (front-left passenger door sill centre, at the fuselage skin), `DOOR_L2` (wide-bodies), `DOOR_UL1` (A380-like upper deck), `DOOR_NOSE` / `DOOR_MAIN_CARGO` (freighter), `LIGHT_NAV_L`, `LIGHT_NAV_R`, `LIGHT_TAIL`, `LIGHT_BEACON_TOP`, `LIGHT_BEACON_BOTTOM`, `LIGHT_STROBE_L`, `LIGHT_STROBE_R`, `LIGHT_LANDING_L`, `LIGHT_LANDING_R`, `LIGHT_TAXI`, `TUG_HITCH` (nose-gear tow point), `ENGINE_1`.. (fan face centres).

Wheels: all wheels of a LOD are one mesh named `Wheels` with material `M_Dark`/`M_Metal` and a per-vertex custom attribute `_AXLE` (FLOAT_VECTOR, point domain) holding that wheel's axle centre in the object's local space. The runtime spins wheels in the vertex shader around the local X axis through `_AXLE`. Propellers (turboprop) are separate nodes `PROP_L`, `PROP_R` with origin at the hub, spinning about local `+Y`.

### 3.2 Equipment / vehicles

Origin at ground level, centre of the footprint; front = `+Y`. Materials: `M_Body` (recolourable main paint), `M_Trim`, `M_Glass`, `M_Rubber`, `M_Metal`, `M_Lights` (emissive at night), `M_Beacon` (amber rotating beacon), `M_Hazard` (black/yellow stripe image texture), `M_SignFace` (sign face, UV 0–1 for runtime text).

Jet bridge (apron-drive), built in a local frame with the rotunda centre at the origin and the bridge extending along `+Y`:
`JB_Rotunda` (fixed; floor surface at `z = 5.0`), `JB_Tunnel_A` (outer section, origin at rear end on the floor centreline, length 14 m), `JB_Tunnel_B` (inner telescoping section, same origin rule, length 14 m), `JB_DriveColumn` (lift column + wheel bogie, origin on the ground under the column), `JB_Cab` (head + canopy, origin at the rotation pivot on the floor centreline, canopy facing `+Y`). The runtime positions these parts to dock with an aircraft's `DOOR_*` empty.

## 4. Airport layout contract — `data/airports/<ICAO>/layout.json`

```jsonc
{
  "icao": "OMDB", "iata": "DXB", "name": "Dubai International Airport", "city": "Dubai",
  "arp": { "lat": 25.2528, "lon": 55.3644, "elevation_m": 19 },
  "projection": "+proj=aeqd +lat_0=... +lon_0=... +datum=WGS84 +units=m",
  "bounds": { "min_x": 0, "min_y": 0, "max_x": 0, "max_y": 0 },
  "provenance": { "osm_timestamp": "...", "license": "ODbL 1.0 © OpenStreetMap contributors", "notes": [] },
  "runways": [{
    "id": "12L/30R", "width_m": 60, "length_m": 4447, "surface": "asphalt",
    "ends": [ { "designator": "12L", "x": 0, "y": 0, "heading_true": 119.6, "threshold_node": 12 },
              { "designator": "30R", "x": 0, "y": 0, "heading_true": 299.6, "threshold_node": 98 } ],
    "exits": [ { "node": 40, "from_end": "12L", "distance_from_threshold_m": 2100, "angle_deg": 30, "rapid": true } ],
    "source": "osm:way/123; length/width cross-checked with AIP/Wikipedia (see data/reference)"
  }],
  "taxiways": [ { "id": "osm-w123", "ref": "A", "kind": "taxiway|taxilane|rapid_exit", "width_m": 23, "points": [[0,0],[0,0]] } ],
  "aprons":   [ { "id": "osm-w456", "ref": "...", "polygon": [[0,0]], "holes": [] } ],
  "buildings":[ { "id": "osm-w789", "kind": "terminal|concourse|hangar|cargo|tower|fire_station|car_park|other",
                  "name": "...", "footprint": [[0,0]], "holes": [], "height_m": 25, "levels": 3, "source": "osm|derived" } ],
  "stands": [{
    "id": "B12", "ref": "B12", "x": 0, "y": 0, "heading": 210.0,
    "lead_in": [[0,0],[0,0]], "kind": "contact|remote|cargo|ga",
    "contact": true, "bridge_root": [0,0], "bridge_count": 2,
    "max_wingspan_m": 65.0, "size_code": "E",
    "entry_node": 301, "stop_node": 302, "area": "Concourse B", "source": "osm:node/...|derived"
  }],
  "taxi_graph": {
    "nodes": [ { "id": 0, "x": 0, "y": 0 } ],
    "edges": [ { "a": 0, "b": 1, "kind": "taxiway|taxilane|runway|stand_link", "ref": "A", "length_m": 0, "points": [[0,0],[0,0]] } ]
  },
  "roads":    [ { "kind": "motorway|primary|service|...", "width_m": 7, "points": [[0,0]] } ],
  "landuse":  [ { "kind": "grass|sand|water|parking|landscaping", "polygon": [[0,0]], "holes": [] } ],
  "context_buildings": [ { "footprint": [[0,0]], "height_m": 12 } ]
}
```

* `stands[].x, y` = nose-gear stop point. `heading` = direction the nose points when parked.
* `taxi_graph` polylines are nose-gear tracks. Runway centrelines are included as `kind: "runway"` edges split at every taxiway junction, so landing aircraft can exit.
* Every `stand` has `entry_node` (on a taxilane) and `stop_node` (the stand) connected by a `stand_link` edge that follows the lead-in line.
* Capabilities that public data cannot provide (stand wingspan limits, bridges) are derived by documented heuristics and marked `"source": "derived"`.

## 5. Aircraft type catalogue (public dimensions, rounded)

| Key | Inspired by | ICAO code letter | Length m | Span m | Height m | Notes |
|---|---|---|---|---|---|---|
| `nb` | A320neo-family narrow-body | C | 37.6 | 35.8 | 11.8 | twin under-wing turbofans, sharklets |
| `wb` | 787-9-class wide-body twin | E | 62.8 | 60.1 | 17.0 | raked wingtips, chevron nozzles, 4-window cockpit |
| `vla` | A380-class double-deck | F | 72.7 | 79.8 | 24.1 | 4 engines, wingtip fences, 22 main wheels |
| `cargo` | 747-8F-class freighter | F | 76.3 | 68.4 | 19.4 | upper-deck hump, nose cargo door, no cabin windows |
| `biz` | G650-class business jet | C | 30.4 | 30.4 | 7.8 | T-tail, rear-mounted engines, large oval windows |
| `reg` | ATR 72-class turboprop | C | 27.2 | 27.1 | 7.7 | high wing, T-tail, 6-blade propellers |

Models are original procedural creations *inspired by* these categories. They are not replicas of any manufacturer's product, and they carry fictional liveries only.

## 6. Data provenance labels

Every operational value carries one of: `verified_public` (with source), `synthetic`, `human_entered`, `derived`. Synthetic flight data uses fictional carriers only. Never present synthetic data as real airline or airport operational data.

## 7. Hard rules

* No API keys, paid services, or credentials anywhere. The finished demo runs offline.
* Only Abu Dhabi Zayed International (OMAA/AUH), Dubai International (OMDB/DXB) and Sharjah International (OMSJ/SHJ).
* Only openly licensed inputs (OSM/ODbL, CC0, CC-BY, public domain). Record each source in `docs/DATA_SOURCES.md`.
* SKYPACT is decision support only: no autonomous ATC clearances, and nothing executes without the required human approvals.
