import { readFileSync } from "node:fs";
import path from "node:path";
import loadHighs from "highs";
import { describe, it } from "vitest";
import { ICAOS } from "../airports/profiles";
import { buildRegistry, type Layout } from "../airports/registry";
import { InProcessCompute } from "../compute";
import { Runtime } from "../runtime";
import type { HighsLike } from "../solver/milp";
import { fmtTime } from "../world";
import { makeAirports } from "./fixtures";

describe.skipIf(!process.env.SKYPACT_DEBUG)("debug agents", () => {
  it("prints the agent conversation for Nightfall", async () => {
    const highs = (await loadHighs()) as unknown as HighsLike;
    // SKYPACT_REAL=1 runs on the OSM-derived layouts served by the app instead of the fixtures
    const aps = process.env.SKYPACT_REAL
      ? buildRegistry(Object.fromEntries(ICAOS.map((icao) => [icao, JSON.parse(readFileSync(path.join(process.cwd(), "public/data/airports", `${icao}.layout.json`), "utf8")) as Layout])))
      : makeAirports();
    const rt = new Runtime(aps, new InProcessCompute(highs, aps));
    rt.pacingMs = 0;
    rt.speed = 120;
    rt.load(process.env.SKYPACT_SCENARIO ?? "nightfall", 7);
    // SKYPACT_HUMAN=1 keeps the supervisor human (as in the app), so proposals wait for an approval
    if (!process.env.SKYPACT_HUMAN) rt.stakeholderModes.NATIONAL_SUPERVISOR = "simulated";
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
      console.log(`PROPOSAL ${p.id} v${p.version} ${p.status} ${p.label} decisions=${p.plan.decisions.length} created=${fmtTime(p.createdAt, true)} stale=${p.staleReason ?? "-"} kpis=${JSON.stringify(p.plan.kpis)}`);
      for (const d of p.plan.decisions.slice(0, 12)) console.log(`   ${d.action} ${d.callsign} ${d.airport}${d.to ? "→" + d.to : ""} ${d.stand ?? ""} ${d.eldt ? fmtTime(d.eldt) : ""}`);
    }
    const fmt = (p: { totalDelayMin: number; paxDelayHours: number; airborneHoldingMin: number; groundWaitMin: number; standConflicts: number; fuelDiversions: number }) =>
      `delay ${p.totalDelayMin.toFixed(0)} pax ${p.paxDelayHours.toFixed(0)} hold ${p.airborneHoldingMin.toFixed(0)} wait ${p.groundWaitMin.toFixed(0)} conflicts ${p.standConflicts} fuelDiv ${p.fuelDiversions}`;
    for (const e of rt.evidence) console.log("EVIDENCE", e.proposal, "| none", fmt(e.noAction), "| local", fmt(e.localGreedy), "| plan", fmt(e.plan));
    console.log("audit ok", rt.audit.verify().ok, rt.audit.entries.length, "outcome", JSON.stringify(rt.outcome()));
  }, 1800000);
});
