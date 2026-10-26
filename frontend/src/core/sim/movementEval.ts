/** Evaluate movement legs at a given time. Used by the simulator (re-routing) and every 3D frame. */

import type { MovementLeg } from "../types";

export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  dist: number; // distance travelled since the movement started (for wheel rotation)
  kind: string;
}

const hdg = (ax: number, ay: number, bx: number, by: number) =>
  ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;

function legHeading(leg: MovementLeg, i: number): number {
  const s = leg.s;
  if (leg.h0 !== undefined) return i > 0 ? (leg.h1 ?? 0) : leg.h0;
  for (let j = Math.max(0, i); j < s.length - 1; j++) {
    const a = s[j], b = s[j + 1];
    if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) > 1e-6) {
      const h = hdg(a[0], a[1], b[0], b[1]);
      return leg.reverse ? (h + 180) % 360 : h;
    }
  }
  for (let j = Math.min(i, s.length - 1); j > 0; j--) {
    const a = s[j - 1], b = s[j];
    if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) > 1e-6) {
      const h = hdg(a[0], a[1], b[0], b[1]);
      return leg.reverse ? (h + 180) % 360 : h;
    }
  }
  return 0;
}

/** Exact pose at time t, or the end pose if t is past the movement. Returns null for empty input. */
export function positionAt(legs: MovementLeg[] | null | undefined, t: number): Pose | null {
  if (!legs || !legs.length) return null;
  let travelled = 0;
  const first = legs[0].s[0];
  if (t < first[3]) return { x: first[0], y: first[1], z: first[2], heading: legHeading(legs[0], 0), speed: 0, dist: 0, kind: legs[0].kind };
  for (const leg of legs) {
    const s = leg.s;
    if (t > s[s.length - 1][3]) {
      for (let i = 0; i < s.length - 1; i++) travelled += Math.hypot(s[i + 1][0] - s[i][0], s[i + 1][1] - s[i][1]);
      continue;
    }
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (t > b[3]) { travelled += Math.hypot(b[0] - a[0], b[1] - a[1]); continue; }
      const dt = b[3] - a[3];
      let f = 1;
      let along = seg;
      if (dt > 1e-9) {
        const tau = Math.max(0, t - a[3]);
        const acc = (b[4] - a[4]) / dt;
        along = a[4] * tau + 0.5 * acc * tau * tau;
        f = seg < 1e-9 ? 0 : Math.max(0, Math.min(1, along / seg));
      }
      const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
      let heading: number;
      if (leg.h0 !== undefined) {
        const ff = dt <= 1e-9 ? 0 : (t - a[3]) / dt;
        const d = ((((leg.h1 ?? 0) - leg.h0) % 360) + 540) % 360 - 180;
        heading = (leg.h0 + d * ff + 360) % 360;
      } else if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) > 1e-6) {
        heading = hdg(a[0], a[1], b[0], b[1]);
        if (leg.reverse) heading = (heading + 180) % 360;
      } else heading = legHeading(leg, i);
      const speed = a[4] + (b[4] - a[4]) * (dt <= 1e-9 ? 0 : (t - a[3]) / dt);
      return { x, y, z, heading, speed, dist: travelled + Math.min(seg, along), kind: leg.kind };
    }
  }
  const last = legs[legs.length - 1];
  const p = last.s[last.s.length - 1];
  return { x: p[0], y: p[1], z: p[2], heading: legHeading(last, last.s.length - 2), speed: 0, dist: travelled, kind: last.kind };
}
