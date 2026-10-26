/** Core domain types shared by the simulator, optimiser, agents, approvals and UI. */

import type { TypeKey } from "./aircraft";

export type Phase =
  | "SCHEDULED" | "INBOUND" | "HOLDING" | "APPROACH" | "LANDING" | "TAXI_IN" | "WAITING_STAND"
  | "ON_STAND" | "READY" | "TOWING" | "PUSHBACK" | "TAXI_OUT" | "TAKEOFF" | "DEPARTED" | "DIVERTED" | "CANCELLED";

export const ALLOWED_TRANSITIONS: Record<Phase, Phase[]> = {
  SCHEDULED: ["INBOUND", "CANCELLED", "DIVERTED"],
  INBOUND: ["HOLDING", "APPROACH", "DIVERTED", "CANCELLED"],
  HOLDING: ["INBOUND", "APPROACH", "DIVERTED"],
  APPROACH: ["LANDING"],
  LANDING: ["TAXI_IN"],
  TAXI_IN: ["ON_STAND", "WAITING_STAND"],
  WAITING_STAND: ["TAXI_IN"],
  ON_STAND: ["READY", "TOWING"],
  READY: ["PUSHBACK", "ON_STAND", "TOWING"],
  TOWING: ["ON_STAND"],
  PUSHBACK: ["TAXI_OUT"],
  TAXI_OUT: ["TAKEOFF"],
  TAKEOFF: ["DEPARTED"],
  DEPARTED: [],
  DIVERTED: [],
  CANCELLED: [],
};

export const INBOUND_PHASES: ReadonlySet<Phase> = new Set(["SCHEDULED", "INBOUND", "HOLDING"]);
export const ON_GROUND: ReadonlySet<Phase> = new Set([
  "LANDING", "TAXI_IN", "WAITING_STAND", "ON_STAND", "READY", "TOWING", "PUSHBACK", "TAXI_OUT", "TAKEOFF",
]);
export const TERMINAL: ReadonlySet<Phase> = new Set(["DEPARTED", "DIVERTED", "CANCELLED"]);

export type RestrictionKind =
  | "ARRIVAL_CAPACITY" | "DEPARTURE_CAPACITY" | "RUNWAY_CLOSED" | "STAND_CLOSED" | "RESOURCE_OUTAGE"
  | "APRON_SUSPENSION" | "LOW_VISIBILITY";

export type IncidentType =
  | "FOG" | "THUNDERSTORM" | "RUNWAY_CLOSURE" | "STAND_BLOCKED" | "PRIORITY_ARRIVAL" | "DIVERSION_INFLUX"
  | "RESOURCE_OUTAGE" | "ACCESSIBILITY_REQUIREMENT" | "STAND_CLOSURE";

export type Provenance = "verified_public" | "synthetic" | "human_entered" | "derived" | "stakeholder_reported";

export interface FlightLeg {
  callsign: string;
  origin: string;
  destination: string;
  sched: number; // STA (in-block) for arrival legs, STD (off-block) for departure legs — sim seconds
  pax: number;
}

/** One aircraft's stay at one airport: inbound leg + turnaround + outbound leg (either optional). */
export interface Visit {
  id: string;
  airport: string;
  airline: string;
  type: TypeKey;
  reg: string;
  arr: FlightLeg | null;
  dep: FlightLeg | null;
  phase: Phase;
  plannedStand: string | null;
  stand: string | null;
  minTat: number;
  pax: number;
  prm: number;
  connecting: number;
  requirements: string[];
  priority: string | null;
  eta: number | null; // estimated landing before sequencing
  eldt: number | null; // sequenced landing
  aldt: number | null;
  aibt: number | null;
  readyAt: number | null;
  tobt: number | null;
  tsat: number | null;
  aobt: number | null;
  atot: number | null;
  fuelEndurance: number | null; // seconds of holding fuel beyond ETA before a diversion is required
  slotFixed: boolean;
  techHoldUntil: number | null;
  towableAfter: number | null;
  divertedTo: string | null;
  divertedFrom: string | null;
  recoveryOf: string | null;
  divertPlanned: boolean | null;
  plannedTow: [number, string] | null;
  movement: MovementLeg[] | null;
  movementKind: string | null;
  holdPoint: [number, number] | null;
  holdReason: string | null;
  waitingSince: number | null;
  groundWait: number;
  airborneHold: number;
  paused: number;
  standChanges: number;
  planRefs: string[];
  history: [number, string, string][];
  gen: number;
  version: number;
}

/** Movement leg: samples [x, y, z, t, v] with linear speed change between samples. */
export interface MovementLeg {
  kind: string;
  s: number[][];
  reverse?: boolean;
  h0?: number;
  h1?: number;
}

export interface StandState {
  key: string;
  airport: string;
  id: string;
  occupant: string | null;
  reservedBy: string | null;
  version: number;
}

export interface Restriction {
  id: string;
  kind: RestrictionKind;
  airport: string;
  start: number;
  end: number;
  params: Record<string, unknown>;
  incidentId: string | null;
  shared: boolean; // false = known only locally by the airport (not in the shared picture)
  provenance: Provenance;
  version: number;
}

export interface Incident {
  id: string;
  type: IncidentType;
  airport: string;
  title: string;
  description: string;
  start: number;
  end: number;
  severity: "low" | "moderate" | "high" | "severe";
  status: "scheduled" | "active" | "cleared";
  params: Record<string, unknown>;
  restrictionIds: string[];
  source: "scenario" | "human_entered" | "stakeholder_reported" | "local_log";
  shared: boolean;
  version: number;
}

export interface WeatherObs {
  visibility: number;
  rvr: number | null;
  ceiling: number | null;
  windDir: number;
  windKt: number;
  gustKt: number | null;
  tempC: number;
  dewC: number;
  qnh: number;
  precip: "none" | "light_rain" | "rain" | "heavy_rain";
  thunder: boolean;
  lightning: boolean;
  fog: number; // 0..1 rendering density
  cloud: number; // 0..1
  category: "VMC" | "IMC" | "LVP";
}

export interface WeatherKey {
  t: number;
  obs: WeatherObs;
}

export interface ChangeRecord {
  seq: number;
  t: number;
  kind: string;
  key: string;
  detail: string;
}

export interface World {
  seed: number;
  scenarioId: string;
  now: number;
  visits: Record<string, Visit>;
  stands: Record<string, StandState>;
  restrictions: Record<string, Restriction>;
  incidents: Record<string, Incident>;
  weather: Record<string, WeatherObs>;
  weatherTrack: Record<string, WeatherKey[]>;
  resources: Record<string, Record<string, number>>;
  version: number;
  changeSeq: number;
  changes: string[];
  changeLog: ChangeRecord[];
  counters: Record<string, number>;
}

export interface DomainEvent {
  kind: string;
  t: number;
  airport: string | null;
  data: Record<string, unknown>;
}
