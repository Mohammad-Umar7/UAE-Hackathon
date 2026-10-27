"use client";

import { Bot, ChevronDown, Cpu, FastForward, Moon, Pause, Play, Presentation, RotateCcw, SkipForward, Sun, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AGENTS } from "@/core/agents/definitions";
import { roleOf, SWITCHABLE_ROLES } from "@/core/approvals/roles";
import { isOpen } from "@/core/approvals/workflow";
import { fmtTime } from "@/core/world";
import { useOps, useRuntime } from "@/store/ops";
import { Logo } from "./Logo";

const SPEEDS = [1, 10, 30, 60, 120];
/** Simple mode: one comfortable speed (a simulated minute every two seconds) and a skip that fast-forwards only
 *  until the next thing happens — a disruption starting or an agent acting — then drops back to it. */
const NORMAL = 30, SKIP = 180;

export function TopBar() {
  const rt = useRuntime();
  const { role, setRole, theme, setTheme, setPresentation, presentation, setView, detail } = useOps();
  const expert = detail === "expert";
  const [roleOpen, setRoleOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setRoleOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);
  const w = rt.world;
  const comp = rt.orchestrator.computing;
  const myPending = Object.values(rt.proposals).filter(isOpen).flatMap((p) => p.approvals.filter((a) => a.key === role && a.decision === "PENDING"));
  const r = roleOf(role);
  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <div className="flex items-center gap-2.5 pr-2">
        <Logo size={28} />
        <div className="leading-tight">
          <div className="text-[13.5px] font-semibold tracking-tight">SKYPACT</div>
          <div className="whitespace-nowrap text-[10.5px] text-muted">Disruption Recovery &amp; Coordination</div>
        </div>
      </div>
      <div className="h-7 w-px bg-line" />
      <button className="btn btn-ghost h-8 max-w-[260px]" onClick={() => setView("lab")} title="Scenario Lab">
        <span className="pill pill-navy">{rt.scenario.code}</span>
        <span className="truncate font-semibold">{rt.scenario.title}</span>
        {expert && <span className="mono text-faint">seed {rt.seed}</span>}
      </button>

      {/* clock */}
      <div className="mx-auto flex items-center gap-2">
        <div className="flex items-baseline gap-1.5 rounded-lg border border-line bg-panel-2 px-3 py-1">
          <span className="mono text-[17px] font-semibold tracking-tight">{fmtTime(w.now, true)}</span>
          <span className="whitespace-nowrap text-[10.5px] text-muted">GST<span className="max-[1799px]:hidden"> · synthetic day</span></span>
        </div>
        {!expert && <SimpleClock />}
        <div className={`items-center gap-1 ${expert ? "flex" : "hidden"}`}>
          <button className="btn h-8 w-8 justify-center p-0" onClick={() => rt.setRunning(!rt.running)} title={rt.running ? "Pause" : "Run"}>
            {rt.running ? <Pause size={15} /> : <Play size={15} />}
          </button>
          {expert && (
            <button className="btn h-8 w-8 justify-center p-0" onClick={() => rt.step(60)} title="Step one minute" disabled={rt.held}>
              <SkipForward size={15} />
            </button>
          )}
          <div className="flex h-8 items-center rounded-[7px] border border-line-2 bg-panel-2 p-0.5">
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => rt.setSpeed(s)}
                className={`mono h-[26px] rounded-[5px] px-1.5 text-[11px] ${rt.speed === s ? "bg-navy text-white" : "text-muted hover:text-ink"}`}>
                {s}×
              </button>
            ))}
          </div>
          {expert && (
            <button className="btn h-8 w-8 justify-center p-0" title="Reset scenario (same seed)" onClick={() => rt.reset()}>
              <RotateCcw size={14} />
            </button>
          )}
        </div>
        {expert && <ClockState held={rt.held} running={rt.running} speed={rt.speed} comp={comp ? `${AGENTS[comp.agent].short} · ${comp.tool}` : null} />}
      </div>

      <div className="flex items-center gap-2">
        {expert && <span className={`pill ${rt.llm?.available ? "pill-teal" : "pill-gray"}`} title={rt.llm?.available ? `Optional local model for briefings (${rt.llm.model}); optimisation, validation and approvals are deterministic` : "No local language model detected — deterministic agents (fully functional)"}>
          {rt.llm?.available ? <Cpu size={12} /> : <Bot size={12} />}
          <span className="max-[1699px]:hidden">Agents · </span>{rt.llm?.available ? "local LLM" : "deterministic"}
        </span>}
        <button className={`btn h-8 ${presentation.active ? "btn-primary" : ""}`} onClick={() => setPresentation({ active: !presentation.active, step: presentation.active ? presentation.step : 0 })}>
          <Presentation size={14} /> Guided demo
        </button>
        <button className="btn h-8 w-8 justify-center p-0" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Toggle theme">
          {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        <div className="relative" ref={ref}>
          <button className="btn h-9 gap-2 pl-1.5 pr-2" onClick={() => setRoleOpen((o) => !o)}>
            <span className="relative grid h-6 min-w-6 place-items-center rounded-md bg-navy px-1 text-[10px] font-bold text-white">
              {r.initials}
              {myPending.length > 0 && (
                <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--amber)] px-1 text-[9.5px] font-bold text-white ring-2 ring-[var(--panel)]"
                  title={`${myPending.length} approval${myPending.length > 1 ? "s" : ""} waiting for you`}>{myPending.length}</span>
              )}
            </span>
            <span className="max-w-[210px] text-left leading-tight max-[1679px]:max-w-[180px]">
              <span className="block truncate text-[11.5px] font-semibold">{r.title}</span>
              <span className="block truncate text-[10.5px] text-muted max-[1679px]:hidden">{r.person} · simulated user</span>
            </span>
            <ChevronDown size={13} className="text-muted" />
          </button>
          {roleOpen && (
            <div className="panel absolute right-0 top-11 z-50 w-[330px] p-1 shadow-[var(--shadow-2)] fade-in">
              <div className="eyebrow px-2 pb-1 pt-1.5">Act as (role-based permissions)</div>
              <div className="max-h-[60vh] scroll-y">
                {SWITCHABLE_ROLES.map((k) => {
                  const rr = roleOf(k);
                  const pend = Object.values(rt.proposals).filter(isOpen).flatMap((p) => p.approvals.filter((a) => a.key === k && a.decision === "PENDING")).length;
                  return (
                    <button key={k} onClick={() => { setRole(k); setRoleOpen(false); rt.audit.append(rt.world.now, rr.person, k, "ROLE_SWITCH", k, "demo role switch"); }}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg-2 ${k === role ? "bg-navy-soft" : ""}`}>
                      <span className="grid h-6 min-w-7 place-items-center rounded bg-bg-2 px-1 text-[10px] font-bold text-ink-2">{rr.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium">{rr.title}</span>
                        <span className="block truncate text-[10.5px] text-muted">{rr.person} · {rt.stakeholderModes[k] ?? (rr.type === "AIRLINE_REP" ? rt.stakeholderModes.AIRLINE_REP : "")}</span>
                      </span>
                      {pend > 0 && <span className="pill pill-amber">{pend}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5 border-t border-line px-2 py-2 text-[11px] text-muted">
                <UserRound size={12} /> Local demo users — no external authentication.
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function SimpleClock() {
  const rt = useRuntime();
  const skipping = rt.skipping !== null && rt.running;
  const playPause = () => {
    if (!rt.running && rt.speed !== NORMAL) rt.setSpeed(NORMAL);
    rt.setRunning(!rt.running);
  };
  return (
    <div className="flex items-center gap-1.5">
      <button className="btn h-8 px-2.5" onClick={playPause} title={rt.running ? "Pause the simulation" : "Run the simulation (a simulated minute every two seconds)"}>
        {rt.running ? <Pause size={14} /> : <Play size={14} />} {rt.running ? "Pause" : "Play"}
      </button>
      <button className={`btn h-8 px-2.5 ${skipping ? "btn-primary" : ""}`} disabled={rt.held || skipping}
        title="Fast-forward until something happens, then continue at normal speed" onClick={() => rt.skipToNextEvent(SKIP, NORMAL)}>
        <FastForward size={14} /> {skipping ? "Skipping…" : "Skip to next event"}
      </button>
      {rt.held
        ? <span className="pill pill-amber"><span className="relative mr-0.5 inline-block h-2 w-2"><span className="absolute inset-0 rounded-full bg-[var(--amber)]" style={{ animation: "pulse-ring 1.2s ease-out infinite" }} /><span className="absolute inset-0 rounded-full bg-[var(--amber)]" /></span>Agents thinking</span>
        : <span className={`pill pill-dot ${rt.running ? "pill-teal" : "pill-gray"}`}>{rt.running ? "Running" : "Paused"}</span>}
    </div>
  );
}

function ClockState({ held, running, speed, comp }: { held: boolean; running: boolean; speed: number; comp: string | null }) {
  if (held) {
    return (
      <span className="pill pill-amber max-w-[270px]" title="The simulation clock is held while agents compute, so results stay deterministic">
        <span className="relative mr-0.5 inline-block h-2 w-2"><span className="absolute inset-0 rounded-full bg-[var(--amber)]" style={{ animation: "pulse-ring 1.2s ease-out infinite" }} /><span className="absolute inset-0 rounded-full bg-[var(--amber)]" /></span>
        <span className="truncate">Clock held · {comp ?? "agents coordinating"}</span>
      </span>
    );
  }
  return running ? <span className="pill pill-teal pill-dot"><FastForward size={11} /> Running {speed}×</span> : <span className="pill pill-gray pill-dot">Paused</span>;
}
