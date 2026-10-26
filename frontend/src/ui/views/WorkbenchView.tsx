"use client";

import { BookOpenText, Cpu, ShieldCheck } from "lucide-react";
import { explainProposal } from "@/core/agents/explain";
import { isOpen, type Proposal } from "@/core/approvals/workflow";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { STATUS_PILL } from "../common/format";
import { Approvals } from "../workbench/Approvals";
import { Decisions } from "../workbench/Decisions";
import { PlanComparison } from "../workbench/PlanComparison";
import { Situation } from "../workbench/Situation";

export default function WorkbenchView() {
  const rt = useRuntime();
  const { selectedProposal, select } = useOps();
  const all = Object.entries(rt.proposals).sort((a, b) => b[1].createdAt - a[1].createdAt || b[1].version - a[1].version);
  const open = all.find(([, p]) => isOpen(p));
  const key = selectedProposal && rt.proposals[selectedProposal] ? selectedProposal : open?.[0] ?? all[0]?.[0] ?? null;
  const p = key ? rt.proposals[key] : null;
  const versions = p ? all.filter(([, x]) => x.thread === p.thread) : [];
  return (
    <div className="grid h-full grid-cols-[300px_minmax(0,1fr)_350px] gap-3 p-3">
      <Situation p={p} />
      <div className="scroll-y min-h-0 space-y-3 pr-1">
        {!p ? (
          <div className="panel grid h-full place-items-center p-10 text-center">
            <div>
              <div className="text-[15px] font-semibold">No recovery proposal yet</div>
              <p className="mt-1 max-w-md text-muted">Run the clock. When a disruption is detected, the agents assess its impact, invoke the optimiser and prepare a proposal here for human approval.</p>
              <button className="btn btn-primary mt-4" onClick={() => rt.setRunning(true)}>Run simulation</button>
            </div>
          </div>
        ) : (
          <>
            <Header p={p} />
            <PlanComparison p={p} />
            <Explanation p={p} />
            <Decisions p={p} />
          </>
        )}
      </div>
      <div className="scroll-y flex min-h-0 flex-col gap-3">
        {p && <Approvals p={p} />}
        {versions.length > 0 && (
          <div className="panel overflow-hidden">
            <div className="panel-h"><div className="panel-t">Plan versions</div><span className="text-[11px] text-muted">{p?.id}</span></div>
            <ul>
              {versions.map(([k, v]) => (
                <li key={k}>
                  <button onClick={() => select({ selectedProposal: k })} className={`flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left hover:bg-bg-2 ${k === key ? "bg-navy-soft" : ""}`}>
                    <span className="mono w-7 text-[12px] font-semibold">v{v.version}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px]">{v.label}</span>
                      <span className="block truncate text-[11px] text-muted">{v.history[v.history.length - 1]?.note}</span>
                    </span>
                    <span className={`pill ${STATUS_PILL[v.status] ?? "pill-gray"}`}>{v.status.replace("_", " ").toLowerCase()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <AuditExcerpt />
      </div>
    </div>
  );
}

function Header({ p }: { p: Proposal }) {
  return (
    <div className="panel flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="eyebrow">Recovery proposal</div>
        <div className="flex items-center gap-2">
          <span className="text-[17px] font-semibold tracking-tight">{p.id} · v{p.version}</span>
          <span className={`pill ${STATUS_PILL[p.status] ?? "pill-gray"}`}>{p.status.replace("_", " ")}</span>
          <span className="text-[13px] text-ink-2">{p.label}</span>
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted">
          Computed {fmtTime(p.createdAt, true)} from the shared picture · {p.plan.numVars.toLocaleString()} binary variables, {p.plan.numRows.toLocaleString()} constraints · {p.plan.status} in {p.plan.solveMs.toFixed(0)} ms ·{" "}
          {p.plan.prunedOptions.toLocaleString()} options removed by hard rules{p.supersedes ? ` · supersedes v${p.version - 1}` : ""}
        </div>
        {p.staleReason && <div className="mt-1 text-[12px] text-[var(--red)]">Invalidated: {p.staleReason}</div>}
      </div>
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-3 py-2">
        <ShieldCheck size={16} className={p.validation.valid ? "text-[var(--teal)]" : "text-[var(--red)]"} />
        <div className="leading-tight">
          <div className="text-[11.5px] font-semibold">{p.validation.valid ? "Independent validation passed" : "Validation failed"}</div>
          <div className="text-[10.5px] text-muted">{Object.values(p.validation.checks).reduce((s, n) => s + n, 0)} checks · {p.validation.violations.length} violations</div>
        </div>
      </div>
    </div>
  );
}

function Explanation({ p }: { p: Proposal }) {
  const rt = useRuntime();
  const ex = explainProposal(p, rt.world, rt.airports);
  return (
    <div className="panel overflow-hidden">
      <div className="panel-h">
        <div className="panel-t flex items-center gap-1.5"><BookOpenText size={13} /> Why this plan</div>
        {p.narrative && <span className="pill pill-teal"><Cpu size={11} /> briefing by local LLM {p.narrative.model} · grounding-checked</span>}
      </div>
      {p.narrative && <p className="border-b border-line bg-teal-soft/50 px-4 py-2.5 text-[12.5px] leading-relaxed" style={{ background: "color-mix(in oklab, var(--teal-soft) 50%, transparent)" }}>{p.narrative.text}</p>}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-[12px]">
        <Block title="What changes" items={ex.whatChanged} />
        <Block title="Why (shared picture)" items={ex.why.length ? ex.why : ["No active restrictions"]} />
        <Block title="Measured impact (simulation)" items={ex.delayImpact} />
        <Block title="Hard constraints respected" items={ex.constraints} />
        <Block title="Affected carriers (fictional)" items={ex.affected} />
        <Block title="Evidence" items={ex.evidence} />
      </div>
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="eyebrow mb-1">{title}</div>
      <ul className="space-y-0.5">{items.map((x, i) => <li key={i} className="leading-snug text-ink-2">· {x}</li>)}</ul>
    </div>
  );
}

function AuditExcerpt() {
  const rt = useRuntime();
  const v = rt.audit.verify();
  const last = rt.audit.entries.slice(-12).reverse();
  return (
    <div className="panel overflow-hidden">
      <div className="panel-h">
        <div className="panel-t">Audit trail</div>
        <span className={`pill ${v.ok ? "pill-teal" : "pill-red"}`}>{v.ok ? "hash chain verified" : `broken at #${v.brokenAt}`}</span>
      </div>
      <ul>
        {last.map((e) => (
          <li key={e.seq} className="border-b border-line px-3 py-1.5">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="mono text-faint">#{e.seq}</span>
              <span className="mono text-muted">{fmtTime(e.t, true)}</span>
              <span className="font-semibold">{e.action.replace(/_/g, " ").toLowerCase()}</span>
              <span className="truncate text-muted">{e.target}</span>
            </div>
            <div className="truncate text-[11px] text-ink-2">{e.actor} — {e.detail}</div>
            <div className="mono truncate text-[9.5px] text-faint">{e.hash.slice(0, 24)}… ← {e.prevHash.slice(0, 10)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
