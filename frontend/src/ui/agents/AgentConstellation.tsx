"use client";

/**
 * The seven agents and the people who decide, laid out in the order they act (notice → understand → plan →
 * check → ask → people decide). Messages fly along the links as they happen (or when the conversation is
 * replayed), the agent that is working pulses and says what it is doing, and every node is clickable.
 */

import {
  BrainCircuit, CloudSun, MessagesSquare, Plane, RadioTower, ShieldCheck, TowerControl, UserRound, Users, type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AGENTS } from "@/core/agents/definitions";
import type { AgentMessage } from "@/core/agents/types";
import { isOpen, type Proposal } from "@/core/approvals/workflow";
import { useRuntime } from "@/store/ops";
import { PLAIN_AGENT } from "../story";
import { EDGES, endpoints, slotNode, TYPE_TONE } from "./model";

const FLIGHT_MS = 1400;

interface Spot { x: number; y: number; r: number; icon: LucideIcon; name: string; sub: string; color: string; person: boolean }

const AGENT_R = 30, PERSON_R = 19;
export const SPOTS: Record<string, Spot> = {
  weather: { x: 95, y: 275, r: AGENT_R, icon: CloudSun, name: PLAIN_AGENT.weather, sub: "notices", color: AGENTS.weather.color, person: false },
  airport_ops: { x: 290, y: 150, r: AGENT_R, icon: TowerControl, name: PLAIN_AGENT.airport_ops, sub: "predicts", color: AGENTS.airport_ops.color, person: false },
  airline_ops: { x: 290, y: 275, r: AGENT_R, icon: Plane, name: PLAIN_AGENT.airline_ops, sub: "airlines' view", color: AGENTS.airline_ops.color, person: false },
  atc: { x: 290, y: 400, r: AGENT_R, icon: RadioTower, name: PLAIN_AGENT.atc, sub: "runway limits", color: AGENTS.atc.color, person: false },
  recovery: { x: 475, y: 275, r: AGENT_R + 4, icon: BrainCircuit, name: PLAIN_AGENT.recovery, sub: "builds the plan", color: AGENTS.recovery.color, person: false },
  validation: { x: 630, y: 190, r: AGENT_R, icon: ShieldCheck, name: PLAIN_AGENT.validation, sub: "checks the rules", color: AGENTS.validation.color, person: false },
  coordination: { x: 745, y: 345, r: AGENT_R, icon: MessagesSquare, name: PLAIN_AGENT.coordination, sub: "asks the people", color: AGENTS.coordination.color, person: false },
  "sh:NATIONAL_SUPERVISOR": { x: 915, y: 72, r: PERSON_R, icon: UserRound, name: "Supervisor", sub: "final say", color: "#9fb4d6", person: true },
  "sh:OMAA": { x: 915, y: 152, r: PERSON_R, icon: UserRound, name: "Abu Dhabi", sub: "airport controller", color: "#9fb4d6", person: true },
  "sh:OMDB": { x: 915, y: 232, r: PERSON_R, icon: UserRound, name: "Dubai", sub: "airport controller", color: "#9fb4d6", person: true },
  "sh:OMSJ": { x: 915, y: 312, r: PERSON_R, icon: UserRound, name: "Sharjah", sub: "airport controller", color: "#9fb4d6", person: true },
  "sh:AIRLINES": { x: 915, y: 392, r: PERSON_R, icon: Users, name: "Airlines", sub: "operations reps", color: "#9fb4d6", person: true },
  "sh:ATC": { x: 915, y: 472, r: PERSON_R, icon: RadioTower, name: "Air traffic", sub: "controllers", color: "#9fb4d6", person: true },
};

const STAGES: [number, string][] = [[95, "1 · Notice"], [290, "2 · Understand"], [475, "3 · Plan"], [630, "4 · Check"], [745, "5 · Ask"], [915, "6 · People decide"]];

const WORDS: Record<string, string> = {
  run_optimizer: "Calculating plans…", build_recovery_problem: "Setting up the problem…", evaluate_plans: "Simulating each plan…",
  project_operations: "Predicting 4 hours ahead…", validate_plan: "Checking every rule…", classify_change: "Reading the weather…",
  get_runway_status: "Checking runways…", get_stand_occupancy: "Checking gates…", detect_conflicts: "Looking for clashes…",
  commit_plan: "Starting the plan…", get_affected_flights: "Listing flights…", estimate_downstream: "Counting connections…",
  get_arrival_capacity: "Checking runway limits…", check_plan_restrictions: "Checking runway limits…", compare_plans: "Comparing plans…",
};

/** Cubic link between two spots, leaving and entering at the circle edges. */
function curve(a: Spot, b: Spot): [number, number, number, number, number, number, number, number] {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  const x1 = a.x + (dx / d) * (a.r + 3), y1 = a.y + (dy / d) * (a.r + 3);
  const x2 = b.x - (dx / d) * (b.r + 6), y2 = b.y - (dy / d) * (b.r + 6);
  const k = Math.abs(x2 - x1) * 0.42;
  return [x1, y1, x1 + k, y1, x2 - k, y2, x2, y2];
}

function at(c: ReturnType<typeof curve>, t: number): [number, number] {
  const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = c, u = 1 - t;
  return [u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2, u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2];
}

/** Where the follow camera looks for a step: on whoever acts, leaning towards who hears about it. */
export function cameraOn(who: string, to: string[]): { x: number; y: number; z: number } | null {
  const a = SPOTS[who];
  if (!a) return null;
  // the people answering together: frame their whole column
  if (a.person && !to.length) return { x: 870, y: 272, z: 1.15 };
  const pts = to.map((id) => SPOTS[id]).filter(Boolean);
  const mx = pts.length ? pts.reduce((s, p) => s + p.x, 0) / pts.length : a.x;
  const my = pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : a.y;
  return { x: a.x * 0.68 + mx * 0.32, y: a.y * 0.68 + my * 0.32, z: a.person ? 1.3 : 1.5 };
}

/** Frame the scene on a point (scene units) at a zoom, keeping the scene edges outside the view. */
export function cameraTransform(c: { x: number; y: number; z: number; ay?: number } | null): string {
  if (!c) return "translate(0px, 0px) scale(1)";
  // the caption covers part of the stage, so the subject sits at `ay` (upper middle by default)
  const tx = Math.min(0, Math.max(1000 - 1000 * c.z, 500 - c.x * c.z));
  const ty = Math.min(0, Math.max(545 - 545 * c.z, (c.ay ?? 185) - c.y * c.z));
  return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${c.z})`;
}

export function AgentConstellation({ thread, selected, focus, onSelect, replay, camera = null }: {
  thread: string | null;
  selected: string | null;
  focus: string[] | null;
  onSelect: (id: string | null) => void;
  /** recorded messages being replayed, with their flight progress 0..1 (live messages are hidden meanwhile) */
  replay: { msgs: AgentMessage[]; t: number } | null;
  /** follow mode: where the camera looks (scene units), how close, and where on the stage the subject sits */
  camera?: { x: number; y: number; z: number; ay?: number } | null;
}) {
  const rt = useRuntime();
  const [hover, setHover] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const msgs = rt.orchestrator.messages;
  const lastWall = msgs.length ? msgs[msgs.length - 1].wall : 0;
  useEffect(() => {
    // animate live messages while the newest one is still in flight
    let raf = 0;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t - lastWall < FLIGHT_MS + 100) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lastWall]);

  const comp = rt.orchestrator.computing;
  const open: Proposal | undefined = Object.values(rt.proposals).filter((p) => isOpen(p) && (!thread || p.thread === thread))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  // recomputed on every render: approvals arrive by mutating the same proposal object
  const decisions = new Map<string, string>();
  const rank = (d: string) => ({ REJECTED: 4, REVISION_REQUESTED: 3, PENDING: 2, ACKNOWLEDGED: 1, APPROVED: 1 } as Record<string, number>)[d] ?? 0;
  if (open) for (const s of open.approvals) {
    const n = slotNode(s.key);
    const prev = decisions.get(n);
    if (!prev || rank(s.decision) > rank(prev)) decisions.set(n, s.decision);
  }
  const flights: { m: AgentMessage; t: number }[] = replay
    ? replay.msgs.map((m) => ({ m, t: replay.t }))
    : msgs.filter((m) => now >= m.wall && now - m.wall < FLIGHT_MS && (!thread || m.thread === thread)).map((m) => ({ m, t: (now - m.wall) / FLIGHT_MS }));
  const lit = new Set<string>();
  for (const f of flights) { const e = endpoints(f.m); for (const to of e.to) { lit.add(`${e.from}>${to}`); lit.add(`${to}>${e.from}`); } }
  const near = hover ?? selected;
  const glow = new Set<string>([...(focus ?? []), ...(near ? [near] : [])]);
  const linked = (a: string, b: string) => near !== null && (a === near || b === near);

  return (
    <svg viewBox="0 0 1000 545" className="h-full w-full select-none" onClick={() => onSelect(null)}>
      <defs>
        <radialGradient id="ac-node" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#24364d" />
          <stop offset="100%" stopColor="#111c2b" />
        </radialGradient>
        <filter id="ac-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <g style={{ transform: cameraTransform(camera), transition: "transform 800ms cubic-bezier(0.22, 0.8, 0.24, 1)" }}>
      <rect x="862" y="38" width="106" height="488" rx="16" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.06)" />
      {STAGES.map(([x, label]) => (
        <text key={label} x={x} y={22} textAnchor="middle" fill="rgba(200,215,235,0.55)" style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: "0.09em" }}>{label.toUpperCase()}</text>
      ))}
      {EDGES.map(([a, b]) => {
        const A = SPOTS[a], B = SPOTS[b];
        if (!A || !B) return null;
        const c = curve(A, B);
        const on = lit.has(`${a}>${b}`);
        const hl = linked(a, b);
        return (
          <path key={`${a}-${b}`} d={`M ${c[0]} ${c[1]} C ${c[2]} ${c[3]}, ${c[4]} ${c[5]}, ${c[6]} ${c[7]}`} fill="none"
            stroke={on ? "rgba(140,200,255,0.75)" : hl ? "rgba(200,220,245,0.45)" : "rgba(170,195,225,0.16)"} strokeWidth={on ? 2.2 : hl ? 1.6 : 1.2}
            strokeDasharray={on ? undefined : "4 5"} />
        );
      })}
      {flights.flatMap(({ m, t }) => {
        const e = endpoints(m);
        const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        return e.to.filter((to) => SPOTS[to] && SPOTS[e.from]).map((to) => {
          const [x, y] = at(curve(SPOTS[e.from], SPOTS[to]), Math.min(1, ease));
          const col = TYPE_TONE[m.type] ?? "#8cc8ff";
          return (
            <g key={`${m.id}-${to}`} opacity={1 - Math.max(0, t - 0.88) / 0.12}>
              <circle cx={x} cy={y} r={12} fill={col} opacity={0.35} filter="url(#ac-glow)" />
              <circle cx={x} cy={y} r={5} fill="#fff" />
              <circle cx={x} cy={y} r={3.2} fill={col} />
            </g>
          );
        });
      })}
      {Object.entries(SPOTS).map(([id, s]) => {
        const working = !s.person && comp?.agent === id;
        const d = decisions.get(id);
        const ring = s.person
          ? d === "REJECTED" || d === "REVISION_REQUESTED" ? "#ef6b6b" : d === "APPROVED" || d === "ACKNOWLEDGED" ? "#3fc2a6" : d === "PENDING" ? "#f0b04a" : "rgba(170,195,225,0.35)"
          : s.color;
        // an agent shows its role (or that it is working), a person their answer
        const status = s.person
          ? d === "REJECTED" ? "said no" : d === "REVISION_REQUESTED" ? "asked for changes" : d === "APPROVED" ? "approved" : d === "ACKNOWLEDGED" ? "noted" : d === "PENDING" ? "deciding…" : s.sub
          : working ? "working…" : s.sub;
        const emph = glow.has(id) || working;
        const Icon = s.icon;
        return (
          <g key={id} transform={`translate(${s.x}, ${s.y})`} className="cursor-pointer" style={{ transition: "opacity 200ms" }}
            opacity={focus && !glow.has(id) && !working ? 0.45 : 1}
            onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}
            onClick={(e) => { e.stopPropagation(); onSelect(id === selected ? null : id); }}>
            {working && <circle r={s.r + 16} fill={s.color} className="ac-pulse" />}
            {emph && <circle r={s.r + 8} fill={ring} opacity={0.28} filter="url(#ac-glow)" />}
            <circle r={s.r} fill="url(#ac-node)" stroke={selected === id ? "#ffffff" : ring} strokeWidth={selected === id ? 3 : emph ? 2.6 : 2} />
            <Icon x={-s.r * 0.42} y={-s.r * 0.42} width={s.r * 0.84} height={s.r * 0.84} color={s.person ? "#cfe0f5" : "#ffffff"} strokeWidth={1.7} />
            <text y={s.r + 16} textAnchor="middle" fill={emph ? "#ffffff" : "rgba(235,242,250,0.9)"} style={{ fontSize: s.person ? 11 : 12.5, fontWeight: 650 }}>{s.name}</text>
            <text y={s.r + 30} textAnchor="middle" fill={s.person && d ? ring : "rgba(200,215,235,0.6)"} style={{ fontSize: 10.5 }}>{status}</text>
            {working && comp && (
              <g transform={`translate(0, ${-s.r - 26})`}>
                <rect x={-78} y={-15} width={156} height={24} rx={12} fill="#f8fbff" />
                <path d="M -6 9 L 0 16 L 6 9 z" fill="#f8fbff" />
                <text y={1.5} textAnchor="middle" fill="#0b1622" style={{ fontSize: 11, fontWeight: 600 }}>{WORDS[comp.tool] ?? "Working…"}</text>
              </g>
            )}
          </g>
        );
      })}
      </g>
    </svg>
  );
}
