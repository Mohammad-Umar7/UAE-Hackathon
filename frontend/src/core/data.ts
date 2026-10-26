/** Loads the three airport layouts (OSM-derived, served from /data). Falls back to a labelled fixture
 * layout per airport if a file is missing so the application always starts. */

import { makeLayout } from "./__tests__/fixtures";
import { ICAOS } from "./airports/profiles";
import type { Layout } from "./airports/registry";

export interface LoadedLayouts {
  layouts: Record<string, Layout>;
  sources: Record<string, "osm" | "fixture">;
}

export async function loadLayouts(): Promise<LoadedLayouts> {
  const got: Record<string, Layout> = {};
  const sources: Record<string, "osm" | "fixture"> = {};
  await Promise.all(ICAOS.map(async (icao) => {
    try {
      const res = await fetch(`/data/airports/${icao}.layout.json`, { cache: "force-cache" });
      if (!res.ok) throw new Error(String(res.status));
      got[icao] = (await res.json()) as Layout;
      sources[icao] = "osm";
    } catch {
      const sizes: Record<string, [number, number, number]> = { OMAA: [14, 10, 3], OMDB: [20, 14, 3], OMSJ: [8, 8, 5] };
      got[icao] = { ...makeLayout(...sizes[icao]), icao };
      sources[icao] = "fixture";
    }
  }));
  // fixed key order (fetches complete in any order; the engine iterates airports in key order)
  const layouts: Record<string, Layout> = {};
  for (const icao of ICAOS) layouts[icao] = got[icao];
  return { layouts, sources };
}
