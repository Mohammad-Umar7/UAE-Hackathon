/** Role-based permissions and the simulated users available in the local demo (no external auth). */

import { AIRLINES } from "../airlines";
import { PROFILES } from "../airports/profiles";

export type RoleType = "NATIONAL_SUPERVISOR" | "AIRPORT_CONTROLLER" | "AIRLINE_REP" | "ATC_LIAISON" | "OBSERVER";

export interface RoleIdentity {
  key: string; // e.g. AIRPORT_CONTROLLER:OMSJ
  type: RoleType;
  scope: string | null; // airport ICAO or airline code
  title: string;
  person: string; // simulated user
  initials: string;
}

export const ROLE_TITLES: Record<RoleType, string> = {
  NATIONAL_SUPERVISOR: "National Operations Supervisor",
  AIRPORT_CONTROLLER: "Airport Operations Controller",
  AIRLINE_REP: "Airline Operations Representative",
  ATC_LIAISON: "ATC Liaison / Authorised Reviewer",
  OBSERVER: "Observer (read-only)",
};

const PEOPLE: Record<string, string> = {
  NATIONAL_SUPERVISOR: "Duty Supervisor · NOC",
  "AIRPORT_CONTROLLER:OMAA": "AOC Controller · AUH",
  "AIRPORT_CONTROLLER:OMDB": "AOC Controller · DXB",
  "AIRPORT_CONTROLLER:OMSJ": "AOC Controller · SHJ",
  ATC_LIAISON: "ATC Liaison Officer",
  OBSERVER: "Observer",
};

export function roleOf(key: string): RoleIdentity {
  const [type, scope] = key.split(":") as [RoleType, string | undefined];
  let title = ROLE_TITLES[type];
  if (type === "AIRPORT_CONTROLLER" && scope) title = `${title} — ${PROFILES[scope]?.iata ?? scope}`;
  if (type === "AIRLINE_REP" && scope) title = `${title} — ${AIRLINES[scope]?.name ?? scope}`;
  const person = PEOPLE[key] ?? (type === "AIRLINE_REP" ? `OCC Duty Manager · ${AIRLINES[scope ?? ""]?.name ?? scope}` : title);
  const initials = type === "AIRPORT_CONTROLLER" ? (PROFILES[scope ?? ""]?.iata ?? "AP") : type === "AIRLINE_REP" ? (scope ?? "AL")
    : type === "NATIONAL_SUPERVISOR" ? "NS" : type === "ATC_LIAISON" ? "ATC" : "OB";
  return { key, type, scope: scope ?? null, title, person, initials };
}

export const SWITCHABLE_ROLES = [
  "NATIONAL_SUPERVISOR", "AIRPORT_CONTROLLER:OMAA", "AIRPORT_CONTROLLER:OMDB", "AIRPORT_CONTROLLER:OMSJ",
  ...Object.keys(AIRLINES).map((a) => `AIRLINE_REP:${a}`), "ATC_LIAISON", "OBSERVER",
];

export type Permission = "decide_slot" | "inject_incident" | "request_replan" | "select_plan" | "set_stakeholder_mode"
  | "share_local_info" | "control_clock";

export function can(roleKey: string, perm: Permission, target?: { slotKey?: string; airport?: string }): boolean {
  const r = roleOf(roleKey);
  if (r.type === "OBSERVER") return false;
  switch (perm) {
    case "decide_slot": return !!target?.slotKey && target.slotKey === roleKey;
    case "inject_incident": return r.type === "NATIONAL_SUPERVISOR" || (r.type === "AIRPORT_CONTROLLER" && target?.airport === r.scope);
    case "share_local_info": return r.type === "AIRPORT_CONTROLLER" && target?.airport === r.scope;
    case "request_replan": return r.type === "NATIONAL_SUPERVISOR" || r.type === "AIRPORT_CONTROLLER";
    case "select_plan": case "set_stakeholder_mode": case "control_clock": return r.type === "NATIONAL_SUPERVISOR";
    default: return false;
  }
}
