/**
 * Solar position (NOAA approximation) for the synthetic scenario day, 26 October 2026, GST (UTC+4).
 * Returns elevation and azimuth in degrees (azimuth clockwise from true north) and the ENU unit vector.
 */

const DAY_OF_YEAR = 299; // 26 October

export function sunPosition(lat: number, lon: number, simSeconds: number) {
  const localHours = (((simSeconds / 3600) % 24) + 24) % 24;
  const utcHours = localHours - 4;
  const g = ((2 * Math.PI) / 365) * (DAY_OF_YEAR - 1 + (utcHours - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMinutes = utcHours * 60 + eqTime + 4 * lon;
  const H = ((trueSolarMinutes / 4 - 180) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.cos(phi) * Math.sin(decl) - Math.sin(phi) * Math.cos(decl) * Math.cos(H);
  const up = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const elevation = (Math.asin(Math.max(-1, Math.min(1, up))) * 180) / Math.PI;
  const azimuth = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  return { elevation, azimuth, east, north, up };
}

/** 0 = night, 1 = full daylight (civil twilight blends between). */
export function daylight(elevation: number): number {
  return Math.max(0, Math.min(1, (elevation + 6) / 18));
}
