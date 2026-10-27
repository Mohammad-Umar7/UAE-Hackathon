"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import type { SeriesPoint } from "@/core/solver/evaluate";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { workflowName } from "../story";
import { comparisons, PLAN_WINDOW_S, type Comparison, type Outcome } from "./compare";
import { FlightStoryBand } from "./FlightStory";
import { ImpactChart, type ChartLine } from "./ImpactChart";

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const hrs = (x: number) => (x < 10 ? x.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : n0(x));

const METRICS: { key: keyof Pick<Outcome, "fuel" | "holdingH" | "clashes" | "paxH">; label: string; fmt: (v: number) => string }[] = [
  { key: "fuel", fmt: n0, label: "Planes forced to divert, low on fuel" },
  { key: "holdingH", fmt: hrs, label: "Hours planes spend circling" },
  { key: "clashes", fmt: n0, label: "Planes landing to find their gate taken" },
  { key: "paxH", fmt: (v) => (v >= 10000 ? `${(v / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}k` : n0(v)), label: "Hours of passenger delay" },
];

const CHARTS: { key: string; tab: string; get: (s: SeriesPoint) => number; integer: boolean; unit: (v: number) => string; note: string }[] = [
  { key: "circling", tab: "Planes circling", get: (s) => s.circling, integer: true, unit: (v) => `${n0(v)} circling`, note: "planes in holding patterns at each moment" },
  { key: "fuel", tab: "Low-fuel diversions", get: (s) => s.fuelDiversions, integer: true, unit: (v) => `${n0(v)} diverted`, note: "running total of crews forced to divert on low fuel" },
  { key: "pax", tab: "Passenger delay", get: (s) => s.paxDelayH, integer: false, unit: (v) => `${n0(v)} h`, note: "running total, hours of delay over all passengers" },
];

/** Simple mode's Before & after: the same evening without SKYPACT and with it at a glance, then one flight's story and the curve. */
export function BeforeAfter() {
  const rt = useRuntime();
  const presentation = useOps((s) => s.presentation);
  const all = comparisons(rt);
  const [pick, setPick] = useState<string | null>(null);
  const c = all.find((x) => x.thread === pick) ?? all[0];
  if (!c) return <Empty />;
  const wf = rt.orchestrator.workflows.find((w) => w.id === c.thread);
  const name = wf ? workflowName(rt, wf) : "This disruption";
  const approvedAt = c.p?.history.find((h) => h.status === "COMMITTED")?.t;
  return (
    <div className={`scroll-y h-full ${presentation.active ? "pb-48" : ""}`}>
      <div className="mx-auto max-w-[1180px] space-y-5 px-6 py-6">
        <header className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <StageLine c={c} approvedAt={approvedAt} />
            <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-tight">{name}</h1>
            <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">The same evening simulated twice from {fmtTime(c.t0)}: once with nobody acting, once with SKYPACT. Same flights, same weather.</p>
          </div>
          {all.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {all.map((x) => {
                const w = rt.orchestrator.workflows.find((y) => y.id === x.thread);
                return (
                  <button key={x.thread} onClick={() => setPick(x.thread)}
                    className={`rounded-lg border px-2.5 py-1 text-[12px] ${x.thread === c.thread ? "border-navy bg-navy-soft font-medium text-navy" : "border-line text-muted hover:bg-bg-2"}`}>
                    {w ? workflowName(rt, w) : x.thread} · {fmtTime(x.t0)}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        <Scoreboard c={c} />
        <FlightStoryBand c={c} />
        <Unfolds c={c} now={rt.world.now} />
      </div>
    </div>
  );
}

function StageLine({ c, approvedAt }: { c: Comparison; approvedAt?: number }) {
  const done = c.stage === "committed";
  const color = done ? "var(--teal)" : "var(--amber)";
  const text = done ? `Plan approved${approvedAt !== undefined ? ` at ${fmtTime(approvedAt)}` : ""} and running`
    : c.stage === "proposed" ? "Prediction · the plan is waiting for approval" : "Prediction · the agents are still planning";
  return <div className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color }}><span className="h-2 w-2 rounded-full" style={{ background: color }} />{text}</div>;
}

/** Each outcome as two bars on one scale: how bad the evening gets without SKYPACT, and with it. */
function Scoreboard({ c }: { c: Comparison }) {
  const rows = METRICS.map((m) => ({ m, a: c.without[m.key], b: c.with?.[m.key] }));
  const alone = c.alone && c.with && (c.alone.fuel > c.with.fuel || c.alone.holdingH > c.with.holdingH + 1) ? c.alone : null;
  const grid = "grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_84px] items-center gap-x-6";
  return (
    <section className="panel overflow-hidden">
      <div className={`${grid} border-b border-line px-5 py-3`}>
        <span />
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--chart-bad)]"><X size={14} /> Without SKYPACT</span>
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--chart-good)]"><Check size={14} /> With SKYPACT</span>
        <span className="text-right text-[12px] text-muted">Change</span>
      </div>
      {rows.map(({ m, a, b }) => {
        const top = Math.max(a, b ?? 0, 1e-9);
        const pct = b !== undefined && a > 0 ? Math.round((100 * (b - a)) / a) : null;
        return (
          <div key={m.key} className={`${grid} border-b border-line px-5 py-4 last:border-b-0`}>
            <span className="text-[14px] leading-snug text-ink">{m.label}</span>
            <Bar v={a} top={top} fmt={m.fmt} color="var(--chart-bad)" />
            {b !== undefined ? <Bar v={b} top={top} fmt={m.fmt} color="var(--chart-good)" /> : <span className="text-[12.5px] text-faint">when the plan is ready</span>}
            <span className={`text-right text-[17px] font-semibold ${pct === null ? "text-faint" : pct < 0 ? "text-[var(--teal)]" : pct > 0 ? "text-[var(--amber)]" : "text-muted"}`}>
              {pct === null ? "—" : pct === 0 ? "same" : `${pct < 0 ? "−" : "+"}${Math.abs(pct)}%`}
            </span>
          </div>
        );
      })}
      {alone && (
        <p className="border-t border-line bg-bg-2 px-5 py-3 text-[13px] leading-snug text-ink-2">
          If each airport only sorted out its own gates, {n0(alone.fuel)} low-fuel {alone.fuel === 1 ? "diversion" : "diversions"} and {hrs(alone.holdingH)} hours of
          circling would remain. <span className="font-semibold text-ink">Coordinating all three airports is what closes the gap.</span>
        </p>
      )}
    </section>
  );
}

function Bar({ v, top, fmt, color }: { v: number; top: number; fmt: (v: number) => string; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="mono w-[64px] shrink-0 text-right text-[20px] font-semibold tabular-nums" style={{ color }}>{fmt(v)}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-bg-2">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(v > 0 ? 3 : 0, (100 * v) / top)}%`, background: color }} />
      </div>
    </div>
  );
}

function Unfolds({ c, now }: { c: Comparison; now: number }) {
  const [metric, setMetric] = useState(CHARTS[0].key);
  const m = CHARTS.find((x) => x.key === metric) ?? CHARTS[0];
  const t1 = c.t0 + c.horizonS;
  const lines: ChartLine[] = [
    { key: "without", label: "Without SKYPACT", color: "var(--chart-bad)", values: c.without.series.map((s) => ({ t: s.t, v: m.get(s) })) },
    ...(c.with ? [{ key: "with", label: "With SKYPACT", color: "var(--chart-good)", values: c.with.series.map((s) => ({ t: s.t, v: m.get(s) })) }] : []),
  ];
  if (!lines[0].values.length) return null;
  const shadeFrom = c.with ? c.t0 + PLAN_WINDOW_S : undefined;
  return (
    <section className="panel overflow-hidden">
      <div className="panel-h flex-wrap gap-y-2">
        <div>
          <div className="panel-t">How the evening unfolds</div>
          <div className="text-[11px] text-muted">{m.note}, from {fmtTime(c.t0)} to {fmtTime(t1)}</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-3 text-[11.5px] text-ink-2">
            {lines.map((l) => <span key={l.key} className="flex items-center gap-1.5"><span className="h-[2px] w-4 rounded" style={{ background: l.color }} />{l.label}</span>)}
          </div>
          <div className="flex rounded-lg border border-line bg-bg-2 p-0.5" role="tablist" aria-label="What to plot">
            {CHARTS.map((x) => (
              <button key={x.key} role="tab" aria-selected={x.key === m.key} onClick={() => setMetric(x.key)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium ${x.key === m.key ? "bg-panel text-ink shadow-[var(--shadow)]" : "text-muted hover:text-ink"}`}>{x.tab}</button>
            ))}
          </div>
        </div>
      </div>
      <ImpactChart lines={lines} t0={c.t0} t1={t1} now={now} integer={m.integer} unit={m.unit}
        shadeFrom={shadeFrom} shadeLabel="after the plan's 3-hour window: new trouble starts a new plan" />
    </section>
  );
}

function Empty() {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-[480px] text-center">
        <div className="text-[20px] font-semibold tracking-tight">Nothing has gone wrong yet</div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
          When something disrupts the airports, this page opens with the evening simulated twice: without SKYPACT and with it.
        </p>
      </div>
    </div>
  );
}
