# Architecture

SKYPACT is a single-page application. All operational logic runs in TypeScript in the browser; heavy optimisation
runs in a Web Worker. Offline pipelines (Python for OpenStreetMap, headless Blender for 3D assets) produce the static
data the app loads.

## Runtime components

| Module | Path | Responsibility |
|---|---|---|
| Domain model | `frontend/src/core/types.ts`, `world.ts` | Visits (one aircraft's stay: inbound leg, turnaround, outbound leg) with A-CDM milestones (ETA, ELDT, ALDT, AIBT, TOBT, TSAT, AOBT, ATOT), stands, restrictions, incidents, weather, resources. The world is plain data so it can be structured-cloned to the worker. |
| Airport registry | `core/airports/` | Builds each airport from `layout.json`: taxi graph (Dijkstra with binary heap), runway ends, exits, stands with services and zones, taxi-time tables, MARS stand conflicts. |
| Simulator | `core/sim/engine.ts` | Deterministic discrete-event engine (seeded sfc32 RNG). Arrival manager with 15-minute capacity buckets, departure sequencing, turnarounds limited by handling teams and ambulifts, fuel-driven crew diversions, recovery legs back to the home airport, tows, weather tracks. Events carry a per-visit generation counter so superseded events are ignored. |
| Kinematics | `core/sim/movement.ts`, `movementEval.ts` | Approach (3° glide path), landing roll, taxi on graph centrelines with curvature speed limits, pushback, pivot, line-up, take-off roll, climb. The same `positionAt` drives the simulator and every 3D frame. |
| Scenarios | `core/sim/scenarios.ts`, `schedule.ts` | Deterministic schedule generation per airport and seed; scenario A–I and Nightfall incident factories; Scenario Lab injections. |
| Optimiser | `core/solver/` | `problem.ts` turns the current world into a recovery problem (movable flights, options, fixed occupancies, capacities, resources); `milp.ts` writes a CPLEX-LP time-indexed MILP and solves it with HiGHS; `validate.ts` re-derives every hard constraint independently; `evaluate.ts` projects policies forward with the simulator. |
| Agents | `core/agents/` | Seven agents with tool permissions, typed messages and recorded actions; the orchestrator runs workflows (detect → assess → plan → validate → coordinate → commit), holds the clock while agents compute, and handles staleness and re-planning. |
| Approvals | `core/approvals/` | Roles and permissions, required approval slots per proposal, proposal lifecycle (PROPOSED → APPROVED → COMMITTED, or REJECTED / STALE / SUPERSEDED / REVISION_REQUESTED), SHA-256 hash-chained audit log. |
| Runtime | `core/runtime.ts` | Owns the world, engine, orchestrator, proposals and audit; records every human input for deterministic replay; exposes the only mutating API the UI may use (inject, decide, set mode, replan, run/pause/speed). |
| Compute | `core/compute.ts`, `workerCompute.ts`, `workers/compute.worker.ts` | `ComputeClient` interface; in-process (tests) and Web Worker (app) implementations for solve and projection. |

## Data flow of a disruption

1. **Detect.** The engine emits domain events (incident started, stand conflict, fuel diversion, weather category
   change). The Weather agent classifies material changes and publishes a `DisruptionNotice`.
2. **Assess.** Airport Operations projects the next hours with a *no action* policy (shared information only) and
   reports stand conflicts, holding and fuel-diversion risk; Airline Operations lists affected flights and connections;
   the ATC Liaison reads modelled capacities and restrictions.
3. **Plan.** The Recovery agent builds the problem (`build_recovery_problem`), solves three objective variants
   (`run_optimizer`), evaluates them against *no action* and *local greedy* by simulation (`evaluate_plans`), and
   recommends one with reasons (`compare_plans`).
4. **Validate.** The Validation agent checks every decision against the current world independently of the solver and
   computes the approvals each plan requires.
5. **Coordinate.** The Coordination agent creates the proposal and sends a request to each required slot. Humans decide
   in the workbench; simulated stakeholders answer from their own local information. A rejection that reveals local
   information (e.g. Sharjah's equipment log) is shared and triggers a re-plan with the revealed restriction.
6. **Commit.** When every required slot has approved (ATC acknowledges) and re-validation passes, decisions are applied
   to the simulation. Evidence projections are computed from the pre-commit state.
7. **Watch.** Every minute the Validation agent re-checks open proposals; changed inputs make a proposal STALE and a new
   version is planned.

## Determinism and replay

* All randomness comes from seeded generators keyed by scenario id and seed.
* The optimiser is bounded by a branch-and-bound node limit (not wall time) with a fixed random seed.
* Agents are deterministic; stakeholder response delays are drawn from seeded generators.
* Human inputs (injections, approvals, mode changes, replan requests) are recorded with their simulation time and
  replayed at the same instants. `Replay from start` and `Re-simulate to T` reproduce the same run.

## 3D

* **National map** (`src/three/NationalMap.tsx`): equirectangular projection at 1 unit = 1 km; OSM coastline and roads,
  Natural Earth urban areas, traffic positions derived from simulated ETAs on synthetic routes, coordination arcs;
  labels are DOM elements positioned by a projector (`ScreenAnchors.tsx`).
* **Digital twin** (`src/three/twin/`): geometry built once per airport from `layout.json` (runways with ICAO markings and
  displaced thresholds, taxiways, aprons, stand markings, buildings, roads, land use, city context, airfield lights);
  instanced aircraft and equipment kits with LODs (`assets.ts`, `instancing.ts`); per-frame poses from the simulator
  (`poses.ts`); jet-bridge docking solver and turnaround staging (`Apron.tsx`); sun position for the scenario day,
  sky, image-based lighting, height fog from visibility, rain and lightning (`Atmosphere.tsx`, `fog.ts`,
  `FogBanks.tsx`); stand status, routes and plan-preview overlays (`Overlays.tsx`); screen-space labels and picking
  (`Labels.tsx`); camera modes (`CameraRig.tsx`); ambient occlusion, bloom, SMAA and AgX tone mapping.

## Offline pipelines

* `pipeline/osm` — one Geofabrik PBF → pyosmium extracts → layouts with a connected taxi graph, runway exits,
  stands with lead-ins and derived capabilities, buildings with heights, roads, land use and city context; validated by
  `validate_layouts.py`. See [DATA_SOURCES.md](DATA_SOURCES.md).
* `pipeline/blender` — headless Blender generators for aircraft, equipment and signature airport buildings; exports
  raw GLBs with the material/empty contracts in [CONVENTIONS.md](CONVENTIONS.md).
* `pipeline/optimize_assets.mjs` — glTF-Transform (dedup, prune keeping attachment empties, weld, quantise, meshopt);
  articulated assets keep float transforms.
