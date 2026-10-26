"use client";

import { Check, CircleDashed, RefreshCcw, ShieldCheck, Undo2, X } from "lucide-react";
import { useState } from "react";
import { roleOf } from "@/core/approvals/roles";
import { isOpen, type ApprovalSlot, type Proposal } from "@/core/approvals/workflow";
import { proposalKey } from "@/core/agents/orchestrator";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { STATUS_PILL } from "../common/format";

export function Approvals({ p }: { p: Proposal }) {
  const rt = useRuntime();
  const { role, toast } = useOps();
  const done = p.approvals.filter((a) => a.decision === "APPROVED" || a.decision === "ACKNOWLEDGED").length;
  return (
    <div className="panel flex flex-col overflow-hidden">
      <div className="panel-h">
        <div>
          <div className="panel-t">Approvals</div>
          <div className="text-[11px] text-muted">{done}/{p.approvals.length} recorded · nothing executes before all of them</div>
        </div>
        <span className={`pill ${STATUS_PILL[p.status] ?? "pill-gray"}`}>{p.status.replace("_", " ")}</span>
      </div>
      <div className="h-1.5 bg-bg-2"><div className="h-full bg-[var(--teal)] transition-all" style={{ width: `${(100 * done) / Math.max(1, p.approvals.length)}%` }} /></div>
      <ul>
        {p.approvals.map((s) => <SlotRow key={s.key} p={p} s={s} mine={s.key === role} onError={(m) => toast(m, "bad")} />)}
      </ul>
      {isOpen(p) && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <button className="btn btn-sm" onClick={() => { try { rt.requestReplan("supervisor requested a recalculation", role); toast("Replan requested — agents recalculating", "info"); } catch (e) { toast((e as Error).message, "bad"); } }}>
            <RefreshCcw size={12} /> Request replan
          </button>
          <span className="text-[11px] text-muted">Act as the right role (top-right) to decide your slot.</span>
        </div>
      )}
    </div>
  );
}

function SlotRow({ p, s, mine, onError }: { p: Proposal; s: ApprovalSlot; mine: boolean; onError: (m: string) => void }) {
  const rt = useRuntime();
  const role = useOps((st) => st.role);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"none" | "reject" | "revise">("none");
  const r = roleOf(s.key);
  const canAct = mine && isOpen(p) && s.decision === "PENDING";
  const isAtc = s.type === "ATC_LIAISON";
  const decide = (d: "APPROVED" | "REJECTED" | "REVISION_REQUESTED" | "ACKNOWLEDGED") => {
    try { rt.decide(proposalKey(p), s.key, d, reason, role); setMode("none"); setReason(""); } catch (e) { onError((e as Error).message); }
  };
  const icon = s.decision === "APPROVED" || s.decision === "ACKNOWLEDGED" ? <Check size={13} className="text-[var(--teal)]" />
    : s.decision === "REJECTED" ? <X size={13} className="text-[var(--red)]" /> : s.decision === "REVISION_REQUESTED" ? <Undo2 size={13} className="text-[var(--amber)]" />
      : <CircleDashed size={13} className="text-[var(--amber)]" />;
  return (
    <li className={`border-b border-line px-3 py-2.5 ${canAct ? "bg-amber-soft/40" : ""}`} style={canAct ? { background: "color-mix(in oklab, var(--amber-soft) 55%, transparent)" } : undefined}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold">{s.label}</span>
            <span className={`pill ${s.mode === "human" ? "pill-navy" : "pill-gray"}`} style={{ height: 16, fontSize: 9.5 }}>{s.mode}</span>
          </div>
          <div className="text-[11px] text-muted">{r.person}{s.decision === "PENDING" && s.dueAt ? ` · expected ~${fmtTime(s.dueAt)}` : ""}</div>
          {s.items.length > 0 && <div className="mt-1 text-[11px] leading-snug text-ink-2">{s.items.slice(0, 3).join(" · ")}{s.items.length > 3 ? ` · +${s.items.length - 3} more` : ""}</div>}
          {s.reason && s.decision !== "PENDING" && (
            <div className={`mt-1.5 rounded-md border px-2 py-1.5 text-[11.5px] leading-snug ${s.decision === "REJECTED" ? "border-[color-mix(in_oklab,var(--red)_35%,var(--line))] bg-red-soft text-ink" : "border-line bg-bg-2 text-ink-2"}`}>
              <span className="font-semibold">{s.decision.replace("_", " ").toLowerCase()} {s.t ? `· ${fmtTime(s.t, true)}` : ""}:</span> {s.reason}
            </div>
          )}
          {canAct && (
            <div className="mt-2 space-y-1.5">
              {mode !== "none" && (
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={mode === "reject" ? "Reason for rejection (recorded in the audit trail)" : "What should change?"}
                  className="w-full resize-none rounded-md border border-line-2 bg-panel-2 px-2 py-1.5 text-[12px] outline-none focus:border-navy" />
              )}
              <div className="flex flex-wrap gap-1.5">
                {mode === "none" ? (
                  <>
                    <button className="btn btn-teal btn-sm" onClick={() => decide(isAtc ? "ACKNOWLEDGED" : "APPROVED")}><ShieldCheck size={12} /> {isAtc ? "Acknowledge review" : "Approve"}</button>
                    {!isAtc && <button className="btn btn-red btn-sm" onClick={() => setMode("reject")}><X size={12} /> Reject</button>}
                    <button className="btn btn-sm" onClick={() => setMode("revise")}><Undo2 size={12} /> Request revision</button>
                  </>
                ) : (
                  <>
                    <button className={`btn btn-sm ${mode === "reject" ? "btn-red" : "btn-primary"}`} disabled={!reason.trim()} onClick={() => decide(mode === "reject" ? "REJECTED" : "REVISION_REQUESTED")}>
                      Confirm {mode === "reject" ? "rejection" : "revision request"}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setMode("none")}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          )}
          {!mine && s.decision === "PENDING" && s.mode === "human" && (
            <div className="mt-1 text-[11px] text-[var(--amber)]">Waiting for a human in this role — switch role to decide.</div>
          )}
        </div>
      </div>
    </li>
  );
}
