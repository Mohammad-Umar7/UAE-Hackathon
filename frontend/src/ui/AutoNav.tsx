"use client";

import { useEffect, useRef } from "react";
import { proposalKey } from "@/core/agents/orchestrator";
import { isOpen } from "@/core/approvals/workflow";
import { useOps, useRuntime } from "@/store/ops";

/** Disruptions worth showing in 3D the moment they start (the others are handled on the Decision page). */
const SHOW_IN_3D = new Set(["FOG", "THUNDERSTORM", "RUNWAY_CLOSURE"]);

/**
 * Takes the viewer to what just happened instead of leaving them to find it: a serious disruption opens that
 * airport in 3D, a plan that needs the viewer's approval opens the Decision page, and a plan that everyone
 * approved opens Before & after. Each event moves the view once; the guided demo does its own navigation.
 */
export function AutoNav() {
  const rt = useRuntime();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const ui = useOps.getState();
    const events: { id: string; go: () => void }[] = [];
    for (const i of Object.values(rt.world.incidents)) {
      if (i.shared && i.status === "active" && SHOW_IN_3D.has(i.type) && (i.severity === "high" || i.severity === "severe")) {
        events.push({ id: `inc:${i.id}`, go: () => { ui.setAirport(i.airport); ui.setCamera("strategic"); ui.setView("twin"); } });
      }
    }
    for (const p of Object.values(rt.proposals)) {
      const key = proposalKey(p);
      if (isOpen(p) && p.approvals.some((a) => a.key === ui.role && a.decision === "PENDING")) {
        events.push({ id: `ask:${key}`, go: () => { ui.select({ selectedProposal: key }); ui.setView("workbench"); } });
      }
      if (p.status === "COMMITTED") events.push({ id: `done:${key}`, go: () => ui.setView("evidence") });
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
    fresh.at(-1)?.go();
  });
  return null;
}
