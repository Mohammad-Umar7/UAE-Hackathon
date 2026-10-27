"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode, type BloomEffect, type BrightnessContrastEffect } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Runtime } from "@/core/runtime";
import { Airfield, buildAirfield } from "./Airfield";
import { Apron } from "./Apron";
import { Atmosphere } from "./Atmosphere";
import { CameraRig } from "./CameraRig";
import { Fleet } from "./Fleet";
import { FogBanks } from "./FogBanks";
import { layoutBounds } from "./geometry";
import { Labels, Picker } from "./Labels";
import { Landmarks, useReplacedBuildings } from "./Landmarks";
import { PlanPreview, Routes, RunwayClosures, SelectionRing, StandStatus } from "./Overlays";
import { RunwayGlow } from "./RunwayGlow";
import { twinState } from "./state";

function SceneContent({ rt, icao, labels }: { rt: Runtime; icao: string; labels: React.RefObject<HTMLCanvasElement | null> }) {
  const ap = rt.airports[icao];
  const replaced = useReplacedBuildings(icao);
  const data = useMemo(() => (replaced ? buildAirfield(ap, replaced) : null), [ap, replaced]);
  const bounds = useMemo(() => layoutBounds(ap.layout, ap), [ap]);
  return (
    <>
      <Atmosphere rt={rt} icao={icao} />
      {data && <Airfield data={data} center={bounds.center} />}
      {data && <RunwayClosures rws={data.rws} />}
      {data && <RunwayGlow rws={data.rws} />}
      <Landmarks icao={icao} />
      <StandStatus rt={rt} ap={ap} />
      <Routes ap={ap} />
      <Fleet rt={rt} ap={ap} />
      <Apron rt={rt} ap={ap} />
      <FogBanks rt={rt} icao={icao} center={bounds.center} radius={bounds.radius} />
      <SelectionRing />
      <PlanPreview rt={rt} ap={ap} />
      <CameraRig ap={ap} center={bounds.center} radius={bounds.radius} />
      <Picker ap={ap} />
      <Labels ap={ap} canvas={labels} />
    </>
  );
}

function Effects({ ao }: { ao: boolean }) {
  const bloom = useRef<BloomEffect>(null);
  const grade = useRef<BrightnessContrastEffect>(null);
  useFrame(() => {
    if (bloom.current) bloom.current.intensity = 0.35 + 1.25 * twinState.night;
    // a slight lift by day only: at night it would grey the blacks the lights stand out against
    if (grade.current) grade.current.brightness = 0.03 * (1 - twinState.night);
  });
  // SMAA smooths the edges; multisampling on top of it would pay for anti-aliasing twice
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {ao ? <N8AO halfRes aoRadius={9} distanceFalloff={1.2} intensity={3.4} quality="medium" /> : <></>}
      <Bloom ref={bloom} luminanceThreshold={0.95} luminanceSmoothing={0.15} mipmapBlur intensity={0.6} radius={0.7} />
      <SMAA />
      {/* filmic contrast and colour; a light touch of saturation keeps sand, grass and liveries vivid */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={0.12} />
      <BrightnessContrast ref={grade} brightness={0.03} contrast={0.06} />
      <Vignette offset={0.38} darkness={0.28} />
    </EffectComposer>
  );
}

/** Mounts only once everything beside it in the same Suspense boundary has loaded. */
function Ready({ onReady }: { onReady?: () => void }) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return null;
}

/**
 * Ambient occlusion and a sharper pixel ratio cost more than an integrated GPU can spare (N8AO alone takes ~85 ms
 * a frame on Iris Xe graphics), so the twin starts without them and turns them on once frames are fast. The
 * verdict carries over to the next airport and the next visit, so the view does not re-measure each time.
 */
let richGraphics = false;

export default function TwinScene({ rt, icao, labels, onReady }: { rt: Runtime; icao: string; labels: React.RefObject<HTMLCanvasElement | null>; onReady?: () => void }) {
  const [rich, setRich] = useState(richGraphics);
  const choose = (on: boolean) => { richGraphics = on; setRich(on); };
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      flat
      dpr={rich ? [1, 1.5] : 1}
      gl={{ antialias: false, stencil: false, powerPreference: "high-performance" }}
      camera={{ fov: 38, near: 2, far: 90000, position: [2400, 1800, 2400] }}
      onCreated={(state) => { (window as unknown as { __twin: unknown }).__twin = state; }}
    >
      {/* each verdict repeats while it holds; after a few the monitor stops and the last one stays */}
      <PerformanceMonitor bounds={(hz) => (hz > 100 ? [60, 95] : [40, 56])} flipflops={3}
        onIncline={() => choose(true)} onDecline={() => choose(false)} />
      <Suspense fallback={null}>
        <SceneContent key={icao} rt={rt} icao={icao} labels={labels} />
        <Effects ao={rich} />
        <Ready onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}
