"use client";

import {
  ArrowUpRight, Camera, CloudFog, CloudLightning, CloudRain, Crosshair, Eye, Film, Grid2x2, Map as MapIcon, Moon, Navigation,
  Plane, Route, Sun, Sunset, Tag, X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRef } from "react";
import { AIRCRAFT } from "@/core/aircraft";
import { AIRLINES } from "@/core/airlines";
import { PROFILES } from "@/core/airports/profiles";
import { isOpen } from "@/core/approvals/workflow";
import { metar } from "@/core/sim/weather";
import { activeRestrictions, callsignOf, fmtTime } from "@/core/world";
import { useOps, useRuntime, type CameraMode, type Overlays } from "@/store/ops";
import { previewProposal } from "@/three/twin/Overlays";
import { AirportTabs } from "../common/AirportTabs";
import { STATUS_PILL } from "../common/format";
import { plainIncident, plainWeather } from "../story";

const TwinScene = dynamic(() => import("@/three/twin/TwinScene"), { ssr: false, loading: () => <Loading /> });

function Loading() {
  return <div className="flex h-full items-center justify-center text-[12px] text-white/60">Loading the digital twin…</div>;
}

export default function TwinView() {
  const rt = useRuntime();
  const airport = useOps((s) => s.airport);
  const expert = useOps((s) => s.detail === "expert");
  const labels = useRef<HTMLCanvasElement>(null);
  return (
    <div className="relative h-full overflow-hidden bg-[#0b1622]">
      <TwinScene rt={rt} icao={airport} labels={labels} />
      <canvas ref={labels} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 flex w-[372px] flex-col gap-2">
        <div className="pointer-events-auto"><AirportTabs dark /></div>
        {expert ? <StatusCard icao={airport} /> : <StatusLine icao={airport} />}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
        <Controls />
        <Details />
      </div>
      {expert ? (
        <div className="pointer-events-none absolute bottom-3 left-3 flex w-[372px] flex-col items-start gap-2">
          <RunwayCard icao={airport} />
          <Legend />
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/35 px-3 py-1 text-[11px] text-white/70 backdrop-blur-sm">
          Click a plane or a gate for details · drag to look around · scroll to zoom
        </div>
      )}
      <PlanBar icao={airport} />
      <div className="pointer-events-none absolute bottom-1.5 right-3 text-right text-[10px] leading-snug text-white/45">
        Map data © OpenStreetMap contributors (ODbL)<br />original 3D models · synthetic flights and fictional airlines
      </div>
    </div>
  );
}

/** Simple mode: one line instead of the status card — where, what the weather is, how the runways are coping. */
function StatusLine({ icao }: { icao: string }) {
  const rt = useRuntime();
  const sum = rt.airportSummary(icao);
  const p = PROFILES[icao];
  const wx = sum.weather;
  const holding = sum.sample?.holding ?? 0;
  const tone = sum.status === "normal" ? "#3fc2a6" : sum.status === "watch" ? "#f0b04a" : "#ef6b6b";
  return (
    <div className="hud pointer-events-auto flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[12px]">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: tone, boxShadow: `0 0 0 3px ${tone}33` }} />
      <span className="font-semibold">{p.city}</span>
      {wx && <span className="text-white/75">{plainWeather(wx)}</span>}
      <span className="text-white/40">·</span>
      <span className={sum.rate < p.arrCapacity ? "text-[#f2b14c]" : "text-white/75"}>{Math.round(sum.rate)} of {p.arrCapacity} landings/h</span>
      {holding > 0 && <><span className="text-white/40">·</span><span className="text-[#f2b14c]">{holding} circling</span></>}
      {/* fog is already in the weather words; show at most one other disruption */}
      {sum.incidents.filter((i) => i.type !== "FOG").slice(0, 1).map((i) => <span key={i.id} className="pill pill-red">{plainIncident(i)}</span>)}
    </div>
  );
}

function StatusCard({ icao }: { icao: string }) {
  const rt = useRuntime();
  const sum = rt.airportSummary(icao);
  const p = PROFILES[icao];
  const wx = sum.weather;
  const s = sum.sample;
  const lvp = wx?.category === "LVP" || activeRestrictions(rt.world, icao, "LOW_VISIBILITY").length > 0;
  const expert = useOps((st) => st.detail === "expert");
  const closures = activeRestrictions(rt.world, icao, "RUNWAY_CLOSED");
  const WxIcon = wx?.thunder ? CloudLightning : wx && wx.precip !== "none" ? CloudRain : wx && wx.visibility < 3000 ? CloudFog : Sun;
  return (
    <div className="hud pointer-events-auto px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold leading-tight">{p.name}</div>
          <div className="muted text-[10.5px]">{expert ? `${p.iata} / ${icao} · digital twin · OSM layout + procedural models` : `${p.city} · 3D view of the live simulation`}</div>
        </div>
        <span className={`pill ${sum.status === "normal" ? "pill-teal" : sum.status === "watch" ? "pill-amber" : "pill-red"}`}>{sum.status}</span>
      </div>
      {wx && expert && <div className="mono mt-1.5 rounded bg-white/5 px-2 py-1 text-[10px] leading-snug text-white/80">{metar(icao, wx, rt.world.now)}</div>}
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <Kpi label={expert ? "Arrivals/h" : "Landings/h"} value={`${Math.round(sum.rate)}/${p.arrCapacity}`} warn={sum.rate < p.arrCapacity} />
        <Kpi label={expert ? "Holding" : "Circling"} value={String(s?.holding ?? 0)} warn={(s?.holding ?? 0) > 0} />
        <Kpi label={expert ? "Wait stand" : "Need a gate"} value={String(s?.waiting ?? 0)} warn={(s?.waiting ?? 0) > 0} />
        <Kpi label={expert ? "On stand" : "Parked"} value={`${s?.onStand ?? 0}/${s?.stands ?? 0}`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px]">
        <span className="flex items-center gap-1 text-white/75"><WxIcon size={12} /> {wx ? (expert ? `${wx.category} · vis ${wx.visibility >= 9999 ? "10 km+" : `${Math.round(wx.visibility)} m`}${wx.rvr ? ` · RVR ${wx.rvr} m` : ""}` : plainWeather(wx)) : ""}</span>
        {lvp && <span className="pill pill-amber">{expert ? "LVP · stop bars lit" : "Low-visibility rules on"}</span>}
        {closures.map((r) => <span key={r.id} className="pill pill-red">{expert ? "RWY" : "Runway"} {String(r.params.runway)} closed · until {fmtTime(r.end)}</span>)}
        {sum.incidents.map((i) => <span key={i.id} className="pill pill-red">{expert ? i.title : plainIncident(i)}</span>)}
      </div>
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-1">
      <div className="text-[9.5px] text-white/55">{label}</div>
      <div className={`mono text-[12.5px] font-semibold ${warn ? "text-[#f2b14c]" : ""}`}>{value}</div>
    </div>
  );
}

const MODES: { id: CameraMode; label: string; icon: typeof Camera }[] = [
  { id: "strategic", label: "Strategic", icon: MapIcon },
  { id: "topdown", label: "Top-down", icon: Grid2x2 },
  { id: "inspect", label: "Inspect", icon: Eye },
  { id: "follow", label: "Follow", icon: Navigation },
  { id: "cinematic", label: "Cinematic", icon: Film },
];

function Controls() {
  const { camera, setCamera, overlays, setOverlay, selectedVisit } = useOps();
  const expert = useOps((s) => s.detail === "expert");
  const toggles: { k: keyof Overlays; label: string; icon: typeof Camera }[] = [
    { k: "labels", label: "Labels", icon: Tag }, { k: "stands", label: "Stands", icon: Crosshair }, { k: "routes", label: "Routes", icon: Route },
  ];
  const light: { v: Overlays["lighting"]; icon: typeof Camera; label: string }[] = [
    { v: "auto", icon: Camera, label: "Sim time" }, { v: "day", icon: Sun, label: "Day" }, { v: "dusk", icon: Sunset, label: "Dusk" }, { v: "night", icon: Moon, label: "Night" },
  ];
  return (
    <div className="hud pointer-events-auto flex flex-col gap-1.5 p-1.5">
      <div className="flex gap-1">
        {MODES.filter((m) => expert || m.id !== "inspect").map((m) => (
          <button key={m.id} className="hud-btn" data-on={camera === m.id} disabled={m.id === "follow" && !selectedVisit}
            title={m.id === "follow" && !selectedVisit ? "Click a plane first, then follow it" : m.label} onClick={() => setCamera(m.id)}>
            <m.icon size={13} /> {!expert && m.id === "strategic" ? "Overview" : m.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {toggles.map((t) => (
          <button key={t.k} className="hud-btn" data-on={Boolean(overlays[t.k])} onClick={() => setOverlay(t.k, !overlays[t.k] as never)}>
            <t.icon size={13} /> {!expert && t.k === "stands" ? "Gates" : t.label}
          </button>
        ))}
        {expert && <span className="mx-1 w-px self-stretch bg-white/10" />}
        {expert && light.map((l) => (
          <button key={l.v} className="hud-btn" data-on={overlays.lighting === l.v} title={`Lighting: ${l.label}`} onClick={() => setOverlay("lighting", l.v)}>
            <l.icon size={13} />{l.v === "auto" ? " Sim time" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

function Details() {
  const rt = useRuntime();
  const { selectedVisit, selectedStand, select, setCamera, setView, airport } = useOps();
  if (selectedVisit && rt.world.visits[selectedVisit]) return <AircraftCard id={selectedVisit} onClose={() => select({ selectedVisit: null })} onFollow={() => setCamera("follow")} onGantt={() => setView("timeline")} />;
  if (selectedStand && rt.airports[airport].stands[selectedStand]) return <StandCard id={selectedStand} onClose={() => select({ selectedStand: null })} />;
  return null;
}

function Row({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[11.5px]">
      <span className="text-white/55">{k}</span>
      <span className={`mono text-right ${warn ? "text-[#f2b14c]" : "text-white/90"}`}>{v}</span>
    </div>
  );
}

function AircraftCard({ id, onClose, onFollow, onGantt }: { id: string; onClose: () => void; onFollow: () => void; onGantt: () => void }) {
  const rt = useRuntime();
  const { select, setView } = useOps();
  const v = rt.world.visits[id];
  const a = AIRCRAFT[v.type];
  const al = AIRLINES[v.airline];
  const t = (x: number | null) => (x === null ? "—" : fmtTime(x));
  const delayMin = v.arr && v.eldt !== null ? Math.round((v.eldt - (v.arr.sched - 600)) / 60) : null;
  const props = Object.entries(rt.proposals).filter(([, p]) => p.plan.decisions.some((d) => d.visit === id)).sort((x, y) => y[1].createdAt - x[1].createdAt).slice(0, 3);
  return (
    <div className="hud pointer-events-auto w-[330px] p-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md" style={{ background: al?.livery.tail ?? "#334" }}><Plane size={15} className="text-white" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight">{callsignOf(v)}</div>
          <div className="muted text-[11px]">{al?.name ?? v.airline} (fictional) · {a.label} · {v.reg}</div>
        </div>
        <button className="hud-btn !px-1.5" onClick={onClose} aria-label="Close"><X size={13} /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="pill pill-blue">{v.phase.replace("_", " ").toLowerCase()}</span>
        {v.stand && <span className="pill pill-gray">stand {v.stand}</span>}
        {v.prm > 0 && <span className="pill pill-amber">PRM × {v.prm}</span>}
        {v.priority && <span className="pill pill-red">{v.priority.toLowerCase()}</span>}
        {v.divertedFrom && <span className="pill pill-amber">diverted from {PROFILES[v.divertedFrom]?.iata}</span>}
        {v.techHoldUntil !== null && v.techHoldUntil > rt.world.now && <span className="pill pill-red">tech hold → {fmtTime(v.techHoldUntil)}</span>}
      </div>
      <div className="mt-2 border-t border-white/10 pt-1.5">
        {v.arr && <Row k={`From ${v.arr.origin}`} v={`STA ${t(v.arr.sched)} · ELDT ${t(v.eldt)}`} warn={delayMin !== null && delayMin > 15} />}
        {v.aldt !== null && <Row k="Landed / on block" v={`${t(v.aldt)} / ${t(v.aibt)}`} />}
        {v.dep && <Row k={`To ${v.dep.destination}`} v={`STD ${t(v.dep.sched)} · TOBT ${t(v.tobt)}`} />}
        {v.tsat !== null && <Row k="TSAT / off block" v={`${t(v.tsat)} / ${t(v.aobt)}`} />}
        <Row k="Pax / connecting" v={`${v.pax} / ${v.connecting}`} />
        {v.airborneHold > 0 && <Row k="Airborne holding" v={`${Math.round(v.airborneHold / 60)} min`} warn />}
        {v.groundWait > 0 && <Row k="Waited for stand" v={`${Math.round(v.groundWait / 60)} min`} warn />}
      </div>
      {props.length > 0 && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/50">In recovery plans</div>
          {props.map(([k, p]) => {
            const d = p.plan.decisions.find((x) => x.visit === id)!;
            return (
              <button key={k} className="mb-1 flex w-full items-center gap-2 rounded-md bg-white/5 px-2 py-1 text-left text-[11px] hover:bg-white/10" onClick={() => { select({ selectedProposal: k }); setView("workbench"); }}>
                <span className={`pill ${STATUS_PILL[p.status]}`}>{p.status.toLowerCase()}</span>
                <span className="min-w-0 flex-1 truncate">{p.id} v{p.version}: {d.action.replace("_", " ")} {d.stand ?? d.to ?? d.to_stand ?? ""}</span>
                <ArrowUpRight size={12} />
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/50">Recent events</div>
        {v.history.slice(-5).reverse().map((h, i) => (
          <div key={i} className="flex gap-2 text-[11px] leading-snug"><span className="mono text-white/50">{fmtTime(h[0])}</span><span className="text-white/80">{h[2] || h[1]}</span></div>
        ))}
      </div>
      <div className="mt-2.5 flex gap-1.5">
        <button className="hud-btn" onClick={onFollow}><Navigation size={13} /> Follow</button>
        <button className="hud-btn" onClick={onGantt}><Grid2x2 size={13} /> Stand Gantt</button>
      </div>
    </div>
  );
}

function StandCard({ id, onClose }: { id: string; onClose: () => void }) {
  const rt = useRuntime();
  const { airport, select } = useOps();
  const ap = rt.airports[airport];
  const st = ap.stands[id];
  const ss = rt.world.stands[st.key];
  const occ = ss?.occupant ? rt.world.visits[ss.occupant] : null;
  const res = ss?.reservedBy ? rt.world.visits[ss.reservedBy] : null;
  const closures = activeRestrictions(rt.world, airport, "STAND_CLOSED").filter((r) => ((r.params.stands as string[]) ?? []).includes(id));
  const next = Object.values(rt.world.visits)
    .filter((v) => v.airport === airport && v.stand === id && ["SCHEDULED", "INBOUND", "HOLDING", "APPROACH", "LANDING", "TAXI_IN", "WAITING_STAND"].includes(v.phase))
    .sort((a, b) => (a.eldt ?? a.eta ?? 0) - (b.eldt ?? b.eta ?? 0)).slice(0, 5);
  return (
    <div className="hud pointer-events-auto w-[310px] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight">Stand {st.id}</div>
          <div className="muted text-[11px]">{st.area || st.zone} · {st.kind} · code {st.sizeCode} · max span {st.maxWingspan.toFixed(0)} m</div>
        </div>
        <button className="hud-btn !px-1.5" onClick={onClose} aria-label="Close"><X size={13} /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {[...st.services].map((s) => <span key={s} className="pill pill-gray">{s.replace("_", " ").toLowerCase()}</span>)}
      </div>
      <div className="mt-2 border-t border-white/10 pt-1.5">
        <Row k="Occupant" v={occ ? <button className="underline decoration-dotted" onClick={() => select({ selectedVisit: occ.id, selectedStand: null })}>{callsignOf(occ)}</button> : "free"} />
        {res && <Row k="Reserved by" v={callsignOf(res)} />}
        {closures.map((r) => <Row key={r.id} k={r.shared ? "Closed" : "Closed (local info)"} v={`until ${fmtTime(r.end)}`} warn />)}
        <Row k="Source" v={st.source} />
      </div>
      {next.length > 0 && (
        <div className="mt-2 border-t border-white/10 pt-1.5">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/50">Next assigned</div>
          {next.map((v) => <Row key={v.id} k={callsignOf(v)} v={`${v.phase.toLowerCase()} · ${v.eldt !== null ? fmtTime(v.eldt) : v.eta !== null ? fmtTime(v.eta) : ""}`} />)}
        </div>
      )}
    </div>
  );
}

function RunwayCard({ icao }: { icao: string }) {
  const rt = useRuntime();
  const ap = rt.airports[icao];
  const closed = new Map(activeRestrictions(rt.world, icao, "RUNWAY_CLOSED").map((r) => [String(r.params.runway), r]));
  const wx = rt.world.weather[icao];
  const expert = useOps((st) => st.detail === "expert");
  return (
    <div className="hud pointer-events-auto w-[300px] px-3 py-2">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/50">Runways</div>
      {ap.layout.runways.map((r) => {
        const c = closed.get(r.id);
        const inUse = r.ends.map((e) => e.designator).filter((d) => d === ap.arrivalEnd || d === ap.departureEnd);
        return (
          <div key={r.id} className="flex items-center gap-2 py-0.5 text-[11.5px]">
            <span className="mono w-[70px] font-semibold">{r.id}</span>
            <span className="text-white/55">{Math.round(Number(r.length_m ?? 0))} × {Math.round(Number(r.width_m ?? 0))} m</span>
            <span className="ml-auto">
              {c ? <span className="pill pill-red">closed → {fmtTime(c.end)}</span>
                : <span className="pill pill-teal">{inUse.map((d) => expert
                  ? `${d === ap.arrivalEnd ? "ARR" : ""}${d === ap.arrivalEnd && d === ap.departureEnd ? "/" : ""}${d === ap.departureEnd ? "DEP" : ""} ${d}`
                  : `${d === ap.arrivalEnd && d === ap.departureEnd ? "landing & take-off" : d === ap.arrivalEnd ? "landing" : "take-off"} ${d}`).join(" · ") || "open"}</span>}
            </span>
          </div>
        );
      })}
      {wx && expert && (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 border-t border-white/10 pt-1.5 text-[10.5px]">
          <div><div className="text-white/50">Wind</div><div className="mono">{String(Math.round(wx.windDir)).padStart(3, "0")}° / {Math.round(wx.windKt)}{wx.gustKt ? `G${Math.round(wx.gustKt)}` : ""} kt</div></div>
          <div><div className="text-white/50">Temp / dew</div><div className="mono">{Math.round(wx.tempC)}° / {Math.round(wx.dewC)}°</div></div>
          <div><div className="text-white/50">Ceiling</div><div className="mono">{wx.ceiling === null ? "—" : `${wx.ceiling} ft`}</div></div>
        </div>
      )}
    </div>
  );
}

function Legend() {
  const expert = useOps((st) => st.detail === "expert");
  const items: [string, string][] = expert
    ? [["#35c2a5", "free"], ["#6fa6ff", "occupied"], ["#f2a93b", "inbound / reserved"], ["#a98bff", "proposed by plan"], ["#ef5350", "closed / conflict"]]
    : [["#35c2a5", "free"], ["#6fa6ff", "plane parked"], ["#f2a93b", "plane on the way"], ["#a98bff", "in the new plan"], ["#ef5350", "closed or clash"]];
  return (
    <div className="hud pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[10.5px]">
      <span className="text-white/50">{expert ? "Stands" : "Gates"}</span>
      {items.map(([c, l]) => <span key={l} className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ border: `1.5px solid ${c}`, background: `${c}33` }} />{l}</span>)}
      <span className="text-white/50">Routes</span>
      <span className="flex items-center gap-1"><span className="h-1 w-3 rounded bg-[#35c2a5]" />arrival</span>
      <span className="flex items-center gap-1"><span className="h-1 w-3 rounded bg-[#5aa7ff]" />departure</span>
      <span className="flex items-center gap-1"><span className="h-1 w-3 rounded bg-[#f2a93b]" />tow</span>
    </div>
  );
}

function PlanBar({ icao }: { icao: string }) {
  const rt = useRuntime();
  const { selectedProposal, select, setView } = useOps();
  const hit = previewProposal(rt, icao, selectedProposal);
  if (!hit) return null;
  const [key, p] = hit;
  const here = p.plan.decisions.filter((d) => d.airport === icao || d.to === icao);
  const count = (a: string) => here.filter((d) => d.action === a).length;
  const done = p.approvals.filter((a) => a.decision !== "PENDING").length;
  const expert = useOps.getState().detail === "expert";
  const city = PROFILES[icao].city;
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
      <div className="hud pointer-events-auto flex items-center gap-3 px-3 py-2">
        <span className={`pill ${STATUS_PILL[p.status]}`}>{expert ? p.status.toLowerCase() : isOpen(p) ? "waiting for approval" : p.status === "COMMITTED" ? "running" : p.status.toLowerCase()}</span>
        {expert ? (
          <div className="text-[12px]">
            <span className="font-semibold">{p.id} v{p.version}</span> <span className="text-white/60">· {p.label}</span>
            <div className="text-[10.5px] text-white/60">
              {here.length} actions at {PROFILES[icao].iata}: {count("assign_stand")} stand changes · {count("divert")} diversions · {count("tow")} tows · {count("landing_slot")} slots
              {isOpen(p) ? ` · approvals ${done}/${p.approvals.length}` : ""}
            </div>
          </div>
        ) : (
          <div className="text-[12px]">
            <span className="font-semibold">Recovery plan</span> <span className="text-white/60">· violet marks show what changes at {city}</span>
            <div className="text-[10.5px] text-white/60">
              {[count("assign_stand") ? `${count("assign_stand")} gate changes` : "", count("divert") ? `${count("divert")} flights to or from other airports` : "", count("landing_slot") ? `${count("landing_slot")} landing times` : ""].filter(Boolean).join(" · ")}
              {isOpen(p) ? ` · ${done} of ${p.approvals.length} approved` : ""}
            </div>
          </div>
        )}
        <button className="hud-btn" onClick={() => { select({ selectedProposal: key }); setView("workbench"); }}>{expert ? <>Review &amp; approve</> : isOpen(p) ? "Review and decide" : "See the plan"} <ArrowUpRight size={12} /></button>
      </div>
    </div>
  );
}
