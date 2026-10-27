"use client";

/**
 * The glow of runway lighting as seen from a distance: a soft line of light along each runway edge, a green bar
 * across each landing threshold, a red bar at each runway end and the approach-light line leading in. Point
 * lights (lights.ts) carry the detail up close; this keeps a lit runway legible from the overview at dusk, at
 * night and in low visibility, when the lights are on at full strength. Closed runways go dark.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { P2, RunwayGeom } from "./geometry";
import { twinState } from "./state";

const WHITE = [1.0, 0.9, 0.74], GREEN = [0.2, 1.0, 0.5], RED = [1.0, 0.16, 0.1], APPROACH = [1.0, 0.97, 0.9];

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const norm = (a: P2): P2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a: P2): P2 => [-a[1], a[0]];

/** Quads with `across` (−1..1 over the width), `along` (metres) and the light spacing that makes the beads. */
function buildGlow(rws: RunwayGeom[]): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], across: number[] = [], along: number[] = [], spacing: number[] = [], runway: number[] = [];
  const quad = (from: P2, to: P2, half: number, h: number, color: number[], gap: number, ri: number) => {
    const d = norm(sub(to, from)), n = perp(d), L = len(sub(to, from));
    const c = [add(from, mul(n, -half)), add(from, mul(n, half)), add(to, mul(n, half)), add(to, mul(n, -half))];
    const ac = [-1, 1, 1, -1], al = [0, 0, L, L];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(c[k][0], h, -c[k][1]);
      col.push(...color);
      across.push(ac[k]);
      along.push(al[k]);
      spacing.push(gap);
      runway.push(ri);
    }
  };
  rws.forEach((rw, ri) => {
    const u = norm(sub(rw.b, rw.a)), n = perp(u), W = rw.width;
    for (const side of [-1, 1]) quad(add(rw.a, mul(n, side * (W / 2 + 1))), add(rw.b, mul(n, side * (W / 2 + 1))), 4.5, 0.35, WHITE, 60, ri);
    for (const end of rw.ends) {
      const nn = perp(end.dir);
      quad(add(end.at, mul(nn, -(W / 2 + 4))), add(end.at, mul(nn, W / 2 + 4)), 3.5, 0.4, GREEN, 0, ri);
      quad(add(end.pave, mul(nn, -(W / 2 + 3))), add(end.pave, mul(nn, W / 2 + 3)), 3, 0.4, RED, 0, ri);
      quad(sub(end.at, mul(end.dir, 900)), sub(end.at, mul(end.dir, 30)), 4, 1.2, APPROACH, 30, ri);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("across", new THREE.Float32BufferAttribute(across, 1));
  g.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute("spacing", new THREE.Float32BufferAttribute(spacing, 1));
  g.setAttribute("runway", new THREE.Float32BufferAttribute(runway, 1));
  g.computeBoundingSphere();
  return g;
}

function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uGain: { value: 0 }, uRunwayOff: { value: [0, 0, 0, 0] } }]),
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float across;
      attribute float along;
      attribute float spacing;
      attribute float runway;
      uniform float uRunwayOff[4];
      varying vec3 vColor;
      varying float vAcross;
      varying float vAlong;
      varying float vSpacing;
      varying float vOn;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vColor = color; vAcross = across; vAlong = along; vSpacing = spacing;
        int ri = int( runway + 0.5 );
        vOn = ri < 4 && uRunwayOff[ ri ] > 0.5 ? 0.0 : 1.0;
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        mvPosition.xyz *= 0.995; // in front of the polygon-offset paving, without moving on screen
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain;
      varying vec3 vColor;
      varying float vAcross;
      varying float vAlong;
      varying float vSpacing;
      varying float vOn;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float core = exp( - vAcross * vAcross * 9.0 );
        // brighter beads where the individual lights stand, joined by the glow between them
        float beads = vSpacing > 0.5 ? 0.45 + 0.55 * pow( 0.5 + 0.5 * cos( vAlong * 6.2831853 / vSpacing ), 8.0 ) : 1.0;
        vec3 lit = vColor * core * beads * uGain * vOn;
        if ( lit.r + lit.g + lit.b < 0.004 ) discard;
        gl_FragColor = vec4( lit, 1.0 );
        #ifdef USE_FOG
          #include <fog_fragment>
          gl_FragColor.rgb = lit * ( 1.0 - fogFactor * 0.8 );
        #endif
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // layout y becomes -z, which mirrors the quads' winding: draw both faces
    side: THREE.DoubleSide,
    fog: true,
  });
}

export function RunwayGlow({ rws }: { rws: RunwayGeom[] }) {
  const geo = useMemo(() => buildGlow(rws), [rws]);
  const mat = useMemo(() => glowMaterial(), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(() => {
    const s = twinState;
    // runway lights are on at dusk, at night and in low visibility; in clear daylight the glow is not visible
    const target = 1.15 * THREE.MathUtils.smoothstep(s.night, 0.12, 0.75) + (s.lvp ? 0.55 : 0) + 0.35 * s.scatter;
    const u = mat.uniforms;
    u.uGain.value += (target - u.uGain.value) * 0.05;
    const off = u.uRunwayOff.value as number[];
    rws.forEach((r, i) => { if (i < 4) off[i] = s.closedRunways.has(r.id) ? 1 : 0; });
  });
  return <mesh geometry={geo} material={mat} renderOrder={6} frustumCulled={false} />;
}
