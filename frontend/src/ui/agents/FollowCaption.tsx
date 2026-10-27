"use client";

import { ChevronLeft, ChevronRight, Loader2, Pause, Play, X } from "lucide-react";
import { fmtTime } from "@/core/world";
import { SPOTS } from "./AgentConstellation";
import type { Beat } from "./follow";

/** The caption under the scene while following the agents: who acts, what happened, the numbers that matter. */
export function FollowCaption({ beat, index, total, playing, waiting, progress, top, onPrev, onNext, onToggle, onClose }: {
  beat: Beat; index: number; total: number; playing: boolean; waiting: boolean; progress: number;
  /** sit at the top of the stage (the guided demo's panel takes the bottom of the screen) */
  top?: boolean;
  onPrev: () => void; onNext: () => void; onToggle: () => void; onClose: () => void;
}) {
  const s = SPOTS[beat.who];
  const Icon = s?.icon;
  const color = beat.tone === "bad" && s?.person ? "#d65c5c" : s?.person ? "#5b7aa6" : s?.color ?? "#5b7aa6";
  return (
    <div className={`absolute inset-x-4 ${top ? "top-4" : "bottom-4"} overflow-hidden rounded-2xl border border-white/10 bg-[rgba(7,14,24,0.9)] text-white shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-md`}>
      <div className="h-[3px] bg-white/10"><div className="h-full bg-[#4fb8a4] transition-[width] duration-200" style={{ width: `${((index + progress) / Math.max(1, total)) * 100}%` }} /></div>
      <div className="flex items-start gap-4 px-5 pb-3 pt-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full ring-4 ring-white/10" style={{ background: color }}>
          {Icon && <Icon size={22} color="#fff" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-[12px] text-white/55">
            <span className="text-[13px] font-semibold text-white">{beat.name}</span>
            <span className="mono">{fmtTime(beat.t)}</span>
            <span className="ml-auto">step {index + 1} of {total}</span>
          </div>
          <div className={`mt-1 text-[19px] font-semibold leading-snug tracking-tight ${beat.tone === "bad" ? "text-[#ffb4b4]" : beat.tone === "good" ? "text-[#9be3d2]" : ""}`}>{beat.headline}</div>
          {beat.facts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2">
              {beat.facts.map((f) => (
                <div key={f.label} className="min-w-[120px] max-w-[260px]">
                  <div className={`text-[26px] font-semibold leading-none tracking-tight ${f.tone === "bad" ? "text-[#ff8f8f]" : f.tone === "good" ? "text-[#5fd3bb]" : "text-white"}`}>{f.value}</div>
                  <div className="mt-1 text-[11.5px] leading-snug text-white/65">{f.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {beat.spark && beat.spark.length > 1 && <Spark values={beat.spark} />}
      </div>
      <div className="flex items-center gap-1.5 border-t border-white/10 px-4 py-2 text-[11.5px] text-white/55">
        <button className="hud-btn !px-1.5" onClick={onPrev} disabled={index === 0} aria-label="Previous step"><ChevronLeft size={14} /></button>
        <button className="hud-btn !px-1.5" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
        <button className="hud-btn !px-1.5" onClick={onNext} disabled={index >= total - 1} aria-label="Next step"><ChevronRight size={14} /></button>
        <span className="ml-2">
          {waiting ? <span className="inline-flex items-center gap-1.5 text-[#e0a646]"><Loader2 size={12} className="animate-spin" /> The agents are still working; the next step appears as soon as it happens</span>
            : "The camera follows each agent in turn. Pause or step through at your own pace."}
        </span>
        <button className="hud-btn ml-auto" onClick={onClose}><X size={12} /> Stop following</button>
      </div>
    </div>
  );
}

/** Planes circling over the next 4 hours if nobody acts, as a small rising line. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const W = 190, H = 64;
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
