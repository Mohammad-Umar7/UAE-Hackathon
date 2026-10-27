"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fmtTime } from "@/core/world";

export interface ChartLine { key: string; label: string; color: string; values: { t: number; v: number }[] }

const W = 1000, H = 200;

/** Clean y ticks: 3–5 steps of 1, 2, 2.5 or 5 × 10ⁿ, whole numbers for counts. */
function ticks(max: number, integer: boolean): number[] {
  const raw = Math.max(max, 1) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  if (integer) step = Math.max(1, Math.round(step));
  const top = Math.ceil(Math.max(max, 1) / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}K` : v.toLocaleString("en-GB", { maximumFractionDigits: 1 }));

/**
 * Two simulated futures on one time axis. A crosshair follows the pointer (or the arrow keys) and reads
 * out every line at that moment; each line's highest point is labelled.
 */
export function ImpactChart({ lines, t0, t1, now, shadeFrom, shadeLabel, integer, unit }: {
  lines: ChartLine[]; t0: number; t1: number; now?: number; shadeFrom?: number; shadeLabel?: string; integer: boolean; unit: (v: number) => string;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const base = lines[0]?.values ?? [];
  const ys = ticks(Math.max(0, ...lines.flatMap((l) => l.values.map((p) => p.v))), integer);
  const top = ys[ys.length - 1];
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (v: number) => H - (v / top) * H;
  const pct = (t: number) => `${(100 * (t - t0)) / (t1 - t0)}%`;
  const hours: number[] = [];
  for (let h = Math.ceil(t0 / 3600) * 3600; h <= t1; h += 3600) hours.push(h);

  const at = (clientX: number) => {
    const r = plot.current?.getBoundingClientRect();
    if (!r || !base.length) return;
    const t = t0 + ((clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    base.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(base[best].t - t)) best = i; });
    setHover(best);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => Math.max(0, Math.min(base.length - 1, (h ?? base.length - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
  };

  // label each line's highest point; when two labels would touch, the lower one goes under its dot
  const peaks = lines.map((l) => {
    let i = 0;
    l.values.forEach((p, j) => { if (p.v >= l.values[i].v) i = j; });
    return { l, p: l.values[i] };
  }).filter((k) => k.p);
  const below = new Set<string>();
  for (const a of peaks) for (const b of peaks) {
    if (a === b || below.has(b.l.key)) continue;
    const near = Math.abs(x(a.p.t) - x(b.p.t)) < 90 && Math.abs(y(a.p.v) - y(b.p.v)) < 34;
    if (near && a.p.v < b.p.v) below.add(a.l.key);
  }

  const hv = hover !== null ? base[hover] : null;
  const summary = lines.map((l) => `${l.label}: highest ${unit(Math.max(0, ...l.values.map((p) => p.v)))}`).join("; ");
  return (
    <div className="relative pb-6 pl-11 pr-3 pt-5">
      <div ref={plot} className="relative h-[180px] cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-[var(--navy-2)]"
        tabIndex={0} role="img" aria-label={summary}
        onPointerMove={(e: PointerEvent) => at(e.clientX)} onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? base.length - 1)} onBlur={() => setHover(null)} onKeyDown={onKey}>
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          {shadeFrom !== undefined && shadeFrom < t1 && <rect x={x(shadeFrom)} y={0} width={W - x(shadeFrom)} height={H} style={{ fill: "var(--bg-2)" }} />}
          {ys.map((v) => <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} style={{ stroke: v === 0 ? "var(--line-2)" : "var(--line)" }} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          {lines.map((l) => {
            if (!l.values.length) return null;
            const d = l.values.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
            const last = l.values[l.values.length - 1], first = l.values[0];
            return (
              <g key={l.key}>
                <path d={`${d}L${x(last.t).toFixed(1)},${H}L${x(first.t).toFixed(1)},${H}Z`} style={{ fill: l.color, opacity: 0.1 }} />
                <path d={d} fill="none" style={{ stroke: l.color }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
          {now !== undefined && now > t0 + 600 && now < t1 && <line x1={x(now)} x2={x(now)} y1={0} y2={H} style={{ stroke: "var(--ink-2)" }} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {hv && <line x1={x(hv.t)} x2={x(hv.t)} y1={0} y2={H} style={{ stroke: "var(--muted)" }} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        </svg>

        {ys.map((v) => (
          <span key={v} className="mono absolute -left-11 w-9 -translate-y-1/2 text-right text-[10.5px] text-faint" style={{ top: `${(100 * (top - v)) / top}%` }}>{compact(v)}</span>
        ))}
        {hours.map((h) => (
          <span key={h} className="mono absolute top-full mt-1.5 -translate-x-1/2 text-[10.5px] text-faint" style={{ left: pct(h) }}>{fmtTime(h)}</span>
        ))}
        {shadeFrom !== undefined && shadeFrom < t1 && shadeLabel && (
          <span className="absolute -top-5 right-0 truncate pl-1.5 text-[10.5px] text-faint" style={{ left: pct(shadeFrom) }}>{shadeLabel}</span>
        )}
        {now !== undefined && now > t0 + 600 && now < t1 && (
          <span className="absolute -top-5 -translate-x-1/2 text-[10.5px] font-medium text-ink-2" style={{ left: pct(now) }}>now</span>
        )}

        {peaks.map(({ l, p }) => {
          const left = (100 * (p.t - t0)) / (t1 - t0), topPct = (100 * (top - p.v)) / top;
          const under = below.has(l.key);
          // near the right edge the label sits beside its dot, inside the plot; elsewhere above (or below) it
          const place = left > 85 ? `right-2.5 ${under ? "top-0" : "-translate-y-1/2"}` : `-translate-x-1/2 ${under ? "top-2" : "bottom-2"}`;
          return (
            <div key={l.key} className="pointer-events-none absolute" style={{ left: `${left}%`, top: `${topPct}%` }}>
              <span className="absolute h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: l.color, boxShadow: "0 0 0 2px var(--panel)" }} />
              <span className={`absolute whitespace-nowrap rounded bg-panel/85 px-1 text-[11px] font-semibold text-ink ${place}`}>{unit(p.v)}</span>
            </div>
          );
        })}

        {hv && (
          <div className={`pointer-events-none absolute top-0 z-10 min-w-[180px] rounded-lg border border-line bg-panel-2 px-3 py-2 shadow-[var(--shadow-2)] ${100 * (hv.t - t0) / (t1 - t0) > 62 ? "-translate-x-[calc(100%+10px)]" : "translate-x-[10px]"}`}
            style={{ left: pct(hv.t) }}>
            <div className="mono text-[10.5px] text-muted">{fmtTime(hv.t)}</div>
            {lines.map((l) => {
              const v = l.values.reduce((b, p) => (Math.abs(p.t - hv.t) < Math.abs(b.t - hv.t) ? p : b), l.values[0]);
              return (
                <div key={l.key} className="mt-1 flex items-center gap-2">
                  <span className="h-[2px] w-3 rounded" style={{ background: l.color }} />
                  <span className="text-[13px] font-semibold">{unit(v?.v ?? 0)}</span>
                  <span className="text-[11px] text-muted">{l.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
