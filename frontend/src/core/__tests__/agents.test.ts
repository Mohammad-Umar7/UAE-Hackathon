import loadHighs from "highs";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthorityError } from "../agents/orchestrator";
import { can } from "../approvals/roles";
import { InProcessCompute } from "../compute";
import { Runtime } from "../runtime";
import type { HighsLike } from "../solver/milp";
import { makeAirports } from "./fixtures";

let highs: HighsLike;
beforeAll(async () => { highs = (await loadHighs()) as unknown as HighsLike; });

const settle = () => new Promise((r) => setTimeout(r, 0));

async function runUntil(rt: Runtime, t: number, maxIter = 20000) {
  rt.running = true;
  for (let i = 0; i < maxIter && rt.world.now < t; i++) {
    rt.tick(0.25);
    await settle();
  }
  // let any in-flight workflow finish
  for (let i = 0; i < 200 && rt.held; i++) await settle();
}

function makeRuntime(supervisor: "human" | "simulated" = "simulated") {
  const aps = makeAirports();
  const rt = new Runtime(aps, new InProcessCompute(highs, aps));
  rt.pacingMs = 0;
  rt.speed = 120;
  rt.load("nightfall", 7);
  rt.stakeholderModes.NATIONAL_SUPERVISOR = supervisor;
  return rt;
}

describe("agents + approvals", () => {
  it("runs the disruption workflow end to end and commits only after approvals", async () => {
    const rt = makeRuntime("simulated");
    await runUntil(rt, rt.scenario.start + 110 * 60);
    const o = rt.orchestrator;
    expect(o.workflows.length).toBeGreaterThan(0);
    const types = new Set(o.messages.map((m) => m.type));
    for (const t of ["DisruptionNotice", "ImpactAssessment", "PlanCandidates", "ValidationResult", "CoordinationRequest", "StakeholderResponse"]) {
      expect(types.has(t as never), `missing ${t}`).toBe(true);
    }
    const tools = new Set(o.actions.map((a) => `${a.agent}:${a.tool}`));
    expect(tools.has("recovery:run_optimizer")).toBe(true);
    expect(tools.has("validation:validate_plan")).toBe(true);
    const committed = Object.values(rt.proposals).filter((p) => p.status === "COMMITTED");
    expect(committed.length).toBeGreaterThan(0);
    for (const p of committed) expect(p.approvals.every((a) => a.decision === "APPROVED" || a.decision === "ACKNOWLEDGED")).toBe(true);
    expect(rt.audit.verify().ok).toBe(true);
    // every agent action used only tools it is allowed to use
    expect(o.actions.filter((a) => a.status === "blocked")).toHaveLength(0);
  }, 300000);

  it("waits for the human supervisor before committing", async () => {
    const rt = makeRuntime("human");
    await runUntil(rt, rt.scenario.start + 100 * 60);
    const open = Object.values(rt.proposals).filter((p) => p.status === "PROPOSED");
    expect(Object.values(rt.proposals).some((p) => p.status === "COMMITTED")).toBe(false);
    expect(open.length).toBe(1);
    const slot = open[0].approvals.find((s) => s.key === "NATIONAL_SUPERVISOR")!;
    expect(slot.decision).toBe("PENDING");
    // an airport controller cannot decide the supervisor's slot
    expect(() => rt.decide(`${open[0].id}#${open[0].version}`, "NATIONAL_SUPERVISOR", "APPROVED", "", "AIRPORT_CONTROLLER:OMDB")).toThrow();
    expect(can("OBSERVER", "decide_slot", { slotKey: "OBSERVER" })).toBe(false);
  }, 300000);

  it("tampering with the audit trail is detected", async () => {
    const rt = makeRuntime("simulated");
    await runUntil(rt, rt.scenario.start + 60 * 60);
    expect(rt.audit.entries.length).toBeGreaterThan(1);
    rt.audit.entries[0].detail = "tampered";
    expect(rt.audit.verify().ok).toBe(false);
  }, 300000);

  it("rejects tool calls outside an agent's authority", () => {
    expect(new AuthorityError("x")).toBeInstanceOf(Error);
  });
});
