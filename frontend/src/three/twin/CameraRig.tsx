"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
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

  // presets
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const tx = center[0], tz = -center[1];
    if (mode === "strategic") {
      const az = ((rwHeading + 145) * Math.PI) / 180;
      const d = radius * 1.55;
      c.setLookAt(tx + Math.sin(az) * d * 0.75, d * 0.62, tz - Math.cos(az) * d * 0.75, tx, 0, tz, true);
    } else if (mode === "topdown") {
      c.setLookAt(tx, radius * 2.35, tz + 1, tx, 0, tz, true);
    } else if (mode === "cinematic") {
      const az = ((rwHeading + 200) * Math.PI) / 180;
      const d = radius * 0.8;
      c.setLookAt(tx + Math.sin(az) * d, radius * 0.18, tz - Math.cos(az) * d, tx, 20, tz, true);
    }
  }, [mode, center, radius, rwHeading, ap.icao]);

  // fly to a newly selected aircraft or stand (inspect), or lock on (follow)
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let p: THREE.Vector3 | null = null;
    let span = 60;
    if (selected) {
      const e = fleetIndex.get(selected);
      if (e) { p = new THREE.Vector3(e.pose.x, e.pose.z, -e.pose.y); span = e.kit.bbox.max.x * 2; }
    } else if (selectedStand) {
      const st = ap.stands[selectedStand];
      if (st) { p = new THREE.Vector3(st.x, 0, -st.y); span = st.maxWingspan; }
    }
    if (!p) return;
    if (mode !== "follow") {
      const d = Math.max(90, span * 2.4);
      const dir = new THREE.Vector3().subVectors(camera.position, p).setY(0).normalize();
      if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0.7, 0, 0.7);
      c.setLookAt(p.x + dir.x * d, p.y + d * 0.55, p.z + dir.z * d, p.x, p.y + 4, p.z, true);
      if (mode !== "inspect") setCamera("inspect");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedStand]);

  useFrame((_, dt) => {
    const c = ref.current;
    if (!c) return;
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
