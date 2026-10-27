"use client";

import { Check, ChevronRight, CircleDashed, Clock3, Cpu, ShieldCheck, Undo2, X } from "lucide-react";
import { useState } from "react";
import { proposalKey } from "@/core/agents/orchestrator";
import { roleOf } from "@/core/approvals/roles";
import { isOpen, type ApprovalSlot, type Proposal } from "@/core/approvals/workflow";
import type { Incident } from "@/core/types";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { activeIncidents, approvalState, change, planChanges, planEffects, plainIncident, whoSaid, workflowName } from "../story";
import { Decisions } from "./Decisions";
import { PlanComparison } from "./PlanComparison";

const STATUS: Record<string, [string, string]> = {
  PROPOSED: ["Waiting for approval", "pill-amber"], VALIDATED: ["Waiting for approval", "pill-amber"], COMMITTED: ["Approved and running", "pill-teal"],
  REJECTED: ["Rejected", "pill-red"], REVISION_REQUESTED: ["Changes requested", "pill-amber"], STALE: ["Out of date", "pill-gray"],
  SUPERSEDED: ["Replaced by a newer version", "pill-gray"], EXPIRED: ["Expired", "pill-gray"], INVALID: ["Failed the safety check", "pill-red"],
};

/** The Decision view in Simple mode: the problem, the plan, what it should achieve, why — and the approvals. */
export function SimpleDecision({ p, versions, onPick }: { p: Proposal; versions: [string, Proposal][]; onPick: (key: string) => void }) {
  const rt = useRuntime();
  const wf = rt.orchestrator.workflows.find((w) => w.id === p.thread);
  const [status, tone] = STATUS[p.status] ?? [p.status.toLowerCase(), "pill-gray"];
  const checks = Object.values(p.validation.checks).reduce((s, n) => s + n, 0);
  const earlier = versions.filter(([, v]) => v.version < p.version).sort((a, b) => a[1].version - b[1].version);
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_380px] gap-3 p-3">
      <div className="scroll-y min-h-0 space-y-3 pr-1">
        <div className="panel flex items-start gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="eyebrow">Decision</div>
            <h1 className="mt-0.5 text-[19px] font-semibold tracking-tight">Recovery plan{wf ? ` for: ${workflowName(rt, wf)}` : ""}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <span className={`pill ${tone}`}>{status}</span>
              <span>Version {p.version} · made at {fmtTime(p.createdAt)} by the planning agent</span>
              {p.decisionDeadline && isOpen(p) && <span className="flex items-center gap-1 text-[var(--amber)]"><Clock3 size={12} /> decide by {fmtTime(p.decisionDeadline.t)}</span>}
            </div>
            {p.staleReason && <div className="mt-1.5 text-[12px] text-[var(--red)]">This version went out of date: {p.staleReason}</div>}
            {earlier.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                Earlier versions:
                {earlier.map(([k, v]) => (
                  <button key={k} className="pill pill-outline hover:bg-bg-2" onClick={() => onPick(k)} title={v.history[v.history.length - 1]?.note}>
                    v{v.version} · {(STATUS[v.status]?.[0] ?? v.status).toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${p.validation.valid ? "border-[color-mix(in_oklab,var(--teal)_35%,var(--line))] bg-teal-soft" : "border-[color-mix(in_oklab,var(--red)_35%,var(--line))] bg-red-soft"}`}
            style={{ background: p.validation.valid ? "color-mix(in oklab, var(--teal-soft) 70%, transparent)" : undefined }}>
            <ShieldCheck size={18} className={p.validation.valid ? "text-[var(--teal)]" : "text-[var(--red)]"} />
            <div className="leading-tight">
              <div className="text-[12px] font-semibold">{p.validation.valid ? "Safety check passed" : "Safety check failed"}</div>
              <div className="text-[11px] text-muted">{checks.toLocaleString("en-GB")} rules re-checked independently</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Problem p={p} />
          <div className="panel p-4">
            <div className="eyebrow mb-1.5">The plan</div>
            <ul className="space-y-1.5">
              {planChanges(p).map((c) => <li key={c} className="flex gap-2 text-[13px] leading-snug"><ChevronRight size={14} className="mt-[3px] shrink-0 text-[var(--teal)]" />{c}</li>)}
            </ul>
          </div>
        </div>

        <Effects p={p} />
        <Why p={p} />

        <Expand title={`See all ${p.plan.decisions.length} actions, flight by flight`}><Decisions p={p} /></Expand>
        <Expand title="Compare with the other options the agents considered"><PlanComparison p={p} /></Expand>
      </div>
      <div className="scroll-y flex min-h-0 flex-col gap-3">
        <SimpleApprovals p={p} />
      </div>
    </div>
  );
}

function Problem({ p }: { p: Proposal }) {
  const rt = useRuntime();
  const assess = [...rt.orchestrator.messages].reverse().find((m) => m.type === "ImpactAssessment" && m.thread === p.thread);
  const pr = assess?.payload.projection as { conflicts: number; fuelDiversions: number; holding: number } | undefined;
  const causes: Incident[] = activeIncidents(rt).slice(0, 4);
  const items = pr ? [
    pr.fuelDiversions ? `${pr.fuelDiversions} flights could run low on fuel and have to divert` : "",
    pr.conflicts ? `${pr.conflicts} aircraft would arrive to find their gate taken` : "",
    pr.holding > 30 ? `about ${Math.round(pr.holding).toLocaleString("en-GB")} minutes of circling in the air` : "",
  ].filter(Boolean) : [];
  return (
    <div className="panel p-4">
      <div className="eyebrow mb-1.5">The problem</div>
      {items.length > 0 ? (
        <>
          <div className="text-[12.5px] text-muted">If nobody acts, over the next 4 hours:</div>
          <ul className="mt-1 space-y-1.5">{items.map((x) => <li key={x} className="flex gap-2 text-[13px] leading-snug"><X size={14} className="mt-[3px] shrink-0 text-[var(--red)]" />{x}</li>)}</ul>
        </>
      ) : <div className="text-[13px] text-muted">No serious knock-on effects were predicted.</div>}
      {causes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">{causes.map((i) => <span key={i.id} className="pill pill-red">{plainIncident(i)}</span>)}</div>
      )}
    </div>
  );
}

function Effects({ p }: { p: Proposal }) {
  const setView = useOps((s) => s.setView);
  const fx = planEffects(p);
  if (!fx.length) return null;
  return (
    <div className="panel overflow-hidden">
      <div className="panel-h">
        <div className="panel-t">What it should achieve</div>
        <span className="text-[11px] text-muted">simulated 4 hours ahead from the same starting point, against doing nothing</span>
        <button className="btn btn-sm ml-auto" onClick={() => setView("evidence")}>See before &amp; after <ChevronRight size={13} /></button>
      </div>
      <div className="grid grid-cols-4 gap-3 p-4">
        {fx.map((e) => {
          const pct = change(e);
          const better = e.after < e.before, same = Math.round(e.after) === Math.round(e.before);
          return (
            <div key={e.key} className="rounded-lg border border-line bg-panel-2 p-3" title={e.hint}>
              <div className="text-[12px] font-medium text-ink-2">{e.label}</div>
              <div className={`mt-1 text-[26px] font-semibold tracking-tight ${same ? "text-muted" : better ? "text-[var(--teal)]" : "text-[var(--amber)]"}`}>
                {same ? "no change" : e.before === 0 ? `+${Math.round(e.after)}` : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`}
              </div>
              <div className="mono text-[11px] text-muted">{Math.round(e.before).toLocaleString("en-GB")} → {Math.round(e.after).toLocaleString("en-GB")}{e.unit ? ` ${e.unit}` : ""}</div>
              <div className="mt-1 text-[11px] leading-snug text-faint">{e.hint}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Why({ p }: { p: Proposal }) {
  const n = p.candidates.length || 3;
  const open = p.plan.kpis.unresolved;
  return (
    <div className="panel p-4">
      <div className="eyebrow mb-1.5">Why this plan</div>
      <p className="text-[13px] leading-relaxed text-ink-2">
        The planning agent built {n} alternative plans with a mathematical optimiser and simulated each one. This one was picked because it
        {open ? ` leaves only ${open} flight${open === 1 ? "" : "s"} for people to sort out` : " finds a solution for every affected flight"} and gives the
        lowest expected delay. A separate safety-check agent then re-checked every rule — gate sizes, runway limits, fuel, wheelchair access — before
        anyone was asked to approve.
      </p>
      {p.narrative && (
        <p className="mt-2 rounded-md px-3 py-2 text-[12.5px] leading-relaxed" style={{ background: "color-mix(in oklab, var(--teal-soft) 55%, transparent)" }}>
          <span className="mr-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--teal)]"><Cpu size={11} /> Briefing by a local AI model, numbers checked:</span>
          {p.narrative.text}
        </p>
      )}
    </div>
  );
}

function Expand({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button className="btn w-full justify-between" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && children}
    </div>
  );
}

function SimpleApprovals({ p }: { p: Proposal }) {
  const { role, toast } = useOps();
  const a = approvalState(p, role);
  const mine = p.approvals.find((s) => s.key === role);
  const others = p.approvals.filter((s) => s.key !== role);
  return (
    <div className="panel flex flex-col overflow-hidden">
      <div className="panel-h">
        <div className="panel-t">Who must approve</div>
        <span className="mono text-[12px] font-semibold">{a.done} of {a.total}</span>
      </div>
      <div className="h-1.5 bg-bg-2"><div className="h-full bg-[var(--teal)] transition-all" style={{ width: `${(100 * a.done) / Math.max(1, a.total)}%` }} /></div>
      {mine && <MyDecision p={p} slot={mine} onError={(m) => toast(m, "bad")} />}
      <ul className="py-1">
        {others.map((s) => <SlotLine key={s.key} s={s} />)}
      </ul>
      <div className="border-t border-line px-3 py-2.5 text-[11.5px] leading-snug text-muted">
        Nothing happens until everyone has approved. In this demo you act as the {roleOf(role).title.toLowerCase()}; the others answer automatically.
      </div>
    </div>
  );
}

function SlotLine({ s }: { s: ApprovalSlot }) {
  const done = s.decision === "APPROVED" || s.decision === "ACKNOWLEDGED";
  const no = s.decision === "REJECTED" || s.decision === "REVISION_REQUESTED";
  return (
    <li className="flex items-start gap-2 px-3 py-1.5">
      <span className="mt-0.5">{done ? <Check size={14} className="text-[var(--teal)]" /> : no ? <X size={14} className="text-[var(--red)]" /> : <CircleDashed size={14} className="text-[var(--amber)]" />}</span>
      <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
        <span className="font-medium">{whoSaid(s)}</span>{" "}
        <span className={no ? "text-[var(--red)]" : "text-muted"}>
          {done ? `${s.decision === "ACKNOWLEDGED" ? "noted it" : "approved"}${s.t ? ` at ${fmtTime(s.t)}` : ""}` : no ? `said no — ${s.reason}` : "is deciding…"}
        </span>
      </div>
    </li>
  );
}

function MyDecision({ p, slot, onError }: { p: Proposal; slot: ApprovalSlot; onError: (m: string) => void }) {
  const rt = useRuntime();
  const role = useOps((s) => s.role);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const pending = slot.decision === "PENDING" && isOpen(p);
  const decide = (d: "APPROVED" | "REJECTED" | "ACKNOWLEDGED") => {
    try { rt.decide(proposalKey(p), slot.key, d, reason, role); setRejecting(false); setReason(""); } catch (e) { onError((e as Error).message); }
  };
  if (!pending) {
    return (
      <div className="border-b border-line px-3 py-3 text-[12.5px]">
        <span className="font-semibold">Your decision:</span> {slot.decision === "PENDING" ? "this version is no longer open." : slot.decision.toLowerCase().replace("_", " ")}
      </div>
    );
  }
  return (
    <div className="border-b border-line px-3 py-3" style={{ background: "color-mix(in oklab, var(--amber-soft) 60%, transparent)" }}>
      <div className="text-[13px] font-semibold">Your decision is needed</div>
      <p className="mt-0.5 text-[12px] leading-snug text-ink-2">Approving starts the plan. Saying no sends it back to the agents with your reason, and they re-plan.</p>
      {rejecting && (
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why not? (recorded in the audit trail)"
          className="mt-2 w-full resize-none rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] outline-none focus:border-navy" />
      )}
      <div className="mt-2 flex gap-1.5">
        {rejecting ? (
          <>
            <button className="btn btn-red" disabled={!reason.trim()} onClick={() => decide("REJECTED")}><X size={13} /> Confirm: say no</button>
            <button className="btn btn-ghost" onClick={() => setRejecting(false)}><Undo2 size={13} /> Back</button>
          </>
        ) : (
          <>
            <button className="btn btn-teal flex-1 justify-center" onClick={() => decide(slot.type === "ATC_LIAISON" ? "ACKNOWLEDGED" : "APPROVED")}><ShieldCheck size={14} /> Approve the plan</button>
            <button className="btn btn-red" onClick={() => setRejecting(true)}><X size={13} /> Say no</button>
          </>
        )}
      </div>
    </div>
  );
}
