import loadHighs from "highs";
import { describe, it } from "vitest";
import { InProcessCompute } from "../compute";
import { Runtime } from "../runtime";
import type { HighsLike } from "../solver/milp";
import { fmtTime } from "../world";
import { makeAirports } from "./fixtures";

describe.skipIf(!process.env.SKYPACT_DEBUG)("debug agents", () => {
  it("prints the agent conversation for Nightfall", async () => {
    const highs = (await loadHighs()) as unknown as HighsLike;
    const aps = makeAirports();
    const rt = new Runtime(aps, new InProcessCompute(highs, aps));
    rt.pacingMs = 0;
    rt.speed = 120;
    rt.load(process.env.SKYPACT_SCENARIO ?? "nightfall", 7);
    rt.stakeholderModes.NATIONAL_SUPERVISOR = "simulated";
    rt.running = true;
    const end = rt.scenario.start + Number(process.env.SKYPACT_MIN ?? 120) * 60;
    for (let i = 0; i < 40000 && rt.world.now < end; i++) { rt.tick(0.25); await new Promise((r) => setTimeout(r, 0)); }
    for (const m of rt.orchestrator.messages) {
      console.log(`${fmtTime(m.t, true)} ${m.thread} [${m.fromLabel ?? m.from}] ${m.type}: ${m.summary}`);
      if (m.type === "Escalation" && m.payload.reports) {
        for (const [k, r] of Object.entries(m.payload.reports as Record<string, { violations: { code: string; detail: string; callsign: string }[] }>)) {
          console.log(`   VIOLATIONS ${k}:`, r.violations.map((v) => `${v.code} ${v.callsign ?? ""} ${v.detail}`).join(" | "));
        }
      }
    }
    for (const p of Object.values(rt.proposals)) {
      console.log(`PROPOSAL ${p.id} v${p.version} ${p.status} ${p.label} decisions=${p.plan.decisions.length} kpis=${JSON.stringify(p.plan.kpis)}`);
      for (const d of p.plan.decisions.slice(0, 12)) console.log(`   ${d.action} ${d.callsign} ${d.airport}${d.to ? "→" + d.to : ""} ${d.stand ?? ""} ${d.eldt ? fmtTime(d.eldt) : ""}`);
    }
    for (const e of rt.evidence) console.log("EVIDENCE", e.proposal, "noAction", e.noAction.totalDelayMin, e.noAction.airborneHoldingMin, e.noAction.fuelDiversions,
      "| local", e.localGreedy.totalDelayMin, "| plan", e.plan.totalDelayMin, e.plan.airborneHoldingMin, e.plan.fuelDiversions);
    console.log("audit ok", rt.audit.verify().ok, rt.audit.entries.length, "outcome", JSON.stringify(rt.outcome()));
  }, 600000);
});
