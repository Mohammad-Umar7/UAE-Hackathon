# Limitations and honest scope

SKYPACT is a hackathon prototype for decision support. This page lists what it deliberately does not do and where
its models are simplified, so results are read in the right light.

## Data

* **Flights are synthetic.** Schedules, passenger counts, connections, passengers with reduced mobility and fuel
  endurance are generated deterministically from a seed. The 11 airlines are fictional. Nothing represents real
  airline, airport or air-navigation operational data.
* **Capacities are modelled values** (arrival/departure rates, diversion acceptance per hour, handling teams,
  ambulifts). They are plausible planning figures, not declared or official capacities.
* **Airport geometry comes from OpenStreetMap** and is cross-checked against the GCAA AIP for runways and thresholds.
  Stand wingspan limits, jet-bridge counts and some apron taxilanes are derived by documented heuristics where public
  data is silent (marked `derived` in the layouts). Building heights are estimated when OSM has none.
* **Weather is scripted per scenario** (fog, thunderstorms, rain). There is no live METAR/TAF feed; METAR strings in the
  UI are generated from the simulated observation.

## Operations models

* **No ATC function.** SKYPACT proposes landing-sequence targets and diversions for review by authorised ATC staff and
  never issues clearances. Arrival management uses 15-minute capacity buckets and does not model wake-turbulence
  separation, approach procedures or airspace structure. A landing-sequence target fixes a flight's order and its
  latest landing time; the simulated arrival manager still lands it earlier when capacity, spacing and its stand allow.
* **Ground movement** follows the taxi graph with a nose-gear point-mass model (curvature-limited speeds, accelerations,
  pushback and tows). Taxiing aircraft are not deconflicted from each other on the ground.
* **Turnarounds** are limited by minimum turnaround time, handling teams and ambulifts; individual ground vehicles
  in the 3D twin are staged from the turnaround timeline for visualisation, not tracked as separate resources.
* **Fuel** is represented as a per-flight holding endurance beyond the estimated arrival time. When it runs out, the
  crew diverts on its own (an uncoordinated diversion), which plans try to avoid.

## Optimisation and agents

* The recovery model is a **time-indexed MILP** with landing slots every 5 minutes near the earliest feasible time
  and every 10–15 minutes further out, discrete ground-wait steps, a one-hour window for stand changes combined with
  holding, and a 3-hour planning horizon. The branch-and-bound search is bounded by a node limit for determinism. Each candidate
  shows its solver status: “Optimal” means proven within a 0.5 % relative gap for this model; otherwise the
  node limit stopped the search first and the plan is not proven optimal.
* Each flight is offered its **current stand plus a few ranked alternatives** (stands other flights already hold rank
  lower) to keep the model small enough to solve in seconds. In heavy disruption a flight near the end of the planning
  horizon can be left with a long delay on its own stand where an airport would simply use another free stand; the
  next planning cycle revisits it.
* **Projections** compare three policies from the same state. The plan projection applies the plan's decisions and
  handles everything the plan does not cover exactly like the local-only baseline, so the difference between the two
  is the value of network coordination. Total delay is dominated by runway capacity and moves little; the plans'
  measurable effect is mostly on airborne holding, crew fuel diversions and stand conflicts.
* Agents are **deterministic programs** with explicit tools, permissions and message contracts. The optional local
  language model only writes the plan briefing: it is shown only if every number in it is a digit taken from the
  plan's facts, stated changes go in the right direction and it stays short and in the third person; otherwise the
  deterministic briefing is shown. It never makes or changes a decision.
* When stakeholders are not operated by a person, their responses come from **simulated policies** that use only
  that stakeholder's local information. They illustrate the coordination protocol; they are not models of real people.

## Product

* **No integration** with A-CDM, AODB, AMAN/DMAN, resource management or airline systems. The pilot plan describes
  the interfaces a real deployment would need.
* **No authentication.** Roles can be switched freely in the demo; permissions are still enforced for each role.
* **Desktop browsers with WebGL 2** are the target. The digital twin of Dubai International is the heaviest scene and
  needs a discrete or recent integrated GPU for a smooth frame rate.
* The signature terminal and tower models are stylised originals that make each airport recognisable; they are not
  surveyed architectural models.
