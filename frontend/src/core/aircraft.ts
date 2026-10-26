/**
 * Aircraft type catalogue. Dimensions are rounded public figures for the aircraft *categories*
 * the 3D models are inspired by (verified_public). Turnaround minimums, runway requirements,
 * taxi and approach speeds are planning values for this simulation (synthetic).
 */

export type TypeKey = "nb" | "wb" | "vla" | "cargo" | "biz" | "reg";

export interface AircraftType {
  key: TypeKey;
  label: string;
  category: string;
  icaoHint: string;
  code: "A" | "B" | "C" | "D" | "E" | "F";
  wingspan: number;
  length: number;
  height: number;
  seats: number;
  engines: number;
  wake: "L" | "M" | "H" | "J";
  minTurnaroundMin: number;
  landingDistance: number;
  minRunwayWidth: number;
  doorSill: number;
  taxiSpeed: number;
  approachSpeed: number;
  rotateSpeed: number;
  takeoffAccel: number;
  wheelRadius: number;
  widebody: boolean;
  freighter: boolean;
}

const t = (
  key: TypeKey, label: string, category: string, icaoHint: string, code: AircraftType["code"],
  wingspan: number, length: number, height: number, seats: number, engines: number, wake: AircraftType["wake"],
  minTurnaroundMin: number, landingDistance: number, minRunwayWidth: number, doorSill: number,
  taxiSpeed: number, approachSpeed: number, rotateSpeed: number, takeoffAccel: number, wheelRadius: number,
  widebody: boolean, freighter = false,
): AircraftType => ({
  key, label, category, icaoHint, code, wingspan, length, height, seats, engines, wake, minTurnaroundMin,
  landingDistance, minRunwayWidth, doorSill, taxiSpeed, approachSpeed, rotateSpeed, takeoffAccel, wheelRadius,
  widebody, freighter,
});

export const AIRCRAFT: Record<TypeKey, AircraftType> = {
  nb: t("nb", "Narrow-body twin", "Narrow-body", "A20N-class", "C", 35.8, 37.6, 11.8, 180, 2, "M", 45, 1900, 30, 3.4, 8.5, 69, 75, 2.1, 0.57, false),
  wb: t("wb", "Wide-body twin", "Wide-body", "B789-class", "E", 60.1, 62.8, 17.0, 290, 2, "H", 90, 2400, 45, 4.9, 8.0, 72, 80, 1.7, 0.66, true),
  vla: t("vla", "Very large double-deck", "Large long-haul", "A388-class", "F", 79.8, 72.7, 24.1, 500, 4, "J", 120, 2900, 45, 5.1, 7.5, 72, 82, 1.5, 0.7, true),
  cargo: t("cargo", "Large freighter", "Cargo", "B748F-class", "F", 68.4, 76.3, 19.4, 0, 4, "H", 150, 2700, 45, 5.3, 7.5, 77, 85, 1.4, 0.62, true, true),
  biz: t("biz", "Business jet", "Business aviation", "GLF6-class", "C", 30.4, 30.4, 7.8, 14, 2, "M", 35, 1200, 30, 1.8, 9.0, 60, 65, 2.4, 0.45, false),
  reg: t("reg", "Regional turboprop", "Regional", "AT76-class", "C", 27.1, 27.2, 7.7, 70, 2, "M", 30, 1100, 30, 1.5, 7.0, 55, 55, 1.9, 0.45, false),
};

export const CODE_MAX_SPAN: Record<string, number> = { A: 15, B: 24, C: 36, D: 52, E: 65, F: 80 };

export function codeForSpan(span: number): AircraftType["code"] {
  for (const code of ["A", "B", "C", "D", "E"] as const) if (span < CODE_MAX_SPAN[code]) return code;
  return "F";
}

/** Approach segment flown inside the airport scene (9 km final + 400 m to touchdown). */
export const approachDuration = (k: TypeKey) => (9000 + 400) / AIRCRAFT[k].approachSpeed;
