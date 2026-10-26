/**
 * Event-driven multi-agent orchestration (deterministic agents with real tool calls).
 *
 * Simulator domain events trigger workflows. Each agent may only call the tools in its definition;
 * every call is recorded with parameters, timing and result, and agents communicate through typed
 * messages that the Agent Coordination console replays. While an analysis or replan is running the
 * simulation clock is held, so the timeline stays deterministic; approvals happen while the clock runs.
 */

import { AIRCRAFT } from "../aircraft";
import { AIRLINES } from "../airlines";
import type { Registry } from "../airports/registry";
import { AuditLog } from "../approvals/audit";
import { roleOf } from "../approvals/roles";
import {
  allApproved, decisionDeadline, decisionsOf, isOpen, requiredApprovals, type ApprovalSlot, type Decision4, type Proposal,
} from "../approvals/workflow";
import { slimWorld, type ComputeClient } from "../compute";
import { rngFor } from "../rng";
import { bucketCapacity, bucketOf } from "../sim/capacity";
import type { Engine } from "../sim/engine";
import { metar } from "../sim/weather";
import type { Projection } from "../solver/evaluate";
import type { PlanResult } from "../solver/milp";
import { buildProblem, problemStats, type Forbidden } from "../solver/problem";
import { diffSnapshot, validatePlan } from "../solver/validate";
import type { DomainEvent, World } from "../types";
import { callsignOf, fmtTime } from "../world";
import { AGENTS } from "./definitions";
import { explainProposal } from "./explain";
import { narrateBriefing, type LlmStatus } from "./llm";
import { evaluateAsStakeholder, type StakeholderVerdict } from "./stakeholders";
import type { AgentAction, AgentId, AgentMessage, MessageType, Participant, Workflow } from "./types";

export interface Host {
  readonly world: World;
  readonly airports: Registry;
  readonly engine: Engine;
  readonly compute: ComputeClient;
  readonly audit: AuditLog;
  proposals: Record<string, Proposal>;
  stakeholderModes: Record<string, "human" | "simulated">;
  pacingMs: number;
  llm: LlmStatus | null;
  hold(reason: string): void;
  release(reason: string): void;
  scheduleAt(t: number, label: string, fn: () => void): void;
  notify(): void;
  onCommitted?(p: Proposal, preCommit: World): void;
}

type Trigger =
  | { kind: "disruption"; airports: string[]; title: string; incidents: string[]; cause: string }
  | { kind: "conflict"; airport: string; title: string; cause: string }
  | { kind: "response"; proposal: string; slot: string; verdict: StakeholderVerdict; by: string; human: boolean }
  | { kind: "stale"; proposal: string; detail: string; changes: { kind: string; id: string; detail: string }[] }
  | { kind: "replan"; reason: string; by: string };

export class AuthorityError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HORIZON = 4 * 3600;

export class Orchestrator {
  messages: AgentMessage[] = [];
  actions: AgentAction[] = [];
  workflows: Workflow[] = [];
  activeWorkflow: string | null = null;
  computing: { agent: AgentId; tool: string; since: number } | null = null;
  private queue: Trigger[] = [];
  private pumping = false;
  private n = { msg: 0, act: 0, wf: 0, pln: 0 };
  private forbidden: Forbidden[] = [];
  private lastConflictAt: Record<string, number> = {};
  private seenIncidents = new Set<string>();
  private lastStaleSig = "";

  constructor(private host: Host) {}

  // ================================================================ recording helpers
  private get w() { return this.host.world; }

  private msg(from: Participant, to: Participant[], type: MessageType, summary: string, payload: Record<string, unknown>,
    causedBy: string | null, thread: string, fromLabel?: string): AgentMessage {
    const m: AgentMessage = { id: `MSG-${String(++this.n.msg).padStart(4, "0")}`, t: this.w.now, wall: Date.now(), from, fromLabel,
      to, type, summary, payload, causedBy, thread };
    this.messages.push(m);
    const wf = this.workflows.find((x) => x.id === thread);
    wf?.steps.push({ t: m.t, wall: m.wall, label: `${type}: ${summary}`, agent: from });
    this.host.notify();
    return m;
  }

  private async tool<T>(agent: AgentId, tool: string, params: Record<string, unknown>, thread: string, trigger: string | null,
    fn: () => T | Promise<T>, summarize: (r: T) => string, constraints?: string[]): Promise<T> {
    const id = `ACT-${String(++this.n.act).padStart(4, "0")}`;
    if (!AGENTS[agent].tools.includes(tool)) {
      this.actions.push({ id, agent, t: this.w.now, wall: Date.now(), durationMs: 0, tool, params, thread, trigger, outputs: [],
        status: "blocked", summary: `Blocked: ${AGENTS[agent].name} is not authorised to call ${tool}`, result: null });
      this.host.notify();
      throw new AuthorityError(`${agent} may not call ${tool}`);
    }
    this.computing = { agent, tool, since: Date.now() };
    this.host.notify();
    const t0 = performance.now();
    try {
      const result = await fn();
      const action: AgentAction = { id, agent, t: this.w.now, wall: Date.now(), durationMs: Math.round((performance.now() - t0) * 10) / 10,
        tool, params, summary: summarize(result), result: trimResult(result), trigger, thread, status: "ok", constraints, outputs: [] };
      this.actions.push(action);
      return result;
    } catch (e) {
      this.actions.push({ id, agent, t: this.w.now, wall: Date.now(), durationMs: Math.round(performance.now() - t0), tool, params,
        summary: `Error: ${(e as Error).message}`, result: null, trigger, thread, status: "error", outputs: [] });
      throw e;
    } finally {
      this.computing = null;
      this.host.notify();
    }
  }

  private linkOutputs(msg: AgentMessage) {
    const last = [...this.actions].reverse().find((a) => a.agent === msg.from && a.thread === msg.thread);
    if (last) last.outputs.push(msg.id);
  }

  private say(...args: Parameters<Orchestrator["msg"]>): AgentMessage {
    const m = this.msg(...args);
    this.linkOutputs(m);
    return m;
  }

  private async pace(factor = 1) {
    if (this.host.pacingMs > 0) await sleep(this.host.pacingMs * factor);
  }

  private newWorkflow(title: string, airports: string[], trigger: string): Workflow {
    const wf: Workflow = { id: `WF-${String(++this.n.wf).padStart(3, "0")}`, title, airports, status: "analysing", startedAt: this.w.now,
      startedWall: Date.now(), trigger, proposals: [], steps: [] };
    this.workflows.push(wf);
    this.activeWorkflow = wf.id;
    return wf;
  }

  private openProposal(): Proposal | null {
    return Object.values(this.host.proposals).filter(isOpen).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }

  // ================================================================ triggers from the simulator
  /** Returns true if a workflow has been queued (the runtime should hold the clock). */
  onDomainEvents(events: DomainEvent[]): boolean {
    let queued = false;
    const incidents = events.filter((e) => e.kind === "INCIDENT_ACTIVATED" && e.data.shared !== false);
    if (incidents.length) {
      const fresh = incidents.filter((e) => !this.seenIncidents.has(String(e.data.incident)));
      fresh.forEach((e) => this.seenIncidents.add(String(e.data.incident)));
      if (fresh.length) {
        const airports = [...new Set(fresh.map((e) => e.airport!).filter(Boolean))];
        this.queue.push({ kind: "disruption", airports, incidents: fresh.map((e) => String(e.data.incident)),
          title: fresh.map((e) => String(e.data.title)).join(" · "), cause: fresh.map((e) => e.kind).join(",") });
        queued = true;
      }
    }
    for (const e of events) {
      if (e.kind === "WEATHER_UPDATE") this.weatherWatch(e);
      if ((e.kind === "STAND_CONFLICT" || e.kind === "FUEL_DIVERSION") && e.airport) {
        const open = this.openProposal();
        const covered = open && open.plan.decisions.some((d) => d.visit === e.data.visit);
        const last = this.lastConflictAt[e.airport] ?? -1e9;
        if (e.kind === "FUEL_DIVERSION") {
          this.say("airport_ops", ["coordination", "recovery"], "ImpactAssessment",
            `${e.data.callsign} reached minimum fuel holding for ${e.airport} and diverted to ${e.data.to} (crew decision, uncoordinated)`,
            { event: e.kind, ...e.data }, null, this.activeWorkflow ?? "WF-000");
        }
        if (!covered && this.w.now - last > 900 && !this.queue.some((q) => q.kind === "conflict" && q.airport === e.airport)) {
          this.lastConflictAt[e.airport] = this.w.now;
          this.queue.push({ kind: "conflict", airport: e.airport, title: `${e.kind === "FUEL_DIVERSION" ? "Unplanned diversion" : "Stand conflict"} at ${e.airport} — ${e.data.callsign}`, cause: e.kind });
          queued = true;
        }
      }
    }
    if (queued) void this.pump();
    return queued;
  }

  private weatherWatch(e: DomainEvent) {
    const prev = e.data.prev as World["weather"][string] | undefined;
    const obs = e.data.obs as World["weather"][string];
    if (!prev || prev.category === obs.category) return;
    const icao = e.airport!;
    void this.tool("weather", "classify_change", { airport: icao, from: prev.category, to: obs.category }, this.activeWorkflow ?? "WF-000", null,
      () => ({ from: prev.category, to: obs.category, visibility: obs.visibility }),
      (r) => `${icao} weather category ${r.from} → ${r.to} (visibility ${r.visibility} m) — simulated observation`).then(() => {
      this.say("weather", ["airport_ops", "atc"], "DisruptionNotice",
        `${icao}: conditions ${prev.category} → ${obs.category}, visibility ${Math.round(prev.visibility)} → ${Math.round(obs.visibility)} m (trend watch)`,
        { airport: icao, metar: metar(icao, obs, this.w.now), category: obs.category, informational: true }, null, this.activeWorkflow ?? "WF-000");
    });
  }

  hasPending(): boolean {
    return this.queue.length > 0 || this.pumping;
  }

  enqueue(t: Trigger) {
    this.queue.push(t);
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    this.host.hold("agents");
    try {
      while (this.queue.length) {
        const t = this.queue.shift()!;
        try {
          await this.handle(t);
        } catch (e) {
          if (!(e instanceof AuthorityError)) console.error("[SKYPACT] workflow error", e);
        }
      }
    } finally {
      this.pumping = false;
      this.host.release("agents");
      this.host.notify();
    }
  }

  private async handle(t: Trigger) {
    if (t.kind === "disruption" || t.kind === "conflict") {
      const open = this.openProposal();
      const airports = t.kind === "disruption" ? t.airports : [t.airport];
      if (open) {
        // a new disruption while a plan is out for approval: supersede it and replan with wider scope
        const wf = this.workflows.find((x) => x.id === open.thread)!;
        wf.airports = [...new Set([...wf.airports, ...airports])];
        const m = this.say("coordination", ["recovery", "validation"], "ReplanRequest",
          `New disruption (${t.title}) affects ${airports.join(", ")}; superseding ${open.id} v${open.version} and replanning across ${wf.airports.join(", ")}`,
          { supersedes: open.id, airports: wf.airports }, null, wf.id);
        this.setStatus(open, "SUPERSEDED", `superseded: ${t.title}`, "Coordination Agent");
        await this.assess(wf, t.kind === "disruption", m.id);
        await this.plan(wf, m.id, open);
        return;
      }
      const wf = this.newWorkflow(t.title, airports, t.cause);
      const notice = t.kind === "disruption" ? await this.weatherStep(wf, t) : null;
      const proceed = await this.assess(wf, true, notice?.id ?? null);
      if (!proceed) {
        wf.status = "closed";
        this.say("coordination", ["supervisor"], "Escalation", `Monitoring only: no recovery action needed for ${wf.title}`, {}, null, wf.id);
        this.activeWorkflow = null;
        return;
      }
      await this.plan(wf, null, null);
      return;
    }
    if (t.kind === "response") return this.onResponse(t);
    if (t.kind === "stale") {
      const p = this.host.proposals[t.proposal];
      if (!p || !isOpen(p)) return;
      const wf = this.workflows.find((x) => x.id === p.thread)!;
      this.setStatus(p, "STALE", t.detail, "Validation & Safety Agent");
      p.staleReason = t.detail;
      p.changedInputs = t.changes;
      const inv = this.say("validation", ["coordination", "recovery"], "PlanInvalidated", `${p.id} v${p.version} is stale: ${t.detail}`,
        { proposal: p.id, changes: t.changes }, null, wf.id);
      await this.pace();
      const rq = this.say("coordination", ["recovery"], "ReplanRequest", `Recalculate with current inputs (${p.id} invalidated)`, { proposal: p.id }, inv.id, wf.id);
      await this.plan(wf, rq.id, p);
      return;
    }
    if (t.kind === "replan") {
      const open = this.openProposal();
      const wf = open ? this.workflows.find((x) => x.id === open.thread)! : this.newWorkflow(`Manual replan — ${t.reason}`, Object.keys(this.host.airports), "MANUAL");
      if (open) this.setStatus(open, "SUPERSEDED", `replan requested by ${t.by}: ${t.reason}`, t.by);
      const rq = this.say("supervisor", ["recovery"], "ReplanRequest", `${t.by}: ${t.reason}`, {}, null, wf.id, t.by);
      await this.assess(wf, false, rq.id);
      await this.plan(wf, rq.id, open);
    }
  }

  // ================================================================ agent steps
  private async weatherStep(wf: Workflow, t: Extract<Trigger, { kind: "disruption" }>): Promise<AgentMessage> {
    const obs = await this.tool("weather", "read_weather", { airports: t.airports }, wf.id, null,
      () => Object.fromEntries(t.airports.map((a) => [a, { ...this.w.weather[a], metar: this.w.weather[a] ? metar(a, this.w.weather[a], this.w.now) : "" }])),
      (r) => Object.entries(r).map(([a, o]) => `${a}: ${o.category ?? "—"}, vis ${Math.round(o.visibility ?? 10000)} m`).join(" · "));
    const incs = await this.tool("weather", "read_incidents", { airports: t.airports, sharedOnly: true }, wf.id, null,
      () => t.incidents.map((id) => this.w.incidents[id]).filter(Boolean).map((i) => ({ id: i.id, type: i.type, airport: i.airport, title: i.title,
        start: i.start, end: i.end, severity: i.severity, source: i.source, params: i.params })),
      (r) => r.map((i) => `${i.id} ${i.type} at ${i.airport} until ${fmtTime(i.end)} (${i.source})`).join(" · "));
    const changes = await this.tool("weather", "classify_change", { incidents: t.incidents }, wf.id, null,
      () => incs.map((i) => {
        const p = this.host.airports[i.airport].profile;
        const rate = (i.params as Record<string, unknown>).arr_rate;
        return { airport: i.airport, type: i.type, material: true, simulatedRestriction: rate !== undefined ? `arrivals ${rate}/h (normal ${p.arrCapacity}/h)` : null,
          reference: i.type === "FOG" ? "Low-visibility procedures apply below published RVR minima (reference concept; values here are scenario inputs)" : null };
      }),
      (r) => r.map((c) => `${c.airport} ${c.type}: material${c.simulatedRestriction ? `, simulated restriction ${c.simulatedRestriction}` : ""}`).join(" · "),
      ["Reference information kept separate from simulated restrictions"]);
    await this.pace(0.6);
    return this.say("weather", ["airport_ops", "atc", "coordination"], "DisruptionNotice", t.title,
      { incidents: incs, observations: obs, changes }, null, wf.id);
  }

  /** Airport operations impact assessment (+ airline and ATC context). Returns false if nothing needs action. */
  private async assess(wf: Workflow, full: boolean, causedBy: string | null): Promise<boolean> {
    const aps = wf.airports;
    await this.pace(0.6);
    const runway = await this.tool("airport_ops", "get_runway_status", { airports: aps }, wf.id, causedBy, () => aps.map((a) => {
      const ap = this.host.airports[a];
      const b0 = bucketOf(this.w.now);
      const caps = Array.from({ length: 12 }, (_, i) => bucketCapacity(this.w, ap.profile, b0 + i, "arr", true));
      const closed = Object.values(this.w.restrictions).filter((r) => r.airport === a && r.kind === "RUNWAY_CLOSED" && r.shared && r.end > this.w.now)
        .map((r) => String(r.params.runway));
      return { airport: a, arrivalRunway: ap.arrivalEnd, departureRunway: ap.departureEnd, arrivalsNext3h: caps.reduce((s, x) => s + x, 0),
        normalNext3h: ap.profile.arrCapacity * 3, closed };
    }), (r) => r.map((x) => `${x.airport}: ${x.arrivalsNext3h}/${x.normalNext3h} arrival slots next 3 h${x.closed.length ? `, closed ${x.closed.join(",")}` : ""}`).join(" · "));
    const occ = await this.tool("airport_ops", "get_stand_occupancy", { airports: aps }, wf.id, causedBy, () => aps.map((a) => {
      const st = Object.values(this.w.stands).filter((s) => s.airport === a);
      const blocked = Object.values(this.w.visits).filter((v) => v.airport === a && v.techHoldUntil !== null && v.techHoldUntil > this.w.now && v.phase === "ON_STAND").length;
      return { airport: a, stands: st.length, occupied: st.filter((s) => s.occupant).length, reserved: st.filter((s) => s.reservedBy).length, blocked };
    }), (r) => r.map((x) => `${x.airport}: ${x.occupied}/${x.stands} occupied, ${x.blocked} blocked`).join(" · "));
    const proj = await this.tool("airport_ops", "project_operations", { policy: "no_action", horizonMin: HORIZON / 60, sharedOnly: true }, wf.id, causedBy,
      async () => (await this.host.compute.projectMany(slimWorld(this.w), [{ key: "noAction", policy: "no_action", sharedOnly: true }], HORIZON)).noAction,
      (p) => `No-action projection (${(p.horizonS / 3600).toFixed(0)} h): ${p.totalDelayMin.toFixed(0)} delay-min, ${p.airborneHoldingMin.toFixed(0)} min holding, ${p.standConflicts} stand conflicts, ${p.fuelDiversions} fuel diversions · ${p.computeMs} ms`);
    const conflicts = await this.tool("airport_ops", "detect_conflicts", { airports: aps }, wf.id, causedBy,
      () => proj.events.filter((e) => e.kind === "STAND_CONFLICT" || e.kind === "FUEL_DIVERSION" || e.kind === "PRM_SERVICE_DELAY"),
      (r) => r.length ? r.slice(0, 4).map((e) => `${e.callsign} ${e.kind.replace(/_/g, " ").toLowerCase()} @${fmtTime(e.t)}`).join(" · ") + (r.length > 4 ? ` +${r.length - 4} more` : "") : "No conflicts predicted");
    const restricted = aps.filter((a) => Object.values(this.w.restrictions).some((r) => r.airport === a && r.shared && r.end > this.w.now
      && (r.kind === "ARRIVAL_CAPACITY" || r.kind === "RUNWAY_CLOSED")));
    const material = restricted.length > 0 || conflicts.length > 0 || proj.airborneHoldingMin > 60;
    const assessment = this.say("airport_ops", ["recovery", "airline_ops", "atc"], "ImpactAssessment",
      `${conflicts.filter((c) => c.kind === "STAND_CONFLICT").length} stand conflicts, ${proj.fuelDiversions} fuel-diversion risks, ${proj.airborneHoldingMin.toFixed(0)} min holding predicted without action`,
      { runway, occupancy: occ, projection: { totalDelayMin: proj.totalDelayMin, holding: proj.airborneHoldingMin, conflicts: proj.standConflicts, fuelDiversions: proj.fuelDiversions }, conflicts: conflicts.slice(0, 30), restricted },
      causedBy, wf.id);
    if (!full) return material;
    await this.pace(0.6);
    const affected = new Map<string, number>();
    for (const v of Object.values(this.w.visits)) {
      if (!aps.includes(v.airport) || !v.arr || v.eta === null || v.eta > this.w.now + 3 * 3600) continue;
      if (!["SCHEDULED", "INBOUND", "HOLDING"].includes(v.phase)) continue;
      affected.set(v.airline, (affected.get(v.airline) ?? 0) + 1);
    }
    const [airline] = await Promise.all([
      this.tool("airline_ops", "get_affected_flights", { airports: aps, horizonH: 3 }, wf.id, assessment.id,
        () => [...affected].map(([a, n]) => ({ airline: a, name: AIRLINES[a]?.name, inbound: n })).sort((a, b) => b.inbound - a.inbound),
        (r) => r.slice(0, 5).map((x) => `${x.name} ${x.inbound}`).join(" · ")),
      this.tool("atc", "get_arrival_capacity", { airports: aps }, wf.id, assessment.id, () => runway,
        (r) => r.map((x) => `${x.airport} RWY ${x.arrivalRunway}: ${x.arrivalsNext3h} arrivals/3h (scenario capacity input)`).join(" · ")),
    ]);
    const downstream = await this.tool("airline_ops", "estimate_downstream", { airports: aps }, wf.id, assessment.id, () => {
      let connecting = 0, rotations = 0;
      for (const v of Object.values(this.w.visits)) {
        if (!aps.includes(v.airport) || !["SCHEDULED", "INBOUND", "HOLDING"].includes(v.phase) || (v.eta ?? 1e12) > this.w.now + 3 * 3600) continue;
        connecting += v.connecting;
        if (v.dep) rotations += 1;
      }
      return { connectingPax: connecting, outboundRotationsAtRisk: rotations };
    }, (r) => `${r.connectingPax} connecting passengers and ${r.outboundRotationsAtRisk} outbound rotations exposed`);
    const prefs = await this.tool("airline_ops", "get_airline_preferences", { airlines: airline.map((a) => a.airline) }, wf.id, assessment.id,
      () => airline.map((a) => ({ airline: a.airline, handlingAt: AIRLINES[a.airline]?.handlingAt ?? [] })),
      (r) => r.filter((x) => x.handlingAt.length < 3).map((x) => `${x.airline}: handling only at ${x.handlingAt.join("/")}`).join(" · ") || "All carriers have handling arrangements at all three airports");
    this.say("airline_ops", ["recovery"], "AirlineConstraints", `${airline.reduce((s, a) => s + a.inbound, 0)} inbound flights across ${airline.length} carriers; ${downstream.connectingPax} connecting passengers exposed`,
      { airline, downstream, preferences: prefs }, assessment.id, wf.id);
    this.say("atc", ["recovery", "coordination"], "ATCReview",
      `Modelled arrival capacity noted for ${aps.join(", ")}; any landing-sequence targets or diversions will need review by authorised ATC staff`,
      { runway, note: "Information only — SKYPACT does not issue clearances" }, assessment.id, wf.id);
    return material;
  }

  private async plan(wf: Workflow, causedBy: string | null, previous: Proposal | null): Promise<void> {
    wf.status = previous ? "replanning" : "analysing";
    await this.pace(0.6);
    const scope = [...new Set([...wf.airports, ...Object.values(this.w.restrictions)
      .filter((r) => r.shared && r.end > this.w.now && (r.kind === "ARRIVAL_CAPACITY" || r.kind === "RUNWAY_CLOSED")).map((r) => r.airport)])];
    const pb = await this.tool("recovery", "build_recovery_problem", { scope, horizonMin: 180, forbidden: this.forbidden.length }, wf.id, causedBy,
      () => buildProblem(this.w, this.host.airports, { scope, forbidden: this.forbidden }),
      (p) => { const s = problemStats(p); return `${s.flights} movable flights, ${s.homeOptions} home + ${s.diversionOptions} diversion options, ${s.fixedOccupancies} fixed occupancies, ${s.excludedOptions} options excluded by hard rules`; },
      ["Shared operational picture only"]);
    const plans = await this.tool("recovery", "run_optimizer", { solver: "HiGHS MILP (WebAssembly)", variants: ["min_delay", "stability", "min_coord"] }, wf.id, causedBy,
      () => this.host.compute.solve(pb, 30),
      (r) => r.map((p) => `${p.label}: ${p.status} in ${p.solveMs.toFixed(0)} ms (${p.numVars} vars, ${p.numRows} rows)`).join(" · "),
      ["Stand exclusivity", "Arrival capacity", "Fuel", "Diversion eligibility & acceptance", "Accessibility", "Handling teams"]);
    const valid = plans.filter((p) => p.rows.length);
    if (!valid.length) {
      this.say("recovery", ["coordination", "supervisor"], "Escalation", "Optimiser returned no plan; escalating to the National Operations Supervisor", { statuses: plans.map((p) => p.status) }, causedBy, wf.id);
      wf.status = "escalated";
      return;
    }
    const jobs = [{ key: "noAction", policy: "no_action" as const, sharedOnly: true }, { key: "localGreedy", policy: "local_greedy" as const, sharedOnly: true },
      ...valid.map((p) => ({ key: p.variant, policy: "live" as const, decisions: p.decisions, sharedOnly: true }))];
    const evals = await this.tool("recovery", "evaluate_plans", { horizonMin: HORIZON / 60, baselines: ["no_action", "local_greedy"], candidates: valid.length }, wf.id, causedBy,
      () => this.host.compute.projectMany(slimWorld(this.w), jobs, HORIZON),
      (r) => valid.map((p) => `${p.variant}: ${r[p.variant].totalDelayMin.toFixed(0)} min`).join(" · ") + ` · baseline ${r.noAction.totalDelayMin.toFixed(0)} / local ${r.localGreedy.totalDelayMin.toFixed(0)} min`);
    const ranked = [...valid].sort((a, b) => a.kpis.unresolved - b.kpis.unresolved
      || evals[a.variant].totalDelayMin + evals[a.variant].airborneHoldingMin * 0.5 - (evals[b.variant].totalDelayMin + evals[b.variant].airborneHoldingMin * 0.5)
      || a.kpis.coordinationRequests - b.kpis.coordinationRequests);
    const rec = ranked[0];
    const recommendedReason = "Fewest unresolved flights, then lowest projected total delay (holding weighted ½), then fewest coordination requests.";
    const cmp = await this.tool("recovery", "compare_plans", { rule: recommendedReason }, wf.id, causedBy, () => ranked.map((p) => ({
      variant: p.variant, label: p.label, unresolved: p.kpis.unresolved, diversions: p.kpis.diversions, standChanges: p.kpis.standChanges,
      projectedDelay: evals[p.variant].totalDelayMin, holding: evals[p.variant].airborneHoldingMin, coordination: p.kpis.coordinationRequests,
      duplicateOf: p.duplicateOf, distinctNote: p.distinctNote,
    })), (r) => `Recommended: ${r[0].label}` + (r.some((x) => x.duplicateOf) ? " (one weighting reproduced an earlier plan)" : ""));
    const cand = this.say("recovery", ["validation", "coordination", "atc"], "PlanCandidates",
      `${valid.length} candidate plan${valid.length > 1 ? "s" : ""}; recommended “${rec.label}” — ${rec.kpis.diversions} diversion(s), ${rec.kpis.standChanges} stand change(s), ${rec.kpis.unresolved} unresolved`,
      { comparison: cmp }, causedBy, wf.id);
    await this.pace();
    const reports = await this.tool("validation", "validate_plan", { plans: valid.map((p) => p.variant), mode: "independent re-derivation" }, wf.id, cand.id,
      () => Object.fromEntries(valid.map((p) => [p.variant, validatePlan(this.w, this.host.airports, p.decisions, p.rows, pb.t0)])),
      (r) => Object.entries(r).map(([k, v]) => `${k}: ${v.valid ? "valid" : `${v.violations.length} violations`}`).join(" · "),
      ["STAND_COMPATIBILITY", "STAND_OVERLAP", "ARRIVAL_CAPACITY", "FUEL", "DIVERSION_ELIGIBILITY", "ACCESSIBILITY", "PHASE"]);
    const chosen = ranked.find((p) => reports[p.variant].valid) ?? null;
    if (!chosen) {
      this.say("validation", ["coordination", "supervisor"], "Escalation", "No candidate passed independent validation — escalated to the supervisor", { reports }, cand.id, wf.id);
      wf.status = "escalated";
      return;
    }
    const slots = await this.tool("validation", "required_approvals", { proposalVariant: chosen.variant }, wf.id, cand.id,
      () => requiredApprovals(chosen, this.w, this.host.stakeholderModes),
      (r) => r.map((s) => `${roleOf(s.key).title}${s.mode === "human" ? " (human)" : ""}`).join(" · "));
    this.say("validation", ["coordination"], "ValidationResult", `${chosen.label} passed all hard-constraint checks; ${slots.length} approvals required`,
      { report: reports[chosen.variant], approvals: slots.map((s) => s.key) }, cand.id, wf.id);
    await this.pace();
    if (chosen.decisions.some((d) => d.action === "divert" || d.action === "landing_slot")) {
      await this.tool("atc", "check_plan_restrictions", { variant: chosen.variant }, wf.id, cand.id, () => {
        const ds = chosen.decisions.filter((d) => d.action === "divert" || d.action === "landing_slot");
        return { landingTargets: ds.filter((d) => d.action === "landing_slot").length, diversions: ds.filter((d) => d.action === "divert").length, withinModelledRates: reports[chosen.variant].checks.ARRIVAL_CAPACITY };
      }, (r) => `${r.landingTargets} landing-sequence targets and ${r.diversions} diversions checked against modelled rates — human ATC review required`);
      this.say("atc", ["coordination"], "ATCReview", `Plan compatible with modelled arrival rates; flagged for authorised ATC review (no clearances issued)`, {}, cand.id, wf.id);
      await this.pace(0.6);
    }
    const proposal = await this.tool("coordination", "create_proposal", { variant: chosen.variant, supersedes: previous?.id ?? null }, wf.id, cand.id,
      () => this.createProposal(wf, chosen, valid, evals, reports[chosen.variant], slots, pb, previous, recommendedReason),
      (p) => `${p.id} v${p.version} created (${p.plan.decisions.length} actions); decision deadline ${p.decisionDeadline ? fmtTime(p.decisionDeadline.t) : "—"}`);
    for (const slot of proposal.approvals) {
      await this.tool("coordination", "send_coordination_request", { proposal: proposal.id, to: slot.key, items: slot.items.length }, wf.id, cand.id,
        () => slot, (s) => `Request to ${s.label}${s.mode === "human" ? " — awaiting a human decision" : ""}`);
      this.say("coordination", ["stakeholder"], "CoordinationRequest", `${proposal.id} v${proposal.version} → ${slot.label}: ${slot.items.slice(0, 2).join("; ")}${slot.items.length > 2 ? ` (+${slot.items.length - 2})` : ""}`,
        { proposal: proposal.id, slot: slot.key, items: slot.items, mode: slot.mode }, cand.id, wf.id);
      if (slot.mode === "simulated") this.scheduleSimulatedResponse(proposal, slot);
    }
    if (chosen.kpis.unresolved) {
      this.say("coordination", ["supervisor"], "Escalation", `${chosen.kpis.unresolved} flight(s) could not be accommodated within modelled constraints — human action required`,
        { unresolved: chosen.decisions.filter((d) => d.action === "unresolved").map((d) => d.callsign) }, cand.id, wf.id);
    }
    wf.status = "awaiting_approval";
    if (this.host.llm?.available && this.host.llm.model) void this.attachNarrative(proposal, this.host.llm.model);
  }

  private createProposal(wf: Workflow, chosen: PlanResult, candidates: PlanResult[], evals: Record<string, Projection>,
    report: ReturnType<typeof validatePlan>, slots: Omit<ApprovalSlot, "requestedAt">[], pb: ReturnType<typeof buildProblem>,
    previous: Proposal | null, recommendedReason: string): Proposal {
    const id = previous ? previous.id : `PLN-${String(++this.n.pln).padStart(3, "0")}`;
    const version = previous ? previous.version + 1 : 1;
    const key = `${id}#${version}`;
    const p: Proposal = {
      id: key, version, thread: wf.id, variant: chosen.variant, label: chosen.label, status: "PROPOSED", createdAt: this.w.now, createdWall: Date.now(),
      t0: pb.t0, plan: chosen, candidates, recommendedReason, validation: report,
      approvals: slots.map((s) => ({ ...s, requestedAt: this.w.now, dueAt: undefined })), supersedes: previous?.id ?? null, supersededBy: null,
      history: [{ t: this.w.now, wall: Date.now(), status: "PROPOSED", note: `created from ${chosen.label}`, by: "Coordination Agent" }],
      snapshot: pb.snapshot, forbidden: [...this.forbidden], problemStats: problemStats(pb) as unknown as Record<string, unknown>,
      projections: { noAction: evals.noAction, localGreedy: evals.localGreedy, plan: evals[chosen.variant],
        candidates: Object.fromEntries(candidates.map((c) => [c.variant, evals[c.variant]])) },
      decisionDeadline: decisionDeadline(chosen, this.w),
    };
    p.id = id;
    if (previous) previous.supersededBy = `${id} v${version}`;
    this.host.proposals[key] = p;
    wf.proposals.push(key);
    this.host.audit.append(this.w.now, "Coordination Agent", "agent", "PROPOSAL_CREATED", `${id} v${version}`,
      `${chosen.label}; ${chosen.decisions.length} actions; validation ${report.valid ? "passed" : "failed"}`);
    return p;
  }

  private async attachNarrative(p: Proposal, model: string) {
    const ex = explainProposal(p, this.w, this.host.airports);
    const facts = [...ex.whatChanged, ...ex.delayImpact].join("\n");
    const text = await narrateBriefing(model, facts);
    if (text) { p.narrative = { text, source: "local_llm", model }; this.host.notify(); }
  }

  private scheduleSimulatedResponse(p: Proposal, slot: ApprovalSlot) {
    const r = rngFor(this.w.seed, `resp:${p.id}:${p.version}:${slot.key}`);
    const delay = slot.type === "AIRPORT_CONTROLLER" ? r.uniform(90, 200) : slot.type === "AIRLINE_REP" ? r.uniform(60, 150)
      : slot.type === "ATC_LIAISON" ? r.uniform(45, 120) : r.uniform(60, 120);
    slot.dueAt = this.w.now + delay;
    const key = `${p.id}#${p.version}`;
    this.host.scheduleAt(this.w.now + delay, `${slot.label} responds to ${p.id} v${p.version}`, () => {
      const prop = this.host.proposals[key];
      if (!prop || !isOpen(prop)) return;
      const s = prop.approvals.find((x) => x.key === slot.key);
      if (!s || s.decision !== "PENDING" || s.mode !== "simulated") return;
      const verdict = evaluateAsStakeholder(s, prop, this.w, this.host.airports);
      this.enqueue({ kind: "response", proposal: key, slot: slot.key, verdict, by: `${roleOf(slot.key).person} (simulated)`, human: false });
    });
  }

  /** Human decision from the UI (role permissions are checked by the runtime). */
  humanDecision(proposalKey: string, slotKey: string, decision: Decision4, reason: string, by: string) {
    const verdict: StakeholderVerdict = { decision, reason: reason || (decision === "APPROVED" ? "Approved" : decision === "ACKNOWLEDGED" ? "Acknowledged" : "No reason given"),
      codes: ["HUMAN"], revealRestrictions: [], forbid: [] };
    this.enqueue({ kind: "response", proposal: proposalKey, slot: slotKey, verdict, by, human: true });
  }

  private async onResponse(t: Extract<Trigger, { kind: "response" }>) {
    const p = this.host.proposals[t.proposal];
    if (!p) return;
    const wf = this.workflows.find((x) => x.id === p.thread)!;
    const slot = p.approvals.find((s) => s.key === t.slot);
    if (!slot) return;
    if (!isOpen(p)) {
      this.say("coordination", ["stakeholder"], "StakeholderResponse", `Late response from ${slot.label} to ${p.id} v${p.version} ignored (${p.status.toLowerCase()})`, {}, null, wf.id);
      return;
    }
    slot.decision = t.verdict.decision;
    slot.by = t.by;
    slot.t = this.w.now;
    slot.wall = Date.now();
    slot.reason = t.verdict.reason;
    slot.codes = t.verdict.codes;
    this.host.audit.append(this.w.now, t.by, slot.key, `APPROVAL_${t.verdict.decision}`, `${p.id} v${p.version}`, t.verdict.reason);
    const resp = this.msg("stakeholder", ["coordination"], "StakeholderResponse", `${slot.label}: ${t.verdict.decision.replace("_", " ").toLowerCase()} — ${t.verdict.reason}`,
      { proposal: p.id, version: p.version, slot: slot.key, decision: t.verdict.decision, codes: t.verdict.codes, human: t.human }, null, wf.id, `${slot.label}${t.human ? "" : " (simulated)"}`);
    await this.tool("coordination", "record_response", { proposal: `${p.id} v${p.version}`, slot: slot.key, decision: t.verdict.decision }, wf.id, resp.id,
      () => ({ approved: p.approvals.filter((a) => a.decision === "APPROVED" || a.decision === "ACKNOWLEDGED").length, total: p.approvals.length }),
      (r) => `${r.approved}/${r.total} approvals recorded`);
    if (t.verdict.decision === "REJECTED" || t.verdict.decision === "REVISION_REQUESTED") {
      this.host.hold("agents");
      if (t.verdict.revealRestrictions.length) {
        await this.tool("coordination", "share_local_information", { restrictions: t.verdict.revealRestrictions, from: slot.key }, wf.id, resp.id, () => {
          const shared = [];
          for (const rid of t.verdict.revealRestrictions) {
            const r = this.w.restrictions[rid];
            if (r && !r.shared) {
              r.shared = true;
              r.provenance = "stakeholder_reported";
              const inc = r.incidentId ? this.w.incidents[r.incidentId] : undefined;
              if (inc) { inc.shared = true; inc.source = "stakeholder_reported"; }
              shared.push({ id: r.id, airport: r.airport, kind: r.kind, params: r.params, until: r.end });
            }
          }
          return shared;
        }, (r) => r.map((x) => `${x.airport}: ${String(x.params.pool ?? x.kind)} ${x.params.units ?? ""} unavailable until ${fmtTime(x.until)}`).join(" · ") + " — now in the shared picture");
        this.say("coordination", ["recovery", "validation", "airport_ops"], "LocalInformationShared",
          `${slot.label} reported constraints that were not in the shared picture; network view updated`, { restrictions: t.verdict.revealRestrictions }, resp.id, wf.id);
        this.host.audit.append(this.w.now, "Coordination Agent", "agent", "LOCAL_INFO_SHARED", slot.key, t.verdict.revealRestrictions.join(","));
      }
      for (const f of t.verdict.forbid) this.forbidden.push({ visit: f.visit, airport: f.airport, stand: f.stand, reason: `rejected by ${slot.label}` });
      this.setStatus(p, t.verdict.decision === "REJECTED" ? "REJECTED" : "REVISION_REQUESTED", `${slot.label}: ${t.verdict.reason}`, t.by);
      const inv = this.say("validation", ["coordination", "recovery"], "PlanInvalidated", `${p.id} v${p.version} invalidated after ${t.verdict.decision === "REJECTED" ? "rejection" : "revision request"} by ${slot.label}`,
        { proposal: p.id }, resp.id, wf.id);
      await this.pace();
      const rq = await this.tool("coordination", "request_replan", { forbidden: this.forbidden.length, reason: t.verdict.codes.join(",") }, wf.id, inv.id,
        () => ({ forbidden: this.forbidden.slice(-6) }), (r) => `Replan requested with ${this.forbidden.length} excluded option(s): ${r.forbidden.map((f) => `${f.visit}→${f.airport}${f.stand ? `:${f.stand}` : ""}`).join(", ")}`);
      void rq;
      const replan = this.say("coordination", ["recovery"], "ReplanRequest", `Recalculate excluding the rejected options and using the updated shared picture`, {}, inv.id, wf.id);
      await this.plan(wf, replan.id, p);
      return;
    }
    if (allApproved(p)) await this.commit(p, wf, resp.id);
  }

  private async commit(p: Proposal, wf: Workflow, causedBy: string) {
    this.host.hold("agents");
    const rows = p.plan.rows;
    const report = await this.tool("validation", "validate_plan", { proposal: `${p.id} v${p.version}`, stage: "pre-commit revalidation" }, wf.id, causedBy,
      () => validatePlan(this.w, this.host.airports, p.plan.decisions, rows, p.t0),
      (r) => r.valid ? "Revalidated against current state: all hard constraints satisfied" : `${r.violations.length} violation(s): ${r.violations[0].detail}`,
      ["AUTHORISATION", "STAND_OVERLAP", "ARRIVAL_CAPACITY", "PHASE"]);
    if (!report.valid) {
      this.enqueue({ kind: "stale", proposal: `${p.id}#${p.version}`, detail: report.violations.map((v) => v.detail).slice(0, 2).join("; "), changes: diffSnapshot(p.snapshot, this.w) });
      return;
    }
    const preCommit = slimWorld(this.w);
    const log = await this.tool("coordination", "commit_plan", { proposal: `${p.id} v${p.version}`, approvals: p.approvals.length }, wf.id, causedBy,
      () => this.host.engine.applyDecisions(decisionsOf(p), `${p.id} v${p.version}`), (r) => `Committed ${r.length} actions to the simulation after ${p.approvals.length} approvals`);
    p.commitLog = log;
    this.setStatus(p, "COMMITTED", `all ${p.approvals.length} approvals recorded; revalidated`, "System");
    this.host.audit.append(this.w.now, "System", "workflow", "PLAN_COMMITTED", `${p.id} v${p.version}`, `${log.length} actions applied`);
    this.say("coordination", ["supervisor", "airport_ops", "airline_ops", "atc", "recovery", "validation", "weather"], "PlanCommitted",
      `${p.id} v${p.version} committed: ${log.length} actions now drive the simulation`, { log }, causedBy, wf.id);
    wf.status = "committed";
    this.forbidden = [];
    this.activeWorkflow = null;
    this.host.onCommitted?.(p, preCommit);
  }

  private setStatus(p: Proposal, status: Proposal["status"], note: string, by: string) {
    p.status = status;
    p.history.push({ t: this.w.now, wall: Date.now(), status, note, by });
    this.host.audit.append(this.w.now, by, "workflow", `PLAN_${status}`, `${p.id} v${p.version}`, note);
    this.host.notify();
  }

  /** Periodic staleness check for proposals awaiting approval (called by the runtime). */
  checkStaleness() {
    const p = this.openProposal();
    if (!p || p.status !== "PROPOSED" || this.pumping) return;
    const changes = diffSnapshot(p.snapshot, this.w);
    const report = validatePlan(this.w, this.host.airports, p.plan.decisions, p.plan.rows, p.t0);
    const sig = `${p.id}${p.version}|${changes.map((c) => c.id).join(",")}|${report.valid}`;
    if (sig === this.lastStaleSig) return;
    this.lastStaleSig = sig;
    if (!changes.length && report.valid) return;
    void this.tool("validation", "check_staleness", { proposal: `${p.id} v${p.version}`, changedInputs: changes.length }, p.thread, null,
      () => ({ changes, valid: report.valid, violations: report.violations }),
      (r) => r.valid ? `${r.changes.length} input change(s) since computation; plan still valid` : `STALE: ${r.violations[0]?.detail}`).then((r) => {
      if (!r.valid) this.enqueue({ kind: "stale", proposal: `${p.id}#${p.version}`, detail: r.violations.slice(0, 2).map((v) => v.detail).join("; "), changes: r.changes });
    });
  }

  requestReplan(reason: string, by: string) {
    this.enqueue({ kind: "replan", reason, by });
  }
}

function trimResult(r: unknown): unknown {
  try {
    const s = JSON.stringify(r, (_k, v) => (Array.isArray(v) && v.length > 25 ? [...v.slice(0, 25), `… ${v.length - 25} more`] : v));
    if (!s) return null;
    return s.length > 20000 ? { truncated: true, preview: s.slice(0, 2000) } : JSON.parse(s);
  } catch {
    return null;
  }
}

export const proposalKey = (p: { id: string; version: number }) => `${p.id}#${p.version}`;

export const typeLabel = (k: string) => AIRCRAFT[k as keyof typeof AIRCRAFT]?.category ?? k;
export const callsign = callsignOf;
