/**
 * One definition of the wide-body turnarounds an airport is already committed to, shared by the optimiser,
 * the validator and the simulated airport controllers so all three count handling teams the same way.
 * A turnaround holds a team from on-block until the aircraft is ready (or minimum turnaround after on-block).
 */

import { AIRCRAFT } from "./aircraft";
import type { Registry } from "./airports/registry";
import type { World } from "./types";

const ARRIVING = new Set(["SCHEDULED", "INBOUND", "HOLDING", "APPROACH", "LANDING", "TAXI_IN", "WAITING_STAND"]);

/** [start, end] in sim seconds for wide-body turnarounds at `icao` not in `exclude`, from now on. */
export function wideBodyTurnarounds(w: World, airports: Registry, icao: string, exclude: Set<string>, horizonS = 6 * 3600): [number, number][] {
  const out: [number, number][] = [];
  const now = w.now;
  for (const v of Object.values(w.visits)) {
    if (v.airport !== icao || exclude.has(v.id) || !AIRCRAFT[v.type].widebody) continue;
    if (v.phase === "ON_STAND" && v.readyAt !== null && v.readyAt > now) out.push([now, v.readyAt]);
    else if (ARRIVING.has(v.phase) && v.stand) {
      const land = v.eldt ?? v.eta;
      if (land === null || land > now + horizonS) continue;
      const on = Math.max(now, land + (airports[icao]?.stands[v.stand]?.taxiIn ?? 420));
      out.push([on, on + v.minTat]);
    }
  }
  return out;
}
