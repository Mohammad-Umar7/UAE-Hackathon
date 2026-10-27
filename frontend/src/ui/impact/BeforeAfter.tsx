"use client";

import { ArrowRight, ArrowUpRight, Check, ChevronRight, Loader2, Play, ShieldCheck, Table2, UsersRound, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { proposalKey } from "@/core/agents/orchestrator";
import type { Proposal } from "@/core/approvals/workflow";
import type { SeriesPoint } from "@/core/solver/evaluate";
import type { Incident } from "@/core/types";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { approvalState, city, listOr, planChanges, workflowName } from "../story";
import { comparisons, contributions, examples, PLAN_WINDOW_S, type Comparison, type Outcome } from "./compare";
import { ImpactChart, type ChartLine } from "./ImpactChart";

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const hrs = (x: number) => (x < 10 ? x.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : n0(x));

const METRICS: { key: keyof Pick<Outcome, "fuel" | "holdingH" | "clashes" | "paxH">; text: (v: number) => string; fmt: (v: number) => string }[] = [
  { key: "fuel", fmt: n0, text: (v) => (Math.round(v) === 1 ? "low-fuel emergency diversion" : "low-fuel emergency diversions") },
  { key: "holdingH", fmt: hrs, text: () => "hours of circling, all planes added up" },
  { key: "clashes", fmt: n0, text: (v) => (Math.round(v) === 1 ? "plane lands to find its gate taken" : "planes land to find their gate taken") },
  { key: "paxH", fmt: n0, text: () => "hours of passenger delay, all passengers added up" },
];

const CHARTS: { key: string; tab: string; get: (s: SeriesPoint) => number; integer: boolean; unit: (v: number) => string; note: string }[] = [
  { key: "circling", tab: "Planes circling", get: (s) => s.circling, integer: true, unit: (v) => `${n0(v)} circling`, note: "planes in holding patterns at each moment" },
  { key: "fuel", tab: "Low-fuel diversions", get: (s) => s.fuelDiversions, integer: true, unit: (v) => `${n0(v)} diverted`, note: "running total of crews forced to divert on low fuel" },
  { key: "pax", tab: "Passenger delay", get: (s) => s.paxDelayH, integer: false, unit: (v) => `${n0(v)} h`, note: "running total, hours of delay over all passengers" },
];

function withoutStory(cause: Incident | null): string {
  switch (cause?.type) {
    case "FOG": return "Arrivals keep heading into the fog, but far fewer can land each hour. Planes stack up circling, and crews running low on fuel divert wherever they can.";
    case "THUNDERSTORM": return "Arrivals keep coming while the storm cuts how many can land. Planes stack up circling, and crews running low on fuel divert wherever they can.";
    case "RUNWAY_CLOSURE": return "With a runway closed, fewer planes can land each hour. Arrivals stack up circling, and crews running low on fuel divert wherever they can.";
    default: return "Each airport copes on its own. Planes wait in the air and on the ground, and crews running low on fuel divert wherever they can.";
  }
}

function withStory(p: Proposal): string {
  const to = [...new Set(p.plan.decisions.filter((d) => d.action === "divert").map((d) => city(d.to!)))];
  return to.length
    ? `Before anyone runs low on fuel, some flights are sent to ${listOr(to)} with a gate waiting, and the rest get landing times and gates planned ahead.`
    : "Flights get landing times and gates planned ahead, so fewer planes circle and nobody lands to find their gate taken.";
}

/** Simple mode's Results: the same evening without SKYPACT and with it, the plan in between, and what each agent did. */
export function BeforeAfter() {
  const rt = useRuntime();
  const { setView, select, setPresentation, presentation } = useOps();
  const all = comparisons(rt);
  const [pick, setPick] = useState<string | null>(null);
  const c = all.find((x) => x.thread === pick) ?? all[0];
  if (!c) return <Empty onDemo={() => setPresentation({ active: true, step: 0 })} onRun={() => { rt.setSpeed(30); rt.setRunning(true); }} />;
  const wf = rt.orchestrator.workflows.find((w) => w.id === c.thread);
  const name = wf ? workflowName(rt, wf) : "This disruption";
  const approvedAt = c.p?.history.find((h) => h.status === "COMMITTED")?.t;
  const openDecision = () => { if (c.p) select({ selectedProposal: proposalKey(c.p) }); setView("workbench"); };
  return (
    <div className={`scroll-y h-full space-y-3 p-3 ${presentation.active ? "pb-48" : ""}`}>
      <div className="flex flex-wrap items-start gap-3 px-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-semibold tracking-tight">Before &amp; after</h1>
          <p className="mt-0.5 max-w-[880px] text-[12.5px] leading-snug text-muted">
            {name}, simulated twice from the same moment ({fmtTime(c.t0)}): once if nobody acts, and once with the plan the agents built
            {c.stage === "committed" ? " and people approved" : ""}. Same flights, same weather.
          </p>
        </div>
        <StagePill c={c} approvedAt={approvedAt} />
      </div>
      {all.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11.5px] text-muted">
          Disruption:
          {all.map((x) => {
            const w = rt.orchestrator.workflows.find((y) => y.id === x.thread);
            return (
              <button key={x.thread} onClick={() => setPick(x.thread)} className={`pill ${x.thread === c.thread ? "pill-blue" : "pill-outline hover:bg-bg-2"}`}>
                {w ? workflowName(rt, w) : x.thread}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1.04fr)_28px_minmax(0,1fr)] items-stretch">
        <Side tone="bad" eyebrow="Without SKYPACT" title="If nobody acts" story={withoutStory(c.cause)} o={c.without}
          foot={examples(c.without).length > 0 && (
            <div className="mt-3 border-t border-line pt-2.5">
              <div className="eyebrow mb-1">For example</div>
              {examples(c.without).map((e) => <p key={e} className="text-[11.5px] leading-snug text-ink-2">{e}</p>)}
            </div>
          )} />
        <Arrow />
        <PlanCard c={c} approvedAt={approvedAt} onOpen={openDecision} />
        <Arrow />
        {c.with && c.p ? (
          <Side tone="good" eyebrow="With SKYPACT" title={c.stage === "committed" ? "With the approved plan" : "With the plan, if approved"} story={withStory(c.p)} o={c.with} base={c.without}
            foot={c.alone && (c.alone.fuel > c.with.fuel || c.alone.holdingH > c.with.holdingH + 1) && (
              <p className="mt-3 border-t border-line pt-2.5 text-[11.5px] leading-snug text-muted">
                Even if each airport rearranged its own gates, {n0(c.alone.fuel)} low-fuel {c.alone.fuel === 1 ? "diversion" : "diversions"} and {hrs(c.alone.holdingH)} hours
                of circling would remain. Coordinating all three airports is what closes the gap.
              </p>
            )} />
        ) : (
          <div className="grid place-items-center rounded-[var(--radius)] border border-dashed border-line-2 p-6 text-center">
            <div>
              <div className="eyebrow">With SKYPACT</div>
              <p className="mt-1.5 text-[13px] text-muted">Appears as soon as the agents finish the plan.</p>
            </div>
          </div>
        )}
      </div>

      <Unfolds c={c} now={rt.world.now} />
      <Helped c={c} />
      <p className="px-1 text-[11px] text-faint">
        All flights, airlines and passengers are synthetic. Both futures come from the same deterministic simulator, started from the same moment.
        Switch to Expert for the full evidence, the third baseline and the export.
      </p>
    </div>
  );
}

function StagePill({ c, approvedAt }: { c: Comparison; approvedAt?: number }) {
  if (c.stage === "predicting") return <span className="pill pill-amber">Prediction · the agents are still planning</span>;
  if (c.stage === "proposed") return <span className="pill pill-amber">Prediction · plan waiting for approval</span>;
  return <span className="pill pill-teal"><Check size={12} /> Plan approved{approvedAt !== undefined ? ` at ${fmtTime(approvedAt)}` : ""}{c.measured ? " · re-run from the moment of approval" : ""}</span>;
}

function Arrow() {
  return (
    <div className="grid place-items-center">
      <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-panel text-muted shadow-[var(--shadow)]"><ArrowRight size={13} /></span>
    </div>
  );
}

function Side({ tone, eyebrow, title, story, o, base, foot }: { tone: "bad" | "good"; eyebrow: string; title: string; story: string; o: Outcome; base?: Outcome; foot?: ReactNode }) {
  const color = tone === "bad" ? "var(--chart-bad)" : "var(--chart-good)";
  return (
    <section className="panel flex flex-col overflow-hidden" style={{ borderColor: `color-mix(in oklab, ${color} 30%, var(--line))` }}>
      <div className="h-[3px]" style={{ background: color }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          <span className={`grid h-6 w-6 place-items-center rounded-full ${tone === "bad" ? "bg-red-soft text-[var(--red)]" : "bg-teal-soft text-[var(--teal)]"}`}>
            {tone === "bad" ? <X size={14} /> : <Check size={14} />}
          </span>
          <span className="eyebrow">{eyebrow}</span>
        </div>
        <h2 className="mt-1.5 text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{story}</p>
        <ul className="mt-3 space-y-2">
          {METRICS.map((m) => {
            const v = o[m.key];
            const b = base?.[m.key];
            const pct = b !== undefined && b > 0 ? Math.round((100 * (v - b)) / b) : null;
            return (
              <li key={m.key} className="flex items-baseline gap-2">
                <span className="min-w-[78px] text-right text-[22px] font-semibold leading-none tracking-tight">{m.fmt(v)}</span>
                <span className="text-[12px] leading-snug text-ink-2">{m.text(v)}</span>
                {pct !== null && (
                  <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${pct < 0 ? "bg-teal-soft text-[var(--teal)]" : pct > 0 ? "bg-amber-soft text-[var(--amber)]" : "bg-bg-2 text-muted"}`}>
                    {pct === 0 ? "same" : `${pct < 0 ? "−" : "+"}${Math.abs(pct)}%`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-auto">{foot}</div>
      </div>
    </section>
  );
}

function PlanCard({ c, approvedAt, onOpen }: { c: Comparison; approvedAt?: number; onOpen: () => void }) {
  const rt = useRuntime();
  const role = useOps((s) => s.role);
  const p = c.p;
  if (!p) {
    const busy = rt.orchestrator.computing !== null || rt.held;
    return (
      <section className="panel flex flex-col p-4" style={{ borderColor: "color-mix(in oklab, var(--violet) 30%, var(--line))" }}>
        <span className="eyebrow">The plan</span>
        <h2 className="mt-1.5 text-[15px] font-semibold tracking-tight">The agents are working on it</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">
          The planning agent builds options with a mathematical optimiser and tests each one 4 hours ahead. A separate agent then re-checks
          every safety rule, and the plan goes to the people who must approve it.
        </p>
        <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
          {busy ? <><Loader2 size={14} className="animate-spin text-[var(--teal)]" /> Working now…</> : <><Play size={13} /> Run the clock to let them finish.</>}
        </div>
      </section>
    );
  }
  const a = approvalState(p, role);
  const checks = Object.values(p.validation.checks).reduce((s, x) => s + x, 0);
  const committed = c.stage === "committed";
  return (
    <section className="panel flex flex-col p-4" style={{ borderColor: "color-mix(in oklab, var(--violet) 32%, var(--line))" }}>
      <div className="flex items-center gap-2">
        <span className="eyebrow">The plan</span>
        <span className={`pill ${committed ? "pill-teal" : "pill-amber"}`}>{committed ? "Approved and running" : "Waiting for approval"}</span>
        <span className="ml-auto text-[11px] text-faint">version {p.version}</span>
      </div>
      <h2 className="mt-1.5 text-[15px] font-semibold tracking-tight">{committed ? "What the agents planned and people approved" : "What the agents propose"}</h2>
      <ul className="mt-2 space-y-1.5">
        {planChanges(p).map((x) => <li key={x} className="flex gap-2 text-[12.5px] leading-snug"><ChevronRight size={14} className="mt-[2px] shrink-0 text-[var(--violet)]" />{x}</li>)}
      </ul>
      <div className="mt-auto space-y-1.5 border-t border-line pt-2.5 text-[12px] text-ink-2">
        <div className="flex items-start gap-2"><ShieldCheck size={14} className={`mt-[1px] shrink-0 ${p.validation.valid ? "text-[var(--teal)]" : "text-[var(--red)]"}`} />
          {p.validation.valid ? `Passed the safety check: ${n0(checks)} rules re-checked by a separate agent` : "Failed the safety check, so it cannot be approved"}</div>
        <div className="flex items-start gap-2"><UsersRound size={14} className="mt-[1px] shrink-0 text-muted" />
          {committed ? `Approved by all ${a.total} people${approvedAt !== undefined ? ` at ${fmtTime(approvedAt)}` : ""}; nothing ran before that` : `${a.done} of ${a.total} people have approved; nothing runs until all agree`}</div>
        <button className="btn btn-sm mt-1" onClick={onOpen}>Open the decision <ArrowUpRight size={13} /></button>
      </div>
    </section>
  );
}

function Unfolds({ c, now }: { c: Comparison; now: number }) {
  const [metric, setMetric] = useState(CHARTS[0].key);
  const [table, setTable] = useState(false);
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
          <button className={`btn btn-sm ${table ? "btn-primary" : ""}`} onClick={() => setTable((v) => !v)} title="Show the same numbers as a table"><Table2 size={13} /> Table</button>
        </div>
      </div>
      {table ? <NumbersTable lines={lines} unit={m.unit} /> : (
        <ImpactChart lines={lines} t0={c.t0} t1={t1} now={now} integer={m.integer} unit={m.unit}
          shadeFrom={shadeFrom} shadeLabel="after the plan's 3-hour window: new trouble starts a new plan" />
      )}
    </section>
  );
}

function NumbersTable({ lines, unit }: { lines: ChartLine[]; unit: (v: number) => string }) {
  const rows = lines[0].values.filter((_, i) => i % 6 === 0);
  return (
    <div className="max-h-[260px] overflow-auto px-4 pb-3">
      <table className="table">
        <thead><tr><th>Time</th>{lines.map((l) => <th key={l.key}>{l.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t}>
              <td className="mono text-[12px]">{fmtTime(r.t)}</td>
              {lines.map((l) => <td key={l.key} className="mono text-[12px] tabular-nums">{unit(l.values.find((p) => p.t === r.t)?.v ?? 0)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Helped({ c }: { c: Comparison }) {
  const rt = useRuntime();
  const role = useOps((s) => s.role);
  const { setView } = useOps();
  const steps = contributions(rt, c);
  if (!steps.length) return null;
  const a = c.p ? approvalState(c.p, role) : null;
  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <div className="panel-t">How the agents helped</div>
        <span className="text-[11.5px] text-muted">seven agents, one job each — and people make the decision</span>
        <button className="btn btn-sm ml-auto" onClick={() => setView("agents")}>Watch the agents <ArrowUpRight size={13} /></button>
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.id} className="rounded-lg border border-line bg-panel-2 p-2.5">
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold text-white" style={{ background: s.color }}>{i + 1}</span>
              <span className="text-[12px] font-semibold">{s.who}</span>
              {s.t !== null && <span className="mono ml-auto text-[10.5px] text-faint">{fmtTime(s.t)}</span>}
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-muted">{s.text}</p>
          </li>
        ))}
        {a && c.p && (
          <li className="rounded-lg border p-2.5" style={{ borderColor: "color-mix(in oklab, var(--teal) 35%, var(--line))", background: "color-mix(in oklab, var(--teal-soft) 60%, transparent)" }}>
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--teal)] text-white"><UsersRound size={11} /></span>
              <span className="text-[12px] font-semibold">People in charge</span>
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-muted">
              {c.stage === "committed" ? `All ${a.total} approved: airports, airlines, air-traffic control and the supervisor. Only then did the plan run.`
                : `${a.done} of ${a.total} have approved so far. The plan runs only when every one of them says yes.`}
            </p>
          </li>
        )}
      </ol>
    </section>
  );
}

function Empty({ onDemo, onRun }: { onDemo: () => void; onRun: () => void }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="panel max-w-[560px] p-8 text-center">
        <div className="text-[18px] font-semibold tracking-tight">Before &amp; after</div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          When something disrupts the airports, such as the fog that reaches Abu Dhabi at 18:00, this page shows what would happen without
          SKYPACT, the plan the agents build, and what happens with it. Nothing has happened yet.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn btn-primary" onClick={onDemo}><Play size={14} /> Watch the guided demo</button>
          <button className="btn" onClick={onRun}>Run the clock</button>
        </div>
      </div>
    </div>
  );
}
