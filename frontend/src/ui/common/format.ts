import { AIRLINES } from "@/core/airlines";
import { PROFILES } from "@/core/airports/profiles";

export const iata = (icao: string) => PROFILES[icao]?.iata ?? icao;
export const airlineName = (code: string) => AIRLINES[code]?.name ?? code;
export const num = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—");
export const pct = (a: number, b: number) => (b ? `${Math.round((100 * (b - a)) / b)}%` : "—");
export const delta = (a: number, b: number) => {
  const d = a - b;
  return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${num(Math.abs(d))}`;
};

export const STATUS_PILL: Record<string, string> = {
  PROPOSED: "pill-amber", APPROVED: "pill-teal", COMMITTED: "pill-teal", REJECTED: "pill-red", REVISION_REQUESTED: "pill-amber",
  STALE: "pill-red", SUPERSEDED: "pill-gray", EXPIRED: "pill-gray", INVALID: "pill-red", VALIDATED: "pill-blue",
  PENDING: "pill-amber", ACKNOWLEDGED: "pill-blue",
};
