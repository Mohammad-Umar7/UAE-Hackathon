# Benchmarks

Measured with the real OSM-derived layouts (`frontend/public/data/airports`) and Operation Nightfall, seed 7.

```bash
cd frontend
SKYPACT_BENCH=1 npx vitest run src/core/__tests__/bench.test.ts
```

Machine: Intel Core i7-14700HX, 16 GB RAM, Windows 11, Node.js 22.20 (V8; the browser runs the same TypeScript and
the same HiGHS WebAssembly build). Single run; expect ±20 % between runs.

| Measurement | Result |
|---|---|
| Build registry (3 layouts: taxi graphs, stands, taxi-time tables) | 223 ms |
| Layout size | 516 stands · 2,375 taxi-graph nodes |
| Generate Nightfall world (schedules, incidents, weather) | 37 ms · 561 aircraft visits |
| Simulate 6 h, three airports, full kinematics, no plans | 662 ms (≈ 32,600× real time) |
| Build recovery problem at 18:35 (all airports) | 68 ms · 166 movable flights · 682 home-stand options · 803 diversion options · 333 fixed occupancies |
| Solve three MILP variants (HiGHS, sequential) | 9.8 s total |
| · Lowest total delay | Optimal (≤ 0.5 % gap) · 3.6 s · 11,212 variables · 7,966 constraints |
| · Least disruption to existing assignments | Optimal · 2.5 s · same model size |
| · Fewest cross-airport coordination requests | Optimal · 3.3 s · same model size |
| Independent validation of the recommended plan | 4 ms · 606 checks · 0 violations |
| 4-hour look-ahead projection (fast mode) | 0.29 s no action · 0.22 s with plan |

In the browser the three variants are solved in parallel in a pool of web workers, so the recovery agent's
optimisation step takes about as long as the slowest variant (≈ 3–4 s on this machine) while the 3D views keep
rendering.

## Projected effect of the recommended plan (same state, 4-hour look-ahead)

| Metric | No coordinated action | Recommended plan |
|---|---|---|
| Total delay (arrival + departure) | 12,602 min | 11,814 min |
| Airborne holding | 5,443 min | 3,128 min |
| Projected stand conflicts | 15 | 5 |
| Uncoordinated fuel diversions (crew decisions) | 36 | 6 |

These are simulation outcomes on synthetic traffic, not forecasts for the real airports. Delay counts a diverted
flight's arrival when it is back at its destination and its outbound departure when it leaves again (both censored
at the end of the look-ahead), so baselines with many crew diversions are not flattered.

## Optimisation history (same scenario and time)

| Version | Variables | Constraints | Three variants | Notes |
|---|---|---|---|---|
| Initial formulation | 37,605 | 21,697 | 50.1 s | 5-minute slots everywhere, 10 home options per flight, 5 stands per alternate |
| Current | 11,212 | 7,966 | 9.8 s | progressive slot grid (5/10/15 min), 3 alternatives for flights whose stand stays free, one-hour window for stand changes, 3 stands per alternate, 0.5 % gap target |
