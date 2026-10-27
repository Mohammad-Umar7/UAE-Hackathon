"use client";

import { Wrench } from "lucide-react";
import { useEffect, useRef } from "react";
import { AGENTS } from "@/core/agents/definitions";
import type { AgentAction, AgentMessage } from "@/core/agents/types";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { TYPE_TONE } from "./model";

type Row = { kind: "message"; m: AgentMessage; seq: number } | { kind: "action"; a: AgentAction; seq: number };

export function participantLabel(m: AgentMessage): string {
  if (m.fromLabel) return m.fromLabel;
  if (m.from in AGENTS) return AGENTS[m.from as keyof typeof AGENTS].short;
  return m.from === "supervisor" ? "Supervisor" : m.from;
}

export function participantColor(from: string): string {
  if (from in AGENTS) return AGENTS[from as keyof typeof AGENTS].color;
  return "#1d3557";
}

export function CoordinationLog({ thread, showActions = true, compact = false, limit = 400 }: { thread: string | null; showActions?: boolean; compact?: boolean; limit?: number }) {
  const rt = useRuntime();
  const { setInspect, inspect } = useOps();
  const o = rt.orchestrator;
  const rows: Row[] = [];
  o.messages.forEach((m) => { if (!thread || m.thread === thread) rows.push({ kind: "message", m, seq: m.wall * 10 + 1 }); });
  if (showActions) o.actions.forEach((a) => { if (!thread || a.thread === thread) rows.push({ kind: "action", a, seq: a.wall * 10 }); });
  rows.sort((x, y) => x.seq - y.seq);
  const shown = rows.slice(-limit);
  const stick = useRef(true);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // scroll only the log itself (scrollIntoView would also scroll the panels that contain it)
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown.length]);
  return (
    <div ref={box} className="scroll-y h-full" onScroll={(e) => {
      const el = e.currentTarget;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    }}>
      {shown.length === 0 && <div className="p-6 text-center text-muted">No agent activity yet — start the clock to let the scenario unfold.</div>}
      <ol className="relative">
        {shown.map((r) => {
          if (r.kind === "action") {
            const a = r.a;
            const sel = inspect?.kind === "action" && inspect.id === a.id;
            return (
              <li key={a.id} onClick={() => setInspect({ kind: "action", id: a.id })}
                className={`group flex cursor-pointer gap-2 border-b border-line px-3 ${compact ? "py-1" : "py-1.5"} pl-8 hover:bg-bg-2 ${sel ? "bg-navy-soft" : ""}`}>
                <Wrench size={11} className="mt-[3px] shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-semibold" style={{ color: AGENTS[a.agent].color }}>{AGENTS[a.agent].short}</span>
                    <span className="mono text-ink-2">{a.tool}()</span>
                    <span className={`mono ml-auto shrink-0 text-[10.5px] ${a.status === "ok" ? "text-faint" : "text-[var(--red)]"}`}>{a.durationMs < 1 ? "<1" : a.durationMs.toFixed(a.durationMs < 10 ? 1 : 0)} ms</span>
                  </div>
                  {!compact && <div className="truncate text-[11px] text-muted">{a.summary}</div>}
                </div>
              </li>
            );
          }
          const m = r.m;
          const sel = inspect?.kind === "message" && inspect.id === m.id;
          return (
            <li key={m.id} onClick={() => setInspect({ kind: "message", id: m.id })}
              className={`fade-in flex cursor-pointer gap-2.5 border-b border-line px-3 ${compact ? "py-1.5" : "py-2"} hover:bg-bg-2 ${sel ? "bg-navy-soft" : ""}`}>
              <div className="w-[52px] shrink-0 pt-[1px]">
                <div className="mono text-[11px] font-medium text-ink-2">{fmtTime(m.t, true)}</div>
                <div className="text-[9.5px] text-faint">{m.thread}</div>
              </div>
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: participantColor(m.from) }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[11.5px] font-semibold">{participantLabel(m)}</span>
                  <span className="pill shrink-0" style={{ background: `color-mix(in oklab, ${TYPE_TONE[m.type] ?? "#1d3557"} 12%, transparent)`, color: TYPE_TONE[m.type] ?? "var(--navy)", height: 18, fontSize: 10 }}>{m.type}</span>
                </div>
                <div className={`text-[12px] leading-snug text-ink-2 ${compact ? "line-clamp-2" : ""}`}>{m.summary}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
