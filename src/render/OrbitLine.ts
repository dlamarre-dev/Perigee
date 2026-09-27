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

/** Orbit trace of the selected object, in the inertial (TEME) group. */
export class OrbitLine {
  readonly line: Line<BufferGeometry, LineBasicMaterial>;

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
    this.line.visible = false;
  }

  /** Packed xyz positions (km, TEME). Pass undefined to hide. */
  set(positionsKm: Float32Array | undefined): void {
    if (!positionsKm) {
      this.line.visible = false;
      return;
    }
    this.line.geometry.setAttribute('position', new BufferAttribute(positionsKm, 3));
    this.line.geometry.computeBoundingSphere();
    this.line.visible = true;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}

const markerVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uSize;
  uniform float uTime;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
    // Gentle pulse so the selection stands out.
    gl_PointSize = uSize * (1.0 + 0.22 * sin(uTime * 5.0));
  }
`;

const markerFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5 || r < 0.34) discard;
    gl_FragColor = vec4(uColor, uOpacity);
    #include <colorspace_fragment>
  }
`;

/** Shared by every selection ring (one clock for all). */
const PULSE_TIME = { value: 0 };
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Ring around the selected object; its position is computed exactly on the CPU each frame.
 * Two passes share the geometry: a full ring where the object is visible, and a faint one drawn through
 * the Earth so the selection is never lost when it passes behind the globe.
 */
export class SelectionMarker {
  readonly points: Group;
  private readonly position = new Float32Array(3);
  private readonly geometry = new BufferGeometry();

  constructor(pixelRatio: number) {
    this.geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    const ring = (opacity: number, depthTest: boolean, renderOrder: number): Points => {
      const p = new Points(
        this.geometry,
        new ShaderMaterial({
          uniforms: {
            uSize: { value: 20 * pixelRatio },
            uTime: PULSE_TIME,
            uColor: { value: new Color(1, 0.82, 0.3) },
            uOpacity: { value: opacity },
          },
          vertexShader: markerVertex,
          fragmentShader: markerFragment,
          depthTest,
          depthWrite: false,
          transparent: opacity < 1,
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
    this.points.add(ring(0.3, false, 10), ring(1, true, 11));
    this.points.visible = false;
  }

  /** TEME position (km); undefined hides the marker. */
  set(posKm: Vec3 | undefined): void {
    if (!posKm) {
      this.points.visible = false;
      return;
    }
    this.position.set(posKm);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.points.visible = true;
  }
}
