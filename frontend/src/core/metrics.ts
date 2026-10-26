/**
 * Outcome metrics computed from simulation state — never hard-coded.
 *
 * Delay definitions (A-CDM style): arrival delay = max(0, AIBT − SIBT) for arrivals scheduled in
 * the window; departure delay = max(0, AOBT − SOBT). Flights that have not reached the milestone
 * by the end of the window are censored at the window end. A diverted arrival is measured at its
 * recovery leg's AIBT back at the original destination, and its outbound departure at the return visit's
 * AOBT (censored while the aircraft has not come back).
 */

import type { World } from "./types";

export interface OutcomeMetrics {
  arrDelayMin: number;
  depDelayMin: number;
  totalDelayMin: number;
  paxDelayHours: number;
  arrivals: number;
  departures: number;
  arrDelayed15: number;
  depDelayed15: number;
  avgArrDelayMin: number;
  airborneHoldingMin: number;
  groundWaitMin: number;
  diversionsCoordinated: number;
  diversionsUnplanned: number;
  prmServiceDelays: number;
  prmWaitMin: number;
  standChanges: number;
  window: [number, number];
}

export function outcomeMetrics(w: World, tFrom: number, tTo: number, airports?: Set<string>, schedFrom?: number): OutcomeMetrics {
  const from = schedFrom ?? tFrom - 3 * 3600;
  const now = Math.min(w.now, tTo);
  const arr: [number, number][] = [];
  const dep: [number, number][] = [];
  let holding = 0, groundWait = 0, divPlanned = 0, divUnplanned = 0, prmWait = 0, prmWaitMin = 0, standChanges = 0;
  for (const v of Object.values(w.visits)) {
    if (v.recoveryOf && v.divertedFrom && !v.id.endsWith("<R")) continue; // temporary visit at the alternate
    if (airports && !airports.has(v.airport)) continue;
    standChanges += v.standChanges;
    holding += v.airborneHold;
    if (v.phase === "HOLDING" && v.eta !== null) holding += Math.max(0, now - v.eta);
    groundWait += v.groundWait;
    if (v.phase === "WAITING_STAND" && v.waitingSince !== null) groundWait += Math.max(0, now - v.waitingSince);
    for (const [, kind, detail] of v.history) {
      if (kind === "PRM_WAIT") { prmWait += 1; prmWaitMin += parseFloat(detail) || 0; }
    }
    if (v.phase === "DIVERTED") { if (v.divertPlanned) divPlanned += 1; else divUnplanned += 1; }
    const s = v.arr?.sched;
    if (s !== undefined && s >= from && s <= tTo && !v.id.endsWith("<R")) {
      let end: number;
      if (v.phase === "DIVERTED") {
        const rec = w.visits[`${v.id}<R`];
        end = rec?.aibt ?? now;
      } else end = v.aibt ?? now;
      arr.push([Math.max(0, end - s), v.pax]);
    }
    const d = v.dep?.sched;
    if (d !== undefined && d >= from && d <= tTo) {
      // a diverted aircraft's outbound flight is measured on its return visit; until that visit exists
      // the departure is still pending (censored at the window end) — never silently dropped
      if (v.phase !== "DIVERTED") dep.push([Math.max(0, (v.aobt ?? now) - d), v.dep!.pax]);
      else if (!w.visits[`${v.id}<R`]) dep.push([Math.max(0, now - d), v.dep!.pax]);
    }
  }
  const arrTotal = arr.reduce((s, [x]) => s + x, 0) / 60;
  const depTotal = dep.reduce((s, [x]) => s + x, 0) / 60;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    arrDelayMin: r1(arrTotal), depDelayMin: r1(depTotal), totalDelayMin: r1(arrTotal + depTotal),
    paxDelayHours: r1(arr.reduce((s, [x, p]) => s + x * p, 0) / 3600), arrivals: arr.length, departures: dep.length,
    arrDelayed15: arr.filter(([x]) => x >= 900).length, depDelayed15: dep.filter(([x]) => x >= 900).length,
    avgArrDelayMin: arr.length ? r1(arrTotal / arr.length) : 0, airborneHoldingMin: r1(holding / 60), groundWaitMin: r1(groundWait / 60),
    diversionsCoordinated: divPlanned, diversionsUnplanned: divUnplanned, prmServiceDelays: prmWait, prmWaitMin: r1(prmWaitMin),
    standChanges, window: [tFrom, tTo],
  };
}
