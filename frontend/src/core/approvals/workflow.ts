/**
 * Recovery proposals and the multi-stakeholder approval workflow.
 *
 * Lifecycle: VALIDATED → PROPOSED (out for approval) → APPROVED → COMMITTED, or REJECTED /
 * REVISION_REQUESTED / STALE / SUPERSEDED / EXPIRED. Nothing is committed to the simulation
 * without every required approval *and* a passing re-validation at commit time.
 */

import type { Decision } from "../sim/engine";
import type { PlanResult, VariantId } from "../solver/milp";
import type { Forbidden, Snapshot } from "../solver/problem";
import type { Projection } from "../solver/evaluate";
import type { ValidationReport } from "../solver/validate";
import type { World } from "../types";
import { callsignOf } from "../world";
import { roleOf, type RoleType } from "./roles";

export type PlanStatus = "VALIDATED" | "PROPOSED" | "APPROVED" | "COMMITTED" | "REJECTED" | "REVISION_REQUESTED" | "STALE"
  | "SUPERSEDED" | "EXPIRED" | "INVALID";

export type Decision4 = "PENDING" | "APPROVED" | "REJECTED" | "REVISION_REQUESTED" | "ACKNOWLEDGED";

export interface ApprovalSlot {
  key: string;
  type: RoleType;
  scope: string | null;
  label: string;
  mode: "human" | "simulated";
  decision: Decision4;
  by?: string;
  t?: number;
  wall?: number;
  reason?: string;
  codes?: string[];
  items: string[]; // short descriptions of plan elements this stakeholder must review
  requestedAt: number;
  dueAt?: number;
}

export interface Proposal {
  id: string;
  version: number;
  thread: string;
  variant: VariantId;
  label: string;
  status: PlanStatus;
  createdAt: number;
  createdWall: number;
  t0: number;
  plan: PlanResult;
  candidates: PlanResult[];
  recommendedReason: string;
  validation: ValidationReport;
  approvals: ApprovalSlot[];
  supersedes: string | null;
  supersededBy: string | null;
  history: { t: number; wall: number; status: string; note: string; by: string }[];
  snapshot: Snapshot;
  forbidden: Forbidden[];
  problemStats: Record<string, unknown>;
  projections?: { noAction: Projection; localGreedy: Projection; plan: Projection; candidates: Record<string, Projection> };
  decisionDeadline: { t: number; note: string } | null;
  staleReason?: string;
  changedInputs?: { kind: string; id: string; detail: string }[];
  commitLog?: string[];
  narrative?: { text: string; source: "deterministic" | "local_llm"; model?: string };
}

const TERMINAL = new Set<PlanStatus>(["COMMITTED", "REJECTED", "SUPERSEDED", "EXPIRED", "INVALID", "STALE", "REVISION_REQUESTED"]);
export const isOpen = (p: Proposal) => !TERMINAL.has(p.status);

export function requiredApprovals(plan: PlanResult, world: World, modes: Record<string, "human" | "simulated">): Omit<ApprovalSlot, "requestedAt">[] {
  const airports = new Map<string, string[]>();
  const airlines = new Map<string, string[]>();
  let atc: string[] = [];
  const push = (m: Map<string, string[]>, k: string, s: string) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); };
  for (const d of plan.decisions) {
    const v = world.visits[d.visit];
    const airline = v?.airline ?? "";
    const cs = d.callsign;
    if (d.action === "assign_stand") { push(airports, d.airport, `${cs}: stand ${d.from ?? "—"} → ${d.stand}`); push(airlines, airline, `${cs}: stand → ${d.stand}`); }
    if (d.action === "divert") {
      push(airports, d.to!, `${cs}: accept diversion on stand ${d.stand}`);
      push(airports, d.airport, `${cs}: inbound diverted to ${d.to}`);
      push(airlines, airline, `${cs}: divert to ${d.to}`);
      atc.push(`${cs}: diversion ${d.airport}→${d.to} (tactical ATC coordination)`);
    }
    if (d.action === "tow") { push(airports, d.airport, `${cs}: tow ${d.from_stand} → ${d.to_stand}`); push(airlines, airline, `${cs}: tow to ${d.to_stand}`); }
    if (d.action === "landing_slot" && (d.holding_min ?? 0) > 0) {
      atc.push(`${cs}: landing sequence slot (+${d.holding_min} min ${d.ground_delay ? "ground delay" : "holding"})`);
      push(airlines, airline, `${cs}: ${d.ground_delay ? "ground delay" : "holding"} +${d.holding_min} min`);
    }
  }
  atc = atc.slice(0, 40);
  const slots: Omit<ApprovalSlot, "requestedAt">[] = [];
  const mk = (key: string, items: string[]) => {
    const r = roleOf(key);
    const lookup = modes[key] ?? (r.type === "AIRLINE_REP" ? modes.AIRLINE_REP : undefined) ?? "simulated";
    slots.push({ key, type: r.type, scope: r.scope, label: r.title, mode: lookup, decision: "PENDING", items });
  };
  for (const [icao, items] of [...airports].sort()) mk(`AIRPORT_CONTROLLER:${icao}`, items);
  for (const [al, items] of [...airlines].sort()) if (al) mk(`AIRLINE_REP:${al}`, items);
  if (atc.length) mk("ATC_LIAISON", atc);
  mk("NATIONAL_SUPERVISOR", [`${plan.decisions.length} recovery actions across ${new Set(plan.decisions.map((d) => d.to ?? d.airport)).size} airport(s)`]);
  return slots;
}

/** Earliest operational deadline in the plan (e.g. a diversion that must be decided before fuel runs out). */
export function decisionDeadline(plan: PlanResult, world: World): { t: number; note: string } | null {
  let best: { t: number; note: string } | null = null;
  for (const d of plan.decisions) {
    const v = world.visits[d.visit];
    if (!v || v.eta === null) continue;
    if (d.action === "divert" && v.fuelEndurance !== null && (v.phase === "INBOUND" || v.phase === "HOLDING")) {
      const t = v.eta + v.fuelEndurance - 10 * 60;
      if (!best || t < best.t) best = { t, note: `${callsignOf(v)} must divert before minimum fuel` };
    }
    if (d.action === "landing_slot" && d.eldt) {
      const t = d.eldt - 15 * 60;
      if (!best || t < best.t) best = { t, note: `${callsignOf(v)} landing slot` };
    }
  }
  return best;
}

export function allApproved(p: Proposal): boolean {
  return p.approvals.every((a) => a.decision === "APPROVED" || a.decision === "ACKNOWLEDGED");
}

export const decisionsOf = (p: Proposal): Decision[] => p.plan.decisions.filter((d) => d.action !== "unresolved");
