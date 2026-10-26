import type { Runtime } from "../runtime";
import { Orchestrator } from "./orchestrator";

/** Wires the orchestrator to the runtime (the runtime implements the orchestrator's Host interface). */
export function orchestratorFor(rt: Runtime): Orchestrator {
  return new Orchestrator(rt);
}
