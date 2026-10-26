"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { AirportInfo } from "@/core/airports/registry";
import {
  apronsOf, buildBuildings, buildHoldMarkings, buildRunwayLights, buildRunways, buildStandMarkings, buildTaxiLights,
  buildingsOf, contextOf, emptyLights, floodMasts, GeoBuilder, holdPositions, landuseOf, layoutBounds, LIGHT_GROUPS, roadsOf, runwaysOf, taxiwaysOf,
  type DesignatorLabel, type P2,
} from "./geometry";
import { airfieldLightGeometry, airfieldLightMaterial } from "./lights";
import { facadeTextures, poolTexture, surfaceSet, type SurfaceSet } from "./textures";
import { twinState } from "./state";

/** Everything static about one airport's airfield, built once per layout. */
export function buildAirfield(ap: AirportInfo) {
  const layout = ap.layout;
  const stands = Object.values(ap.stands);
  const rws = runwaysOf(layout);
  const runway = new GeoBuilder(32), shoulder = new GeoBuilder(32), taxi = new GeoBuilder(24), apron = new GeoBuilder(10);
  const white = new GeoBuilder(4), yellow = new GeoBuilder(4), red = new GeoBuilder(4);
  const labels: DesignatorLabel[] = [];
  buildRunways(rws, runway, shoulder, white, labels);
  const tx = taxiwaysOf(layout, ap);
  for (const r of tx.ribbons) { shoulder.ribbon(r.pts, r.width + 10, 0); taxi.ribbon(r.pts, r.width, 0); }
  for (const pts of tx.centre) yellow.ribbon(pts, 0.45, 0, false);
  for (const a of apronsOf(layout, stands)) apron.polygon(a.outer, a.holes, 0);
  buildStandMarkings(stands, ap, yellow, red, white);
  const lights = emptyLights();
  buildRunwayLights(rws, lights);
  const holds = holdPositions(ap, rws);
  buildHoldMarkings(holds, yellow, lights);
  buildTaxiLights(tx.centre, lights);
  const masts = floodMasts(stands, lights);
  // landside context, bounded around the airfield
  const bounds = layoutBounds(layout, ap);
  const ctxR = bounds.radius + 2600;
  const roads = new GeoBuilder(16), green = new GeoBuilder(30), water = new GeoBuilder(60), parking = new GeoBuilder(12);
  for (const r of roadsOf(layout, bounds.center, ctxR)) roads.ribbon(r.points.map((p) => [p[0], p[1]] as P2), Number(r.width_m ?? 8), 0, false, r.points.length < 40);
  for (const l of landuseOf(layout)) {
    const target = l.kind === "water" ? water : l.kind === "parking" ? parking : l.kind === "grass" || l.kind === "landscaping" ? green : null;
    target?.polygon(l.polygon.map((p) => [p[0], p[1]] as P2), (l.holes ?? []).map((h) => h.map((p) => [p[0], p[1]] as P2)), 0);
  }
  const bg = { glass: new GeoBuilder(), concrete: new GeoBuilder(), metal: new GeoBuilder(), roof: new GeoBuilder(30), roofMetal: new GeoBuilder(30) };
  buildBuildings(buildingsOf(layout, stands), bg);
  const ctx = { glass: new GeoBuilder(), concrete: new GeoBuilder(), metal: new GeoBuilder(), roof: new GeoBuilder(30), roofMetal: new GeoBuilder(30) };
  const context = contextOf(layout, bounds.center, ctxR, 9000).map((c) => ({ kind: "context", footprint: c.footprint, height_m: c.height_m }));
  buildBuildings(context, ctx, 4);
  const geo = (b: GeoBuilder) => (b.empty ? null : b.build());
  return {
    rws, labels, holds, masts,
    runway: geo(runway), shoulder: geo(shoulder), taxi: geo(taxi), apron: geo(apron),
    white: geo(white), yellow: geo(yellow), red: geo(red),
    roads: geo(roads), green: geo(green), water: geo(water), parking: geo(parking),
    buildings: { glass: geo(bg.glass), concrete: geo(bg.concrete), metal: geo(bg.metal), roof: geo(bg.roof), roofMetal: geo(bg.roofMetal) },
    context: { walls: geo(ctx.concrete), roof: geo(ctx.roof) },
    lights: airfieldLightGeometry(lights),
    lightCount: lights.sizes.length,
  };
}

export type AirfieldData = ReturnType<typeof buildAirfield>;

function layer(m: THREE.Material, order: number): THREE.Material {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -order;
  m.polygonOffsetUnits = -order * 2;
  return m;
}

/** Ground with two extra texture scales mixed in, so 1k tiles do not visibly repeat across kilometres. */
function macroVariation(m: THREE.MeshStandardMaterial, a: number, b: number): void {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec3 macroA = texture2D( map, vMapUv * ${a.toFixed(4)} + vec2( 0.31, 0.17 ) ).rgb;
  vec3 macroB = texture2D( map, vMapUv * ${b.toFixed(4)} + vec2( 0.73, 0.41 ) ).rgb;
  sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), macroA * 1.22, 0.45 ) * mix( vec3( 1.0 ), macroB * 1.22, 0.4 );
  diffuseColor *= sampledDiffuseColor;
#endif`);
  };
  m.customProgramCacheKey = () => `macro-${a}-${b}`;
}

function useSurfaces() {
  const [s, setS] = useState<Record<string, SurfaceSet> | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      surfaceSet("aerial_sand", 0.86, 0.9), surfaceSet("concrete_floor_02", 0.86, 0.7), surfaceSet("aerial_asphalt_01", 0.8, 1.1),
      surfaceSet("asphalt_02", 0.8, 1.0),
    ]).then(([sand, concrete, asphalt, asphalt2]) => { if (alive) setS({ sand, concrete, asphalt, asphalt2 }); }).catch(() => setS({}));
    return () => { alive = false; };
  }, []);
  return s;
}

export function Airfield({ data, center }: { data: AirfieldData; center: P2 }) {
  const surf = useSurfaces();
  const mats = useMemo(() => {
    const std = (color: string, set: SurfaceSet | undefined, roughness: number, order: number, normalScale = 0.6) => layer(new THREE.MeshStandardMaterial({
      color, roughness, metalness: 0, map: set?.map ?? null, normalMap: set?.normalMap ?? null,
      normalScale: new THREE.Vector2(normalScale, normalScale), roughnessMap: set?.roughnessMap ?? null,
    }), order);
    const ground = std("#d8c39f", surf?.sand, 1, 0, 0.8) as THREE.MeshStandardMaterial;
    macroVariation(ground, 0.071, 0.0123);
    const paint = (color: string) => layer(new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 }), 8);
    return {
      ground,
      green: std("#7c9a5a", undefined, 0.95, 1),
      water: layer(new THREE.MeshStandardMaterial({ color: "#2d5f73", roughness: 0.12, metalness: 0.1 }), 1),
      parking: std("#6c6d6c", surf?.asphalt2, 0.9, 2),
      roads: std("#55585b", surf?.asphalt2, 0.85, 3),
      shoulder: std("#a39c8c", surf?.asphalt2, 0.95, 2),
      apron: std("#c4c1b9", surf?.concrete, 0.82, 4, 0.5),
      taxi: std("#6b6d70", surf?.asphalt, 0.82, 5),
      runway: std("#505357", surf?.asphalt, 0.8, 6),
      white: paint("#ecebe6"),
      yellow: paint("#e3b12a"),
      red: paint("#c63a2f"),
    };
  }, [surf]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const lightMat = useMemo(() => airfieldLightMaterial(), []);
  const groundGeo = useMemo(() => {
    const b = new GeoBuilder(48);
    const R = 16000;
    b.quad([center[0] - R, center[1] - R], [center[0] + R, center[1] - R], [center[0] + R, center[1] + R], [center[0] - R, center[1] + R], 0);
    return b.build();
  }, [center]);

  // live state: wet pavement, runway closures, LVP stop bars, night gain
  useFrame(({ clock, size, camera }) => {
    const s = twinState;
    const wet = s.wetness;
    for (const k of ["runway", "taxi", "apron", "shoulder", "roads", "parking"] as const) {
      const m = mats[k] as THREE.MeshStandardMaterial;
      m.roughness = THREE.MathUtils.lerp(k === "apron" ? 0.82 : 0.85, 0.18, wet);
    }
    (mats.ground as THREE.MeshStandardMaterial).color.set("#d8c39f").multiplyScalar(1 - 0.18 * wet);
    const u = lightMat.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uScatter.value = s.scatter;
    u.uScale.value = size.height / (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360));
    const night = s.night;
    const base = 0.22 + 0.95 * night;
    const gains = u.uGroupGain.value as number[];
    LIGHT_GROUPS.forEach((g, i) => {
      gains[i] = g === "stopbar" ? (s.lvp ? 1.3 : 0) : g === "apron" ? 0.15 + 1.3 * night : g === "approach" ? base * 1.2 : g === "papi" ? base * 1.4 : base;
    });
    const off = u.uRunwayOff.value as number[];
    data.rws.forEach((r, i) => { if (i < 4) off[i] = s.closedRunways.has(r.id) ? 1 : 0; });
  });

  return (
    <group>
      <mesh geometry={groundGeo} material={mats.ground} receiveShadow position={[0, -0.02, 0]} />
      {data.green && <mesh geometry={data.green} material={mats.green} receiveShadow />}
      {data.water && <mesh geometry={data.water} material={mats.water} receiveShadow />}
      {data.parking && <mesh geometry={data.parking} material={mats.parking} receiveShadow />}
      {data.roads && <mesh geometry={data.roads} material={mats.roads} receiveShadow />}
      {data.shoulder && <mesh geometry={data.shoulder} material={mats.shoulder} receiveShadow />}
      {data.apron && <mesh geometry={data.apron} material={mats.apron} receiveShadow />}
      {data.taxi && <mesh geometry={data.taxi} material={mats.taxi} receiveShadow />}
      {data.runway && <mesh geometry={data.runway} material={mats.runway} receiveShadow />}
      {data.white && <mesh geometry={data.white} material={mats.white} receiveShadow />}
      {data.yellow && <mesh geometry={data.yellow} material={mats.yellow} receiveShadow />}
      {data.red && <mesh geometry={data.red} material={mats.red} receiveShadow />}
      {data.labels.map((l, i) => <Designator key={i} label={l} />)}
      <points geometry={data.lights} material={lightMat} frustumCulled={false} renderOrder={4} />
      <Buildings data={data} />
      <FloodPools data={data} />
    </group>
  );
}

const designatorCache = new Map<string, THREE.CanvasTexture>();

function designatorTexture(text: string, letter: string): THREE.CanvasTexture {
  const key = `${text}${letter}`;
  const hit = designatorCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  // narrow stencil-like digits (runway numbers are tall: 9 m × 3 m)
  g.font = `600 200px "Inter Variable", Inter, Arial, sans-serif`;
  g.save();
  g.scale(0.62, 1);
  if (letter) {
    g.fillText(text, 128 / 0.62, 150);
    g.fillText(letter, 128 / 0.62, 390);
  } else g.fillText(text, 128 / 0.62, 256);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  designatorCache.set(key, t);
  return t;
}

function Designator({ label }: { label: DesignatorLabel }) {
  const tex = useMemo(() => designatorTexture(label.text, label.letter), [label.text, label.letter]);
  const mat = useMemo(() => layer(new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, color: "#ecebe6" }), 9), [tex]);
  const L = label.letter ? 32 : 16;
  return (
    <group position={[label.at[0], 0, -label.at[1]]} rotation={[0, (-label.heading * Math.PI) / 180, 0]}>
      {/* plane lies flat; text "up" points along the landing direction (away from the approach) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow>
        <planeGeometry args={[L / 2, L]} />
      </mesh>
    </group>
  );
}

function Buildings({ data }: { data: AirfieldData }) {
  const mats = useMemo(() => {
    const glass = facadeTextures("glass"), concrete = facadeTextures("concrete"), metal = facadeTextures("metal");
    const wall = (t: { map: THREE.Texture; emissive: THREE.Texture }, rough: number, metalness: number) => new THREE.MeshStandardMaterial({
      map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color("#ffe2bd"), emissiveIntensity: 0, roughness: rough, metalness,
    });
    return {
      glass: wall(glass, 0.22, 0.35), concrete: wall(concrete, 0.85, 0), metal: wall(metal, 0.5, 0.45),
      roof: new THREE.MeshStandardMaterial({ color: "#e4e2dc", roughness: 0.75 }),
      roofMetal: new THREE.MeshStandardMaterial({ color: "#b9bec3", roughness: 0.45, metalness: 0.5 }),
      ctxWall: wall(concrete, 0.9, 0), ctxRoof: new THREE.MeshStandardMaterial({ color: "#d6cbb7", roughness: 0.9 }),
    };
  }, []);
  useFrame(() => {
    const n = twinState.night;
    mats.glass.emissiveIntensity = 0.04 + 0.85 * n;
    mats.concrete.emissiveIntensity = 0.55 * n;
    mats.ctxWall.emissiveIntensity = 0.45 * n;
  });
  const b = data.buildings;
  return (
    <group>
      {b.glass && <mesh geometry={b.glass} material={mats.glass} castShadow receiveShadow />}
      {b.concrete && <mesh geometry={b.concrete} material={mats.concrete} castShadow receiveShadow />}
      {b.metal && <mesh geometry={b.metal} material={mats.metal} castShadow receiveShadow />}
      {b.roof && <mesh geometry={b.roof} material={mats.roof} castShadow receiveShadow />}
      {b.roofMetal && <mesh geometry={b.roofMetal} material={mats.roofMetal} castShadow receiveShadow />}
      {data.context.walls && <mesh geometry={data.context.walls} material={mats.ctxWall} receiveShadow />}
      {data.context.roof && <mesh geometry={data.context.roof} material={mats.ctxRoof} receiveShadow />}
    </group>
  );
}

/** Night-time light pools under apron flood masts (additive ground decals). */
function FloodPools({ data }: { data: AirfieldData }) {
  const { geo, mat } = useMemo(() => {
    const pos: number[] = [], uv: number[] = [];
    for (const m of data.masts) {
      const r = 88;
      const [x, y] = m.at;
      const q = [[x - r, y - r, 0, 0], [x + r, y - r, 1, 0], [x + r, y + r, 1, 1], [x - r, y + r, 0, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(q[k][0], 0, -q[k][1]); uv.push(q[k][2], q[k][3]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    const m = layer(new THREE.MeshBasicMaterial({
      map: poolTexture(), color: "#ffe2b8", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }), 10);
    return { geo: g, mat: m as THREE.MeshBasicMaterial };
  }, [data]);
  useFrame(() => { mat.opacity = (0.5 + 0.25 * twinState.scatter) * twinState.night; mat.visible = twinState.night > 0.05; });
  return <mesh geometry={geo} material={mat} renderOrder={3} />;
}
