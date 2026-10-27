"use client";

/**
 * Presentation Mode: a guided, interruptible tour that drives the real system (same runtime,
 * agents, optimiser and approvals as normal use). Steps only set views, run the clock until a real
 * event happens, and let the presenter approve as National Operations Supervisor. Nothing is staged.
 */

import { ArrowLeft, ArrowRight, Check, CircleDot, Loader2, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isOpen, type Proposal } from "@/core/approvals/workflow";
import type { Runtime } from "@/core/runtime";
import { fmtTime } from "@/core/world";
import { useOps, type CameraMode, type View } from "@/store/ops";

interface Step {
  id: string;
  title: string;
  body: string;
  view: View;
  airport?: string;
  camera?: CameraMode;
  lighting?: "auto" | "day" | "dusk" | "night";
  /** run the clock at this speed when entering the step */
  speed?: number;
  /** keep running until this is true (then pause), with a short status for the presenter */
  until?: (rt: Runtime) => boolean;
  waiting?: string;
  done?: string | ((rt: Runtime) => string);
  enter?: (rt: Runtime) => void;
  approve?: boolean;
}

const fogActive = (rt: Runtime) => Object.values(rt.world.incidents).some((i) => i.airport === "OMAA" && i.type === "FOG" && i.status === "active");
const newestOpen = (rt: Runtime): [string, Proposal] | null =>
  Object.entries(rt.proposals).filter(([, p]) => isOpen(p)).sort((a, b) => b[1].createdAt - a[1].createdAt)[0] ?? null;
const hasMessage = (rt: Runtime, type: string) => rt.orchestrator.messages.some((m) => m.type === type);
const othersDecided = (p: Proposal) => p.approvals.filter((a) => a.key !== "NATIONAL_SUPERVISOR").every((a) => a.decision !== "PENDING");

const STEPS: Step[] = [
  {
    id: "network", title: "Three airports, one network", view: "command",
    body: "Abu Dhabi, Dubai and Sharjah are each other's backup airports. SKYPACT watches all three together. Everything here runs live in this browser, and nothing happens without a person's approval.",
    enter: (rt) => {
      if (rt.scenario.id !== "nightfall" || rt.world.now > rt.scenario.start + 60 || Object.keys(rt.proposals).length) rt.load("nightfall", 7);
      rt.setRunning(false);
    },
  },
  {
    id: "fog", title: "18:00 · thick fog at Abu Dhabi", view: "twin", airport: "OMAA", camera: "strategic", lighting: "auto", speed: 90,
    until: (rt) => fogActive(rt) && rt.world.now >= rt.scenario.start + 46 * 60,
    waiting: "Fast-forwarding to the fog…", done: "The fog is in: low-visibility rules are on.",
    body: "In fog, planes must land further apart: Abu Dhabi can now land 12 planes an hour instead of 30, so arriving aircraft start circling while they wait.",
  },
  {
    id: "agents", title: "The AI agents get to work", view: "agents", speed: 60,
    until: (rt) => hasMessage(rt, "PlanCandidates"), waiting: "The agents are working — the clock waits for them…", done: "The agents have a plan ready.",
    body: "One agent spots the fog, another predicts the knock-on effects, and the planning agent uses a mathematical optimiser to build recovery plans. Every step is listed on the right; click an agent to see its job.",
  },
  {
    id: "plans", title: "A plan, compared with doing nothing", view: "workbench",
    enter: (rt) => { const o = newestOpen(rt); if (o) useOps.getState().select({ selectedProposal: o[0] }); },
    body: "This is the recommended plan: what it changes and what it should achieve against doing nothing. A separate safety-check agent has re-checked every rule before anyone is asked.",
  },
  {
    id: "local", title: "Sharjah knows something the system didn't", view: "agents", speed: 60,
    // with another seed every stakeholder may simply approve; the tour then moves on instead of waiting
    until: (rt) => { const o = newestOpen(rt); return hasMessage(rt, "LocalInformationShared") || Boolean(o && othersDecided(o[1])); },
    waiting: "Waiting for the people in charge to answer…",
    done: (rt) => (hasMessage(rt, "LocalInformationShared") ? "Local information shared — the agents are re-planning." : "Every stakeholder approved — no hidden local constraint this time."),
    body: "Sharjah's airport controller sees that an earlier version sent wheelchair passengers there, but their wheelchair lifts are broken. They said no, that fact was shared with everyone, and the agents re-planned.",
  },
  {
    id: "approve", title: "People decide", view: "workbench", speed: 60, approve: true,
    enter: (rt) => { const o = newestOpen(rt); if (o) useOps.getState().select({ selectedProposal: o[0] }); },
    until: (rt) => { const o = newestOpen(rt); return Boolean(o && othersDecided(o[1])); },
    waiting: "Collecting approvals…", done: "Everyone else has approved — your turn.",
    body: "Airports, airlines and air-traffic control approve. The final yes belongs to the national supervisor — that's you.",
  },
  {
    id: "execute", title: "The plan runs", view: "twin", airport: "OMAA", camera: "strategic", speed: 30,
    until: (rt) => hasMessage(rt, "PlanCommitted"), waiting: "Starting the approved plan…", done: "The plan is running.",
    body: "Aircraft move to their new gates and some land at Sharjah or Dubai instead. If anything changes, the plan is withdrawn and re-planned rather than carried out blindly.",
  },
  {
    id: "evidence", title: "Measured, not claimed", view: "evidence",
    body: "The result, measured against doing nothing from the same starting point: far less circling, fewer emergency fuel diversions and shorter passenger delays — on synthetic traffic.",
  },
  {
    id: "replay", title: "Every step can be replayed and audited", view: "replay",
    body: "Every input is recorded, so the evening can be replayed exactly, and a tamper-proof log shows who approved what and when. Flights and airlines are synthetic throughout.",
  },
];

export default function Presentation() {
  const { presentation, setPresentation, setView, setAirport, setCamera, setOverlay, runtime, toast } = useOps();
  const [status, setStatus] = useState<"idle" | "waiting" | "done">("idle");
  const [clock, setClock] = useState("");
  const entered = useRef(-1);
  const phase = useRef<"idle" | "waiting" | "done">("idle");
  const step = STEPS[Math.min(presentation.step, STEPS.length - 1)];

  const go = useCallback((i: number) => setPresentation({ step: Math.max(0, Math.min(STEPS.length - 1, i)) }), [setPresentation]);
  const exit = useCallback(() => { setPresentation({ active: false }); entered.current = -1; }, [setPresentation]);

  // enter a step: set the stage, then run the clock until its condition holds
  useEffect(() => {
    if (!presentation.active || !runtime) return;
    if (entered.current === presentation.step) return;
    entered.current = presentation.step;
    const s = STEPS[presentation.step];
    s.enter?.(runtime);
    if (s.airport) setAirport(s.airport);
    setView(s.view);
    if (s.camera) setCamera(s.camera);
    if (s.lighting) setOverlay("lighting", s.lighting);
    if (s.until && !s.until(runtime)) {
      if (s.speed) runtime.setSpeed(s.speed);
      runtime.setRunning(true);
      phase.current = "waiting";
    } else phase.current = s.until ? "done" : "idle";
  }, [presentation.active, presentation.step, runtime, setAirport, setView, setCamera, setOverlay]);

  // watch the step's condition (polled; React state follows the ref)
  useEffect(() => {
    if (!presentation.active || !runtime) return;
    const id = setInterval(() => {
      setClock(fmtTime(runtime.world.now));
      const s = STEPS[presentation.step];
      if (phase.current === "waiting" && s.until?.(runtime)) {
        if (!s.approve && s.id !== "execute") runtime.setRunning(false);
        phase.current = "done";
      }
      setStatus(phase.current);
    }, 250);
    return () => clearInterval(id);
  }, [presentation.active, presentation.step, runtime]);

  // keyboard: → / space next, ← back, Esc exit
  useEffect(() => {
    if (!presentation.active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(presentation.step + 1); }
      else if (e.key === "ArrowLeft") go(presentation.step - 1);
      else if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation.active, presentation.step, go, exit]);

  if (!presentation.active || !runtime) return null;

  const approveNow = () => {
    const o = newestOpen(runtime);
    if (!o) { toast("No open proposal to approve yet", "warn"); return; }
    const slot = o[1].approvals.find((a) => a.key === "NATIONAL_SUPERVISOR" && a.decision === "PENDING");
    if (!slot) { toast("The supervisor has already decided on this proposal", "info"); return; }
    try {
      runtime.decide(o[0], slot.key, "APPROVED", "Approved during the guided demonstration", "NATIONAL_SUPERVISOR");
      runtime.setSpeed(30);
      runtime.setRunning(true);
      toast(`${o[1].id} v${o[1].version} approved by the National Supervisor`, "ok");
      go(presentation.step + 1);
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  const last = presentation.step === STEPS.length - 1;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="hud pointer-events-auto w-[min(720px,100%)] overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
        <div className="h-[3px] bg-white/10"><div className="h-full bg-[#4fb8a4] transition-all duration-500" style={{ width: `${((presentation.step + 1) / STEPS.length) * 100}%` }} /></div>
        <div className="flex items-start gap-3 px-4 pb-3 pt-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold">{presentation.step + 1}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-[15px] font-semibold tracking-tight">{step.title}</div>
              <span className="mono ml-auto text-[11px] text-white/50">{clock} GST · synthetic day</span>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/80">{step.body}</p>
            {step.until && (
              <div className="mt-2 flex items-center gap-1.5 text-[11.5px]">
                {status === "waiting" ? <Loader2 size={13} className="animate-spin text-[#e0a646]" /> : <Check size={13} className="text-[#4fb8a4]" />}
                <span className={status === "waiting" ? "text-[#e0a646]" : "text-[#7fd1bf]"}>{status === "waiting" ? step.waiting : typeof step.done === "function" ? step.done(runtime) : step.done}</span>
              </div>
            )}
          </div>
          <button className="hud-btn !px-1.5" onClick={exit} aria-label="Exit presentation" title="Exit (Esc)"><X size={13} /></button>
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <button key={s.id} onClick={() => go(i)} title={s.title} aria-label={`Step ${i + 1}: ${s.title}`}>
                <CircleDot size={11} className={i === presentation.step ? "text-white" : i < presentation.step ? "text-[#4fb8a4]" : "text-white/25"} />
              </button>
            ))}
          </div>
          <span className="text-[10.5px] text-white/40">← → to navigate · Esc to exit · you can take over at any time</span>
          <div className="ml-auto flex gap-1.5">
            <button className="hud-btn" disabled={presentation.step === 0} onClick={() => go(presentation.step - 1)}><ArrowLeft size={13} /> Back</button>
            {step.approve ? (
              <button className="hud-btn" data-on="true" onClick={approveNow}><ShieldCheck size={13} /> Approve as National Supervisor</button>
            ) : (
              <button className="hud-btn" data-on="true" onClick={() => (last ? exit() : go(presentation.step + 1))}>{last ? "Finish" : "Next"} {!last && <ArrowRight size={13} />}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
