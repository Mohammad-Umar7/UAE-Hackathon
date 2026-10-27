"use client";

import { ShieldCheck } from "lucide-react";
import { fmtTime } from "@/core/world";
import type { CommittedEvidence } from "@/core/runtime";
import { useOps, useRuntime } from "@/store/ops";
import { num } from "../common/format";

const PROVENANCE: [string, string, string][] = [
  ["Runway geometry, thresholds, bearings, elevation", "verified_public", "UAE GCAA eAIP AD 2 (AIRAC 12/2026) via data/reference"],
  ["Taxiways, aprons, stands, building footprints", "verified_public / derived", "OpenStreetMap (ODbL); stand limits derived from spacing"],
  ["Stand capabilities, jet bridges, services", "derived", "Heuristics from public geometry — requires operator validation"],
  ["Runway capacities, diversion limits, resources", "synthetic", "Plausible planning values for the demo"],
  ["Flight schedules, carriers, passengers", "synthetic", "Seeded generator; fictional carriers only"],
  ["Weather observations and forecasts", "synthetic", "Locally generated tracks (no weather API)"],
  ["Incidents and restrictions", "synthetic / human_entered / stakeholder_reported", "Scenario inputs, Scenario Lab, coordination"],
  ["Aircraft dimensions", "verified_public", "Rounded public figures for the aircraft categories"],
  ["Delay, holding, conflict metrics", "derived", "Computed by the deterministic simulator"],
];

export default function EvidenceView() {
  const rt = useRuntime();
  const { toast, setPresentation } = useOps();
  const expert = useOps((st) => st.detail === "expert");
  const o = rt.orchestrator;
  const outcome = rt.outcome();
  const solves = o.actions.filter((a) => a.tool === "run_optimizer");
  const props = Object.values(rt.proposals);
  const committed = props.filter((p) => p.status === "COMMITTED");
  const rejected = props.filter((p) => p.status === "REJECTED");
  const requests = o.messages.filter((m) => m.type === "CoordinationRequest").length;
  const responses = props.flatMap((p) => p.approvals.filter((a) => a.t !== undefined && a.decision !== "PENDING").map((a) => ({ sim: (a.t! - a.requestedAt) / 60, human: a.mode === "human" })));
  const humanResp = responses.filter((r) => r.human);
  const audit = rt.audit.verify();
  const ev = rt.evidence[rt.evidence.length - 1];
  return (
    <div className="scroll-y h-full space-y-3 p-3">
      <div className="flex items-center gap-3">
        <div>
          <div className={`${expert ? "text-[16px]" : "text-[18px]"} font-semibold tracking-tight`}>{expert ? "Performance & evidence" : "Results"}</div>
          <div className="text-[12px] text-muted">{expert ? "Every number below is computed from the simulator or the recorded workflow. Nothing is entered by hand."
            : "What the approved plan achieved, measured against doing nothing: three simulations from the same starting point, nothing typed in by hand."}</div>
        </div>
        <span className={`pill ml-auto ${audit.ok ? "pill-teal" : "pill-red"}`}><ShieldCheck size={12} /> audit chain {audit.ok ? `verified (${rt.audit.entries.length} records)` : `broken at #${audit.brokenAt}`}</span>
        <button className="btn btn-sm" onClick={() => {
          const blob = new Blob([JSON.stringify({ scenario: rt.scenario.id, seed: rt.seed, inputs: rt.inputs, audit: rt.audit.entries, evidence: rt.evidence,
            proposals: Object.values(rt.proposals).map((p) => ({ id: p.id, version: p.version, status: p.status, kpis: p.plan.kpis, approvals: p.approvals, history: p.history })) }, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `skypact-evidence-${rt.scenario.id}-seed${rt.seed}.json`;
          a.click();
          toast("Evidence pack exported (JSON)", "ok");
        }}>Export evidence pack</button>
      </div>

      {!expert && (ev ? <Headline ev={ev} /> : (
        <div className="panel p-8 text-center">
          <div className="text-[16px] font-semibold">No results yet</div>
          <p className="mx-auto mt-1 max-w-lg text-[13px] text-muted">Results appear once a recovery plan has been approved and is running. The guided demo gets there in about three minutes.</p>
          <button className="btn btn-primary mt-4" onClick={() => setPresentation({ active: true, step: 0 })}>Watch the guided demo</button>
        </div>
      ))}

      {expert && <div className="grid grid-cols-4 gap-3">
        <Kpi label="Total delay so far (arr + dep)" value={`${num(outcome.totalDelayMin)} min`} sub={`${outcome.arrivals} arrivals · ${outcome.departures} departures since ${fmtTime(rt.scenario.start)}`} />
        <Kpi label="Airborne holding" value={`${num(outcome.airborneHoldingMin)} min`} sub={`${outcome.groundWaitMin.toFixed(0)} min ground wait for stands`} />
        <Kpi label="Diversions" value={`${outcome.diversionsCoordinated} coordinated · ${outcome.diversionsUnplanned} unplanned`} sub="unplanned = crew minimum-fuel decision" />
        <Kpi label="Passengers needing assistance — service delays" value={String(outcome.prmServiceDelays)} sub={`${Math.round(outcome.prmWaitMin)} min total waiting for an ambulift`} tone={outcome.prmServiceDelays ? "red" : undefined} />
      </div>}

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3">
        <div className="panel overflow-hidden">
          <div className="panel-h">
            <div>
              <div className="panel-t">{expert ? "Before / after — latest committed plan" : "Side by side"}</div>
              <div className="text-[11px] text-muted">{ev ? `${ev.proposal} committed ${fmtTime(ev.t, true)}; three ground-truth simulations from the same pre-commit state, 4 h horizon (${ev.computeMs} ms)` : "Available once a plan is committed."}</div>
            </div>
          </div>
          {ev ? (
            <div className="space-y-3 p-4">
              {(expert
                ? [["Total delay (min)", "totalDelayMin"], ["Passenger delay (pax·h)", "paxDelayHours"], ["Airborne holding (min)", "airborneHoldingMin"], ["Ground wait for stand (min)", "groundWaitMin"],
                  ["Stand conflicts", "standConflicts"], ["Uncoordinated fuel diversions", "fuelDiversions"]] as const
                : [["Time spent circling (minutes)", "airborneHoldingMin"], ["Emergency fuel diversions", "fuelDiversions"], ["Passenger delay (hours, all passengers)", "paxDelayHours"],
                  ["Gate clashes", "standConflicts"], ["Waiting on the ground for a gate (minutes)", "groundWaitMin"], ["Total flight delay (minutes)", "totalDelayMin"]] as const).map(([label, k]) => {
                const vals = [ev.noAction[k], ev.localGreedy[k], ev.plan[k]] as number[];
                const mx = Math.max(...vals, 1);
                return (
                  <div key={k}>
                    <div className="mb-1 flex items-center text-[12px]"><span className="font-medium">{label}</span>
                      <Change base={vals[0]} plan={vals[2]} /></div>
                    {(expert ? ["No coordinated action", "Local-only reassignment", "SKYPACT plan"] : ["Doing nothing", "Each airport on its own", "With SKYPACT"]).map((n, i) => (
                      <div key={n} className="flex items-center gap-2 py-0.5">
                        <span className="w-[150px] text-[11px] text-muted">{n}</span>
                        <div className="h-3 flex-1 rounded bg-bg-2"><div className="h-3 rounded" style={{ width: `${(100 * vals[i]) / mx}%`, background: i === 2 ? "var(--teal)" : i === 1 ? "var(--navy-2)" : "var(--faint)" }} /></div>
                        <span className="mono w-16 text-right text-[11.5px]">{num(vals[i], vals[i] % 1 ? 1 : 0)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {expert && <p className="text-[11px] leading-relaxed text-faint">Baselines: “no coordinated action” keeps planned stands, aircraft wait for them, and crews divert when holding fuel runs out; “local-only” lets each airport reassign its own stands first-fit without network coordination; the SKYPACT plan applies its decisions and handles everything else exactly like local-only, so the difference between the two is the value of network coordination. All three use the same synthetic inputs and censor flights not completed within the horizon.</p>}
              {!expert && <p className="text-[11px] leading-relaxed text-faint">“Each airport on its own” moves aircraft to free gates locally but nobody coordinates across airports; “With SKYPACT” does the same plus the approved plan, so the gap between the two is what coordination adds. Synthetic traffic.</p>}
            </div>
          ) : <div className="p-6 text-center text-muted">Run Operation Nightfall and approve a plan to generate measured before/after evidence.</div>}
        </div>
        <div className="space-y-3">
          {expert && <div className="panel">
            <div className="panel-h"><div className="panel-t">Optimiser</div><span className="text-[11px] text-muted">HiGHS MILP · WebAssembly · in-browser</span></div>
            <div className="grid grid-cols-2 gap-2 p-3">
              <Stat label="Optimiser runs" value={String(solves.length)} />
              <Stat label="Median solve wall time" value={solves.length ? `${num(median(solves.map((s) => s.durationMs)))} ms` : "—"} />
              <Stat label="Largest model" value={`${num(Math.max(0, ...props.map((p) => p.plan.numVars)))} vars`} />
              <Stat label="Options pruned by hard rules" value={num(props.reduce((s, p) => s + p.plan.prunedOptions, 0))} />
            </div>
          </div>}
          <div className="panel">
            <div className="panel-h"><div className="panel-t">{expert ? <>Coordination &amp; human oversight</> : "How it was decided"}</div></div>
            <div className="grid grid-cols-2 gap-2 p-3">
              <Stat label={expert ? "Coordination requests" : "Approval requests sent"} value={String(requests)} />
              <Stat label={expert ? "Plan versions / revisions" : "Plan versions"} value={expert ? `${props.length} / ${Math.max(0, props.length - new Set(props.map((p) => p.thread)).size)}` : String(props.length)} />
              <Stat label={expert ? "Rejected by stakeholders" : "Times someone said no"} value={String(rejected.length)} tone={rejected.length ? "amber" : undefined} />
              <Stat label={expert ? "Committed after approval" : "Plans approved and run"} value={String(committed.length)} tone="teal" />
              {expert && <Stat label="Median response (sim min)" value={responses.length ? num(median(responses.map((r) => r.sim)), 1) : "—"} />}
              <Stat label={expert ? "Human decisions" : "Decisions by a person"} value={`${humanResp.length}`} />
              <Stat label={expert ? "Agent tool calls" : "Tools used by the agents"} value={String(o.actions.length)} />
              <Stat label={expert ? "Unauthorised actions blocked" : "Actions outside an agent's rights"} value={String(o.actions.filter((a) => a.status === "blocked").length)} />
            </div>
          </div>
        </div>
      </div>

      {!expert && <p className="px-1 text-[11.5px] text-faint">All flights, airlines and passenger numbers are synthetic; airport maps come from OpenStreetMap. Switch to Expert for data provenance, optimiser statistics and the evidence export.</p>}
      {expert && <div className="panel overflow-hidden">
        <div className="panel-h"><div className="panel-t">Data provenance</div><span className="text-[11px] text-muted">Synthetic data is never presented as real operational data</span></div>
        <table className="table">
          <thead><tr><th>Input</th><th>Provenance</th><th>Source</th></tr></thead>
          <tbody>
            {PROVENANCE.map(([a, b, c]) => (
              <tr key={a}><td className="text-[12px]">{a}</td><td><span className={`pill ${b.startsWith("verified") ? "pill-teal" : b.startsWith("synthetic") ? "pill-amber" : "pill-blue"}`}>{b}</span></td><td className="text-[12px] text-muted">{c}</td></tr>
            ))}
            <tr><td className="text-[12px]">Airport layout source in this session</td><td colSpan={2} className="text-[12px] text-muted">{Object.entries(useOps.getState().sources).map(([k, v]) => `${k}: ${v === "osm" ? "OpenStreetMap-derived layout" : "fixture layout (OSM data pending)"}`).join(" · ")}</td></tr>
          </tbody>
        </table>
      </div>}
    </div>
  );
}

/** Simple mode: the four effects that matter most, big. */
function Headline({ ev }: { ev: CommittedEvidence }) {
  const items: [string, string, string][] = [
    ["airborneHoldingMin", "Time spent circling", "min"], ["fuelDiversions", "Emergency fuel diversions", ""],
    ["paxDelayHours", "Passenger delay", "h"], ["standConflicts", "Gate clashes", ""],
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map(([k, label, unit]) => {
        const a = Number((ev.noAction as unknown as Record<string, number>)[k] ?? 0), b = Number((ev.plan as unknown as Record<string, number>)[k] ?? 0);
        const pct = a ? Math.round((100 * (b - a)) / a) : 0;
        return (
          <div key={k} className="panel p-4">
            <div className="text-[12.5px] font-medium text-ink-2">{label}</div>
            <div className={`mt-1 text-[30px] font-semibold tracking-tight ${pct < 0 ? "text-[var(--teal)]" : pct > 0 ? "text-[var(--amber)]" : "text-muted"}`}>{a ? `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%` : "—"}</div>
            <div className="mono text-[11.5px] text-muted">{Math.round(a).toLocaleString("en-GB")} → {Math.round(b).toLocaleString("en-GB")}{unit ? ` ${unit}` : ""} with the plan</div>
          </div>
        );
      })}
    </div>
  );
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "red" }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mono mt-1 text-[20px] font-semibold tracking-tight ${tone === "red" ? "text-[var(--red)]" : ""}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-faint">{sub}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "teal" | "amber" }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 px-2.5 py-2">
      <div className="text-[10.5px] text-muted">{label}</div>
      <div className={`mono text-[14px] font-semibold ${tone === "teal" ? "text-[var(--teal)]" : tone === "amber" ? "text-[var(--amber)]" : ""}`}>{value}</div>
    </div>
  );
}

/** Plan vs no action for a lower-is-better metric: "−55 % lower" in teal, "+4 % higher" in amber. */
function Change({ base, plan }: { base: number; plan: number }) {
  if (!base) return <span className="ml-auto text-[11px] text-muted">{plan ? "new vs no action" : "same as no action"}</span>;
  const pct = Math.round((100 * (plan - base)) / base);
  if (pct === 0) return <span className="ml-auto text-[11px] text-muted">same as no action</span>;
  return (
    <span className={`ml-auto text-[11px] font-semibold ${pct < 0 ? "text-[var(--teal)]" : "text-[var(--amber)]"}`}>
      {pct < 0 ? `−${Math.abs(pct)} % lower` : `+${pct} % higher`} than no action
    </span>
  );
}
