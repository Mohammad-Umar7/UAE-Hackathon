/**
 * Before & after: the same evening simulated twice from the same moment, once if nobody acts and once
 * with the agents' plan, plus what each agent contributed. Everything comes from the projections the
 * agents ran, the evidence recorded at commit and the agents' messages; nothing is typed in.
 */

import { AGENTS } from "@/core/agents/definitions";
import type { AgentMessage } from "@/core/agents/types";
import { isOpen, type Proposal } from "@/core/approvals/workflow";
import type { EvidenceRun, Runtime } from "@/core/runtime";
import type { Projection, SeriesPoint } from "@/core/solver/evaluate";
import type { Incident } from "@/core/types";
import { fmtTime } from "@/core/world";
import { PLAIN_AGENT, city, plainIncident, whoSaid } from "../story";

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

/** Two concrete moments from the do-nothing future, in plain words. */
export function examples(o: Outcome): string[] {
  const fuel = o.events.find((e) => e.kind === "FUEL_DIVERSION");
  const clash = o.events.find((e) => e.kind === "STAND_CONFLICT");
  return [
    fuel ? `${fmtTime(fuel.t)} · ${fuel.callsign ?? "A flight"} runs low on fuel while circling and has to divert to ${city(fuel.detail ?? "")}` : "",
    clash ? `${fmtTime(clash.t)} · ${clash.callsign ?? "A flight"} lands and finds its gate still taken` : "",
  ].filter(Boolean);
}

export interface Contribution { id: string; who: string; color: string; t: number | null; text: string }

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const n = (x: number) => Math.round(x).toLocaleString("en-GB");

/** What each agent did for this plan, one line each, in the order they worked. */
export function contributions(rt: Runtime, c: Comparison): Contribution[] {
  const msgs = rt.orchestrator.messages.filter((m) => m.thread === c.thread && (!c.p || m.t <= c.p.createdAt + 1));
  const last = (type: string) => [...msgs].reverse().find((m) => m.type === type);
  const out: Contribution[] = [];
  const add = (id: keyof typeof AGENTS, t: number | null, text: string) => out.push({ id, who: PLAIN_AGENT[id], color: AGENTS[id].color, t, text });

  // the weather agent's first warning about the main disruption: a visibility trend notice for weather, else the incident notice
  // (a disruption that arrives while a plan is out for approval joins that workflow through a re-plan, without a notice of its own)
  const cause = c.cause;
  const incidentsOf = (m: AgentMessage) => (m.payload.incidents as Incident[] | undefined) ?? [];
  const trend = cause && (cause.type === "FOG" || cause.type === "THUNDERSTORM")
    ? msgs.find((m) => m.type === "DisruptionNotice" && m.payload.informational && m.payload.airport === cause.airport) : undefined;
  const vis = trend && /visibility (\d+) → (\d+) m/.exec(trend.summary);
  const noticed = msgs.find((m) => m.type === "DisruptionNotice" && incidentsOf(m).some((i) => i.id === cause?.id))
    ?? msgs.find((m) => m.type === "DisruptionNotice" && incidentsOf(m).length);
  if (trend && vis && cause) add("weather", trend.t, `Saw visibility at ${city(cause.airport)} falling from ${n(+vis[1])} to ${n(+vis[2])} m and raised the alarm.`);
  else if (noticed) {
    const i = incidentsOf(noticed).find((x) => x.id === cause?.id) ?? incidentsOf(noticed)[0];
    add("weather", noticed.t, `Raised the alarm: ${lc(plainIncident(i))}.`);
  }

  const ia = [...msgs].reverse().find((m) => m.type === "ImpactAssessment" && m.payload.projection);
  if (ia) {
    const pr = ia.payload.projection as { holding: number; fuelDiversions: number };
    add("airport_ops", ia.t, `Predicted the next 4 hours if nobody acts: ${n(pr.fuelDiversions)} low-fuel diversions and ${n(pr.holding / 60)} hours of circling.`);
  }
  const al = last("AirlineConstraints");
  if (al) {
    const flights = ((al.payload.airline as { inbound: number }[] | undefined) ?? []).reduce((s, a) => s + a.inbound, 0);
    const pax = (al.payload.downstream as { connectingPax?: number } | undefined)?.connectingPax ?? 0;
    add("airline_ops", al.t, `Listed ${n(flights)} affected flights and ${n(pax)} passengers with connections to protect.`);
  }
  const atc = last("ATCReview");
  if (atc) add("atc", atc.t, "Held every plan to the landing rate the weather allows, and flagged it for real controllers.");
  const cands = last("PlanCandidates");
  if (cands) {
    const k = ((cands.payload.comparison as unknown[] | undefined) ?? []).length || 3;
    add("recovery", cands.t, `Built ${k} alternative plans with an optimiser and tested each one 4 hours ahead${c.p && c.p.version > 1 ? `, ${c.p.version} versions in all as things changed` : ""}.`);
  }
  if (c.p) {
    const checks = Object.values(c.p.validation.checks).reduce((s, x) => s + x, 0);
    add("validation", last("ValidationResult")?.t ?? c.p.createdAt, `Re-checked ${n(checks)} safety rules on its own before anyone was asked.`);
    const no = Object.values(rt.proposals).filter((p) => p.thread === c.thread && p.version < c.p!.version)
      .flatMap((p) => p.approvals.filter((s) => s.decision === "REJECTED")).map(whoSaid)[0];
    const asked = c.p.approvals.length;
    add("coordination", c.p.createdAt, no
      ? `Asked ${asked} people to approve. When ${no} said no, it shared why and the agents re-planned.`
      : `Asked ${asked} people to approve: airports, airlines, air-traffic control and the supervisor.`);
  }
  return out;
}
