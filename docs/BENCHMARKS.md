# Benchmarks

Measured with the real OSM-derived layouts (`frontend/public/data/airports`) and Operation Nightfall, seed 7.

```bash
cd frontend
SKYPACT_BENCH=1 npx vitest run src/core/__tests__/bench.test.ts
```

Machine: Intel Core i7-14700HX, 16 GB RAM, Windows 11, Node.js 22.20 (V8; the browser runs the same TypeScript and
the same HiGHS WebAssembly build). Two consecutive runs agreed within 3 %; expect ±20 % between machines and runs.

| Measurement | Result |
|---|---|
| Build registry (3 layouts: taxi graphs, stands, taxi-time tables) | 174 ms |
| Layout size | 516 stands · 2,375 taxi-graph nodes |
| Generate Nightfall world (schedules, incidents, weather) | 41 ms · 561 aircraft visits |
| Simulate 6 h, three airports, full kinematics, no plans | 0.7 s (≈ 30,000× real time) |
| Build recovery problem at 18:35 (all airports) | 70 ms · 166 movable flights · 682 home-stand options · 770 diversion options · 333 fixed occupancies |
| Solve three MILP variants (HiGHS, sequential) | 18.7 s total |
| · Lowest total delay | Optimal (≤ 0.5 % gap) · 4.1 s · 10,936 variables · 2,526 constraints |
| · Least disruption to existing assignments | Optimal · 7.4 s · same model size |
| · Fewest cross-airport coordination requests | Optimal · 6.9 s · same model size |
| Independent validation of the recommended plan | 3 ms · 726 checks · 0 violations |
| 4-hour look-ahead projection (fast mode) | 0.27 s per policy |

In the browser the three variants are solved in parallel in a pool of web workers, so the recovery agent's
optimisation step takes about as long as the slowest variant (≈ 7–8 s on this machine) while the 3D views keep
rendering; the simulation clock is held meanwhile so results stay deterministic.

## Projected effect of the recommended plan (same state, 4-hour look-ahead)

| Metric | No coordinated action | Local-only reassignment | Recommended plan |
|---|---|---|---|
| Total delay (arrival + departure) | 12,602 min | 11,860 min | 11,712 min |
| Passenger delay | 28,066 pax·h | 26,320 pax·h | 23,030 pax·h |
| Airborne holding | 5,443 min | 5,437 min | 3,021 min |
| Projected stand conflicts | 15 | 0 | 1 |
| Uncoordinated fuel diversions (crew decisions) | 36 | 36 | 5 |

These are simulation outcomes on synthetic traffic, not forecasts for the real airports. The plan is projected on
top of the same local first-fit handling as the local-only baseline, so the last two columns differ only by network
coordination. Delay counts a diverted flight's arrival when it is back at its destination and its outbound departure
when it leaves again (both censored at the end of the look-ahead), so baselines with many crew diversions are not
flattered. Total delay is bounded by runway capacity and moves least; the coordination shows mostly in passenger
delay, airborne holding and crew fuel diversions.

## Optimisation history (same scenario and time)

| Version | Variables | Constraints | Three variants | Notes |
|---|---|---|---|---|
| Initial formulation | 37,605 | 21,697 | 50.1 s | 5-minute slots everywhere, 10 home options per flight, 5 stands per alternate |
| Progressive slot grid | 11,212 | 7,966 | 9.8 s | 5/10/15-minute slot grid, 3 alternatives for flights whose stand stays free, one-hour window for stand changes, 3 stands per alternate, 0.5 % gap target |
| Exact handling and stand pairs | 11,014 | 8,389 | 24.6 s | handling-team rows at every turnaround start, conflicting stand pairs, unresolved flights keep their stand (needed for agreement with the validator) |
| Current | 10,936 | 2,526 | 18.7 s | only maximal stand-clique and resource rows (a row implied by the next one is dropped; identical optimal objectives), alternatives ranked against stands other flights hold |
