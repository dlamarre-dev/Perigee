import {
  AdditiveBlending,
  Color,
  Group,
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Points,
  ShaderMaterial,
} from 'three';
import type { Vec3 } from '../astro/vec3';
import { setLinePositions } from './lineBuffers';
import { PIXEL_RATIO_UNIFORM } from './pixelRatio';

/**
 * Orbit trace of the selected object, in the inertial (TEME) group: the far part (`line`, rebuilt now and then)
 * and the stretch around the object (`near`, rebuilt every frame relative to it, so the line passes through the
 * object at any zoom). Each is positioned by the caller at the point its vertices are relative to.
 */
export class OrbitLine {
  readonly line: Line<BufferGeometry, LineBasicMaterial>;
  readonly near: Line<BufferGeometry, LineBasicMaterial>;

  constructor(color = 0x6cb4ff) {
    this.line = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.line.name = 'orbit';
    this.line.frustumCulled = false;
    // After the Earth's cloud layer (renderOrder 1, transparent, no depth writes): drawn before it, the line was
    // blended under the clouds, which lie far below every orbit.
    this.line.renderOrder = 2;
    this.line.visible = false;
    this.near = new Line(new BufferGeometry(), this.line.material);
    this.near.name = 'orbit';
    this.near.frustumCulled = false;
    this.near.renderOrder = 2;
    this.near.visible = false;
  }

  /** Far part: packed xyz positions (km, TEME). Pass undefined to hide the whole trace. */
  set(positionsKm: Float32Array | undefined): void {
    if (!positionsKm) {
      this.line.visible = false;
      this.near.visible = false;
      return;
    }
    setLinePositions(this.line, positionsKm);
    this.line.visible = true;
  }

  /** Stretch around the object: packed xyz positions (km, TEME). */
  setNear(positionsKm: Float32Array | undefined): void {
    if (!positionsKm) {
      this.near.visible = false;
      return;
    }
    setLinePositions(this.near, positionsKm);
    this.near.visible = this.line.visible;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.near.geometry.dispose();
    this.line.material.dispose();
  }
}

/** Largest pulse of the selection reticle (scale of its base size). */
const PULSE = 0.22;

const markerVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uSize;
  uniform float uPixelRatio;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
    // A fixed, whole number of pixels holding the largest pulse: the pulse is drawn in the fragment shader, since
    // a point size changing by fractions of a pixel made the hard-edged shape jitter.
    gl_PointSize = floor(uSize * ${(1 + PULSE).toFixed(2)} * uPixelRatio + 0.5);
  }
`;

const markerFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  void main() {
    #include <logdepthbuf_fragment>
    // Gentle pulse so the selection stands out: coordinates in units of the reticle's current size.
    float k = (1.0 + ${PULSE.toFixed(2)} * sin(uTime * 5.0)) / ${(1 + PULSE).toFixed(2)};
    vec2 p = abs(gl_PointCoord - 0.5) / k;
    // HUD target reticle around the waypoint markers: a diamond outline kept only at its four corners, four
    // chevrons pointing at the object; anti-aliased edges.
    float d = p.x + p.y;
    float m = max(p.x, p.y);
    float aa = fwidth(d);
    float a = smoothstep(0.39 - aa, 0.39 + aa, d) * (1.0 - smoothstep(0.5 - aa, 0.5 + aa, d))
      * smoothstep(0.3 - aa, 0.3 + aa, m);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, uOpacity * a);
    #include <colorspace_fragment>
  }
`;

/** Shared by every selection ring (one clock for all). */
const PULSE_TIME = { value: 0 };
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Reticle ("ring") around the selected object; its position is computed exactly on the CPU each frame.
 * Two passes share the geometry: a full ring where the object is visible, and a faint one drawn through
 * the Earth so the selection is never lost when it passes behind the globe.
 * Surface mode (sites on a body): a single pass without depth test — a flat sprite on a curved surface would
 * otherwise sink into it at grazing angles — hidden by the caller when the body occludes it (`setOccluded`),
 * exactly like the site markers.
 */
export class SelectionMarker {
  readonly points: Group;
  private readonly position = new Float32Array(3);
  private readonly geometry = new BufferGeometry();
  private placed = false;
  private occluded = false;

  constructor(options: { surface?: boolean } = {}) {
    this.geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    const ring = (opacity: number, depthTest: boolean, renderOrder: number): Points => {
      const p = new Points(
        this.geometry,
        new ShaderMaterial({
          uniforms: {
            uSize: { value: 24 },
            uPixelRatio: PIXEL_RATIO_UNIFORM,
            uTime: PULSE_TIME,
            uColor: { value: new Color(1, 0.82, 0.3) },
            uOpacity: { value: opacity },
          },
          vertexShader: markerVertex,
          fragmentShader: markerFragment,
          depthTest,
          depthWrite: false,
          // Always in the transparent pass, which three.js draws after the opaque one in renderOrder: an opaque
          // ring without depth writes was drawn before the clouds (renderOrder 1), which then covered it.
          transparent: true,
        }),
      );
      p.frustumCulled = false;
      p.renderOrder = renderOrder;
      p.onBeforeRender = () => {
        // Reduced motion: a steady ring (sin(0) = 0 keeps the base size).
        PULSE_TIME.value = REDUCED_MOTION.matches ? 0 : performance.now() / 1000;
      };
      return p;
    };
    this.points = new Group();
    this.points.name = 'selection';
    if (options.surface) this.points.add(ring(1, false, 11));
    else this.points.add(ring(0.3, false, 10), ring(1, true, 11));
    this.points.visible = false;
  }

  /** TEME position (km); undefined hides the marker. */
  set(posKm: Vec3 | undefined): void {
    this.placed = posKm !== undefined;
    if (posKm) {
      this.position.set(posKm);
      this.geometry.getAttribute('position').needsUpdate = true;
    }
    this.points.visible = this.placed && !this.occluded;
  }

  /** Hidden behind a body (CPU occlusion test by the caller), independently of `set`. */
  setOccluded(occluded: boolean): void {
    this.occluded = occluded;
    this.points.visible = this.placed && !occluded;
  }
}
