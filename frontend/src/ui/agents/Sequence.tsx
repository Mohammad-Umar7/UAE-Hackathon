"use client";

import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { endpoints, TYPE_TONE, type NodeId } from "./model";

const LANES: { id: NodeId | "stake"; label: string }[] = [
  { id: "weather", label: "Weather" }, { id: "airport_ops", label: "Airport Ops" }, { id: "airline_ops", label: "Airline Ops" },
  { id: "atc", label: "ATC Liaison" }, { id: "recovery", label: "Recovery" }, { id: "validation", label: "Validation" },
  { id: "coordination", label: "Coordination" }, { id: "stake", label: "Stakeholders" },
];

const laneOf = (n: NodeId): number => {
  const i = LANES.findIndex((l) => l.id === n);
  return i >= 0 ? i : LANES.length - 1;
};

/** Swimlane sequence diagram of the messages in one workflow (ordered as they happened). Consecutive
 *  messages of the same type between the same lanes (a round of coordination requests, say) share a row,
 *  so the whole workflow from detection to commitment stays readable. */
export function Sequence({ thread }: { thread: string | null }) {
  const rt = useRuntime();
  const { setInspect, inspect } = useOps();
  const rows: { m: (typeof rt.orchestrator.messages)[number]; key: string; n: number; ids: string[] }[] = [];
  for (const m of rt.orchestrator.messages) {
    if (thread && m.thread !== thread) continue;
    const e = endpoints(m);
    const key = `${m.type}|${laneOf(e.from)}|${[...new Set(e.to.map(laneOf))].sort().join(",")}`;
    const last = rows[rows.length - 1];
    if (last?.key === key) {
      last.n++;
      last.ids.push(m.id);
    } else rows.push({ m, key, n: 1, ids: [m.id] });
  }
  const msgs = rows.slice(-120);
  const laneW = 112;
  const rowH = 22;
  const G = 40; // time gutter on the left, so timestamps never sit on another lane's arrows
  const cx = (lane: number) => G + lane * laneW + laneW / 2;
  const W = G + LANES.length * laneW;
  const H = 34 + msgs.length * rowH + 10;
  return (
    <div className="scroll-x scroll-y h-full">
      <svg width={W} height={Math.max(H, 120)} className="block">
        {LANES.map((l, i) => (
          <g key={l.id}>
            <line x1={cx(i)} x2={cx(i)} y1={26} y2={H} stroke="var(--line-2)" strokeDasharray="3 4" />
            <rect x={G + i * laneW + 6} y={4} width={laneW - 12} height={20} rx={6} fill="var(--bg-2)" />
            <text x={cx(i)} y={18} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 600 }} className="fill-[var(--ink-2)]">{l.label}</text>
          </g>
        ))}
        {msgs.map(({ m, n, ids }, k) => {
          const e = endpoints(m);
          const y = 40 + k * rowH;
          const from = laneOf(e.from);
          const tos = [...new Set(e.to.map(laneOf))].filter((t) => t !== from);
          const color = TYPE_TONE[m.type] ?? "var(--navy)";
          const sel = inspect?.kind === "message" && ids.includes(inspect.id);
          return (
            <g key={m.id} className="cursor-pointer" onClick={() => setInspect({ kind: "message", id: m.id })}>
              {sel && <rect x={0} y={y - 11} width={W} height={rowH} fill="var(--navy-soft)" />}
              <text x={G - 6} y={y + 3} textAnchor="end" className="mono fill-[var(--faint)]" style={{ fontSize: 8.5 }}>{fmtTime(m.t)}</text>
              <circle cx={cx(from)} cy={y} r={3.5} fill={color} />
              {tos.map((t) => {
                const x1 = cx(from), x2 = cx(t);
                const dir = x2 > x1 ? 1 : -1;
                return (
                  <g key={t}>
                    <line x1={x1} x2={x2 - dir * 5} y1={y} y2={y} stroke={color} strokeWidth={1.4} />
                    <path d={`M ${x2} ${y} l ${-dir * 6} -3.5 l 0 7 z`} fill={color} />
                  </g>
                );
              })}
              {tos.length === 0 && <circle cx={cx(from)} cy={y} r={6} fill="none" stroke={color} />}
              <text x={cx(Math.min(...[from, ...tos])) + 6} y={y - 4} style={{ fontSize: 9.5, fontWeight: 600 }} fill={color}>{m.type}{n > 1 ? ` ×${n}` : ""}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
