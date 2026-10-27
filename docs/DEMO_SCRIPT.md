# Three-minute demo script — Operation Nightfall

Setup: `cd frontend && npm run dev`, open <http://localhost:3000> full screen (1600×900 or larger). Optional: Ollama
running with `qwen2.5:3b` for the plan briefing. On the welcome card click **Watch the guided demo** (or **Guided demo**
in the top bar); use → / Space to advance, ← to go back, Esc to leave. Stay in **Simple** mode for an audience. Every step drives the live system; you can take over at any point with the normal controls.

| Time | Step (guided demo) | On screen | Say |
|---|---|---|---|
| 0:00 | 1 · Three airports, one network | Overview: national map, a card per airport, the Now bar (“all normal for now”). | “Abu Dhabi, Dubai and Sharjah are each other's alternates, less than 150 km apart. SKYPACT treats them as one network. Everything you see runs in this browser: a simulator, seven AI agents, an optimiser — and people who approve.” |
| 0:20 | 2 · Thick fog at Abu Dhabi | 3D airport (AUH) from OpenStreetMap. The clock fast-forwards to 18:00 and stops as the fog forms: the fog banks roll in, stop bars and approach lights glow, the arrival rate drops to 12 an hour. | “At six, radiation fog. Abu Dhabi can land 12 planes an hour instead of 30. Inbound flights start circling — and fuel is finite. Now watch what the agents do.” |
| 0:40 | 3 · Watch the agents handle it | AI agents, following: the camera zooms to each agent as it acts, a message flies to whoever hears about it, and the caption says what happened with the key numbers — the weather agent's warning, the airport agent's prediction if nobody acts (with the curve of planes circling), the flights and passengers hit, the runway limit, the optimiser's plan, the safety check, the approvals. The clock runs while the agents work; the step ends at “the final yes is yours”. | “Each agent has one job and one set of tools. The prediction is a real simulation four hours ahead; the plan comes from a mixed-integer optimiser in a web worker; a separate agent re-checks every rule. Nothing runs until people agree.” |
| 1:35 | 4 · Before & after, predicted | Before & after: first one real flight on two maps — without SKYPACT it reaches Abu Dhabi in the fog, circles and diverts to Dubai on low fuel; with the plan it is sent to Sharjah early and lands at a reserved gate. Below: the evening if nobody acts, the plan, the same evening with the plan, and the chart of both futures. Hover the chart; switch it to **Low-fuel diversions**. | “Same simulator, same moment, two futures. Take this Frankfurt flight with 271 passengers… Across every flight, the red line keeps climbing without coordination; with the plan, flights go to Sharjah or Dubai before anyone runs short.” |
| 2:00 | 5 · People decide | Decision: who must approve — airports and airlines approved, air traffic noted. Sharjah's duty manager answers on a phone on screen (approve it, or say no with a reason to see the agents re-plan); then click **Approve the plan**. | “No plan executes without the people responsible. Sharjah's duty manager is out on the apron, so the request reaches a phone; if Sharjah can't do what the plan asks — its wheelchair lifts are broken tonight — they say no and the agents re-plan. ATC only acknowledges; SKYPACT never issues clearances. The final approval is the supervisor's.” |
| 2:20 | 6 · The plan runs | Overview: teal arcs carry the approved flights from Abu Dhabi to Sharjah and Dubai (“9 flights sent to Sharjah · approved”). | “Committed decisions drive the operation: coordinated diversions, landing times, gate changes. If anything changes, the plan is flagged stale and re-planned, not executed blindly.” |
| 2:40 | 7 · Before & after, approved | Before & after again, re-run from the moment of approval: the same flight, the cards with the change, the agent strip ending with “People in charge”. | “Measured, not claimed: both futures re-run from the moment of approval. Far fewer emergency diversions, far less circling, no gate clashes — and even if each airport had rearranged its own gates, most of the diversions would remain. That gap is what coordination adds.” |
| 2:55 | 8 · Every step can be replayed and audited | Replay + audit chain verified. | “Every input is recorded; the night replays exactly; the audit chain proves who approved what.” |

## Backup moves

* If the network is slow to produce a proposal, stay on step 3: the camera waits for the next agent and the working agent says what it is doing. Use the caption's ◀ ❚❚ ▶ to pause or step through.
  Clicking a step of the story opens the recorded message (parameters, result, duration).
* For a technical audience, switch to **Expert** (bottom of the navigation): the full message and tool-call log, the
  swim-lane sequence, every decision, METARs and optimiser statistics come back.
* The optimiser step holds the clock for roughly 10 seconds on a laptop (three mixed-integer programs of about
  10,000 binary variables, one per web worker). Talk over it, or, in Expert mode, open the `run_optimizer` call
  afterwards: the inspector shows the first lines of the model sent to HiGHS.
* If a plan goes stale while you talk, that is the system working: point at the reason (“inputs changed”) and the new
  version.
* To show the 3D airport in detail: click an aircraft (drawer with A-CDM times) and **Follow** it, or try
  **Cinematic**. Click a gate to see its occupancy and services. Day / dusk / night lighting is in Expert mode.
* Scenarios: inject a thunderstorm at DXB or a runway closure live to show that nothing is scripted; **Skip to next
  event** fast-forwards until it starts.

## Facts to have ready

* Airports: OMAA/AUH Zayed International, OMDB/DXB Dubai International, OMSJ/SHJ Sharjah International; layouts from
  OpenStreetMap, runways and thresholds cross-checked with the GCAA AIP.
* Synthetic: flights, 11 fictional airlines, capacities, weather. Real: geometry, sun position, optimisation,
  agents' workflow, approvals and audit.
* Optimiser: HiGHS mixed-integer programming (WebAssembly), three objective variants solved in parallel web workers.
