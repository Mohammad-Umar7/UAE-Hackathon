/** Geographic helpers for the national map (equirectangular projection, 1 unit = 1 km). */

export const MAP_CENTER = { lat: 24.88, lon: 55.08 };
const KM_PER_DEG_LAT = 110.57;

export function project(lat: number, lon: number): [number, number] {
  const kx = 111.32 * Math.cos((MAP_CENTER.lat * Math.PI) / 180);
  return [(lon - MAP_CENTER.lon) * kx, -(lat - MAP_CENTER.lat) * KM_PER_DEG_LAT];
}

/** Rough origin region → bearing of arrival into the UAE (synthetic route geometry). */
export function inboundBearing(origin: string): number {
  if (/^(OT|OB|OK)/.test(origin)) return 300;
  if (/^(OI|U|Z|RK|RJ)/.test(origin)) return 20;
  if (/^(V|W|R|Y|OP)/.test(origin)) return 85;
  if (/^(H|F|OE|OJ|OO)/.test(origin)) return 235;
  return 310; // Europe / Americas via the Gulf
}

export function offsetKm(x: number, y: number, bearingDeg: number, km: number): [number, number] {
  const b = (bearingDeg * Math.PI) / 180;
  return [x + Math.sin(b) * km, y - Math.cos(b) * km];
}
