"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { PROFILES } from "@/core/airports/profiles";
import { isOpen } from "@/core/approvals/workflow";
import type { Runtime } from "@/core/runtime";
import { useOps } from "@/store/ops";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
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
        <meshStandardMaterial color="#071322" roughness={0.9} metalness={0.05} />
      </mesh>
      {geom ? (
        <>
          <mesh geometry={geom} position={[0, 0.6, 0]}>
            <meshStandardMaterial color={LAND} roughness={0.95} />
          </mesh>
          <Region fallback={<OuterLand />} />
        </>
      ) : (
        <FallbackCoast />
      )}
      {urbanGeom && (
        <mesh geometry={urbanGeom} position={[0, 0.62, 0]}>
          <meshBasicMaterial color="#33465b" transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}
      <Roads />
      <gridHelper args={[800, 40, "#1e3247", "#14263a"]} position={[0, 0.66, 0]} />
    </group>
  );
}

/**
 * The OSM land layer is clipped to lon 54–56°E, lat 23.9–25.7°N. Beyond its east and south edges (and the
 * south-west, below the Abu Dhabi coast) the region is land, so extend it there instead of showing sea.
 */
function OuterLand() {
  const geom = useMemo(() => {
    const boxes: [number, number, number, number][] = [[50, 18, 62, 23.9], [56, 23.9, 62, 30], [50, 23.9, 54, 24.12]];
    const shapes = boxes.map(([lo0, la0, lo1, la1]) => new THREE.Shape([
      new THREE.Vector2(...project(la0, lo0)), new THREE.Vector2(...project(la0, lo1)), new THREE.Vector2(...project(la1, lo1)), new THREE.Vector2(...project(la1, lo0)),
    ]));
    const g = new THREE.ShapeGeometry(shapes);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  return <mesh geometry={geom} position={[0, 0.59, 0]}><meshStandardMaterial color="#26313d" roughness={0.95} side={THREE.DoubleSide} /></mesh>;
}

const LAND = "#2c3c4d";

/** The OSM land layer's extent: inside it the detailed coastline is drawn, outside it the Natural Earth one. */
const CLIP = { lon0: 54, lat0: 23.9, lon1: 56, lat1: 25.7 };

/**
 * The UAE and its neighbours (Natural Earth 1:10m), so the opening shot can show the whole country. Drawn below a
 * sea-coloured patch over the OSM extent, where the detailed land takes over. The UAE border glows while the
 * camera is far out and fades as it comes down to the three airports.
 */
function Region({ fallback }: { fallback: React.ReactNode }) {
  const region = useGeo("region");
  const built = useMemo(() => {
    if (!region) return null;
    const uae: THREE.Shape[] = [], other: THREE.Shape[] = [];
    const outline: [number, number, number][][] = [];
    const ring = (r: number[][]) => r.map(([lon, lat]) => new THREE.Vector2(...project(lat, lon)));
    for (const f of region.features) {
      const isUae = Boolean(f.properties?.uae);
      for (const poly of f.geometry.coordinates as number[][][][]) {
        const sh = new THREE.Shape(ring(poly[0]));
        for (const hole of poly.slice(1)) sh.holes.push(new THREE.Path(ring(hole)));
        (isUae ? uae : other).push(sh);
        if (isUae && poly[0].length > 40) outline.push(poly[0].map(([lon, lat]) => { const [x, z] = project(lat, lon); return [x, 1.4, z]; }));
      }
    }
    const flat = (shapes: THREE.Shape[]) => { const g = new THREE.ShapeGeometry(shapes); g.rotateX(Math.PI / 2); return g; };
    const [x0, z0] = project(CLIP.lat0, CLIP.lon0), [x1, z1] = project(CLIP.lat1, CLIP.lon1);
    return { uae: flat(uae), other: flat(other), outline, patch: { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, h: z0 - z1 } };
  }, [region]);
  const lines = useRef<({ material: THREE.Material & { opacity: number } } | null)[]>([]);
  const tint = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ camera }) => {
    // full glow from the whole-country view, faint once the camera is down at the three airports
    const k = THREE.MathUtils.smoothstep(camera.position.y, 230, 520);
    for (const l of lines.current) if (l) l.material.opacity = 0.15 + 0.85 * k;
    if (tint.current) { tint.current.opacity = 0.13 * k; tint.current.visible = k > 0.01; }
  });
  if (!built) return <>{fallback}</>;
  return (
    <group>
      <mesh geometry={built.other} position={[0, 0.2, 0]}><meshStandardMaterial color={LAND} roughness={0.95} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={built.uae} position={[0, 0.25, 0]}><meshStandardMaterial color={LAND} roughness={0.95} side={THREE.DoubleSide} /></mesh>
      {/* the UAE stands out in the whole-country shot; the tint fades as the detailed coastline takes over */}
      <mesh geometry={built.uae} position={[0, 1.3, 0]}><meshBasicMaterial ref={tint} color="#5fd4bd" transparent opacity={0.13} depthWrite={false} side={THREE.DoubleSide} /></mesh>
      <mesh position={[built.patch.x, 0.45, built.patch.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[built.patch.w, built.patch.h]} />
        <meshStandardMaterial color="#071322" roughness={0.9} metalness={0.05} />
      </mesh>
      {built.outline.map((pts, i) => (
        <Line key={i} ref={(l) => { lines.current[i] = l as never; }} points={pts} color="#5fd4bd" lineWidth={2} transparent opacity={1} />
      ))}
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

function AirportMarker({ rt, icao, onPick }: { rt: Runtime; icao: string; onPick: (icao: string) => void }) {
  const p = PROFILES[icao];
  const [x, z] = project(p.lat, p.lon);
  const ring = useRef<THREE.Mesh>(null);
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={() => onPick(icao)}>
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
  // per-aircraft colours live in an instance-colour buffer created before the first draw, so the material is
  // compiled with instance colours (the geometry has no vertex colours to multiply them with)
  useLayoutEffect(() => {
    const im = meshes.current!;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(300 * 3).fill(1), 3);
    (im.material as THREE.Material).needsUpdate = true;
  }, []);
  const col = useMemo(() => ({ div: new THREE.Color("#e0a646"), app: new THREE.Color("#a9c4e6"), inb: new THREE.Color("#7f93a8") }), []);
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
        im.setColorAt(n, v.divertedFrom ? col.div : v.phase === "APPROACH" ? col.app : col.inb);
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
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={holdMesh} args={[geo, undefined, 200]}>
        <meshBasicMaterial color="#e0a646" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

interface ArcSpec { from: string; to: string; color: string; dashed: boolean; n: number; status: string }

/** Coordination arcs between airports: the plan now running and the one waiting for approval (else the latest). */
function arcsOf(rt: Runtime): ArcSpec[] {
  const props = Object.values(rt.proposals).sort((a, b) => b.createdAt - a.createdAt);
  const shown = [props.find((p) => p.status === "COMMITTED"), props.find(isOpen)].filter((p) => p !== undefined);
  if (!shown.length && props[0]) shown.push(props[0]);
  const arcs: ArcSpec[] = [];
  const seen = new Set<string>();
  for (const p of shown) for (const d of p.plan.decisions) {
    if (d.action !== "divert" || !d.to) continue;
    const k = `${d.airport}>${d.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const slot = p.approvals.find((s) => s.key === `AIRPORT_CONTROLLER:${d.to}`);
    const color = p.status === "COMMITTED" ? "#4fb8a4" : slot?.decision === "REJECTED" ? "#e57373" : "#e0a646";
    const n = p.plan.decisions.filter((x) => x.action === "divert" && x.to === d.to && x.airport === d.airport).length;
    arcs.push({ from: d.airport, to: d.to, color, dashed: p.status !== "COMMITTED", n,
      status: p.status === "COMMITTED" ? "approved" : slot?.decision === "REJECTED" ? "rejected" : "pending approval" });
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

/** Dubai and Sharjah are 15 km apart: push their labels to opposite sides so they never overlap. */
const LABEL_SHIFT: Record<string, string> = { OMDB: "translate(-58%, 34px)", OMSJ: "translate(58%, -58px)", OMAA: "translateY(-46px)" };
/** Diversion flows are listed beside the receiving airport, on the side its own label leaves free
 *  (a label at an arc's midpoint lands on Dubai, which sits between Abu Dhabi and Sharjah). */
const FLOW_SHIFT: Record<string, string> = {
  OMAA: "translate(calc(50% + 26px), calc(50% + 14px))",
  OMDB: "translate(calc(50% + 22px), calc(50% + 30px))",
  OMSJ: "translate(calc(50% + 26px), calc(50% - 4px))",
};

const CITIES: [string, number, number][] = [["Abu Dhabi", 24.4539, 54.3773], ["Dubai", 25.2048, 55.2708], ["Sharjah", 25.3463, 55.4209], ["Ajman", 25.4052, 55.5136], ["Al Ain", 24.2075, 55.7447]];
/** Names for the opening whole-country shot. */
const COUNTRIES: [string, number, number, "uae" | "land" | "sea"][] = [
  ["United Arab Emirates", 23.55, 54.1, "uae"], ["Saudi Arabia", 22.9, 51.75, "land"], ["Oman", 23.35, 56.75, "land"], ["Qatar", 25.35, 51.2, "land"], ["Arabian Gulf", 25.95, 53.3, "sea"],
];

/** DOM labels for airports, cities and coordination arcs (positioned by the AnchorProjector). */
function MapLabels({ rt, anchors, onPick }: { rt: Runtime; anchors: AnchorSet; onPick: (icao: string) => void }) {
  useOps((s) => s.version);
  const expert = useOps((s) => s.detail === "expert");
  const wide = useOps((s) => s.intro !== "done");
  const fade = `transition-opacity duration-700 ${wide ? "opacity-0" : "opacity-100"}`;
  return (
    <>
      {COUNTRIES.map(([n, la, lo, kind]) => {
        const [x, z] = project(la, lo);
        return (
          <Anchor key={n} set={anchors} id={`country:${n}`} pos={[x, 1, z]}>
            <div className={`whitespace-nowrap uppercase transition-opacity duration-700 ${wide ? "opacity-100" : "opacity-0"} ${kind === "uae" ? "text-[15px] font-semibold tracking-[0.22em] text-[#8fe3d2]" : kind === "sea" ? "text-[11px] italic tracking-[0.3em] text-[#6f8fb3]" : "text-[11px] tracking-[0.25em] text-white/35"}`}>{n}</div>
          </Anchor>
        );
      })}
      {CITIES.map(([n, la, lo]) => {
        const [x, z] = project(la, lo);
        return <Anchor key={n} set={anchors} id={`city:${n}`} pos={[x, 1, z]}><div className={`whitespace-nowrap text-[11px] font-medium tracking-wide text-white/45 ${fade}`}>{n}</div></Anchor>;
      })}
      {Object.keys(rt.airports).sort().map((icao) => {
        const p = PROFILES[icao];
        const [x, z] = project(p.lat, p.lon);
        const sum = rt.airportSummary(icao);
        const color = STATUS_COLOR[sum.status];
        return (
          <Anchor key={icao} set={anchors} id={`ap:${icao}`} pos={[x, 1.8, z]}>
            <button onClick={() => onPick(icao)} className={`hud whitespace-nowrap px-2.5 py-1.5 text-left hover:border-white/30 ${fade} ${wide ? "" : "pointer-events-auto"}`}
              style={{ transform: LABEL_SHIFT[icao] ?? "translateY(-46px)" }} title={`Open ${p.city} in 3D`}>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                <span className="text-[12px] font-semibold">{p.iata}</span>
                <span className="muted text-[10.5px]">{p.shortName}</span>
              </div>
              <div className="muted mono text-[10px]">{expert
                ? `${Math.round(sum.rate)}/${p.arrCapacity} arr/h · ${sum.sample?.holding ?? 0} holding · ${sum.sample?.waiting ?? 0} waiting`
                : `${Math.round(sum.rate)} of ${p.arrCapacity} landings/h · ${sum.sample?.holding ?? 0} circling`}</div>
            </button>
          </Anchor>
        );
      })}
      {[...Map.groupBy(arcsOf(rt), (a) => a.to)].map(([to, flows]) => {
        const p = PROFILES[to];
        const [x, z] = project(p.lat, p.lon);
        const total = flows.reduce((n, a) => n + a.n, 0);
        return (
          <Anchor key={`flow:${to}`} set={anchors} id={`flow:${to}`} pos={[x, 1.8, z]}>
            <div className={`hud whitespace-nowrap border-l-[3px] px-2 py-1 text-[10.5px] leading-snug ${fade}`} style={{ borderLeftColor: flows[0].color, transform: FLOW_SHIFT[to] }}>
              <div className="font-semibold">{expert ? `${total} diversion${total > 1 ? "s" : ""} into ${p.iata} · ${flows[0].status}` : `${total} flight${total > 1 ? "s" : ""} sent to ${p.city} · ${flows[0].status}`}</div>
              {flows.map((a) => <div key={a.from} className="muted">{a.n} from {expert ? PROFILES[a.from].iata : PROFILES[a.from].city}</div>)}
            </div>
          </Anchor>
        );
      })}
    </>
  );
}

type View3 = { pos: [number, number, number]; target: [number, number, number] };
/** The resting overview of the three airports. */
const REST: View3 = { pos: [-20, 170, 150], target: [10, 0, -10] };
/** The whole UAE, for the opening shot (the country spans about 500 × 390 km around this point). */
const WIDE: View3 = { pos: [-112, 800, 300], target: [-112, 0, 120] };
const FLY_S = 3.6, DIVE_S = 1.25;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp3 = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k) as [number, number, number];

/**
 * Drives the camera for the two scripted moves — the opening flight from the whole UAE down to the three
 * airports, and the dive into an airport before its 3D view opens — and keeps the haze in step with the zoom.
 */
function MapCamera({ rt, dive, onDived }: { rt: Runtime; dive: string | null; onDived: (icao: string) => void }) {
  const { camera, scene } = useThree();
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const intro = useOps((s) => s.intro);
  const move = useRef<{ from: View3; to: View3; t: number; dur: number; done: () => void } | null>(null);

  useEffect(() => {
    if (!controls) return;
    const from = (): View3 => ({ pos: camera.position.toArray() as View3["pos"], target: controls.target.toArray() as View3["target"] });
    if (dive) {
      const p = PROFILES[dive];
      const [x, z] = project(p.lat, p.lon);
      move.current = { from: from(), to: { pos: [x + 6, 16, z + 20], target: [x, 0, z] }, t: 0, dur: DIVE_S, done: () => onDived(dive) };
    } else if (intro === "flying") {
      move.current = { from: from(), to: REST, t: 0, dur: FLY_S, done: () => {
        useOps.getState().setIntro("done");
        // the simulation starts on its own: fast through the quiet minutes, normal speed once something happens
        if (!useOps.getState().presentation.active && !rt.running) rt.skipToNextEvent(180, 30);
      } };
    }
  }, [intro, dive, controls, camera, rt, onDived]);

  useFrame((_, dt) => {
    if (!controls) return;
    const m = move.current;
    controls.enabled = !m && intro === "done";
    if (m) {
      m.t = Math.min(1, m.t + dt / m.dur);
      const k = ease(m.t);
      camera.position.set(...lerp3(m.from.pos, m.to.pos, k));
      controls.target.set(...lerp3(m.from.target, m.to.target, k));
      controls.update();
      if (m.t >= 1) { move.current = null; m.done(); }
    }
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      const d = camera.position.distanceTo(controls.target);
      fog.near = d * 1.1;
      fog.far = d * 2.7;
    }
  });
  return null;
}

export function NationalMap({ rt }: { rt: Runtime }) {
  const anchors = useMemo(() => new AnchorSet(), []);
  const [start] = useState(() => (useOps.getState().intro === "done" ? REST : WIDE));
  const [dive, setDive] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const pick = useCallback((icao: string) => { if (useOps.getState().intro === "done") setDive((d) => d ?? icao); }, []);
  const dived = useCallback((icao: string) => {
    setFading(true);
    // a short fade to the 3D view's background hides the switch between the two scenes
    setTimeout(() => { useOps.getState().setAirport(icao); useOps.getState().setView("twin"); }, 220);
  }, []);
  return (
    <div className="relative h-full w-full">
    <Canvas camera={{ position: start.pos, fov: 38, near: 1, far: 4000 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#0b1622"]} />
      <fog attach="fog" args={["#0b1622", 260, 620]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[60, 120, 40]} intensity={1.2} />
      <Land />
      {Object.keys(rt.airports).sort().map((icao) => <AirportMarker key={icao} rt={rt} icao={icao} onPick={pick} />)}
      <Traffic rt={rt} />
      <Arcs rt={rt} />
      <OrbitControls makeDefault target={start.target} maxPolarAngle={1.2} minDistance={60} maxDistance={420} enableDamping />
      <MapCamera rt={rt} dive={dive} onDived={dived} />
      <AnchorProjector set={anchors} />
    </Canvas>
    <div className="pointer-events-none absolute inset-0 overflow-hidden"><MapLabels rt={rt} anchors={anchors} onPick={pick} /></div>
    <div className={`pointer-events-none absolute inset-0 bg-[#0b1622] transition-opacity duration-200 ${fading ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
