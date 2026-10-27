/**
 * "Follow the agents": a workflow told as beats, one per thing an agent (or a person) did, condensed so a
 * first-time viewer can watch it at reading pace. A beat names who acts and who hears about it, says what
 * happened in one plain sentence and shows up to three key numbers, all taken from the recorded messages
 * and proposals. Repeated rounds are folded: after the first full round only what changes is told again.
 */

import { PROFILES } from "@/core/airports/profiles";
import type { AgentMessage } from "@/core/agents/types";
import { isOpen, type Proposal } from "@/core/approvals/workflow";
import type { Runtime } from "@/core/runtime";
import type { SeriesPoint } from "@/core/solver/evaluate";
import type { Incident } from "@/core/types";
import { fmtTime } from "@/core/world";
import { approvalState, city, listOr, PLAIN_AGENT, plainIncident, whoSaid } from "../story";
import { endpoints, slotNode, type NodeId } from "./model";

export interface Fact { value: string; label: string; tone?: "bad" | "good" }

export interface Beat {
  id: string;
  t: number;
  who: NodeId;
  to: NodeId[];
  /** the messages to animate on the scene while this beat is shown */
  msgs: AgentMessage[];
  name: string;
  headline: string;
  facts: Fact[];
  /** aircraft circling over time if nobody acts (the airport agent's prediction) */
  spark?: number[];
  tone?: "bad" | "good";
}

const n = (x: number) => Math.round(x).toLocaleString("en-GB");
const RATE_TYPES = new Set(["FOG", "THUNDERSTORM", "RUNWAY_CLOSURE"]);
const listAnd = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
const peopleWord = (type: string) => ({ AIRPORT_CONTROLLER: "airport controllers", AIRLINE_REP: "airlines", ATC_LIAISON: "air-traffic control", NATIONAL_SUPERVISOR: "the supervisor" } as Record<string, string>)[type] ?? "stakeholders";

/** Landings an hour the disruption allows at its airport, against normal. */
function rateOf(cause: Incident | null): { rate: number; normal: number; airport: string } | null {
  if (!cause || !RATE_TYPES.has(cause.type)) return null;
  const rate = Number((cause.params as Record<string, unknown>).arr_rate);
  const normal = PROFILES[cause.airport]?.arrCapacity;
  return Number.isFinite(rate) && normal ? { rate, normal, airport: cause.airport } : null;
}

/** Where a walk-through of a workflow should start: just before its most serious disruption began. */
export function followStart(rt: Runtime, thread: string | null, cause: Incident | null): number {
  const wf = rt.orchestrator.workflows.find((w) => w.id === thread);
  if (cause && (!wf || cause.start >= wf.startedAt)) return cause.start - 60;
  return wf ? wf.startedAt - 1 : rt.scenario.start;
}

export function followBeats(rt: Runtime, thread: string | null, from: number, cause: Incident | null): Beat[] {
  const msgs = rt.orchestrator.messages.filter((m) => (!thread || m.thread === thread) && m.t >= from);
  const props = Object.values(rt.proposals).filter((p) => !thread || p.thread === thread).sort((a, b) => a.createdAt - b.createdAt || a.version - b.version);
  const proposalAfter = (t: number): Proposal | undefined => props.find((p) => p.createdAt >= t);
  const rate = rateOf(cause);
  const out: Beat[] = [];
  const seen = new Set<string>();
  let rejected = false;

  // the weather agent's early warnings about this weather, posted before the disruption formally began
  if (cause && (cause.type === "FOG" || cause.type === "THUNDERSTORM")) {
    const warn = rt.orchestrator.messages.filter((m) => m.type === "DisruptionNotice" && m.payload.informational && m.payload.airport === cause.airport
      && m.t < from && m.t >= cause.start - 45 * 60 && (!thread || m.thread === thread));
    const a = warn.length ? /visibility (\d+) → (\d+) m/.exec(warn[0].summary) : null;
    const b = warn.length ? /visibility (\d+) → (\d+) m/.exec(warn[warn.length - 1].summary) : null;
    if (a && b) {
      const last = warn[warn.length - 1];
      out.push({ id: last.id, t: warn[0].t, who: "weather", to: [...new Set(warn.flatMap((m) => endpoints(m).to))], msgs: warn, name: PLAIN_AGENT.weather,
        headline: cause.type === "FOG" ? `Saw fog coming at ${city(cause.airport)}: visibility is falling fast, and warned the other agents`
          : `Saw a storm building at ${city(cause.airport)} and warned the other agents`,
        facts: [{ value: `${n(+b[2])} m`, label: `visibility at ${fmtTime(last.t)}`, tone: "bad" }, { value: `${n(+a[1])} m`, label: "visibility before" },
          ...(rate ? [{ value: `${rate.rate} / h`, label: `planes that can land once the fog is in (normally ${rate.normal})`, tone: "bad" as const }] : [])],
        tone: "bad" });
      seen.add("DisruptionNotice");
    }
  }
  const agentBeat = (m: AgentMessage, b: Omit<Beat, "id" | "t" | "who" | "to" | "msgs" | "name"> & { msgs?: AgentMessage[] }) => {
    const e = endpoints(m);
    const to = [...new Set((b.msgs ?? [m]).flatMap((x) => endpoints(x).to))];
    out.push({ id: m.id, t: m.t, who: e.from, to, msgs: b.msgs ?? [m], name: PLAIN_AGENT[e.from as keyof typeof PLAIN_AGENT] ?? m.fromLabel ?? "", ...b });
  };

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const p = m.payload as Record<string, unknown>;
    const first = !seen.has(m.type);
    switch (m.type) {
      case "DisruptionNotice": {
        if (!first) break;
        const vis = /visibility (\d+) → (\d+) m/.exec(m.summary);
        const incs = (p.incidents as Incident[] | undefined) ?? [];
        const at = city(String(p.airport ?? incs[0]?.airport ?? cause?.airport ?? ""));
        const facts: Fact[] = vis ? [{ value: `${n(+vis[2])} m`, label: "visibility now", tone: "bad" }, { value: `${n(+vis[1])} m`, label: "visibility before" }] : [];
        if (rate) facts.push({ value: `${rate.rate} / h`, label: `planes that can land (normally ${rate.normal})`, tone: "bad" });
        agentBeat(m, {
          headline: vis
            ? cause?.type === "FOG" ? `Fog is forming at ${at}: visibility is dropping fast, so far fewer planes can land` : `The weather at ${at} is getting worse: visibility is dropping`
            : `Raised the alarm: ${incs.length ? incs.map(plainIncident).join(", ") : m.summary}`,
          facts, tone: "bad",
        });
        break;
      }
      case "ReplanRequest": {
        // a new disruption reaching a workflow is told; re-plans after a "no" are told with the "no"
        if (!/^New disruption/.test(m.summary)) break;
        const title = /^New disruption \(([^)]+)\)/.exec(m.summary)?.[1];
        const inc = Object.values(rt.world.incidents).find((x) => x.title === title);
        const aps = ((p.airports as string[] | undefined) ?? []).map(city);
        agentBeat(m, {
          headline: `New problem: ${inc ? plainIncident(inc) : "the situation changed"}. It withdraws the plan that was waiting for approval and asks for a new one for ${listAnd(aps)}`,
          facts: [], tone: inc && inc.severity !== "low" && inc.severity !== "moderate" ? "bad" : undefined,
        });
        break;
      }
      case "ImpactAssessment": {
        const pr = p.projection as { holding: number; conflicts: number; fuelDiversions: number; series?: SeriesPoint[] } | undefined;
        if (!pr || seen.has("prediction")) break;
        seen.add("prediction");
        agentBeat(m, {
          headline: "Predicted the next 4 hours if nobody does anything",
          facts: [
            { value: n(pr.fuelDiversions), label: "planes run low on fuel and must divert", tone: "bad" },
            { value: n(pr.conflicts), label: "planes land to find their gate taken", tone: "bad" },
            { value: `${n(pr.holding / 60)} h`, label: "of circling, all planes added up", tone: "bad" },
          ],
          spark: pr.series?.map((s) => s.circling),
          tone: "bad",
        });
        break;
      }
      case "AirlineConstraints": {
        if (!first) break;
        const flights = ((p.airline as { inbound: number }[] | undefined) ?? []).reduce((s, a) => s + a.inbound, 0);
        const pax = (p.downstream as { connectingPax?: number } | undefined)?.connectingPax ?? 0;
        agentBeat(m, {
          headline: "Worked out which flights and passengers are hit, so the plan protects connections",
          facts: [{ value: n(flights), label: "flights affected" }, { value: n(pax), label: "passengers with connections to catch" }],
        });
        break;
      }
      case "ATCReview": {
        if (!first) break;
        agentBeat(m, {
          headline: rate ? `Set the hard limit: in this weather ${city(rate.airport)} can land only ${rate.rate} planes an hour` : "Brought the runway limits into the plan",
          facts: [
            ...(rate ? [{ value: `${rate.rate} / h`, label: `landings allowed (normally ${rate.normal})`, tone: "bad" as const }] : []),
            { value: "0", label: "instructions to pilots: real controllers stay in charge", tone: "good" },
          ],
        });
        break;
      }
      case "PlanCandidates": {
        const pp = proposalAfter(m.t);
        const ds = pp?.plan.decisions ?? [];
        const c = (a: string) => ds.filter((d) => d.action === a).length;
        const to = [...new Set(ds.filter((d) => d.action === "divert").map((d) => city(d.to!)))];
        const facts: Fact[] = pp ? [
          { value: n(c("divert")), label: `flights sent to ${listOr(to) || "a nearby airport"} before fuel runs low`, tone: "good" },
          { value: n(c("assign_stand")), label: "aircraft given a different gate" },
          { value: n(c("landing_slot")), label: "flights given a landing time" },
        ] : [];
        if (first) {
          const k = ((p.comparison as unknown[] | undefined) ?? []).length || 3;
          agentBeat(m, { headline: `Built ${k} possible plans with a mathematical optimiser, tested each one 4 hours ahead, and picked the best`, facts, tone: "good" });
        } else {
          agentBeat(m, { headline: rejected ? `Re-planned around it: version ${pp?.version ?? ""} keeps every flight within what each airport can really handle` : `Built an updated plan: version ${pp?.version ?? ""}`, facts });
        }
        break;
      }
      case "ValidationResult": {
        if (!first) break;
        const pp = proposalAfter(m.t);
        const checks = pp ? Object.values(pp.validation.checks).reduce((s, x) => s + x, 0) : 0;
        agentBeat(m, {
          headline: "Double-checked the plan on its own before anyone sees it: gate sizes, runway limits, fuel, wheelchair access",
          facts: checks ? [{ value: n(checks), label: "rules checked", tone: "good" }, { value: "0", label: "problems found", tone: "good" }] : [],
          tone: "good",
        });
        break;
      }
      case "CoordinationRequest": {
        if (!first) break;
        const group = [m];
        while (msgs[i + 1]?.type === "CoordinationRequest") group.push(msgs[++i]);
        agentBeat(m, {
          headline: "Sent the plan to the people who must approve it. Nothing happens until they agree",
          facts: [{ value: n(group.length), label: "people asked: airports, airlines, air-traffic control, supervisor" }],
          msgs: group,
        });
        break;
      }
      case "StakeholderResponse": {
        const d = String(p.decision ?? "");
        if (d === "APPROVED" || d === "ACKNOWLEDGED") {
          // approvals arriving together are told once ("12 people approved")
          const group = [m];
          while (msgs[i + 1]?.type === "StakeholderResponse" && ["APPROVED", "ACKNOWLEDGED"].includes(String(msgs[i + 1].payload.decision))) group.push(msgs[++i]);
          const pp = Object.values(rt.proposals).find((x) => x.id === p.proposal && x.version === p.version);
          const left = pp ? pp.approvals.filter((s) => s.decision === "PENDING").length : 0;
          out.push({ id: m.id, t: group[group.length - 1].t, who: "sh:AIRLINES", to: [], msgs: group, name: "People in charge",
            headline: `${group.length} ${group.length === 1 ? "person" : "people"} approved: ${listAnd([...new Set(group.map((g) => { const s = pp?.approvals.find((x) => x.key === g.payload.slot); return s ? peopleWord(s.type) : "a stakeholder"; }))])}`,
            facts: [{ value: n(group.length), label: "approvals", tone: "good" }, ...(left ? [{ value: n(left), label: "still to answer" }] : [])], tone: "good" });
          break;
        }
        if (d !== "REJECTED" && d !== "REVISION_REQUESTED") break;
        const slot = Object.values(rt.proposals).flatMap((x) => x.approvals).find((s) => s.key === p.slot);
        const who = slot ? whoSaid(slot) : m.fromLabel ?? "A stakeholder";
        const reason = m.summary.split(" — ").slice(1).join(" — ");
        const e = endpoints(m);
        rejected = true;
        out.push({ id: m.id, t: m.t, who: e.from === "coordination" ? slotNode(String(p.slot)) : e.from, to: ["coordination"], msgs: [m],
          name: who, headline: `Said no${reason ? `: ${reason}` : ""}`, facts: [], tone: "bad" });
        break;
      }
      case "LocalInformationShared":
        agentBeat(m, { headline: "Shared that local fact with every agent, so the next plan respects it", facts: [] });
        break;
      case "PlanInvalidated":
        if (/rejection|revision/.test(m.summary)) break;
        agentBeat(m, { headline: "Withdrew the plan: the situation changed before people approved it", facts: [], tone: "bad" });
        break;
      case "PlanCommitted":
        agentBeat(m, { headline: "Everyone said yes, so the plan now runs", facts: [], tone: "good" });
        break;
      case "Escalation":
        agentBeat(m, { headline: `Asked the supervisor for help: ${m.summary}`, facts: [], tone: "bad" });
        break;
    }
    seen.add(m.type);
  }

  // where things stand now: the latest plan waiting for approvals
  const open = [...props].reverse().find((x) => isOpen(x) && x.createdAt >= from);
  if (open) {
    const a = approvalState(open, "NATIONAL_SUPERVISOR");
    const lastT = Math.max(open.createdAt, ...open.approvals.map((s) => s.t ?? 0));
    out.push({ id: `final:${open.id}:${open.version}`, t: lastT, who: "sh:NATIONAL_SUPERVISOR", to: [], msgs: [], name: "People in charge",
      headline: a.done === a.total - 1 ? "Everyone else has approved. The final yes belongs to the national supervisor: that's you"
        : `${a.done} of ${a.total} people have approved so far. The plan runs only when every one of them says yes`,
      facts: [{ value: `${a.done} / ${a.total}`, label: "approvals in", tone: "good" }] });
  }
  return out;
}
