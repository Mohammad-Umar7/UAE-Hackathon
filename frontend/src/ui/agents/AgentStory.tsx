"use client";

import { useEffect, useRef } from "react";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { agentStory, type StoryStep } from "../story";

/**
 * What the agents did, told as a story in plain words. Hovering a line reports the agents it involves (the
 * scene lights them up); clicking opens the recorded message behind it; `activeId` marks the step being replayed.
 */
export function AgentStory({ thread, limit, from, activeId, onHover }: {
  thread: string | null;
  limit?: number;
  /** only steps started by this agent */
  from?: string;
  activeId?: string | null;
  onHover?: (s: StoryStep | null) => void;
}) {
  const rt = useRuntime();
  const setInspect = useOps((s) => s.setInspect);
  const steps = agentStory(rt, thread).filter((s) => !from || s.from === from);
  const shown = limit ? steps.slice(-limit) : steps;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const act = activeId ? el.querySelector<HTMLElement>(`[data-step="${activeId}"]`) : null;
    // scroll only this list (never the panels around it)
    if (act) el.scrollTop = act.offsetTop - el.clientHeight / 2 + act.clientHeight / 2;
    else el.scrollTop = el.scrollHeight;
  }, [shown.length, activeId]);
  if (!shown.length) {
    return <div className="p-6 text-center text-[12.5px] text-muted">{from ? "This one has not had anything to do yet." : "Nothing yet. The agents start working as soon as something goes wrong — run the clock to see them."}</div>;
  }
  return (
    <div ref={box} className="scroll-y relative h-full">
      <ol className="px-3 py-2.5">
        {shown.map((s, k) => {
          const active = s.id === activeId;
          return (
            <li key={s.id} data-step={s.id} className="relative flex gap-2.5">
              <div className="flex flex-col items-center">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${active ? "ring-4" : ""}`} style={{ background: s.color, ["--tw-ring-color" as string]: `color-mix(in oklab, ${s.color} 30%, transparent)` }} />
                {k < shown.length - 1 && <span className="w-px flex-1 bg-line-2" />}
              </div>
              <button className={`mb-2 min-w-0 flex-1 rounded-md px-1.5 py-1 text-left transition-colors ${active ? "bg-navy-soft" : "hover:bg-bg-2"}`}
                onClick={() => setInspect({ kind: "message", id: s.id })} onMouseEnter={() => onHover?.(s)} onMouseLeave={() => onHover?.(null)}
                title="Open the recorded message">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold" style={{ color: s.color }}>{s.who}</span>
                  <span className="mono text-[10.5px] text-faint">{fmtTime(s.t)}</span>
                </div>
                <p className={`text-[12.5px] leading-snug ${s.tone === "bad" ? "text-[var(--red)]" : s.tone === "good" ? "text-[var(--teal)]" : "text-ink-2"}`}>{s.text}</p>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
