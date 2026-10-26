/**
 * Point-light sprites (runway, approach, taxi and aircraft lights) rendered as additive glow points.
 * Sizes are in metres with perspective attenuation and a pixel floor, so distant lights still read.
 * Brightness > 1 feeds the bloom pass at night. Fog uses the shared height-fog chunk.
 */

import * as THREE from "three";
import { LIGHT_GROUPS, type LightSet } from "./geometry";

const vertexCommon = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  uniform float uScale;
  uniform float uMinPx;
  uniform float uScatter;
  varying vec3 vColor;
  varying float vGain;
  #include <common>
  #include <fog_pars_vertex>
`;

const fragment = /* glsl */ `
  uniform float uScatter;
  varying vec3 vColor;
  varying float vGain;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot( c, c );
    if ( r2 > 1.0 || vGain <= 0.001 ) discard;
    // sprites are enlarged by uScatter in fog: keep the core small, widen the halo (Mie scattering look)
    float coreK = 18.0 * ( 1.0 + uScatter * 6.0 );
    float core = exp( - r2 * coreK );
    float halo = exp( - r2 * mix( 3.2, 1.6, uScatter ) ) * mix( 0.35, 0.55, uScatter );
    vec3 lit = vColor * vGain * ( core * 2.2 + halo );
    gl_FragColor = vec4( lit, 1.0 );
    // additive sprites: fog only attenuates them (mixing toward the fog colour would paint discs)
    #ifdef USE_FOG
      #include <fog_fragment>
      gl_FragColor.rgb = lit * ( 1.0 - fogFactor * mix( 0.9, 0.55, uScatter ) );
    #endif
  }
`;

function baseUniforms() {
  return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 800 }, uMinPx: { value: 2 }, uTime: { value: 0 }, uScatter: { value: 0 } }]);
}

/** Static airfield lights; gain per group and flashing computed on the GPU. */
export function airfieldLightMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([baseUniforms(), {
      uGroupGain: { value: new Array(LIGHT_GROUPS.length).fill(1) },
      uRunwayOff: { value: [0, 0, 0, 0] },
    }]),
    vertexShader: /* glsl */ `
      ${vertexCommon}
      attribute float group;
      attribute float phase;
      attribute float runway;
      uniform float uTime;
      uniform float uGroupGain[${LIGHT_GROUPS.length}];
      uniform float uRunwayOff[4];
      void main() {
        vColor = color;
        int gi = int( group + 0.5 );
        float gain = uGroupGain[ gi ];
        int ri = int( runway + 0.5 );
        if ( runway > -0.5 && ri < 4 && uRunwayOff[ ri ] > 0.5 && gi != 3 ) gain = 0.0;
        if ( phase > -0.5 ) {
          if ( gi == 1 ) gain *= step( fract( uTime * 2.0 - phase ), 0.07 ) * 3.0;  // sequenced flashers
          else gain *= step( fract( uTime * 0.9 + phase ), 0.5 );                // wig-wag guard lights
        }
        vGain = gain;
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = max( uMinPx, size * ( 1.0 + 2.5 * uScatter ) * uScale / max( 1.0, - mvPosition.z ) );
        gl_PointSize = min( gl_PointSize, 64.0 );
        #include <fog_vertex>
      }
    `,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

export function airfieldLightGeometry(L: LightSet): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(L.positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(L.colors, 3));
  g.setAttribute("size", new THREE.Float32BufferAttribute(L.sizes, 1));
  g.setAttribute("group", new THREE.Float32BufferAttribute(L.groups, 1));
  g.setAttribute("phase", new THREE.Float32BufferAttribute(L.phases, 1));
  g.setAttribute("runway", new THREE.Float32BufferAttribute(L.runway, 1));
  g.computeBoundingSphere();
  return g;
}

/** Dynamic lights (aircraft): CPU writes position, colour, size and gain every frame. */
export class DynamicLights {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private gain: Float32Array;
  n = 0;

  constructor(public capacity: number) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.gain = new Float32Array(capacity);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("gain", new THREE.BufferAttribute(this.gain, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: baseUniforms(),
      vertexShader: /* glsl */ `
        ${vertexCommon}
        attribute float gain;
        void main() {
          vColor = color;
          vGain = gain;
          vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp( size * ( 1.0 + 2.0 * uScatter ) * uScale / max( 1.0, - mvPosition.z ), uMinPx, 64.0 );
          #include <fog_vertex>
        }
      `,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  reset(): void { this.n = 0; }

  push(x: number, y: number, z: number, rgb: readonly number[], size: number, gain: number): void {
    if (this.n >= this.capacity || gain <= 0) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = rgb[0]; this.col[i * 3 + 1] = rgb[1]; this.col[i * 3 + 2] = rgb[2];
    this.size[i] = size;
    this.gain[i] = gain;
  }

  commit(): void {
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const k of ["position", "color", "size", "gain"]) {
      const a = g.getAttribute(k) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n) * a.itemSize);
      a.needsUpdate = true;
    }
  }

  get material(): THREE.ShaderMaterial { return this.points.material as THREE.ShaderMaterial; }
}

/** Pixel scale for size-in-metres points: viewport height / (2 tan(fov/2)). */
export function pointScale(camera: THREE.Camera, heightPx: number): number {
  const pc = camera as THREE.PerspectiveCamera;
  return heightPx / (2 * Math.tan(((pc.fov ?? 45) * Math.PI) / 360));
}
