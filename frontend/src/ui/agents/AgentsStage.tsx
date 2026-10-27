"use client";

import { ArrowLeft, Play, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AGENT_ORDER, AGENTS } from "@/core/agents/definitions";
import { isOpen } from "@/core/approvals/workflow";
import { useOps, useRuntime } from "@/store/ops";
import { comparisons } from "../impact/compare";
import { agentStory, PLAIN_AGENT, PLAIN_JOB, whoSaid, workflowName, type StoryStep } from "../story";
import { AgentConstellation, cameraOn, SPOTS } from "./AgentConstellation";
import { AgentStory } from "./AgentStory";
import { FollowCaption } from "./FollowCaption";
import { followBeats, followStart } from "./follow";
import { slotNode } from "./model";

const BEAT_MS = 4800; // time on each step while following the agents
const FLY_MS = 1500; // a message's flight across the scene

type Follow = { thread: string | null; from: number; i: number; since: number; playing: boolean };

const PEOPLE: Record<string, string> = {
  "sh:NATIONAL_SUPERVISOR": "Has the final say: nothing runs until the national supervisor approves. In this demo, that is you.",
  "sh:OMAA": "Knows Abu Dhabi's own gates, ground crews and equipment, and approves or rejects the parts of a plan that land there.",
  "sh:OMDB": "Knows Dubai's own gates, ground crews and equipment, and approves or rejects the parts of a plan that land there.",
  "sh:OMSJ": "Knows Sharjah's own gates, ground crews and equipment — including things the network does not know yet.",
  "sh:AIRLINES": "Each airline approves the changes to its own flights.",
  "sh:ATC": "Real air-traffic controllers review landing times and diversions. SKYPACT never gives instructions to pilots.",
};

/** The AI agents page in Simple mode: an interactive scene, a camera that can follow the agents step by step,
 *  the story of what happened, and a card per agent. */
export function AgentsStage() {
  const rt = useRuntime();
  const version = useOps((s) => s.version);
  const request = useOps((s) => s.follow);
  const o = rt.orchestrator;
  const [thread, setThread] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<StoryStep | null>(null);
  const [tab, setTab] = useState<"story" | "meet">("story");
  const [follow, setFollow] = useState<Follow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const steps = agentStory(rt, thread);
  const total = steps.length;
  const fThread = follow?.thread ?? null, fFrom = follow?.from ?? 0, following = follow !== null;
  const beats = useMemo(() => {
    if (!following) return [];
    const c = comparisons(rt).find((x) => x.thread === fThread);
    return followBeats(rt, fThread, fFrom, c?.cause ?? null);
    // the runtime is mutable: `version` changes whenever it notifies
  }, [rt, version, following, fThread, fFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback((th: string | null, from?: number) => {
    const all = comparisons(rt);
    const c = all.find((x) => x.thread === th) ?? all[0];
    const t = th ?? c?.thread ?? null;
    setThread(t);
    setSelected(null);
    setTab("story");
    setFollow({ thread: t, from: from ?? followStart(rt, t, c?.cause ?? null), i: 0, since: Date.now(), playing: true });
  }, [rt]);

  // the guided demo asks this page to follow a workflow; the request is used once
  useEffect(() => {
    if (!request) return;
    const id = window.setTimeout(() => { start(request.thread, request.from); useOps.getState().setFollow(null); }, 0);
    return () => clearTimeout(id);
  }, [request, start]);

  // smooth frames while a message flies, a slower tick for the progress bar
  useEffect(() => {
    if (!follow) return;
    let raf = 0;
    const tick = () => { const t = Date.now(); setNow(t); if (t - follow.since < FLY_MS + 150) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, [follow]);

  // advance at reading pace; when caught up with the agents, wait for their next step
  useEffect(() => {
    if (!follow?.playing || follow.i >= beats.length - 1) return;
    const id = window.setTimeout(() => setFollow((f) => f && { ...f, i: f.i + 1, since: Date.now() }), Math.max(0, follow.since + BEAT_MS - Date.now()));
    return () => clearTimeout(id);
  }, [follow, beats.length]);

  const go = (i: number) => setFollow((f) => f && { ...f, i: Math.max(0, Math.min(beats.length - 1, i)), since: Date.now() });
  const beat = follow && beats.length ? beats[Math.min(follow.i, beats.length - 1)] : null;
  const elapsed = follow ? now - follow.since : 0;
  const focus = beat ? [beat.who, ...beat.to] : hover ? hover.nodes : null;
  const working = o.computing !== null || rt.held;
  const caughtUp = follow !== null && follow.i >= beats.length - 1;
  const demo = useOps((s) => s.presentation.active);
  const camera = beat ? cameraOn(beat.who, beat.to) : null;

  // tell the guided demo how far the story has got (it waits for the last step before moving on)
  const at = follow ? Math.min(follow.i, beats.length - 1) + 1 : 0;
  const told = Boolean(beat && caughtUp && (beat.id.startsWith("final:") || (!working && !rt.running)));
  useEffect(() => { useOps.getState().setFollowAt(following ? { step: at, total: beats.length, done: told } : null); }, [following, at, beats.length, told]);
  useEffect(() => () => useOps.getState().setFollowAt(null), []);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold tracking-tight">AI agents at work</div>
          <div className="text-[12.5px] text-muted">Seven software agents, each with one job, pass messages and use tools to build a plan. People make the decision.</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button className={`btn btn-sm ${thread === null ? "btn-primary" : ""}`} onClick={() => { setThread(null); setFollow(null); }}>Everything</button>
          {o.workflows.map((w) => (
            <button key={w.id} className={`btn btn-sm max-w-[260px] ${thread === w.id ? "btn-primary" : ""}`} onClick={() => { setThread(w.id); setFollow(null); }} title={w.title}>
              <span className="truncate">{workflowName(rt, w)}</span>
            </button>
          ))}
          {follow === null ? (
            <button className="btn btn-sm btn-teal" disabled={!total} onClick={() => start(thread)}>
              <Play size={12} /> Follow the agents, step by step
            </button>
          ) : (
            <button className="btn btn-sm" onClick={() => setFollow(null)}><Square size={11} /> Stop following</button>
          )}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] gap-3">
        <div className="relative min-h-0 overflow-hidden rounded-[14px] border border-[#1c2a3c]"
          style={{ background: "radial-gradient(120% 95% at 35% 15%, #19304a 0%, #0d1a2a 55%, #08111b 100%)" }}>
          <div className="absolute inset-0 opacity-[0.22]" style={{ backgroundImage: "radial-gradient(rgba(160,190,230,0.35) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
          <div className="absolute inset-0 p-3">
            <AgentConstellation thread={follow ? follow.thread : thread} selected={selected} focus={focus} onSelect={(id) => { setSelected(id); }}
              replay={beat && beat.msgs.length ? { msgs: beat.msgs, t: Math.min(1, elapsed / FLY_MS) } : null}
              camera={camera && { ...camera, ay: demo ? 300 : 185 }} />
          </div>
          {beat && follow ? (
            <FollowCaption beat={beat} index={Math.min(follow.i, beats.length - 1)} total={beats.length} playing={follow.playing} top={demo}
              waiting={caughtUp && (working || rt.running)} progress={caughtUp ? 1 : Math.min(1, elapsed / BEAT_MS)}
              onPrev={() => go(follow.i - 1)} onNext={() => go(follow.i + 1)} onClose={() => setFollow(null)}
              onToggle={() => setFollow((f) => f && { ...f, playing: !f.playing, since: Date.now() })} />
          ) : follow ? (
            <div className="absolute inset-x-4 bottom-4 rounded-2xl bg-[rgba(7,14,24,0.9)] px-5 py-4 text-[13px] text-white/75">
              Nothing has happened yet in this part of the evening. Run the clock and the agents will appear here as they act.
            </div>
          ) : (
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/[0.07] px-3 py-1 text-[11px] text-white/70 backdrop-blur-sm">
              {working ? "The agents are working right now — the clock waits for them" : "Click an agent to see what it does · moving dots are messages"}
            </div>
          )}
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
                {tab === "story" ? <AgentStory thread={thread} activeId={beat?.id ?? null} onHover={setHover} /> : <Roster onPick={setSelected} />}
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
