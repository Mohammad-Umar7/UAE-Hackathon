/**
 * Airport operating profiles. Runway geometry, stand positions and building footprints come from
 * OpenStreetMap-derived layouts. The operating parameters below are NOT public operational data:
 * they are synthetic planning values chosen to be plausible for a demonstration and must be
 * validated with the airport operators before any real use.
 */

export interface AirportProfile {
  icao: string;
  iata: string;
  name: string;
  shortName: string;
  city: string;
  emirate: string;
  lat: number;
  lon: number;
  elevation: number;
  arrCapacity: number;
  depCapacity: number;
  singleRunway: boolean;
  arrivalHeadingPref: number;
  resources: Record<string, number>;
  maxDiversionsPerHour: number;
  standBufferMin: number;
  zoneRules: [RegExp, string][];
  airlineZones: Record<string, string[]>;
  demandScale: number;
}

export const RESOURCE_LABELS: Record<string, string> = {
  ambulift: "PRM ambulift",
  wb_handling: "Wide-body handling team",
  nb_handling: "Narrow-body handling team",
  deck_loader: "Main-deck cargo loader",
  tug_heavy: "Heavy pushback / tow tractor",
  bus: "Apron passenger bus",
};

export const PROFILES: Record<string, AirportProfile> = {
  OMAA: {
    icao: "OMAA", iata: "AUH", name: "Zayed International Airport", shortName: "Zayed Intl", city: "Abu Dhabi",
    emirate: "Abu Dhabi", lat: 24.433, lon: 54.6511, elevation: 27,
    arrCapacity: 30, depCapacity: 30, singleRunway: false, arrivalHeadingPref: 310,
    resources: { ambulift: 4, wb_handling: 16, nb_handling: 18, deck_loader: 3, tug_heavy: 10, bus: 18 },
    maxDiversionsPerHour: 5, standBufferMin: 10,
    zoneRules: [[/terminal\s*a|midfield|pier/i, "TERMINAL_A"], [/cargo/i, "CARGO"], [/general aviation|executive|royal|vip/i, "GA"]],
    airlineZones: { ETD: ["TERMINAL_A"], GFA: ["TERMINAL_A", "REMOTE"], QTR: ["TERMINAL_A"], IGO: ["TERMINAL_A"] },
    demandScale: 1,
  },
  OMDB: {
    icao: "OMDB", iata: "DXB", name: "Dubai International Airport", shortName: "Dubai Intl", city: "Dubai",
    emirate: "Dubai", lat: 25.2528, lon: 55.3644, elevation: 19,
    arrCapacity: 36, depCapacity: 36, singleRunway: false, arrivalHeadingPref: 300,
    resources: { ambulift: 8, wb_handling: 26, nb_handling: 28, deck_loader: 4, tug_heavy: 18, bus: 30 },
    maxDiversionsPerHour: 6, standBufferMin: 10,
    zoneRules: [[/concourse\s*a\b|^A\d/i, "T3_A"], [/concourse\s*b\b|^B\d/i, "T3_B"], [/concourse\s*c\b|^C\d/i, "T3_C"],
      [/concourse\s*d\b|^D\d/i, "T1_D"], [/terminal\s*2|^F\d/i, "T2"], [/cargo/i, "CARGO"], [/general aviation|executive|royal|vip/i, "GA"]],
    airlineZones: { UAE: ["T3_A", "T3_B", "T3_C"], FDB: ["T2", "T3_C"], BAW: ["T1_D"], QTR: ["T1_D"], IGO: ["T1_D", "T2"], SVA: ["T1_D"], AXB: ["T1_D", "T2"] },
    demandScale: 1,
  },
  OMSJ: {
    icao: "OMSJ", iata: "SHJ", name: "Sharjah International Airport", shortName: "Sharjah Intl", city: "Sharjah",
    emirate: "Sharjah", lat: 25.3286, lon: 55.5172, elevation: 34,
    arrCapacity: 16, depCapacity: 16, singleRunway: true, arrivalHeadingPref: 300,
    resources: { ambulift: 2, wb_handling: 5, nb_handling: 14, deck_loader: 6, tug_heavy: 5, bus: 14 },
    maxDiversionsPerHour: 4, standBufferMin: 10,
    zoneRules: [[/cargo/i, "CARGO"], [/terminal|passenger/i, "TERMINAL"], [/general aviation|executive/i, "GA"]],
    airlineZones: { ABY: ["TERMINAL"], IGO: ["TERMINAL"], ETH: ["CARGO"] },
    demandScale: 1,
  },
};

export const ICAOS = ["OMAA", "OMDB", "OMSJ"] as const;

export function airportDistanceKm(a: AirportProfile, b: AirportProfile): number {
  const r = 6371;
  const p1 = (a.lat * Math.PI) / 180, p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1, dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Synthetic planning time from the destination holding area to landing at the alternate (minutes). */
export const diversionMinutes = (a: AirportProfile, b: AirportProfile) =>
  Math.round(8 + airportDistanceKm(a, b) / 8);
