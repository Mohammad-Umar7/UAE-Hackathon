# Assets, data and software licences

SKYPACT uses only openly licensed inputs. This register covers everything shipped in `frontend/` and everything the
offline pipelines consume. Data sources are documented in detail in [DATA_SOURCES.md](DATA_SOURCES.md).

## 3D models (original work)

| Asset | Path | Origin | Licence |
|---|---|---|---|
| Aircraft fleet: `nb` narrow-body twin, `wb` wide-body twin, `vla` double-deck, `cargo` freighter, `biz` business jet, `reg` turboprop (3 LODs each) | `frontend/public/assets/aircraft/*.glb` | Procedurally generated for this project in Blender 5.1 by `pipeline/blender/aircraft` | Project licence |
| Jet bridges, ground support equipment, airfield furniture, palms, cars | `frontend/public/assets/equipment/*.glb` | Procedurally generated for this project by `pipeline/blender/equipment` | Project licence |
| Signature terminals and towers (when present) | `frontend/public/assets/airports/*.glb` | Procedurally generated for this project by `pipeline/blender/airports` from OSM footprints and public reference facts | Project licence; footprints derived from OSM (ODbL) |

The aircraft are original models *inspired by* aircraft categories (A320neo-class, 787-9-class, A380-class, 747-8F-class,
G650-class, ATR 72-class). They are not replicas of any manufacturer's product and carry fictional liveries only. The
11 airlines in the simulation (Saqr Airways, Majlis Air, Dune Air, Sahra Air, Gulfline Regional, Najm Cargo, Falconet
Executive, Meridian Pacific, Borealis Airlines, Deccan Wings, Silk Freight) and their emblems are fictional and drawn
procedurally at runtime.

## Textures and lighting

| Asset | Path | Source | Licence |
|---|---|---|---|
| `aerial_sand`, `concrete_floor_02`, `aerial_asphalt_01`, `asphalt_02`, `dirt_aerial_02` (1k diffuse/normal/roughness) | `frontend/public/textures/` | [Poly Haven](https://polyhaven.com) | CC0 1.0 |
| `kloofendal_48d_partly_cloudy_puresky` (1k HDRI) | `frontend/public/hdri/` | [Poly Haven](https://polyhaven.com) | CC0 1.0 |
| Facade, decal, runway-designator, fog-noise and light-pool textures | generated at runtime | procedural (this project) | Project licence |

## Map and reference data

| Data | Path | Licence / attribution |
|---|---|---|
| Airport layouts (runways, taxiways, aprons, stands, buildings, roads, land use, city context) | `data/airports/*/layout.json`, `frontend/public/data/airports/` | © OpenStreetMap contributors, ODbL 1.0 (derived database; heuristic fields marked `derived`) |
| National coastline, roads, places | `data/national/`, `frontend/public/data/national/` | © OpenStreetMap contributors, ODbL 1.0 |
| Urban areas, emirate boundaries | `data/national/urban_areas.geojson`, `emirates.geojson` | Natural Earth, public domain |
| Sentinel-2 cloudless 2016 mosaic (optional, not shipped to the browser) | `data/national/s2_mosaic.jpg` | EOX IT Services GmbH, CC BY 4.0 (contains modified Copernicus Sentinel data 2016) |
| Runway dimensions, thresholds, ARP, elevations | `data/reference/` | UAE GCAA eAIP — factual values with citations |
| Building heights, tower facts, architectural descriptions | `data/reference/` | Public sources cited per fact (facts only, no text copied) |

Attribution shown in the app: “© OpenStreetMap contributors (ODbL)” and “Natural Earth”.

## Software (runtime dependencies)

| Package | Version | Licence |
|---|---|---|
| three | 0.186.1 | MIT |
| @react-three/fiber | 9.8.2 | MIT |
| @react-three/drei | 10.7.9 | MIT |
| @react-three/postprocessing | 3.2.2 | MIT |
| postprocessing | 6.39.5 | Zlib |
| n8ao | 2.0.1 | ISC |
| camera-controls | 3.1.2 | MIT |
| highs (HiGHS solver, WebAssembly) | 1.15.4 | MIT |
| next | 16.4.3 | MIT |
| react / react-dom | 19.3.0 | MIT |
| zustand | 5.0.16 | MIT |
| tailwindcss | 4.3.3 | MIT |
| @radix-ui primitives | 1.x–2.x | MIT |
| lucide-react | 1.61.0 | ISC |
| d3-scale / d3-shape | 4.0.2 / 3.2.0 | ISC |
| Inter / JetBrains Mono (via @fontsource-variable) | 5.3.0 | SIL Open Font Licence 1.1 |

Build-time tools: @gltf-transform (MIT), meshoptimizer (MIT), vitest (MIT), TypeScript (Apache-2.0), ESLint (MIT),
Blender 5.1 (GPL; used only as a tool — generated assets are not GPL), Python packages listed in
`pipeline/pyproject.toml` (osmium/pyosmium BSD-2-Clause, shapely BSD-3-Clause, pyproj MIT, numpy BSD-3-Clause,
networkx BSD-3-Clause, matplotlib PSF-based, requests Apache-2.0, pyshp MIT, Pillow MIT-CMU).

Optional: [Ollama](https://ollama.com) (MIT) with the `qwen2.5:3b` model (Apache-2.0), running locally.
