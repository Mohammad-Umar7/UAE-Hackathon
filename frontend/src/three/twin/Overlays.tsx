"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PROFILES } from "@/core/airports/profiles";
import type { AirportInfo, StandInfo } from "@/core/airports/registry";
import { isOpen, type Proposal } from "@/core/approvals/workflow";
import type { Runtime } from "@/core/runtime";
import type { MovementLeg } from "@/core/types";
import { activeRestrictions } from "@/core/world";
import { useOps } from "@/store/ops";
import { fleetIndex } from "./Fleet";
import { GeoBuilder, headingVec, type RunwayGeom } from "./geometry";
import { twinState } from "./state";

// ------------------------------------------------------------------ stand status

export const STAND_MODE = { free: 0, occupied: 1, inbound: 2, closed: 3, conflict: 4, plan: 5 } as const;
const MODE_COLOR = ["#35c2a5", "#6fa6ff", "#f2a93b", "#ef5350", "#ff5a4f", "#a98bff"].map((c) => new THREE.Color(c));

/** Stand state for the 3D overlay and labels (shared picture unless the viewer is that airport's controller). */
export function standModes(rt: Runtime, ap: AirportInfo, role: string, planStands: Set<string>): Map<string, number> {
  const w = rt.world;
  const local = role === `AIRPORT_CONTROLLER:${ap.icao}`;
  const closed = new Set<string>();
  for (const r of activeRestrictions(w, ap.icao, "STAND_CLOSED")) {
    if (!r.shared && !local) continue;
    for (const s of (r.params.stands as string[]) ?? []) closed.add(s);
  }
  const waitingFor = new Set<string>();
  for (const v of Object.values(w.visits)) if (v.airport === ap.icao && v.phase === "WAITING_STAND" && v.stand) waitingFor.add(v.stand);
  const out = new Map<string, number>();
  for (const st of Object.values(ap.stands)) {
    const ss = w.stands[st.key];
    let m: number = STAND_MODE.free;
    if (ss?.occupant) m = STAND_MODE.occupied;
    else if (ss?.reservedBy) m = STAND_MODE.inbound;
    if (planStands.has(st.id)) m = STAND_MODE.plan;
    if (closed.has(st.id)) m = STAND_MODE.closed;
    if (waitingFor.has(st.id)) m = STAND_MODE.conflict;
    out.set(st.id, m);
  }
  return out;
}

function standFrame(st: StandInfo): { cx: number; cy: number; w: number; l: number } {
  const d = headingVec(st.heading);
  const l = st.maxWingspan > 65 ? 78 : st.maxWingspan > 52 ? 68 : 44;
  const cx = st.x - d[0] * (l / 2 - 5), cy = st.y - d[1] * (l / 2 - 5);
  return { cx, cy, w: st.maxWingspan + 6, l };
}

export function StandStatus({ rt, ap }: { rt: Runtime; ap: AirportInfo }) {
  const on = useOps((s) => s.overlays.stands);
  const role = useOps((s) => s.role);
  const stands = useMemo(() => Object.values(ap.stands), [ap]);
  const mesh = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const n = stands.length;
    g.setAttribute("aColor", new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aMode", new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    g.setAttribute("aSize", new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aMode; attribute vec2 aSize;
        varying vec3 vColor; varying float vMode; varying vec2 vP; varying vec2 vSize;
        void main() {
          vColor = aColor; vMode = aMode; vSize = aSize;
          vP = ( uv - 0.5 ) * aSize;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uNight;
        varying vec3 vColor; varying float vMode; varying vec2 vP; varying vec2 vSize;
        void main() {
          vec2 h = vSize * 0.5;
          vec2 q = abs( vP ) - ( h - 4.0 );
          float d = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - 4.0;   // rounded rect SDF (m)
          if ( d > 0.0 ) discard;
          float edge = 1.0 - smoothstep( 0.6, 1.4, -d );
          int mode = int( vMode + 0.5 );
          float fill = mode == 0 ? 0.03 : mode == 1 ? 0.10 : mode == 2 ? 0.08 : mode == 3 ? 0.0 : mode == 4 ? 0.18 : 0.14;
          float outline = mode == 0 ? 0.45 : 0.85;
          if ( mode == 2 || mode == 5 ) {   // dashed, marching
            float s = vP.x + vP.y;
            outline *= step( 0.5, fract( ( s - uTime * 6.0 ) / 7.0 ) );
          }
          if ( mode == 3 ) fill = 0.32 * step( 0.5, fract( ( vP.x + vP.y ) / 6.0 ) );
          if ( mode == 4 ) { float p = 0.5 + 0.5 * sin( uTime * 5.0 ); outline *= 0.6 + 0.4 * p; fill *= 0.5 + p; }
          float a = max( fill, edge * outline );
          gl_FragColor = vec4( vColor * ( 1.0 + uNight * 0.6 ), a );
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -12,
      polygonOffsetUnits: -24,
      toneMapped: false,
    });
    const im = new THREE.InstancedMesh(g, m, n);
    im.frustumCulled = false;
    im.renderOrder = 2;
    const o = new THREE.Object3D();
    stands.forEach((st, i) => {
      const f = standFrame(st);
      o.position.set(f.cx, 0.05, -f.cy);
      o.rotation.set(0, (-st.heading * Math.PI) / 180, 0);
      o.scale.set(f.w, 1, f.l);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      (g.getAttribute("aSize") as THREE.InstancedBufferAttribute).setXY(i, f.w, f.l);
    });
    return im;
  }, [stands]);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }, [mesh]);
  const last = useRef(0);
  useFrame(({ clock }) => {
    const mat = mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = clock.elapsedTime;
    mat.uniforms.uNight.value = twinState.night;
    if (clock.elapsedTime - last.current < 0.25) return;
    last.current = clock.elapsedTime;
    const modes = standModes(rt, ap, role, planStandsFor(rt, ap.icao, useOps.getState().selectedProposal));
    const col = mesh.geometry.getAttribute("aColor") as THREE.InstancedBufferAttribute;
    const md = mesh.geometry.getAttribute("aMode") as THREE.InstancedBufferAttribute;
    stands.forEach((st, i) => {
      const m = modes.get(st.id) ?? 0;
      const c = MODE_COLOR[m];
      col.setXYZ(i, c.r, c.g, c.b);
      md.setX(i, m);
    });
    col.needsUpdate = true;
    md.needsUpdate = true;
  });
  return <primitive object={mesh} visible={on} />;
}

// ------------------------------------------------------------------ taxi routes

const ROUTE_KINDS = new Set(["landing", "taxi", "pushback", "pivot", "tow", "hold"]);

function routeGeometry(legs: MovementLeg[]): THREE.BufferGeometry | null {
  const pos: number[] = [], dist: number[] = [];
  let travelled = 0;
  for (const leg of legs) {
    const s = leg.s;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (ROUTE_KINDS.has(leg.kind) && seg > 0.01) {
        const nx = (-(b[1] - a[1]) / seg) * 1.6, ny = ((b[0] - a[0]) / seg) * 1.6;
        const quad = [[a[0] + nx, a[1] + ny, travelled], [b[0] + nx, b[1] + ny, travelled + seg], [b[0] - nx, b[1] - ny, travelled + seg], [a[0] - nx, a[1] - ny, travelled]];
        for (const k of [0, 2, 1, 0, 3, 2]) { pos.push(quad[k][0], 0.15, -quad[k][1]); dist.push(quad[k][2]); }
      }
      travelled += seg;
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1));
  return g;
}

function routeMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uDist: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uEmph: { value: 0 } },
    vertexShader: /* glsl */ `attribute float aDist; varying float vDist;
      void main() { vDist = aDist; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */ `uniform float uDist; uniform float uTime; uniform vec3 uColor; uniform float uEmph; varying float vDist;
      void main() {
        float ahead = vDist - uDist;
        if ( ahead < 0.0 ) discard;
        float chevron = 0.55 + 0.45 * step( 0.5, fract( ( vDist - uTime * 14.0 ) / 16.0 ) );
        float fade = 1.0 - smoothstep( 900.0, 2600.0, ahead );
        gl_FragColor = vec4( uColor * 1.3, ( 0.5 + 0.4 * uEmph ) * chevron * fade );
      }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -14, polygonOffsetUnits: -28, toneMapped: false,
  });
}

export function Routes({ ap }: { ap: AirportInfo }) {
  const all = useOps((s) => s.overlays.routes);
  const selected = useOps((s) => s.selectedVisit);
  const group = useMemo(() => new THREE.Group(), []);
  const cache = useRef(new Map<string, { legs: MovementLeg[]; mesh: THREE.Mesh }>());
  useEffect(() => {
    const c = cache.current;
    return () => { for (const r of c.values()) { r.mesh.geometry.dispose(); (r.mesh.material as THREE.Material).dispose(); } c.clear(); };
  }, [ap]);
  useFrame(({ clock }) => {
    const c = cache.current;
    const live = new Set<string>();
    for (const [id, e] of fleetIndex) {
      const v = e.visit;
      if (!v.movement || !(all || id === selected)) continue;
      if (!["LANDING", "TAXI_IN", "TAXI_OUT", "PUSHBACK", "TOWING", "APPROACH"].includes(v.phase)) continue;
      live.add(id);
      let r = c.get(id);
      if (!r || r.legs !== v.movement) {
        if (r) { group.remove(r.mesh); r.mesh.geometry.dispose(); (r.mesh.material as THREE.Material).dispose(); c.delete(id); }
        const g = routeGeometry(v.movement);
        if (!g) continue;
        const color = v.movementKind === "tow" ? "#f2a93b" : v.movementKind === "departure" ? "#5aa7ff" : "#35c2a5";
        const mesh = new THREE.Mesh(g, routeMaterial(color));
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        group.add(mesh);
        r = { legs: v.movement, mesh };
        c.set(id, r);
      }
      const u = (r.mesh.material as THREE.ShaderMaterial).uniforms;
      u.uDist.value = e.pose.dist;
      u.uTime.value = clock.elapsedTime;
      u.uEmph.value = id === selected ? 1 : 0;
    }
    for (const [id, r] of c) {
      if (live.has(id)) continue;
      group.remove(r.mesh);
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
      c.delete(id);
    }
  });
  return <primitive object={group} />;
}

// ------------------------------------------------------------------ selection ring

export function SelectionRing() {
  const selected = useOps((s) => s.selectedVisit);
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -16, polygonOffsetUnits: -32 }), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const e = selected ? fleetIndex.get(selected) : null;
    m.visible = Boolean(e);
    if (!e) return;
    const r = e.kit.bbox.max.x + 6;
    const k = 1 + 0.06 * Math.sin(clock.elapsedTime * 4);
    // centre of the airframe is aft of the nose gear (model +Z = aft)
    const cz = (e.kit.bbox.min.z + e.kit.bbox.max.z) / 2;
    const d = headingVec(e.pose.heading);
    m.position.set(e.pose.x - d[0] * cz, Math.max(0.2, e.pose.z - 1), -(e.pose.y - d[1] * cz));
    m.scale.setScalar(r * k);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} material={mat} renderOrder={6}>
      <ringGeometry args={[0.94, 1, 96]} />
    </mesh>
  );
}

// ------------------------------------------------------------------ runway closures

export function RunwayClosures({ rws }: { rws: RunwayGeom[] }) {
  const ref = useRef<THREE.Mesh>(null);
  const key = useRef("");
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#d9342b", emissive: "#ff2a1a", emissiveIntensity: 0.6, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -20 }), []);
  useFrame(() => {
    const k = [...twinState.closedRunways].sort().join(",");
    if (k === key.current || !ref.current) return;
    key.current = k;
    const b = new GeoBuilder(4);
    for (const rw of rws) {
      if (!twinState.closedRunways.has(rw.id)) continue;
      const L = Math.hypot(rw.b[0] - rw.a[0], rw.b[1] - rw.a[1]);
      const u: [number, number] = [(rw.b[0] - rw.a[0]) / L, (rw.b[1] - rw.a[1]) / L];
      for (const f of [0.12, 0.5, 0.88]) {
        const c: [number, number] = [rw.a[0] + u[0] * L * f, rw.a[1] + u[1] * L * f];
        const a = Math.atan2(u[1], u[0]);
        for (const s of [-1, 1]) {
          const ang = a + (s * Math.PI) / 4;
          b.rect(c, [Math.cos(ang), Math.sin(ang)], rw.width * 1.1, 7, 0);
        }
      }
    }
    ref.current.geometry.dispose();
    ref.current.geometry = b.empty ? new THREE.BufferGeometry() : b.build();
  });
  return <mesh ref={ref} material={mat} renderOrder={2} />;
}

// ------------------------------------------------------------------ plan preview

export interface PlanMark { x: number; y: number; z: number; text: string; color: string }
/** Labels for plan arcs, drawn by the 2D label layer. */
export const planMarks: PlanMark[] = [];

export function previewProposal(rt: Runtime, icao: string, selectedKey: string | null): [string, Proposal] | null {
  const entries = Object.entries(rt.proposals);
  const touches = (p: Proposal) => p.plan.decisions.some((d) => d.airport === icao || d.to === icao);
  if (selectedKey && rt.proposals[selectedKey] && touches(rt.proposals[selectedKey])) return [selectedKey, rt.proposals[selectedKey]];
  const open = entries.filter(([, p]) => isOpen(p) && touches(p)).sort((a, b) => b[1].createdAt - a[1].createdAt);
  return open[0] ?? null;
}

export function PlanPreview({ rt, ap }: { rt: Runtime; ap: AirportInfo }) {
  const selectedKey = useOps((s) => s.selectedProposal);
  useOps((s) => s.version);
  const hit = previewProposal(rt, ap.icao, selectedKey);
  const arcs = useMemo(() => {
    planMarks.length = 0;
    if (!hit) return [];
    const [, p] = hit;
    const committed = p.status === "COMMITTED";
    const out: { pts: THREE.Vector3[]; color: string; dashed: boolean }[] = [];
    const arr = ap.runwayEnds[ap.arrivalEnd];
    const landing = arr ? new THREE.Vector3(arr.x + Math.sin((arr.heading * Math.PI) / 180) * 1400, 0, -(arr.y + Math.cos((arr.heading * Math.PI) / 180) * 1400)) : new THREE.Vector3();
    const standPt = (id: string | undefined | null) => {
      const st = id ? ap.stands[id] : null;
      if (!st) return null;
      const f = standFrame(st);
      return new THREE.Vector3(f.cx, 0, -f.cy);
    };
    const fromOf = (visit: string, stand: string | null | undefined) => {
      const e = fleetIndex.get(visit);
      if (e && e.pose.z < 5) return new THREE.Vector3(e.pose.x, 0, -e.pose.y);
      return standPt(stand) ?? landing.clone();
    };
    const arc = (a: THREE.Vector3, b: THREE.Vector3, color: string, text: string) => {
      const d = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y = Math.min(220, 18 + d * 0.22);
      const curve = new THREE.QuadraticBezierCurve3(a.clone().setY(a.y + 3), mid, b.clone().setY(b.y + 3));
      out.push({ pts: curve.getPoints(40), color, dashed: !committed });
      const top = curve.getPoint(0.5);
      planMarks.push({ x: top.x, y: top.y + 6, z: top.z, text, color });
    };
    for (const d of p.plan.decisions) {
      if (d.action === "assign_stand" && d.airport === ap.icao) {
        const b = standPt(d.stand);
        if (b) arc(fromOf(d.visit, d.from), b, committed ? "#35c2a5" : "#a98bff", `${d.callsign} → ${d.stand}`);
      } else if (d.action === "tow" && d.airport === ap.icao) {
        const a = standPt(d.from_stand), b = standPt(d.to_stand);
        if (a && b) arc(a, b, "#f2a93b", `${d.callsign} tow ${d.from_stand} → ${d.to_stand}`);
      } else if (d.action === "divert" && d.airport === ap.icao && d.to) {
        const A = PROFILES[ap.icao], B = PROFILES[d.to];
        const brg = Math.atan2((B.lon - A.lon) * Math.cos((A.lat * Math.PI) / 180), B.lat - A.lat);
        const end = landing.clone().add(new THREE.Vector3(Math.sin(brg) * 4200, 380, -Math.cos(brg) * 4200));
        arc(landing.clone().setY(250), end, "#f2a93b", `${d.callsign} → ${B.iata} (diversion)`);
      } else if (d.action === "divert" && d.to === ap.icao) {
        const b = standPt(d.stand);
        if (b) arc(landing.clone(), b, "#f2a93b", `${d.callsign} from ${PROFILES[d.airport]?.iata ?? d.airport} → ${d.stand ?? "stand"}`);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit?.[0], hit?.[1].status, hit?.[1].version, ap]);
  return (
    <group>
      {arcs.map((a, i) => (
        <Line key={i} points={a.pts} color={a.color} lineWidth={2.4} dashed={a.dashed} dashSize={10} gapSize={6} transparent opacity={0.95} toneMapped={false} />
      ))}
    </group>
  );
}

/** Stands targeted by the previewed plan (highlighted in the stand overlay). */
export function planStandsFor(rt: Runtime, icao: string, selectedKey: string | null): Set<string> {
  const hit = previewProposal(rt, icao, selectedKey);
  const s = new Set<string>();
  if (!hit) return s;
  for (const d of hit[1].plan.decisions) {
    if (d.action === "assign_stand" && d.airport === icao && d.stand) s.add(d.stand);
    if (d.action === "tow" && d.airport === icao && d.to_stand) s.add(d.to_stand);
    if (d.action === "divert" && d.to === icao && d.stand) s.add(d.stand);
  }
  return s;
}
