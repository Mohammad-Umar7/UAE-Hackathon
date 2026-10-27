/** Layout + helpers for visualising agent coordination. */

import type { AgentMessage, Participant } from "@/core/agents/types";

export type NodeId = Participant | "sh:NATIONAL_SUPERVISOR" | "sh:OMAA" | "sh:OMDB" | "sh:OMSJ" | "sh:AIRLINES" | "sh:ATC";

export interface GNode {
  id: NodeId;
  x: number;
  y: number;
  label: string;
  sub: string;
  color: string;
  kind: "agent" | "stakeholder";
}

export const NODES: GNode[] = [
  { id: "weather", x: 85, y: 205, label: "Weather Watch", sub: "weather & incident changes", color: "#6B8EAD", kind: "agent" },
  { id: "airport_ops", x: 270, y: 205, label: "Airport Operations", sub: "impact & projection", color: "#3D6E8F", kind: "agent" },
  { id: "airline_ops", x: 455, y: 85, label: "Airline Operations", sub: "schedules & connections", color: "#8A6D3B", kind: "agent" },
  { id: "atc", x: 455, y: 325, label: "ATC Liaison", sub: "restrictions · no clearances", color: "#5E6B8C", kind: "agent" },
  { id: "recovery", x: 640, y: 205, label: "Recovery Planning", sub: "HiGHS MILP optimiser", color: "#2F7D6D", kind: "agent" },
  { id: "validation", x: 815, y: 100, label: "Validation & Safety", sub: "independent checks", color: "#9B3B3B", kind: "agent" },
  { id: "coordination", x: 815, y: 310, label: "Coordination", sub: "requests & approvals", color: "#B5651D", kind: "agent" },
  { id: "sh:NATIONAL_SUPERVISOR", x: 1010, y: 55, label: "National Supervisor", sub: "final sign-off", color: "#1d3557", kind: "stakeholder" },
  { id: "sh:OMAA", x: 1010, y: 135, label: "AUH Airport Ops", sub: "Zayed International", color: "#1d3557", kind: "stakeholder" },
  { id: "sh:OMDB", x: 1010, y: 215, label: "DXB Airport Ops", sub: "Dubai International", color: "#1d3557", kind: "stakeholder" },
  { id: "sh:OMSJ", x: 1010, y: 295, label: "SHJ Airport Ops", sub: "Sharjah International", color: "#1d3557", kind: "stakeholder" },
  { id: "sh:AIRLINES", x: 1010, y: 375, label: "Airline Ops Reps", sub: "one per airline", color: "#1d3557", kind: "stakeholder" },
  { id: "sh:ATC", x: 1010, y: 455, label: "ATC Reviewer", sub: "authorised human", color: "#1d3557", kind: "stakeholder" },
];

export const NODE_W = 158;
export const NODE_H = 50;

export const EDGES: [NodeId, NodeId][] = [
  ["weather", "airport_ops"], ["weather", "atc"], ["weather", "coordination"],
  ["airport_ops", "airline_ops"], ["airport_ops", "atc"], ["airport_ops", "recovery"],
  ["airline_ops", "recovery"], ["atc", "recovery"], ["atc", "coordination"],
  ["recovery", "validation"], ["recovery", "coordination"], ["validation", "coordination"], ["validation", "recovery"],
  ["coordination", "recovery"],
  ["coordination", "sh:NATIONAL_SUPERVISOR"], ["coordination", "sh:OMAA"], ["coordination", "sh:OMDB"], ["coordination", "sh:OMSJ"],
  ["coordination", "sh:AIRLINES"], ["coordination", "sh:ATC"],
];

export function slotNode(slotKey: string | undefined): NodeId {
  if (!slotKey) return "sh:NATIONAL_SUPERVISOR";
  if (slotKey === "NATIONAL_SUPERVISOR") return "sh:NATIONAL_SUPERVISOR";
  if (slotKey.startsWith("AIRPORT_CONTROLLER:")) return `sh:${slotKey.split(":")[1]}` as NodeId;
  if (slotKey.startsWith("AIRLINE_REP")) return "sh:AIRLINES";
  if (slotKey === "ATC_LIAISON") return "sh:ATC";
  return "sh:NATIONAL_SUPERVISOR";
}

/** Resolve the concrete graph endpoints of a message (stakeholder nodes resolved from the payload). */
export function endpoints(m: AgentMessage): { from: NodeId; to: NodeId[] } {
  const slot = m.payload.slot as string | undefined;
  const from: NodeId = m.from === "stakeholder" ? slotNode(slot) : m.from === "supervisor" ? "sh:NATIONAL_SUPERVISOR" : (m.from as NodeId);
  const to = m.to.map((t): NodeId => (t === "stakeholder" ? slotNode(slot) : t === "supervisor" ? "sh:NATIONAL_SUPERVISOR" : (t as NodeId)))
    .filter((t, i, a) => a.indexOf(t) === i && t !== from);
  return { from, to };
}

export const node = (id: NodeId) => NODES.find((n) => n.id === id)!;

export const TYPE_TONE: Record<string, string> = {
  DisruptionNotice: "#B23A3A", ImpactAssessment: "#3D6E8F", AirlineConstraints: "#8A6D3B", ATCReview: "#5E6B8C",
  PlanCandidates: "#2F7D6D", ValidationResult: "#2F7D6D", CoordinationRequest: "#B5651D", StakeholderResponse: "#1d3557",
  LocalInformationShared: "#A86F14", ReplanRequest: "#A86F14", PlanInvalidated: "#B23A3A", PlanCommitted: "#1D7566",
  Escalation: "#B23A3A", HumanDecision: "#1d3557", StalenessCheck: "#9B3B3B",
};
