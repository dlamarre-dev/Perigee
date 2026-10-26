/**
 * A comet's illustrative tails (solar view, true scale only): a straight bluish ion tail pointing away from the
 * Sun and a curved yellowish dust tail lagging behind the comet's motion. Not a physical model: the length grows
 * as the comet nears the Sun and with its intrinsic brightness (M1), the panel says so. Each tail is a ribbon
 * turned towards the camera, rebuilt on the CPU every frame (a few dozen vertices), relative to the comet's
 * camera-relative position like the other objects; MeshBasicMaterial brings logarithmic depth.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from 'three';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../astro/vec3';

const AU_KM = 149_597_870.7;
/** Points along each tail. */
const SEGMENTS = 24;
/** No tail beyond this distance from the Sun (au); fully drawn inside TAIL_FULL_AU. */
const TAIL_MAX_AU = 4;
const TAIL_FULL_AU = 2.5;

/**
 * Illustrative ion-tail length (km): about a quarter of an au at 1 au for a bright comet (M1 ≈ 5), shrinking
 * with the square of the distance and for intrinsically faint comets, at most 0.8 au.
 */
export function tailLengthKm(rAu: number, m1: number | undefined): number {
  if (rAu >= TAIL_MAX_AU) return 0;
  const activity = Math.min(1, Math.max(0.05, 10 ** (-0.2 * ((m1 ?? 12) - 5))));
  return Math.min(0.8 * AU_KM, (0.25 * AU_KM * activity) / Math.max(rAu, 0.1) ** 2);
}

/** Tail opacity from the distance to the Sun: 1 inside TAIL_FULL_AU, fading out at TAIL_MAX_AU. */
function fade(rAu: number): number {
  const x = Math.min(1, Math.max(0, (TAIL_MAX_AU - rAu) / (TAIL_MAX_AU - TAIL_FULL_AU)));
  return x * x * (3 - 2 * x);
}

class Ribbon {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
  private readonly colors = new Float32Array((SEGMENTS + 1) * 2 * 4);

  constructor(private readonly rgb: readonly [number, number, number]) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 4));
    const index: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    this.mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * Fills the ribbon along `axis(s)` (s from 0 at the head to 1 at the tip, offsets from the comet in km),
   * `widthKm(s)` across, turned towards the camera (`toCamera`, from the comet), fading from `alpha` to 0.
   */
  set(axis: (s: number) => Vec3, widthKm: (s: number) => number, toCamera: Vec3, alpha: number): void {
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS;
      const p = axis(s);
      const next = axis(Math.min(1, s + 1 / SEGMENTS));
      const prev = axis(Math.max(0, s - 1 / SEGMENTS));
      const along = normalize(sub(next, prev));
      let side = cross(along, toCamera);
      if (length(side) < 1e-9) side = cross(along, [0, 0, 1]);
      side = scale(normalize(side), widthKm(s) / 2);
      for (let k = 0; k < 2; k++) {
        const sign = k === 0 ? 1 : -1;
        const v = (i * 2 + k) * 3;
        this.positions[v] = (p[0] ?? 0) + sign * (side[0] ?? 0);
        this.positions[v + 1] = (p[1] ?? 0) + sign * (side[1] ?? 0);
        this.positions[v + 2] = (p[2] ?? 0) + sign * (side[2] ?? 0);
        const c = (i * 2 + k) * 4;
        // Brightest just behind the head, fading to nothing at the tip.
        const a = alpha * (1 - s) ** 1.6 * Math.min(1, s * 12 + 0.2);
        this.colors[c] = this.rgb[0];
        this.colors[c + 1] = this.rgb[1];
        this.colors[c + 2] = this.rgb[2];
        this.colors[c + 3] = a;
      }
    }
    const g = this.mesh.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as BufferAttribute).needsUpdate = true;
    g.computeBoundingSphere();
    this.mesh.visible = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export class CometTail {
  private readonly ion = new Ribbon([0.55, 0.75, 1]);
  private readonly dust = new Ribbon([1, 0.88, 0.62]);

  constructor(private readonly parent: Object3D) {
    parent.add(this.ion.mesh, this.dust.mesh);
  }

  hide(): void {
    this.ion.mesh.visible = false;
    this.dust.mesh.visible = false;
  }

  /**
   * Draws both tails at `relKm` (the comet relative to the camera origin, scene frame). `sceneKm` and `velKmS`
   * are the comet's heliocentric scene position and velocity (scene frame), `cameraRelKm` the camera relative to
   * the same origin.
   */
  place(relKm: Vec3, sceneKm: Vec3, velKmS: Vec3, cameraRelKm: Vec3, m1: number | undefined): void {
    const rKm = length(sceneKm);
    const rAu = rKm / AU_KM;
    const lengthKm = tailLengthKm(rAu, m1);
    const alpha = 0.55 * fade(rAu);
    if (lengthKm <= 0 || alpha <= 0) {
      this.hide();
      return;
    }
    const away = scale(sceneKm, 1 / rKm);
    const toCamera = normalize(sub(cameraRelKm, relKm));
    // Dust lags behind the motion: the part of −v across the Sun direction bends the tail.
    const behind = sub(scale(velKmS, -1), scale(away, dot(scale(velKmS, -1), away)));
    const lag = length(behind) > 1e-9 ? normalize(behind) : away;
    for (const r of [this.ion, this.dust]) r.mesh.position.set(relKm[0], relKm[1], relKm[2]);
    this.ion.set(
      (s) => scale(away, s * lengthKm),
      (s) => lengthKm * (0.004 + 0.05 * s),
      toCamera,
      alpha,
    );
    const dustKm = 0.6 * lengthKm;
    this.dust.set(
      (s) => add(scale(away, s * dustKm), scale(lag, 0.45 * s * s * dustKm)),
      (s) => dustKm * (0.008 + 0.16 * s),
      toCamera,
      alpha * 0.8,
    );
  }

  dispose(): void {
    this.parent.remove(this.ion.mesh, this.dust.mesh);
    this.ion.dispose();
    this.dust.dispose();
  }
}
