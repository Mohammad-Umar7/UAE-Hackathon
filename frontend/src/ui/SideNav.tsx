"use client";

import { Boxes, ChartColumnBig, FlaskConical, HistoryIcon as History, LayoutDashboard, Network, SquareChartGantt, Workflow } from "lucide-react";
import { isOpen } from "@/core/approvals/workflow";
import { useOps, useRuntime, type View } from "@/store/ops";

const ITEMS: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "command", label: "Command", icon: LayoutDashboard },
  { id: "twin", label: "Digital twin", icon: Boxes },
  { id: "workbench", label: "Recovery", icon: Workflow },
  { id: "agents", label: "Agents", icon: Network },
  { id: "timeline", label: "Stands", icon: SquareChartGantt },
  { id: "lab", label: "Scenario lab", icon: FlaskConical },
  { id: "evidence", label: "Evidence", icon: ChartColumnBig },
  { id: "replay", label: "Replay", icon: History },
];

export function SideNav() {
  const rt = useRuntime();
  const { view, setView } = useOps();
  const pending = Object.values(rt.proposals).filter(isOpen).length;
  const working = rt.orchestrator.computing !== null || rt.held;
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-stretch gap-0.5 border-r border-line bg-panel px-1.5 py-2">
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const active = view === id;
        const badge = id === "workbench" && pending ? pending : null;
        return (
          <button key={id} onClick={() => setView(id)}
            className={`group relative flex flex-col items-center gap-1 rounded-lg px-1 py-2 transition-colors ${active ? "bg-navy-soft text-navy" : "text-muted hover:bg-bg-2 hover:text-ink"}`}>
            {active && <span className="absolute left-[-6px] top-2 bottom-2 w-[3px] rounded-r bg-navy" />}
            <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
            <span className="text-[10px] font-medium leading-none">{label}</span>
            {badge ? <span className="absolute right-1.5 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--amber)] px-1 text-[9.5px] font-bold text-white">{badge}</span> : null}
            {id === "agents" && working ? <span className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-[var(--teal)]" style={{ boxShadow: "0 0 0 3px var(--teal-soft)" }} /> : null}
          </button>
        );
      })}
      <div className="mt-auto px-1 pb-1 text-center text-[9.5px] leading-tight text-faint">
        Decision support<br />simulation only
      </div>
    </nav>
  );
}
