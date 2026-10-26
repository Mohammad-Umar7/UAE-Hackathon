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
  // wide-body handling teams (local roster)
  const wbIn = diversionsIn.filter((d) => AIRCRAFT[d.type as keyof typeof AIRCRAFT]?.widebody);
  if (wbIn.length) {
    const t0 = Math.min(...wbIn.map((d) => d.eldt!));
    const avail = resourceAvailable(w, icao, "wb_handling", t0, t0 + 3600, false);
    const busy = Object.values(w.visits).filter((v) => v.airport === icao && AIRCRAFT[v.type].widebody && v.phase === "ON_STAND"
      && v.readyAt !== null && v.readyAt > t0).length;
    const free = Math.max(0, avail - busy);
    if (wbIn.length > free) {
      const excess = wbIn.slice(free);
      problems.push(`Only ${free} wide-body handling team${free === 1 ? "" : "s"} free (local roster: ${avail} on duty, ${busy} on active turnarounds); cannot accept ${excess.map((d) => d.callsign).join(", ")}.`);
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
