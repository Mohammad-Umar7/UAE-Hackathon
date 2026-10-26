/**
 * Compute services used by the agents: the HiGHS optimiser and look-ahead projections.
 * In the browser these run in a dedicated Web Worker (see src/workers/compute.worker.ts) so the
 * 3D view stays smooth; in tests the same functions run in-process.
 */

import type { Registry } from "./airports/registry";
import type { Decision } from "./sim/engine";
import { project, type PolicyName, type Projection } from "./solver/evaluate";
import { solveAlternatives, type HighsLike, type PlanResult } from "./solver/milp";
import type { Problem } from "./solver/problem";
import type { World } from "./types";

export interface ProjectionJob {
  key: string;
  policy: PolicyName;
  decisions?: Decision[];
  sharedOnly?: boolean;
}

export interface ComputeClient {
  ready(): Promise<void>;
  solve(problem: Problem, timeLimit?: number): Promise<PlanResult[]>;
  projectMany(world: World, jobs: ProjectionJob[], horizonS: number): Promise<Record<string, Projection>>;
  label: string;
}

/** Strip heavy fields the projections don't need before sending a world across threads. */
export function slimWorld(w: World): World {
  const visits: World["visits"] = {};
  for (const [id, v] of Object.entries(w.visits)) visits[id] = { ...v, movement: null, history: v.history.filter((h) => h[1] === "PRM_WAIT") };
  return structuredClone({ ...w, visits, changeLog: [], changes: [] });
}

export class InProcessCompute implements ComputeClient {
  label = "in-process";
  constructor(private highs: HighsLike, private airports: Registry) {}
  async ready() {}
  async solve(problem: Problem, timeLimit = 30) { return solveAlternatives(this.highs, problem, timeLimit); }
  async projectMany(world: World, jobs: ProjectionJob[], horizonS: number) {
    const out: Record<string, Projection> = {};
    for (const j of jobs) out[j.key] = project(world, this.airports, j.policy, horizonS, j.decisions, j.key, j.sharedOnly ?? false);
    return out;
  }
}
