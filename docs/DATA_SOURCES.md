# SKYPACT — data sources, licences and derivation rules

Every external input used by SKYPACT, its licence, when it was retrieved and what it feeds. Other
workstreams append their own sections (Blender textures, fonts, …) at the end. Retrieval date for
everything below: **2026-10-26** (Gulf Standard Time evening; Geofabrik snapshot 2026-10-25T21:21:21Z).

Required attribution in the running app (map/credits panel):
**"© OpenStreetMap contributors (ODbL 1.0)"**, **"Natural Earth (public domain)"**,
**"Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus
Sentinel data 2016), CC BY 4.0"**, plus author + licence for any Wikimedia Commons photo that is shown.

## 1. Sources

| # | Source | Licence | URL / identifier | Used for |
|---|---|---|---|---|
| 1 | OpenStreetMap, Geofabrik "GCC States" extract `gcc-states-261025.osm.pbf` (244 MB, md5 `903174491fa477c1dde45ba79a427daa`, data up to 2026-10-25T21:21:21Z) | ODbL 1.0, © OpenStreetMap contributors | https://download.geofabrik.de/asia/gcc-states-261025.osm.pbf | all airport geometry (runways, taxiways, aprons, stands, gates, jet bridges, buildings, roads, landuse, coastline), surrounding city and Dubai skyline buildings, national coastline / major roads / place names |
| 2 | Natural Earth 10m cultural: `ne_10m_urban_areas` (v4.1.0), `ne_10m_admin_1_states_provinces` (v5.1.1) | Public domain | https://naciscdn.org/naturalearth/10m/cultural/ne_10m_urban_areas.zip, …/ne_10m_admin_1_states_provinces.zip | `data/national/urban_areas.geojson`, `emirates.geojson` |
| 3 | EOX Sentinel-2 cloudless **2016** layer `s2cloudless_3857` (WMTS, z11, 144 tiles) | CC BY 4.0 (stated in the layer abstract of https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml; the 2018+ layers are CC BY-NC-SA 4.0 and are **not** used; the CC BY 2017 layer has no imagery over most of the UAE) | https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg | optional `data/national/s2_mosaic.jpg` (+ `s2_mosaic.json` bounds) |
| 4 | UAE GCAA eAIP, AD 2 OMAA / OMDB / OMSJ (AIRAC AMDT 12/2026, diffed against 09/2026) | Official aeronautical publication; only factual values (coordinates, elevations, dimensions) are used, with citations | https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html (and OMAA, OMSJ) | ARP = origin of each local frame, runway widths, landing thresholds / displaced thresholds, threshold elevations, OSM cross-check |
| 5 | Wikipedia, airport operators, architects, press (facts only, no text copied) | facts; see per-fact URLs | listed per fact in `data/reference/airports.md` / `.json` | terminal / tower / cargo descriptions, reference heights (DXB Concourses A 42 m, B 39.5 m, D 27 m; DXB tower 89 m; AUH tower 109 m) |
| 6 | Wikimedia Commons reference photos (URLs only — **no image was downloaded**) | per file: CC BY / CC BY-SA / CC0 / PD, verified on each file page | listed in `data/reference/airports.json` (`photos`) | visual reference for modellers |

Not used: Overpass API. On 2026-10-26 overpass-api.de (and z./lz4.) answered 502 "at capacity",
overpass.kumi.systems and overpass.private.coffee timed out and maps.mail.ru returned 504, so instead of
retrying many queries the pipeline makes **one** polite bulk download (source 1) and cuts everything
locally with pyosmium. The OSM main API was reachable but is not meant for bulk reads.

## 2. Pipeline (`pipeline/osm`, Python ≥ 3.11 via `uv`)

```
uv sync --project pipeline
uv run --project pipeline python pipeline/osm/fetch_osm.py          # PBF download (cached) -> raw JSON extracts
uv run --project pipeline python pipeline/osm/build_layout.py       # -> data/airports/<ICAO>/layout.json + debug files
uv run --project pipeline python pipeline/osm/build_national.py     # -> data/national/*.geojson (needs the layouts)
uv run --project pipeline python pipeline/osm/fetch_s2_mosaic.py    # optional raster (tiles cached)
uv run --project pipeline python pipeline/osm/validate_layouts.py   # schema + connectivity checks (exit 1 on failure)
```

Everything after the first download is offline and deterministic. Caches: the PBF, Natural Earth zips,
Sentinel tiles and `national_raw.json` live in `pipeline/osm/cache/` (git-ignored, 284 MB). Raw OSM
extracts per airport (Overpass-style JSON, geometry as `[lon, lat]` pairs):
`data/airports/<ICAO>/osm_raw.json` (airport core box: 14.7 / 22.9 / 3.5 MB for OMAA / OMDB / OMSJ) and
`osm_context_raw.json` (surrounding city box + DXB skyline: 11.7 / 26.4 / 13.1 MB). They are only
needed to re-run `build_layout.py`; consider git-LFS or ignoring them if the repository must stay small.

Files produced per airport: `layout.json` (contract in `docs/CONVENTIONS.md` §4, extra fields §4.1),
`debug_layout.png`, `debug_graph_check.txt`, `runway_crosscheck.json`.

| Modules | Role |
|---|---|
| `config.py` | ARPs (GCAA AIP), extraction boxes, national bbox, cache paths |
| `fetch_osm.py` | download + md5 check of the PBF, 3-pass pyosmium extraction (multipolygon relations, ways with node locations, tagged nodes); drops regional features such as the Arabian Gulf / Rub' al Khali polygons |
| `osmutil.py` | tag parsing, multipolygon ring assembly, aeqd projector, coastline → land/sea faces |
| `taxigraph.py` | taxi-graph topology (junctions, snapping, splitting, merging, fragment bridging) |
| `stands.py` | stand derivation, duplicate / MARS handling, conflicts, ids, wingspans |
| `build_layout.py` | orchestration, runways, buildings, surfaces, context, derived taxilanes, stand linking, exits, output |
| `debug_plot.py`, `validate_layouts.py`, `build_national.py`, `fetch_s2_mosaic.py` | as named |

## 3. Frames and conventions

* Projection per airport: `+proj=aeqd +lat_0=<ARP lat> +lon_0=<ARP lon> +datum=WGS84 +units=m`, ARP from
  the AIP: OMAA 24.4330556 N 54.6511111 E (242559N 0543904E, elev 25.3 m), OMDB 25.2527778 N 55.3644444 E
  (251510N 0552152E = 12R displaced threshold, elev 18.9 m), OMSJ 25.3291667 N 55.5161111 E (251945N
  0553058E, elev 36.3 m). Coordinates rounded to 0.1 m. Headings are true, geodesic (pyproj Geod).
* `bounds` = aerodrome polygon extent; `context_bounds` = extent of everything else.

## 4. Derivation rules (everything not literally in OSM)

### Runways
* Centreline = all `aeroway=runway` line pieces with the same `ref` (main way + `runway=displaced_threshold`
  pieces); stopways and the OMAA "13H/31H" helicopter strip are excluded. Ends = extreme points along
  the principal axis; designators assigned by matching the bearing with designator×10 + 2° E variation.
* Width = AIP (all 60 m, equal to OSM). `length_m` = geodesic OSM length (AIP length in `aip_length_m`).
* Landing thresholds = AIP threshold coordinates projected onto the OSM centreline (graph node inserted);
  pavement end = OSM end (`end_node`).
* Exits: every runway junction with a taxiway edge leaving at ≤ 100° to the landing direction and
  ≥ 150 m beyond the landing threshold; `angle_deg` measured over the first 60 m of the exit; `rapid`
  if 15–45°. Taxiway ways that start such a rapid exit are listed with `kind: "rapid_exit"`.

### Taxi graph
* Inputs: OSM `aeroway=taxiway|taxilane` lines (not area, not disused/construction) + runway pieces +
  derived apron taxilanes (below). Widths: OSM `width`, else 23 m taxiway / 15 m taxilane.
* Nodes at shared OSM nodes, way ends and every geometric crossing; dangling ends within 3 m snapped
  onto the nearest line; remaining dangling taxiway ends extended along their direction to a line
  ≤ 25 m away (≤ 45 m when the target is a runway centreline); nodes < 3 m apart merged.
* Fragments not connected to the runway component: bridged if the gap is ≤ 30 m (edge `source: derived`),
  else dropped (OMAA one 290 m stub, OMSJ the 1.1 km of terminal-apron turn-in lines that OSM leaves
  57 m short of the network — stands there use their OSM lead-ins instead). Result: one component.
* **Derived apron taxilanes** (`source: "derived"`, OMAA 26 rows / OMDB 1): where OSM maps stands but no
  taxi line lies behind them within 150 m (the apron of the new Zayed Terminal A has no taxilanes in
  OSM), a line is drawn through points 80 m (contact) / 65 m (remote) behind the stop points of
  side-by-side stands (same heading ± 25°, ≤ 110 m apart), straightened (best-fit line when the
  residual ≤ 15 m), extended ±40 m and connected along its direction (≤ 350 m) or to the nearest
  taxiway (≤ 250 m) without crossing buildings or runway strips (75 m half-width).

### Stands
* OSM `aeroway=parking_position` nodes, lead-in ways and closed ways (centroid). Lead-in ways that
  cross a taxi line are split there (lines drawn across a taxilane mark the stands on both sides);
  ways sharing a node are one lead-in network unless the shared node lies on a taxi line (different
  stands entering from the same point) or the refs differ.
* Stop point = network end farthest from the taxi lines (if both ends are off the network: the end
  nearer to a terminal facade, else the straight end), or a parking_position node lying on the last
  45 m of the lead-in. Lead-ins are trimmed where they first come within 3 m of a taxi edge (walking
  back from the stand). Heading = direction of the last 15 m; for node-only stands: nose towards the
  nearest terminal/concourse facade (simplified outline) if within 80 m, else away from the nearest taxi line.
* Removed: positions inside hangars/buildings (DXB Emirates Engineering hangars 6, OMAA 2). Merged:
  stop points < 12 m apart with similar heading and L/R pairs of the same base ref < 20 m apart
  (DXB uses L/R for alternative lead-ins; e.g. `B18L`+`B18R` → `B18`, originals in `alt_refs`).
* Ids: OSM `ref` (duplicate refs far apart get `-2`); unnamed contact stands take the nearest OSM gate
  ref (`gate`, e.g. Zayed Terminal A `B12`); others `P01…` (OMAA/OMDB) / `S01…` (OMSJ: OSM has no stand refs).
* `contact`: a ray along the heading hits a terminal/concourse footprint within 70 m (or the stop point
  is ≤ 25 m from the facade and facing it); at airports that map jet bridges (DXB 194, SHJ 10 ways) an
  OSM `aeroway=jet_bridge` must also be within 35 m (so DXB Terminal 2, a bus-gate terminal, has none).
  `bridge_root` = building end of that jet bridge, else the nearest facade point, pushed 1.5 m outwards.
* `max_wingspan_m` = min over simultaneously usable neighbours (wing reference point 20 m aft of the
  nose gear, longitudinal offset < 45 m) of lateral spacing − 7.5 m, also limited by the lateral room
  to non-terminal buildings (2 × (distance − 7.5 m)), clamped to [12, 80]. `size_code` from that value
  (A<15, B<24, C<36, D<52, E<65, F≤80). `bridge_count` = 1 (≤C), 2 (D/E), 3 (F) for contact stands.
* `kind`: contact; cargo if the apron/area is named cargo or a cargo building is < 140 m away and no
  terminal < 250 m; ga near royal/presidential/executive/GA buildings or aprons; else remote.
* `area`: contact building name, else apron name/ref, else "<nearest named building> apron".
* `conflicts`: MARS centre vs L/R and any stop points < 25 m apart (not usable at the same time).
* Derived stands (`source: "derived"`, `derivation` says why): 6 OMAA / 1 OMDB synthetic contact stands
  along long facades facing an apron without OSM stands (72 m pitch, nose gear 22 m off the facade), and
  stands at dead ends of taxiway spurs inside aprons (OMAA 10, OMDB 6, OMSJ 6; the spur's last edge
  becomes the stand_link).
* Linking: entry on the nearest taxiway/taxilane of the main component via (in order, first one not
  crossing a building) the trimmed OSM lead-in, the lead-in start (≤ 30 m), the lead-in extended
  backwards, a straight line back along the stand centreline, or a smooth Bézier from the nearest taxi line.

### Buildings
* Airport buildings = OSM building outlines whose representative point is inside the aerodrome
  polygon (+25 m) or that carry aeroway tags / airport names. If an outline contains `building:part`s,
  the parts are emitted (with `part_of`) plus the remainder of the outline.
* `kind`: tower (aeroway=tower/control_tower, man_made=tower near aeroway, "control tower"),
  fire_station, car_park (building=parking/carport, amenity=parking, "short/long term park"),
  concourse ("concourse"/"pier"), cargo (cargo/freight/logistics names, warehouses), terminal
  (aeroway/building=terminal or "terminal"), hangar, other (incl. mosques).
* `height_m`: OSM `height` → `building:levels` × 3.5 (+2 m for terminals) → reference height
  (DXB Concourse A 42 m, B 39.5 m, D 27 m; tower: AUH 109 m only if untagged, DXB 89 m) → defaults:
  terminal 28, concourse 22, hangar 26, cargo 15, tower 45 (old towers 35), fire station 9, car park 14,
  carport 3, other 5/7/10/14 m by footprint size. `height_source` records which rule applied.
  Control towers mapped only as nodes (DXB, SHJ) get an 18 m-diameter derived footprint.
* `context_buildings`: outlines within 3 km of the aerodrome boundary (simplified 1.5 m, ≥ 25 m²; OSM
  heights or levels × 3.5, else by building type / footprint) plus, for DXB, every building or part
  with an OSM height/levels ≥ 60 m within 15.5 km of the ARP (Dubai skyline; tall buildings emitted as
  their `building:part`s, e.g. Burj Khalifa up to the 828 m spire).

### Roads, landuse, water
* Roads: OSM highways (no footways/paths/tracks; city service roads > 300 m from the airside dropped)
  within the 3 km ring, clipped; width from `width`, `lanes` × 3.5 or class defaults (motorway 11 per
  carriageway, trunk 10.5, primary 9, secondary 7.5, tertiary 7, residential 6, service 4.5); metro and
  rail lines as `kind: "rail"`; bridge/tunnel/layer flags kept.
* Landuse kinds: grass (grass, grassland, meadow, pitch), sand (sand, beach, scrub, bare rock,
  brownfield), water (water, basin, reservoir, marina + sea polygons built from `natural=coastline`),
  parking (amenity=parking areas), landscaping (parks, gardens, wood, golf, wetland/mangrove).

### National basemap (`data/national`, EPSG:4326, coordinates 1e-5°)
* `land.geojson`: OSM coastline polygonised against the bbox (land = left of the way direction),
  simplified ~15 m. `roads.geojson`: motorway/trunk/primary merged by class+ref+name, ~10 m.
  `places.geojson`: OSM place nodes (cities/towns; villages/suburbs/islands with an English name).
  `urban_areas.geojson`, `emirates.geojson`: Natural Earth (includes the Omani governorates inside the
  bbox). `airports.geojson`: ARPs, aerodrome outlines, runway centrelines from the layouts.
  `manifest.json`: file list and sizes (0.97 MB GeoJSON in total).
* `s2_mosaic.jpg` 3072×3072 px, EPSG:3857, z11 (76.4 m/px); bounds in `s2_mosaic.json`. 11 open-sea
  tiles have no imagery in the layer and EOX paints partly covered sea tiles navy: both are filled with
  one flat sea colour (documented in the sidecar).

## 5. Known gaps

* OMSJ: no stand refs in OSM (ids `S01…` are derived; the AIP numbers passenger stands 1A–40 and cargo
  stands 50–62); the terminal-apron turn-in lines are disconnected in OSM (dropped from the graph).
* OMAA: the Terminal A apron has no taxilanes in OSM (derived, see above); ~half of the stands have no
  ref (ids from gates or `P..`); no jet bridges are mapped, so contact stands come from geometry only.
* DXB: Concourse C height not researched (default 22 m); Terminal 1/2/3 heights default 28 m.
* Building heights are mostly defaults (OSM has few height tags at these airports); landside building
  heights in the city are default estimates unless OSM has `height`/`building:levels`.
* Stand wingspan limits, bridge counts, contact/remote classification and the derived taxilanes are
  heuristics, not operational data — label them `derived` in any UI.
