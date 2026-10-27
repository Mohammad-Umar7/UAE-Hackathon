"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AirportInfo } from "@/core/airports/registry";
import { useOps } from "@/store/ops";
import { CROP_MARGIN } from "./Airfield";
import { fleetIndex } from "./Fleet";
import { cropRect, type P2 } from "./geometry";
import { twinState } from "./state";

type Controls = React.ComponentRef<typeof CameraControls>;

/** How low the camera may look: steep when it is far out, flatter close in (where the far ground stays near). */
const TILT_FAR = THREE.MathUtils.degToRad(56), TILT_NEAR = THREE.MathUtils.degToRad(62);
const NEAR_D = 350;

const probe = new THREE.PerspectiveCamera();
const ray = new THREE.Vector3();
const CORNERS: [number, number][] = [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]];

/**
 * How far from the point the camera looks at the visible ground reaches, per metre of camera distance, for a
 * camera tilted `polar` from straight down. The airfield is a tile, so this decides how close to its edge the
 * camera may look before the empty space beyond shows.
 */
function reach(polar: number, fov: number, aspect: number): number {
  probe.fov = fov;
  probe.aspect = aspect;
  probe.position.set(0, Math.cos(polar), Math.sin(polar));
  probe.lookAt(0, 0, 0);
  probe.updateMatrixWorld();
  probe.updateProjectionMatrix();
  let far = 0;
  for (const [x, y] of CORNERS) {
    ray.set(x, y, 0.5).unproject(probe).sub(probe.position);
    if (ray.y >= -1e-4) return Infinity; // looks over the horizon
    const t = -probe.position.y / ray.y;
    far = Math.max(far, Math.hypot(probe.position.x + ray.x * t, probe.position.z + ray.z * t));
  }
  return far;
}

/**
 * Camera presets per mode; transitions are smooth and never fight the user once settled. Zoom, tilt and pan stay
 * inside what the airfield tile covers, so the view is always full of airport.
 */
export function CameraRig({ ap, center, radius }: { ap: AirportInfo; center: P2; radius: number }) {
  const ref = useRef<Controls>(null);
  const mode = useOps((s) => s.camera);
  const selected = useOps((s) => s.selectedVisit);
  const selectedStand = useOps((s) => s.selectedStand);
  const setCamera = useOps((s) => s.setCamera);
  const { camera } = useThree();
  const tmp = useRef(new THREE.Vector3());

  // the tile the airfield is built on, and the furthest the camera may pull back from it (fitted to the window)
  const tile = useMemo(() => {
    const r = cropRect(ap.layout, ap, CROP_MARGIN);
    return { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, hw: (r.x1 - r.x0) / 2, hh: (r.y1 - r.y0) / 2 };
  }, [ap]);
  const maxDistance = () => {
    const pc = camera as THREE.PerspectiveCamera;
    return (0.96 * Math.min(tile.hw, tile.hh)) / reach(TILT_FAR, pc.fov, pc.aspect);
  };
  const bounds = useRef({ box: new THREE.Box3(), last: -1 });

  const rwHeading = ap.runwayEnds[ap.arrivalEnd]?.heading ?? 0;
  // the overview looks at the gates, where the aircraft are, from close enough to read them (the whole airfield,
  // runways included, was 4-5 km away); 80 % of the stands fit in the view
  const apron = useMemo(() => {
    const ss = Object.values(ap.stands);
    if (!ss.length) return { x: center[0], y: center[1], r: radius };
    const x = ss.reduce((a, s) => a + s.x, 0) / ss.length, y = ss.reduce((a, s) => a + s.y, 0) / ss.length;
    const ds = ss.map((s) => Math.hypot(s.x - x, s.y - y)).sort((a, b) => a - b);
    return { x, y, r: Math.max(320, ds[Math.floor(ds.length * 0.8)]) };
  }, [ap, center, radius]);

  // dragging pans across the ground like a map, rather than lifting the view into the sky
  useEffect(() => { if (ref.current) ref.current.verticalDragToForward = true; }, []);

  // presets (a freshly opened airport always starts from its strategic overview)
  const fresh = useRef(true);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dMax = maxDistance();
    c.maxDistance = dMax;
    const tx = center[0], tz = -center[1];
    const first = fresh.current;
    fresh.current = false;
    if (first && (mode === "inspect" || mode === "follow") && !useOps.getState().selectedVisit) {
      setCamera("strategic");
      return;
    }
    if (mode === "strategic" || (first && mode !== "topdown" && mode !== "cinematic")) {
      const az = ((rwHeading + 145) * Math.PI) / 180;
      const d = Math.min(THREE.MathUtils.clamp(apron.r * 1.45, 650, 2300), dMax * 0.97);
      const ax = apron.x, az2 = -apron.y;
      if (first) {
        // arriving from the national map: start straight above the airfield, as high as the tile allows, and
        // come down to the gates slowly
        c.setLookAt(ax, dMax, az2 + 1, ax, 0, az2, false);
        c.smoothTime = 1.1;
        const settle = () => { c.smoothTime = 0.45; c.removeEventListener("rest", settle); };
        c.addEventListener("rest", settle);
      }
      c.setLookAt(ax + Math.sin(az) * d * 0.78, d * 0.56, az2 - Math.cos(az) * d * 0.78, ax, 0, az2, true);
    } else if (mode === "topdown") {
      c.setLookAt(tx, Math.min(radius * 2.35, dMax), tz + 1, tx, 0, tz, true);
    } else if (mode === "cinematic") {
      // a slow orbit, as low as the tile allows at that distance
      const az = ((rwHeading + 200) * Math.PI) / 180;
      const d = Math.min(radius * 0.8, dMax * 0.9), polar = TILT_FAR;
      c.setLookAt(tx + Math.sin(az) * d * Math.sin(polar), d * Math.cos(polar), tz - Math.cos(az) * d * Math.sin(polar), tx, 20, tz, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, center, radius, rwHeading, ap.icao, setCamera, apron, tile]);

  // fly to a newly selected aircraft or stand; aircraft may appear a few frames later (assets loading)
  const pending = useRef<{ visit: string | null; stand: string | null } | null>(null);
  useEffect(() => {
    if (selected || selectedStand) pending.current = { visit: selected, stand: selectedStand };
  }, [selected, selectedStand]);

  const flyTo = (c: Controls, p: THREE.Vector3, span: number) => {
    const d = Math.max(90, span * 2.4);
    const dir = new THREE.Vector3().subVectors(camera.position, p).setY(0).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0.7, 0, 0.7);
    c.setLookAt(p.x + dir.x * d, p.y + d * 0.55, p.z + dir.z * d, p.x, p.y + 4, p.z, true);
  };

  useFrame((_, dt) => {
    const c = ref.current;
    if (!c) return;
    const want = pending.current;
    if (want) {
      if (want.visit) {
        const e = fleetIndex.get(want.visit);
        if (e) {
          pending.current = null;
          if (mode !== "follow") { flyTo(c, new THREE.Vector3(e.pose.x, e.pose.z, -e.pose.y), e.kit.bbox.max.x * 2); if (mode !== "inspect") setCamera("inspect"); }
        }
      } else if (want.stand) {
        pending.current = null;
        const st = ap.stands[want.stand];
        if (st) { flyTo(c, new THREE.Vector3(st.x, 0, -st.y), st.maxWingspan); if (mode !== "inspect" && mode !== "follow") setCamera("inspect"); }
      }
    }
    if (mode === "follow" && selected) {
      const e = fleetIndex.get(selected);
      if (e) c.moveTo(e.pose.x, e.pose.z + 4, -e.pose.y, true);
    } else if (mode === "cinematic") {
      c.rotate(dt * 0.035, 0, false);
    }

    // keep the view on the tile: the further out, the steeper the camera looks and the closer to the middle it
    // stays, so the edge of the airfield never comes into view
    // (measured where the camera is heading — scroll, drag and the presets set that — so a scripted move keeps its target)
    const pc = camera as THREE.PerspectiveCamera;
    const dMax = maxDistance();
    if (Math.abs(c.maxDistance - dMax) > 1) c.maxDistance = dMax;
    const end = (c as unknown as { _sphericalEnd: THREE.Spherical })._sphericalEnd;
    const tilt = THREE.MathUtils.lerp(TILT_NEAR, TILT_FAR, THREE.MathUtils.smoothstep(end.radius, NEAR_D, dMax));
    c.maxPolarAngle = tilt;
    const R = end.radius * reach(Math.min(end.phi, tilt), pc.fov, pc.aspect) * 1.03;
    // the reach assumes the camera looks at the ground: keep the target near it (a followed aircraft may climb)
    const top = mode === "follow" ? 2000 : 40;
    if (Math.abs(R - bounds.current.last) > 2 || bounds.current.box.max.y !== top) {
      bounds.current.last = R;
      const ix = Math.max(0, tile.hw - R), iy = Math.max(0, tile.hh - R);
      bounds.current.box.min.set(tile.cx - ix, -5, -(tile.cy + iy));
      bounds.current.box.max.set(tile.cx + ix, top, -(tile.cy - iy));
      c.setBoundary(bounds.current.box);
    }

    c.getTarget(tmp.current);
    twinState.target.copy(tmp.current);
    twinState.cameraDistance = c.distance;
    // depth precision: push the near plane out as the camera climbs
    const near = THREE.MathUtils.clamp(c.distance / 350, 0.6, 12);
    if (Math.abs(pc.near - near) / near > 0.15) { pc.near = near; pc.updateProjectionMatrix(); }
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={18}
      smoothTime={0.45}
      draggingSmoothTime={0.12}
      dollySpeed={0.7}
    />
  );
}
