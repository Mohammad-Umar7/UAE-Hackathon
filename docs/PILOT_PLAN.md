# 90-day pilot plan

**Goal:** show, in shadow mode and with real data, that SKYPACT produces better recovery plans faster than today's
process, and that operators trust and can audit them. No operational control is handed to the system during the pilot.

**Scope:** one airport pair to start (e.g. Dubai International ↔ Sharjah International, or Zayed International ↔ Dubai
International), the network operations function at GCAA as sponsor, one home carrier and one ground handler.

## Phase 1 — Days 1–30: data, twin, baseline

| Week | Work | Exit criteria |
|---|---|---|
| 1–2 | Governance: data-sharing agreements, security review, on-premises environment. Map interfaces: A-CDM milestones, AODB flight and stand data, stand master data, resource availability, METAR/TAF, NOTAMs. | Signed data agreements; environment accredited for read-only feeds. |
| 2–3 | Replace OSM-derived stand capabilities with the airports' stand master data; verify runway/taxiway layout and taxi times against operations. | Stand and taxi-time tables signed off by each airport. |
| 3–4 | Replay 6–10 historical disruption days (fog, storms, closures) through the simulator; calibrate turnaround, taxi and capacity models. | Simulated vs. actual on-block and holding within agreed tolerances. |

## Phase 2 — Days 31–60: shadow mode

| Week | Work | Exit criteria |
|---|---|---|
| 5–6 | Live read-only feeds; SKYPACT runs alongside the operation and produces proposals during real disruptions; nobody acts on them. | Proposals generated within 2 minutes of disruption detection. |
| 6–8 | Daily review with duty managers: compare proposals with decisions actually taken; collect rejections and reasons; tune constraints and objective weights. | Documented review of every disruption; constraint catalogue agreed. |
| 8 | Tabletop exercise with all approver roles using the approval workflow on recorded scenarios. | All roles complete an approval cycle; usability issues logged and fixed. |

## Phase 3 — Days 61–90: decision support and evaluation

| Week | Work | Exit criteria |
|---|---|---|
| 9–11 | Decision-support mode for selected decision types (e.g. stand reassignment and diversion acceptance between the pilot pair); every action still executed through existing systems by authorised staff. | Approved plans executed through existing processes; audit trail complete. |
| 12–13 | Independent evaluation and go/no-go for a network-wide rollout. | Evaluation report accepted by the steering group. |

## Success measures

* **Time to decision:** disruption detection → approved plan (target: under 10 minutes for stand/diversion decisions).
* **Plan quality:** projected and observed airborne holding, ground wait for stands, stand conflicts, uncoordinated
  diversions, passenger delay, accessibility service, versus local-only decisions on comparable days.
* **Trust:** share of proposals approved without revision; reasons for rejection; operator survey.
* **Safety and compliance:** zero hard-constraint violations in committed plans; complete audit trail; no actions
  outside the agreed decision types.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Data quality and latency of live feeds | Start with replayed history; validation agent blocks stale inputs; data-quality dashboard. |
| Model mismatch with real operations | Calibration phase; shadow mode before any decision support; constraint catalogue reviewed by operators. |
| Organisational acceptance | Co-design with duty managers; approvals scoped to each role's responsibility; nothing executes automatically. |
| Security and sovereignty | On-premises deployment, no external AI services, read-only feeds in shadow mode. |

## Team

Product/operations lead, optimisation engineer, integration engineer, front-end/3D engineer, plus nominated experts
from each airport operations centre, the ANSP and the participating carrier.
