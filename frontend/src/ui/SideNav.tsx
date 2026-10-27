"use client";

import { Boxes, ChartColumnBig, CircleHelp, FlaskConical, HistoryIcon as History, LayoutDashboard, Network, SquareChartGantt, Vote } from "lucide-react";
import { isOpen } from "@/core/approvals/workflow";
import { useOps, useRuntime, type View } from "@/store/ops";

type Item = { id: View; label: string; icon: typeof LayoutDashboard; hint: string };

// the five views that tell the story, in the order it happens; the rest are for a closer look
const MAIN: Item[] = [
  { id: "command", label: "Overview", icon: LayoutDashboard, hint: "The three airports on one map: traffic, weather and what needs a decision" },
  { id: "twin", label: "3D airport", icon: Boxes, hint: "Each airport in 3D, driven by the live simulation" },
  { id: "agents", label: "AI agents", icon: Network, hint: "What the seven agents did, step by step" },
  { id: "workbench", label: "Decision", icon: Vote, hint: "The recovery plan, what it changes, and the approvals it needs" },
  { id: "evidence", label: "Results", icon: ChartColumnBig, hint: "The approved plan measured against doing nothing" },
];
const MORE: Item[] = [
  { id: "timeline", label: "Gate plan", icon: SquareChartGantt, hint: "Which aircraft is at which gate, hour by hour" },
  { id: "lab", label: "Scenarios", icon: FlaskConical, hint: "Start another scenario or add a disruption yourself" },
  { id: "replay", label: "Replay", icon: History, hint: "Replay the evening exactly from the recorded inputs" },
];

export function SideNav() {
  const rt = useRuntime();
  const { view, setView, detail, setDetail, setWelcome } = useOps();
  const pending = Object.values(rt.proposals).filter(isOpen).length;
  const working = rt.orchestrator.computing !== null || rt.held;
  const button = ({ id, label, icon: Icon, hint }: Item, small = false) => {
    const active = view === id;
    const badge = id === "workbench" && pending ? pending : null;
    return (
      <button key={id} onClick={() => setView(id)} title={hint}
        className={`group relative flex flex-col items-center gap-1 rounded-lg px-1 ${small ? "py-1.5" : "py-2"} transition-colors ${active ? "bg-navy-soft text-navy" : "text-muted hover:bg-bg-2 hover:text-ink"}`}>
        {active && <span className="absolute bottom-2 left-[-6px] top-2 w-[3px] rounded-r bg-navy" />}
        <Icon size={small ? 16 : 18} strokeWidth={active ? 2.2 : 1.8} />
        <span className={`${small ? "text-[9.5px]" : "text-[10px]"} font-medium leading-none`}>{label}</span>
        {badge ? <span className="absolute right-1.5 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--amber)] px-1 text-[9.5px] font-bold text-white">{badge}</span> : null}
        {id === "agents" && working ? <span className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-[var(--teal)]" style={{ boxShadow: "0 0 0 3px var(--teal-soft)" }} /> : null}
      </button>
    );
  };
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-stretch gap-0.5 border-r border-line bg-panel px-1.5 py-2">
      {MAIN.map((i) => button(i))}
      <div className="mx-2 mb-1 mt-2 border-t border-line pt-1.5 text-center text-[9px] font-semibold uppercase tracking-wider text-faint">More</div>
      {MORE.map((i) => button(i, true))}
      <div className="mt-auto flex flex-col items-stretch gap-1.5 px-0.5 pb-1">
        <button className="flex flex-col items-center gap-1 rounded-lg py-1.5 text-muted hover:bg-bg-2 hover:text-ink" onClick={() => setWelcome(true)} title="What is SKYPACT and how to watch the demo">
          <CircleHelp size={16} />
          <span className="text-[9.5px] font-medium leading-none">Guide</span>
        </button>
        <div className="rounded-lg border border-line bg-bg-2 p-0.5" title="Simple shows the story in plain words; Expert adds every number, log and table">
          {(["simple", "expert"] as const).map((d) => (
            <button key={d} onClick={() => setDetail(d)}
              className={`block w-full rounded-md py-1 text-[9.5px] font-semibold capitalize ${detail === d ? "bg-panel text-ink shadow-[var(--shadow)]" : "text-muted hover:text-ink"}`}>
              {d}
            </button>
          ))}
        </div>
        <div className="text-center text-[9px] leading-tight text-faint">Simulation only</div>
      </div>
    </nav>
  );
}
