/**
 * Kinematic movement plans. A movement is a list of legs; each leg is a polyline of samples
 * [x, y, z, t, v] (metres, sim seconds, m/s). Between two samples speed changes linearly with
 * time (constant acceleration), so `positionAt` is exact and identical for the simulator and the 3D view.
 *
 * Simplifications (documented): nose-gear point mass on taxiway centrelines, no ground-conflict
 * deconfliction between taxiing aircraft, constant 3° glide path, constant accelerations.
 */

import type { AircraftType } from "../aircraft";
import { dedupe, dist, headingOf, offsetPoint, roundCorners, type Pt } from "../airports/graph";
import { departureEntry, holdNodeForEntry, landingExit, type AirportInfo, type StandInfo } from "../airports/registry";
import type { MovementLeg } from "../types";

const LAT_ACC = 0.9;
const TAXI_ACC = 0.45;
const TAXI_DEC = 0.6;
const SAMPLE_STEP = 12;
export const APPROACH_DIST = 9000;
const GLIDE = Math.tan((3 * Math.PI) / 180);
const TCH = 15;

type P3 = [number, number, number];

function densify(pts: P3[], step = SAMPLE_STEP): P3[] {
  const out: P3[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.floor(d / step));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    }
  }
  return out;
}

export function timeParameterize(input: P3[], t0: number, vStart: number, vEnd: number, vMax: number,
  opts: { acc?: number; dec?: number; curvature?: boolean; kind?: string } = {}): MovementLeg {
  const acc = opts.acc ?? TAXI_ACC, dec = opts.dec ?? TAXI_DEC, kind = opts.kind ?? "taxi";
  const pts = densify(input);
  const n = pts.length;
  if (n === 1) return { kind, s: [[pts[0][0], pts[0][1], pts[0][2], t0, 0]] };
  const seg = Array.from({ length: n - 1 }, (_, i) => Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) || 1e-3);
  const vlim = new Array(n).fill(vMax);
  if (opts.curvature !== false) {
    for (let i = 1; i < n - 1; i++) {
      const h1 = headingOf([pts[i - 1][0], pts[i - 1][1]], [pts[i][0], pts[i][1]]);
      const h2 = headingOf([pts[i][0], pts[i][1]], [pts[i + 1][0], pts[i + 1][1]]);
      const dh = Math.abs(((((h2 - h1) % 360) + 540) % 360) - 180);
      if (dh > 0.5) {
        const r = (0.5 * (seg[i - 1] + seg[i])) / ((dh * Math.PI) / 180);
        vlim[i] = Math.max(2.5, Math.min(vMax, Math.sqrt(LAT_ACC * r)));
      }
    }
  }
  vlim[n - 1] = vEnd;
  const v = [...vlim];
  v[0] = vStart;
  for (let i = 0; i < n - 1; i++) v[i + 1] = Math.min(v[i + 1], Math.sqrt(v[i] ** 2 + 2 * acc * seg[i]));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * dec * seg[i]));
  if (vStart > 0) v[0] = Math.min(v[0], vStart);
  let t = t0;
  const s: number[][] = [[pts[0][0], pts[0][1], pts[0][2], t, v[0]]];
  for (let i = 0; i < n - 1; i++) {
    const vs = v[i] + v[i + 1];
    t += vs > 1e-6 ? (2 * seg[i]) / vs : seg[i] / 0.5;
    s.push([pts[i + 1][0], pts[i + 1][1], pts[i + 1][2], t, v[i + 1]]);
  }
  return { kind, s };
}

export const holdLeg = (p: Pt, t0: number, t1: number, z = 0): MovementLeg =>
  ({ kind: "hold", s: [[p[0], p[1], z, t0, 0], [p[0], p[1], z, t1, 0]] });

export const pivotLeg = (p: Pt, t0: number, duration: number, h0: number, h1: number): MovementLeg =>
  ({ kind: "pivot", s: [[p[0], p[1], 0, t0, 0], [p[0], p[1], 0, t0 + duration, 0]], h0, h1 });

export const legT0 = (l: MovementLeg) => l.s[0][3];
export const legT1 = (l: MovementLeg) => l.s[l.s.length - 1][3];
export const legsEnd = (legs: MovementLeg[]) => (legs.length ? legT1(legs[legs.length - 1]) : 0);

export const turnRadius = (t: AircraftType) => (t.wingspan < 40 ? 32 : 45);

export function standLinkPoints(ap: AirportInfo, st: StandInfo): Pt[] {
  const entry = ap.graph.node(st.entryNode);
  if (st.leadIn.length >= 2) {
    let pts = [...st.leadIn];
    if (dist(pts[0], [st.x, st.y]) < dist(pts[pts.length - 1], [st.x, st.y])) pts = pts.reverse();
    if (dist(pts[0], entry) > 1) pts.unshift(entry);
    if (dist(pts[pts.length - 1], [st.x, st.y]) > 1) pts.push([st.x, st.y]);
    return pts;
  }
  return [entry, offsetPoint([st.x, st.y], st.heading, -35), [st.x, st.y]];
}

const flat = (pts: Pt[]): P3[] => pts.map((p) => [p[0], p[1], 0]);

/** Approach + landing roll + taxi to the stand (or to a holding point when no stand is available). */
export function planArrival(ap: AirportInfo, t: AircraftType, touchdown: number, target: StandInfo | null,
  holdPoint: Pt | null, wet = false): { legs: MovementLeg[]; tEnd: number; rollEnd: number } {
  const end = ap.runwayEnds[ap.arrivalEnd];
  const hx = Math.sin((end.heading * Math.PI) / 180), hy = Math.cos((end.heading * Math.PI) / 180);
  const tdDist = 400;
  const td: Pt = [end.x + hx * tdDist, end.y + hy * tdDist];
  const start: Pt = [end.x - hx * APPROACH_DIST, end.y - hy * APPROACH_DIST];
  const vApp = t.approachSpeed;
  const tApp0 = touchdown - (APPROACH_DIST + tdDist) / vApp;
  const approach: MovementLeg = {
    kind: "approach",
    s: [[start[0], start[1], TCH + GLIDE * APPROACH_DIST, tApp0, vApp], [end.x, end.y, TCH, tApp0 + APPROACH_DIST / vApp, vApp],
      [td[0], td[1], 0, touchdown, vApp]],
  };
  const decel = wet ? 1.45 : 1.8;
  const stopDist = (vApp ** 2 - 15 ** 2) / (2 * decel);
  const [exitNode, exitDist, exitAngle] = landingExit(ap, end, tdDist, stopDist);
  const vExit = exitAngle < 50 ? 14 : 7;
  const rollEndAlong = Math.max(exitDist, tdDist + 50);
  const rollEnd: Pt = [end.x + hx * rollEndAlong, end.y + hy * rollEndAlong];
  const landing = timeParameterize([[td[0], td[1], 0], [rollEnd[0], rollEnd[1], 0]], touchdown, vApp, vExit, vApp,
    { acc: 0.5, dec: decel, curvature: false, kind: "landing" });
  const route: Pt[] = [rollEnd];
  if (target) {
    const path = ap.graph.shortestPath(exitNode, target.entryNode);
    if (path) route.push(...ap.graph.pathPoints(path)); else route.push(ap.graph.node(exitNode));
    route.push(...standLinkPoints(ap, target));
  } else if (holdPoint) {
    const hn = ap.graph.nearestNode(holdPoint[0], holdPoint[1]);
    const path = ap.graph.shortestPath(exitNode, hn);
    if (path) route.push(...ap.graph.pathPoints(path)); else route.push(ap.graph.node(exitNode), holdPoint);
  }
  const taxi = timeParameterize(flat(roundCorners(dedupe(route), turnRadius(t))), legT1(landing), vExit, 0, t.taxiSpeed);
  return { legs: [approach, landing, taxi], tEnd: legT1(taxi), rollEnd: legT1(landing) };
}

export function planTaxiFromHold(ap: AirportInfo, t: AircraftType, start: Pt, t0: number, target: StandInfo): MovementLeg {
  const sn = ap.graph.nearestNode(start[0], start[1]);
  const path = ap.graph.shortestPath(sn, target.entryNode);
  const pts: Pt[] = [start];
  if (path) pts.push(...ap.graph.pathPoints(path));
  pts.push(...standLinkPoints(ap, target));
  return timeParameterize(flat(roundCorners(dedupe(pts), turnRadius(t))), t0, 0, 0, t.taxiSpeed);
}

/** Pushback, engine start, taxi out, line-up, take-off roll and initial climb. */
export function planDeparture(ap: AirportInfo, t: AircraftType, st: StandInfo, tPush: number):
  { legs: MovementLeg[]; tTakeoff: number; tClear: number; tRoll: number } {
  const back = [...standLinkPoints(ap, st)].reverse();
  const push = timeParameterize(flat(back), tPush, 0, 0, 1.6, { acc: 0.25, dec: 0.3, curvature: false, kind: "pushback" });
  push.reverse = true;
  const endPt = back[back.length - 1];
  const dep = ap.runwayEnds[ap.departureEnd];
  const [entry] = departureEntry(dep);
  const hold = holdNodeForEntry(ap, entry);
  const path = ap.graph.shortestPath(st.entryNode, hold);
  let route: Pt[] = [endPt];
  if (path) route.push(...ap.graph.pathPoints(path));
  route.push(ap.graph.node(entry));
  route = roundCorners(dedupe(route), turnRadius(t));
  const hTaxi = route.length > 1 ? headingOf(route[0], route[1]) : st.heading;
  const pivot = pivotLeg(endPt, legT1(push), 50, st.heading, hTaxi);
  const start = holdLeg(endPt, legT1(pivot), legT1(pivot) + 70);
  const taxi = timeParameterize(flat(route), legT1(start), 0, 0, t.taxiSpeed);
  const entryPt = ap.graph.node(entry);
  const hIn = route.length > 1 ? headingOf(route[route.length - 2], route[route.length - 1]) : dep.heading;
  const lineup = pivotLeg(entryPt, legT1(taxi), 25, hIn, dep.heading);
  const wait = holdLeg(entryPt, legT1(lineup), legT1(lineup) + 20);
  const tRoll = legT1(wait);
  const hx = Math.sin((dep.heading * Math.PI) / 180), hy = Math.cos((dep.heading * Math.PI) / 180);
  const vr = t.rotateSpeed;
  const rollLen = vr ** 2 / (2 * t.takeoffAccel);
  const rollEnd: Pt = [entryPt[0] + hx * rollLen, entryPt[1] + hy * rollLen];
  const roll = timeParameterize([[entryPt[0], entryPt[1], 0], [rollEnd[0], rollEnd[1], 0]], tRoll, 0, vr, vr,
    { acc: t.takeoffAccel, dec: 3, curvature: false, kind: "takeoff" });
  const climbLen = 9000;
  const climbEnd: Pt = [rollEnd[0] + hx * climbLen, rollEnd[1] + hy * climbLen];
  const climb: MovementLeg = {
    kind: "climb",
    s: [[rollEnd[0], rollEnd[1], 0, legT1(roll), vr], [climbEnd[0], climbEnd[1], climbLen * 0.075, legT1(roll) + climbLen / (vr + 12), vr + 25]],
  };
  return { legs: [push, pivot, start, taxi, lineup, wait, roll, climb], tTakeoff: legT1(roll), tClear: legT1(push), tRoll };
}

export function planTow(ap: AirportInfo, t: AircraftType, src: StandInfo, dst: StandInfo, t0: number): MovementLeg[] {
  const back = [...standLinkPoints(ap, src)].reverse();
  const push = timeParameterize(flat(back), t0, 0, 0, 1.6, { acc: 0.25, dec: 0.3, curvature: false, kind: "pushback" });
  push.reverse = true;
  let route: Pt[] = [back[back.length - 1]];
  const path = ap.graph.shortestPath(src.entryNode, dst.entryNode);
  if (path) route.push(...ap.graph.pathPoints(path));
  route.push(...standLinkPoints(ap, dst));
  route = roundCorners(dedupe(route), turnRadius(t));
  const h1 = route.length > 1 ? headingOf(route[0], route[1]) : src.heading;
  const pivot = pivotLeg(back[back.length - 1], legT1(push), 45, src.heading, h1);
  const tow = timeParameterize(flat(route), legT1(pivot), 0, 0, 4, { acc: 0.2, dec: 0.25, kind: "tow" });
  return [push, pivot, tow];
}
