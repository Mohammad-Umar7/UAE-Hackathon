"use client";

import { Plane, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import { PROFILES } from "@/core/airports/profiles";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { plainIncident } from "../story";

const NationalMap = dynamic(() => import("@/three/NationalMap").then((m) => m.NationalMap), { ssr: false });

export default function CommandView() {
  const rt = useRuntime();
  const expert = useOps((s) => s.detail === "expert");
  const intro = useOps((s) => s.intro);
  const incidents = Object.values(rt.world.incidents).filter((i) => i.shared && i.status === "active");
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] border border-line bg-[#0b1622]">
        <NationalMap rt={rt} />
        <div className={`pointer-events-none absolute left-4 top-4 flex flex-col gap-2 transition-opacity duration-700 ${intro === "done" ? "opacity-100" : "opacity-0"}`}>
          <div className="hud px-3.5 py-2.5">
            <div className="text-[15px] font-semibold tracking-tight">Abu Dhabi · Dubai · Sharjah</div>
            <div className="muted text-[11.5px]">Three airports that back each other up. Click one to see it in 3D.</div>
          </div>
          {incidents.length > 0 && (
            <div className="hud max-w-[380px] border-l-[3px] border-l-[#e57373] px-3.5 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#ef8a8a]">
                <TriangleAlert size={13} /> {expert ? `${incidents.length} active disruption${incidents.length > 1 ? "s" : ""}` : "What's wrong right now"}
              </div>
              {incidents.slice(0, 3).map((i) => <div key={i.id} className="text-[12.5px] leading-snug">{expert ? i.title : plainIncident(i)} <span className="muted">· until {fmtTime(i.end)}</span></div>)}
            </div>
          )}
        </div>
        <div className={`hud absolute bottom-4 left-4 flex items-center gap-3 px-3 py-1.5 text-[11px] transition-opacity duration-700 ${intro === "done" ? "opacity-100" : "opacity-0"}`}>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#a9c4e6]" /> landing soon</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#7f93a8]" /> on the way</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#e0a646]" /> circling or diverting</span>
        </div>
        {expert && <div className="hud absolute bottom-4 right-4 px-2.5 py-1.5 text-[10px]"><span className="muted">Basemap: OSM land polygons (ODbL) / Natural Earth · scale 1:1 km</span></div>}
      </div>
      {expert && <Strip />}
    </div>
  );
}

function Strip() {
  const rt = useRuntime();
  const start = rt.scenario.start, end = rt.scenario.start + rt.scenario.duration;
  const x = (t: number) => `${(100 * (Math.min(end, Math.max(start, t)) - start)) / (end - start)}%`;
  const incs = Object.values(rt.world.incidents).filter((i) => i.shared || i.status === "active");
  const marks = rt.orchestrator.messages.filter((m) => ["PlanCandidates", "PlanCommitted", "PlanInvalidated", "LocalInformationShared"].includes(m.type));
  return (
    <div className="panel px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
        <Plane size={12} /> Operations timeline <span className="mono">{fmtTime(start)}–{fmtTime(end)}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[color-mix(in_oklab,var(--red)_45%,transparent)]" /> incident</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-navy" /> plan</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--teal)]" /> committed</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--red)]" /> invalidated</span>
        </span>
      </div>
      <div className="relative h-[54px]">
        {Object.keys(rt.airports).map((icao, row) => (
          <div key={icao} className="absolute left-0 right-0 flex items-center" style={{ top: row * 17 }}>
            <span className="mono w-9 text-[10px] text-muted">{PROFILES[icao].iata}</span>
            <div className="relative h-3 flex-1 rounded bg-bg-2">
              {incs.filter((i) => i.airport === icao).map((i) => <div key={i.id} title={i.title} className="absolute top-0 h-3 rounded bg-[color-mix(in_oklab,var(--red)_45%,transparent)]" style={{ left: x(i.start), width: `calc(${x(i.end)} - ${x(i.start)})` }} />)}
            </div>
          </div>
        ))}
        <div className="absolute bottom-0 left-9 right-0 top-0">
          {marks.map((m) => <span key={m.id} className={`absolute top-[46px] h-2 w-2 -translate-x-1/2 rounded-full ${m.type === "PlanCommitted" ? "bg-[var(--teal)]" : m.type === "PlanInvalidated" ? "bg-[var(--red)]" : "bg-navy"}`} style={{ left: x(m.t) }} />)}
          <div className="absolute bottom-0 top-0 w-px bg-[var(--red)]" style={{ left: x(rt.world.now) }} />
        </div>
      </div>
    </div>
  );
}
