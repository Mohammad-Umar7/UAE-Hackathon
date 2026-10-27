"use client";

import { ArrowUpRight, CloudFog, CloudLightning, CloudRain, Plane, Sun, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import { PROFILES } from "@/core/airports/profiles";
import { isOpen } from "@/core/approvals/workflow";
import { metar } from "@/core/sim/weather";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { AgentStory } from "../agents/AgentStory";
import { CoordinationLog } from "../agents/CoordinationLog";
import { STATUS_PILL } from "../common/format";
import { approvalState, plainIncident, planShort, plainWeather } from "../story";

const NationalMap = dynamic(() => import("@/three/NationalMap").then((m) => m.NationalMap), { ssr: false });

export default function CommandView() {
  const rt = useRuntime();
  const { setView, select, role } = useOps();
  const expert = useOps((s) => s.detail === "expert");
  const pending = Object.entries(rt.proposals).filter(([, p]) => isOpen(p));
  const incidents = Object.values(rt.world.incidents).filter((i) => i.shared && i.status === "active");
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_400px] gap-3 p-3">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] border border-line bg-[#0b1622]">
          <NationalMap rt={rt} />
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
            <div className="hud pointer-events-auto px-3 py-2">
              <div className="text-[13px] font-semibold">UAE three-airport network</div>
              <div className="muted text-[11px]">{expert ? "Zayed International · Dubai International · Sharjah International" : "Abu Dhabi · Dubai · Sharjah — each other's backup airports"}</div>
            </div>
            {incidents.length > 0 && (
              <div className="hud pointer-events-auto max-w-[360px] px-3 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#e57373]">
                  <TriangleAlert size={12} /> {expert ? `${incidents.length} active disruption${incidents.length > 1 ? "s" : ""}` : "What's wrong right now"}
                </div>
                {incidents.slice(0, 4).map((i) => <div key={i.id} className="text-[11.5px] leading-snug">{expert ? i.title : plainIncident(i)} <span className="muted">· until {fmtTime(i.end)}</span></div>)}
              </div>
            )}
          </div>
          <div className="hud absolute bottom-3 left-3 flex items-center gap-3 px-3 py-1.5 text-[10.5px]">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#a9c4e6]" /> {expert ? "on approach" : "landing soon"}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#7f93a8]" /> {expert ? "inbound" : "on the way"}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#e0a646]" /> {expert ? "holding / diverting" : "circling or diverting"}</span>
            {expert && <span className="muted">· traffic positions are derived from simulated ETAs on synthetic routes</span>}
          </div>
          {expert && <div className="hud absolute bottom-3 right-3 px-2.5 py-1.5 text-[10px]"><span className="muted">Basemap: OSM land polygons (ODbL) / Natural Earth · scale 1:1 km</span></div>}
        </div>
        {expert && <Strip />}
      </div>
      <div className="scroll-y flex min-h-0 flex-col gap-3">
        {Object.keys(rt.airports).map((icao) => <AirportCard key={icao} icao={icao} expert={expert} />)}
        <div className="panel shrink-0 overflow-hidden">
          <div className="panel-h">
            <div className="panel-t">{expert ? "Recovery alerts" : "Needs a decision"}</div>
            <button className="btn btn-sm" onClick={() => setView("workbench")}>{expert ? "Open workbench" : "Open decision"} <ArrowUpRight size={12} /></button>
          </div>
          {pending.length === 0 && <div className="px-3 py-3 text-[12px] text-muted">{expert ? "No proposal awaiting approval." : "Nothing right now — the agents will bring a plan here when they have one."}</div>}
          {pending.slice(0, 3).map(([k, p]) => {
            const a = approvalState(p, role);
            return (
              <button key={k} className="flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left hover:bg-bg-2" onClick={() => { select({ selectedProposal: k }); setView("workbench"); }}>
                <span className={`pill ${STATUS_PILL[p.status]}`}>{expert ? p.status.toLowerCase() : "waiting"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold">{expert ? `${p.id} v${p.version} · ${p.label}` : `Recovery plan: ${planShort(p)}`}</span>
                  <span className="block text-[11px] text-muted">
                    {expert
                      ? `${p.plan.decisions.length} actions · ${((n) => `${n} approval${n === 1 ? "" : "s"} pending`)(p.approvals.filter((x) => x.decision === "PENDING").length)}`
                      : `${a.done} of ${a.total} approved${a.mine ? " · your approval is needed" : ""}`}
                    {p.decisionDeadline ? ` · ${expert ? "deadline" : "decide by"} ${fmtTime(p.decisionDeadline.t)}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="panel flex min-h-[280px] flex-1 flex-col overflow-hidden">
          <div className="panel-h">
            <div className="panel-t">{expert ? "Agent activity" : "What the agents did"}</div>
            <button className="btn btn-sm" onClick={() => setView("agents")}>{expert ? "Coordination" : "All steps"} <ArrowUpRight size={12} /></button>
          </div>
          <div className="min-h-0 flex-1">{expert ? <CoordinationLog thread={null} showActions={false} compact limit={40} /> : <AgentStory thread={null} limit={14} />}</div>
        </div>
      </div>
    </div>
  );
}

function AirportCard({ icao, expert }: { icao: string; expert: boolean }) {
  const rt = useRuntime();
  const { setView, setAirport } = useOps();
  const sum = rt.airportSummary(icao);
  const p = PROFILES[icao];
  const s = sum.sample;
  const wx = sum.weather;
  const WxIcon = wx?.thunder ? CloudLightning : wx && wx.visibility < 3000 ? CloudFog : wx && wx.precip !== "none" ? CloudRain : Sun;
  const hist = rt.samples.slice(-36).map((x) => x.airports[icao]?.holding ?? 0);
  const mx = Math.max(4, ...hist);
  return (
    <button className="panel w-full shrink-0 p-3 text-left transition-shadow hover:shadow-[var(--shadow-2)]" onClick={() => { setAirport(icao); setView("twin"); }}
      title={expert ? undefined : "Open this airport in 3D"}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">{expert ? p.iata : p.city}</span>
            <span className="text-[12px] text-muted">{expert ? p.name : `${p.iata} · ${p.name}`}</span>
          </div>
          {expert && <div className="mono mt-0.5 truncate text-[10px] text-faint">{wx ? metar(icao, wx, rt.world.now) : ""}</div>}
        </div>
        <span className={`pill ${sum.status === "normal" ? "pill-teal" : sum.status === "watch" ? "pill-amber" : "pill-red"}`}>{sum.status}</span>
      </div>
      {expert ? (
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          <Cell label="Arr rate" value={`${Math.round(sum.rate)}/${p.arrCapacity}`} warn={sum.rate < p.arrCapacity} />
          <Cell label="Inbound" value={String(s?.inbound ?? 0)} />
          <Cell label="Holding" value={String(s?.holding ?? 0)} warn={(s?.holding ?? 0) > 0} />
          <Cell label="Wait stand" value={String(s?.waiting ?? 0)} warn={(s?.waiting ?? 0) > 0} />
          <Cell label="On stand" value={`${s?.onStand ?? 0}/${s?.stands ?? 0}`} />
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Cell label="Landings per hour" value={`${Math.round(sum.rate)} of ${p.arrCapacity}`} warn={sum.rate < p.arrCapacity} hint="How many aircraft the runways can land per hour right now, out of the normal number" />
          <Cell label="Planes on the way" value={String(s?.inbound ?? 0)} hint="Arrivals in the air, heading here" />
          <Cell label="Circling now" value={String(s?.holding ?? 0)} warn={(s?.holding ?? 0) > 0} hint="Aircraft flying holding patterns while they wait for a landing slot" />
        </div>
      )}
      <div className="mt-2 flex items-end gap-2">
        <div className="flex items-center gap-1 text-[11px] text-muted"><WxIcon size={13} /> {wx ? (expert ? `${wx.category} · vis ${wx.visibility >= 9999 ? "10 km+" : `${Math.round(wx.visibility)} m`}` : plainWeather(wx)) : "—"}</div>
        <svg viewBox={`0 0 ${hist.length * 6} 20`} className="ml-auto h-5 w-32" preserveAspectRatio="none">
          {hist.map((v, i) => {
            const h = v ? Math.max(3, (20 * v) / mx) : 1.5; // zero keeps a faint track so the history reads as a chart
            return <rect key={i} x={i * 6} y={20 - h} width={4.5} height={h} fill={v ? "var(--amber)" : "var(--line-2)"} />;
          })}
        </svg>
        <span className="text-[10px] text-faint">{expert ? "holding" : "circling"}, last 3 h</span>
      </div>
      {sum.incidents.length > 0 && <div className="mt-2 truncate rounded-md bg-red-soft px-2 py-1 text-[11px] text-[var(--red)]">{sum.incidents.map((i) => (expert ? i.title : plainIncident(i))).join(" · ")}</div>}
    </button>
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

function Cell({ label, value, warn, hint }: { label: string; value: string; warn?: boolean; hint?: string }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 px-1.5 py-1" title={hint}>
      <div className="truncate text-[9.5px] text-muted">{label}</div>
      <div className={`mono text-[12.5px] font-semibold ${warn ? "text-[var(--amber)]" : ""}`}>{value}</div>
    </div>
  );
}
