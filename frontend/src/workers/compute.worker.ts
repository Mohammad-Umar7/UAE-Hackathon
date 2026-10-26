/// <reference lib="webworker" />
/**
 * Compute worker: runs the HiGHS MILP optimiser and look-ahead projections off the main thread
 * so the 3D view and UI stay responsive. Everything runs locally (WebAssembly).
 */

import loadHighs from "highs";
import { buildRegistry, type Layout, type Registry } from "../core/airports/registry";
import { PROFILES } from "../core/airports/profiles";
import { project } from "../core/solver/evaluate";
import { solveAlternatives, solveVariant, type HighsLike, type PlanResult, type VariantId } from "../core/solver/milp";
import type { ProjectionJob } from "../core/compute";
import type { Problem } from "../core/solver/problem";
import type { World } from "../core/types";

let highs: HighsLike | null = null;
let registry: Registry | null = null;

type Req =
  | { id: number; type: "init"; layouts: Record<string, Layout>; profileOverrides?: Record<string, Partial<(typeof PROFILES)[string]>> }
  | { id: number; type: "solve"; problem: Problem; timeLimit: number; first?: PlanResult[] }
  | { id: number; type: "solveVariant"; problem: Problem; variant: VariantId; timeLimit: number }
  | { id: number; type: "project"; world: World; jobs: ProjectionJob[]; horizonS: number };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      const profiles = Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, { ...p, ...(msg.profileOverrides?.[k] ?? {}) }]));
      registry = buildRegistry(msg.layouts, profiles);
      if (!highs) {
        highs = (await loadHighs({ locateFile: (file: string) => new URL(`/solver/${file}`, self.location.origin).href })) as unknown as HighsLike;
      }
      self.postMessage({ id: msg.id, ok: true, result: { stands: Object.values(registry).reduce((s, a) => s + Object.keys(a.stands).length, 0) } });
    } else if (msg.type === "solve") {
      if (!highs) throw new Error("solver not initialised");
      const plans = solveAlternatives(highs, msg.problem, msg.timeLimit, msg.first);
      self.postMessage({ id: msg.id, ok: true, result: plans });
    } else if (msg.type === "solveVariant") {
      if (!highs) throw new Error("solver not initialised");
      self.postMessage({ id: msg.id, ok: true, result: solveVariant(highs, msg.problem, msg.variant, { timeLimit: msg.timeLimit }) });
    } else if (msg.type === "project") {
      if (!registry) throw new Error("registry not initialised");
      const out: Record<string, unknown> = {};
      for (const j of msg.jobs) out[j.key] = project(msg.world, registry, j.policy, msg.horizonS, j.decisions, j.key, j.sharedOnly ?? false);
      self.postMessage({ id: msg.id, ok: true, result: out });
    }
  } catch (e) {
    self.postMessage({ id: msg.id, ok: false, error: (e as Error).message ?? String(e) });
  }
};
