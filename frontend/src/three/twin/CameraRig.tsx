"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AirportInfo } from "@/core/airports/registry";
import { useOps } from "@/store/ops";
import { fleetIndex } from "./Fleet";
import type { P2 } from "./geometry";
import { twinState } from "./state";

type Controls = React.ComponentRef<typeof CameraControls>;

/** Camera presets per mode; transitions are smooth and never fight the user once settled. */
export function CameraRig({ ap, center, radius }: { ap: AirportInfo; center: P2; radius: number }) {
  const ref = useRef<Controls>(null);
  const mode = useOps((s) => s.camera);
  const selected = useOps((s) => s.selectedVisit);
  const selectedStand = useOps((s) => s.selectedStand);
  const setCamera = useOps((s) => s.setCamera);
  const { camera } = useThree();
  const tmp = useRef(new THREE.Vector3());

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

  // presets (a freshly opened airport always starts from its strategic overview)
  const fresh = useRef(true);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const tx = center[0], tz = -center[1];
    const first = fresh.current;
    fresh.current = false;
    if (first && (mode === "inspect" || mode === "follow") && !useOps.getState().selectedVisit) {
      setCamera("strategic");
      return;
    }
    if (mode === "strategic" || (first && mode !== "topdown" && mode !== "cinematic")) {
      const az = ((rwHeading + 145) * Math.PI) / 180;
      const d = THREE.MathUtils.clamp(apron.r * 1.45, 650, 2300);
      const ax = apron.x, az2 = -apron.y;
      c.setLookAt(ax + Math.sin(az) * d * 0.78, d * 0.56, az2 - Math.cos(az) * d * 0.78, ax, 0, az2, true);
    } else if (mode === "topdown") {
      c.setLookAt(tx, radius * 2.35, tz + 1, tx, 0, tz, true);
    } else if (mode === "cinematic") {
      const az = ((rwHeading + 200) * Math.PI) / 180;
      const d = radius * 0.8;
      c.setLookAt(tx + Math.sin(az) * d, radius * 0.18, tz - Math.cos(az) * d, tx, 20, tz, true);
    }
  }, [mode, center, radius, rwHeading, ap.icao, setCamera, apron]);

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
    c.getTarget(tmp.current);
    twinState.target.copy(tmp.current);
    twinState.cameraDistance = c.distance;
    // depth precision: push the near plane out as the camera climbs
    const pc = camera as THREE.PerspectiveCamera;
    const near = THREE.MathUtils.clamp(c.distance / 350, 0.6, 12);
    if (Math.abs(pc.near - near) / near > 0.15) { pc.near = near; pc.updateProjectionMatrix(); }
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={18}
      maxDistance={radius * 6}
      maxPolarAngle={Math.PI * 0.485}
      smoothTime={0.45}
      draggingSmoothTime={0.12}
      dollySpeed={0.7}
    />
  );
}
