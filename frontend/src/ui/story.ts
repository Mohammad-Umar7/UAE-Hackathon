/**
 * Plain-language narration of the live state for a first-time audience: what is happening now, what the
 * agents did, what a plan changes and what it is expected to achieve. Everything is derived from the
 * runtime and the recorded messages; nothing here is staged.
 */

import { AGENTS } from "@/core/agents/definitions";
import type { AgentMessage, Workflow } from "@/core/agents/types";
import { isOpen, type ApprovalSlot, type Proposal } from "@/core/approvals/workflow";
import type { Runtime } from "@/core/runtime";
import type { Incident, WeatherObs } from "@/core/types";
import { fmtTime } from "@/core/world";
import { endpoints, type NodeId } from "./agents/model";

const CITY: Record<string, string> = { OMAA: "Abu Dhabi", OMDB: "Dubai", OMSJ: "Sharjah" };
export const city = (icao: string) => CITY[icao] ?? icao;

/** Plain names for the seven agents, for a first-time audience (the formal names are in the agent roster). */
export const PLAIN_AGENT: Record<keyof typeof AGENTS, string> = {
  weather: "Weather agent", airport_ops: "Airport agent", airline_ops: "Airline agent", atc: "Air-traffic agent",
  recovery: "Planning agent", validation: "Safety-check agent", coordination: "Coordination agent",
};

/** What each agent is for, in one or two plain sentences. */
export const PLAIN_JOB: Record<keyof typeof AGENTS, string> = {
  weather: "Watches the weather and incident reports for all three airports and raises the alarm when something changes.",
  airport_ops: "Works out what a disruption means for each airport: runways, gates, and what happens over the next 4 hours if nobody acts.",
  airline_ops: "Speaks for the airlines: which flights are affected, which passengers have connections, and where each airline can be handled.",
  atc: "Brings the runway limits into the plan and flags it for real air-traffic controllers. It never gives instructions to pilots.",
  recovery: "Builds recovery plans with a mathematical optimiser: for every affected flight, which gate, which landing time, or which nearby airport.",
  validation: "Double-checks every plan against every safety rule, independently of the planner, and withdraws plans that go out of date.",
  coordination: "Sends the plan to the people who must approve it, collects their answers, and starts the plan only when everyone has said yes.",
};

const POOL: Record<string, string> = { ambulift: "Wheelchair lifts", wb_handling: "Ground crews for large aircraft", nb_handling: "Ground crews", deck_loader: "Cargo loaders" };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** "Sharjah", "Sharjah or Dubai", "Sharjah, Dubai or Abu Dhabi". */
export const listOr = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}` : xs[0] ?? "");

/** A short headline for an incident, without aviation jargon. */
export function plainIncident(i: Incident): string {
  const at = city(i.airport);
  switch (i.type) {
    case "FOG": return `Thick fog at ${at}`;
    case "THUNDERSTORM": return `Thunderstorm at ${at}`;
    case "RUNWAY_CLOSURE": return `A runway closed at ${at}`;
    case "STAND_BLOCKED": return `A broken-down plane blocks a gate at ${at}`;
    case "PRIORITY_ARRIVAL": return `Emergency landing at ${at}`;
    case "DIVERSION_INFLUX": return `Unexpected extra flights at ${at}`;
    case "RESOURCE_OUTAGE": return `${POOL[String(i.params.pool)] ?? "Equipment"} out of service at ${at}`;
    case "ACCESSIBILITY_REQUIREMENT": return `Passengers needing wheelchair help (${at})`;
    case "STAND_CLOSURE": return `Gates closed at ${at}`;
  }
}

/** Weather in plain words ("Thick fog · visibility 800 m"). */
export function plainWeather(wx: WeatherObs): string {
  const what = wx.thunder ? "Thunderstorm" : wx.visibility < 1000 ? "Thick fog" : wx.visibility < 5000 ? "Mist" : wx.precip !== "none" ? "Rain" : "Clear";
  return `${what} · visibility ${wx.visibility >= 9999 ? "10 km+" : wx.visibility >= 1000 ? `${(wx.visibility / 1000).toFixed(1)} km` : `${Math.round(wx.visibility)} m`}`;
}

/** Active incidents the network knows about, most serious first. */
export function activeIncidents(rt: Runtime): Incident[] {
  const rank = { severe: 0, high: 1, moderate: 2, low: 3 } as const;
  return Object.values(rt.world.incidents).filter((i) => i.shared && i.status === "active").sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** What a plan changes, in a few plain phrases. */
export function planChanges(p: Proposal): string[] {
  const ds = p.plan.decisions;
  const n = (a: string) => ds.filter((d) => d.action === a).length;
  const out: string[] = [];
  const divert = n("divert"), stands = n("assign_stand"), slots = n("landing_slot"), tows = n("tow"), open = n("unresolved");
  if (divert) out.push(`${plural(divert, "flight")} land${divert === 1 ? "s" : ""} at a nearby airport instead (${listOr([...new Set(ds.filter((d) => d.action === "divert").map((d) => city(d.to!)))])})`);
  if (stands) out.push(`${plural(stands, "aircraft", "aircraft")} ${stands === 1 ? "gets" : "get"} a different gate`);
  if (slots) out.push(`${plural(slots, "flight")} ${slots === 1 ? "gets" : "get"} a landing time, some held on the ground before take-off instead of circling`);
  if (tows) out.push(`${plural(tows, "broken-down aircraft", "broken-down aircraft")} ${tows === 1 ? "is" : "are"} towed away to free a gate`);
  if (open) out.push(`${plural(open, "flight")} still ${open === 1 ? "needs" : "need"} a person to decide`);
  return out;
}

/** The same in a few words, for one-line summaries ("16 diversions, 10 gate changes"). */
export function planShort(p: Proposal): string {
  const ds = p.plan.decisions;
  const n = (a: string) => ds.filter((d) => d.action === a).length;
  return [n("divert") ? plural(n("divert"), "diversion") : "", n("assign_stand") ? plural(n("assign_stand"), "gate change") : "",
    n("landing_slot") ? plural(n("landing_slot"), "landing time") : ""].filter(Boolean).join(", ");
}

/** Who said no, in plain words ("Sharjah's airport controller", "Saqr Airways"). */
export function whoSaid(slot: ApprovalSlot): string {
  if (slot.type === "AIRPORT_CONTROLLER" && slot.scope) return `${city(slot.scope)}'s airport controller`;
  if (slot.type === "AIRLINE_REP") return slot.label.split(" — ").pop() ?? "An airline";
  if (slot.type === "ATC_LIAISON") return "Air-traffic control";
  return "The national supervisor";
}

export interface Effect { key: string; label: string; hint: string; before: number; after: number; unit: string }

/** The plan's projected effect against doing nothing (same starting state, 4-hour look-ahead). */
export function planEffects(p: Proposal): Effect[] {
  const pr = p.projections;
  if (!pr) return [];
  const a = pr.noAction, b = pr.plan;
  return [
    { key: "holding", label: "Time spent circling", hint: "minutes aircraft spend in holding patterns waiting to land", before: a.airborneHoldingMin, after: b.airborneHoldingMin, unit: "min" },
    { key: "fuel", label: "Emergency fuel diversions", hint: "flights whose crews must divert because fuel runs low", before: a.fuelDiversions, after: b.fuelDiversions, unit: "" },
    { key: "pax", label: "Passenger delay", hint: "hours of delay added up over all passengers", before: a.paxDelayHours, after: b.paxDelayHours, unit: "h" },
    { key: "stands", label: "Gate clashes", hint: "aircraft that would arrive to find their gate occupied", before: a.standConflicts, after: b.standConflicts, unit: "" },
  ];
}

export const change = (e: Pick<Effect, "before" | "after">) => (e.before > 0 ? Math.round((100 * (e.after - e.before)) / e.before) : 0);

/** The approvals a plan still needs, and whether one of them is the current user's. */
export function approvalState(p: Proposal, role: string) {
  const done = p.approvals.filter((a) => a.decision === "APPROVED" || a.decision === "ACKNOWLEDGED").length;
  const mine = p.approvals.find((a) => a.key === role && a.decision === "PENDING");
  return { done, total: p.approvals.length, mine: Boolean(mine) };
}

export type Tone = "calm" | "alert" | "work" | "action" | "done";
export type Go = "agents" | "workbench" | "evidence" | "run" | "demo";

export interface StoryNow { tone: Tone; text: string; cta?: { label: string; go: Go } }

const TOOL_WORDS: Record<string, string> = {
  run_optimizer: "calculating recovery plans", build_recovery_problem: "setting up the planning problem", evaluate_plans: "simulating each plan 4 hours ahead",
  project_operations: "predicting the next 4 hours", validate_plan: "double-checking the plan against every rule", classify_change: "reading the weather",
  get_runway_status: "checking the runways", get_stand_occupancy: "checking the gates", detect_conflicts: "looking for clashes",
  commit_plan: "putting the approved plan into action", share_local_information: "sharing new local information",
};

/** One sentence on what is happening right now, and the most useful next step. */
export function storyNow(rt: Runtime, role: string): StoryNow {
  const o = rt.orchestrator;
  const props = Object.values(rt.proposals).sort((a, b) => b.createdAt - a.createdAt || b.version - a.version);
  const open = props.find(isOpen);
  const incidents = activeIncidents(rt);
  const lead = incidents[0] ? `${plainIncident(incidents[0])}. ` : "";
  if (o.computing || rt.held) {
    const what = o.computing ? TOOL_WORDS[o.computing.tool] ?? "working" : "coordinating";
    const who = o.computing ? `The ${PLAIN_AGENT[o.computing.agent].toLowerCase()}` : "The agents";
    return { tone: "work", text: `${lead}${who} is ${what} — the clock waits while the agents think.`, cta: { label: "Watch the agents", go: "agents" } };
  }
  if (open) {
    const a = approvalState(open, role);
    const rejected = props.find((p) => p.thread === open.thread && p.status === "REJECTED" && p.version === open.version - 1);
    const why = rejected?.approvals.find((s) => s.decision === "REJECTED");
    const prefix = why ? `${whoSaid(why)} said no to the last version, so the agents re-planned. ` : lead;
    const last = a.mine && a.done === a.total - 1;
    return a.mine
      ? { tone: "action", text: `${prefix}A recovery plan is ready: ${planShort(open)}. ${a.done} of ${a.total} approvals are in — ${last ? "yours is the last one needed" : "yours is needed too"}.`, cta: { label: "Review and decide", go: "workbench" } }
      : { tone: "action", text: `${prefix}A recovery plan is out for approval: ${a.done} of ${a.total} people have approved so far.`, cta: { label: "See the plan", go: "workbench" } };
  }
  const committed = props.find((p) => p.status === "COMMITTED");
  if (committed && rt.world.now - (committed.history[committed.history.length - 1]?.t ?? 0) < 45 * 60) {
    const fx = planEffects(committed).filter((e) => e.before > 0).map((e) => `${e.label.toLowerCase()} ${change(e)}%`).slice(0, 2).join(", ");
    return { tone: "done", text: `The approved plan is running: aircraft are moving to new gates and landing times.${fx ? ` Expected against doing nothing: ${fx}.` : ""}`, cta: { label: "See before & after", go: "evidence" } };
  }
  if (incidents.length) return { tone: "alert", text: `${lead}The agents react as soon as the clock runs.`, cta: rt.running ? { label: "Watch the agents", go: "agents" } : { label: "Run the clock", go: "run" } };
  if (!rt.running && rt.world.now <= rt.scenario.start + 60) {
    return { tone: "calm", text: `${fmtTime(rt.world.now)} on a busy evening at Abu Dhabi, Dubai and Sharjah — all normal for now. Trouble is coming.`, cta: { label: "Start the guided demo", go: "demo" } };
  }
  return { tone: "calm", text: "All three airports are operating normally.", cta: rt.running ? undefined : { label: "Run the clock", go: "run" } };
}

/** A workflow's name in plain words: the first disruption it was opened for ("Thick fog at Abu Dhabi"). */
export function workflowName(rt: Runtime, wf: Workflow): string {
  const rank = { severe: 0, high: 1, moderate: 2, low: 3 } as const;
  const incs = rt.orchestrator.messages.filter((m) => m.thread === wf.id && m.type === "DisruptionNotice")
    .flatMap((m) => (m.payload.incidents as Incident[] | undefined) ?? []);
  // a workflow also takes on disruptions that start at its airports later (the fog joins the first plan's workflow)
  const active = Object.values(rt.world.incidents).filter((i) => i.shared && i.status === "active" && wf.airports.includes(i.airport));
  const worst = [...incs, ...active].sort((a, b) => rank[a.severity] - rank[b.severity])[0];
  return worst ? plainIncident(worst) : wf.title;
}

export interface StoryStep { id: string; t: number; color: string; who: string; text: string; tone?: "bad" | "good"; n: number; from: NodeId; nodes: NodeId[] }

/** The agents' work as a short story: one line per step, repeated exchanges merged ("14 approvals came in"). */
export function agentStory(rt: Runtime, thread: string | null): StoryStep[] {
  const out: StoryStep[] = [];
  let lastKey = "";
  for (const m of rt.orchestrator.messages) {
    if (thread && m.thread !== thread) continue;
    const s = stepOf(m);
    if (!s) continue;
    if (s.key === lastKey && out.length) {
      const prev = out[out.length - 1];
      const e = endpoints(m);
      prev.nodes = [...new Set([...prev.nodes, e.from, ...e.to])];
      prev.n++;
      prev.text = s.merge ? s.merge(prev.n) : prev.text;
      continue;
    }
    lastKey = s.key;
    const e = endpoints(m);
    out.push({ id: m.id, t: m.t, color: s.color, who: s.who, text: s.text, tone: s.tone, n: 1, from: e.from, nodes: [e.from, ...e.to] });
  }
  return out;
}

function stepOf(m: AgentMessage): { key: string; who: string; color: string; text: string; tone?: "bad" | "good"; merge?: (n: number) => string } | null {
  const agent = (id: keyof typeof AGENTS) => ({ who: PLAIN_AGENT[id], color: AGENTS[id].color });
  const p = m.payload as Record<string, unknown>;
  switch (m.type) {
    case "DisruptionNotice": {
      const incs = (p.incidents as Incident[] | undefined) ?? [];
      if (incs.length) return { key: `${m.type}${m.id}`, ...agent("weather"), text: `Spotted a problem: ${incs.map(plainIncident).join(", ")}.`, tone: "bad" };
      // weather trend notices ("OMAA: conditions IMC → LVP, visibility 800 → 400 m (trend watch)")
      const trend = /^(\w{4}): conditions \w+ → \w+, visibility (\d+) → (\d+) m/.exec(m.summary);
      return { key: `${m.type}${m.id}`, ...agent("weather"), tone: "bad",
        text: trend ? `The weather at ${city(trend[1])} is getting worse: visibility down from ${trend[2]} to ${trend[3]} metres.` : `Spotted a problem: ${m.summary}.` };
    }
    case "ImpactAssessment": {
      const pr = p.projection as { conflicts: number; fuelDiversions: number; holding: number } | undefined;
      if (!pr) return null;
      const bits = [pr.fuelDiversions ? `${plural(pr.fuelDiversions, "flight")} could run low on fuel and divert` : "",
        pr.conflicts ? `${plural(pr.conflicts, "aircraft", "aircraft")} would find ${pr.conflicts === 1 ? "its" : "their"} gate taken` : "",
        pr.holding > 30 ? `about ${Math.round(pr.holding).toLocaleString("en-GB")} minutes of circling` : ""].filter(Boolean);
      return { key: `${m.type}${m.id}`, ...agent("airport_ops"), text: bits.length ? `Predicted what happens if nobody acts: ${bits.join(", ")}.` : "Predicted the next 4 hours: no serious knock-on effects." };
    }
    case "AirlineConstraints": {
      const flights = ((p.airline as { inbound: number }[] | undefined) ?? []).reduce((s, a) => s + a.inbound, 0);
      const pax = (p.downstream as { connectingPax?: number } | undefined)?.connectingPax ?? 0;
      return { key: `${m.type}${m.id}`, ...agent("airline_ops"), text: `Listed the ${plural(flights, "affected flight")} and ${plural(pax, "passenger")} with connections to protect.` };
    }
    case "ATCReview":
      return { key: m.type, ...agent("atc"), text: "Checked the runway limits and flagged everything for real air-traffic controllers — SKYPACT never instructs pilots." };
    case "PlanCandidates": {
      const n = ((p.comparison as unknown[] | undefined) ?? []).length;
      const label = /recommended “([^”]+)”/.exec(m.summary)?.[1];
      return { key: `${m.type}${m.id}`, ...agent("recovery"), text: `Used a mathematical optimiser to build ${plural(n || 3, "alternative plan")}${label ? ` and recommended “${label}”` : ""}.` };
    }
    case "ValidationResult": {
      const n = ((p.approvals as unknown[] | undefined) ?? []).length;
      return { key: `${m.type}${m.id}`, ...agent("validation"), text: `Re-checked every safety rule independently: passed. ${n ? `${plural(n, "person", "people")} must now approve.` : ""}`, tone: "good" };
    }
    case "CoordinationRequest":
      return { key: m.type, ...agent("coordination"), text: "Sent the plan to 1 person for approval.", merge: (n) => `Sent the plan to ${n} people for approval: airport controllers, airlines, air-traffic control and the supervisor.` };
    case "StakeholderResponse": {
      const d = String(p.decision ?? "");
      const who = m.fromLabel?.replace(/ \(simulated\)$/, "") ?? "A stakeholder";
      if (d === "REJECTED" || d === "REVISION_REQUESTED") {
        const reason = m.summary.split(" — ").slice(1).join(" — ");
        return { key: `${m.type}${m.id}`, who, color: "var(--red)", text: `Said no: ${reason || "see the reason in the decision view"}`, tone: "bad" };
      }
      if (!d) return null;
      return { key: "approvals", who: "People in charge", color: "var(--teal)", text: `${who} approved.`, tone: "good", merge: (n) => `${n} approvals came in.` };
    }
    case "LocalInformationShared":
      return { key: `${m.type}${m.id}`, ...agent("coordination"), text: "Shared that local fact with every agent: the network now knows it too." };
    case "PlanInvalidated":
      return { key: `${m.type}${m.id}`, ...agent("validation"), text: /rejection|revision/.test(m.summary) ? "Withdrew the plan after the rejection." : "Withdrew the plan: the situation changed before it was approved.", tone: "bad" };
    case "ReplanRequest":
      return { key: `${m.type}`, ...agent("recovery"), text: "Re-planning around the new information." };
    case "PlanCommitted":
      return { key: `${m.type}${m.id}`, ...agent("coordination"), text: "Everyone approved — the plan is now running in the simulation.", tone: "good" };
    case "Escalation":
      return { key: `${m.type}${m.id}`, ...agent("coordination"), text: `Asked the supervisor for help: ${m.summary}`, tone: "bad" };
    default:
      return null;
  }
}
