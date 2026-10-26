/** Agent messaging and action records. Everything here is produced by real tool calls at runtime. */

export type AgentId = "weather" | "airport_ops" | "airline_ops" | "atc" | "recovery" | "coordination" | "validation";
export type Participant = AgentId | "supervisor" | "stakeholder" | "system";

export type MessageType =
  | "DisruptionNotice" | "ImpactAssessment" | "AirlineConstraints" | "ATCReview" | "PlanCandidates" | "ValidationResult"
  | "CoordinationRequest" | "StakeholderResponse" | "LocalInformationShared" | "ReplanRequest" | "PlanInvalidated"
  | "PlanCommitted" | "Escalation" | "HumanDecision" | "StalenessCheck";

export interface AgentMessage {
  id: string;
  t: number; // sim time
  wall: number; // epoch ms
  from: Participant;
  fromLabel?: string; // e.g. "OMSJ Airport Operations Controller"
  to: Participant[];
  type: MessageType;
  summary: string;
  payload: Record<string, unknown>;
  causedBy: string | null;
  thread: string;
}

export interface AgentAction {
  id: string;
  agent: AgentId;
  t: number;
  wall: number;
  durationMs: number;
  tool: string;
  params: Record<string, unknown>;
  summary: string;
  result: unknown;
  trigger: string | null;
  thread: string;
  status: "ok" | "error" | "blocked";
  constraints?: string[];
  outputs: string[];
}

export interface Workflow {
  id: string;
  title: string;
  airports: string[];
  status: "analysing" | "awaiting_approval" | "replanning" | "committed" | "closed" | "escalated";
  startedAt: number;
  startedWall: number;
  trigger: string;
  proposals: string[];
  steps: { t: number; wall: number; label: string; agent: Participant }[];
}

export interface AgentDef {
  id: AgentId;
  name: string;
  short: string;
  color: string;
  role: string;
  responsibilities: string[];
  tools: string[];
  consumes: MessageType[];
  produces: MessageType[];
  authority: string[];
  cannot: string[];
}
