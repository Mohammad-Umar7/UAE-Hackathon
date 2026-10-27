"use client";

import { Accessibility, BatteryFull, Check, Clock3, DoorOpen, PlaneLanding, Signal, Wifi, X } from "lucide-react";
import { useEffect, useState } from "react";
import { proposalKey } from "@/core/agents/orchestrator";
import { isOpen, type Proposal } from "@/core/approvals/workflow";
import type { Runtime } from "@/core/runtime";
import { fmtTime } from "@/core/world";
import { useOps } from "@/store/ops";
import { city, listOr, workflowName } from "../story";

/** The approver the guided demo puts on a phone: Sharjah's duty manager, out on the apron when the fog plan arrives. */
export const PHONE_ROLE = "AIRPORT_CONTROLLER:OMSJ";
const HERE = "OMSJ";
const REASONS = ["Not enough ground crew", "No free gates", "Wheelchair lifts busy"];

/** The newest open plan that is waiting for the phone's answer (or was just answered on it). */
function phonePlan(rt: Runtime): Proposal | null {
  const open = Object.values(rt.proposals).filter((p) => isOpen(p) && p.approvals.some((a) => a.key === PHONE_ROLE)).sort((a, b) => b.createdAt - a.createdAt);
  return open[0] ?? null;
}

/**
 * A phone-sized view of one approval, for the person who is not at a desk: what the plan asks of their airport, in
 * four lines, and the same yes / no as the Decision page. Part of the guided demo's story, driving the real runtime.
 */
export function PhoneApproval({ rt }: { rt: Runtime }) {
  useOps((s) => s.version);
  const toast = useOps((s) => s.toast);
  const [answered, setAnswered] = useState<{ key: string; yes: boolean } | null>(null);
  const [saying, setSaying] = useState(false);
  const p = phonePlan(rt);
  const slot = p?.approvals.find((a) => a.key === PHONE_ROLE);
  const key = p ? proposalKey(p) : null;
  const pending = slot?.decision === "PENDING";
  const justAnswered = answered && answered.key === key;

  // the confirmation stays a moment, then the phone goes back in the pocket
  const [goneKey, setGoneKey] = useState<string | null>(null);
  const gone = goneKey !== null && goneKey === key;
  useEffect(() => {
    if (!justAnswered || !key) return;
    const id = setTimeout(() => setGoneKey(key), 3500);
    return () => clearTimeout(id);
  }, [justAnswered, key]);

  if (!p || !slot || (!pending && !justAnswered) || gone) return null;

  const decide = (yes: boolean, reason: string) => {
    try {
      rt.decide(key!, PHONE_ROLE, yes ? "APPROVED" : "REJECTED", reason, PHONE_ROLE);
      setAnswered({ key: key!, yes });
      setSaying(false);
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  const wf = rt.orchestrator.workflows.find((w) => w.id === p.thread);
  const divs = p.plan.decisions.filter((d) => d.action === "divert" && d.to === HERE);
  const local = p.plan.decisions.filter((d) => d.airport === HERE && d.action === "assign_stand").length;
  const first = Math.min(...divs.map((d) => d.eldt ?? Infinity));
  const lines: { icon: typeof Check; text: string }[] = divs.length ? [
    { icon: PlaneLanding, text: `${divs.length} flight${divs.length === 1 ? "" : "s"} from ${listOr([...new Set(divs.map((d) => city(d.airport)))])} land here instead` },
    { icon: DoorOpen, text: `Gates already reserved for ${divs.filter((d) => d.stand).length} of them${local ? `, ${local} of ours move gate` : ""}` },
    ...(divs.some((d) => d.needs_ambulift) ? [{ icon: Accessibility, text: `${divs.filter((d) => d.needs_ambulift).length} need a wheelchair lift on arrival` }] : []),
    ...(Number.isFinite(first) ? [{ icon: Clock3, text: `First one lands at ${fmtTime(first)}` }] : []),
  ] : slot.items.slice(0, 3).map((t) => ({ icon: Check, text: t }));

  return (
    <div className="pointer-events-auto fixed right-8 top-1/2 z-[52] -translate-y-1/2 animate-[phone-in_0.7s_cubic-bezier(0.2,0.9,0.25,1)_both]" aria-label="Sharjah duty manager's phone">
      <div className="w-[290px] rounded-[44px] bg-[#0b0f16] p-[10px] shadow-[0_30px_80px_rgba(0,0,0,0.5)] ring-1 ring-white/15">
        <div className="relative flex h-[590px] flex-col overflow-hidden rounded-[34px] bg-[linear-gradient(170deg,#e9f6f3_0%,#eef1f7_45%,#f6efe8_100%)] text-[#141a22]">
          {/* status bar and the island */}
          <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-semibold">
            <span>{fmtTime(rt.world.now)}</span>
            <span className="h-[22px] w-[84px] rounded-full bg-black" />
            <span className="flex items-center gap-1"><Signal size={11} /><Wifi size={11} /><BatteryFull size={13} /></span>
          </div>

          {justAnswered ? (
            <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
              <span className={`grid h-14 w-14 place-items-center rounded-full text-white ${answered!.yes ? "bg-[#1d7566]" : "bg-[#b0393a]"}`}>{answered!.yes ? <Check size={28} /> : <X size={28} />}</span>
              <div className="mt-4 text-[17px] font-semibold">{answered!.yes ? "Approved" : "Sent back"}</div>
              <p className="mt-1 text-[12.5px] leading-snug text-[#4a5563]">{answered!.yes ? "The national operations centre sees your answer right away." : "The AI agents re-plan around your reason."}</p>
            </div>
          ) : (
            <>
              {/* the notification that brought them here */}
              <div className="mx-3 mt-3 rounded-2xl bg-white/70 px-3 py-2 shadow-[0_4px_14px_rgba(20,30,45,0.08)] backdrop-blur">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#687280]">SKYPACT <span className="font-normal normal-case">· now</span></div>
                <div className="text-[12.5px] font-semibold">A recovery plan needs your approval</div>
              </div>

              <div className="flex flex-1 flex-col px-4 pt-4">
                <div className="text-[11px] font-medium text-[#687280]">Sharjah Airport · duty manager</div>
                <div className="mt-0.5 text-[19px] font-semibold leading-tight tracking-tight">{wf ? workflowName(rt, wf) : "Recovery plan"}</div>
                <div className="mt-1 text-[11.5px] text-[#687280]">What it asks of Sharjah:</div>
                <ul className="mt-2.5 space-y-2">
                  {lines.map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-start gap-2.5 rounded-xl bg-white/75 px-3 py-2 text-[12.5px] leading-snug shadow-[0_1px_2px_rgba(20,30,45,0.06)]">
                      <Icon size={15} className="mt-[1px] shrink-0 text-[#1d7566]" />{text}
                    </li>
                  ))}
                </ul>
                {p.decisionDeadline && <div className="mt-2.5 text-[11px] text-[#a86f14]">Decide by {fmtTime(p.decisionDeadline.t)}</div>}

                <div className="mt-auto pb-5">
                  {saying ? (
                    <>
                      <div className="mb-1.5 text-[11.5px] font-medium text-[#4a5563]">Why not?</div>
                      <div className="grid gap-1.5">
                        {REASONS.map((r) => (
                          <button key={r} className="rounded-xl border border-[#b0393a]/30 bg-white/80 px-3 py-2 text-left text-[12.5px] font-medium text-[#b0393a]" onClick={() => decide(false, `${r} (sent from mobile)`)}>{r}</button>
                        ))}
                        <button className="py-1.5 text-[12px] text-[#687280]" onClick={() => setSaying(false)}>Back</button>
                      </div>
                    </>
                  ) : (
                    <div className="grid gap-2">
                      <button className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#1d7566] text-[15px] font-semibold text-white shadow-[0_6px_16px_rgba(29,117,102,0.35)]" onClick={() => decide(true, "Approved on mobile from the apron")}>
                        <Check size={18} /> Approve
                      </button>
                      <button className="h-10 rounded-2xl border border-[#141a22]/15 bg-white/70 text-[13.5px] font-medium" onClick={() => setSaying(true)}>Say no</button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          <div className="mx-auto mb-2 h-[4px] w-[110px] rounded-full bg-[#141a22]/70" />
        </div>
      </div>
    </div>
  );
}
