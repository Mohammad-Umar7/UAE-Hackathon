"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { PROFILES } from "@/core/airports/profiles";
import { isOpen } from "@/core/approvals/workflow";
import type { Runtime } from "@/core/runtime";
import { useOps } from "@/store/ops";
import { inboundBearing, offsetKm, project } from "./geo";
import { Anchor, AnchorProjector, AnchorSet } from "./ScreenAnchors";

type GeoJSON = { features: { geometry: { type: string; coordinates: unknown } ; properties?: Record<string, unknown> }[] };

function useGeo(name: string): GeoJSON | null {
  const [g, setG] = useState<GeoJSON | null>(null);
  useEffect(() => {
    fetch(`/data/national/${name}.geojson`).then((r) => (r.ok ? r.json() : null)).then(setG).catch(() => setG(null));
  }, [name]);
  return g;
}

function polygons(g: GeoJSON | null): number[][][][] {
  if (!g) return [];
  const out: number[][][][] = [];
  for (const f of g.features) {
    if (f.geometry.type === "Polygon") out.push(f.geometry.coordinates as number[][][]);
    else if (f.geometry.type === "MultiPolygon") out.push(...(f.geometry.coordinates as number[][][][]));
  }
  return out;
}

function Land() {
  const land = useGeo("land");
  const urban = useGeo("urban");
  const geom = useMemo(() => {
    const polys = polygons(land);
    if (!polys.length) return null;
    const shapes: THREE.Shape[] = [];
    for (const poly of polys) {
      const outer = poly[0].map(([lon, lat]) => new THREE.Vector2(...project(lat, lon)));
      const sh = new THREE.Shape(outer);
      for (const hole of poly.slice(1)) sh.holes.push(new THREE.Path(hole.map(([lon, lat]) => new THREE.Vector2(...project(lat, lon)))));
      shapes.push(sh);
    }
    const g = new THREE.ExtrudeGeometry(shapes, { depth: 0.6, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    return g;
  }, [land]);
  const urbanGeom = useMemo(() => {
    const polys = polygons(urban);
    if (!polys.length) return null;
    const shapes = polys.map((poly) => new THREE.Shape(poly[0].map(([lon, lat]) => new THREE.Vector2(...project(lat, lon)))));
    const g = new THREE.ShapeGeometry(shapes);
    g.rotateX(Math.PI / 2);
    return g;
  }, [urban]);
  return (
    <group>
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color="#0b1a2a" roughness={0.9} metalness={0.05} />
      </mesh>
      {geom ? (
        <mesh geometry={geom} position={[0, 0.6, 0]}>
          <meshStandardMaterial color="#1b2633" roughness={0.95} />
        </mesh>
      ) : (
        <FallbackCoast />
      )}
      {urbanGeom && (
        <mesh geometry={urbanGeom} position={[0, 0.62, 0]}>
          <meshBasicMaterial color="#2a3a4c" transparent opacity={0.85} />
        </mesh>
      )}
      <Roads />
      <gridHelper args={[800, 40, "#1e3247", "#14263a"]} position={[0, 0.66, 0]} />
    </group>
  );
}

/** Used only if the regional basemap file is missing: a neutral land mass so the map still reads. */
function FallbackCoast() {
  const geom = useMemo(() => {
    const pts = [[24.0, 54.0], [24.2, 54.2], [24.45, 54.45], [24.6, 54.75], [24.95, 55.05], [25.2, 55.25], [25.35, 55.4], [25.5, 55.55],
      [25.7, 55.8], [25.7, 56.2], [23.9, 56.2], [23.9, 54.0]].map(([la, lo]) => new THREE.Vector2(...project(la, lo)));
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  return <mesh geometry={geom} position={[0, 0.6, 0]}><meshStandardMaterial color="#1b2633" /></mesh>;
}

function Roads() {
  const roads = useGeo("roads");
  const lines = useMemo(() => {
    if (!roads) return [];
    const out: [number, number, number][][] = [];
    for (const f of roads.features) {
      const segs = f.geometry.type === "LineString" ? [f.geometry.coordinates as number[][]] : f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [];
      for (const s of segs) out.push(s.map(([lon, lat]) => { const [x, z] = project(lat, lon); return [x, 0.7, z] as [number, number, number]; }));
    }
    return out.slice(0, 600);
  }, [roads]);
  return <>{lines.map((l, i) => <Line key={i} points={l} color="#3b5168" lineWidth={1} transparent opacity={0.7} />)}</>;
}

const STATUS_COLOR: Record<string, string> = { normal: "#4fb8a4", watch: "#e0a646", disrupted: "#e57373" };

function AirportMarker({ rt, icao }: { rt: Runtime; icao: string }) {
  const p = PROFILES[icao];
  const [x, z] = project(p.lat, p.lon);
  const ring = useRef<THREE.Mesh>(null);
  const { setAirport, setView } = useOps();
  const sum = rt.airportSummary(icao);
  const ap = rt.airports[icao];
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const s = 1 + ((clock.elapsedTime * 0.6) % 1) * 2.2;
    ring.current.scale.set(s, s, s);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - ((clock.elapsedTime * 0.6) % 1));
  });
  const color = STATUS_COLOR[sum.status];
  return (
    <group position={[x, 0.8, z]}>
      {Object.values(ap.runwayEnds).filter((_, i) => i % 2 === 0).map((e) => {
        const other = Object.values(ap.runwayEnds).find((o) => o.runwayId === e.runwayId && o.designator !== e.designator)!;
        return <Line key={e.runwayId} points={[[e.x / 1000, 0.05, -e.y / 1000], [other.x / 1000, 0.05, -other.y / 1000]]} color="#e7eaee" lineWidth={2.2} />;
      })}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.2, 3.6, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={() => { setAirport(icao); setView("twin"); }}>
        <circleGeometry args={[3.2, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

/** Inbound/holding/diverting traffic from the simulation state. */
function Traffic({ rt }: { rt: Runtime }) {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<THREE.InstancedMesh>(null);
  const holdMesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 1.4); s.lineTo(0.9, -1); s.lineTo(0, -0.5); s.lineTo(-0.9, -1); s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  useFrame(({ clock }) => {
    const w = rt.world;
    let n = 0, h = 0;
    const im = meshes.current!, hm = holdMesh.current!;
    for (const v of Object.values(w.visits)) {
      if (!v.arr) continue;
      const p = PROFILES[v.airport];
      const [ax, az] = project(p.lat, p.lon);
      if (v.phase === "INBOUND" || v.phase === "APPROACH" || (v.phase === "SCHEDULED" && v.eta !== null && v.eta - w.now < 2400)) {
        const tLand = v.eldt ?? v.eta ?? w.now;
        const dt = Math.max(0, tLand - w.now);
        const km = Math.min(260, dt * 0.2 + 2);
        const bearing = v.divertedFrom ? (Math.atan2(project(PROFILES[v.divertedFrom]?.lat ?? p.lat, PROFILES[v.divertedFrom]?.lon ?? p.lon)[0] - ax, -(project(PROFILES[v.divertedFrom]?.lat ?? p.lat, PROFILES[v.divertedFrom]?.lon ?? p.lon)[1] - az)) * 180) / Math.PI : inboundBearing(v.arr.origin);
        const [x, z] = offsetKm(ax, az, bearing, km);
        tmp.position.set(x, 3 + Math.min(8, km / 20), z);
        tmp.rotation.set(0, (-(bearing + 180) * Math.PI) / 180, 0);
        tmp.scale.setScalar(1.5);
        tmp.updateMatrix();
        im.setMatrixAt(n, tmp.matrix);
        im.setColorAt(n, new THREE.Color(v.divertedFrom ? "#e0a646" : v.phase === "APPROACH" ? "#a9c4e6" : "#7f93a8"));
        n++;
      } else if (v.phase === "HOLDING") {
        const k = (parseInt(v.id.replace(/\D/g, "").slice(-3) || "0", 10) % 7) / 7;
        const ang = clock.elapsedTime * 0.5 + k * Math.PI * 2;
        const stack = inboundBearing(v.arr.origin);
        const [cx, cz] = offsetKm(ax, az, stack, 22);
        tmp.position.set(cx + Math.cos(ang) * 6, 6 + k * 3, cz + Math.sin(ang) * 3.5);
        tmp.rotation.set(0, -ang - Math.PI, 0);
        tmp.scale.setScalar(1.6);
        tmp.updateMatrix();
        hm.setMatrixAt(h, tmp.matrix);
        h++;
      }
      if (n >= 299 || h >= 199) break;
    }
    im.count = n;
    hm.count = h;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    hm.instanceMatrix.needsUpdate = true;
  });
  return (
    <group ref={group}>
      <instancedMesh ref={meshes} args={[geo, undefined, 300]}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={holdMesh} args={[geo, undefined, 200]}>
        <meshBasicMaterial color="#e0a646" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

interface ArcSpec { from: string; to: string; color: string; dashed: boolean; label: string }

/** Coordination arcs between airports for the latest proposal (pending / rejected / committed). */
function arcsOf(rt: Runtime): ArcSpec[] {
  const props = Object.values(rt.proposals).sort((a, b) => b.createdAt - a.createdAt);
  const p = props.find(isOpen) ?? props[0];
  if (!p) return [];
  const arcs: ArcSpec[] = [];
  const seen = new Set<string>();
  for (const d of p.plan.decisions) {
    if (d.action !== "divert" || !d.to) continue;
    const k = `${d.airport}>${d.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const slot = p.approvals.find((s) => s.key === `AIRPORT_CONTROLLER:${d.to}`);
    const color = p.status === "COMMITTED" ? "#4fb8a4" : slot?.decision === "REJECTED" ? "#e57373" : "#e0a646";
    const n = p.plan.decisions.filter((x) => x.action === "divert" && x.to === d.to && x.airport === d.airport).length;
    arcs.push({ from: d.airport, to: d.to, color, dashed: p.status !== "COMMITTED", label: `${n} diversion${n > 1 ? "s" : ""} · ${p.status === "COMMITTED" ? "approved" : slot?.decision === "REJECTED" ? "rejected" : "pending approval"}` });
  }
  return arcs;
}

function arcGeometry(a: ArcSpec) {
  const A = PROFILES[a.from], B = PROFILES[a.to];
  const [x1, z1] = project(A.lat, A.lon), [x2, z2] = project(B.lat, B.lon);
  const mid = new THREE.Vector3((x1 + x2) / 2, 18 + Math.hypot(x2 - x1, z2 - z1) * 0.12, (z1 + z2) / 2);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x1, 1, z1), mid, new THREE.Vector3(x2, 1, z2));
  return { points: curve.getPoints(48), mid };
}

function Arcs({ rt }: { rt: Runtime }) {
  useOps((s) => s.version);
  return (
    <>
      {arcsOf(rt).map((a) => (
        <Line key={`${a.from}-${a.to}`} points={arcGeometry(a).points} color={a.color} lineWidth={2.5} dashed={a.dashed} dashSize={3} gapSize={2} />
      ))}
    </>
  );
}

const CITIES: [string, number, number][] = [["Abu Dhabi", 24.4539, 54.3773], ["Dubai", 25.2048, 55.2708], ["Sharjah", 25.3463, 55.4209], ["Ajman", 25.4052, 55.5136], ["Al Ain", 24.2075, 55.7447]];

/** DOM labels for airports, cities and coordination arcs (positioned by the AnchorProjector). */
function MapLabels({ rt, anchors }: { rt: Runtime; anchors: AnchorSet }) {
  useOps((s) => s.version);
  const { setAirport, setView } = useOps();
  return (
    <>
      {CITIES.map(([n, la, lo]) => {
        const [x, z] = project(la, lo);
        return <Anchor key={n} set={anchors} id={`city:${n}`} pos={[x, 1, z]}><div className="whitespace-nowrap text-[11px] font-medium tracking-wide text-white/45">{n}</div></Anchor>;
      })}
      {Object.keys(rt.airports).sort().map((icao) => {
        const p = PROFILES[icao];
        const [x, z] = project(p.lat, p.lon);
        const sum = rt.airportSummary(icao);
        const color = STATUS_COLOR[sum.status];
        return (
          <Anchor key={icao} set={anchors} id={`ap:${icao}`} pos={[x, 1.8, z]}>
            <button onClick={() => { setAirport(icao); setView("twin"); }} className="hud pointer-events-auto whitespace-nowrap px-2.5 py-1.5 text-left" style={{ transform: "translateY(-46px)" }}>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                <span className="text-[12px] font-semibold">{p.iata}</span>
                <span className="muted text-[10.5px]">{p.shortName}</span>
              </div>
              <div className="muted mono text-[10px]">{Math.round(sum.rate)}/{p.arrCapacity} arr/h · {sum.sample?.holding ?? 0} holding · {sum.sample?.waiting ?? 0} waiting</div>
            </button>
          </Anchor>
        );
      })}
      {arcsOf(rt).map((a) => {
        const { mid } = arcGeometry(a);
        return (
          <Anchor key={`arc:${a.from}-${a.to}`} set={anchors} id={`arc:${a.from}-${a.to}`} pos={[mid.x, mid.y, mid.z]}>
            <div className="hud whitespace-nowrap px-2 py-1 text-[10.5px]" style={{ borderColor: a.color }}>{PROFILES[a.from].iata} → {PROFILES[a.to].iata} · {a.label}</div>
          </Anchor>
        );
      })}
    </>
  );
}

export function NationalMap({ rt }: { rt: Runtime }) {
  const anchors = useMemo(() => new AnchorSet(), []);
  return (
    <div className="relative h-full w-full">
    <Canvas camera={{ position: [-20, 170, 150], fov: 38, near: 1, far: 3000 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#0b1622"]} />
      <fog attach="fog" args={["#0b1622", 260, 620]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[60, 120, 40]} intensity={1.2} />
      <Land />
      {Object.keys(rt.airports).sort().map((icao) => <AirportMarker key={icao} rt={rt} icao={icao} />)}
      <Traffic rt={rt} />
      <Arcs rt={rt} />
      <OrbitControls target={[10, 0, -10]} maxPolarAngle={1.2} minDistance={60} maxDistance={420} enableDamping />
      <AnchorProjector set={anchors} />
    </Canvas>
    <div className="pointer-events-none absolute inset-0 overflow-hidden"><MapLabels rt={rt} anchors={anchors} /></div>
    </div>
  );
}
