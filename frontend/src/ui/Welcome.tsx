"use client";

import { CloudFog, Compass, Network, PlaneLanding, Play, UserCheck, X } from "lucide-react";
import { useEffect } from "react";
import { useOps } from "@/store/ops";
import { Logo } from "./Logo";

const STEPS = [
  { icon: CloudFog, title: "Fog rolls in", text: "At 18:00 thick fog forms at Abu Dhabi. Planes must land further apart, so many circle and wait." },
  { icon: Network, title: "AI agents plan", text: "Seven software agents spot it, predict the knock-on effects and build a recovery plan for all three airports." },
  { icon: UserCheck, title: "People decide", text: "Airports, airlines, air-traffic control and the national supervisor approve or reject. Nothing happens without them." },
  { icon: PlaneLanding, title: "The plan runs", text: "Aircraft move to new gates or land at a nearby airport, and the result is measured against doing nothing." },
];

/** First screen: what SKYPACT is, the story the demo tells, and how to watch it. */
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
    <div className="fade-in fixed inset-0 z-[60] grid place-items-center bg-[rgba(8,14,22,0.55)] p-4 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="panel w-[min(780px,100%)] overflow-hidden shadow-[var(--shadow-2)]">
        <div className="flex items-start gap-3 px-6 pb-2 pt-5">
          <Logo size={34} />
          <div className="min-w-0 flex-1">
            <h1 id="welcome-title" className="text-[20px] font-semibold tracking-tight">When fog hits, three airports have to act as one</h1>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
              SKYPACT is a prototype for the UAE&apos;s national airport operations centre. AI agents watch Abu Dhabi, Dubai and
              Sharjah, plan a recovery when weather or an incident disrupts them, and ask the people in charge to approve it.
            </p>
          </div>
          <button className="btn btn-ghost h-8 w-8 shrink-0 justify-center !px-0" onClick={() => setWelcome(false)} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="eyebrow px-6 pt-3">The story you&apos;ll watch</div>
        <ol className="grid grid-cols-2 gap-3 px-6 pb-2 pt-2 md:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="rounded-lg border border-line bg-panel-2 p-3">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy-soft text-navy"><Icon size={15} /></span>
                <span className="text-[12.5px] font-semibold"><span className="text-faint">{i + 1}.</span> {title}</span>
              </div>
              <p className="mt-1.5 text-[12px] leading-snug text-muted">{text}</p>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2 px-6 pb-5 pt-3">
          <button className="btn btn-primary h-10 px-4 text-[13.5px]" onClick={() => { setWelcome(false); setPresentation({ active: true, step: 0 }); }}>
            <Play size={15} /> Watch the guided demo · 3 min
          </button>
          <button className="btn h-10 px-4 text-[13.5px]" onClick={() => setWelcome(false)}><Compass size={15} /> Explore on my own</button>
          <span className="ml-auto max-w-[300px] text-right text-[11px] leading-snug text-faint">
            Synthetic flights and fictional airlines on real airport maps (OpenStreetMap). Runs entirely in this browser.
          </span>
        </div>
      </div>
    </div>
  );
}
