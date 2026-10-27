"use client";

import { ArrowLeft, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { AGENT_ORDER, AGENTS } from "@/core/agents/definitions";
import { isOpen } from "@/core/approvals/workflow";
import { useRuntime } from "@/store/ops";
import { agentStory, PLAIN_AGENT, PLAIN_JOB, whoSaid, workflowName, type StoryStep } from "../story";
import { AgentConstellation, SPOTS } from "./AgentConstellation";
import { AgentStory } from "./AgentStory";
import { slotNode } from "./model";

const STEP_MS = 1100;

const PEOPLE: Record<string, string> = {
  "sh:NATIONAL_SUPERVISOR": "Has the final say: nothing runs until the national supervisor approves. In this demo, that is you.",
  "sh:OMAA": "Knows Abu Dhabi's own gates, ground crews and equipment, and approves or rejects the parts of a plan that land there.",
  "sh:OMDB": "Knows Dubai's own gates, ground crews and equipment, and approves or rejects the parts of a plan that land there.",
  "sh:OMSJ": "Knows Sharjah's own gates, ground crews and equipment — including things the network does not know yet.",
  "sh:AIRLINES": "Each airline approves the changes to its own flights.",
  "sh:ATC": "Real air-traffic controllers review landing times and diversions. SKYPACT never gives instructions to pilots.",
};

/** The AI agents page in Simple mode: an interactive scene, the story of what happened, and a card per agent. */
export function AgentsStage() {
  const rt = useRuntime();
  const o = rt.orchestrator;
  const [thread, setThread] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<StoryStep | null>(null);
  const [tab, setTab] = useState<"story" | "meet">("story");
  const [replayStart, setReplayStart] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const steps = agentStory(rt, thread);
  const total = steps.length;
  useEffect(() => {
    if (replayStart === null) return;
    let raf = 0;
    const loop = () => {
      const t = Date.now();
      if (t - replayStart >= total * STEP_MS) { setReplayStart(null); return; }
      setNow(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replayStart, total]);
  const elapsed = replayStart !== null ? Math.max(0, now - replayStart) : 0;
  const ri = replayStart !== null ? Math.min(total - 1, Math.floor(elapsed / STEP_MS)) : -1;
  const step = ri >= 0 ? steps[ri] : null;
  const msg = step ? o.messages.find((m) => m.id === step.id) ?? null : null;
  const focus = step ? step.nodes : hover ? hover.nodes : null;
  const working = o.computing !== null || rt.held;

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold tracking-tight">AI agents at work</div>
          <div className="text-[12.5px] text-muted">Seven software agents, each with one job, pass messages and use tools to build a plan. People make the decision.</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button className={`btn btn-sm ${thread === null ? "btn-primary" : ""}`} onClick={() => setThread(null)}>Everything</button>
          {o.workflows.map((w) => (
            <button key={w.id} className={`btn btn-sm max-w-[260px] ${thread === w.id ? "btn-primary" : ""}`} onClick={() => setThread(w.id)} title={w.title}>
              <span className="truncate">{workflowName(rt, w)}</span>
            </button>
          ))}
          {replayStart === null ? (
            <button className="btn btn-sm btn-teal" disabled={!total} onClick={() => { setSelected(null); setTab("story"); setNow(Date.now()); setReplayStart(Date.now()); }}>
              <Play size={12} /> Replay the conversation
            </button>
          ) : (
            <button className="btn btn-sm" onClick={() => setReplayStart(null)}><Square size={11} /> Stop replay</button>
          )}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] gap-3">
        <div className="relative min-h-0 overflow-hidden rounded-[14px] border border-[#1c2a3c]"
          style={{ background: "radial-gradient(120% 95% at 35% 15%, #19304a 0%, #0d1a2a 55%, #08111b 100%)" }}>
          <div className="absolute inset-0 opacity-[0.22]" style={{ backgroundImage: "radial-gradient(rgba(160,190,230,0.35) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
          <div className="absolute inset-0 p-3">
            <AgentConstellation thread={thread} selected={selected} focus={focus} onSelect={(id) => { setSelected(id); }} replay={msg ? { msg, t: (elapsed % STEP_MS) / (STEP_MS * 0.8) } : null} />
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/[0.07] px-3 py-1 text-[11px] text-white/70 backdrop-blur-sm">
            {step ? `Replaying step ${ri + 1} of ${total}` : working ? "The agents are working right now — the clock waits for them" : "Click an agent to see what it does · moving dots are messages"}
          </div>
        </div>
        <div className="panel flex min-h-0 flex-col overflow-hidden">
          {selected ? (
            <AgentCard id={selected} thread={thread} onBack={() => setSelected(null)} />
          ) : (
            <>
              <div className="panel-h">
                <div className="flex items-center gap-1">
                  <button className={`btn btn-sm ${tab === "story" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("story")}>What happened</button>
                  <button className={`btn btn-sm ${tab === "meet" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("meet")}>Meet the agents</button>
                </div>
                <span className="text-[11px] text-muted">{tab === "story" ? `${total} step${total === 1 ? "" : "s"}` : "7 agents · 6 kinds of people"}</span>
              </div>
              <div className="min-h-0 flex-1">
                {tab === "story" ? <AgentStory thread={thread} activeId={step?.id ?? null} onHover={setHover} /> : <Roster onPick={setSelected} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Roster({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="scroll-y h-full space-y-1.5 p-3">
      {AGENT_ORDER.map((id) => {
        const s = SPOTS[id];
        const Icon = s.icon;
        return (
          <button key={id} className="flex w-full items-start gap-3 rounded-lg border border-line bg-panel-2 p-2.5 text-left hover:border-line-2 hover:bg-bg-2" onClick={() => onPick(id)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: s.color }}><Icon size={17} color="#fff" /></span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold">{PLAIN_AGENT[id]}</span>
              <span className="block text-[11.5px] leading-snug text-muted">{PLAIN_JOB[id]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AgentCard({ id, thread, onBack }: { id: string; thread: string | null; onBack: () => void }) {
  const rt = useRuntime();
  const s = SPOTS[id];
  const Icon = s.icon;
  const agent = !s.person ? AGENTS[id as keyof typeof AGENTS] : null;
  const open = Object.values(rt.proposals).filter(isOpen).sort((a, b) => b.createdAt - a.createdAt)[0];
  const slots = open ? open.approvals.filter((a) => slotNode(a.key) === id) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="panel-h">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={12} /> All steps</button>
        <span className="text-[11px] text-muted">{agent ? "AI agent" : "Person in charge"}</span>
      </div>
      <div className="flex items-start gap-3 border-b border-line p-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full" style={{ background: agent ? s.color : "var(--navy)" }}><Icon size={22} color="#fff" /></span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-tight">{agent ? PLAIN_AGENT[id as keyof typeof AGENTS] : `${s.name} · ${s.sub}`}</div>
          {agent && <div className="text-[11px] text-faint">{agent.name}</div>}
          <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{agent ? PLAIN_JOB[id as keyof typeof AGENTS] : PEOPLE[id]}</p>
        </div>
      </div>
      {agent && (
        <div className="border-b border-line px-4 py-2.5">
          <div className="eyebrow mb-1">Never allowed to</div>
          <ul className="space-y-0.5 text-[12px] text-[var(--red)]">{agent.cannot.map((c) => <li key={c}>✕ {c.charAt(0).toLowerCase() + c.slice(1)}</li>)}</ul>
        </div>
      )}
      {slots.length > 0 && (
        <div className="border-b border-line px-4 py-2.5">
          <div className="eyebrow mb-1">On the current plan</div>
          {slots.map((a) => (
            <div key={a.key} className="text-[12px] leading-snug">
              <span className="font-semibold">{whoSaid(a)}</span>: {a.decision === "PENDING" ? "still deciding" : a.decision === "REJECTED" ? `said no — ${a.reason}` : a.decision.toLowerCase().replace("_", " ")}
            </div>
          ))}
        </div>
      )}
      <div className="eyebrow px-4 pb-0 pt-2.5">{agent ? "What it did" : "What they did"}</div>
      <div className="min-h-0 flex-1"><AgentStory thread={thread} from={id} /></div>
    </div>
  );
}
