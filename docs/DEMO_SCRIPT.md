# Three-minute demo script — Operation Nightfall

Setup: `cd frontend && npm run dev`, open <http://localhost:3000> full screen (1600×900 or larger). Optional: Ollama
running with `qwen2.5:3b` for the plan briefing. On the welcome card click **Watch the guided demo** (or **Guided demo**
in the top bar); use → / Space to advance, ← to go back, Esc to leave. Stay in **Simple** mode for an audience. Every step drives the live system; you can take over at any point with the normal controls.

| Time | Step (guided demo) | On screen | Say |
|---|---|---|---|
| 0:00 | 1 · Three airports, one network | Overview: national map, a card per airport, the Now bar (“all normal for now”). | “Abu Dhabi, Dubai and Sharjah are each other's alternates, less than 150 km apart. SKYPACT treats them as one network. Everything you see runs in this browser: a simulator, seven AI agents, an optimiser — and people who approve.” |
| 0:20 | 2 · Thick fog at Abu Dhabi | 3D airport (AUH) from OpenStreetMap, close on the gates. The clock fast-forwards at 90× to 18:06: fog layer forms, stop bars and approach lights glow, LVP badge, arrival rate drops to 12/h. | “At six, radiation fog. Visibility below 550 metres, low-visibility procedures, half the arrival rate. Inbound flights start holding — and fuel is finite.” |
| 0:45 | 3 · The AI agents get to work | AI agents: the scene shows each agent in the order it acts, messages flying between them and the story on the right; click the planning agent to show its card, or press **Replay the conversation**. | “The agents use real tools on the shared picture: a projection finds stand conflicts and fuel-diversion risk, airlines add connection constraints, and the Recovery agent solves a mixed-integer program in a web worker. Every message and tool call is inspectable.” |
| 1:10 | 4 · Before & after, predicted | Before & after: on the left the evening if nobody acts (planes stacking up circling, low-fuel diversions, gate clashes), in the middle the plan, on the right the same evening with the plan; below, the chart of planes circling over four hours and what each agent did. Hover the chart; switch it to **Low-fuel diversions**. | “Same simulator, same moment, two futures. Without coordination the red line keeps climbing: aircraft circle until crews must divert on low fuel. With the plan, flights go to Sharjah or Dubai before anyone runs short. The safety-check agent has re-checked every rule — and nothing runs until people approve.” |
| 1:35 | 5 · Sharjah knows something the system didn't | AI agents: Sharjah's controller said no (in red in the story), the fact is shared, the agents re-planned. | “Sharjah knows something the network doesn't: its ambulifts and wide-body handling teams are out. It rejects with the reason, the fact becomes shared, and the agents re-plan around it.” |
| 2:00 | 6 · People decide | Decision: “Who must approve” — airports and airlines approved, air traffic noted. Click **Approve the plan**. | “No plan executes without the people responsible. ATC only acknowledges — SKYPACT never issues clearances. The final approval is the supervisor's.” |
| 2:20 | 7 · The plan runs | 3D airport: violet plan arcs turn teal, aircraft taxi to their new stands, jet bridges dock. | “Committed decisions drive the operation: stand changes, landing slots, coordinated diversions. If anything changes, the plan is flagged stale and re-planned, not executed blindly.” |
| 2:40 | 8 · Before & after, approved | Before & after again, now re-run from the moment of approval: the plan is marked approved by everyone, the cards show the change, the agent strip ends with “People in charge”. | “Measured, not claimed: both futures re-run from the moment of approval. Fewer emergency diversions, far less circling, no gate clashes — and even if each airport had rearranged its own gates, most of the diversions would remain. That gap is what coordination adds.” |
| 2:55 | 9 · Every step can be replayed and audited | Replay + audit chain verified. | “Every input is recorded; the night replays exactly; the audit chain proves who approved what.” |

## Backup moves

* If the network is slow to produce a proposal, stay on step 3: the working agent pulses and says what it is doing.
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
