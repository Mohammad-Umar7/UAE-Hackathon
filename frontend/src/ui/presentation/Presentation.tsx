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
  done?: string;
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
    id: "network", title: "One network, three airports", view: "command",
    body: "SKYPACT gives the national operations centre one live picture of Zayed International, Dubai International and Sharjah. Everything here runs in this browser: a deterministic simulator, seven cooperating AI agents and a mathematical optimiser. Nothing executes without human approval.",
    enter: (rt) => {
      if (rt.scenario.id !== "nightfall" || rt.world.now > rt.scenario.start + 60 || Object.keys(rt.proposals).length) rt.load("nightfall", 7);
      rt.setRunning(false);
    },
  },
  {
    id: "fog", title: "18:00 · radiation fog at Zayed International", view: "twin", airport: "OMAA", camera: "strategic", lighting: "auto", speed: 120,
    until: (rt) => fogActive(rt) && rt.world.now >= rt.scenario.start + 46 * 60,
    waiting: "Simulating the evening at 120× until the fog forms…", done: "Fog is down: low-visibility procedures in force.",
    body: "This is the digital twin, built from OpenStreetMap layouts and driven by the simulator. As visibility drops below 550 m, low-visibility procedures switch on, stop bars light and the arrival rate falls from 30 to 12 an hour. Inbound flights begin to hold.",
  },
  {
    id: "agents", title: "Agents detect, assess and plan", view: "agents", speed: 60,
    until: (rt) => hasMessage(rt, "PlanCandidates"), waiting: "Agents are working (the clock pauses while they compute)…", done: "Recovery candidates are ready.",
    body: "The Weather agent raises a disruption notice. Airport Operations measures stand and runway impact, the Airline and ATC agents add their constraints, and the Recovery agent formulates a mixed-integer program and solves it with HiGHS in a web worker. Every message and tool call is inspectable.",
  },
  {
    id: "plans", title: "Optimised options, compared honestly", view: "workbench",
    enter: (rt) => { const o = newestOpen(rt); if (o) useOps.getState().select({ selectedProposal: o[0] }); },
    body: "Three candidates (minimum delay, stability, minimum coordination) are scored against doing nothing and against each airport acting alone, from the same state. The Validation agent re-derives every constraint independently before anyone is asked to approve.",
  },
  {
    id: "local", title: "Local knowledge changes the plan", view: "agents", speed: 60,
    until: (rt) => hasMessage(rt, "LocalInformationShared") || Object.values(rt.proposals).some((p) => p.version > 1),
    waiting: "Waiting for the stakeholders to respond…", done: "Local information shared, plan revised.",
    body: "Stakeholders answer from their own knowledge. Sharjah's controller knows something the network does not: an ambulift and wide-body handling teams are out of service. The rejection reveals it, the information is shared, and the agents re-plan around it.",
  },
  {
    id: "approve", title: "People decide", view: "workbench", speed: 60, approve: true,
    enter: (rt) => { const o = newestOpen(rt); if (o) useOps.getState().select({ selectedProposal: o[0] }); },
    until: (rt) => { const o = newestOpen(rt); return Boolean(o && othersDecided(o[1])); },
    waiting: "Collecting approvals from airports, airline and ATC…", done: "Ready for the National Supervisor.",
    body: "Airport controllers and the airline representative approve; ATC acknowledges, because SKYPACT never issues clearances. The final word belongs to the National Operations Supervisor: that is you.",
  },
  {
    id: "execute", title: "Execution in the twin", view: "twin", airport: "OMAA", camera: "strategic", speed: 30,
    until: (rt) => hasMessage(rt, "PlanCommitted"), waiting: "Committing the approved plan…", done: "Plan committed and executing.",
    body: "The committed plan becomes stand reassignments, landing slots and coordinated diversions. Arcs turn teal and aircraft taxi to their new stands. If the situation changes, the plan is flagged stale and re-planned rather than executed blindly.",
  },
  {
    id: "evidence", title: "Measured, not claimed", view: "evidence",
    body: "Outcomes are projected from the same pre-commit state for three policies: no action, each airport alone, and the coordinated plan. Delay, airborne holding, uncoordinated diversions and assistance for passengers with reduced mobility are compared side by side.",
  },
  {
    id: "replay", title: "Replayable and auditable", view: "replay",
    body: "Every input is recorded, so the whole night can be replayed exactly. A SHA-256 hash-chained audit log shows who approved what and when, and detects any tampering. Synthetic flights and fictional airlines are labelled as such throughout.",
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
                <span className={status === "waiting" ? "text-[#e0a646]" : "text-[#7fd1bf]"}>{status === "waiting" ? step.waiting : step.done}</span>
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
