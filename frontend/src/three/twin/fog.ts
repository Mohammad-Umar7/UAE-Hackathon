/**
 * Height-dependent fog for the digital twin, installed into three.js's shared shader chunks.
 *
 * Radiation fog is a shallow layer: from a tower or an aircraft above it the airfield still shows
 * through, while at ground level visibility drops to a few hundred metres. The twin reuses the
 * uniforms of a linear `THREE.Fog` to carry two densities without touching every material:
 *   fog.near  < 1  → ground-fog extinction coefficient at the surface (1/m), decaying with height
 *   fog.far   < 1  → uniform haze extinction coefficient (1/m)
 * A `THREE.Fog` with near >= 1 (the national map) keeps the classic linear behaviour.
 */

import * as THREE from "three";

/** e-folding height of the fog layer in metres. */
export const FOG_LAYER_M = 28;

let installed = false;

export function installHeightFog(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // view space → world space with the transposed view rotation (works for every shader that has mvPosition)
  vFogWorldPos = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor;
    if ( fogNear >= 1.0 ) {
      fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    } else {
      vec3 fogRay = vFogWorldPos - cameraPosition;
      float fogLen = length( fogRay );
      float yc = max( cameraPosition.y, 0.0 );
      float yf = max( vFogWorldPos.y, 0.0 );
      float dy = yf - yc;
      float ec = exp( - yc / ${FOG_LAYER_M.toFixed(1)} );
      float ef = exp( - yf / ${FOG_LAYER_M.toFixed(1)} );
      float avgDensity = abs( dy ) > 0.05 ? ( ec - ef ) * ${FOG_LAYER_M.toFixed(1)} / dy : ec;
      float optical = fogNear * fogLen * avgDensity + fogFar * fogLen;
      fogFactor = 1.0 - exp( - optical );
    }
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

/**
 * Visibility (m) → surface extinction coefficient. Koschmieder gives 3.912 / V; the twin uses a
 * slightly lower value so that aircraft remain readable in the 3D view during low-visibility ops.
 */
export function groundFogDensity(visibility: number, fog: number): number {
  if (fog <= 0.01 && visibility >= 8000) return 0;
  return Math.min(0.035, 3.0 / Math.max(80, visibility)) * Math.min(1, 0.3 + fog);
}

/**
 * Background haze. Radiation fog is shallow, so above the layer the air stays fairly clear:
 * haze only follows the reported visibility when there is no ground fog to explain it.
 */
export function hazeDensity(visibility: number, fog: number): number {
  const v = fog > 0.4 ? 9000 : visibility;
  return 0.9 / Math.max(6000, Math.min(60000, v * 4));
}
