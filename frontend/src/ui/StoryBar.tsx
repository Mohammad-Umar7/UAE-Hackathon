"use client";

import { ArrowRight, CircleCheck, CircleDot, Loader2, TriangleAlert, UserCheck } from "lucide-react";
import { useOps, useRuntime } from "@/store/ops";
import { storyNow, type Go, type Tone } from "./story";

const TONE: Record<Tone, { icon: typeof CircleDot; color: string; bg: string }> = {
  calm: { icon: CircleDot, color: "var(--teal)", bg: "var(--panel)" },
  alert: { icon: TriangleAlert, color: "var(--red)", bg: "color-mix(in oklab, var(--red-soft) 55%, var(--panel))" },
  work: { icon: Loader2, color: "var(--blue)", bg: "color-mix(in oklab, var(--blue-soft) 55%, var(--panel))" },
  action: { icon: UserCheck, color: "var(--amber)", bg: "color-mix(in oklab, var(--amber-soft) 60%, var(--panel))" },
  done: { icon: CircleCheck, color: "var(--teal)", bg: "color-mix(in oklab, var(--teal-soft) 55%, var(--panel))" },
};

/** One line, on every view, saying what is happening and what to do next. */
export function StoryBar() {
  const rt = useRuntime();
  const { role, setView, setPresentation } = useOps();
  const s = storyNow(rt, role);
  const t = TONE[s.tone];
  const Icon = t.icon;
  const go = (g: Go) => {
    if (g === "run") rt.setRunning(true);
    else if (g === "demo") setPresentation({ active: true, step: 0 });
    else setView(g);
  };
  return (
    <div className="glass flex h-[38px] shrink-0 items-center gap-2.5 border-b border-line px-4" style={{ background: t.bg }}>
      <Icon size={15} className={s.tone === "work" ? "animate-spin" : ""} style={{ color: t.color }} />
      <span className="eyebrow" style={{ color: t.color }}>Now</span>
      <p className="min-w-0 flex-1 truncate text-[13px] text-ink" title={s.text}>{s.text}</p>
      {s.cta && (
        <button className={`btn btn-sm shrink-0 ${s.tone === "action" ? "btn-primary" : ""}`} onClick={() => go(s.cta!.go)}>
          {s.cta.label} <ArrowRight size={12} />
        </button>
      )}
    </div>
  );
}
