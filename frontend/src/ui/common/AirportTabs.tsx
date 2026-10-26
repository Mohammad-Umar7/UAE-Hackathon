"use client";

import { PROFILES } from "@/core/airports/profiles";
import { useOps, useRuntime } from "@/store/ops";

const STATUS_DOT: Record<string, string> = { normal: "var(--teal)", watch: "var(--amber)", disrupted: "var(--red)" };

export function AirportTabs({ dark = false }: { dark?: boolean }) {
  const rt = useRuntime();
  const { airport, setAirport } = useOps();
  return (
    <div className={`flex items-center gap-0.5 rounded-lg p-0.5 ${dark ? "bg-white/5 border border-white/10" : "border border-line bg-panel"}`}>
      {Object.keys(rt.airports).map((icao) => {
        const sum = rt.airportSummary(icao);
        const on = airport === icao;
        return (
          <button key={icao} onClick={() => setAirport(icao)}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-left transition-colors ${on ? (dark ? "bg-white/15 text-white" : "bg-navy text-white") : dark ? "text-white/70 hover:text-white" : "text-ink-2 hover:bg-bg-2"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_DOT[sum.status] }} />
            <span className="leading-tight">
              <span className="block text-[12px] font-semibold">{PROFILES[icao].iata} <span className="font-normal opacity-70">{icao}</span></span>
              <span className={`block text-[10px] ${on ? "opacity-80" : "opacity-60"}`}>{PROFILES[icao].shortName}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
