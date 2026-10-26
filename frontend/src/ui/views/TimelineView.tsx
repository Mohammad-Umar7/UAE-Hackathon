"use client";

import { useMemo, useState } from "react";
import { AIRCRAFT } from "@/core/aircraft";
import { isOpen } from "@/core/approvals/workflow";
import type { Visit } from "@/core/types";
import { callsignOf, fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { AirportTabs } from "../common/AirportTabs";

interface Bar { visit: string; label: string; start: number; end: number; kind: "actual" | "estimated" | "proposed" | "original"; conflict?: boolean; delayed?: boolean; tech?: boolean; prm?: boolean }

const ROW_H = 24;
const LABEL_W = 132;

export default function TimelineView() {
  const rt = useRuntime();
  const { airport, select, selectedVisit, setView } = useOps();
  const [span, setSpan] = useState(6);
  const [showOriginal, setShowOriginal] = useState(true);
  const [showProposed, setShowProposed] = useState(true);
  const w = rt.world;
  const ap = rt.airports[airport];
  const now = w.now;
  const t0 = now - 1.5 * 3600;
  const t1 = t0 + span * 3600;
  const open = Object.values(rt.proposals).filter(isOpen).sort((a, b) => b.createdAt - a.createdAt)[0];
  const rows = useMemo(() => {
    const stands = Object.values(ap.stands).sort((a, b) => (a.kind === b.kind ? (a.zone === b.zone ? a.index - b.index : a.zone.localeCompare(b.zone)) : ["contact", "remote", "cargo", "ga"].indexOf(a.kind) - ["contact", "remote", "cargo", "ga"].indexOf(b.kind)));
    const bars = new Map<string, Bar[]>();
    const add = (sid: string, b: Bar) => { if (!bars.has(sid)) bars.set(sid, []); bars.get(sid)!.push(b); };
    for (const v of Object.values(w.visits) as Visit[]) {
      if (v.airport !== airport) continue;
      const st = v.stand ? ap.stands[v.stand] : null;
      const cs = callsignOf(v);
      if (showOriginal && v.plannedStand && v.arr && v.dep && v.plannedStand !== v.stand) {
        add(v.plannedStand, { visit: v.id, label: cs, start: v.arr.sched, end: v.dep.sched, kind: "original" });
      }
      if (!st) continue;
      let start: number | null = null, end: number | null = null, kind: Bar["kind"] = "estimated";
      if (v.aibt !== null) { start = v.aibt; kind = "actual"; }
      else if (["SCHEDULED", "INBOUND", "HOLDING", "APPROACH", "LANDING", "TAXI_IN", "WAITING_STAND"].includes(v.phase)) start = (v.eldt ?? v.eta ?? now) + st.taxiIn;
      if (start === null) continue;
      if (v.aobt !== null) end = v.aobt;
      else if (v.dep) end = Math.max(v.tobt ?? v.readyAt ?? start + v.minTat, v.dep.sched, v.techHoldUntil ?? 0, start + v.minTat);
      else end = start + 6 * 3600;
      if (end < t0 || start > t1) continue;
      add(st.id, { visit: v.id, label: cs, start, end, kind, delayed: v.arr ? start - v.arr.sched > 900 : false, tech: (v.techHoldUntil ?? 0) > now, prm: v.prm > 0 });
    }
    if (open && showProposed) {
      for (const r of open.plan.rows) {
        if (r.option !== "home" || r.home !== airport || !r.changed) continue;
        const v = w.visits[r.visit];
        if (!v) continue;
        const s = open.t0 + r.onBlock! * 60;
        const e = v.dep ? Math.max(v.dep.sched, s + v.minTat) : s + 6 * 3600;
        add(r.stand!, { visit: v.id, label: `${r.callsign} ⇢`, start: s, end: e, kind: "proposed" });
      }
      for (const r of open.plan.rows) {
        if (r.option !== "divert" || r.to !== airport) continue;
        const st = ap.stands[r.stand!];
        const s = open.t0 + r.L! * 60 + (st?.taxiIn ?? 420);
        add(r.stand!, { visit: r.visit, label: `${r.callsign} ⇢ div`, start: s, end: s + (r.stay ?? 60) * 60, kind: "proposed" });
      }
    }
    for (const list of bars.values()) {
      const real = list.filter((b) => b.kind === "actual" || b.kind === "estimated").sort((a, b) => a.start - b.start);
      for (let i = 0; i < real.length - 1; i++) if (real[i].end + 300 > real[i + 1].start) { real[i].conflict = true; real[i + 1].conflict = true; }
    }
    return stands.map((s) => ({ s, bars: bars.get(s.id) ?? [] }));
  }, [rt.version, airport, span, showOriginal, showProposed]); // eslint-disable-line react-hooks/exhaustive-deps

  const W = 1600;
  const x = (t: number) => LABEL_W + ((t - t0) / (t1 - t0)) * (W - LABEL_W - 10);
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / 1800) * 1800; t <= t1; t += 1800) ticks.push(t);
  const conflicts = rows.reduce((s, r) => s + r.bars.filter((b) => b.conflict).length, 0);
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[16px] font-semibold tracking-tight">Aircraft &amp; stand timeline</div>
          <div className="text-[12px] text-muted">Occupancy per stand from the live simulation · original plan, current/estimated and proposed assignments</div>
        </div>
        <AirportTabs />
        <div className="ml-auto flex items-center gap-2">
          <span className={`pill ${conflicts ? "pill-red" : "pill-teal"}`}>{conflicts ? `${Math.round(conflicts / 2)} overlapping estimates` : "No overlaps"}</span>
          <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} /> Original plan</label>
          <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={showProposed} onChange={(e) => setShowProposed(e.target.checked)} /> Proposed{open ? ` (${open.id} v${open.version})` : ""}</label>
          <select className="btn" value={span} onChange={(e) => setSpan(Number(e.target.value))}>
            {[3, 6, 9, 12].map((h) => <option key={h} value={h}>{h} h window</option>)}
          </select>
        </div>
      </div>
      <div className="panel min-h-0 flex-1 overflow-hidden">
        <div className="scroll-y h-full">
          <svg viewBox={`0 0 ${W} ${rows.length * ROW_H + 40}`} width="100%" style={{ minWidth: 1100 }} className="block">
            <g>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={x(t)} x2={x(t)} y1={24} y2={rows.length * ROW_H + 40} stroke="var(--line)" strokeDasharray={t % 3600 ? "2 4" : undefined} />
                  <text x={x(t) + 3} y={16} className="mono fill-[var(--muted)]" style={{ fontSize: 11 }}>{fmtTime(t)}</text>
                </g>
              ))}
              <line x1={x(now)} x2={x(now)} y1={20} y2={rows.length * ROW_H + 40} stroke="var(--red)" strokeWidth={1.5} />
              <rect x={x(now) - 22} y={2} width={44} height={16} rx={4} fill="var(--red)" />
              <text x={x(now)} y={14} textAnchor="middle" className="mono fill-white" style={{ fontSize: 10.5, fontWeight: 700 }}>{fmtTime(now)}</text>
            </g>
            {rows.map(({ s, bars }, i) => {
              const y = 30 + i * ROW_H;
              const group = `${s.kind} · ${s.zone}`;
              const showGroup = i === 0 || group !== `${rows[i - 1].s.kind} · ${rows[i - 1].s.zone}`;
              return (
                <g key={s.id}>
                  {i % 2 === 0 && <rect x={0} y={y} width={W} height={ROW_H} fill="var(--bg-2)" opacity={0.35} />}
                  {showGroup && <line x1={0} x2={W} y1={y} y2={y} stroke="var(--line-2)" />}
                  <text x={8} y={y + 15} className="mono fill-[var(--ink)]" style={{ fontSize: 11.5, fontWeight: 600 }}>{s.id}</text>
                  <text x={54} y={y + 15} className="fill-[var(--muted)]" style={{ fontSize: 10 }}>{s.sizeCode} · {s.kind === "contact" ? "bridge" : s.kind}</text>
                  {bars.sort((a, b) => (a.kind === "original" ? -1 : 1) - (b.kind === "original" ? -1 : 1)).map((b, k) => {
                    const bx = Math.max(LABEL_W, x(b.start)), bw = Math.max(3, x(Math.min(b.end, t1)) - bx);
                    const sel = selectedVisit === b.visit;
                    const fill = b.kind === "original" ? "transparent" : b.kind === "proposed" ? "color-mix(in oklab, var(--teal) 22%, transparent)"
                      : b.tech ? "color-mix(in oklab, var(--red) 70%, white)" : b.conflict ? "color-mix(in oklab, var(--red) 35%, white)" : b.kind === "actual" ? "var(--navy-2)" : "color-mix(in oklab, var(--navy-2) 45%, white)";
                    const stroke = b.kind === "original" ? "var(--faint)" : b.kind === "proposed" ? "var(--teal)" : b.conflict ? "var(--red)" : sel ? "var(--amber)" : "transparent";
                    return (
                      <g key={k} className="cursor-pointer" onClick={() => select({ selectedVisit: b.visit })} onDoubleClick={() => { select({ selectedVisit: b.visit }); setView("twin"); }}>
                        <rect x={bx} y={y + (b.kind === "original" ? 2 : 4)} width={bw} height={b.kind === "original" ? ROW_H - 4 : ROW_H - 8} rx={4}
                          fill={fill} stroke={stroke} strokeWidth={sel ? 2 : 1.2} strokeDasharray={b.kind === "original" ? "3 3" : b.kind === "proposed" ? "4 2" : undefined} />
                        {bw > 46 && b.kind !== "original" && (
                          <text x={bx + 5} y={y + 16} className="mono" style={{ fontSize: 10.5, fontWeight: 600 }}
                            fill={b.kind === "actual" && !b.conflict && !b.tech ? "#fff" : "var(--ink)"}>{b.label}{b.prm ? " ♿" : ""}{b.delayed ? " ⏱" : ""}</text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
        <Legend color="var(--navy-2)" label="On stand (actual)" />
        <Legend color="color-mix(in oklab, var(--navy-2) 45%, white)" label="Estimated" />
        <Legend color="color-mix(in oklab, var(--red) 35%, white)" label="Overlap (conflict)" border="var(--red)" />
        <Legend color="color-mix(in oklab, var(--red) 70%, white)" label="Technical hold (blocked)" />
        <Legend color="transparent" label="Original plan (moved away)" border="var(--faint)" dashed />
        <Legend color="color-mix(in oklab, var(--teal) 22%, transparent)" label="Proposed assignment" border="var(--teal)" dashed />
        <span>⏱ arriving &gt;15 min late · ♿ passengers needing assistance · double-click a bar to open it in the digital twin</span>
      </div>
    </div>
  );
}

function Legend({ color, label, border, dashed }: { color: string; label: string; border?: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-6 rounded" style={{ background: color, border: border ? `1.2px ${dashed ? "dashed" : "solid"} ${border}` : undefined }} />
      {label}
    </span>
  );
}

export const typeName = (k: keyof typeof AIRCRAFT) => AIRCRAFT[k].category;
