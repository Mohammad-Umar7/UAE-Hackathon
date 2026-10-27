"use client";

import { ArrowRight, X } from "lucide-react";
import { AGENTS } from "@/core/agents/definitions";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { Json } from "../common/Json";
import { participantColor, participantLabel } from "./CoordinationLog";

/** Right-hand drawer: full evidence for one agent tool call or message. */
export function Inspector() {
  const rt = useRuntime();
  const { inspect, setInspect } = useOps();
  if (!inspect) return null;
  const o = rt.orchestrator;
  const action = inspect.kind === "action" ? o.actions.find((a) => a.id === inspect.id) : undefined;
  const message = inspect.kind === "message" ? o.messages.find((m) => m.id === inspect.id) : undefined;
  if (!action && !message) return null;
  const wf = o.workflows.find((w) => w.id === (action?.thread ?? message?.thread));
  const proposal = wf ? Object.values(rt.proposals).filter((p) => p.thread === wf.id).sort((a, b) => b.createdAt - a.createdAt)[0] : undefined;
  const lp = Array.isArray(action?.result)
    ? (action.result as { modelExcerpt?: unknown; label?: string }[]).find((x) => typeof x?.modelExcerpt === "string") as { modelExcerpt: string; label?: string } | undefined
    : undefined;
  return (
    <aside className="panel fade-in fixed bottom-3 right-3 top-[62px] z-40 flex w-[460px] flex-col overflow-hidden shadow-[var(--shadow-2)]">
      <div className="panel-h">
        <div>
          <div className="eyebrow">{action ? "Tool call" : "Agent message"} · {action?.id ?? message?.id}</div>
          <div className="mt-0.5 text-[14px] font-semibold">
            {action ? <><span style={{ color: AGENTS[action.agent].color }}>{AGENTS[action.agent].name}</span> <span className="mono text-ink-2">· {action.tool}()</span></>
              : <><span style={{ color: participantColor(message!.from) }}>{participantLabel(message!)}</span> <span className="text-ink-2">· {message!.type}</span></>}
          </div>
        </div>
        <button className="btn btn-ghost h-7 w-7 justify-center p-0" onClick={() => setInspect(null)}><X size={14} /></button>
      </div>
      <div className="scroll-y min-h-0 flex-1 space-y-4 p-4">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          <dt className="text-muted">Simulation time</dt><dd className="mono">{fmtTime((action ?? message)!.t, true)} GST</dd>
          <dt className="text-muted">Wall clock</dt><dd className="mono">{new Date((action ?? message)!.wall).toLocaleTimeString()}</dd>
          <dt className="text-muted">Workflow</dt><dd>{wf ? `${wf.id} · ${wf.title}` : "—"}</dd>
          {action && <><dt className="text-muted">Duration</dt><dd className="mono">{action.durationMs.toFixed(1)} ms</dd>
            <dt className="text-muted">Status</dt><dd><span className={`pill ${action.status === "ok" ? "pill-teal" : "pill-red"}`}>{action.status}</span></dd></>}
          {message && <><dt className="text-muted">To</dt><dd>{message.to.map((t) => (t in AGENTS ? AGENTS[t as keyof typeof AGENTS].short : t)).join(", ")}</dd></>}
          {proposal && <><dt className="text-muted">Approval status</dt><dd>{proposal.id} v{proposal.version} · <span className="font-semibold">{proposal.status}</span></dd></>}
        </dl>
        {action && (
          <>
            <Section title="Result summary"><p className="text-[12.5px] leading-relaxed text-ink">{action.summary}</p></Section>
            <Section title="Parameters"><Json value={action.params} /></Section>
            {action.constraints && <Section title="Constraints considered"><div className="flex flex-wrap gap-1.5">{action.constraints.map((c) => <span key={c} className="pill pill-outline">{c}</span>)}</div></Section>}
            {lp && (
              <Section title={`Model sent to HiGHS · ${lp.label ?? "first variant"} (first lines, LP format)`}>
                <pre className="mono max-h-[240px] overflow-auto rounded-md border border-line bg-bg-2 p-2 text-[10.5px] leading-snug text-ink-2">{lp.modelExcerpt}</pre>
              </Section>
            )}
            <Section title="Tool output (recorded)"><Json value={action.result} /></Section>
            <Section title="Authority">
              <p className="text-[12px] text-muted">{AGENTS[action.agent].name} may call: <span className="mono text-ink-2">{AGENTS[action.agent].tools.join(", ")}</span>. It cannot: {AGENTS[action.agent].cannot.join("; ").toLowerCase()}.</p>
            </Section>
            <Links ids={[...(action.trigger ? [action.trigger] : []), ...action.outputs]} label="Triggered by / produced" />
          </>
        )}
        {message && (
          <>
            <Section title="Summary"><p className="text-[12.5px] leading-relaxed text-ink">{message.summary}</p></Section>
            <Section title="Structured payload"><Json value={message.payload} /></Section>
            <Links ids={message.causedBy ? [message.causedBy] : []} label="Caused by" />
            <RelatedActions messageId={message.id} />
          </>
        )}
        <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
          Records are produced by deterministic agents calling real tools on the simulation state. Hidden reasoning is not shown; the evidence is the inputs, tool calls and outputs above.
        </p>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="eyebrow mb-1.5">{title}</div>
      {children}
    </section>
  );
}

function Links({ ids, label }: { ids: string[]; label: string }) {
  const rt = useRuntime();
  const setInspect = useOps((s) => s.setInspect);
  if (!ids.length) return null;
  return (
    <Section title={label}>
      <div className="space-y-1">
        {ids.map((id) => {
          const m = rt.orchestrator.messages.find((x) => x.id === id);
          return (
            <button key={id} onClick={() => setInspect({ kind: "message", id })} className="flex w-full items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-bg-2">
              <ArrowRight size={12} className="text-faint" />
              <span className="mono text-[11px] text-muted">{id}</span>
              <span className="truncate text-[12px]">{m ? `${m.type}: ${m.summary}` : ""}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function RelatedActions({ messageId }: { messageId: string }) {
  const rt = useRuntime();
  const setInspect = useOps((s) => s.setInspect);
  const acts = rt.orchestrator.actions.filter((a) => a.outputs.includes(messageId) || a.trigger === messageId);
  if (!acts.length) return null;
  return (
    <Section title="Tool calls linked to this message">
      <div className="space-y-1">
        {acts.map((a) => (
          <button key={a.id} onClick={() => setInspect({ kind: "action", id: a.id })} className="flex w-full items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-bg-2">
            <span className="text-[11px] font-semibold" style={{ color: AGENTS[a.agent].color }}>{AGENTS[a.agent].short}</span>
            <span className="mono text-[11px]">{a.tool}()</span>
            <span className="truncate text-[11.5px] text-muted">{a.summary}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}
