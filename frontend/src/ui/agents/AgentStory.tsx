"use client";

import { useEffect, useRef } from "react";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { agentStory } from "../story";

/** What the agents did, told as a story in plain words; each line opens the recorded message behind it. */
export function AgentStory({ thread, limit }: { thread: string | null; limit?: number }) {
  const rt = useRuntime();
  const setInspect = useOps((s) => s.setInspect);
  const steps = agentStory(rt, thread);
  const shown = limit ? steps.slice(-limit) : steps;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown.length]);
  if (!shown.length) {
    return <div className="p-6 text-center text-[12.5px] text-muted">Nothing yet. The agents start working as soon as something goes wrong — run the clock to see them.</div>;
  }
  return (
    <div ref={box} className="scroll-y h-full">
      <ol className="px-3 py-2.5">
        {shown.map((s, k) => (
          <li key={s.id} className="relative flex gap-2.5">
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              {k < shown.length - 1 && <span className="w-px flex-1 bg-line-2" />}
            </div>
            <button className="mb-2.5 min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-left hover:bg-bg-2" onClick={() => setInspect({ kind: "message", id: s.id })} title="Open the recorded message">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] font-semibold" style={{ color: s.color }}>{s.who}</span>
                <span className="mono text-[10.5px] text-faint">{fmtTime(s.t)}</span>
              </div>
              <p className={`text-[12.5px] leading-snug ${s.tone === "bad" ? "text-[var(--red)]" : s.tone === "good" ? "text-[var(--teal)]" : "text-ink-2"}`}>{s.text}</p>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
