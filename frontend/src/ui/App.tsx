"use client";

import { useEffect, useState } from "react";
import { detectLlm } from "@/core/agents/llm";
import { buildRegistry } from "@/core/airports/registry";
import { loadLayouts } from "@/core/data";
import { Runtime } from "@/core/runtime";
import { WorkerCompute } from "@/core/workerCompute";
import { useOps } from "@/store/ops";
import { Shell } from "./Shell";
import { Splash } from "./Splash";

export default function App() {
  const [state, setState] = useState<{ phase: string; detail?: string; error?: string }>({ phase: "Loading airport layouts" });
  const runtime = useOps((s) => s.runtime);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { layouts, sources } = await loadLayouts();
        if (cancelled) return;
        setState({ phase: "Building three-airport registry", detail: Object.entries(sources).map(([k, v]) => `${k}:${v}`).join(" · ") });
        const registry = buildRegistry(layouts);
        setState({ phase: "Starting optimiser (HiGHS · WebAssembly)" });
        const compute = new WorkerCompute(layouts);
        await compute.ready();
        if (cancelled) return;
        setState({ phase: "Generating synthetic schedule — Operation Nightfall" });
        const rt = new Runtime(registry, compute);
        rt.load("nightfall", 7);
        useOps.getState().attach(rt, sources);
        if (/[?&]intro=0\b/.test(window.location.search)) { useOps.getState().setWelcome(false); useOps.getState().setIntro("done"); } // screenshots and rehearsals
        (window as unknown as { skypact: Runtime; skypactUi: typeof useOps }).skypact = rt;
        (window as unknown as { skypactUi: typeof useOps }).skypactUi = useOps; // inspection handle for demos/tests
        void detectLlm().then((s) => { rt.llm = s; rt.notify(); });
      } catch (e) {
        setState({ phase: "Failed to start", error: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!runtime) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      runtime.tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime]);

  if (!runtime) return <Splash label={state.error ? `${state.phase}: ${state.error}` : state.phase} detail={state.detail} />;
  return <Shell />;
}
