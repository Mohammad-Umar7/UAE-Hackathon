/**
 * Look-ahead projection: clone the authoritative world, apply a policy (and optionally a plan),
 * run the deterministic simulator forward, and measure the outcome. Used for predictive impact
 * assessment (agents) and for the before/after evidence.
 *
 *   no_action    — planned stands kept; aircraft wait for their stand; crews divert on minimum fuel
 *   local_greedy — each airport reassigns its own stands first-fit (no network coordination)
 *   plan         — the recovery plan's decisions applied, then normal operations
 */

import type { Registry } from "../airports/registry";
import { outcomeMetrics, type OutcomeMetrics } from "../metrics";
import { Engine, LIVE_POLICY, LOCAL_GREEDY_POLICY, NO_ACTION_POLICY, type Decision } from "../sim/engine";
import type { DomainEvent, World } from "../types";
import { cloneWorld } from "../world";

export type PolicyName = "no_action" | "local_greedy" | "live";
const POLICIES = { no_action: NO_ACTION_POLICY, local_greedy: LOCAL_GREEDY_POLICY, live: LIVE_POLICY };

export interface Projection extends OutcomeMetrics {
  policy: PolicyName;
  standConflicts: number;
  fuelDiversions: number;
  events: { kind: string; t: number; airport: string | null; visit?: string; callsign?: string; detail?: string }[];
  computeMs: number;
  horizonS: number;
}

const WATCH = new Set(["STAND_CONFLICT", "WAITING_FOR_STAND", "FUEL_DIVERSION", "DIVERSION", "PRM_SERVICE_DELAY"]);

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
  eng.listeners.push((e) => { if (WATCH.has(e.kind)) events.push(e); });
  const t0 = world.now;
  eng.advanceTo(t0 + horizonS);
  const m = outcomeMetrics(w, t0, t0 + horizonS);
  return {
    ...m, policy, horizonS,
    standConflicts: events.filter((e) => e.kind === "STAND_CONFLICT").length,
    fuelDiversions: events.filter((e) => e.kind === "FUEL_DIVERSION").length,
    events: events.slice(0, 200).map((e) => ({
      kind: e.kind, t: e.t, airport: e.airport, visit: e.data.visit as string | undefined, callsign: e.data.callsign as string | undefined,
      detail: (e.data.reason ?? e.data.to ?? e.data.stand ?? "") as string,
    })),
    computeMs: Math.round(performance.now() - t),
  };
}
