import { describe, expect, it } from "vitest";
import { outcomeMetrics } from "../metrics";
import { Engine } from "../sim/engine";
import { buildWorld } from "../sim/scenarios";
import { ALLOWED_TRANSITIONS, type Visit } from "../types";
import { makeAirports } from "./fixtures";

function run(seed: number, minutes: number) {
  const aps = makeAirports();
  const { world, scenario, notes } = buildWorld("nightfall", seed, aps);
  const eng = new Engine(world, aps);
  eng.bootstrap();
  eng.advanceTo(scenario.start + minutes * 60);
  return { world, eng, aps, scenario, notes };
}

describe("simulation engine", () => {
  it("generates a schedule and advances without errors", () => {
    const { world, eng, notes } = run(7, 90);
    expect(Object.keys(world.visits).length).toBeGreaterThan(100);
    expect(eng.eventCount).toBeGreaterThan(200);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same seed", () => {
    const a = run(11, 120).world, b = run(11, 120).world;
    const sig = (w: typeof a) => Object.values(w.visits).map((v) => `${v.id}:${v.phase}:${v.stand}:${Math.round(v.eldt ?? 0)}`).join("|");
    expect(sig(a)).toBe(sig(b));
  });

  it("only uses legal phase transitions", () => {
    const { world } = run(3, 150);
    for (const v of Object.values(world.visits) as Visit[]) {
      let prev: string | null = null;
      for (const [, phase] of v.history) {
        if (!(phase in ALLOWED_TRANSITIONS)) continue;
        if (prev && prev !== phase) expect(ALLOWED_TRANSITIONS[prev as Visit["phase"]]).toContain(phase);
        prev = phase;
      }
    }
  });

  it("never puts two aircraft on one stand", () => {
    const { world } = run(5, 200);
    const occ = new Map<string, string>();
    for (const v of Object.values(world.visits)) {
      if (["ON_STAND", "READY", "TOWING"].includes(v.phase) && v.stand) {
        const k = `${v.airport}:${v.stand}`;
        expect(occ.has(k), `${k} double occupied`).toBe(false);
        occ.set(k, v.id);
      }
    }
  });

  it("fog restriction produces airborne holding at OMAA", () => {
    const { world, scenario } = run(7, 180);
    const m = outcomeMetrics(world, scenario.start, world.now, new Set(["OMAA"]));
    expect(m.airborneHoldingMin).toBeGreaterThan(0);
  });
});
