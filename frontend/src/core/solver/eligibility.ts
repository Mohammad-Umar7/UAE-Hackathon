/**
 * Hard eligibility rules shared by candidate generation and the independent validator.
 * These are modelled safety/eligibility constraints. They are never traded against objective
 * preferences: an option failing any rule is never offered to the optimiser, and a plan
 * containing one fails validation.
 */

import type { AircraftType } from "../aircraft";
import { AIRLINES } from "../airlines";
import { standAccepts, type AirportInfo, type StandInfo } from "../airports/registry";
import type { Visit, World } from "../types";
import { activeRestrictions, resourceAvailable, restrictionsOverlapping } from "../world";

export interface Check {
  ok: boolean;
  code: string;
  reason: string;
}

export const OK: Check = { ok: true, code: "", reason: "" };
const fail = (code: string, reason: string): Check => ({ ok: false, code, reason });

export function airportEligible(w: World, v: Visit, t: AircraftType, ap: AirportInfo, sharedOnly = true): Check {
  if (ap.maxWingspan + 1e-6 < t.wingspan) {
    return fail("AIRPORT_SIZE", `no stand at ${ap.icao} accepts a ${t.wingspan.toFixed(1)} m wingspan (largest ${ap.maxWingspan.toFixed(1)} m)`);
  }
  if (ap.maxRunwayLength + 1e-6 < t.landingDistance) {
    return fail("RUNWAY_LENGTH", `runway ${ap.maxRunwayLength.toFixed(0)} m < required ${t.landingDistance} m (synthetic planning value)`);
  }
  if (ap.maxRunwayWidth + 1e-6 < t.minRunwayWidth) {
    return fail("RUNWAY_WIDTH", `runway width ${ap.maxRunwayWidth.toFixed(0)} m < required ${t.minRunwayWidth} m`);
  }
  const al = AIRLINES[v.airline];
  if (al && !al.handlingAt.includes(ap.icao)) {
    return fail("HANDLING_AGREEMENT", `${al.name} has no handling arrangement at ${ap.icao} (synthetic airline profile)`);
  }
  for (const r of activeRestrictions(w, ap.icao, "RUNWAY_CLOSED", undefined, sharedOnly)) {
    if (Number(r.params.arr_rate ?? 1) <= 0) return fail("AIRPORT_CLOSED", `${ap.icao} arrivals suspended (${r.params.reason ?? ""})`);
  }
  return OK;
}

export function standEligible(w: World, v: Visit, t: AircraftType, st: StandInfo, t0: number, t1: number, sharedOnly = true): Check {
  const [ok, why] = standAccepts(st, t);
  if (!ok) return fail(why.startsWith("wingspan") ? "STAND_SIZE" : "STAND_TYPE", why);
  for (const r of restrictionsOverlapping(w, st.airport, "STAND_CLOSED", t0, t1, sharedOnly)) {
    if ((r.params.stands as string[] | undefined)?.includes(st.id)) return fail("STAND_CLOSED", `stand ${st.id} closed (${r.params.reason ?? ""})`);
  }
  if ((v.prm > 0 || v.requirements.includes("PRM")) && !st.services.has("PRM_BRIDGE")) {
    if (resourceAvailable(w, st.airport, "ambulift", t0, t0 + 1500, sharedOnly) <= 0) {
      return fail("PRM_ACCESS", `stand ${st.id} needs an ambulift for passengers requiring assistance and none is available at ${st.airport}`);
    }
  }
  if (v.requirements.includes("PRIORITY") && st.kind !== "contact" && st.kind !== "remote") {
    return fail("PRIORITY_STAND", "priority arrival needs a contact or remote passenger stand");
  }
  return OK;
}
