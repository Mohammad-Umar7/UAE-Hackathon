/**
 * Deterministic plan explanations generated from optimiser output and the shared picture.
 * (An optional local language model may rephrase the briefing; numbers always come from here.)
 */

import { AIRCRAFT } from "../aircraft";
import { AIRLINES } from "../airlines";
import type { Registry } from "../airports/registry";
import type { Proposal } from "../approvals/workflow";
import type { Decision } from "../sim/engine";
import type { World } from "../types";
import { fmtTime } from "../world";

export interface DecisionExplanation {
  visit: string;
  callsign: string;
  action: Decision["action"];
  headline: string;
  why: string;
  constraints: string[];
}

export interface PlanExplanation {
  headline: string;
  whatChanged: string[];
  why: string[];
  constraints: string[];
  affected: string[];
  delayImpact: string[];
  stakeholders: string[];
  evidence: string[];
  decisions: DecisionExplanation[];
}

function rateAt(w: World, icao: string): string {
  const r = Object.values(w.restrictions).find((x) => x.airport === icao && x.kind === "ARRIVAL_CAPACITY" && x.shared
    && x.start <= w.now + 3600 && x.end > w.now);
  return r ? `${r.params.rate}/h until ${fmtTime(r.end)}` : "normal capacity";
}

export function explainDecision(d: Decision, w: World, ap: Registry): DecisionExplanation {
  const v = w.visits[d.visit];
  const t = v ? AIRCRAFT[v.type] : null;
  const what = t ? `${t.category.toLowerCase()} · ${v.pax} pax${v.prm ? ` · ${v.prm} need assistance` : ""}` : "";
  const base = { visit: d.visit, callsign: d.callsign, action: d.action };
  switch (d.action) {
    case "divert": {
      const st = ap[d.to!]?.stands[d.stand!];
      return {
        ...base, headline: `Divert to ${d.to} · stand ${d.stand}`,
        why: `${d.callsign} (${what}) cannot be landed at ${d.airport} within its ${d.hold_limit ?? "—"}-min holding fuel window under ${rateAt(w, d.airport)}; ${d.to} accepts it on ${st?.contact ? "contact" : "remote"} stand ${d.stand} (max ${st?.maxWingspan.toFixed(0)} m span), landing ${fmtTime(d.eldt)}.`,
        constraints: ["FUEL", "ARRIVAL_CAPACITY", "DIVERSION_ELIGIBILITY", "DIVERSION_ACCEPTANCE", ...(d.needs_ambulift ? ["ACCESSIBILITY"] : [])],
      };
    }
    case "landing_slot":
      return {
        ...base, headline: `Land ${fmtTime(d.eldt)}${d.holding_min ? ` · +${d.holding_min} min ${d.ground_delay ? "ground delay" : "holding"}` : ""}`,
        why: d.ground_delay
          ? `${d.callsign} has not departed its origin yet: absorbing ${d.holding_min} min on the ground avoids airborne holding at ${d.airport} (${rateAt(w, d.airport)}).`
          : `Sequenced within the modelled arrival rate at ${d.airport} (${rateAt(w, d.airport)}); holding stays within the ${d.hold_limit ?? "—"}-min fuel endurance.`,
        constraints: ["ARRIVAL_CAPACITY", ...(d.ground_delay ? [] : ["FUEL"])],
      };
    case "assign_stand": {
      const st = ap[d.airport]?.stands[d.stand!];
      return {
        ...base, headline: `Stand ${d.from ?? "—"} → ${d.stand}${d.ground_wait_min ? ` · waits ${d.ground_wait_min} min` : ""}`,
        why: `${d.from ? `Stand ${d.from} is not available for ${d.callsign}` : `${d.callsign} has no stand`}; ${d.stand} is ${st?.contact ? "a contact" : "a remote"} stand accepting up to ${st?.maxWingspan.toFixed(0)} m span${d.needs_ambulift ? " with an ambulift for passengers needing assistance" : ""}.`,
        constraints: ["STAND_COMPATIBILITY", "STAND_OVERLAP", ...(d.prm ? ["ACCESSIBILITY"] : [])],
      };
    }
    case "tow":
      return {
        ...base, headline: `Tow ${d.from_stand} → ${d.to_stand} at ${fmtTime(d.at)}`,
        why: `${d.callsign} is unserviceable but towable; moving it to remote stand ${d.to_stand} frees contact stand ${d.from_stand} for following arrivals.`,
        constraints: ["STAND_OVERLAP", "STAND_COMPATIBILITY"],
      };
    default: {
      const ex = d.excluded ?? [];
      const top = [...new Map(ex.map((e) => [e.code, e])).values()].slice(0, 3).map((e) => `${e.stand ?? e.airport}: ${e.reason}`);
      return { ...base, headline: "Unresolved — needs human action", why: `No option satisfies every hard constraint. ${top.join("; ")}`, constraints: [...new Set(ex.map((e) => e.code))] };
    }
  }
}

export function explainProposal(p: Proposal, w: World, ap: Registry): PlanExplanation {
  const k = p.plan.kpis;
  const ds = p.plan.decisions;
  const airlines = new Set(ds.map((d) => w.visits[d.visit]?.airline).filter(Boolean) as string[]);
  const whatChanged: string[] = [];
  if (k.diversions) whatChanged.push(`${k.diversions} coordinated diversion${k.diversions > 1 ? "s" : ""} (${[...new Set(ds.filter((d) => d.action === "divert").map((d) => d.to))].join(", ")})`);
  if (k.landingSlots) whatChanged.push(`${k.landingSlots} landing-sequence targets at capacity-restricted airports`);
  if (k.standChanges) whatChanged.push(`${k.standChanges} stand reassignment${k.standChanges > 1 ? "s" : ""}`);
  if (k.tows) whatChanged.push(`${k.tows} tow of an unserviceable aircraft`);
  if (k.unresolved) whatChanged.push(`${k.unresolved} flight${k.unresolved > 1 ? "s" : ""} unresolved — escalated`);
  const restricted = Object.values(w.restrictions).filter((r) => r.shared && r.end > w.now && ["ARRIVAL_CAPACITY", "RUNWAY_CLOSED", "STAND_CLOSED", "RESOURCE_OUTAGE"].includes(r.kind));
  const why = restricted.slice(0, 6).map((r) => `${r.airport}: ${String(r.params.reason ?? r.kind.toLowerCase())}${r.params.rate !== undefined ? ` (${r.params.rate}/h)` : ""}${r.params.pool ? ` (${r.params.units} ${r.params.pool})` : ""} until ${fmtTime(r.end)}${r.provenance === "stakeholder_reported" ? " — reported by stakeholder" : ""}`);
  const proj = p.projections;
  const delayImpact: string[] = [];
  if (proj) {
    delayImpact.push(`Projected total delay ${proj.plan.totalDelayMin.toFixed(0)} min vs ${proj.noAction.totalDelayMin.toFixed(0)} min with no coordinated action (${proj.localGreedy.totalDelayMin.toFixed(0)} min local-only).`);
    delayImpact.push(`Airborne holding ${proj.plan.airborneHoldingMin.toFixed(0)} min vs ${proj.noAction.airborneHoldingMin.toFixed(0)} min; uncoordinated fuel diversions ${proj.plan.fuelDiversions} vs ${proj.noAction.fuelDiversions}.`);
  } else {
    delayImpact.push(`Optimiser estimate: ${k.arrDelay} min arrival delay, ${k.depDelay} min departure delay across ${k.flights} flights.`);
  }
  return {
    headline: `${p.label} · v${p.version}`,
    whatChanged, why,
    constraints: ["Stand compatibility & exclusivity", "Runway arrival capacity per 15 min", "Fuel-limited holding", "Diversion eligibility & acceptance", "Accessibility resources", "Handling-team availability"],
    affected: [...airlines].map((a) => `${AIRLINES[a]?.name ?? a}: ${ds.filter((d) => w.visits[d.visit]?.airline === a).length} decision(s)`),
    delayImpact,
    stakeholders: p.approvals.map((a) => `${a.label} (${a.mode})`),
    evidence: [`Computed at ${fmtTime(p.createdAt, true)} from the shared picture`, `${p.plan.numVars} binary variables · ${p.plan.numRows} constraints · ${p.plan.status} in ${p.plan.solveMs.toFixed(0)} ms (HiGHS)`,
      `${p.plan.prunedOptions} options removed by hard constraints before optimisation`, `Independent validation: ${p.validation.valid ? "passed" : `${p.validation.violations.length} violation(s)`}`],
    decisions: ds.map((d) => explainDecision(d, w, ap)),
  };
}
