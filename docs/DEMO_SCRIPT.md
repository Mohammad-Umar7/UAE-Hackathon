# Three-minute demo script — Operation Nightfall

Setup: `cd frontend && npm run dev`, open <http://localhost:3000> full screen (1600×900 or larger). Optional: Ollama
running with `qwen2.5:3b` for the plan briefing. Click **Present** in the top bar; use → / Space to advance, ← to go
back, Esc to leave. Every step drives the live system; you can take over at any point with the normal controls.

| Time | Step (Present mode) | On screen | Say |
|---|---|---|---|
| 0:00 | 1 · One network, three airports | Command view: national map, three airport cards with METARs, empty recovery queue. | “Abu Dhabi, Dubai and Sharjah are each other's alternates, less than 150 km apart. SKYPACT treats them as one network. Everything you see runs in this browser: a simulator, seven AI agents, an optimiser — and people who approve.” |
| 0:20 | 2 · Fog at Zayed International | Digital twin of AUH from OpenStreetMap. The clock runs at 120× to 18:06: fog layer forms, stop bars and approach lights glow, LVP badge, arrival rate drops to 12/h. | “At six, radiation fog. Visibility below 550 metres, low-visibility procedures, half the arrival rate. Inbound flights start holding — and fuel is finite.” |
| 0:45 | 3 · Agents detect, assess and plan | Agents view: messages fly between Weather, Airport Ops, Airline Ops, ATC, Recovery; the clock pauses while the optimiser runs. | “The agents use real tools on the shared picture: a projection finds stand conflicts and fuel-diversion risk, airlines add connection constraints, and the Recovery agent solves a mixed-integer program in a web worker. Every message and tool call is inspectable.” |
| 1:10 | 4 · Optimised options, compared honestly | Workbench: three candidates against ‘no coordinated action’ and ‘each airport alone’; validation badge; ‘Why this plan’. | “Three options, each scored against doing nothing and against local-only decisions, from the same state. Validation re-derives every hard constraint independently — stands, runway capacity, fuel, accessibility.” |
| 1:35 | 5 · Local knowledge changes the plan | Agents view: Sharjah's controller rejects; a ‘local information shared’ message; re-plan. | “Sharjah knows something the network doesn't: its ambulifts and wide-body handling teams are out. It rejects with the reason, the fact becomes shared, and the agents re-plan around it.” |
| 2:00 | 6 · People decide | Workbench approvals: airports and airlines approved, ATC acknowledged. Click **Approve as National Supervisor**. | “No plan executes without the people responsible. ATC only acknowledges — SKYPACT never issues clearances. The final approval is the supervisor's.” |
| 2:20 | 7 · Execution in the twin | Twin: violet plan arcs turn teal, aircraft taxi to their new stands, jet bridges dock. | “Committed decisions drive the operation: stand changes, landing slots, coordinated diversions. If anything changes, the plan is flagged stale and re-planned, not executed blindly.” |
| 2:40 | 8 · Measured, not claimed | Evidence: before/after against no action and local-only. | “Delay, airborne holding, uncoordinated diversions, passengers needing assistance — measured from the same starting point.” |
| 2:55 | 9 · Replayable and auditable | Replay + audit chain verified. | “Every input is recorded; the night replays exactly; the audit chain proves who approved what.” |

## Backup moves

* If the network is slow to produce a proposal, stay on step 3 and open a tool call in the log (parameters, result,
  duration) — it shows the agents working.
* If a plan goes stale while you talk, that is the system working: point at the reason (“inputs changed”) and the new
  version.
* To show the twin in detail: click an aircraft (drawer with A-CDM times), **Follow**, or switch **Day / Dusk /
  Night**. Click a stand to see its occupancy and services.
* Scenario Lab: inject a thunderstorm at DXB or a runway closure live to show that nothing is scripted.

## Facts to have ready

* Airports: OMAA/AUH Zayed International, OMDB/DXB Dubai International, OMSJ/SHJ Sharjah International; layouts from
  OpenStreetMap, runways and thresholds cross-checked with the GCAA AIP.
* Synthetic: flights, 11 fictional airlines, capacities, weather. Real: geometry, sun position, optimisation,
  agents' workflow, approvals and audit.
* Optimiser: HiGHS mixed-integer programming (WebAssembly), three objective variants solved in parallel web workers.
