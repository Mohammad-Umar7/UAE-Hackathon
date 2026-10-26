import loadHighs from "highs";
import { beforeAll, describe, expect, it } from "vitest";
import { AIRCRAFT } from "../aircraft";
import { standAccepts } from "../airports/registry";
import { Engine } from "../sim/engine";
import { buildWorld } from "../sim/scenarios";
import { project } from "../solver/evaluate";
import { solveAlternatives, solveVariant, type HighsLike } from "../solver/milp";
import { buildProblem, problemStats } from "../solver/problem";
import { validatePlan } from "../solver/validate";
import { makeAirports } from "./fixtures";

let highs: HighsLike;
beforeAll(async () => { highs = (await loadHighs()) as unknown as HighsLike; });

function nightfallAt(minutes: number, seed = 7) {
  const aps = makeAirports();
  const { world, scenario } = buildWorld("nightfall", seed, aps);
  const eng = new Engine(world, aps);
  eng.bootstrap();
  eng.advanceTo(scenario.start + minutes * 60);
  return { world, aps, eng };
}

describe("recovery optimiser (HiGHS)", () => {
  it("returns validated plans that respect hard constraints", () => {
    const { world, aps } = nightfallAt(75);
    const pb = buildProblem(world, aps, { scope: ["OMAA", "OMDB"] });
    const st = problemStats(pb);
    expect(st.flights).toBeGreaterThan(5);
    const plan = solveVariant(highs, pb, "min_delay");
    expect(["Optimal", "Time limit reached"]).toContain(plan.status);
    const rep = validatePlan(world, aps, plan.decisions, plan.rows, pb.t0);
    expect(rep.violations).toEqual([]);
    // every stand/diversion choice is size/category compatible
    for (const r of plan.rows) {
      if (r.option === "home" || r.option === "divert") {
        const ap = aps[r.option === "home" ? r.home : r.to!];
        expect(standAccepts(ap.stands[r.stand!], AIRCRAFT[r.type as keyof typeof AIRCRAFT])[0]).toBe(true);
      }
    }
  });

  it("produces a plan that beats the no-action baseline in projection", () => {
    const { world, aps } = nightfallAt(75);
    const pb = buildProblem(world, aps, { scope: ["OMAA", "OMDB"] });
    const plan = solveVariant(highs, pb, "min_delay");
    const base = project(world, aps, "no_action", 4 * 3600);
    const withPlan = project(world, aps, "live", 4 * 3600, plan.decisions);
    // eslint-disable-next-line no-console
    console.log("no_action", base.totalDelayMin, base.airborneHoldingMin, base.groundWaitMin, base.standConflicts, base.fuelDiversions,
      "| plan", withPlan.totalDelayMin, withPlan.airborneHoldingMin, withPlan.groundWaitMin, withPlan.standConflicts, withPlan.fuelDiversions,
      "| kpis", JSON.stringify(plan.kpis), plan.solveMs.toFixed(0), "ms", plan.numVars, "vars", plan.numRows, "rows");
    expect(withPlan.totalDelayMin).toBeLessThanOrEqual(base.totalDelayMin);
  });

  it("excludes options a stakeholder rejected and re-plans", () => {
    const { world, aps } = nightfallAt(75);
    const pb = buildProblem(world, aps, { scope: ["OMAA", "OMDB"] });
    const p1 = solveVariant(highs, pb, "min_delay");
    const target = p1.rows.find((r) => r.option === "home" && r.changed) ?? p1.rows.find((r) => r.option === "home");
    expect(target).toBeTruthy();
    const pb2 = buildProblem(world, aps, { scope: ["OMAA", "OMDB"], forbidden: [{ visit: target!.visit, airport: target!.home, stand: target!.stand }] });
    const p2 = solveVariant(highs, pb2, "min_delay");
    const row2 = p2.rows.find((r) => r.visit === target!.visit)!;
    expect(row2.option === "home" && row2.stand === target!.stand).toBe(false);
  });

  it("solves three alternatives deterministically", () => {
    const { world, aps } = nightfallAt(75);
    const pb = buildProblem(world, aps, { scope: ["OMAA", "OMDB"] });
    const a = solveAlternatives(highs, pb);
    const b = solveAlternatives(highs, pb);
    expect(a.map((p) => p.signature)).toEqual(b.map((p) => p.signature));
    expect(a).toHaveLength(3);
  }, 120000);
});
