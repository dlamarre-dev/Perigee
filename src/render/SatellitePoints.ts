/**
 * All satellites as a single THREE.Points draw call. Positions are TEME (km) samples A and B produced by the
 * SGP4 workers; the vertex shader moves each object along its orbit from them at render time (two-body Lagrange
 * f and g series from each sample, blended between them, src/astro/lagrangeSeries.ts), so the CPU only uploads
 * new buffers when a propagation finishes.
 *
 * A twin Points object on layer 1 shares the geometry and uniforms and renders index-encoded colours for
 * GPU picking (CLAUDE.md §7).
 */
import { BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3, type IUniform } from 'three';
import { GM_KM3_S2 } from '../astro/kepler';
import { BLEND_END, BLEND_START, SERIES_LIMIT } from '../astro/lagrangeSeries';
import { PIXEL_RATIO_UNIFORM } from './pixelRatio';
import type { Interpolation } from '../earth/SampleTimeline';

const glslFloat = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const PICK_LAYER = 1;

/** Per-object display state. */
export const SatState = { Hidden: 0, Normal: 1, Stale: 2 } as const;

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 posA;
  attribute vec3 posALow;
  attribute vec3 velA;
  attribute vec3 posB;
  attribute vec3 posBLow;
  attribute vec3 velB;
  uniform vec3 uCamHigh;
  uniform vec3 uCamLow;
  attribute float valid;
  attribute float state;
  attribute vec3 color;
  attribute vec3 pickColor;
  uniform float uTau;
  uniform float uDtA;
  uniform float uDtB;
  uniform float uSize;
  uniform float uPixelRatio;
  varying vec3 vColor;

  // Mirror of src/astro/lagrangeSeries.ts (tested there): offset (f − 1)·r + g·v from a TEME state after dt.
  vec3 seriesOffset(vec3 r, vec3 v, float dt) {
    float r2 = dot(r, r);
    float u = ${glslFloat(GM_KM3_S2.earth)} / (r2 * sqrt(r2));
    float p = dot(r, v) / r2;
    float v2r2 = dot(v, v) / r2;
    float q = v2r2 - u;
    float limit = ${glslFloat(SERIES_LIMIT)} / sqrt(max(u, v2r2));
    float t = clamp(dt, -limit, limit);
    float t2 = t * t;
    float t3 = t2 * t;
    float t4 = t3 * t;
    float t5 = t4 * t;
    float fm1 = -0.5 * u * t2 + 0.5 * u * p * t3 + (3.0 * u * q - 15.0 * u * p * p + u * u) * t4 / 24.0
      + (7.0 * u * p * p * p - 3.0 * u * p * q - u * u * p) * t5 / 8.0;
    float g = t - u * t3 / 6.0 + 0.25 * u * p * t4 + (9.0 * u * q - 45.0 * u * p * p + u * u) * t5 / 120.0;
    return fm1 * r + g * v;
  }

  void main() {
    if (valid < 0.5 || state < 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    // Relative to the camera (TEME), with the high/low split: exact near the camera, no Float32 jitter.
    vec3 rA = (posA - uCamHigh) + (posALow - uCamLow);
    vec3 rB = (posB - uCamHigh) + (posBLow - uCamLow);
    // Along the orbit from each sample (the offsets use the Earth-centred position, the result stays
    // camera-relative), blended in the middle of [A, B]; beyond B (a late sample) or before A, from the nearest.
    float w = smoothstep(${glslFloat(BLEND_START)}, ${glslFloat(BLEND_END)}, uTau);
    vec3 p;
    if (w <= 0.0) {
      p = rA + seriesOffset(posA + posALow, velA, uDtA);
    } else if (w >= 1.0) {
      p = rB + seriesOffset(posB + posBLow, velB, uDtB);
    } else {
      p = mix(rA + seriesOffset(posA + posALow, velA, uDtA), rB + seriesOffset(posB + posBLow, velB, uDtB), w);
    }
    // The group's rotation only (TEME → scene); its translation is the camera offset handled above.
    gl_Position = projectionMatrix * viewMatrix * vec4(mat3(modelMatrix) * p, 1.0);
    #include <logdepthbuf_vertex>
    bool stale = state > 1.5;
    #ifdef PICKING
      vColor = pickColor;
      gl_PointSize = uSize;
    #else
      // Visual honesty: stale elements are drawn smaller and dimmer.
      vColor = stale ? color * 0.4 : color;
      gl_PointSize = (stale ? uSize * 0.8 : uSize) * uPixelRatio;
    #endif
  }
`;

const fragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vColor, 1.0);
    #ifndef PICKING
      #include <colorspace_fragment>
    #endif
  }
`;

interface SatUniforms {
  [name: string]: IUniform<number> | IUniform<Vector3>;
  uCamHigh: IUniform<Vector3>;
  uCamLow: IUniform<Vector3>;
  uTau: IUniform<number>;
  uDtA: IUniform<number>;
  uDtB: IUniform<number>;
  uSize: IUniform<number>;
  uPixelRatio: IUniform<number>;
}

export function encodePickId(index: number, out: Uint8Array, offset: number): void {
  const id = index + 1;
  out[offset] = id & 0xff;
  out[offset + 1] = (id >> 8) & 0xff;
  out[offset + 2] = (id >> 16) & 0xff;
}

/** Inverse of encodePickId; undefined for background (0). */
export function decodePickId(r: number, g: number, b: number): number | undefined {
  const id = r | (g << 8) | (b << 16);
  return id === 0 ? undefined : id - 1;
}

export class SatellitePoints {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly pickPoints: Points<BufferGeometry, ShaderMaterial>;
  readonly count: number;
  private readonly geometry = new BufferGeometry();
  private readonly uniforms: SatUniforms = {
    uTau: { value: 0 },
    uDtA: { value: 0 },
    uDtB: { value: 0 },
    uSize: { value: 3 },
    uPixelRatio: PIXEL_RATIO_UNIFORM,
    uCamHigh: { value: new Vector3() },
    uCamLow: { value: new Vector3() },
  };

  constructor(count: number) {
    this.count = count;
    const vec3Attr = (): BufferAttribute => new BufferAttribute(new Float32Array(count * 3), 3);
    const posB = vec3Attr();
    this.geometry.setAttribute('posA', vec3Attr());
    this.geometry.setAttribute('posALow', vec3Attr());
    this.geometry.setAttribute('posBLow', vec3Attr());
    this.geometry.setAttribute('velA', vec3Attr());
    this.geometry.setAttribute('posB', posB);
    this.geometry.setAttribute('velB', vec3Attr());
    // Three.js needs a `position` attribute to know the draw count.
    this.geometry.setAttribute('position', posB);
    this.geometry.setAttribute('valid', new BufferAttribute(new Float32Array(count), 1));
    this.geometry.setAttribute('state', new BufferAttribute(new Float32Array(count).fill(1), 1));
    this.geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3).fill(0.8), 3));
    const pick = new Uint8Array(count * 3);
    for (let i = 0; i < count; i++) encodePickId(i, pick, i * 3);
    this.geometry.setAttribute('pickColor', new BufferAttribute(pick, 3, true));

    // CSS pixels, scaled by the shared pixel ratio in the shader.
    this.uniforms.uSize.value = 3;
    this.points = new Points(
      this.geometry,
      new ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader }),
    );
    this.points.name = 'satellites';
    this.points.frustumCulled = false;

    // The pick pass shares the interpolation uniforms but uses a fixed, generous point size.
    const pickUniforms: SatUniforms = { ...this.uniforms, uSize: { value: 7 } };
    this.pickPoints = new Points(
      this.geometry,
      new ShaderMaterial({
        uniforms: pickUniforms,
        vertexShader,
        fragmentShader,
        defines: { PICKING: '' },
      }),
    );
    this.pickPoints.name = 'satellites-pick';
    this.pickPoints.frustumCulled = false;
    this.pickPoints.layers.set(PICK_LAYER);
  }

  /** Uploads samples A and B (TEME km, km/s) and their validity. */
  setSamples(
    a: { pos: Float32Array; posLow: Float32Array; vel: Float32Array; ok: Uint8Array },
    b: { pos: Float32Array; posLow: Float32Array; vel: Float32Array; ok: Uint8Array },
  ): void {
    this.write('posA', a.pos);
    this.write('posALow', a.posLow);
    this.write('posBLow', b.posLow);
    this.write('velA', a.vel);
    this.write('posB', b.pos);
    this.write('velB', b.vel);
    const valid = this.attr('valid');
    const arr = valid.array as Float32Array;
    for (let i = 0; i < this.count; i++) arr[i] = a.ok[i] && b.ok[i] ? 1 : 0;
    valid.needsUpdate = true;
  }

  setInterpolation(i: Interpolation): void {
    this.uniforms.uTau.value = i.tau;
    this.uniforms.uDtA.value = i.dtAS;
    this.uniforms.uDtB.value = i.dtBS;
  }

  /** Camera position in TEME (km, Float64), split into Float32 high and low parts for the shader. */
  setCamera(cameraTemeKm: readonly number[]): void {
    const h = this.uniforms.uCamHigh.value;
    const l = this.uniforms.uCamLow.value;
    const x = cameraTemeKm[0] ?? 0;
    const y = cameraTemeKm[1] ?? 0;
    const z = cameraTemeKm[2] ?? 0;
    h.set(Math.fround(x), Math.fround(y), Math.fround(z));
    l.set(x - h.x, y - h.y, z - h.z);
  }

  /** Per-object state (SatState values). */
  setStates(states: Float32Array): void {
    this.write('state', states);
  }

  /** Per-object linear RGB colours. */
  setColors(colors: Float32Array): void {
    this.write('color', colors);
  }

  dispose(): void {
    this.geometry.dispose();
    this.points.material.dispose();
    this.pickPoints.material.dispose();
  }

  private attr(name: string): BufferAttribute {
    const a = this.geometry.getAttribute(name);
    if (!(a instanceof BufferAttribute)) throw new Error(`Missing attribute ${name}`);
    return a;
  }

  private write(name: string, data: Float32Array): void {
    const a = this.attr(name);
    (a.array as Float32Array).set(data);
    a.needsUpdate = true;
  }
}
