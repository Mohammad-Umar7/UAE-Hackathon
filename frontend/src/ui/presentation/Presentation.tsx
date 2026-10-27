"use client";

/**
 * Presentation Mode: a guided, interruptible tour that drives the real system (same runtime,
 * agents, optimiser and approvals as normal use). Steps only set views, run the clock until a real
 * event happens, and let the presenter approve as National Operations Supervisor. Nothing is staged.
 *
 * Operation Nightfall has its own story; any other scenario plays the same arc around its main
 * disruption: it starts, the agents handle it, before & after, people decide, the plan runs.
 */

import { ArrowLeft, ArrowRight, Check, CircleDot, Loader2, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isOpen, type Proposal } from "@/core/approvals/workflow";
import type { Runtime } from "@/core/runtime";
import type { Incident } from "@/core/types";
import { fmtTime } from "@/core/world";
import { useOps, type CameraMode, type View } from "@/store/ops";
import { scenarioById } from "@/core/sim/scenarios";
import { followStart } from "../agents/follow";
import { comparisons } from "../impact/compare";
import { city, plainIncident } from "../story";
import { PhoneApproval, PHONE_ROLE } from "./PhoneApproval";

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
  /** the page narrates this step itself: the panel shrinks to a slim see-through bar */
  compact?: boolean;
}

const fogActive = (rt: Runtime) => Object.values(rt.world.incidents).some((i) => i.airport === "OMAA" && i.type === "FOG" && i.status === "active");
const newestOpen = (rt: Runtime): [string, Proposal] | null =>
  Object.entries(rt.proposals).filter(([, p]) => isOpen(p)).sort((a, b) => b[1].createdAt - a[1].createdAt)[0] ?? null;
const hasMessage = (rt: Runtime, type: string) => rt.orchestrator.messages.some((m) => m.type === type);
/** everyone except the supervisor (the presenter) has answered, and in Nightfall also except Sharjah's duty manager (the phone) */
const othersDecided = (p: Proposal, phone = false) =>
  p.approvals.filter((a) => a.key !== "NATIONAL_SUPERVISOR" && !(phone && a.key === PHONE_ROLE)).every((a) => a.decision !== "PENDING");
const phonePending = (p: Proposal) => p.approvals.some((a) => a.key === PHONE_ROLE && a.decision === "PENDING");
/** a plan made since the disruption began, answered by everyone except the supervisor */
const planReady = (rt: Runtime, since: number, phone = false) => { const o = newestOpen(rt); return Boolean(o && o[1].createdAt >= since && othersDecided(o[1], phone)); };
const fogStart = (rt: Runtime) => Object.values(rt.world.incidents).find((i) => i.airport === "OMAA" && i.type === "FOG")?.start ?? Infinity;

/** follow the most serious workflow on the AI agents page, from just before its disruption began */
const followMain = (rt: Runtime) => {
  const c = comparisons(rt)[0];
  useOps.getState().setFollow({ thread: c?.thread ?? null, from: followStart(rt, c?.thread ?? null, c?.cause ?? null) });
};

const AGENTS_BODY = "The camera follows each agent as it acts and shows what it found: the alarm, the prediction of what happens if nobody acts, the plan built with an optimiser, the safety check, and the people asked to approve.";

const NIGHTFALL: Step[] = [
  {
    id: "network", title: "Three airports, one network", view: "command",
    body: "Abu Dhabi, Dubai and Sharjah are each other's backup airports. SKYPACT watches all three together. Everything here runs live in this browser, and nothing happens without a person's approval.",
    enter: (rt) => {
      if (rt.scenario.id !== "nightfall" || rt.world.now > rt.scenario.start + 60 || Object.keys(rt.proposals).length) rt.load("nightfall", 7);
      // Sharjah answers on its own until the fog arrives
      if (rt.stakeholderModes[PHONE_ROLE] === "human") rt.setStakeholderMode(PHONE_ROLE, "simulated", "NATIONAL_SUPERVISOR");
      rt.setRunning(false);
    },
  },
  {
    id: "fog", title: "18:00 · thick fog at Abu Dhabi", view: "twin", airport: "OMAA", camera: "strategic", lighting: "auto", speed: 300,
    // stop as the fog arrives (and the airport reports it), so the agents' response happens in front of the audience next
    until: (rt) => fogActive(rt) && (rt.world.weather.OMAA?.visibility ?? 10000) <= 1000,
    waiting: "Fast-forwarding to the fog…", done: "The fog is in: low-visibility rules are on.",
    body: "In fog, planes must land further apart: Abu Dhabi can now land 12 planes an hour instead of 30, so arriving aircraft start circling while they wait.",
  },
  {
    id: "agents", title: "Watch the agents handle it", view: "agents", speed: 40, compact: true, enter: followMain,
    // wait for the agents and for the camera to finish telling it (or for the presenter to stop following)
    until: (rt) => planReady(rt, fogStart(rt), true) && (useOps.getState().followAt?.done ?? true),
    waiting: "The agents are working; the camera follows each one as it acts…", done: "The desks have answered. Two people are still to decide.",
    body: AGENTS_BODY,
  },
  {
    id: "plans", title: "Before & after, predicted", view: "evidence",
    body: "First one real flight: without SKYPACT it circles in the fog until its fuel runs low and has to divert; with the plan it goes to another airport early, with a gate waiting. Below: the same comparison for every flight, and how the evening unfolds hour by hour.",
  },
  {
    id: "approve", title: "People decide", view: "workbench", speed: 60, approve: true,
    enter: (rt) => { const o = newestOpen(rt); if (o) useOps.getState().select({ selectedProposal: o[0] }); },
    until: (rt) => { const o = newestOpen(rt); return Boolean(o && othersDecided(o[1], true)); },
    waiting: "Collecting approvals…",
    done: (rt) => { const o = newestOpen(rt); return o && phonePending(o[1]) ? "Sharjah's duty manager is out on the apron: the request is on their phone." : "Sharjah has answered from the apron. The final yes is yours."; },
    body: "Sharjah's duty manager isn't at a desk tonight. They are out on the apron, so the plan reaches their phone: four lines on what it asks of Sharjah, and the same yes or no. People can say no: if the plan asks for something Sharjah can't do tonight (its wheelchair lifts are out of service), the duty manager turns it down on the phone and the agents re-plan. Once Sharjah has answered, the final yes belongs to the national supervisor: you.",
  },
  {
    id: "execute", title: "The plan runs", view: "command", speed: 30,
    until: (rt) => hasMessage(rt, "PlanCommitted"), waiting: "Starting the approved plan…", done: "The plan is running.",
    body: "The arcs on the map are the flights the plan sends from Abu Dhabi to Sharjah and Dubai; the rest land at Abu Dhabi at their new times and gates. If anything changes, the plan is withdrawn and re-planned rather than carried out blindly.",
  },
  {
    id: "evidence", title: "Before & after, approved", view: "evidence",
    body: "Both futures re-run from the moment the plan was approved, with the same simulator: less circling, fewer emergency fuel diversions and shorter delays than doing nothing. Hover the chart to compare any moment. Synthetic traffic throughout.",
  },
  {
    id: "replay", title: "Every step can be replayed and audited", view: "replay",
    body: "Every input is recorded, so the evening can be replayed exactly, and a tamper-proof log shows who approved what and when. Flights and airlines are synthetic throughout.",
  },
];

/** What to say about each playable scenario, in plain words. */
const STORY: Record<string, { intro: string; before: string; runs: string }> = {
  f_influx: {
    intro: "Six flights heading for other airports are suddenly diverted into Sharjah, the smallest of the three. Its gates are already planned for its own flights, so without coordination aircraft will land to find no gate free.",
    before: "What happens if nobody acts (aircraft land to find their gate taken), the plan the agents built, and the same afternoon with the plan. Below: how it unfolds hour by hour.",
    runs: "The approved plan is running: the violet-turned-teal arrows are aircraft moving to the gates the planning agent found for them.",
  },
};

const RANK = { severe: 0, high: 1, moderate: 2, low: 3 } as const;
/** the scenario's main disruption: the most serious one shared with the network, the earliest on a tie */
const mainIncident = (rt: Runtime): Incident | null =>
  Object.values(rt.world.incidents).filter((i) => i.shared).sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.start - b.start)[0] ?? null;

/** The story arc for any scenario other than Nightfall, built around its main disruption. */
function scenarioSteps(rt: Runtime, story: string): Step[] {
  // until the scenario is loaded (its first step loads it) the story falls back on the catalogue entry
  const def = scenarioById(story);
  const main = rt.scenario.id === story ? mainIncident(rt) : null;
  const text = STORY[story];
  const what = main ? plainIncident(main) : def.title;
  const at = main?.airport ?? def.focus[0];
  const begun = (r: Runtime) => { const i = main && r.world.incidents[main.id]; return Boolean(i && i.status !== "scheduled"); };
  const since = main?.start ?? rt.scenario.start;
  return [
    {
      id: "start", title: main ? `${fmtTime(main.start)} · ${what}` : what, view: "twin", airport: at, camera: "strategic", lighting: "auto", speed: 300,
      enter: (r) => { if (r.scenario.id !== story || r.world.now > r.scenario.start + 60 || Object.keys(r.proposals).length) r.load(story, 7); r.setRunning(false); },
      until: begun, waiting: main ? `Fast-forwarding to ${fmtTime(main.start)}…` : "Fast-forwarding…", done: `${what} has started.`,
      body: text?.intro ?? rt.scenario.summary,
    },
    {
      id: "agents", title: "Watch the agents handle it", view: "agents", speed: 40, compact: true, enter: followMain,
      until: (r) => planReady(r, since) && (useOps.getState().followAt?.done ?? true),
      waiting: "The agents are working; the camera follows each one as it acts…", done: "Everyone except you has answered.",
      body: AGENTS_BODY,
    },
    { id: "plans", title: "Before & after, predicted", view: "evidence", body: text?.before ?? "What happens if nobody acts, the plan the agents built, and the same day with the plan." },
    {
      id: "approve", title: "People decide", view: "workbench", speed: 60, approve: true,
      enter: (r) => { const o = newestOpen(r); if (o) useOps.getState().select({ selectedProposal: o[0] }); },
      until: (r) => { const o = newestOpen(r); return Boolean(o && othersDecided(o[1])); },
      waiting: "Collecting approvals…", done: "Everyone else has approved. The final yes is yours.",
      body: `The airports, airlines and air-traffic control involved have answered. Nothing runs until the national supervisor (you) says yes too.`,
    },
    {
      id: "execute", title: "The plan runs", view: "twin", airport: at, camera: "strategic", speed: 30,
      until: (r) => hasMessage(r, "PlanCommitted"), waiting: "Starting the approved plan…", done: "The plan is running.",
      body: text?.runs ?? `The approved plan is running at ${city(at)}.`,
    },
    {
      id: "evidence", title: "Before & after, approved", view: "evidence",
      body: "Both futures re-run from the moment the plan was approved, with the same simulator. Synthetic traffic throughout.",
    },
  ];
}

export default function Presentation() {
  const { presentation, setPresentation, setView, setAirport, setCamera, setOverlay, runtime, toast } = useOps();
  const [status, setStatus] = useState<"idle" | "waiting" | "done">("idle");
  const [clock, setClock] = useState("");
  const entered = useRef("");
  const phase = useRef<"idle" | "waiting" | "done">("idle");
  const story = presentation.story ?? "nightfall";
  const nightfall = story === "nightfall";
  // a scenario's story is rebuilt once its first step has loaded it (the main disruption then exists)
  const loaded = runtime?.scenario.id;
  const steps = useMemo(() => (nightfall || !runtime ? NIGHTFALL : scenarioSteps(runtime, story)), [nightfall, story, runtime, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const stepsRef = useRef(steps);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
  const step = steps[Math.min(presentation.step, steps.length - 1)];

  const go = useCallback((i: number) => setPresentation({ step: Math.max(0, Math.min(stepsRef.current.length - 1, i)) }), [setPresentation]);
  const exit = useCallback(() => {
    setPresentation({ active: false });
    entered.current = "";
    // outside the story Sharjah answers on its own again
    if (runtime && runtime.stakeholderModes[PHONE_ROLE] === "human") runtime.setStakeholderMode(PHONE_ROLE, "simulated", "NATIONAL_SUPERVISOR");
  }, [setPresentation, runtime]);

  // Sharjah answers on the phone only inside Nightfall's story; anywhere else (another story, or no story) it answers on its own
  useEffect(() => {
    if (runtime && (!presentation.active || !nightfall) && runtime.stakeholderModes[PHONE_ROLE] === "human") {
      runtime.setStakeholderMode(PHONE_ROLE, "simulated", "NATIONAL_SUPERVISOR");
    }
  }, [presentation.active, nightfall, runtime]);

  // enter a step: set the stage, then run the clock until its condition holds
  useEffect(() => {
    if (!presentation.active || !runtime) { entered.current = ""; return; }
    const key = `${story}:${presentation.step}`;
    if (entered.current === key) return;
    entered.current = key;
    const s = steps[Math.min(presentation.step, steps.length - 1)];
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
  }, [presentation.active, presentation.step, story, nightfall, steps, runtime, setAirport, setView, setCamera, setOverlay]);

  // watch the step's condition (polled; React state follows the ref)
  useEffect(() => {
    if (!presentation.active || !runtime) return;
    const id = setInterval(() => {
      setClock(fmtTime(runtime.world.now));
      // in Nightfall, once the fog is in, Sharjah's duty manager answers in person, on the phone, instead of automatically
      if (nightfall && fogActive(runtime) && runtime.stakeholderModes[PHONE_ROLE] !== "human") runtime.setStakeholderMode(PHONE_ROLE, "human", "NATIONAL_SUPERVISOR");
      const s = stepsRef.current[Math.min(presentation.step, stepsRef.current.length - 1)];
      if (s.approve) {
        // the clock runs only while the desks answer, then holds so the plan can't go out of date while the phone
        // and the presenter decide; a "no" from the phone starts it again for the agents to re-plan
        const ready = Boolean(s.until?.(runtime));
        if (ready === runtime.running) runtime.setRunning(!ready);
        phase.current = ready ? "done" : "waiting";
      } else if (phase.current === "waiting" && s.until?.(runtime)) {
        if (s.id !== "execute") runtime.setRunning(false);
        phase.current = "done";
      }
      setStatus(phase.current);
    }, 250);
    return () => clearInterval(id);
  }, [presentation.active, presentation.step, nightfall, runtime]);

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
    if (nightfall && phonePending(o[1])) { toast("Sharjah hasn't answered yet: approve on the phone first", "warn"); return; }
    try {
      runtime.decide(o[0], slot.key, "APPROVED", "Approved during the guided demonstration", "NATIONAL_SUPERVISOR");
      runtime.setSpeed(30);
      runtime.setRunning(true);
      toast(`${o[1].id} v${o[1].version} approved by the National Supervisor`, "ok");
      go(presentation.step + 1);
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  const last = presentation.step === steps.length - 1;
  const statusLine = step.until && (
    <span className={`flex min-w-0 items-center gap-1.5 text-[11.5px] ${status === "waiting" ? "text-[#e0a646]" : "text-[#7fd1bf]"}`}>
      {status === "waiting" ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <Check size={13} className="shrink-0" />}
      <span className="truncate">{status === "waiting" ? step.waiting : typeof step.done === "function" ? step.done(runtime) : step.done}</span>
    </span>
  );
  const nextButton = step.approve
    ? <button className="hud-btn" data-on="true" onClick={approveNow}><ShieldCheck size={13} /> Approve the plan</button>
    : <button className="hud-btn" data-on="true" onClick={() => (last ? exit() : go(presentation.step + 1))}>{last ? "Finish" : "Next"} {!last && <ArrowRight size={13} />}</button>;
  if (step.compact) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        <div className="hud pointer-events-auto flex w-[min(760px,100%)] items-center gap-3 rounded-full py-1.5 pl-2 pr-1.5" style={{ background: "rgba(12, 17, 25, 0.58)" }}>
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[12px] font-semibold">{presentation.step + 1}</div>
          <div className="shrink-0 text-[13px] font-semibold tracking-tight">{step.title}</div>
          {statusLine}
          <div className="ml-auto flex shrink-0 gap-1.5">
            <button className="hud-btn !px-2" disabled={presentation.step === 0} onClick={() => go(presentation.step - 1)} aria-label="Back"><ArrowLeft size={13} /></button>
            {nextButton}
            <button className="hud-btn !px-1.5" onClick={exit} aria-label="Exit presentation" title="Exit (Esc)"><X size={13} /></button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
    {nightfall && step.id === "approve" && <PhoneApproval rt={runtime} />}
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="hud pointer-events-auto w-[min(720px,100%)] overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,0.35)]" style={{ background: "rgba(12, 17, 25, 0.66)" }}>
        <div className="h-[3px] bg-white/10"><div className="h-full bg-[#4fb8a4] transition-all duration-500" style={{ width: `${((presentation.step + 1) / steps.length) * 100}%` }} /></div>
        <div className="flex items-start gap-3 px-4 pb-3 pt-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold">{presentation.step + 1}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-[15px] font-semibold tracking-tight">{step.title}</div>
              <span className="mono ml-auto text-[11px] text-white/50">{clock} GST · synthetic day</span>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/80">{step.body}</p>
            {statusLine && <div className="mt-2">{statusLine}</div>}
          </div>
          <button className="hud-btn !px-1.5" onClick={exit} aria-label="Exit presentation" title="Exit (Esc)"><X size={13} /></button>
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2">
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <button key={s.id} onClick={() => go(i)} title={s.title} aria-label={`Step ${i + 1}: ${s.title}`}>
                <CircleDot size={11} className={i === presentation.step ? "text-white" : i < presentation.step ? "text-[#4fb8a4]" : "text-white/25"} />
              </button>
            ))}
          </div>
          <span className="text-[10.5px] text-white/40">← → to navigate · Esc to exit · you can take over at any time</span>
          <div className="ml-auto flex gap-1.5">
            <button className="hud-btn" disabled={presentation.step === 0} onClick={() => go(presentation.step - 1)}><ArrowLeft size={13} /> Back</button>
            {nextButton}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
