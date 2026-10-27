"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AIRCRAFT } from "@/core/aircraft";
import { PROFILES } from "@/core/airports/profiles";
import { fmtTime } from "@/core/world";
import { useRuntime } from "@/store/ops";
import { inboundBearing, offsetKm, project } from "@/three/geo";
import { city } from "../story";
import { flightStory, type Comparison, type FlightStory } from "./compare";
import { originCity } from "./places";

// map window in km around the three airports (the national map's projection: 1 unit = 1 km), the extent of the land data
const VB = { x: -109, y: -91, w: 202, h: 199 };
type P = [number, number];

let landCache: Promise<string> | null = null;

/** The UAE coastline as one SVG path in map km, thinned to about a point per kilometre. */
function loadLand(): Promise<string> {
  landCache ??= fetch("/data/national/land.geojson").then((r) => r.json()).then((g: { features: { geometry: { type: string; coordinates: unknown } }[] }) => {
    const rings: number[][][] = [];
    for (const f of g.features) {
      if (f.geometry.type === "Polygon") rings.push(...(f.geometry.coordinates as number[][][]));
      else if (f.geometry.type === "MultiPolygon") for (const poly of f.geometry.coordinates as number[][][][]) rings.push(...poly);
    }
    let d = "";
    for (const ring of rings) {
      const pts = ring.map(([lon, lat]) => project(lat, lon));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      if (Math.max(...xs) < VB.x - 20 || Math.min(...xs) > VB.x + VB.w + 20 || Math.max(...ys) < VB.y - 20 || Math.min(...ys) > VB.y + VB.h + 20) continue;
      let last: P | null = null;
      const kept: P[] = [];
      for (const p of pts) if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1) { kept.push(p); last = p; }
      if (kept.length < 3) continue;
      d += `M${kept.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}Z`;
    }
    return d;
  }).catch(() => "");
  return landCache;
}

function useLand(): string {
  const [d, setD] = useState("");
  useEffect(() => { let on = true; void loadLand().then((x) => { if (on) setD(x); }); return () => { on = false; }; }, []);
  return d;
}

const ap = (icao: string): P => project(PROFILES[icao].lat, PROFILES[icao].lon);
const pt = (p: P) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/** Inbound leg, a holding circle and the forced diversion; or straight to where the plan sends it. */
function routes(s: FlightStory) {
  const home = ap(s.home);
  const b = inboundBearing(s.origin);
  const entry = offsetKm(home[0], home[1], b, 150) as P;
  const fix = offsetKm(home[0], home[1], b, 26) as P;
  // holding circle beside the fix, two turns
  const r = 9, perp = ((b + 90) * Math.PI) / 180;
  const far: P = [fix[0] + Math.sin(perp) * 2 * r, fix[1] - Math.cos(perp) * 2 * r];
  const loop = `A${r},${r} 0 0 1 ${pt(far)}A${r},${r} 0 0 1 ${pt(fix)}`;
  const alt = ap(s.without.to in PROFILES ? s.without.to : s.home);
  const circling = `M${pt(entry)}L${pt(fix)}${loop}${loop}`;
  const divert = `M${pt(fix)}L${pt(alt)}`;
  const dest = s.with.kind === "divert" ? ap(s.with.to) : home;
  const mid: P = [(entry[0] + dest[0]) / 2, (entry[1] + dest[1]) / 2 - 12];
  const good = `M${pt(entry)}Q${pt(mid)} ${pt(dest)}`;
  return { home, fix, far, alt, dest, circling, divert, bad: `${circling}L${pt(alt)}`, good, loopCentre: [(fix[0] + far[0]) / 2, (fix[1] + far[1]) / 2] as P };
}

/** Before & after for one real flight of this evening, drawn on the map. */
export function FlightStoryBand({ c }: { c: Comparison }) {
  const rt = useRuntime();
  const land = useLand();
  const s = flightStory(rt, c);
  if (!s) return null;
  const r = routes(s);
  const kind = AIRCRAFT[s.type as keyof typeof AIRCRAFT]?.category.toLowerCase() ?? "jet";
  const w = s.without;
  return (
    <section className="panel overflow-hidden">
      <div className="panel-h">
        <div>
          <div className="panel-t">One flight, two evenings</div>
          <div className="text-[11.5px] text-muted">
            {s.callsign} from {originCity(s.origin)} · {kind} · {s.pax.toLocaleString("en-GB")} passengers · heading for {city(s.home)} — the same flight in both simulations
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-line">
        <Side tone="bad" title="Without SKYPACT" land={land} r={r} s={s}
          steps={[
            `${fmtTime(w.arrive)} · reaches ${city(s.home)} in fog and has to wait its turn to land`,
            w.circleMin !== null ? `circles for ${Math.round(w.circleMin)} minutes while the queue barely moves` : "circles while the queue barely moves",
            `${fmtTime(w.at)} · fuel too low to keep waiting: diverts to ${city(w.to)}, unplanned, with nothing arranged there`,
          ]} />
        <Side tone="good" title="With SKYPACT" land={land} r={r} s={s}
          steps={s.with.kind === "divert" ? [
            `${fmtTime(s.with.decided)} · the plan sends it to ${city(s.with.to)} instead, long before its fuel runs low`,
            `${fmtTime(s.with.land)} · lands at ${city(s.with.to)} in a planned landing slot${s.with.stand ? `, gate ${s.with.stand} already reserved for it` : ", with a gate reserved for it"}`,
            `no fuel emergency, and ${city(s.with.to)} knew it was coming`,
          ] : [
            `${fmtTime(s.with.decided)} · the plan gives it a landing time of ${fmtTime(s.with.land)}`,
            s.with.ground ? "it waits on the ground before take-off instead of circling in the air" : `lands in its turn at ${fmtTime(s.with.land)}, within its fuel limit`,
            "no fuel emergency, no unplanned diversion",
          ]} />
      </div>
    </section>
  );
}

function Side({ tone, title, steps, land, r, s }: { tone: "bad" | "good"; title: string; steps: string[]; land: string; r: ReturnType<typeof routes>; s: FlightStory }) {
  const color = tone === "bad" ? "var(--chart-bad)" : "var(--chart-good)";
  const path = tone === "bad" ? r.bad : r.good;
  // Dubai and Sharjah sit 15 km apart: Dubai's name goes on the left
  const labelAt = (icao: string) => {
    const p = ap(icao), left = icao === "OMDB";
    return <text x={p[0] + (left ? -6 : 6)} y={p[1] + 3} textAnchor={left ? "end" : "start"} className="fill-[var(--ink-2)]" style={{ fontSize: 8, fontWeight: 600 }}>{city(icao)}</text>;
  };
  const away = (() => { const dx = r.loopCentre[0] - r.home[0], dy = r.loopCentre[1] - r.home[1], d = Math.hypot(dx, dy) || 1; return [r.loopCentre[0] + (dx / d) * 20, r.loopCentre[1] + (dy / d) * 20]; })();
  return (
    <div className="grid grid-cols-[minmax(0,280px)_minmax(0,1fr)] items-center gap-4 p-4">
      <svg viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} className="h-auto w-full rounded-lg" role="img"
        aria-label={`${title}: ${steps.join("; ")}`}>
        <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} style={{ fill: "color-mix(in oklab, var(--blue-soft) 80%, var(--panel))" }} />
        {land && <path d={land} style={{ fill: "var(--panel-2)", stroke: "var(--line-2)" }} strokeWidth={0.6} />}
        <circle cx={r.home[0]} cy={r.home[1]} r={30} style={{ fill: "var(--muted)" }} opacity={0.22} />
        <circle cx={r.home[0]} cy={r.home[1]} r={18} style={{ fill: "var(--muted)" }} opacity={0.22} />
        <text x={r.home[0] - 8} y={r.home[1] + 22} className="fill-[var(--muted)]" style={{ fontSize: 7.5, fontStyle: "italic" }}>fog</text>
        <path d={tone === "bad" ? r.circling : r.good} fill="none" style={{ stroke: color }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {tone === "bad" && (
          <>
            <path d={r.divert} fill="none" style={{ stroke: color }} strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            <text x={away[0]} y={away[1] + 3} textAnchor="middle" className="fill-[var(--chart-bad)]" style={{ fontSize: 8, fontWeight: 700 }}>
              {s.without.circleMin !== null ? `${Math.round(s.without.circleMin)} min circling` : "circling"}
            </text>
            <text x={(r.fix[0] + r.alt[0]) / 2 + 4} y={(r.fix[1] + r.alt[1]) / 2 - 4} className="fill-[var(--chart-bad)]" style={{ fontSize: 7.5, fontWeight: 600 }}>low fuel</text>
          </>
        )}
        {tone === "good" && s.with.kind === "divert" && s.with.stand && (
          <text x={r.dest[0] + 6} y={r.dest[1] - 8} className="fill-[var(--chart-good)]" style={{ fontSize: 8, fontWeight: 700 }}>gate {s.with.stand}</text>
        )}
        {["OMAA", "OMDB", "OMSJ"].map((icao) => {
          const p = ap(icao);
          return <circle key={icao} cx={p[0]} cy={p[1]} r={3.2} style={{ fill: "var(--ink)", stroke: "var(--panel)" }} strokeWidth={1.2} />;
        })}
        {["OMAA", "OMDB", "OMSJ"].map((icao) => <g key={icao}>{labelAt(icao)}</g>)}
        <g>
          <path d="M-4,-3 L5,0 L-4,3 L-2,0 Z" style={{ fill: color, stroke: "var(--panel)" }} strokeWidth={0.6} transform="scale(1.4)" />
          <animateMotion dur={tone === "bad" ? "9s" : "5s"} repeatCount="indefinite" rotate="auto" path={path} />
        </g>
      </svg>
      <div>
        <div className="flex items-center gap-2">
          <span className={`grid h-6 w-6 place-items-center rounded-full ${tone === "bad" ? "bg-red-soft text-[var(--red)]" : "bg-teal-soft text-[var(--teal)]"}`}>
            {tone === "bad" ? <X size={14} /> : <Check size={14} />}
          </span>
          <span className="eyebrow">{title}</span>
        </div>
        <ol className="mt-2 space-y-2">
          {steps.map((x, i) => (
            <li key={x} className="flex gap-2.5 text-[12.5px] leading-snug text-ink-2">
              <span className="mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold text-white" style={{ background: color }}>{i + 1}</span>
              {x}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
