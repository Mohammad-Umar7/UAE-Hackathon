"use client";

import { ArrowRight, ArrowRightLeft, Check, ChevronRight, CircleDashed, Clock3, Hourglass, PlaneLanding, ShieldCheck, Truck, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { proposalKey } from "@/core/agents/orchestrator";
import { isOpen, type ApprovalSlot, type Proposal } from "@/core/approvals/workflow";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { approvalState, city, listOr, planEffects, whoSaid, workflowName, type Effect } from "../story";
import { Decisions } from "./Decisions";
import { PlanComparison } from "./PlanComparison";

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");

/** The three outcomes a first-time audience understands, in plain words, worst-first. */
const OUTCOMES: { key: Effect["key"]; label: string; show: (v: number) => string }[] = [
  { key: "fuel", label: "Planes forced to divert, low on fuel", show: n0 },
  { key: "holding", label: "Hours planes spend circling", show: (min) => n0(min / 60) },
  { key: "stands", label: "Planes landing to find their gate taken", show: n0 },
  { key: "pax", label: "Hours of passenger delay", show: n0 },
];

/** What the plan does, one short line per kind of action. */
function actions(p: Proposal): { icon: typeof Truck; text: string }[] {
  const ds = p.plan.decisions;
  const n = (a: string) => ds.filter((d) => d.action === a).length;
  const to = listOr([...new Set(ds.filter((d) => d.action === "divert").map((d) => city(d.to!)))]);
  const out: { icon: typeof Truck; text: string }[] = [];
  if (n("divert")) out.push({ icon: PlaneLanding, text: `${n("divert")} flight${n("divert") === 1 ? "" : "s"} land at ${to} instead` });
  if (n("assign_stand")) out.push({ icon: ArrowRightLeft, text: `${n("assign_stand")} aircraft get a different gate` });
  if (n("landing_slot")) out.push({ icon: Hourglass, text: `${n("landing_slot")} flights get a planned landing time` });
  if (n("tow")) out.push({ icon: Truck, text: `${n("tow")} broken-down aircraft towed clear of a gate` });
  if (n("unresolved")) out.push({ icon: TriangleAlert, text: `${n("unresolved")} flight${n("unresolved") === 1 ? "" : "s"} still need a person to decide` });
  return out;
}

/** The Decision view in Simple mode: what goes wrong without the plan, what the plan does, and one button. */
export function SimpleDecision({ p, versions, onPick }: { p: Proposal; versions: [string, Proposal][]; onPick: (key: string) => void }) {
  const rt = useRuntime();
  const wf = rt.orchestrator.workflows.find((w) => w.id === p.thread);
  const fx = planEffects(p);
  const tiles = OUTCOMES.map((o) => ({ o, e: fx.find((e) => e.key === o.key) })).filter((x) => x.e && x.e.before > 0).slice(0, 3);
  const newest = versions[0];
  return (
    <div className="scroll-y h-full">
      <div className="mx-auto grid max-w-[1180px] grid-cols-[minmax(0,1fr)_360px] gap-5 px-6 py-6">
        <div className="min-w-0 space-y-5">
          <header>
            <StatusLine p={p} />
            <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-tight">{wf ? workflowName(rt, wf) : "Recovery plan"}</h1>
            <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">
              The AI agents built a recovery plan across all three airports. Here is what it changes over the next four hours.
            </p>
            {p.staleReason && newest && newest[0] !== proposalKey(p) && (
              <button className="mt-2 flex items-center gap-1 text-[13px] font-medium text-[var(--navy)] hover:underline" onClick={() => onPick(newest[0])}>
                This version is out of date — open the newest plan <ArrowRight size={14} />
              </button>
            )}
          </header>

          {tiles.length > 0 && (
            <section className="panel overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_92px] items-center gap-x-4 border-b border-line px-5 py-2.5 text-[11.5px] font-medium text-muted">
                <span />
                <span className="text-right">If nobody acts</span>
                <span className="text-right">With the plan</span>
                <span className="text-right">Change</span>
              </div>
              {tiles.map(({ o, e }) => {
                const pct = Math.round((100 * (e!.after - e!.before)) / e!.before);
                return (
                  <div key={o.key} className="grid grid-cols-[minmax(0,1fr)_110px_110px_92px] items-center gap-x-4 border-b border-line px-5 py-3.5 last:border-b-0">
                    <span className="text-[14px] text-ink">{o.label}</span>
                    <span className="mono text-right text-[20px] font-semibold text-[var(--red)]">{o.show(e!.before)}</span>
                    <span className="mono text-right text-[20px] font-semibold text-[var(--teal)]">{o.show(e!.after)}</span>
                    <span className={`text-right text-[15px] font-semibold ${pct < 0 ? "text-[var(--teal)]" : pct > 0 ? "text-[var(--amber)]" : "text-muted"}`}>{pct === 0 ? "same" : `${pct < 0 ? "−" : "+"}${Math.abs(pct)}%`}</span>
                  </div>
                );
              })}
            </section>
          )}

          <section>
            <h2 className="mb-2 text-[15px] font-semibold tracking-tight">What the plan does</h2>
            <ul className="grid gap-2">
              {actions(p).map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-[14px]">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-navy-soft text-navy"><Icon size={16} /></span>{text}
                </li>
              ))}
            </ul>
          </section>

          <Details p={p} versions={versions} onPick={onPick} />
        </div>

        <aside className="self-start lg:sticky lg:top-0">
          <DecisionCard p={p} />
        </aside>
      </div>
    </div>
  );
}

function StatusLine({ p }: { p: Proposal }) {
  const open = isOpen(p);
  const committed = p.status === "COMMITTED";
  const color = committed ? "var(--teal)" : open ? "var(--amber)" : "var(--muted)";
  const text = committed ? "Approved — the plan is running" : open ? "Plan ready for approval" : p.status === "REJECTED" ? "Rejected" : "Out of date";
  return (
    <div className="flex items-center gap-3 text-[12.5px]">
      <span className="flex items-center gap-1.5 font-medium" style={{ color }}><span className="h-2 w-2 rounded-full" style={{ background: color }} />{text}</span>
      {p.decisionDeadline && open && <span className="flex items-center gap-1 text-muted"><Clock3 size={13} /> decide by {fmtTime(p.decisionDeadline.t)}</span>}
    </div>
  );
}

/** The one thing the viewer does here: approve or say no — and then see where the approvals stand. */
function DecisionCard({ p }: { p: Proposal }) {
  const rt = useRuntime();
  const { role, toast, setView } = useOps();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [list, setList] = useState(false);
  const a = approvalState(p, role);
  const mine = p.approvals.find((s) => s.key === role);
  const canAct = Boolean(mine && mine.decision === "PENDING" && isOpen(p));
  const decide = (d: "APPROVED" | "REJECTED" | "ACKNOWLEDGED") => {
    try { rt.decide(proposalKey(p), mine!.key, d, reason, role); setRejecting(false); setReason(""); } catch (e) { toast((e as Error).message, "bad"); }
  };
  const committed = p.status === "COMMITTED";
  const left = a.total - a.done;
  return (
    <div className="panel overflow-hidden shadow-[var(--shadow-2)]">
      <div className="p-5">
        {canAct ? (
          <>
            <div className="text-[17px] font-semibold tracking-tight">Your approval is needed</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">Nothing happens until everyone says yes. Saying no sends it back to the agents with your reason.</p>
            {rejecting ? (
              <>
                <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why not? The agents re-plan around it."
                  className="mt-4 w-full resize-none rounded-lg border border-line-2 bg-panel px-3 py-2 text-[13px] outline-none focus:border-navy" />
                <div className="mt-2 flex gap-2">
                  <button className="btn btn-red h-10 flex-1 justify-center" disabled={!reason.trim()} onClick={() => decide("REJECTED")}>Send back</button>
                  <button className="btn btn-ghost h-10" onClick={() => setRejecting(false)}>Cancel</button>
                </div>
              </>
            ) : (
              <div className="mt-4 grid gap-2">
                <button className="btn btn-teal h-12 justify-center text-[15px] font-semibold" onClick={() => decide(mine!.type === "ATC_LIAISON" ? "ACKNOWLEDGED" : "APPROVED")}>
                  <Check size={17} /> Approve the plan
                </button>
                <button className="btn h-10 justify-center text-[13.5px]" onClick={() => setRejecting(true)}>Say no</button>
              </div>
            )}
          </>
        ) : committed ? (
          <>
            <div className="text-[17px] font-semibold tracking-tight">Everyone approved</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">The plan is running: aircraft are moving to their new gates and landing times.</p>
            <button className="btn btn-primary mt-4 h-11 w-full justify-center text-[14px]" onClick={() => setView("evidence")}>See before &amp; after <ArrowRight size={15} /></button>
          </>
        ) : isOpen(p) ? (
          <>
            <div className="text-[17px] font-semibold tracking-tight">{mine && mine.decision !== "PENDING" ? "You approved" : "Waiting for approvals"}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">Waiting for {left} more {left === 1 ? "answer" : "answers"}. The plan starts as soon as everyone has said yes.</p>
          </>
        ) : (
          <>
            <div className="text-[17px] font-semibold tracking-tight">{p.status === "REJECTED" ? "Sent back" : "No longer open"}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{p.staleReason ?? "The agents replaced this version with a newer plan."}</p>
          </>
        )}
      </div>

      <div className="border-t border-line px-5 py-3.5">
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="font-medium">{a.done} of {a.total} approved</span>
          <button className="flex items-center gap-0.5 text-muted hover:text-ink" onClick={() => setList((v) => !v)}>
            Who <ChevronRight size={13} className={`transition-transform ${list ? "rotate-90" : ""}`} />
          </button>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-2"><div className="h-full rounded-full bg-[var(--teal)] transition-all" style={{ width: `${(100 * a.done) / Math.max(1, a.total)}%` }} /></div>
        {list && <ul className="mt-3 space-y-1.5">{p.approvals.map((s) => <Slot key={s.key} s={s} />)}</ul>}
        <p className="mt-2.5 text-[11.5px] leading-snug text-faint">Airports, airlines and air-traffic control answer on their own in this demo.</p>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-[12.5px]">
        <ShieldCheck size={15} className={p.validation.valid ? "text-[var(--teal)]" : "text-[var(--red)]"} />
        {p.validation.valid ? "Passed the independent safety check" : "Failed the safety check"}
      </div>
    </div>
  );
}

function Slot({ s }: { s: ApprovalSlot }) {
  const done = s.decision === "APPROVED" || s.decision === "ACKNOWLEDGED";
  const no = s.decision === "REJECTED" || s.decision === "REVISION_REQUESTED";
  return (
    <li className="flex items-start gap-2 text-[12px] leading-snug">
      <span className="mt-[1px]">{done ? <Check size={13} className="text-[var(--teal)]" /> : no ? <X size={13} className="text-[var(--red)]" /> : <CircleDashed size={13} className="text-faint" />}</span>
      <span className={no ? "text-[var(--red)]" : done ? "text-ink-2" : "text-muted"}>{whoSaid(s)}{no && s.reason ? ` — ${s.reason}` : ""}</span>
    </li>
  );
}

/** Everything a specialist might ask about, out of the way until asked for. */
function Details({ p, versions, onPick }: { p: Proposal; versions: [string, Proposal][]; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const earlier = versions.filter(([, v]) => v.version !== p.version).sort((a, b) => a[1].version - b[1].version);
  return (
    <section>
      <button className="flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={15} className={`transition-transform ${open ? "rotate-90" : ""}`} /> {open ? "Hide details" : `Details: every flight, the other options, earlier versions`}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {earlier.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              Other versions:
              {earlier.map(([k, v]) => <button key={k} className="pill pill-outline hover:bg-bg-2" onClick={() => onPick(k)}>v{v.version} · {v.status.toLowerCase().replace("_", " ")}</button>)}
            </div>
          )}
          <Decisions p={p} />
          <PlanComparison p={p} />
        </div>
      )}
    </section>
  );
}
