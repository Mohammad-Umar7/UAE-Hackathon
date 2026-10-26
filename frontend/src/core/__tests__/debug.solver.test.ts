import loadHighs from "highs";
import { describe, it } from "vitest";
import { Engine } from "../sim/engine";
import { buildWorld } from "../sim/scenarios";
import { project } from "../solver/evaluate";
import { solveVariant, type HighsLike } from "../solver/milp";
import { buildProblem } from "../solver/problem";
import { fmtTime } from "../world";
import { makeAirports } from "./fixtures";

describe.skipIf(!process.env.SKYPACT_DEBUG)("debug solver", () => {
  it("prints unresolved flights and projection differences", async () => {
    const highs = (await loadHighs()) as unknown as HighsLike;
    const aps = makeAirports();
    const { world, scenario } = buildWorld("nightfall", 7, aps);
    const eng = new Engine(world, aps);
    eng.bootstrap();
    eng.advanceTo(scenario.start + 75 * 60);
    const pb = buildProblem(world, aps, { scope: ["OMAA", "OMDB"] });
    const plan = solveVariant(highs, pb, "min_delay");
    for (const d of plan.decisions.filter((x) => x.action === "unresolved")) {
      const f = pb.flights.find((x) => x.visit === d.visit)!;
      console.log("UNRESOLVED", d.callsign, d.airport, f.type, "reason:", f.reason, "E", f.E, "sobt", f.sobt, "tat", f.tat, "opts", f.homeOpts.map((o) => o.stand).join(","));
      console.log("   excluded:", (d.excluded ?? []).slice(0, 8).map((e) => `${e.stand ?? e.airport}:${e.code}:${e.reason}`).join(" | "));
    }
    const fx = pb.fixed.filter((f) => f.airport === "OMDB").map((f) => `${f.stand}[${f.start},${f.end}]${f.kind}`);
    console.log("OMDB fixed:", fx.join(" "));
    const a = project(world, aps, "no_action", 4 * 3600);
    const p = project(world, aps, "live", 4 * 3600, plan.decisions);
    console.log("conflicts none:", a.events.filter((e) => e.kind === "STAND_CONFLICT").map((e) => `${e.airport}:${e.callsign}@${fmtTime(e.t)} ${e.detail}`).join(" ; "));
    console.log("conflicts plan:", p.events.filter((e) => e.kind === "STAND_CONFLICT").map((e) => `${e.airport}:${e.callsign}@${fmtTime(e.t)} ${e.detail}`).join(" ; "));
  }, 120000);
});
