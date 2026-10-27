"use client";

import { Award, CopyCheck } from "lucide-react";
import type { Proposal } from "@/core/approvals/workflow";
import type { Projection } from "@/core/solver/evaluate";
import { MIP_REL_GAP, type PlanResult } from "@/core/solver/milp";
import { num } from "../common/format";

interface Col {
  key: string;
  title: string;
  sub: string;
  proj: Projection;
  plan?: PlanResult;
  chosen?: boolean;
  baseline?: boolean;
}

const ROWS: { label: string; get: (c: Col) => number | string; better: "low" | "none"; unit?: string; hint?: string }[] = [
  { label: "Projected total delay", get: (c) => c.proj.totalDelayMin, better: "low", unit: "min", hint: "arrival + departure, 4 h look-ahead" },
  { label: "Passenger delay", get: (c) => c.proj.paxDelayHours, better: "low", unit: "pax·h" },
  { label: "Airborne holding", get: (c) => c.proj.airborneHoldingMin, better: "low", unit: "min" },
  { label: "Ground wait for stand", get: (c) => c.proj.groundWaitMin, better: "low", unit: "min" },
  { label: "Stand conflicts (projected)", get: (c) => c.proj.standConflicts, better: "low" },
  { label: "Uncoordinated fuel diversions", get: (c) => c.proj.fuelDiversions, better: "low" },
  { label: "Coordinated diversions", get: (c) => c.plan?.kpis.diversions ?? "—", better: "none" },
  { label: "Stand changes", get: (c) => c.plan?.kpis.standChanges ?? "—", better: "none" },
  { label: "Cross-airport requests", get: (c) => c.plan?.kpis.coordinationRequests ?? "—", better: "none" },
  { label: "Unresolved flights", get: (c) => c.plan?.kpis.unresolved ?? "—", better: "low" },
  { label: "Optimality (HiGHS)", get: (c) => (!c.plan ? "—" : c.plan.status === "Optimal" ? `≤ ${(MIP_REL_GAP * 100).toFixed(1)} % gap` : "not proven"), better: "none",
    hint: "“Optimal” = proven within the relative gap for this model; otherwise the node-limited search stopped first" },
];

export function PlanComparison({ p }: { p: Proposal }) {
  if (!p.projections) return null;
  const cols: Col[] = [
    { key: "noAction", title: "No coordinated action", sub: "planned stands kept · crews divert on minimum fuel", proj: p.projections.noAction, baseline: true },
    { key: "localGreedy", title: "Local-only reassignment", sub: "each airport first-fit · no network coordination", proj: p.projections.localGreedy, baseline: true },
    ...p.candidates.map((c) => ({ key: c.variant, title: c.label, sub: c.duplicateOf ? `same assignment as ${c.duplicateOf.replace("_", " ")}` : c.distinctNote ? `alternative ${c.distinctNote}` : `${c.status} · ${c.solveMs.toFixed(0)} ms · ${num(c.numVars)} vars`,
      proj: p.projections!.candidates[c.variant], plan: c, chosen: c.variant === p.variant })),
  ].filter((c) => c.proj);
  const maxDelay = Math.max(...cols.map((c) => c.proj.totalDelayMin), 1);
  return (
    <div className="panel overflow-hidden">
      <div className="panel-h">
        <div>
          <div className="panel-t">Candidate plans vs baselines</div>
          <div className="text-[11px] text-muted">Each column is a deterministic simulation from the same state (shared picture); a candidate plan handles whatever it does not cover exactly like the local-only baseline. {p.recommendedReason}</div>
        </div>
      </div>
      <div className="scroll-x">
        <table className="table min-w-[760px]">
          <thead>
            <tr>
              <th className="w-[150px]">Metric</th>
              {cols.map((c) => (
                <th key={c.key} className={c.chosen ? "!bg-[var(--teal-soft)]" : ""}>
                  <div className="flex items-center gap-1 normal-case tracking-normal">
                    {c.chosen && <Award size={12} className="text-[var(--teal)]" />}
                    {c.plan?.duplicateOf && <CopyCheck size={12} className="text-faint" />}
                    <span className={`text-[11.5px] font-semibold ${c.baseline ? "text-muted" : "text-ink"}`}>{c.title}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-faint">{c.sub}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-[11.5px] text-muted">Delay profile</td>
              {cols.map((c) => (
                <td key={c.key} className={c.chosen ? "bg-[color-mix(in_oklab,var(--teal-soft)_45%,transparent)]" : ""}>
                  <div className="h-2 w-full rounded bg-bg-2">
                    <div className="h-2 rounded" style={{ width: `${(100 * c.proj.totalDelayMin) / maxDelay}%`, background: c.baseline ? "var(--faint)" : c.chosen ? "var(--teal)" : "var(--navy-2)" }} />
                  </div>
                </td>
              ))}
            </tr>
            {ROWS.map((r) => {
              const vals = cols.map((c) => r.get(c));
              const numeric = vals.filter((v): v is number => typeof v === "number");
              const best = r.better === "low" && numeric.length ? Math.min(...numeric) : null;
              return (
                <tr key={r.label}>
                  <td className="text-[11.5px] text-ink-2">{r.label}{r.unit ? <span className="text-faint"> · {r.unit}</span> : null}</td>
                  {cols.map((c, i) => {
                    const v = vals[i];
                    const isBest = best !== null && v === best && !c.baseline;
                    return (
                      <td key={c.key} className={`mono text-[12px] ${c.chosen ? "bg-[color-mix(in_oklab,var(--teal-soft)_45%,transparent)]" : ""} ${isBest ? "font-semibold text-[var(--teal)]" : c.baseline ? "text-muted" : ""}`}>
                        {typeof v === "number" ? num(v, v % 1 && v < 100 ? 1 : 0) : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
