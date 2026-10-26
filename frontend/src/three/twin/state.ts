/**
 * Per-frame shared state of the digital twin (written by the atmosphere/ops readers, read by
 * materials and layers). Kept outside React so 60 fps updates never trigger re-renders.
 */

import * as THREE from "three";

export const twinState = {
  /** 0 = full daylight, 1 = night (civil twilight blends). */
  night: 0,
  /** 0 = dry, 1 = soaked pavement. */
  wetness: 0,
  /** Low-visibility procedures in force (stop bars lit). */
  lvp: false,
  closedRunways: new Set<string>(),
  sunDir: new THREE.Vector3(0, 1, 0),
  /** Camera orbit target (layout-independent, three.js coords). */
  target: new THREE.Vector3(),
  cameraDistance: 1500,
  simTime: 0,
};
