# Pitch

## One line

**SKYPACT turns a fog night across three UAE airports from a chain of phone calls into one coordinated, approved,
auditable recovery plan in minutes.**

## The problem

When fog, convective weather, a runway closure or a blocked stand hits one of the UAE's main airports, the effects
spread across the network within the hour: arrival rates drop, aircraft hold, stands that were planned are no longer
free, and some flights must divert. Abu Dhabi, Dubai and Sharjah are less than 150 km apart, so they are each other's
natural alternates. Today the decisions that matter — which flight waits, which stand it gets, which alternate takes
whom — are made by different organisations, with different information, under time pressure, often by phone.

What goes wrong is rarely a lack of data. It is that:

* each airport optimises locally and discovers the network effect too late (stand conflicts, ground waits, fuel
  diversions to an alternate that is itself saturated);
* critical local facts (an ambulift out of service, handling teams reassigned) are not in the shared picture;
* decisions are hard to explain and audit afterwards.

## The solution

A national recovery-coordination layer that sits above the airports' own systems:

1. **Sees** the three airports as one network — live digital twins built from real layouts, and a simulator that
   projects the next hours of operations.
2. **Plans** with seven cooperating agents and a mathematical optimiser that jointly assigns landing slots, stands,
   tows and coordinated diversions under hard constraints: stand fit, runway capacity, fuel, alternate eligibility,
   handling and accessibility resources.
3. **Coordinates** the people who own each decision — airport controllers, airlines, ATC, the national supervisor —
   with requests scoped to what each must approve, and learns local constraints through their responses.
4. **Proves** its value: every plan is compared with doing nothing and with each airport acting alone, validated
   independently, approved by humans, committed only after re-validation, and recorded in a tamper-evident log.

## Why it is responsible AI

* People stay in charge: no plan executes without the approvals its content requires; SKYPACT issues no clearances.
* Every recommendation is explainable down to the constraint and the rejected alternatives.
* Determinism and replay make the system testable and auditable; synthetic data is labelled as such.
* Accessibility is a hard constraint, not a weight.
* It runs on-premises and offline: no personal data, no external AI services.

## Demo (3 minutes)

Operation Nightfall — fog at Zayed International at 18:00, a runway inspection and a blocked stand at Dubai
International, passengers needing full assistance, and Sharjah constraints nobody else knows about. See
[DEMO_SCRIPT.md](DEMO_SCRIPT.md).

## What is real in the prototype

* Real airport geometry (OpenStreetMap, cross-checked with the GCAA AIP), real sun position, real optimisation
  (HiGHS mixed-integer programming), real agent workflows with permissions, real approvals and audit chain.
* Synthetic: flights, airlines, capacities and weather. The prototype demonstrates the method, not today's traffic.

## Who pays and why

GCAA and the national/emirate aviation authorities (network resilience, oversight, after-action reviews), airport
operators (fewer stand conflicts and ground waits, better use of contact stands), airlines (fewer uncoordinated
diversions and missed connections). See [BUSINESS_MODEL_CANVAS.md](BUSINESS_MODEL_CANVAS.md).

## Next step

A 90-day shadow-mode pilot with historical and live A-CDM feeds from one airport pair, measuring decision time and
plan quality against what actually happened. See [PILOT_PLAN.md](PILOT_PLAN.md).

## Pitch structure (5 minutes)

| Time | Beat |
|---|---|
| 0:00–0:30 | The fog night: one airport's problem becomes three airports' problem. |
| 0:30–1:00 | What is missing today: a network view, shared constraints, fast joint decisions, accountability. |
| 1:00–4:00 | Live demo (Present mode): fog → agents → options → Sharjah's local knowledge → human approval → execution → evidence. |
| 4:00–4:30 | Responsible AI: humans approve, no clearances, explainable, replayable, offline. |
| 4:30–5:00 | Pilot ask: 90 days, shadow mode, one airport pair, measurable outcomes. |
