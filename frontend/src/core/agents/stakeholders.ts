/**
 * Simulated stakeholder policies (used when a role is not operated by a human in the demo).
 *
 * Each stakeholder evaluates the requests addressed to it against ITS OWN information — for an
 * airport controller that includes locally-known constraints that are not yet in the shared
 * national picture (e.g. equipment recorded only in a local log). This is how coordination can
 * reveal information and force a genuine replan. The policies are deterministic rules.
 */

import { AIRCRAFT } from "../aircraft";
import type { Registry } from "../airports/registry";
import { RESOURCE_LABELS } from "../airports/profiles";
import type { ApprovalSlot, Decision4, Proposal } from "../approvals/workflow";
import { wideBodyTurnarounds } from "../resources";
import type { World } from "../types";
import { fmtTime, resourceAvailable } from "../world";

export interface StakeholderVerdict {
  decision: Decision4;
  reason: string;
  codes: string[];
  revealRestrictions: string[]; // locally-known restriction ids to share with the network
  forbid: { visit: string; airport: string; stand: string | null }[];
}

export function evaluateAsStakeholder(slot: ApprovalSlot, p: Proposal, w: World, ap: Registry): StakeholderVerdict {
  if (slot.type === "AIRPORT_CONTROLLER") return airportController(slot.scope!, p, w, ap);
  if (slot.type === "ATC_LIAISON") {
    const div = p.plan.decisions.filter((d) => d.action === "divert").length;
    const slotsN = p.plan.decisions.filter((d) => d.action === "landing_slot").length;
    return {
      decision: "ACKNOWLEDGED", codes: ["INFO_ONLY"], revealRestrictions: [], forbid: [],
      reason: `Reviewed: ${slotsN} landing-sequence targets within the modelled rates; ${div} diversion(s) will need tactical ATC coordination. No clearance is issued by SKYPACT.`,
    };
  }
  if (slot.type === "AIRLINE_REP") {
    const mine = p.plan.decisions.filter((d) => w.visits[d.visit]?.airline === slot.scope);
    const unresolved = mine.filter((d) => d.action === "unresolved").length;
    return {
      decision: "APPROVED", codes: unresolved ? ["CONCERN_UNRESOLVED"] : [], revealRestrictions: [], forbid: [],
      reason: unresolved ? `Accepted; ${unresolved} of our flights remain unresolved — request escalation.` : `Accepted ${mine.length} change(s) for our flights.`,
    };
  }
  return { decision: "APPROVED", codes: [], revealRestrictions: [], forbid: [], reason: "Approved (simulated supervisor)." };
}

function airportController(icao: string, p: Proposal, w: World, ap: Registry): StakeholderVerdict {
  const problems: string[] = [];
  const codes = new Set<string>();
  const reveal = new Set<string>();
  const forbid: StakeholderVerdict["forbid"] = [];
  const localOutages = Object.values(w.restrictions).filter((r) => r.airport === icao && !r.shared && r.kind === "RESOURCE_OUTAGE" && r.end > w.now);
  const diversionsIn = p.plan.decisions.filter((d) => d.action === "divert" && d.to === icao);
  // accessibility: passengers needing assistance at a stand without a jet bridge need an ambulift
  for (const d of diversionsIn) {
    if (!d.needs_ambulift) continue;
    const st = ap[icao].stands[d.stand!];
    const t = d.eldt! + (st?.taxiIn ?? 420);
    if (resourceAvailable(w, icao, "ambulift", t, t + 1500, false) <= 0) {
      problems.push(`${d.callsign} carries ${d.prm ?? "several"} passengers needing full assistance; stand ${d.stand} has no jet bridge and no ambulift is serviceable here until ${fmtTime(localOutages.find((r) => r.params.pool === "ambulift")?.end ?? w.now)}.`);
      codes.add("AMBULIFT_UNAVAILABLE");
      forbid.push({ visit: d.visit, airport: icao, stand: null });
      localOutages.filter((r) => r.params.pool === "ambulift").forEach((r) => reveal.add(r.id));
    }
  }
  // wide-body handling teams (local roster), checked over time like the optimiser's resource model:
  // a turnaround holds a team from on-block (diversions: 50 min, own arrivals: minimum turnaround)
  const spans: { d: (typeof diversionsIn)[number] | null; s: number; e: number }[] = [];
  for (const r of p.plan.rows) {
    const t = AIRCRAFT[r.type as keyof typeof AIRCRAFT];
    if (!t?.widebody) continue;
    if (r.option === "home" && r.home === icao && r.onBlock !== undefined) {
      spans.push({ d: null, s: p.t0 + r.onBlock * 60, e: p.t0 + (r.onBlock + t.minTurnaroundMin) * 60 });
    } else if (r.option === "divert" && r.to === icao && r.L !== undefined) {
      const d = diversionsIn.find((x) => x.visit === r.visit);
      // whole-minute taxi time, exactly as the optimiser and the validator compute on-block
      const on = p.t0 + (r.L + Math.ceil((ap[icao].stands[r.stand ?? ""]?.taxiIn ?? 420) / 60)) * 60;
      if (d) spans.push({ d, s: on, e: on + 50 * 60 });
    }
  }
  if (spans.some((x) => x.d)) {
    const committed = wideBodyTurnarounds(w, ap, icao, new Set(p.plan.rows.filter((r) => r.option !== "unresolved").map((r) => r.visit)));
    spans.sort((a, b) => a.s - b.s);
    const accepted: { s: number; e: number }[] = [];
    const excess: (typeof diversionsIn)[number][] = [];
    let worst = { avail: 0, busy: 0 };
    for (const sp of spans) {
      const avail = resourceAvailable(w, icao, "wb_handling", sp.s, sp.s + 60, false);
      const busy = committed.filter(([s0, e0]) => s0 <= sp.s && sp.s < e0).length + accepted.filter((a) => a.s <= sp.s && sp.s < a.e).length;
      if (sp.d && busy + 1 > avail) { excess.push(sp.d); worst = { avail, busy }; } else accepted.push(sp);
    }
    if (excess.length) {
      problems.push(`Only ${Math.max(0, worst.avail - worst.busy)} wide-body handling team${worst.avail - worst.busy === 1 ? "" : "s"} free when needed (local roster: ${worst.avail} on duty, ${worst.busy} on turnarounds); cannot accept ${excess.map((d) => d.callsign).join(", ")}.`);
      codes.add("HANDLING_CAPACITY");
      excess.forEach((d) => forbid.push({ visit: d.visit, airport: icao, stand: null }));
      localOutages.filter((r) => r.params.pool === "wb_handling").forEach((r) => reveal.add(r.id));
    }
  }
  // locally-closed stands
  for (const d of p.plan.decisions) {
    const target = d.action === "divert" ? d.to : d.airport;
    if (target !== icao || !d.stand) continue;
    const closed = Object.values(w.restrictions).find((r) => r.airport === icao && !r.shared && r.kind === "STAND_CLOSED"
      && r.end > w.now && (r.params.stands as string[]).includes(d.stand!));
    if (closed) {
      problems.push(`Stand ${d.stand} is closed locally (${closed.params.reason ?? "local closure"}).`);
      codes.add("STAND_CLOSED_LOCAL");
      reveal.add(closed.id);
      forbid.push({ visit: d.visit, airport: icao, stand: d.stand! });
    }
  }
  if (problems.length) {
    return { decision: "REJECTED", reason: problems.join(" "), codes: [...codes], revealRestrictions: [...reveal], forbid };
  }
  const n = p.plan.decisions.filter((d) => (d.action === "divert" ? d.to : d.airport) === icao && d.action !== "landing_slot").length;
  return { decision: "APPROVED", codes: [], revealRestrictions: [], forbid: [], reason: `Local check passed for ${n} item(s) at ${icao}: stands, handling and accessibility resources confirmed.` };
}

export const describePool = (pool: string) => RESOURCE_LABELS[pool] ?? pool;
