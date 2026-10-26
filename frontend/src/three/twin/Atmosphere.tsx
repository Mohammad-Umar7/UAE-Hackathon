"use client";

import { Environment, Sky } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PROFILES } from "@/core/airports/profiles";
import type { Runtime } from "@/core/runtime";
import { activeRestrictions } from "@/core/world";
import { useOps } from "@/store/ops";
import { groundFogDensity, hazeDensity, installHeightFog } from "./fog";
import { twinState } from "./state";
import { daylight, sunPosition } from "./sun";

installHeightFog();

const LIGHTING_TIME: Record<string, number> = { day: 13 * 3600, dusk: 17.82 * 3600, night: 21.5 * 3600 };
const C = (h: string) => new THREE.Color(h);
const FOG_DAY = C("#d3d6d6"), FOG_DUSK = C("#c7b39f"), FOG_NIGHT = C("#252c36"), FOG_GLOW = C("#5a5f66");
const SUN_LOW = C("#ffad66"), SUN_HIGH = C("#fff4e6");
const SKY_DAY = C("#bcd3ee"), SKY_NIGHT = C("#2c3a55"), GROUND_DAY = C("#cdb48c"), GROUND_NIGHT = C("#2a2622");

export function Atmosphere({ rt, icao }: { rt: Runtime; icao: string }) {
  const { scene } = useThree();
  const lighting = useOps((s) => s.overlays.lighting);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const sky = useRef<THREE.Mesh>(null);
  const flash = useRef({ until: 0, next: 0, level: 0 });
  const tmp = useMemo(() => ({ c: new THREE.Color(), dir: new THREE.Vector3() }), []);

  useEffect(() => {
    scene.fog = new THREE.Fog("#d3d6d6", 0, 0.00002);
    return () => { scene.fog = null; };
  }, [scene]);

  useFrame(({ clock }, dt) => {
    const w = rt.world;
    const p = PROFILES[icao];
    const t = lighting === "auto" ? w.now : LIGHTING_TIME[lighting];
    twinState.simTime = w.now;
    const s = sunPosition(p.lat, p.lon, t);
    const day = daylight(s.elevation);
    const night = 1 - day;
    twinState.night = night;
    tmp.dir.set(s.east, s.up, -s.north).normalize();
    twinState.sunDir.copy(tmp.dir);
    const wx = w.weather[icao];
    const vis = wx?.visibility ?? 10000;
    const precip = wx?.precip ?? "none";
    const overcast = Math.min(1, (wx?.cloud ?? 0.1) * 1.1 + (wx?.thunder ? 0.4 : 0));

    // ---- operations state that materials react to
    const wetTarget = precip === "heavy_rain" ? 1 : precip === "rain" ? 0.85 : precip === "light_rain" ? 0.5 : 0;
    twinState.wetness += (wetTarget - twinState.wetness) * Math.min(1, dt * (wetTarget > twinState.wetness ? 0.6 : 0.08));
    twinState.scatter += (THREE.MathUtils.smoothstep(wx?.fog ?? 0, 0.2, 0.9) - twinState.scatter) * Math.min(1, dt * 0.8);
    twinState.lvp = wx?.category === "LVP" || activeRestrictions(w, icao, "LOW_VISIBILITY").length > 0;
    twinState.closedRunways.clear();
    for (const r of activeRestrictions(w, icao, "RUNWAY_CLOSED")) twinState.closedRunways.add(String(r.params.runway ?? ""));

    // ---- fog: ground layer + haze, colour by time of day
    const fog = scene.fog as THREE.Fog;
    if (fog) {
      fog.near = groundFogDensity(vis, wx?.fog ?? 0) + (precip !== "none" ? 0.0012 : 0);
      fog.far = hazeDensity(vis, wx?.fog ?? 0) * (1 + overcast);
      const dusk = Math.max(0, 1 - Math.abs(s.elevation - 2) / 10);
      tmp.c.copy(FOG_DAY).lerp(FOG_DUSK, dusk * 0.8).lerp(FOG_NIGHT, night);
      // at night a dense fog layer glows with the airfield lighting it scatters
      if (night > 0.3) tmp.c.lerp(FOG_GLOW, Math.min(1, (wx?.fog ?? 0) * 1.2) * 0.55 * night);
      if (overcast > 0.5) tmp.c.multiplyScalar(1 - 0.25 * (overcast - 0.5));
      fog.color.copy(tmp.c);
    }

    // ---- lightning
    const f = flash.current;
    const now = clock.elapsedTime;
    if (wx?.lightning && now > f.next) { f.until = now + 0.09 + Math.random() * 0.12; f.next = now + 2.5 + Math.random() * 6; }
    f.level = now < f.until ? 1 : Math.max(0, f.level - dt * 6);

    // ---- sun / moon
    const L = sun.current;
    if (L) {
      const elev = s.elevation;
      if (elev > -2) {
        L.position.copy(twinState.target).addScaledVector(tmp.dir, 6000);
        const k = THREE.MathUtils.clamp((elev + 2) / 14, 0, 1);
        L.intensity = 3.4 * k * (1 - 0.65 * overcast);
        L.color.copy(SUN_LOW).lerp(SUN_HIGH, THREE.MathUtils.clamp(elev / 35, 0, 1));
      } else {
        // moonlight from the east-southeast, cool and dim
        L.position.copy(twinState.target).add(new THREE.Vector3(3000, 4200, 1500));
        L.intensity = 0.32 * (1 - 0.6 * overcast);
        L.color.set("#9fb2d8");
      }
      L.target.position.copy(twinState.target);
      L.target.updateMatrixWorld();
      const half = THREE.MathUtils.clamp(twinState.cameraDistance * 0.7, 120, 2600);
      const cam = L.shadow.camera as THREE.OrthographicCamera;
      if (Math.abs(cam.right - half) > 1) {
        cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
        cam.near = 100; cam.far = 14000;
        cam.updateProjectionMatrix();
      }
    }
    if (hemi.current) {
      hemi.current.color.copy(SKY_DAY).lerp(SKY_NIGHT, night);
      hemi.current.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, night);
      hemi.current.intensity = 0.55 * day + 0.42 * night + 2.5 * f.level;
    }
    if (amb.current) amb.current.intensity = 0.06 + 0.62 * night; // apron flood lighting fill at night
    scene.environmentIntensity = (0.12 + 0.88 * day) * (1 - 0.45 * overcast);

    const sk = sky.current?.material as THREE.ShaderMaterial | undefined;
    if (sk?.uniforms) {
      sk.uniforms.sunPosition.value.copy(tmp.dir).multiplyScalar(1000);
      sk.uniforms.turbidity.value = 6 + 6 * overcast + (vis < 3000 ? 4 : 0);
      sk.uniforms.rayleigh.value = 1.6 - 0.8 * overcast;
      sk.uniforms.mieCoefficient.value = 0.006 + 0.01 * overcast;
    }
  });

  return (
    <>
      <Sky ref={sky as never} distance={45000} sunPosition={[0, 1, 0]} mieDirectionalG={0.85} />
      <Stars />
      <Environment files="/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr" />
      <hemisphereLight ref={hemi} intensity={0.55} />
      <ambientLight ref={amb} intensity={0.06} color="#cfe0ff" />
      <directionalLight
        ref={sun}
        castShadow
        intensity={3}
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.8}
      />
      <Rain rt={rt} icao={icao} />
    </>
  );
}

/** A few thousand stars on a dome, fading in after civil dusk. */
function Stars() {
  const { geo, mat } = useMemo(() => {
    const n = 2600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const z = rnd() * 0.95 + 0.05; // upper hemisphere
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos.set([Math.cos(a) * r * 40000, z * 40000, Math.sin(a) * r * 40000], i * 3);
      const b = 0.35 + rnd() ** 3 * 0.9;
      col.set([b, b, b * (0.9 + rnd() * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    return { geo: g, mat: m };
  }, []);
  const ref = useRef<THREE.Points>(null);
  useFrame(({ camera }) => {
    mat.opacity = Math.max(0, twinState.night - 0.35) * 1.4;
    ref.current?.position.set(camera.position.x, 0, camera.position.z);
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={-1} />;
}

/** Rain streaks in a box that follows the camera (GPU-animated). */
function Rain({ rt, icao }: { rt: Runtime; icao: string }) {
  const { geo, mat } = useMemo(() => {
    const n = 9000;
    const base = new Float32Array(n * 2 * 3);
    const tail = new Float32Array(n * 2);
    let seed = 777;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * 160, y = rnd() * 90, z = (rnd() - 0.5) * 160;
      base.set([x, y, z, x, y, z], i * 6);
      tail[i * 2] = 0;
      tail[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(base, 3));
    g.setAttribute("tail", new THREE.BufferAttribute(tail, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0, 0) }, uOpacity: { value: 0 }, uCam: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */ `
        attribute float tail;
        uniform float uTime; uniform vec2 uWind; uniform vec3 uCam;
        varying float vA;
        void main() {
          vec3 p = position;
          float fall = 11.0;
          p.y = mod( p.y - uTime * fall, 90.0 );
          p.xz += uWind * ( 90.0 - p.y ) / fall;
          p.xz = mod( p.xz - uCam.xz + 80.0, 160.0 ) - 80.0;
          vec3 w = vec3( uCam.x + p.x, uCam.y - 45.0 + p.y, uCam.z + p.z );
          w.y += tail * 1.1;
          w.xz -= tail * uWind * 0.1;
          vA = 1.0 - tail * 0.7;
          gl_Position = projectionMatrix * viewMatrix * vec4( w, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; varying float vA;
        void main() { gl_FragColor = vec4( vec3( 0.78, 0.82, 0.88 ), uOpacity * vA ); }`,
      transparent: true,
      depthWrite: false,
    });
    return { geo: g, mat: m };
  }, []);
  useFrame(({ clock, camera }) => {
    const wx = rt.world.weather[icao];
    const target = wx?.precip === "heavy_rain" ? 0.55 : wx?.precip === "rain" ? 0.4 : wx?.precip === "light_rain" ? 0.22 : 0;
    const u = mat.uniforms;
    u.uOpacity.value += (target - u.uOpacity.value) * 0.05;
    u.uTime.value = clock.elapsedTime;
    u.uCam.value.copy(camera.position);
    const dir = ((wx?.windDir ?? 0) + 180) * (Math.PI / 180);
    const kt = (wx?.gustKt ?? wx?.windKt ?? 0) * 0.514;
    u.uWind.value.set(Math.sin(dir) * kt * 0.3, -Math.cos(dir) * kt * 0.3);
    mat.visible = u.uOpacity.value > 0.01;
  });
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} />;
}
