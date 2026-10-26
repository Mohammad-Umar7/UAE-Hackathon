"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentMessage } from "@/core/agents/types";
import { isOpen, type Proposal } from "@/core/approvals/workflow";
import { useOps, useRuntime } from "@/store/ops";
import { EDGES, NODE_H, NODE_W, NODES, endpoints, node, slotNode, TYPE_TONE, type NodeId } from "./model";

const FLIGHT_MS = 1500;

function edgePath(a: NodeId, b: NodeId): string {
  const A = node(a), B = node(b);
  const x1 = A.x + (B.x > A.x ? NODE_W / 2 : B.x < A.x ? -NODE_W / 2 : 0);
  const x2 = B.x + (B.x > A.x ? -NODE_W / 2 : B.x < A.x ? NODE_W / 2 : 0);
  const y1 = A.y + (B.x === A.x ? (B.y > A.y ? NODE_H / 2 : -NODE_H / 2) : 0);
  const y2 = B.y + (B.x === A.x ? (B.y > A.y ? -NODE_H / 2 : NODE_H / 2) : 0);
  const dx = (x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function pointOn(a: NodeId, b: NodeId, t: number): [number, number] {
  const A = node(a), B = node(b);
  const x1 = A.x + (B.x > A.x ? NODE_W / 2 : B.x < A.x ? -NODE_W / 2 : 0);
  const x2 = B.x + (B.x > A.x ? -NODE_W / 2 : B.x < A.x ? NODE_W / 2 : 0);
  const y1 = A.y, y2 = B.y;
  const dx = (x2 - x1) * 0.5;
  const c1 = [x1 + dx, y1], c2 = [x2 - dx, y2];
  const u = 1 - t;
  return [
    u * u * u * x1 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * x2,
    u * u * u * y1 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * y2,
  ];
}

export function AgentGraph({ thread }: { thread: string | null }) {
  const rt = useRuntime();
  const setInspect = useOps((s) => s.setInspect);
  const [now, setNow] = useState(0);
  const msgs = rt.orchestrator.messages;
  const lastWall = msgs.length ? msgs[msgs.length - 1].wall : 0;
  const inFlight = msgs.filter((m) => now >= m.wall && now - m.wall < FLIGHT_MS && (!thread || m.thread === thread));
  useEffect(() => {
    // animate packets while the newest message is still in flight
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
  const open: Proposal | undefined = Object.values(rt.proposals).filter(isOpen).sort((a, b) => b.createdAt - a.createdAt)[0];
  const slotState = useMemo(() => {
    const m = new Map<NodeId, string>();
    if (open) for (const s of open.approvals) {
      const n = slotNode(s.key);
      const prev = m.get(n);
      const rank = (d: string) => ({ REJECTED: 4, REVISION_REQUESTED: 3, PENDING: 2, ACKNOWLEDGED: 1, APPROVED: 1 } as Record<string, number>)[d] ?? 0;
      if (!prev || rank(s.decision) > rank(prev)) m.set(n, s.decision);
    }
    return m;
  }, [open]);
  const counts = new Map<NodeId, number>();
  for (const m of msgs) if (!thread || m.thread === thread) { const e = endpoints(m); counts.set(e.from, (counts.get(e.from) ?? 0) + 1); }
  const lastByNode = new Map<NodeId, AgentMessage>();
  for (const m of msgs) if (!thread || m.thread === thread) lastByNode.set(endpoints(m).from, m);
  const activeEdges = new Set<string>();
  for (const m of inFlight) { const e = endpoints(m); for (const t of e.to) activeEdges.add(`${e.from}>${t}`); }

  return (
    <svg viewBox="0 0 1100 500" className="h-full w-full select-none">
      <defs>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-2)" />
        </marker>
      </defs>
      <rect x="930" y="20" width="160" height="470" rx="12" fill="var(--bg-2)" opacity="0.55" />
      <text x="1010" y="15" textAnchor="middle" className="fill-[var(--muted)]" style={{ fontSize: 10, letterSpacing: "0.08em", fontWeight: 600 }}>HUMAN STAKEHOLDERS</text>
      <text x="460" y="15" textAnchor="middle" className="fill-[var(--muted)]" style={{ fontSize: 10, letterSpacing: "0.08em", fontWeight: 600 }}>AGENTS · DETERMINISTIC TOOLS · CLOCK HELD WHILE COMPUTING</text>
      {EDGES.map(([a, b]) => {
        const on = activeEdges.has(`${a}>${b}`) || activeEdges.has(`${b}>${a}`);
        return <path key={`${a}-${b}`} d={edgePath(a, b)} fill="none" stroke={on ? "var(--navy)" : "var(--line-2)"} strokeWidth={on ? 2 : 1.2}
          strokeOpacity={on ? 0.9 : 0.8} markerEnd="url(#arrow)" className={on ? "flow" : ""} />;
      })}
      {inFlight.flatMap((m) => {
        const e = endpoints(m);
        const t = Math.min(1, (now - m.wall) / FLIGHT_MS);
        const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        return e.to.filter((to) => NODES.some((n) => n.id === to)).map((to) => {
          const [x, y] = pointOn(e.from, to, ease);
          return (
            <g key={`${m.id}-${to}`} opacity={1 - Math.max(0, t - 0.85) / 0.15}>
              <circle cx={x} cy={y} r={9} fill={TYPE_TONE[m.type] ?? "#1d3557"} opacity={0.18} />
              <circle cx={x} cy={y} r={4.5} fill={TYPE_TONE[m.type] ?? "#1d3557"} />
            </g>
          );
        });
      })}
      {NODES.map((n) => {
        const computing = comp && comp.agent === n.id;
        const decision = slotState.get(n.id);
        const last = lastByNode.get(n.id);
        const tone = decision === "REJECTED" ? "var(--red)" : decision === "APPROVED" || decision === "ACKNOWLEDGED" ? "var(--teal)" : decision === "PENDING" ? "var(--amber)" : null;
        return (
          <g key={n.id} transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`} className="cursor-pointer"
            onClick={() => last && setInspect({ kind: "message", id: last.id })}>
            {computing && <rect x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={12} fill={n.color} opacity={0.22} filter="url(#glow)" />}
            <rect width={NODE_W} height={NODE_H} rx={9} fill="var(--panel-2)" stroke={computing ? n.color : tone ?? "var(--line-2)"} strokeWidth={computing || tone ? 1.8 : 1} />
            <rect width={4} height={NODE_H} rx={2} fill={n.color} />
            <text x={14} y={19} style={{ fontSize: 12, fontWeight: 650 }} className="fill-[var(--ink)]">{n.label}</text>
            <text x={14} y={36} style={{ fontSize: 10.5 }} className="fill-[var(--muted)]">
              {computing ? `▶ ${comp!.tool.replace(/_/g, " ")}…` : decision ? decision.replace("_", " ").toLowerCase() : n.sub}
            </text>
            {(counts.get(n.id) ?? 0) > 0 && (
              <g transform={`translate(${NODE_W - 24}, 8)`}>
                <rect width={18} height={14} rx={7} fill="var(--bg-2)" />
                <text x={9} y={10.5} textAnchor="middle" style={{ fontSize: 9.5, fontWeight: 700 }} className="fill-[var(--ink-2)] mono">{counts.get(n.id)}</text>
              </g>
            )}
            {tone && <circle cx={NODE_W - 10} cy={NODE_H - 10} r={4} fill={tone} />}
          </g>
        );
      })}
    </svg>
  );
}
