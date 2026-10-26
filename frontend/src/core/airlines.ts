/**
 * Fictional carriers used by the synthetic schedules. None of these represents a real airline.
 * Liveries are original colour schemes applied to the procedural aircraft (M_Paint_* materials).
 */

import type { TypeKey } from "./aircraft";

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
  name: string;
  callsign: string;
  base: string | null;
  kind: "hub" | "low_cost" | "regional" | "cargo" | "business" | "foreign";
  fleet: TypeKey[];
  livery: Livery;
  /** Airports in the network where the carrier has a (synthetic) handling arrangement. */
  handlingAt: string[];
}

const L = (top: string, belly: string, cheatline: string, tail: string, tailAccent: string, engine: string,
  title: string): Livery => ({ top, belly, cheatline, tail, tailAccent, engine, title });

const ALL = ["OMAA", "OMDB", "OMSJ"];

export const AIRLINES: Record<string, Airline> = Object.fromEntries(
  ([
    ["SQR", "Saqr Airways", "SAQR", "OMAA", "hub", ["nb", "wb", "vla"], L("#F4F1EA", "#D9D4C7", "#B08D57", "#0E4F5C", "#B08D57", "#0E4F5C", "#0E4F5C"), ALL],
    ["MJL", "Majlis Air", "MAJLIS", "OMDB", "hub", ["wb", "vla"], L("#FAFAF7", "#E6E3DC", "#A3262A", "#A3262A", "#D6B46A", "#F2F0EA", "#A3262A"), ["OMDB", "OMAA"]],
    ["DNE", "Dune Air", "DUNE", "OMDB", "low_cost", ["nb"], L("#FFFFFF", "#F0F3F6", "#E07A1F", "#1F3B73", "#E07A1F", "#1F3B73", "#1F3B73"), ALL],
    ["SHR", "Sahra Air", "SAHRA", "OMSJ", "low_cost", ["nb"], L("#FFFFFF", "#ECEFEA", "#3F7D4E", "#C9A227", "#3F7D4E", "#3F7D4E", "#3F7D4E"), ["OMSJ", "OMDB"]],
    ["GFL", "Gulfline Regional", "GULFLINE", "OMAA", "regional", ["reg"], L("#FFFFFF", "#E9EEF2", "#2C7DA0", "#2C7DA0", "#9BD0E0", "#2C7DA0", "#2C7DA0"), ALL],
    ["NJC", "Najm Cargo", "NAJM", "OMSJ", "cargo", ["cargo"], L("#F5F5F2", "#C8CCD2", "#F2B705", "#14213D", "#F2B705", "#14213D", "#14213D"), ALL],
    ["FCX", "Falconet Executive", "FALCONET", null, "business", ["biz"], L("#E9EAEC", "#4A4E57", "#9A9EA6", "#2B2E34", "#9A9EA6", "#E9EAEC", "#2B2E34"), ALL],
    ["MPX", "Meridian Pacific", "MERIDIAN", null, "foreign", ["wb"], L("#FFFFFF", "#DDE5E1", "#1B6B4A", "#1B6B4A", "#E9E3C9", "#1B6B4A", "#1B6B4A"), ["OMDB", "OMAA"]],
    ["BRL", "Borealis Airlines", "BOREALIS", null, "foreign", ["wb", "nb"], L("#FFFFFF", "#1C2E4A", "#5FA8D3", "#1C2E4A", "#5FA8D3", "#1C2E4A", "#1C2E4A"), ["OMDB", "OMAA"]],
    ["DCW", "Deccan Wings", "DECCAN", null, "foreign", ["nb"], L("#FFFFFF", "#F3E9DA", "#E8871E", "#2E2A6B", "#E8871E", "#2E2A6B", "#2E2A6B"), ALL],
    ["SLK", "Silk Freight", "SILKFREIGHT", null, "cargo", ["cargo"], L("#F4F2EE", "#B9B2A6", "#7A1F2B", "#7A1F2B", "#E3C9A0", "#7A1F2B", "#7A1F2B"), ["OMSJ", "OMDB"]],
  ] as const).map(([code, name, callsign, base, kind, fleet, livery, handlingAt]) => [
    code,
    { code, name, callsign, base, kind, fleet: [...fleet], livery, handlingAt: [...handlingAt] } as Airline,
  ]),
);
