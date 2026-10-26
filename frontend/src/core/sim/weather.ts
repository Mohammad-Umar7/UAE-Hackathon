/** Locally generated (synthetic) weather tracks and METAR-style strings. No weather API is used. */

import type { WeatherKey, WeatherObs } from "../types";

export function fogDensity(vis: number): number {
  const v = Math.max(50, Math.min(10000, vis));
  return Math.max(0, Math.min(1, 1 - Math.log(v / 50) / Math.log(10000 / 50)));
}

function category(o: WeatherObs): WeatherObs["category"] {
  if (o.visibility < 550 || (o.ceiling !== null && o.ceiling < 200)) return "LVP";
  if (o.visibility < 5000 || (o.ceiling !== null && o.ceiling < 1500) || o.thunder) return "IMC";
  return "VMC";
}

export function obs(vis: number, o: Partial<WeatherObs> = {}): WeatherObs {
  const w: WeatherObs = {
    visibility: vis, rvr: vis < 1500 ? Math.round(vis * 1.3) : null, ceiling: 5000, windDir: 310, windKt: 8, gustKt: null,
    tempC: 27, dewC: 17, qnh: 1012, precip: "none", thunder: false, lightning: false, fog: fogDensity(vis), cloud: 0.1,
    category: "VMC", ...o,
  };
  w.fog = fogDensity(vis);
  if (w.precip === "rain") w.fog = Math.max(w.fog, 0.25);
  if (w.precip === "heavy_rain") w.fog = Math.max(w.fog, 0.4);
  w.category = category(w);
  return w;
}

export const clearTrack = (t0: number): WeatherKey[] => [{ t: t0 - 60, obs: obs(10000, { tempC: 27, dewC: 16 }) }];

/** Radiation fog: humid, light winds, visibility collapsing after onset and lifting after `clear`. */
export function fogTrack(t0: number, onset: number, thick: number, clear: number, minVis = 150): WeatherKey[] {
  const keys: WeatherKey[] = [{ t: t0 - 60, obs: obs(9000, { windKt: 6, tempC: 25, dewC: 21, cloud: 0.05 }) }];
  for (const [t, vis] of [[onset - 900, 4000], [onset, 1800], [onset + 600, 800], [thick - 600, 400], [thick, minVis]]) {
    keys.push({ t, obs: obs(vis, { windDir: 320, windKt: 3, tempC: 23, dewC: 22.5, ceiling: vis < 600 ? 100 : 400, cloud: 0.9 }) });
  }
  keys.push({ t: clear, obs: obs(600, { windDir: 320, windKt: 4, tempC: 22, dewC: 21.5, ceiling: 200, cloud: 0.8 }) });
  keys.push({ t: clear + 1200, obs: obs(2500, { windKt: 5, tempC: 22, dewC: 20, ceiling: 800, cloud: 0.5 }) });
  keys.push({ t: clear + 2700, obs: obs(7000, { windKt: 7, tempC: 22, dewC: 19, cloud: 0.2 }) });
  return keys;
}

export function stormTrack(t0: number, onset: number, peak: number, clear: number): WeatherKey[] {
  return [
    { t: t0 - 60, obs: obs(9000, { windDir: 140, windKt: 12, tempC: 29, dewC: 20, cloud: 0.4 }) },
    { t: onset, obs: obs(4000, { windDir: 160, windKt: 18, gustKt: 28, precip: "rain", thunder: true, lightning: true, ceiling: 2500, cloud: 0.85, tempC: 27, dewC: 22 }) },
    { t: peak, obs: obs(1500, { windDir: 200, windKt: 24, gustKt: 42, precip: "heavy_rain", thunder: true, lightning: true, ceiling: 1200, cloud: 1, tempC: 24, dewC: 22 }) },
    { t: clear - 1200, obs: obs(3500, { windDir: 250, windKt: 14, gustKt: 24, precip: "rain", thunder: true, ceiling: 2000, cloud: 0.8, tempC: 24, dewC: 21 }) },
    { t: clear, obs: obs(8000, { windDir: 290, windKt: 10, ceiling: 4000, cloud: 0.4, tempC: 24, dewC: 19 }) },
  ];
}

export function metar(icao: string, o: WeatherObs, t: number): string {
  const hh = Math.floor((t / 3600) % 24), mm = Math.floor((t % 3600) / 60);
  const utc = (hh - 4 + 24) % 24;
  let wind = `${String((Math.round(o.windDir / 10) * 10) % 360).padStart(3, "0")}${String(Math.round(o.windKt)).padStart(2, "0")}`;
  if (o.gustKt) wind += `G${String(Math.round(o.gustKt)).padStart(2, "0")}`;
  wind += "KT";
  const vis = o.visibility >= 9999 ? "9999" : String(Math.round(o.visibility / 50) * 50).padStart(4, "0");
  const wx: string[] = [];
  if (o.thunder && o.precip !== "none") wx.push(o.precip === "heavy_rain" ? "+TSRA" : "TSRA");
  else if (o.precip === "rain") wx.push("RA");
  else if (o.precip === "heavy_rain") wx.push("+RA");
  if (o.visibility < 1000 && o.precip === "none") wx.push("FG");
  else if (o.visibility < 5000 && o.precip === "none") wx.push("BR");
  let cloud = "NSC";
  if (o.ceiling !== null && o.ceiling < 300) cloud = `VV${String(Math.max(1, Math.floor(o.ceiling / 100))).padStart(3, "0")}`;
  else if (o.cloud > 0.75) cloud = `BKN${String(Math.floor((o.ceiling ?? 3000) / 100)).padStart(3, "0")}${o.thunder ? "CB" : ""}`;
  else if (o.cloud > 0.3) cloud = `SCT${String(Math.floor((o.ceiling ?? 4000) / 100)).padStart(3, "0")}`;
  const rvr = o.rvr ? ` R/${String(o.rvr).padStart(4, "0")}` : "";
  const temps = `${String(Math.round(o.tempC)).padStart(2, "0")}/${String(Math.round(o.dewC)).padStart(2, "0")}`;
  return `${icao} 26${String(utc).padStart(2, "0")}${String(mm).padStart(2, "0")}Z ${wind} ${vis}${rvr} ${wx.join(" ")} ${cloud} ${temps} Q${o.qnh}`
    .replace(/\s+/g, " ");
}
