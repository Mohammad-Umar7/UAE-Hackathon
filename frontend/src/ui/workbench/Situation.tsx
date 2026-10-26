"use client";

import { CloudFog, Lock, Radio, Share2 } from "lucide-react";
import { roleOf } from "@/core/approvals/roles";
import type { Proposal } from "@/core/approvals/workflow";
import { fmtTime, touch } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { iata, num } from "../common/format";

const SEV: Record<string, string> = { severe: "pill-red", high: "pill-red", moderate: "pill-amber", low: "pill-gray" };

export function Situation({ p }: { p: Proposal | null }) {
  const rt = useRuntime();
  const { role, toast } = useOps();
  const w = rt.world;
  const r = roleOf(role);
  const active = Object.values(w.incidents).filter((i) => i.shared && i.status !== "cleared" && i.end > w.now).sort((a, b) => a.start - b.start);
  const localMine = r.type === "AIRPORT_CONTROLLER" ? Object.values(w.restrictions).filter((x) => x.airport === r.scope && !x.shared && x.end > w.now) : [];
  const wf = p ? rt.orchestrator.workflows.find((x) => x.id === p.thread) : rt.orchestrator.workflows[rt.orchestrator.workflows.length - 1];
  const assess = [...rt.orchestrator.messages].reverse().find((m) => m.type === "ImpactAssessment" && (!wf || m.thread === wf.id));
  const proj = assess?.payload.projection as { totalDelayMin: number; holding: number; conflicts: number; fuelDiversions: number } | undefined;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="panel overflow-hidden">
        <div className="panel-h"><div className="panel-t">Detected problem</div>{wf && <span className="mono text-[11px] text-muted">{wf.id}</span>}</div>
        <div className="space-y-2 p-3">
          <div className="text-[13px] font-semibold leading-snug">{wf?.title ?? "No active disruption"}</div>
          {wf && <div className="text-[11.5px] text-muted">Started {fmtTime(wf.startedAt, true)} · scope {wf.airports.map(iata).join(", ")}</div>}
          {proj && (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <Stat label="Delay if no action" value={`${num(proj.totalDelayMin)} min`} tone="red" />
              <Stat label="Holding predicted" value={`${num(proj.holding)} min`} />
              <Stat label="Stand conflicts" value={String(proj.conflicts)} tone={proj.conflicts ? "amber" : undefined} />
              <Stat label="Fuel-diversion risk" value={String(proj.fuelDiversions)} tone={proj.fuelDiversions ? "red" : undefined} />
            </div>
          )}
          {p?.decisionDeadline && p.status === "PROPOSED" && (
            <div className={`rounded-md border px-2 py-1.5 text-[11.5px] ${p.decisionDeadline.t < w.now ? "border-[color-mix(in_oklab,var(--red)_40%,var(--line))] bg-red-soft" : "border-[color-mix(in_oklab,var(--amber)_40%,var(--line))] bg-amber-soft"}`}>
              <span className="font-semibold">{p.decisionDeadline.t < w.now ? "Deadline passed" : "Decision deadline"} {fmtTime(p.decisionDeadline.t)}</span> — {p.decisionDeadline.note}
            </div>
          )}
        </div>
      </div>
      <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="panel-h"><div className="panel-t">Shared operational picture</div><Radio size={13} className="text-muted" /></div>
        <ul className="scroll-y min-h-0 flex-1">
          {active.length === 0 && <li className="p-3 text-muted">No active incidents.</li>}
          {active.map((i) => (
            <li key={i.id} className="border-b border-line px-3 py-2">
              <div className="flex items-center gap-1.5">
                <CloudFog size={12} className="text-muted" />
                <span className="truncate text-[12px] font-semibold">{i.title}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <span className={`pill ${SEV[i.severity]}`} style={{ height: 17, fontSize: 10 }}>{i.severity}</span>
                <span className="pill pill-gray" style={{ height: 17, fontSize: 10 }}>{i.status}</span>
                <span className="pill pill-outline" style={{ height: 17, fontSize: 10 }}>{i.source === "stakeholder_reported" ? "stakeholder reported" : i.source === "human_entered" ? "human entered" : "synthetic scenario"}</span>
                <span className="mono text-[10.5px] text-muted">{fmtTime(i.start)}–{fmtTime(i.end)}</span>
              </div>
              <div className="mt-1 text-[11px] leading-snug text-muted">{i.description}</div>
            </li>
          ))}
          {localMine.length > 0 && (
            <li className="border-b border-line bg-bg-2 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold"><Lock size={12} /> Your local log ({r.scope}) — not yet shared</div>
              {localMine.map((x) => (
                <div key={x.id} className="mt-1.5 flex items-start gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 text-ink-2">{String(x.params.reason ?? x.kind)}</span>
                  <button className="btn btn-sm" onClick={() => {
                    x.shared = true;
                    x.provenance = "stakeholder_reported";
                    const inc = x.incidentId ? w.incidents[x.incidentId] : undefined;
                    if (inc) { inc.shared = true; inc.source = "stakeholder_reported"; }
                    touch(w, "restriction", x.id, "shared");
                    rt.audit.append(w.now, r.person, role, "LOCAL_INFO_SHARED", x.id, String(x.params.reason ?? ""));
                    toast("Shared with the network — the Validation agent will re-check pending plans", "ok");
                    rt.notify();
                  }}><Share2 size={11} /> Share</button>
                </div>
              ))}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" | "amber" }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 px-2 py-1.5">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`mono text-[13px] font-semibold ${tone === "red" ? "text-[var(--red)]" : tone === "amber" ? "text-[var(--amber)]" : ""}`}>{value}</div>
    </div>
  );
}
