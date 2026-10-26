"use client";

/**
 * DOM labels pinned to 3D positions without nested React roots (drei <Html> creates one root per
 * label, which React 19 refuses to unmount synchronously when the canvas is torn down).
 * Labels are ordinary React elements rendered next to the <Canvas>; a projector inside the canvas
 * moves them every frame by writing `style.transform`.
 */

import { useFrame } from "@react-three/fiber";
import { useCallback } from "react";
import * as THREE from "three";

export class AnchorSet {
  items = new Map<string, { pos: THREE.Vector3; el: HTMLElement }>();
  register(id: string, pos: [number, number, number], el: HTMLElement | null) {
    if (!el) { this.items.delete(id); return; }
    this.items.set(id, { pos: new THREE.Vector3(...pos), el });
  }
}

const v = new THREE.Vector3();

export function AnchorProjector({ set }: { set: AnchorSet }) {
  useFrame(({ camera, size }) => {
    for (const { pos, el } of set.items.values()) {
      v.copy(pos).project(camera);
      const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      el.style.display = visible ? "" : "none";
      if (!visible) continue;
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

/** A label anchored at `pos` (world units); children are positioned centred above the point. */
export function Anchor({ set, id, pos, children, className = "" }: {
  set: AnchorSet; id: string; pos: [number, number, number]; children: React.ReactNode; className?: string;
}) {
  const ref = useCallback((el: HTMLDivElement | null) => set.register(id, pos, el),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set, id, pos[0], pos[1], pos[2]]);
  return (
    <div ref={ref} className="absolute left-0 top-0" style={{ display: "none" }}>
      <div className={`-translate-x-1/2 -translate-y-1/2 ${className}`}>{children}</div>
    </div>
  );
}
