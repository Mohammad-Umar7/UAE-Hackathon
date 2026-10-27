/**
 * Look-ahead projection: clone the authoritative world, apply a policy (and optionally a plan),
 * run the deterministic simulator forward, and measure the outcome. Used for predictive impact
 * assessment (agents) and for the before/after evidence.
 *
 *   no_action    — planned stands kept; aircraft wait for their stand; crews divert on minimum fuel
 *   local_greedy — each airport reassigns its own stands first-fit (no network coordination)
 *   plan         — local_greedy plus the recovery plan's decisions: whatever the plan does not cover is
 *                  handled exactly as in the local-only baseline, so plan vs local-only isolates the
 *                  value of network coordination
 */

import type { Registry } from "../airports/registry";
import { outcomeMetrics, type OutcomeMetrics } from "../metrics";
import { Engine, LIVE_POLICY, LOCAL_GREEDY_POLICY, NO_ACTION_POLICY, type Decision } from "../sim/engine";
import type { DomainEvent, World } from "../types";
import { cloneWorld } from "../world";

export type PolicyName = "no_action" | "local_greedy" | "live";
const POLICIES = { no_action: NO_ACTION_POLICY, local_greedy: LOCAL_GREEDY_POLICY, live: LIVE_POLICY };

/** The projected network state at one moment, sampled every few minutes over the horizon. */
export interface SeriesPoint {
  t: number;
  /** aircraft circling in holding patterns right now (all airports) */
  circling: number;
  /** aircraft on the ground waiting for a free stand right now */
  waiting: number;
  /** passenger delay so far (pax·h, same definition as the outcome metrics, censored at t) */
  paxDelayH: number;
  /** crew minimum-fuel diversions so far */
  fuelDiversions: number;
  /** stand conflicts so far */
  standConflicts: number;
}

export interface Projection extends OutcomeMetrics {
  policy: PolicyName;
  standConflicts: number;
  fuelDiversions: number;
  events: { kind: string; t: number; airport: string | null; visit?: string; callsign?: string; detail?: string; holdMin?: number }[];
  series: SeriesPoint[];
  computeMs: number;
  horizonS: number;
}

const WATCH = new Set(["STAND_CONFLICT", "WAITING_FOR_STAND", "FUEL_DIVERSION", "DIVERSION", "PRM_SERVICE_DELAY"]);
const SAMPLE_S = 300;

export function project(world: World, airports: Registry, policy: PolicyName = "no_action", horizonS = 5 * 3600,
  decisions?: Decision[], planId = "plan", sharedOnly = false): Projection {
  const t = performance.now();
  const w = cloneWorld(world);
  if (sharedOnly) {
    // predictions made by the national system only know the shared operational picture
    for (const [id, r] of Object.entries(w.restrictions)) if (!r.shared) delete w.restrictions[id];
    for (const [id, inc] of Object.entries(w.incidents)) if (!inc.shared) delete w.incidents[id];
  }
  const eng = new Engine(w, airports, POLICIES[policy], true);
  eng.rebuildFromState();
  if (decisions?.length) eng.applyDecisions(decisions, planId);
  const events: DomainEvent[] = [];
  let fuel = 0, clashes = 0;
  eng.listeners.push((e) => {
    if (!WATCH.has(e.kind)) return;
    events.push(e);
    if (e.kind === "FUEL_DIVERSION") fuel++;
    else if (e.kind === "STAND_CONFLICT") clashes++;
  });
  const t0 = world.now;
  const series: SeriesPoint[] = [];
  const sample = (t: number) => {
    let circling = 0, waiting = 0;
    for (const v of Object.values(w.visits)) {
      if (v.phase === "HOLDING") circling++;
      else if (v.phase === "WAITING_STAND") waiting++;
    }
    series.push({ t, circling, waiting, paxDelayH: outcomeMetrics(w, t0, t).paxDelayHours, fuelDiversions: fuel, standConflicts: clashes });
  };
  // advancing in steps processes exactly the same events in the same order as one long run
  sample(t0);
  for (let t = t0 + SAMPLE_S; t <= t0 + horizonS; t += SAMPLE_S) {
    eng.advanceTo(t);
    sample(t);
  }
  eng.advanceTo(t0 + horizonS);
  const m = outcomeMetrics(w, t0, t0 + horizonS);
  return {
    ...m, policy, horizonS, series,
    standConflicts: clashes,
    fuelDiversions: fuel,
    events: events.slice(0, 200).map((e) => ({
      kind: e.kind, t: e.t, airport: e.airport, visit: e.data.visit as string | undefined, callsign: e.data.callsign as string | undefined,
      detail: (e.data.reason ?? e.data.to ?? e.data.stand ?? "") as string,
      holdMin: e.data.holding_min as number | undefined,
    })),
    computeMs: Math.round(performance.now() - t),
  };
}
