"use client";

import { CloudFog, Play, PlaneLanding } from "lucide-react";
import { useOps, useRuntime } from "@/store/ops";

/** The scenarios worth watching: each one changes the outcome a lot when the airports act together. */
const PLAYABLE = [
  {
    id: "nightfall", icon: CloudFog, title: "Thick fog at Abu Dhabi", when: "18:00 · evening rush", where: "Abu Dhabi, with Dubai and Sharjah as backups",
    what: "Fog cuts Abu Dhabi from 30 landings an hour to 12. Planes start circling, and without a plan dozens of crews run low on fuel and divert wherever they can.",
    impact: "Without SKYPACT about 30 low-fuel diversions in four hours; with it, a handful.",
  },
  {
    id: "f_influx", icon: PlaneLanding, title: "Unexpected diversions into Sharjah", when: "15:25 · afternoon", where: "Sharjah, the smallest of the three",
    what: "Six flights bound elsewhere are suddenly sent to Sharjah. Its gates are already planned, so aircraft land to find no gate free unless someone re-plans.",
    impact: "Without SKYPACT about 9 aircraft land to find their gate taken; with it, none.",
  },
];

/** Simple mode's Scenarios page: two disruptions with real impact, each played as a guided story. */
export function ScenarioPicker() {
  const rt = useRuntime();
  const setPresentation = useOps((s) => s.setPresentation);
  const play = (id: string) => {
    rt.setRunning(false);
    // the story loads the scenario fresh, flies to the airport and runs the clock to the disruption
    setPresentation({ active: false });
    setTimeout(() => setPresentation({ active: true, step: 0, story: id }), 0);
  };
  return (
    <div className="scroll-y h-full p-6">
      <div className="mx-auto max-w-[980px]">
        <h1 className="text-[22px] font-semibold tracking-tight">Pick a disruption to watch</h1>
        <p className="mt-1 max-w-[720px] text-[13.5px] leading-relaxed text-muted">
          Each one plays as a short story: the problem starts at the airport, the AI agents work it out step by step, people approve,
          and you see what changed against doing nothing. Everything runs live in this browser.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {PLAYABLE.map((s) => {
            const Icon = s.icon;
            const current = rt.scenario.id === s.id;
            return (
              <div key={s.id} className="panel flex flex-col overflow-hidden">
                <div className="flex items-start gap-3 p-5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-soft text-navy"><Icon size={22} /></span>
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-semibold tracking-tight">{s.title}</h2>
                    <div className="mt-0.5 text-[12px] text-muted">{s.when} · {s.where}</div>
                  </div>
                  {current && <span className="pill pill-teal ml-auto shrink-0">loaded now</span>}
                </div>
                <p className="px-5 text-[13px] leading-relaxed text-ink-2">{s.what}</p>
                <p className="mx-5 mt-3 rounded-lg bg-teal-soft px-3 py-2 text-[12.5px] font-medium text-[var(--teal)]">{s.impact}</p>
                <div className="mt-auto p-5 pt-4">
                  <button className="btn btn-primary h-10 px-4 text-[13.5px]" onClick={() => play(s.id)}><Play size={15} fill="currentColor" /> Watch it happen</button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-[11.5px] text-faint">
          Flights and airlines are synthetic. Switch to Expert (bottom left) for the full scenario lab: more scenarios, seeds, and adding disruptions yourself.
        </p>
      </div>
    </div>
  );
}
