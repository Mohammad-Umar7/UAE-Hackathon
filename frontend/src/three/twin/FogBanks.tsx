"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Runtime } from "@/core/runtime";
import type { P2 } from "./geometry";

/** Tileable fBm value noise (deterministic), used to break the fog layer into drifting banks. */
function fogNoise(): THREE.DataTexture {
  const N = 256;
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const octaves = [4, 8, 16, 32, 64].map((g) => ({ g, v: Float32Array.from({ length: g * g }, rnd) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const field = new Float32Array(N * N);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0, amp = 1, tot = 0;
      for (const o of octaves) {
        const fx = (x / N) * o.g, fy = (y / N) * o.g;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = smooth(fx - x0), ty = smooth(fy - y0);
        const at = (i: number, j: number) => o.v[((j + o.g) % o.g) * o.g + ((i + o.g) % o.g)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += amp * (a + (b - a) * ty);
        tot += amp;
        amp *= 0.55;
      }
      v /= tot;
      field[y * N + x] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const v = Math.round((255 * (field[i] - lo)) / (hi - lo));
    data.set([v, v, v, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const LAYERS = [
  { h: 3.5, scale: 820, drift: [5.5, 1.6], opacity: 0.62 },
  { h: 13, scale: 1180, drift: [-3.4, 2.4], opacity: 0.42 },
  { h: 29, scale: 1650, drift: [2.2, -1.8], opacity: 0.24 },
];

export function FogBanks({ rt, icao, center, radius }: { rt: Runtime; icao: string; center: P2; radius: number }) {
  const { scene } = useThree();
  const noise = useMemo(() => fogNoise(), []);
  const meshes = useMemo(() => LAYERS.map((l) => {
    const size = (radius + 3500) * 2;
    const g = new THREE.PlaneGeometry(size, size, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: noise }, uOffset: { value: new THREE.Vector2() }, uScale: { value: l.scale }, uOpacity: { value: 0 },
        uColor: { value: new THREE.Color() }, uCenter: { value: new THREE.Vector2(center[0], -center[1]) }, uRadius: { value: size / 2 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4( position, 1.0 );
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoise; uniform vec2 uOffset; uniform float uScale; uniform float uOpacity;
        uniform vec3 uColor; uniform vec2 uCenter; uniform float uRadius;
        varying vec3 vWorld;
        void main() {
          vec2 uv = vWorld.xz / uScale + uOffset;
          float n = texture2D( uNoise, uv ).r * 0.62 + texture2D( uNoise, uv * 2.9 + vec2( 0.31, 0.77 ) ).r * 0.38;
          float a = smoothstep( 0.30, 0.82, n ) * uOpacity;
          vec3 toFrag = vWorld - cameraPosition;
          float d = length( toFrag );
          a *= smoothstep( 12.0, 140.0, d );                                  // never a hard sheet at the lens
          a *= smoothstep( 0.03, 0.28, abs( toFrag.y ) / max( d, 1.0 ) );     // fade when seen edge-on
          a *= 1.0 - smoothstep( 0.72, 1.0, length( vWorld.xz - uCenter ) / uRadius );
          if ( a < 0.004 ) discard;
          gl_FragColor = vec4( uColor * ( 0.92 + 0.16 * n ), a );
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(center[0], l.h, -center[1]);
    mesh.renderOrder = 7;
    mesh.frustumCulled = false;
    return mesh;
  }), [noise, center, radius]);
  useEffect(() => () => meshes.forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }), [meshes]);
  useEffect(() => () => noise.dispose(), [noise]);

  useFrame(({ clock }) => {
    const wx = rt.world.weather[icao];
    const amount = THREE.MathUtils.smoothstep(wx?.fog ?? 0, 0.3, 0.85);
    const fogColor = (scene.fog as THREE.Fog | null)?.color;
    meshes.forEach((mesh, i) => {
      const l = LAYERS[i];
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.uOpacity.value += (amount * l.opacity - u.uOpacity.value) * 0.03;
      mesh.visible = u.uOpacity.value > 0.005;
      const t = clock.elapsedTime;
      u.uOffset.value.set((t * l.drift[0]) / l.scale, (t * l.drift[1]) / l.scale);
      if (fogColor) u.uColor.value.copy(fogColor).multiplyScalar(1.12);
    });
  });
  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>;
}
