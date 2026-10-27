"use client";

import { ArrowRight, Boxes, GitCompareArrows, Vote } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { proposalKey } from "@/core/agents/orchestrator";
import { isOpen } from "@/core/approvals/workflow";
import { useOps, useRuntime, type View } from "@/store/ops";
import { city, plainIncident, workflowName } from "./story";

/** Disruptions worth showing in 3D the moment they start (the others are handled on the Decision page). */
const SHOW_IN_3D = new Set(["FOG", "THUNDERSTORM", "RUNWAY_CLOSURE"]);
/** How long the notice stays up before the page changes, so the switch never comes as a surprise. */
const WAIT_MS = 3000;

interface Redirect { id: string; view: View; airport?: string; title: string; reason: string; go: () => void }

const ICON: Partial<Record<View, typeof Vote>> = { twin: Boxes, workbench: Vote, evidence: GitCompareArrows };

/**
 * Takes the viewer to what just happened instead of leaving them to find it: a serious disruption opens that
 * airport in 3D, a plan that needs the viewer's approval opens the Decision page, and a plan that everyone
 * approved opens Before & after. A short notice says where and why first. Each event moves the view once; the
 * guided demo does its own navigation.
 */
export function AutoNav() {
  const rt = useRuntime();
  const version = useOps((s) => s.version);
  const seen = useRef<Set<string> | null>(null);
  const [next, setNext] = useState<Redirect | null>(null);
  const clear = useCallback(() => setNext(null), []);

  useEffect(() => {
    const ui = useOps.getState();
    const events: Redirect[] = [];
    for (const i of Object.values(rt.world.incidents)) {
      if (i.shared && i.status === "active" && SHOW_IN_3D.has(i.type) && (i.severity === "high" || i.severity === "severe")) {
        events.push({ id: `inc:${i.id}`, view: "twin", airport: i.airport, title: `Opening ${city(i.airport)} in 3D`, reason: `${plainIncident(i)} has just started.`,
          go: () => { ui.setAirport(i.airport); ui.setCamera("strategic"); ui.setView("twin"); } });
      }
    }
    for (const p of Object.values(rt.proposals)) {
      const key = proposalKey(p);
      const wf = rt.orchestrator.workflows.find((w) => w.id === p.thread);
      const name = wf ? workflowName(rt, wf) : "";
      // mid-sentence: lower-case only the first letter ("thick fog at Abu Dhabi")
      const what = name ? name.charAt(0).toLowerCase() + name.slice(1) : "the disruption";
      if (isOpen(p) && p.approvals.some((a) => a.key === ui.role && a.decision === "PENDING")) {
        events.push({ id: `ask:${key}`, view: "workbench", title: "Opening the Decision page", reason: `A recovery plan for ${what} needs your approval.`,
          go: () => { ui.select({ selectedProposal: key }); ui.setView("workbench"); } });
      }
      if (p.status === "COMMITTED") {
        events.push({ id: `done:${key}`, view: "evidence", title: "Opening Before & after", reason: `Everyone approved the plan for ${what}: see what it changes.`, go: () => ui.setView("evidence") });
      }
    }
    // whatever is already true when the app opens (or when the demo hands back) is not news
    if (!seen.current || ui.presentation.active || ui.intro !== "done" || ui.welcome) {
      seen.current ??= new Set();
      for (const e of events) seen.current.add(e.id);
      return;
    }
    const fresh = events.filter((e) => !seen.current!.has(e.id));
    for (const e of fresh) seen.current.add(e.id);
    // several at once (a plan committed and the next one asking): the last one is where things now stand
    const e = fresh.at(-1);
    if (!e) return;
    // already there: update in place, nothing to announce
    if (ui.view === e.view && (!e.airport || ui.airport === e.airport)) { e.go(); return; }
    setNext(e);
  }, [rt, version]);

  return next ? <Notice key={next.id} r={next} onDone={clear} /> : null;
}

function Notice({ r, onDone }: { r: Redirect; onDone: () => void }) {
  const [left, setLeft] = useState(WAIT_MS);
  const demo = useOps((s) => s.presentation.active);
  useEffect(() => {
    if (demo) { onDone(); return; }
    const t0 = performance.now();
    const id = setInterval(() => {
      const l = WAIT_MS - (performance.now() - t0);
      if (l <= 0) { clearInterval(id); r.go(); onDone(); } else setLeft(l);
    }, 50);
    return () => clearInterval(id);
  }, [r, onDone, demo]);
  const Icon = ICON[r.view] ?? ArrowRight;
  return (
    <div className="fade-in fixed left-1/2 top-[104px] z-[55] w-[min(440px,calc(100%-32px))] -translate-x-1/2" role="status" aria-live="polite">
      <div className="hud overflow-hidden">
        <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-[#8fe3d2]"><Icon size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">{r.title} in {Math.ceil(left / 1000)}…</div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-white/70">{r.reason}</p>
            <div className="mt-2.5 flex gap-2">
              <button className="hud-btn h-7 bg-[#5fd4bd] px-3 font-semibold text-[#08201b] hover:bg-[#78e0cb]" onClick={() => { r.go(); onDone(); }}>Go now</button>
              <button className="hud-btn h-7 px-3" onClick={onDone}>Stay here</button>
            </div>
          </div>
        </div>
        <div className="h-[3px] bg-white/10"><div className="h-full bg-[#5fd4bd]" style={{ width: `${(100 * (WAIT_MS - left)) / WAIT_MS}%` }} /></div>
      </div>
    </div>
  );
}
