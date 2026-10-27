/** UI state + a throttled bridge from the runtime (which changes many times per second) to React. */

import { create } from "zustand";
import type { Runtime } from "@/core/runtime";

export type View = "command" | "twin" | "workbench" | "agents" | "timeline" | "lab" | "evidence" | "replay";
export type CameraMode = "strategic" | "topdown" | "inspect" | "follow" | "cinematic";

export interface Overlays {
  labels: boolean;
  stands: boolean;
  taxiways: boolean;
  weather: boolean;
  routes: boolean;
  lighting: "auto" | "day" | "dusk" | "night";
}

interface OpsState {
  runtime: Runtime | null;
  version: number;
  sources: Record<string, "osm" | "fixture">;
  view: View;
  airport: string;
  role: string;
  selectedVisit: string | null;
  selectedStand: string | null;
  selectedProposal: string | null;
  inspect: { kind: "action" | "message"; id: string } | null;
  theme: "light" | "dark";
  overlays: Overlays;
  camera: CameraMode;
  /** the guided story: Operation Nightfall unless `story` names another scenario to play */
  presentation: { active: boolean; step: number; story?: string };
  /** simple: plain-language views for a first-time audience; expert: every number, log and table */
  detail: "simple" | "expert";
  /** the welcome card that explains the story (shown on start, reopened from the top bar) */
  welcome: boolean;
  /** the opening shot: the whole UAE, then a flight down to the three airports once the welcome card closes */
  intro: "wide" | "flying" | "done";
  /** a request for the AI agents page to follow a workflow step by step from a moment (the guided demo sends it) */
  follow: { thread: string | null; from: number; nonce: number } | null;
  /** how far the AI agents page has got in telling the story (done: it has shown where things stand now) */
  followAt: { step: number; total: number; done: boolean } | null;
  toasts: { id: number; tone: "info" | "ok" | "warn" | "bad"; text: string }[];
  attach(rt: Runtime, sources: Record<string, "osm" | "fixture">): void;
  setView(v: View): void;
  setAirport(icao: string): void;
  setRole(role: string): void;
  select(p: Partial<Pick<OpsState, "selectedVisit" | "selectedStand" | "selectedProposal">>): void;
  setInspect(i: OpsState["inspect"]): void;
  setTheme(t: "light" | "dark"): void;
  setOverlay<K extends keyof Overlays>(k: K, v: Overlays[K]): void;
  setCamera(c: CameraMode): void;
  setPresentation(p: Partial<OpsState["presentation"]>): void;
  setDetail(d: OpsState["detail"]): void;
  setWelcome(on: boolean): void;
  setIntro(i: OpsState["intro"]): void;
  setFollow(f: { thread: string | null; from: number } | null): void;
  setFollowAt(f: OpsState["followAt"]): void;
  toast(text: string, tone?: OpsState["toasts"][number]["tone"]): void;
}

let toastSeq = 0;
let pending = false;

export const useOps = create<OpsState>((set, get) => ({
  runtime: null,
  version: 0,
  sources: {},
  view: "command",
  airport: "OMAA",
  role: "NATIONAL_SUPERVISOR",
  selectedVisit: null,
  selectedStand: null,
  selectedProposal: null,
  inspect: null,
  theme: "light",
  overlays: { labels: true, stands: true, taxiways: false, weather: true, routes: true, lighting: "auto" },
  camera: "strategic",
  presentation: { active: false, step: 0 },
  detail: "simple",
  welcome: true,
  intro: "wide",
  follow: null,
  followAt: null,
  toasts: [],
  attach(rt, sources) {
    set({ runtime: rt, sources });
    rt.subscribe(() => {
      if (pending) return;
      pending = true;
      // coalesce runtime notifications into ≤ ~8 React updates per second
      setTimeout(() => { pending = false; set({ version: get().version + 1 }); }, 120);
    });
  },
  setView: (view) => set({ view }),
  setAirport: (airport) => set({ airport, selectedVisit: null, selectedStand: null }),
  setRole: (role) => set({ role }),
  select: (p) => set(p),
  setInspect: (inspect) => set({ inspect }),
  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },
  setOverlay: (k, v) => set({ overlays: { ...get().overlays, [k]: v } }),
  setCamera: (camera) => set({ camera }),
  // starting a story without naming one plays the signature demo (Operation Nightfall)
  setPresentation: (p) => set({ presentation: { ...get().presentation, ...(p.active && !get().presentation.active && !("story" in p) ? { story: undefined } : {}), ...p } }),
  setDetail: (detail) => set({ detail }),
  setWelcome: (welcome) => set({ welcome, ...(!welcome && get().intro === "wide" ? { intro: "flying" as const } : {}) }),
  setIntro: (intro) => set({ intro }),
  setFollow: (f) => set({ follow: f ? { ...f, nonce: (get().follow?.nonce ?? 0) + 1 } : null }),
  setFollowAt: (followAt) => {
    const a = get().followAt;
    if (a?.step !== followAt?.step || a?.total !== followAt?.total || a?.done !== followAt?.done) set({ followAt });
  },
  toast(text, tone = "info") {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-3), { id, tone, text }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4200);
  },
}));

/** Subscribe a component to runtime changes (re-renders at the throttled cadence). */
export function useRuntime(): Runtime {
  const rt = useOps((s) => s.runtime);
  useOps((s) => s.version);
  if (!rt) throw new Error("runtime not attached");
  return rt;
}
