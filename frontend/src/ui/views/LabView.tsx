"use client";

import { FlaskConical, Play, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { can, roleOf } from "@/core/approvals/roles";
import { PROFILES, RESOURCE_LABELS } from "@/core/airports/profiles";
import { hm, SCENARIOS, type LabIncidentSpec } from "@/core/sim/scenarios";
import type { IncidentType } from "@/core/types";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";

const TYPES: { id: IncidentType; label: string; hint: string }[] = [
  { id: "FOG", label: "Heavy fog", hint: "Low-visibility procedures; arrival capacity restricted" },
  { id: "THUNDERSTORM", label: "Thunderstorm / heavy rain", hint: "Capacity cut, lightning ramp suspensions, wet runway" },
  { id: "RUNWAY_CLOSURE", label: "Runway unavailable", hint: "One runway closed; mixed-mode operations" },
  { id: "STAND_BLOCKED", label: "Blocked stand", hint: "Unserviceable aircraft keeps its stand" },
  { id: "PRIORITY_ARRIVAL", label: "Priority arrival", hint: "Emergency on an inbound flight" },
  { id: "DIVERSION_INFLUX", label: "Unexpected diversions", hint: "Flights diverted into the network" },
  { id: "RESOURCE_OUTAGE", label: "Ground-handling limitation", hint: "Stands free but resources unavailable" },
  { id: "ACCESSIBILITY_REQUIREMENT", label: "Accessibility requirement", hint: "Passengers needing full assistance" },
  { id: "STAND_CLOSURE", label: "Stand closure", hint: "Stands closed for maintenance / safety" },
];

export default function LabView() {
  const rt = useRuntime();
  const { role, toast, setView } = useOps();
  const [spec, setSpec] = useState<LabIncidentSpec>({ type: "FOG", airport: "OMAA", start_offset_min: 5, duration_min: 150, severity: "high" });
  const [batch, setBatch] = useState<LabIncidentSpec[]>([]);
  const [speed, setSpeed] = useState(30);
  const allowed = can(role, "inject_incident", { airport: spec.airport });
  const inject = (list: LabIncidentSpec[]) => {
    try {
      for (const s of list) {
        const inc = rt.injectIncident(s, role);
        toast(inc ? `Injected: ${inc.title} (starts ${fmtTime(inc.start)})` : "Nothing to inject (no matching flight)", inc ? "ok" : "warn");
      }
      rt.setRunning(true);
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_420px] gap-3 p-3">
      <div className="scroll-y min-h-0 space-y-3 pr-1">
        <div>
          <div className="text-[16px] font-semibold tracking-tight">Scenario lab</div>
          <div className="text-[12px] text-muted">Launch a catalogue scenario, or inject disruptions into the running simulation — every input changes the actual simulation state and is recorded for replay.</div>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {SCENARIOS.map((s) => (
            <div key={s.id} className={`panel flex flex-col p-3 ${rt.scenario.id === s.id ? "ring-2 ring-[var(--navy)]" : ""}`}>
              <div className="flex items-center gap-2">
                <span className={`pill ${s.id === "nightfall" ? "pill-navy" : "pill-gray"}`}>{s.code}</span>
                <span className="font-semibold">{s.title}</span>
              </div>
              <p className="mt-1.5 flex-1 text-[12px] leading-snug text-muted">{s.summary}</p>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-faint">
                <span className="mono">{fmtTime(s.start)} start</span> · <span>{s.focus.map((f) => PROFILES[f].iata).join(" · ")}</span>
                <button className="btn btn-sm ml-auto" onClick={() => { rt.running = false; rt.speed = speed; rt.load(s.id, rt.seed); rt.running = true; toast(`Loaded ${s.title}`, "ok"); setView("command"); }}>
                  <Play size={12} /> Launch
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="panel p-3 text-[12px] text-muted">
          Seeds make runs reproducible: same scenario + seed + recorded human inputs ⇒ identical timeline. Current seed <span className="mono text-ink">{rt.seed}</span>.
          <span className="ml-2 inline-flex items-center gap-1">Change seed:
            {[7, 21, 42, 99].map((sd) => <button key={sd} className={`btn btn-sm ${rt.seed === sd ? "btn-primary" : ""}`} onClick={() => { rt.load(rt.scenario.id, sd); toast(`Reloaded with seed ${sd}`); }}>{sd}</button>)}
          </span>
        </div>
      </div>
      <div className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="panel-h">
          <div className="panel-t flex items-center gap-1.5"><FlaskConical size={13} /> Inject into running simulation</div>
          <span className="mono text-[11px] text-muted">now {fmtTime(rt.world.now)}</span>
        </div>
        <div className="scroll-y min-h-0 flex-1 space-y-3 p-3">
          <Field label="Incident type">
            <div className="grid grid-cols-1 gap-1">
              {TYPES.map((t) => (
                <button key={t.id} onClick={() => setSpec({ ...spec, type: t.id })} className={`rounded-md border px-2 py-1.5 text-left ${spec.type === t.id ? "border-navy bg-navy-soft" : "border-line hover:bg-bg-2"}`}>
                  <div className="text-[12px] font-semibold">{t.label}</div>
                  <div className="text-[11px] text-muted">{t.hint}</div>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Affected airport">
            <div className="flex gap-1">{Object.keys(PROFILES).map((a) => <button key={a} className={`btn btn-sm flex-1 justify-center ${spec.airport === a ? "btn-primary" : ""}`} onClick={() => setSpec({ ...spec, airport: a })}>{PROFILES[a].iata}</button>)}</div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts in (min)"><Num v={spec.start_offset_min ?? 0} set={(x) => setSpec({ ...spec, start_offset_min: x })} min={0} max={240} /></Field>
            <Field label="Duration (min)"><Num v={spec.duration_min ?? 120} set={(x) => setSpec({ ...spec, duration_min: x })} min={15} max={600} /></Field>
          </div>
          <Field label="Severity">
            <div className="flex gap-1">{(["low", "moderate", "high", "severe"] as const).map((s) => <button key={s} className={`btn btn-sm flex-1 justify-center ${spec.severity === s ? "btn-primary" : ""}`} onClick={() => setSpec({ ...spec, severity: s })}>{s}</button>)}</div>
          </Field>
          {spec.type === "FOG" && (
            <Field label={`Arrival capacity restriction (normal ${PROFILES[spec.airport].arrCapacity}/h)`}>
              <Num v={spec.capacity_rate ?? Math.round(PROFILES[spec.airport].arrCapacity * 0.45)} set={(x) => setSpec({ ...spec, capacity_rate: x })} min={2} max={PROFILES[spec.airport].arrCapacity} suffix="/h" />
            </Field>
          )}
          {spec.type === "DIVERSION_INFLUX" && <Field label="Number of affected flights"><Num v={spec.flights ?? 4} set={(x) => setSpec({ ...spec, flights: x })} min={1} max={8} /></Field>}
          {spec.type === "RESOURCE_OUTAGE" && (
            <>
              <Field label="Resource">
                <select className="btn w-full" value={spec.pool ?? "wb_handling"} onChange={(e) => setSpec({ ...spec, pool: e.target.value })}>
                  {Object.entries(RESOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v} ({rt.world.resources[spec.airport]?.[k] ?? 0} units)</option>)}
                </select>
              </Field>
              <Field label="Units unavailable"><Num v={spec.units ?? 3} set={(x) => setSpec({ ...spec, units: x })} min={1} max={30} /></Field>
              <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={spec.shared ?? true} onChange={(e) => setSpec({ ...spec, shared: e.target.checked })} /> Known to the network (uncheck = local log only)</label>
            </>
          )}
          {spec.type === "ACCESSIBILITY_REQUIREMENT" && <Field label="Passengers needing full assistance"><Num v={spec.prm ?? 3} set={(x) => setSpec({ ...spec, prm: x })} min={1} max={10} /></Field>}
          {spec.type === "STAND_CLOSURE" && <Field label="Stands to close"><Num v={spec.count ?? 3} set={(x) => setSpec({ ...spec, count: x })} min={1} max={10} /></Field>}
          <Field label="Simulation speed after inject">
            <div className="flex gap-1">{[10, 30, 60, 120].map((s) => <button key={s} className={`btn btn-sm flex-1 justify-center ${speed === s ? "btn-primary" : ""}`} onClick={() => { setSpeed(s); rt.speed = s; rt.notify(); }}>{s}×</button>)}</div>
          </Field>
          {batch.length > 0 && (
            <div className="rounded-lg border border-line p-2">
              <div className="eyebrow mb-1">Simultaneous incidents ({batch.length})</div>
              {batch.map((b, i) => (
                <div key={i} className="flex items-center gap-2 py-0.5 text-[12px]">
                  <span className="pill pill-navy">{PROFILES[b.airport].iata}</span>
                  <span className="flex-1">{TYPES.find((t) => t.id === b.type)?.label} · +{b.start_offset_min}m · {b.duration_min}m</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setBatch(batch.filter((_, k) => k !== i))}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2 border-t border-line p-3">
          {!allowed && <div className="text-[11.5px] text-[var(--amber)]">{roleOf(role).title} cannot inject incidents at {PROFILES[spec.airport].iata}. Switch to the National Supervisor or that airport&apos;s controller.</div>}
          <div className="flex gap-2">
            <button className="btn flex-1 justify-center" onClick={() => setBatch([...batch, spec])}><Plus size={13} /> Add to simultaneous set</button>
            <button className="btn btn-primary flex-1 justify-center" disabled={!allowed} onClick={() => { inject(batch.length ? [...batch, spec] : [spec]); setBatch([]); }}>
              <Zap size={13} /> Inject {batch.length ? `${batch.length + 1} incidents` : "now"}
            </button>
          </div>
          <div className="text-[11px] text-faint">Starts at {fmtTime(rt.world.now + 60 * (spec.start_offset_min ?? 0))} · scenario epoch {fmtTime(hm(0))} GST</div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="eyebrow mb-1">{label}</div>{children}</label>;
}

function Num({ v, set, min, max, suffix }: { v: number; set: (x: number) => void; min: number; max: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} value={v} onChange={(e) => set(Number(e.target.value))} className="flex-1 accent-[var(--navy)]" />
      <span className="mono w-14 text-right text-[12px]">{v}{suffix ?? ""}</span>
    </div>
  );
}
