/**
 * Runway capacity model, shared by the simulator and the optimiser so both enforce the same
 * modelled limits. Capacity is movements per hour, enforced per 15-minute bucket. Restriction
 * rates are scenario inputs (synthetic), not derived from visibility.
 */

import type { AirportProfile } from "../airports/profiles";
import type { World } from "../types";
import { activeRestrictions } from "../world";

export const BUCKET_S = 900;
export const MIN_LANDING_SPACING_S = 75;
export const MIN_DEPARTURE_SPACING_S = 60;

export const bucketOf = (t: number) => Math.floor(t / BUCKET_S);

export function hourlyRate(w: World, p: AirportProfile, t: number, kind: "arr" | "dep", sharedOnly = false): number {
  let rate = kind === "arr" ? p.arrCapacity : p.depCapacity;
  const rk = kind === "arr" ? "ARRIVAL_CAPACITY" : "DEPARTURE_CAPACITY";
  for (const r of activeRestrictions(w, p.icao, rk, t, sharedOnly)) rate = Math.min(rate, Number(r.params.rate ?? rate));
  for (const r of activeRestrictions(w, p.icao, "RUNWAY_CLOSED", t, sharedOnly)) {
    rate = Math.min(rate, Number(r.params[kind === "arr" ? "arr_rate" : "dep_rate"] ?? rate));
  }
  return Math.max(0, rate);
}

/** Integer capacity of bucket b; fractional hourly rates are spread deterministically. */
export function bucketCapacity(w: World, p: AirportProfile, b: number, kind: "arr" | "dep", sharedOnly = false): number {
  const per = hourlyRate(w, p, b * BUCKET_S + BUCKET_S / 2, kind, sharedOnly) / 4;
  return Math.floor((b + 1) * per + 1e-9) - Math.floor(b * per + 1e-9);
}

export function bucketCapacities(w: World, p: AirportProfile, t0: number, t1: number, kind: "arr" | "dep",
  sharedOnly = false): Map<number, number> {
  const out = new Map<number, number>();
  for (let b = bucketOf(t0); b <= bucketOf(t1); b++) out.set(b, bucketCapacity(w, p, b, kind, sharedOnly));
  return out;
}
