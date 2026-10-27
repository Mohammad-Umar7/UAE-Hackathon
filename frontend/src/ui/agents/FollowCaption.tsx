"use client";

import { ChevronLeft, ChevronRight, Loader2, Pause, Play, X } from "lucide-react";
import { fmtTime } from "@/core/world";
import { SPOTS } from "./AgentConstellation";
import type { Beat, Fact } from "./follow";

/** The caption over the scene while following the agents: who acts, what happened, the numbers that matter, and
 *  (once there is a plan) what the plan achieves against doing nothing. */
export function FollowCaption({ beat, index, total, playing, waiting, progress, top, value, onPrev, onNext, onToggle, onClose }: {
  beat: Beat; index: number; total: number; playing: boolean; waiting: boolean; progress: number;
  /** sit at the top of the stage (the guided demo's bar takes the bottom of the screen) */
  top?: boolean;
  /** the plan's headline effect, kept in view after the planning step */
  value?: Fact | null;
  onPrev: () => void; onNext: () => void; onToggle: () => void; onClose: () => void;
}) {
  const s = SPOTS[beat.who];
  const Icon = s?.icon;
  const color = beat.tone === "bad" && s?.person ? "#d65c5c" : s?.person ? "#5b7aa6" : s?.color ?? "#5b7aa6";
  return (
    <div className={`absolute inset-x-4 ${top ? "top-4" : "bottom-4"} overflow-hidden rounded-2xl border border-white/10 bg-[rgba(7,14,24,0.8)] text-white shadow-[0_16px_48px_rgba(0,0,0,0.4)] backdrop-blur-md`}>
      <div className="flex items-start gap-3 px-4 pb-3 pt-3">
        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full ring-4 ring-white/10" style={{ background: color }}>
          {Icon && <Icon size={19} color="#fff" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11.5px] text-white/55">
            <span className="text-[12.5px] font-semibold text-white">{beat.name}</span>
            <span className="mono">{fmtTime(beat.t)}</span>
            {waiting && <span className="flex items-center gap-1 text-[#e0a646]"><Loader2 size={11} className="animate-spin" /> next agent at work…</span>}
            <span className="ml-auto mono">{index + 1}/{total}</span>
            <span className="flex items-center gap-0.5">
              <button className="rounded p-1 hover:bg-white/10 disabled:opacity-30" onClick={onPrev} disabled={index === 0} aria-label="Previous step"><ChevronLeft size={14} /></button>
              <button className="rounded p-1 hover:bg-white/10" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
              <button className="rounded p-1 hover:bg-white/10 disabled:opacity-30" onClick={onNext} disabled={index >= total - 1} aria-label="Next step"><ChevronRight size={14} /></button>
              <button className="rounded p-1 hover:bg-white/10" onClick={onClose} aria-label="Stop following"><X size={13} /></button>
            </span>
          </div>
          <div className={`mt-0.5 text-[17px] font-semibold leading-snug tracking-tight ${beat.tone === "bad" ? "text-[#ffb4b4]" : beat.tone === "good" ? "text-[#9be3d2]" : ""}`}>{beat.headline}</div>
          {beat.facts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5">
              {beat.facts.map((f) => (
                <div key={f.label} className="flex items-baseline gap-2">
                  <span className={`text-[22px] font-semibold leading-none tracking-tight ${f.tone === "bad" ? "text-[#ff8f8f]" : f.tone === "good" ? "text-[#5fd3bb]" : "text-white"}`}>{f.value}</span>
                  <span className="max-w-[210px] text-[11.5px] leading-snug text-white/65">{f.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {beat.spark && beat.spark.length > 1 && <Spark values={beat.spark} />}
        {value && (
          <div className="hidden shrink-0 rounded-xl border border-[#5fd3bb]/30 bg-[#5fd3bb]/10 px-3 py-2 text-right lg:block">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9be3d2]/80">With this plan</div>
            <div className="text-[20px] font-semibold leading-tight text-[#5fd3bb]">{value.value}</div>
            <div className="text-[11px] text-white/60">{value.label}</div>
          </div>
        )}
      </div>
      <div className="h-[2px] bg-white/10"><div className="h-full bg-[#4fb8a4] transition-[width] duration-200" style={{ width: `${((index + progress) / Math.max(1, total)) * 100}%` }} /></div>
    </div>
  );
}

/** Planes circling over the next 4 hours if nobody acts, as a small rising line. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const W = 170, H = 54;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${(H - (v / max) * (H - 6)).toFixed(1)}`).join("");
  return (
    <div className="hidden shrink-0 lg:block">
      <div className="mb-1 text-[11px] text-white/55">planes circling, next 4 hours</div>
      <svg width={W} height={H} className="overflow-visible">
        <path d={`${d}L${W},${H}L0,${H}Z`} fill="#de6464" opacity={0.18} />
        <path d={d} fill="none" stroke="#de6464" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={W} cy={H - (values[values.length - 1] / max) * (H - 6)} r={4} fill="#de6464" stroke="#0b1622" strokeWidth={2} />
      </svg>
      <div className="flex justify-between text-[10.5px] text-white/45"><span>now</span><span>up to {Math.max(...values)} at once</span></div>
    </div>
  );
}
