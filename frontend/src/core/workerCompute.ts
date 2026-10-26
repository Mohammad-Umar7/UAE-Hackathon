/** ComputeClient backed by the compute Web Worker (HiGHS + projections off the main thread). */

import type { Layout } from "./airports/registry";
import { slimWorld, type ComputeClient, type ProjectionJob } from "./compute";
import type { Projection } from "./solver/evaluate";
import type { PlanResult } from "./solver/milp";
import type { Problem } from "./solver/problem";
import type { World } from "./types";

export class WorkerCompute implements ComputeClient {
  label = "web worker · HiGHS (WebAssembly)";
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private init: Promise<void>;

  constructor(layouts: Record<string, Layout>) {
    this.worker = new Worker(new URL("../workers/compute.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    this.init = this.call("init", { layouts }).then(() => undefined);
  }

  private call(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  ready() { return this.init; }

  async solve(problem: Problem, timeLimit = 30): Promise<PlanResult[]> {
    await this.init;
    return (await this.call("solve", { problem, timeLimit })) as PlanResult[];
  }

  async projectMany(world: World, jobs: ProjectionJob[], horizonS: number): Promise<Record<string, Projection>> {
    await this.init;
    return (await this.call("project", { world: slimWorld(world), jobs, horizonS })) as Record<string, Projection>;
  }

  terminate() { this.worker.terminate(); }
}
