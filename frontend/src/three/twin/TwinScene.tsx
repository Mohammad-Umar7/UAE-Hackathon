"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode, type BloomEffect } from "postprocessing";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Runtime } from "@/core/runtime";
import { Airfield, buildAirfield } from "./Airfield";
import { Atmosphere } from "./Atmosphere";
import { CameraRig } from "./CameraRig";
import { Fleet } from "./Fleet";
import { layoutBounds } from "./geometry";
import { Labels, Picker } from "./Labels";
import { PlanPreview, Routes, RunwayClosures, SelectionRing, StandStatus } from "./Overlays";
import { twinState } from "./state";

function SceneContent({ rt, icao, labels }: { rt: Runtime; icao: string; labels: React.RefObject<HTMLCanvasElement | null> }) {
  const ap = rt.airports[icao];
  const data = useMemo(() => buildAirfield(ap), [ap]);
  const bounds = useMemo(() => layoutBounds(ap.layout, ap), [ap]);
  return (
    <>
      <Atmosphere rt={rt} icao={icao} />
      <Airfield data={data} center={bounds.center} />
      <RunwayClosures rws={data.rws} />
      <StandStatus rt={rt} ap={ap} />
      <Routes ap={ap} />
      <Fleet rt={rt} ap={ap} />
      <SelectionRing />
      <PlanPreview rt={rt} ap={ap} />
      <CameraRig ap={ap} center={bounds.center} radius={bounds.radius} />
      <Picker ap={ap} />
      <Labels ap={ap} canvas={labels} />
    </>
  );
}

function Effects() {
  const bloom = useRef<BloomEffect>(null);
  useFrame(() => {
    if (bloom.current) bloom.current.intensity = 0.35 + 1.25 * twinState.night;
  });
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO halfRes aoRadius={5} distanceFalloff={1.4} intensity={2.4} quality="medium" />
      <Bloom ref={bloom} luminanceThreshold={0.95} luminanceSmoothing={0.15} mipmapBlur intensity={0.6} radius={0.7} />
      <SMAA />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.32} darkness={0.42} />
    </EffectComposer>
  );
}

export default function TwinScene({ rt, icao, labels }: { rt: Runtime; icao: string; labels: React.RefObject<HTMLCanvasElement | null> }) {
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      flat
      dpr={[1, 1.5]}
      gl={{ antialias: false, stencil: false, powerPreference: "high-performance" }}
      camera={{ fov: 38, near: 2, far: 90000, position: [2400, 1800, 2400] }}
      onCreated={(state) => { (window as unknown as { __twin: unknown }).__twin = state; }}
    >
      <SceneContent key={icao} rt={rt} icao={icao} labels={labels} />
      <Effects />
    </Canvas>
  );
}
