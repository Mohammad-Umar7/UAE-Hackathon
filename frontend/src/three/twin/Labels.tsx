"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { AirportInfo } from "@/core/airports/registry";
import type { Visit } from "@/core/types";
import { callsignOf } from "@/core/world";
import { useOps } from "@/store/ops";
import { fleetIndex } from "./Fleet";
import { planMarks } from "./Overlays";
import { twinState } from "./state";

type Tone = "move" | "stand" | "alert" | "hold" | "plan" | "dep";
const TONE: Record<Tone, string> = { move: "#35c2a5", stand: "#8fb3ff", alert: "#ff6b5e", hold: "#f2a93b", plan: "#b49bff", dep: "#5aa7ff" };

function describe(v: Visit, kind: string): [string, Tone] {
  const tech = v.techHoldUntil !== null && v.techHoldUntil > twinState.simTime;
  switch (v.phase) {
    case "APPROACH": return [`final · ${v.stand ?? "no stand"}`, "move"];
    case "LANDING": return ["landing roll", "move"];
    case "TAXI_IN": return [`taxi in → ${v.stand ?? "hold"}`, "move"];
    case "WAITING_STAND": return [`waiting for stand ${v.stand ?? ""}`.trim(), "alert"];
    case "ON_STAND": return [tech ? `tech hold · ${v.stand}` : `${v.stand}${v.prm ? ` · PRM ${v.prm}` : ""}`, tech ? "alert" : "stand"];
    case "READY": return [`ready · ${v.stand}`, "dep"];
    case "PUSHBACK": return ["pushback", "dep"];
    case "TAXI_OUT": return [kind === "hold" || kind === "pivot" ? "holding short" : "taxi out", "dep"];
    case "TAKEOFF": return [kind === "climb" ? "climbing" : "take-off roll", "dep"];
    case "TOWING": return [`tow → ${v.plannedTow?.[1] ?? ""}`.trim(), "hold"];
    case "HOLDING": return [`holding · +${Math.round(v.airborneHold / 60)} min`, "hold"];
    default: return [v.phase.toLowerCase(), "stand"];
  }
}

interface Item { x: number; y: number; ax: number; ay: number; title: string; sub: string; tone: Tone; pri: number; sel: boolean }

/** Screen-space labels drawn on a 2D canvas over the WebGL view (fast, crisp, decluttered). */
export function Labels({ ap, canvas }: { ap: AirportInfo; canvas: React.RefObject<HTMLCanvasElement | null> }) {
  const labels = useOps((s) => s.overlays.labels);
  const standsOn = useOps((s) => s.overlays.stands);
  const selected = useOps((s) => s.selectedVisit);
  // simple mode labels only what is happening (moving, waiting, in trouble, being re-planned), never every parked aircraft
  const expert = useOps((s) => s.detail === "expert");
  const { size } = useThree();
  const v3 = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const cv = canvas.current;
    return () => { cv?.getContext("2d")?.clearRect(0, 0, cv.width, cv.height); };
  }, [canvas]);

  useFrame(({ camera }) => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = size.width, H = size.height;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const project = (x: number, y: number, z: number): [number, number] | null => {
      v3.set(x, y, z).project(camera);
      if (v3.z > 1 || v3.z < -1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) return null;
      return [(v3.x * 0.5 + 0.5) * W, (-v3.y * 0.5 + 0.5) * H];
    };
    const camPos = camera.position;
    const placed: [number, number, number, number][] = [];
    const free = (x: number, y: number, w: number, h: number) => {
      for (const r of placed) if (x < r[0] + r[2] + 2 && x + w + 2 > r[0] && y < r[1] + r[3] + 2 && y + h + 2 > r[1]) return false;
      placed.push([x, y, w, h]);
      return true;
    };

    // stand ids when close enough to read them
    if (standsOn && twinState.cameraDistance < 1400) {
      g.font = `600 10px "Inter Variable", Inter, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      for (const st of Object.values(ap.stands)) {
        const s = project(st.x, 0.5, -st.y);
        if (!s) continue;
        const w = g.measureText(st.id).width + 8;
        if (!free(s[0] - w / 2, s[1] - 7, w, 14)) continue;
        g.fillStyle = "rgba(10,16,24,0.55)";
        roundRect(g, s[0] - w / 2, s[1] - 7, w, 14, 3);
        g.fill();
        g.fillStyle = "rgba(230,236,244,0.92)";
        g.fillText(st.id, s[0], s[1] + 0.5);
      }
      placed.length = 0;
    }

    const items: Item[] = [];
    for (const [id, e] of fleetIndex) {
      const sel = id === selected;
      if (!labels && !sel) continue;
      const { pose, kit, visit } = e;
      const d = Math.hypot(pose.x - camPos.x, pose.z - camPos.y, -pose.y - camPos.z);
      if (!sel && d > 9000) continue;
      v3.set(0, kit.bbox.max.y + 3, kit.bbox.max.z * 0.82).applyMatrix4(e.matrix);
      const a = project(v3.x, v3.y, v3.z);
      if (!a) continue;
      const [sub, tone] = describe(visit, pose.kind);
      if (!expert && !sel && tone === "stand") continue;
      const pri = (sel ? 1e6 : 0) + (tone === "alert" ? 5e4 : tone === "hold" ? 3e4 : tone === "move" || tone === "dep" ? 2e4 : 0) - d;
      items.push({ x: a[0], y: a[1] - 26, ax: a[0], ay: a[1], title: callsignOf(visit), sub: `${visit.type.toUpperCase()} · ${sub}`, tone, pri, sel });
    }
    for (const m of planMarks) {
      const a = project(m.x, m.y, m.z);
      if (a) items.push({ x: a[0], y: a[1] - 10, ax: a[0], ay: a[1], title: m.text, sub: expert ? (m.approved ? "approved plan" : "proposed by the planning agent") : m.approved ? "approved move" : "planned move", tone: "plan", pri: 4e4, sel: false });
    }
    items.sort((p, q) => q.pri - p.pri);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    let shown = 0;
    for (const it of items) {
      if (!expert && !it.sel && shown >= 12) break;
      g.font = `650 ${it.sel ? 12.5 : 11.5}px "Inter Variable", Inter, sans-serif`;
      const tw = g.measureText(it.title).width;
      g.font = `500 10px "Inter Variable", Inter, sans-serif`;
      const sw = g.measureText(it.sub).width;
      const w = Math.max(tw, sw) + 18, h = it.sel ? 34 : 31;
      const x = Math.round(it.x - w / 2), y = Math.round(it.y - h);
      if (!free(x, y, w, h)) continue;
      shown++;
      const col = TONE[it.tone];
      g.strokeStyle = col;
      g.globalAlpha = 0.85;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(it.ax, it.ay);
      g.lineTo(it.x, y + h);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = it.sel ? "rgba(18,26,38,0.95)" : "rgba(12,18,28,0.82)";
      roundRect(g, x, y, w, h, 5);
      g.fill();
      g.fillStyle = col;
      g.fillRect(x, y + 4, 3, h - 8);
      if (it.sel) { g.strokeStyle = "#ffffff"; g.lineWidth = 1.2; roundRect(g, x, y, w, h, 5); g.stroke(); }
      g.fillStyle = "#f2f5f9";
      g.font = `650 ${it.sel ? 12.5 : 11.5}px "Inter Variable", Inter, sans-serif`;
      g.fillText(it.title, x + 9, y + 14);
      g.fillStyle = "rgba(214,224,236,0.78)";
      g.font = `500 10px "Inter Variable", Inter, sans-serif`;
      g.fillText(it.sub, x + 9, y + h - 7);
    }
  });
  return null;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Click to select an aircraft (oriented bounding boxes) or a stand (ground hit). Drags are ignored. */
export function Picker({ ap }: { ap: AirportInfo }) {
  const { gl, camera } = useThree();
  const select = useOps((s) => s.select);
  useEffect(() => {
    const el = gl.domElement;
    let down: [number, number] | null = null;
    const ray = new THREE.Raycaster();
    const inv = new THREE.Matrix4(), local = new THREE.Ray(), box = new THREE.Box3(), hit = new THREE.Vector3();
    const onDown = (e: PointerEvent) => { down = e.button === 0 ? [e.clientX, e.clientY] : null; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }
      down = null;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      let best: string | null = null, bestT = Infinity;
      for (const [id, en] of fleetIndex) {
        inv.copy(en.matrix).invert();
        local.copy(ray.ray).applyMatrix4(inv);
        box.copy(en.kit.bbox).expandByScalar(1.5);
        if (!local.intersectBox(box, hit)) continue;
        const t = hit.applyMatrix4(en.matrix).distanceTo(ray.ray.origin);
        if (t < bestT) { bestT = t; best = id; }
      }
      if (best) { select({ selectedVisit: best, selectedStand: null }); return; }
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return;
      const x = p.x, y = -p.z;
      let bs: string | null = null, bd = Infinity;
      for (const st of Object.values(ap.stands)) {
        const h = (st.heading * Math.PI) / 180;
        const cx = st.x - Math.sin(h) * 22, cy = st.y - Math.cos(h) * 22;
        const dd = Math.hypot(cx - x, cy - y);
        if (dd < Math.max(26, st.maxWingspan * 0.55) && dd < bd) { bd = dd; bs = st.id; }
      }
      select({ selectedStand: bs, selectedVisit: null });
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => { el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); };
  }, [gl, camera, ap, select]);
  return null;
}
