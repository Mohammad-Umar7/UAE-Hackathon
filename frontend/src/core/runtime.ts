/**
 * Operations runtime: owns the authoritative world, the simulator, the agent orchestrator, the
 * approval workflow and the audit trail. The UI subscribes to it; nothing in the UI mutates state
 * except through the methods here (which enforce role permissions and record inputs for replay).
 */

import { AIRCRAFT } from "./aircraft";
import { orchestratorFor } from "./agents/factory";
import type { LlmStatus } from "./agents/llm";
import type { Orchestrator } from "./agents/orchestrator";
import type { Registry } from "./airports/registry";
import { AuditLog } from "./approvals/audit";
import { can, roleOf } from "./approvals/roles";
import type { Decision4, Proposal } from "./approvals/workflow";
import type { ComputeClient } from "./compute";
import { outcomeMetrics, type OutcomeMetrics } from "./metrics";
import { Engine } from "./sim/engine";
import { buildWorld, injectIncident, type LabIncidentSpec, type LabSpec, type ScenarioDef } from "./sim/scenarios";
import { hourlyRate } from "./sim/capacity";
import type { DomainEvent, Incident, World } from "./types";
import { callsignOf, fmtTime } from "./world";

export interface InputRecord {
  t: number;
  wall: number;
  kind: "inject" | "decision" | "mode" | "replan";
  by: string;
  payload: Record<string, unknown>;
}

export interface Sample {
  t: number;
  airports: Record<string, { inbound: number; holding: number; waiting: number; onStand: number; stands: number; arrRate: number; delayed: number }>;
}

export interface CommittedEvidence {
  proposal: string;
  t: number;
  wall: number;
  noAction: OutcomeMetrics & { standConflicts: number; fuelDiversions: number };
  localGreedy: OutcomeMetrics & { standConflicts: number; fuelDiversions: number };
  plan: OutcomeMetrics & { standConflicts: number; fuelDiversions: number };
  computeMs: number;
}

export const DEFAULT_MODES: Record<string, "human" | "simulated"> = {
  NATIONAL_SUPERVISOR: "human",
  "AIRPORT_CONTROLLER:OMAA": "simulated",
  "AIRPORT_CONTROLLER:OMDB": "simulated",
  "AIRPORT_CONTROLLER:OMSJ": "simulated",
  AIRLINE_REP: "simulated",
  ATC_LIAISON: "simulated",
};

export class Runtime {
  airports: Registry;
  compute: ComputeClient;
  world!: World;
  engine!: Engine;
  orchestrator!: Orchestrator;
  audit = new AuditLog();
  scenario!: ScenarioDef;
  notes: string[] = [];
  seed = 7;
  lab: LabSpec | undefined;
  proposals: Record<string, Proposal> = {};
  stakeholderModes: Record<string, "human" | "simulated"> = { ...DEFAULT_MODES };
  pacingMs = 450;
  llm: LlmStatus | null = null;
  running = false;
  speed = 30;
  holds = new Set<string>();
  version = 0;
  inputs: InputRecord[] = [];
  events: DomainEvent[] = [];
  samples: Sample[] = [];
  evidence: CommittedEvidence[] = [];
  private timers: { t: number; label: string; fn: () => void }[] = [];
  private listeners = new Set<() => void>();
  private lastStale = 0;
  private lastSample = 0;
  private replayQueue: InputRecord[] = [];

  constructor(airports: Registry, compute: ComputeClient) {
    this.airports = airports;
    this.compute = compute;
  }

  // ================================================================ lifecycle
  load(scenarioId: string, seed = this.seed, lab?: LabSpec, replay?: InputRecord[]) {
    const { world, scenario, notes } = buildWorld(scenarioId, seed, this.airports, lab);
    this.world = world;
    this.scenario = scenario;
    this.notes = notes;
    this.seed = seed;
    this.lab = lab;
    this.engine = new Engine(world, this.airports);
    this.engine.bootstrap();
    this.proposals = {};
    this.audit = new AuditLog();
    this.inputs = [];
    this.events = [];
    this.samples = [];
    this.evidence = [];
    this.timers = [];
    this.holds.clear();
    this.lastStale = world.now;
    this.lastSample = world.now - 1e9;
    this.replayQueue = replay ? [...replay].sort((a, b) => a.t - b.t) : [];
    this.orchestrator = orchestratorFor(this);
    this.audit.append(world.now, "System", "system", "SCENARIO_LOADED", scenario.id, `${scenario.title} · seed ${seed}${replay ? " · replay" : ""}`);
    this.sample();
    this.notify();
  }

  reset() {
    this.running = false;
    this.load(this.scenario.id === "lab" ? "baseline" : this.scenario.id, this.seed, this.lab);
  }

  replay() {
    const inputs = [...this.inputs];
    const id = this.scenario.id;
    this.running = false;
    this.load(id === "lab" ? "baseline" : id, this.seed, this.lab, inputs);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ================================================================ host interface for agents
  get held() { return this.holds.size > 0; }
  hold(reason: string) { if (!this.holds.has(reason)) { this.holds.add(reason); this.notify(); } }
  release(reason: string) { if (this.holds.delete(reason)) this.notify(); }

  scheduleAt(t: number, label: string, fn: () => void) {
    this.timers.push({ t, label, fn });
    this.timers.sort((a, b) => a.t - b.t);
  }

  get pendingTimers() { return this.timers.map((x) => ({ t: x.t, label: x.label })); }

  onCommitted(p: Proposal, preCommit: World) {
    // evidence: ground-truth projections from the same pre-commit state (same horizon, same censoring)
    const t = this.world.now;
    const decisions = p.plan.decisions.filter((d) => d.action !== "unresolved");
    const tStart = performance.now();
    void this.compute.projectMany(preCommit, [
      { key: "noAction", policy: "no_action" }, { key: "localGreedy", policy: "local_greedy" },
      { key: "plan", policy: "live", decisions },
    ], 4 * 3600).then((r) => {
      this.evidence.push({ proposal: `${p.id} v${p.version}`, t, wall: Date.now(), noAction: r.noAction, localGreedy: r.localGreedy, plan: r.plan,
        computeMs: Math.round(performance.now() - tStart) });
      this.notify();
    });
  }

  // ================================================================ clock
  tick(dtReal: number) {
    if (!this.running || this.held) return;
    this.advance(this.world.now + Math.min(dtReal, 0.25) * this.speed);
  }

  step(seconds = 60) {
    if (this.held) return;
    this.advance(this.world.now + seconds);
  }

  private flushEvents(): boolean {
    const evs = this.engine.drainEvents();
    if (!evs.length) return false;
    this.events.push(...evs);
    if (this.events.length > 1500) this.events.splice(0, this.events.length - 1200);
    return this.orchestrator.onDomainEvents(evs) || this.held;
  }

  private advance(target: number) {
    const w = this.world;
    for (let guard = 0; guard < 1000 && w.now < target && !this.held; guard++) {
      const nextTimer = this.timers[0]?.t ?? Infinity;
      const nextReplay = this.replayQueue[0]?.t ?? Infinity;
      const stopAt = Math.min(target, nextTimer, nextReplay);
      this.engine.advanceTo(stopAt, () => this.flushEvents());
      if (this.held) break;
      while (this.timers.length && this.timers[0].t <= w.now) this.timers.shift()!.fn();
      while (this.replayQueue.length && this.replayQueue[0].t <= w.now && !this.held) this.applyReplay(this.replayQueue.shift()!);
      if (this.held) break;
    }
    this.flushEvents();
    if (w.now - this.lastStale >= 60) { this.lastStale = w.now; this.orchestrator.checkStaleness(); }
    if (w.now - this.lastSample >= 300) this.sample();
    this.notify();
  }

  private sample() {
    const w = this.world;
    this.lastSample = w.now;
    const airports: Sample["airports"] = {};
    for (const [icao, ap] of Object.entries(this.airports)) {
      let inbound = 0, holding = 0, waiting = 0, onStand = 0, delayed = 0;
      for (const v of Object.values(w.visits)) {
        if (v.airport !== icao) continue;
        if (v.phase === "INBOUND" || v.phase === "APPROACH") inbound++;
        if (v.phase === "HOLDING") { holding++; inbound++; }
        if (v.phase === "WAITING_STAND") waiting++;
        if (v.phase === "ON_STAND" || v.phase === "READY") onStand++;
        if (v.arr && v.aibt === null && v.arr.sched < w.now - 900 && !["DIVERTED", "CANCELLED", "DEPARTED"].includes(v.phase)) delayed++;
      }
      airports[icao] = { inbound, holding, waiting, onStand, stands: Object.keys(ap.stands).length, arrRate: hourlyRate(w, ap.profile, w.now, "arr"), delayed };
    }
    this.samples.push({ t: w.now, airports });
    if (this.samples.length > 600) this.samples.shift();
  }

  // ================================================================ human inputs (permission-checked, recorded)
  private record(kind: InputRecord["kind"], by: string, payload: Record<string, unknown>) {
    this.inputs.push({ t: this.world.now, wall: Date.now(), kind, by, payload });
  }

  injectIncident(spec: LabIncidentSpec, roleKey: string): Incident | null {
    if (!can(roleKey, "inject_incident", { airport: spec.airport })) throw new Error(`${roleOf(roleKey).title} cannot inject incidents at ${spec.airport}`);
    const ctx = { world: this.world, airports: this.airports, scenario: this.scenario, notes: [] as string[] };
    const before = new Set(Object.keys(this.world.restrictions));
    const inc = injectIncident(ctx, spec, this.world.now, "human_entered");
    if (!inc) return null;
    for (const rid of Object.keys(this.world.restrictions)) if (!before.has(rid)) this.engine.scheduleRestriction(this.world.restrictions[rid]);
    this.engine.scheduleIncident(inc);
    if (this.world.weatherTrack[spec.airport]) {
      // re-schedule weather keys for the airport (new track may start now)
      const track = this.world.weatherTrack[spec.airport];
      track.forEach((k, i) => { if (k.t > this.world.now) this.engine.schedule(k.t, "weather", spec.airport, { i }, 1); });
    }
    this.record("inject", roleKey, { spec });
    this.audit.append(this.world.now, roleOf(roleKey).person, roleKey, "INCIDENT_INJECTED", inc.id, `${inc.title} (${spec.type} at ${spec.airport})`);
    this.notify();
    return inc;
  }

  decide(proposalKey: string, slotKey: string, decision: Decision4, reason: string, roleKey: string) {
    if (!can(roleKey, "decide_slot", { slotKey })) throw new Error(`${roleOf(roleKey).title} is not authorised to decide ${slotKey}`);
    const p = this.proposals[proposalKey];
    if (!p) throw new Error("unknown proposal");
    this.record("decision", roleKey, { proposalKey, slotKey, decision, reason });
    this.orchestrator.humanDecision(proposalKey, slotKey, decision, reason, `${roleOf(roleKey).person}`);
  }

  setStakeholderMode(key: string, mode: "human" | "simulated", roleKey: string) {
    if (!can(roleKey, "set_stakeholder_mode")) throw new Error("only the National Operations Supervisor can change stakeholder modes");
    this.stakeholderModes[key] = mode;
    this.record("mode", roleKey, { key, mode });
    this.audit.append(this.world.now, roleOf(roleKey).person, roleKey, "STAKEHOLDER_MODE", key, mode);
    this.notify();
  }

  requestReplan(reason: string, roleKey: string) {
    if (!can(roleKey, "request_replan")) throw new Error("not authorised to request a replan");
    this.record("replan", roleKey, { reason });
    this.orchestrator.requestReplan(reason, roleOf(roleKey).person);
  }

  private applyReplay(r: InputRecord) {
    try {
      if (r.kind === "inject") this.injectIncident(r.payload.spec as LabIncidentSpec, r.by);
      else if (r.kind === "decision") {
        const { proposalKey, slotKey, decision, reason } = r.payload as { proposalKey: string; slotKey: string; decision: Decision4; reason: string };
        if (this.proposals[proposalKey]) this.decide(proposalKey, slotKey, decision, reason, r.by);
      } else if (r.kind === "mode") this.setStakeholderMode(r.payload.key as string, r.payload.mode as "human" | "simulated", r.by);
      else if (r.kind === "replan") this.requestReplan(String(r.payload.reason), r.by);
    } catch (e) {
      console.warn("[SKYPACT] replay input skipped", e);
    }
  }

  // ================================================================ derived views
  airportSummary(icao: string) {
    const w = this.world;
    const ap = this.airports[icao];
    const s = this.samples[this.samples.length - 1]?.airports[icao];
    const incidents = Object.values(w.incidents).filter((i) => i.airport === icao && i.status === "active" && i.shared);
    const localOnly = Object.values(w.incidents).filter((i) => i.airport === icao && i.status === "active" && !i.shared);
    const weather = w.weather[icao];
    const rate = hourlyRate(w, ap.profile, w.now, "arr");
    const status = incidents.some((i) => i.severity === "severe" || i.severity === "high") ? "disrupted" : incidents.length ? "watch" : "normal";
    return { icao, profile: ap.profile, weather, rate, incidents, localOnly, sample: s, status };
  }

  outcome(): OutcomeMetrics {
    return outcomeMetrics(this.world, this.scenario.start, this.world.now, undefined, this.scenario.start - 3600);
  }

  visitLabel(id: string): string {
    const v = this.world.visits[id];
    return v ? `${callsignOf(v)} · ${AIRCRAFT[v.type].category}` : id;
  }

  clockLabel(): string {
    return fmtTime(this.world.now, true);
  }
}
