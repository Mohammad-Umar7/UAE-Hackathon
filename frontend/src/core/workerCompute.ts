/** ComputeClient backed by the compute Web Worker (HiGHS + projections off the main thread). */

import type { Layout } from "./airports/registry";
import { slimWorld, type ComputeClient, type ProjectionJob } from "./compute";
import type { Projection } from "./solver/evaluate";
import { VARIANT_IDS, type PlanResult } from "./solver/milp";
import type { Problem } from "./solver/problem";
import type { World } from "./types";

export class WorkerCompute implements ComputeClient {
  label = "web workers · HiGHS (WebAssembly)";
  private workers: Worker[] = [];
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private init: Promise<void>;

  /** A small pool: the three objective variants solve in parallel, projections are split across workers. */
  constructor(layouts: Record<string, Layout>, size = Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("../workers/compute.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
        const p = this.pending.get(ev.data.id);
        if (!p) return;
        this.pending.delete(ev.data.id);
        if (ev.data.ok) p.resolve(ev.data.result);
        else p.reject(new Error(ev.data.error));
      };
      this.workers.push(w);
    }
    this.label = `${size} web worker${size > 1 ? "s" : ""} · HiGHS (WebAssembly)`;
    this.init = Promise.all(this.workers.map((_, i) => this.call(i, "init", { layouts }))).then(() => undefined);
  }

  private call(worker: number, type: string, payload: Record<string, unknown>): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.workers[worker % this.workers.length].postMessage({ id, type, ...payload });
    });
  }

  ready() { return this.init; }

  async solve(problem: Problem, timeLimit = 30): Promise<PlanResult[]> {
    await this.init;
    const first = (await Promise.all(VARIANT_IDS.map((variant, i) => this.call(i, "solveVariant", { problem, variant, timeLimit })))) as PlanResult[];
    // de-duplication (rarely needs extra solves) runs on one worker, in the same order as a sequential solve
    return (await this.call(0, "solve", { problem, timeLimit, first })) as PlanResult[];
  }

  async projectMany(world: World, jobs: ProjectionJob[], horizonS: number): Promise<Record<string, Projection>> {
    await this.init;
    const slim = slimWorld(world);
    const n = Math.min(this.workers.length, jobs.length) || 1;
    const parts = await Promise.all(Array.from({ length: n }, (_, i) =>
      this.call(i, "project", { world: slim, jobs: jobs.filter((_, j) => j % n === i), horizonS }) as Promise<Record<string, Projection>>));
    return Object.assign({}, ...parts);
  }

  terminate() { this.workers.forEach((w) => w.terminate()); }
}
