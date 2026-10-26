"use client";

import { Play, Rewind, SkipForward } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { participantColor, participantLabel } from "../agents/CoordinationLog";

const PHASES: { key: string; label: string; match: (type: string, summary: string) => boolean }[] = [
  { key: "incident", label: "Incident", match: (t, s) => t === "DisruptionNotice" && !s.includes("trend watch") },
  { key: "investigation", label: "Investigation", match: (t) => t === "ImpactAssessment" },
  { key: "proposal", label: "Proposal", match: (t) => t === "PlanCandidates" },
  { key: "coordination", label: "Coordination", match: (t) => t === "CoordinationRequest" },
  { key: "rejection", label: "Rejection / invalidation", match: (t) => t === "PlanInvalidated" || t === "LocalInformationShared" },
  { key: "approval", label: "Commit", match: (t) => t === "PlanCommitted" },
];

export default function ReplayView() {
  const rt = useRuntime();
  const { setInspect } = useOps();
  const msgs = rt.orchestrator.messages;
  const start = rt.scenario.start;
  const end = Math.max(rt.world.now, start + 60);
  const [cursor, setCursor] = useState<number | null>(null);
  const at = cursor ?? end;
  const markers = useMemo(() => {
    const out: { phase: string; label: string; t: number; id: string }[] = [];
    for (const p of PHASES) {
      const m = msgs.find((x) => p.match(x.type, x.summary));
      if (m) out.push({ phase: p.key, label: p.label, t: m.t, id: m.id });
    }
    return out;
  }, [msgs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // phases that happen within moments of each other share one marker (labels would collide)
  const clusters = useMemo(() => {
    const out: { t: number; items: typeof markers }[] = [];
    for (const m of [...markers].sort((a, b) => a.t - b.t)) {
      const last = out[out.length - 1];
      if (last && (m.t - last.t) / (end - start) < 0.08) last.items.push(m);
      else out.push({ t: m.t, items: [m] });
    }
    return out;
  }, [markers, start, end]);
  const shown = msgs.filter((m) => m.t <= at);
  const x = (t: number) => `${(100 * (t - start)) / (end - start)}%`;
  const incidents = Object.values(rt.world.incidents).filter((i) => i.start <= end);
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[16px] font-semibold tracking-tight">Scenario replay</div>
          <div className="text-[12px] text-muted">The run is deterministic: replaying the scenario with the same seed and the recorded human inputs reproduces the same timeline.</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-muted">{rt.inputs.length} recorded input{rt.inputs.length === 1 ? "" : "s"}</span>
          <button className="btn" onClick={() => { rt.replay(); rt.setRunning(true); }}><Rewind size={13} /> Replay from start</button>
          <button className="btn btn-primary" disabled={cursor === null} onClick={() => { if (cursor !== null) rt.replayTo(cursor); }}><SkipForward size={13} /> Re-simulate to {cursor !== null ? fmtTime(cursor) : "…"}</button>
        </div>
      </div>
      <div className="panel p-4">
        <div className="relative h-24">
          <div className="absolute left-0 right-0 top-10 h-1.5 rounded bg-bg-2" />
          <div className="absolute left-0 top-10 h-1.5 rounded bg-navy" style={{ width: x(at) }} />
          {incidents.map((i) => (
            <div key={i.id} className="absolute top-[52px] h-2 rounded bg-[color-mix(in_oklab,var(--red)_35%,transparent)]" title={i.title}
              style={{ left: x(Math.max(start, i.start)), width: `calc(${x(Math.min(end, i.end))} - ${x(Math.max(start, i.start))})` }} />
          ))}
          {clusters.map((c, k) => {
            const phase = c.items.some((m) => m.phase === "rejection") ? "rejection" : c.items.some((m) => m.phase === "approval") ? "approval" : "other";
            return (
              <button key={c.items[0].phase} onClick={() => { setCursor(c.t); setInspect({ kind: "message", id: c.items[0].id }); }}
                className="absolute -translate-x-1/2 text-center" style={{ left: x(c.t), top: k % 2 ? 58 : 0 }}>
                <div className={`mx-auto h-3 w-3 rounded-full border-2 border-white shadow ${phase === "rejection" ? "bg-[var(--red)]" : phase === "approval" ? "bg-[var(--teal)]" : "bg-navy"}`} style={{ marginTop: k % 2 ? 0 : 34 }} />
                <div className="mt-0.5 whitespace-nowrap text-[10.5px] font-semibold">{c.items.map((m) => m.label).join(" → ")}</div>
                <div className="mono text-[10px] text-muted">{fmtTime(c.t)}</div>
              </button>
            );
          })}
          <input type="range" min={start} max={end} value={at} onChange={(e) => setCursor(Number(e.target.value))} className="absolute left-0 right-0 top-[34px] w-full opacity-0" />
        </div>
        <div className="mt-6 flex items-center gap-3 text-[12px]">
          <span className="mono">{fmtTime(start)}</span>
          <input type="range" min={start} max={end} value={at} onChange={(e) => setCursor(Number(e.target.value))} className="flex-1 accent-[var(--navy)]" />
          <span className="mono">{fmtTime(end)}</span>
          <button className="btn btn-sm" onClick={() => setCursor(null)}><Play size={11} /> Live</button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] gap-3">
        <div className="panel min-h-0 overflow-hidden">
          <div className="panel-h"><div className="panel-t">What happened up to {fmtTime(at, true)}</div><span className="text-[11px] text-muted">{shown.length} messages</span></div>
          <ol className="scroll-y h-[calc(100%-42px)]">
            {shown.slice().reverse().map((m) => (
              <li key={m.id} onClick={() => setInspect({ kind: "message", id: m.id })} className="flex cursor-pointer gap-2.5 border-b border-line px-3 py-2 hover:bg-bg-2">
                <span className="mono w-[58px] shrink-0 text-[11px] text-muted">{fmtTime(m.t, true)}</span>
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: participantColor(m.from) }} />
                <span className="w-[150px] shrink-0 truncate text-[11.5px] font-semibold">{participantLabel(m)}</span>
                <span className="text-[12px] text-ink-2">{m.summary}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="panel min-h-0 overflow-hidden">
          <div className="panel-h"><div className="panel-t">Recorded inputs (replayed verbatim)</div></div>
          <ol className="scroll-y h-[calc(100%-42px)]">
            {rt.inputs.length === 0 && <li className="p-4 text-muted">No human inputs yet. Approvals, rejections, injected incidents and mode changes appear here.</li>}
            {rt.inputs.map((r, i) => (
              <li key={i} className="border-b border-line px-3 py-2 text-[12px]">
                <div className="flex items-center gap-2"><span className="mono text-muted">{fmtTime(r.t, true)}</span><span className="pill pill-navy">{r.kind}</span><span className="truncate text-muted">{r.by}</span></div>
                <div className="mono mt-0.5 truncate text-[11px] text-ink-2">{JSON.stringify(r.payload)}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
