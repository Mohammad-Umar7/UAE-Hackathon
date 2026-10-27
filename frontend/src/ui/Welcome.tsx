"use client";

import { ArrowRight, Play, X } from "lucide-react";
import { useEffect } from "react";
import { useOps } from "@/store/ops";

const STEPS = ["Fog rolls in", "AI agents plan", "People approve", "The plan runs"];

/** First screen: one line on what SKYPACT is, the story in four words, and how to watch it — over the UAE map. */
export function Welcome() {
  const { welcome, setWelcome, setPresentation } = useOps();
  useEffect(() => {
    if (!welcome) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setWelcome(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [welcome, setWelcome]);
  if (!welcome) return null;
  return (
    <div className="fade-in pointer-events-none fixed inset-0 z-[60] flex items-end justify-center p-6 pb-10" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="pointer-events-auto relative w-[min(620px,100%)] rounded-2xl border border-white/10 bg-[rgba(10,20,32,0.86)] px-7 pb-6 pt-6 text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-md">
        <button className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white" onClick={() => setWelcome(false)} aria-label="Close"><X size={16} /></button>
        <h1 id="welcome-title" className="text-[24px] font-semibold leading-tight tracking-tight">When fog hits, three airports act as one.</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-white/70">
          SKYPACT watches Abu Dhabi, Dubai and Sharjah. When weather or an incident hits, AI agents build a recovery plan and the people in charge approve it.
        </p>
        <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-white/60">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-[10.5px] font-semibold text-white/80">{i + 1}</span>{s}
              {i < STEPS.length - 1 && <ArrowRight size={12} className="text-white/30" />}
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button className="flex h-11 items-center gap-2 rounded-xl bg-[#5fd4bd] px-5 text-[14px] font-semibold text-[#08201b] hover:bg-[#78e0cb]"
            onClick={() => { setWelcome(false); setPresentation({ active: true, step: 0 }); }}>
            <Play size={15} fill="currentColor" /> Watch the 3-minute demo
          </button>
          <button className="h-11 rounded-xl px-4 text-[14px] font-medium text-white/80 hover:bg-white/10 hover:text-white" onClick={() => setWelcome(false)}>Explore on my own</button>
        </div>
      </div>
    </div>
  );
}
