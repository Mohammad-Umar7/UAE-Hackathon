/**
 * Real carriers serving Abu Dhabi, Dubai and Sharjah, keyed by ICAO designator; their flight numbers are in routes.ts.
 * The day built from them is synthetic: timings, passenger numbers, stands and disruptions are generated.
 * Liveries are simplified colour schemes applied to the procedural aircraft (M_Paint_* materials); no logos.
 */

import type { TypeKey } from "./aircraft";
import { BOUND_FOR, ROUTES } from "./routes";

export interface Livery {
  top: string;
  belly: string;
  cheatline: string;
  tail: string;
  tailAccent: string;
  engine: string;
  title: string;
}

export interface Airline {
  code: string;
  /** IATA designator: the prefix of the flight numbers shown to people (EK203). */
  iata: string;
  name: string;
  callsign: string;
  base: string | null;
  kind: "hub" | "low_cost" | "regional" | "cargo" | "business" | "foreign";
  fleet: TypeKey[];
  livery: Livery;
  /** Airports in the network where the carrier has a handling arrangement (diversions need one). */
  handlingAt: string[];
}

const L = (top: string, belly: string, cheatline: string, tail: string, tailAccent: string, engine: string,
  title: string): Livery => ({ top, belly, cheatline, tail, tailAccent, engine, title });

const ALL = ["OMAA", "OMDB", "OMSJ"];

export const AIRLINES: Record<string, Airline> = Object.fromEntries(
  ([
    ["ETD", "EY", "Etihad Airways", "ETIHAD", "OMAA", "hub", ["nb", "wb", "vla"], L("#F3EFE7", "#D9CDB8", "#B8925A", "#B8925A", "#4D4F53", "#F3EFE7", "#8C6B45"), ALL],
    ["UAE", "EK", "Emirates", "EMIRATES", "OMDB", "hub", ["wb", "vla"], L("#FFFFFF", "#E8E6E1", "#D71921", "#FFFFFF", "#D71921", "#F4F3F0", "#D71921"), ["OMDB", "OMAA"]],
    ["FDB", "FZ", "flydubai", "SKYDUBAI", "OMDB", "low_cost", ["nb"], L("#FFFFFF", "#0B3A75", "#F37021", "#0B3A75", "#F37021", "#F37021", "#0B3A75"), ALL],
    ["ABY", "G9", "Air Arabia", "ARABIA", "OMSJ", "low_cost", ["nb"], L("#FFFFFF", "#E6E7E8", "#E2231A", "#E2231A", "#9D9FA2", "#E2231A", "#E2231A"), ["OMSJ", "OMDB"]],
    ["GFA", "GF", "Gulf Air", "GULF AIR", "OBBI", "regional", ["reg"], L("#FFFFFF", "#ECE6DA", "#C5A253", "#D0103A", "#C5A253", "#D0103A", "#D0103A"), ALL],
    ["OMS", "OV", "SalamAir", "MAZOON", "OOMS", "regional", ["reg"], L("#FFFFFF", "#E9F2EF", "#7FC241", "#00A19A", "#7FC241", "#00A19A", "#00A19A"), ALL],
    ["ETH", "ET", "Ethiopian Cargo", "ETHIOPIAN", null, "cargo", ["cargo"], L("#FFFFFF", "#DCDFE3", "#078930", "#078930", "#FCDD09", "#DCDFE3", "#078930"), ALL],
    ["CSS", "O3", "SF Airlines", "SHUN FENG", null, "cargo", ["cargo"], L("#FFFFFF", "#D9DADC", "#111111", "#111111", "#FFFFFF", "#D9DADC", "#111111"), ALL],
    ["ROJ", "ROJ", "Royal Jet", "ROYALJET", "OMAA", "business", ["biz"], L("#F2F2F0", "#2B3550", "#9C7A3C", "#2B3550", "#9C7A3C", "#F2F2F0", "#2B3550"), ALL],
    ["BAW", "BA", "British Airways", "SPEEDBIRD", null, "foreign", ["wb"], L("#FFFFFF", "#1B2A5C", "#EB2226", "#1B2A5C", "#EB2226", "#1B2A5C", "#1B2A5C"), ["OMDB", "OMAA"]],
    ["QTR", "QR", "Qatar Airways", "QATARI", null, "foreign", ["wb", "nb"], L("#E9E9EA", "#D3D0CB", "#5C0632", "#5C0632", "#E9E9EA", "#5C0632", "#5C0632"), ["OMDB", "OMAA"]],
    ["IGO", "6E", "IndiGo", "IFLY", null, "foreign", ["nb"], L("#FFFFFF", "#1B2C8F", "#1B2C8F", "#1B2C8F", "#FFFFFF", "#1B2C8F", "#1B2C8F"), ALL],
    ["SVA", "SV", "Saudia", "SAUDIA", null, "hub", ["nb", "wb"], L("#FFFFFF", "#E7E2D6", "#3FA9DD", "#00843D", "#3FA9DD", "#FFFFFF", "#00843D"), ALL],
    ["AXB", "IX", "Air India Express", "EXPRESS INDIA", null, "low_cost", ["nb"], L("#FFFFFF", "#EEEEEE", "#F26722", "#F26722", "#00A99D", "#F26722", "#F26722"), ALL],
  ] as const).map(([code, iata, name, callsign, base, kind, fleet, livery, handlingAt]) => [
    code,
    { code, iata, name, callsign, base, kind, fleet: [...fleet], livery, handlingAt: [...handlingAt] } as Airline,
  ]),
);

/** A real flight of `airline` bound for `icao` (a diversion candidate): its flight from a UAE airport there, if any. */
export function flightBoundFor(airline: string, icao: string, i = 0): string | null {
  for (const byAirport of Object.values(ROUTES[airline] ?? {})) {
    const r = byAirport.find((x) => x.other === icao);
    if (r) return r.out[i % r.out.length];
  }
  const own = BOUND_FOR[airline]?.[icao];
  return own?.length ? own[i % own.length] : null;
}
