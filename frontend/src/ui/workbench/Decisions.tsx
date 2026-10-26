"use client";

import { Accessibility, ArrowRightLeft, ChevronDown, ChevronRight, Hourglass, PlaneLanding, Truck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { explainDecision } from "@/core/agents/explain";
import { AIRCRAFT } from "@/core/aircraft";
import type { Proposal } from "@/core/approvals/workflow";
import type { Decision } from "@/core/sim/engine";
import { useOps, useRuntime } from "@/store/ops";
import { airlineName, iata } from "../common/format";

const GROUPS: { action: Decision["action"]; title: string; icon: typeof Truck; tone: string }[] = [
  { action: "unresolved", title: "Unresolved — needs human action", icon: TriangleAlert, tone: "var(--red)" },
  { action: "divert", title: "Coordinated diversions", icon: PlaneLanding, tone: "var(--amber)" },
  { action: "tow", title: "Tows", icon: Truck, tone: "var(--navy)" },
  { action: "assign_stand", title: "Stand reassignments", icon: ArrowRightLeft, tone: "var(--navy)" },
  { action: "landing_slot", title: "Landing-sequence targets", icon: Hourglass, tone: "var(--teal)" },
];

export function Decisions({ p }: { p: Proposal }) {
  const rt = useRuntime();
  const [open, setOpen] = useState<Record<string, boolean>>({ unresolved: true, divert: true, tow: true, assign_stand: true, landing_slot: false });
  const [expanded, setExpanded] = useState<string | null>(null);
  const { select, setView, setAirport } = useOps();
  return (
    <div className="panel overflow-hidden">
      <div className="panel-h">
        <div>
          <div className="panel-t">What changes — {p.plan.decisions.length} recovery actions</div>
          <div className="text-[11px] text-muted">Every action comes from optimiser output; explanations are generated from the same facts.</div>
        </div>
      </div>
      {GROUPS.map((g) => {
        const ds = p.plan.decisions.filter((d) => d.action === g.action);
        if (!ds.length) return null;
        const Icon = g.icon;
        const isOpen = open[g.action];
        return (
          <div key={g.action} className="border-b border-line last:border-0">
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-2" onClick={() => setOpen({ ...open, [g.action]: !isOpen })}>
              {isOpen ? <ChevronDown size={13} className="text-faint" /> : <ChevronRight size={13} className="text-faint" />}
              <Icon size={14} style={{ color: g.tone }} />
              <span className="text-[12px] font-semibold">{g.title}</span>
              <span className="pill pill-gray">{ds.length}</span>
            </button>
            {isOpen && (
              <ul>
                {ds.slice(0, g.action === "landing_slot" ? 40 : 200).map((d) => {
                  const v = rt.world.visits[d.visit];
                  const ex = explainDecision(d, rt.world, rt.airports);
                  const key = `${d.action}:${d.visit}`;
                  const exp = expanded === key;
                  return (
                    <li key={key} className="border-t border-line">
                      <button className="flex w-full items-start gap-3 px-3 py-2 pl-9 text-left hover:bg-bg-2" onClick={() => setExpanded(exp ? null : key)}>
                        <div className="w-[92px] shrink-0">
                          <div className="mono text-[12px] font-semibold">{d.callsign}</div>
                          <div className="truncate text-[10.5px] text-muted">{v ? airlineName(v.airline) : ""}</div>
                        </div>
                        <div className="w-[118px] shrink-0 text-[11px] text-muted">
                          {v ? AIRCRAFT[v.type].category : ""}<br />{iata(d.airport)}{d.to ? ` → ${iata(d.to)}` : ""}
                          {v?.prm ? <span className="ml-1 inline-flex items-center text-[var(--blue)]"><Accessibility size={11} />{v.prm}</span> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold" style={{ color: g.tone }}>{ex.headline}</div>
                          <div className={`text-[11.5px] leading-snug text-ink-2 ${exp ? "" : "line-clamp-1"}`}>{ex.why}</div>
                          {exp && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              {ex.constraints.map((c) => <span key={c} className="pill pill-outline" style={{ height: 18, fontSize: 10 }}>{c}</span>)}
                              <span className="ml-auto" />
                              {v && <span className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setAirport(d.to && v.airport === d.to ? d.to : v.airport); select({ selectedVisit: v.id }); setView("twin"); }}>Show in digital twin</span>}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
                {g.action === "landing_slot" && ds.length > 40 && <li className="px-9 py-2 text-[11px] text-muted">+{ds.length - 40} more landing targets</li>}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
