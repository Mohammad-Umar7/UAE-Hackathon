/**
 * Before & after: the same evening simulated twice from the same moment, once if nobody acts and once
 * with the agents' plan. Everything comes from the projections the agents ran and the evidence recorded
 * at commit; nothing is typed in.
 */

import { isOpen, type Proposal } from "@/core/approvals/workflow";
import type { EvidenceRun, Runtime } from "@/core/runtime";
import type { Projection, SeriesPoint } from "@/core/solver/evaluate";
import type { Incident } from "@/core/types";

export interface Outcome {
  fuel: number;
  holdingH: number;
  clashes: number;
  paxH: number;
  series: SeriesPoint[];
  events: Projection["events"];
}

export type Stage = "predicting" | "proposed" | "committed";

/** A plan decides for the flights arriving within the planner's horizon (buildProblem: 180 min). */
export const PLAN_WINDOW_S = 3 * 3600;

export interface Comparison {
  thread: string;
  stage: Stage;
  /** recorded at commit from the pre-commit state (rather than the agents' own look-ahead) */
  measured: boolean;
  t0: number;
  horizonS: number;
  without: Outcome;
  /** each airport reassigning its own gates, nobody coordinating across the network */
  alone?: Outcome;
  with?: Outcome;
  p?: Proposal;
  /** the most serious disruption the workflow handles */
  cause: Incident | null;
  severity: number;
  at: number;
}

const RANK = { severe: 0, high: 1, moderate: 2, low: 3 } as const;

function outcome(r: EvidenceRun | Projection): Outcome {
  return { fuel: r.fuelDiversions, holdingH: r.airborneHoldingMin / 60, clashes: r.standConflicts, paxH: r.paxDelayHours, series: r.series ?? [], events: r.events ?? [] };
}

const span = (s: SeriesPoint[] | undefined) => (s && s.length > 1 ? s[s.length - 1].t - s[0].t : 4 * 3600);

function threadIncidents(rt: Runtime, thread: string): Incident[] {
  return rt.orchestrator.messages.filter((m) => m.thread === thread && m.type === "DisruptionNotice")
    .flatMap((m) => (m.payload.incidents as Incident[] | undefined) ?? []);
}

/** One comparison per workflow, the most serious disruption first. */
export function comparisons(rt: Runtime): Comparison[] {
  const out: Comparison[] = [];
  const props = Object.values(rt.proposals).sort((a, b) => b.createdAt - a.createdAt || b.version - a.version);
  for (const wf of rt.orchestrator.workflows) {
    const mine = props.filter((p) => p.thread === wf.id);
    // a workflow also takes on disruptions that start at its airports later (the fog joins the first plan's workflow)
    const incs = [...threadIncidents(rt, wf.id), ...Object.values(rt.world.incidents)
      .filter((i) => i.shared && i.status !== "scheduled" && wf.airports.includes(i.airport) && i.start >= wf.startedAt)]
      .sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const cause = incs[0] ?? null;
    const base = { thread: wf.id, cause, severity: cause ? RANK[cause.severity] : 9 };
    const fromProposal = (p: Proposal, stage: Stage): Comparison => {
      const pr = p.projections!;
      return { ...base, stage, measured: false, t0: pr.noAction.series?.[0]?.t ?? p.createdAt, horizonS: pr.noAction.horizonS,
        without: outcome(pr.noAction), alone: outcome(pr.localGreedy), with: outcome(pr.plan), p, at: p.createdAt };
    };
    const open = mine.find((p) => isOpen(p) && p.projections);
    if (open) { out.push(fromProposal(open, "proposed")); continue; }
    const evidence = [...rt.evidence].reverse().map((ev) => ({ ev, p: mine.find((p) => `${p.id} v${p.version}` === ev.proposal) })).find((x) => x.p);
    if (evidence?.p) {
      const { ev, p } = evidence;
      out.push({ ...base, stage: "committed", measured: true, t0: ev.noAction.series?.[0]?.t ?? ev.t, horizonS: span(ev.noAction.series),
        without: outcome(ev.noAction), alone: outcome(ev.localGreedy), with: outcome(ev.plan), p, at: ev.t });
      continue;
    }
    // committed, with the evidence still being computed
    const committed = mine.find((p) => p.status === "COMMITTED" && p.projections);
    if (committed) { out.push(fromProposal(committed, "committed")); continue; }
    // no plan yet: the airport agent's prediction of what happens if nobody acts
    if (wf.status === "closed") continue;
    const ia = [...rt.orchestrator.messages].reverse().find((m) => m.thread === wf.id && m.type === "ImpactAssessment" && (m.payload.projection as { series?: unknown })?.series);
    if (ia) {
      const pr = ia.payload.projection as { holding: number; conflicts: number; fuelDiversions: number; paxDelayHours: number; series: SeriesPoint[] };
      out.push({ ...base, stage: "predicting", measured: false, t0: pr.series[0]?.t ?? ia.t, horizonS: span(pr.series),
        without: { fuel: pr.fuelDiversions, holdingH: pr.holding / 60, clashes: pr.conflicts, paxH: pr.paxDelayHours, series: pr.series,
          events: (ia.payload.conflicts as Projection["events"] | undefined) ?? [] },
        at: ia.t });
    }
  }
  return out.sort((a, b) => a.severity - b.severity || b.at - a.at);
}

/** One flight followed through both futures: what doing nothing does to it, and what the plan does instead. */
export interface FlightStory {
  visit: string;
  callsign: string;
  origin: string;
  home: string;
  pax: number;
  type: string;
  without: { arrive: number; circleMin: number | null; at: number; to: string };
  with: { decided: number; kind: "divert"; to: string; land: number; stand: string | null }
    | { decided: number; kind: "slot"; land: number; ground: boolean };
}

/** The fullest flight that would run out of fuel if nobody acted and that the plan looks after. */
export function flightStory(rt: Runtime, c: Comparison): FlightStory | null {
  if (!c.p || !c.with) return null;
  // the fullest aircraft first: a big airliner makes the clearest example
  const pax = (visit: string) => rt.world.visits[visit]?.pax ?? 0;
  const fuel = c.without.events.filter((e) => e.kind === "FUEL_DIVERSION" && e.visit).sort((a, b) => pax(b.visit!) - pax(a.visit!) || a.t - b.t);
  // a flight the plan sends elsewhere tells the clearest story; a flight given a landing time is next best
  for (const want of ["divert", "landing_slot"] as const) {
    for (const e of fuel) {
      const d = c.p.plan.decisions.find((x) => x.visit === e.visit && x.action === want);
      const v = rt.world.visits[e.visit!];
      if (!d || !v?.arr || d.eldt === undefined) continue;
      const hold = e.holdMin ?? null;
      return {
        visit: v.id, callsign: e.callsign ?? v.arr.callsign, origin: v.arr.origin, home: v.airport, pax: d.pax ?? v.pax, type: v.type,
        without: { arrive: hold !== null ? e.t - hold * 60 : v.eta ?? e.t, circleMin: hold, at: e.t, to: e.detail ?? "" },
        with: want === "divert"
          ? { decided: c.p.createdAt, kind: "divert", to: d.to!, land: d.eldt, stand: d.stand ?? null }
          : { decided: c.p.createdAt, kind: "slot", land: d.eldt, ground: Boolean(d.ground_delay) },
      };
    }
  }
  return null;
}
