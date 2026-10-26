/** Agent roles, tool permissions, message contracts and authority boundaries. */

import type { AgentDef, AgentId } from "./types";

export const AGENTS: Record<AgentId, AgentDef> = {
  weather: {
    id: "weather", name: "Weather & Disruption Agent", short: "Weather", color: "#6B8EAD",
    role: "Reads locally simulated weather and incident events, detects material changes and notifies the network.",
    responsibilities: ["Read simulated observations and incidents", "Classify material changes (category, capacity, LVP)",
      "Associate incidents with airports", "Separate verified reference data from simulated restrictions"],
    tools: ["read_weather", "read_incidents", "classify_change"],
    consumes: [], produces: ["DisruptionNotice"],
    authority: ["Publish disruption notices"],
    cannot: ["Change capacity or restrictions", "Change any assignment"],
  },
  airport_ops: {
    id: "airport_ops", name: "Airport Operations Agent", short: "Airport Ops", color: "#3D6E8F",
    role: "Inspects runway availability, stand occupancy and capacity; projects operations forward to find conflicts.",
    responsibilities: ["Inspect runway status and modelled capacity", "Inspect stand occupancy", "Project operations ahead (no-action what-if)",
      "Identify stand conflicts, holding and fuel-diversion risk", "Prepare airport-specific assessments"],
    tools: ["get_runway_status", "get_stand_occupancy", "project_operations", "detect_conflicts"],
    consumes: ["DisruptionNotice"], produces: ["ImpactAssessment"],
    authority: ["Publish impact assessments"],
    cannot: ["Reassign stands", "Approve plans"],
  },
  airline_ops: {
    id: "airline_ops", name: "Airline Operations Agent", short: "Airline Ops", color: "#8A6D3B",
    role: "Evaluates affected schedules, turnaround needs, connections and airline handling arrangements.",
    responsibilities: ["List affected flights per carrier", "Estimate downstream consequences (rotations, connections)",
      "Report handling arrangements and preferences", "Respond to coordination requests"],
    tools: ["get_affected_flights", "estimate_downstream", "get_airline_preferences"],
    consumes: ["ImpactAssessment"], produces: ["AirlineConstraints"],
    authority: ["State airline constraints and preferences"],
    cannot: ["Approve on behalf of an airline representative", "Change assignments"],
  },
  atc: {
    id: "atc", name: "ATC Liaison Agent", short: "ATC Liaison", color: "#5E6B8C",
    role: "Reads simulated arrival-capacity and runway restrictions and flags plans needing human ATC review.",
    responsibilities: ["Read modelled arrival capacity and runway configuration", "Check plans against restrictions",
      "Prepare information for human air traffic coordination", "Flag plans requiring ATC review"],
    tools: ["get_arrival_capacity", "check_plan_restrictions"],
    consumes: ["DisruptionNotice", "PlanCandidates"], produces: ["ATCReview"],
    authority: ["Provide information to authorised ATC reviewers"],
    cannot: ["Issue clearances or instructions", "Change routes or sequences", "Approve plans"],
  },
  recovery: {
    id: "recovery", name: "Recovery Planning Agent", short: "Recovery", color: "#2F7D6D",
    role: "Collects constraints, invokes the HiGHS optimiser, compares candidate plans and explains trade-offs.",
    responsibilities: ["Build the recovery problem from the shared picture", "Invoke the MILP optimiser (three objective weightings)",
      "Project each candidate against no-action and local-only baselines", "Explain measurable trade-offs", "Flag unresolved flights"],
    tools: ["build_recovery_problem", "run_optimizer", "evaluate_plans", "compare_plans"],
    consumes: ["ImpactAssessment", "AirlineConstraints", "ATCReview", "ReplanRequest"], produces: ["PlanCandidates"],
    authority: ["Propose candidate plans"],
    cannot: ["Invent assignments outside optimiser output", "Approve or execute plans"],
  },
  coordination: {
    id: "coordination", name: "Coordination Agent", short: "Coordination", color: "#B5651D",
    role: "Manages requests between Abu Dhabi, Dubai, Sharjah and airline stakeholders; tracks approvals and rejections.",
    responsibilities: ["Create structured coordination requests", "Collect stakeholder responses", "Track pending approvals",
      "Handle rejection and share newly revealed local information", "Request recalculation when circumstances change"],
    tools: ["create_proposal", "send_coordination_request", "record_response", "share_local_information", "request_replan", "commit_plan", "escalate"],
    consumes: ["PlanCandidates", "ValidationResult", "StakeholderResponse", "PlanInvalidated"],
    produces: ["CoordinationRequest", "ReplanRequest", "LocalInformationShared", "Escalation", "PlanCommitted"],
    authority: ["Route requests and track approvals", "Execute a plan only after every required approval and a passing re-validation"],
    cannot: ["Approve on behalf of any human role", "Commit without every required approval"],
  },
  validation: {
    id: "validation", name: "Validation & Safety Agent", short: "Validation", color: "#9B3B3B",
    role: "Independently re-checks every plan against hard constraints and current data; blocks stale or invalid plans.",
    responsibilities: ["Verify plan consistency against current data (separate code path)", "Check hard constraints",
      "Detect stale inputs", "Identify required approvals", "Block invalid state transitions"],
    tools: ["validate_plan", "check_staleness", "required_approvals"],
    consumes: ["PlanCandidates", "StalenessCheck", "HumanDecision"], produces: ["ValidationResult", "PlanInvalidated"],
    authority: ["Block or invalidate plans"],
    cannot: ["Modify plans", "Approve plans"],
  },
};

export const AGENT_ORDER: AgentId[] = ["weather", "airport_ops", "airline_ops", "atc", "recovery", "validation", "coordination"];
