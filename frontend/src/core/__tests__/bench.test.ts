/**
 * Benchmarks on the OSM-derived layouts (skipped unless SKYPACT_BENCH=1). Prints a markdown table:
 *   SKYPACT_BENCH=1 npx vitest run src/core/__tests__/bench.test.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import loadHighs from "highs";
import { describe, it } from "vitest";
import { ICAOS } from "../airports/profiles";
import { buildRegistry, type Layout } from "../airports/registry";
import { Engine } from "../sim/engine";
import { buildWorld } from "../sim/scenarios";
import { project } from "../solver/evaluate";
import { solveAlternatives, type HighsLike } from "../solver/milp";
import { buildProblem, problemStats } from "../solver/problem";
import { validatePlan } from "../solver/validate";

const ms = (t0: number) => performance.now() - t0;

describe.skipIf(!process.env.SKYPACT_BENCH)("benchmarks (real layouts)", () => {
  it("measures simulator, optimiser, validator and projection", async () => {
    const rows: [string, string][] = [];
    let t = performance.now();
    const layouts = Object.fromEntries(ICAOS.map((icao) => [icao, JSON.parse(readFileSync(path.join(process.cwd(), "public/data/airports", `${icao}.layout.json`), "utf8")) as Layout]));
    const aps = buildRegistry(layouts);
    rows.push(["Build registry (3 layouts: taxi graphs, stands, taxi-time tables)", `${ms(t).toFixed(0)} ms`]);
    const stands = Object.values(aps).reduce((n, a) => n + Object.keys(a.stands).length, 0);
    const nodes = Object.values(aps).reduce((n, a) => n + a.graph.nodes.size, 0);
    rows.push(["Layout size", `${stands} stands · ${nodes} taxi-graph nodes`]);

    t = performance.now();
    const { world, scenario } = buildWorld("nightfall", 7, aps);
    rows.push(["Generate Nightfall world (schedules, incidents, weather)", `${ms(t).toFixed(0)} ms · ${Object.keys(world.visits).length} aircraft visits`]);

    // full-fidelity simulation throughput (kinematics on), no agents
    const eng = new Engine(world, aps);
    eng.bootstrap();
    t = performance.now();
    eng.advanceTo(scenario.start + 6 * 3600);
    const simMs = ms(t);
    rows.push(["Simulate 6 h, three airports, full kinematics, no plans", `${simMs.toFixed(0)} ms (${((6 * 3600) / (simMs / 1000)).toFixed(0)}× real time)`]);

    // optimiser at the height of the disruption
    const { world: w2 } = buildWorld("nightfall", 7, aps);
    const e2 = new Engine(w2, aps);
    e2.bootstrap();
    e2.advanceTo(scenario.start + 75 * 60);
    const highs = (await loadHighs()) as unknown as HighsLike;
    t = performance.now();
    const pb = buildProblem(w2, aps, {});
    const buildMs = ms(t);
    const st = problemStats(pb);
    rows.push(["Build recovery problem (18:35, all airports)", `${buildMs.toFixed(0)} ms · ${JSON.stringify(st)}`]);
    t = performance.now();
    const plans = solveAlternatives(highs, pb);
    rows.push(["Solve three MILP variants (HiGHS WASM)", `${ms(t).toFixed(0)} ms total`]);
    for (const p of plans) {
      rows.push([`  ${p.label}`, `${p.status} · ${p.solveMs.toFixed(0)} ms · ${p.numVars} vars · ${p.numRows} rows · gap ${p.mipGap === null ? "n/a" : `${(Math.max(0, p.mipGap) * 100).toFixed(2)} %`} · ${p.decisions.length} decisions`]);
    }
    t = performance.now();
    const rep = validatePlan(w2, aps, plans[0].decisions, plans[0].rows, pb.t0);
    rows.push(["Independent validation of the recommended plan", `${ms(t).toFixed(1)} ms · ${rep.violations.length} violations · ${Object.values(rep.checks).reduce((a, b) => a + b, 0)} checks`]);
    t = performance.now();
    const base = project(w2, aps, "no_action", 4 * 3600);
    const tBase = ms(t);
    t = performance.now();
    const withPlan = project(w2, aps, "local_greedy", 4 * 3600, plans[0].decisions);
    rows.push(["4 h look-ahead projection (fast mode)", `${tBase.toFixed(0)} ms no-action · ${ms(t).toFixed(0)} ms with plan`]);
    rows.push(["Projected outcome: no action → plan", `delay ${base.totalDelayMin} → ${withPlan.totalDelayMin} min · holding ${base.airborneHoldingMin} → ${withPlan.airborneHoldingMin} min · stand conflicts ${base.standConflicts} → ${withPlan.standConflicts} · fuel diversions ${base.fuelDiversions} → ${withPlan.fuelDiversions}`]);

    console.log(`\n| Measurement | Result |\n|---|---|\n${rows.map(([a, b]) => `| ${a} | ${b} |`).join("\n")}\n`);
  }, 600000);
});
