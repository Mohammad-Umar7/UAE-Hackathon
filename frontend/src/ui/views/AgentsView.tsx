"use client";

import { Info } from "lucide-react";
import { useState } from "react";
import { AGENT_ORDER, AGENTS } from "@/core/agents/definitions";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { AgentGraph } from "../agents/AgentGraph";
import { AgentsStage } from "../agents/AgentsStage";
import { CoordinationLog } from "../agents/CoordinationLog";
import { Sequence } from "../agents/Sequence";

const WF_TONE: Record<string, string> = {
  analysing: "pill-blue", awaiting_approval: "pill-amber", replanning: "pill-amber", committed: "pill-teal", closed: "pill-gray", escalated: "pill-red",
};

export default function AgentsView() {
  const expert = useOps((s) => s.detail === "expert");
  return expert ? <ExpertAgents /> : <AgentsStage />;
}

/** Expert mode: the coordination graph, the swim-lane sequence or agent roster, and the full message and tool log. */
function ExpertAgents() {
  const rt = useRuntime();
  const o = rt.orchestrator;
  const [thread, setThread] = useState<string | null>(null);
  const [tab, setTab] = useState<"sequence" | "roster">("sequence");
  const acts = o.actions.filter((a) => !thread || a.thread === thread);
  const msgs = o.messages.filter((m) => !thread || m.thread === thread);
  const solver = acts.filter((a) => a.tool === "run_optimizer");
  const avg = acts.length ? acts.reduce((s, a) => s + a.durationMs, 0) / acts.length : 0;
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[16px] font-semibold tracking-tight">Agent coordination</div>
          <div className="text-[12px] text-muted">Seven deterministic agents calling real tools on the shared operational picture; humans approve.</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Metric label="Messages" value={String(msgs.length)} />
          <Metric label="Tool calls" value={String(acts.length)} />
          <Metric label="Avg tool time" value={`${avg.toFixed(avg < 10 ? 1 : 0)} ms`} />
          <Metric label="Optimiser runs" value={String(solver.length)} />
          <Metric label="Mode" value={rt.llm?.available ? "Deterministic + local LLM briefings" : "Deterministic (offline)"} wide />
        </div>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <button className={`btn btn-sm ${thread === null ? "btn-primary" : ""}`} onClick={() => setThread(null)}>All workflows</button>
        {o.workflows.map((w) => (
          <button key={w.id} className={`btn btn-sm max-w-[320px] ${thread === w.id ? "btn-primary" : ""}`} onClick={() => setThread(w.id)}>
            <span className="mono">{w.id}</span>
            <span className="truncate">{w.title}</span>
            <span className={`pill ${WF_TONE[w.status]}`} style={{ height: 16, fontSize: 9.5 }}>{w.status.replace("_", " ")}</span>
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_430px] gap-3">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="panel relative min-h-[300px] flex-[1.25] overflow-hidden p-2">
            <AgentGraph thread={thread} />
            <div className="absolute bottom-2 left-3 flex items-center gap-3 text-[10.5px] text-muted">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--amber)]" /> pending</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--teal)]" /> approved</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--red)]" /> rejected</span>
              <span>· dots travelling on edges are live messages · click a node for its latest message</span>
            </div>
          </div>
          <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="panel-h">
              <div className="flex items-center gap-1">
                <button className={`btn btn-sm ${tab === "sequence" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("sequence")}>Sequence</button>
                <button className={`btn btn-sm ${tab === "roster" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("roster")}>Agent roster &amp; authority</button>
              </div>
              <span className="text-[11px] text-muted">{tab === "sequence" ? "Message order within the workflow · click to inspect" : "Each agent's tools, inputs, outputs and limits"}</span>
            </div>
            <div className="min-h-0 flex-1 p-2">{tab === "sequence" ? <Sequence thread={thread} /> : <Roster />}</div>
          </div>
        </div>
        <div className="panel flex min-h-0 flex-col overflow-hidden">
          <div className="panel-h">
            <div className="panel-t">Coordination log</div>
            <span className="flex items-center gap-1 text-[11px] text-muted"><Info size={12} /> messages and tool calls, as recorded</span>
          </div>
          <div className="min-h-0 flex-1"><CoordinationLog thread={thread} /></div>
          <WorkflowFooter thread={thread} />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-lg border border-line bg-panel px-2.5 py-1 ${wide ? "max-w-[240px]" : ""}`}>
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`truncate font-semibold ${wide ? "text-[11.5px]" : "mono text-[13px]"}`}>{value}</div>
    </div>
  );
}

function Roster() {
  return (
    <div className="scroll-y grid h-full grid-cols-2 gap-2 xl:grid-cols-3">
      {AGENT_ORDER.map((id) => {
        const a = AGENTS[id];
        return (
          <div key={id} className="rounded-lg border border-line bg-panel-2 p-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded" style={{ background: a.color }} />
              <span className="font-semibold">{a.name}</span>
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-muted">{a.role}</p>
            <div className="mt-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Tools</div>
            <div className="mt-1 flex flex-wrap gap-1">{a.tools.map((t) => <span key={t} className="mono rounded bg-bg-2 px-1.5 py-0.5 text-[10.5px]">{t}</span>)}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">Consumes</div>{(a.consumes.length ? a.consumes : ["simulator events"]).map((c) => <div key={c} className="text-ink-2">{c}</div>)}</div>
              <div><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">Produces</div>{a.produces.map((c) => <div key={c} className="text-ink-2">{c}</div>)}</div>
            </div>
            <div className="mt-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Cannot</div>
            <ul className="mt-0.5 list-disc pl-4 text-[11px] text-[var(--red)]">{a.cannot.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        );
      })}
    </div>
  );
}

function WorkflowFooter({ thread }: { thread: string | null }) {
  const rt = useRuntime();
  const wf = rt.orchestrator.workflows.find((w) => w.id === thread) ?? rt.orchestrator.workflows[rt.orchestrator.workflows.length - 1];
  if (!wf) return null;
  return (
    <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
      <span className="mono">{wf.id}</span> started {fmtTime(wf.startedAt, true)} · {wf.airports.join(", ")} · {wf.proposals.length} proposal version{wf.proposals.length === 1 ? "" : "s"}
    </div>
  );
}
