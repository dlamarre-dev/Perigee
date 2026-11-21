/**
 * Warp bubble (immersive effect `warp`, high tier): the camera often moves much faster than light (zooming or
 * turning across the solar system). The ship is pictured inside a bubble shielding it from relativity, but the
 * light reaching the bubble is not: beyond the speed of light the hemisphere behind the motion dims by half
 * (quickly, with a soft edge), and, heading into the view, the light ahead streaks away from the direction of
 * motion, longer the faster.
 *
 * One full-screen pass in the opaque list (renderOrder 4.5): it redraws a copy of the frame drawn so far (sky,
 * stars, bodies, the Sun, models), streaked by four off-screen passes, and comes before the markers, satellites
 * (renderOrder 5), the transparent pass (orbits, rings, glare) and the HTML labels, which stay untouched. The
 * glare reads `warpFront` to fade with the Sun behind the motion.
 *
 * The speed is the camera's own motion, not the followed object's: following a planet at ×100 000 does not warp.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  FramebufferTexture,
  LinearFilter,
  Matrix4,
  Mesh,
  NoBlending,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { Vec3 } from '../astro/vec3';
import { effectUniform } from './effects';

const C_KM_S = 299_792.458;
/** Time constants (s): the darkness comes and goes quickly; the streaks follow the speed. */
const DARK_IN_S = 0.2;
const DARK_OUT_S = 0.2;
const STREAK_S = 0.12;
const SPEED_S = 0.08;
const DIRECTION_S = 0.15;
/** Time constant (s) of the streak length on screen, so a reversal or a turn never flickers. */
const LENGTH_S = 0.15;
/** Streak share left when moving sideways (turning), against 1 heading straight into the view. */
const SIDEWAYS = 0.2;
/** Half-width of the soft edge between the two hemispheres (cosine). */
const EDGE = 0.15;
/** Streak length at full warp, 100 000 c, heading straight ahead (rad, at 90° from the direction of motion). */
const STREAK_RAD = 0.6;
/** The most light taken from the hemisphere behind the motion. */
const MAX_DARK = 0.5;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * What the speed calls for: the rear darkness (0–0.5, full from ~3 c) and the streak length (0–1, from ~2 c to
 * 100 000 c). Speeds in km/s.
 */
export function warpTargets(speedKmS: number): { dark: number; streak: number } {
  const lg = Math.log10(Math.max(speedKmS / C_KM_S, 1e-6));
  return { dark: MAX_DARK * smooth(0, 0.5, lg), streak: smooth(0.3, 5, lg) };
}

/** Shared state: the direction of motion (world, unit) and the rear darkness in effect. */
const motion = new Vector3(0, 0, -1);
let darkNow = 0;

/** How much light comes from a world direction (camera to source): 1 ahead of the motion, 0.5 behind at warp. */
export function warpFront(direction: Vector3): number {
  if (darkNow <= 0) return 1;
  const d = direction.lengthSq() > 0 ? direction.dot(motion) / direction.length() : 1;
  return 1 - darkNow + darkNow * smooth(-EDGE, EDGE, d);
}

const vertexShader = /* glsl */ `
  uniform float uOn;
  void main() {
    gl_Position = uOn > 0.0 ? vec4(position.xy, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

/** Pixel ↔ view-space direction through the projection (any view offset), and the light let through. */
const common = /* glsl */ `
  uniform vec4 uViewport;
  uniform mat4 uProj;
  uniform vec3 uVel;
  uniform float uDark;
  uniform sampler2D uSrc;
  uniform vec2 uSize;
  uniform float uFront;

  vec3 viewDir(vec2 frag) {
    vec2 ndc = (frag - uViewport.xy) / uViewport.zw * 2.0 - 1.0;
    return normalize(vec3((ndc.x + uProj[2][0]) / uProj[0][0], (ndc.y + uProj[2][1]) / uProj[1][1], -1.0));
  }
  bool toPixel(vec3 s, out vec2 px) {
    if (s.z > -1e-4) return false;
    vec2 ndc = vec2(uProj[0][0] * s.x + uProj[2][0] * s.z, uProj[1][1] * s.y + uProj[2][1] * s.z) / -s.z;
    px = uViewport.xy + (ndc * 0.5 + 0.5) * uViewport.zw;
    return all(greaterThanEqual(px, uViewport.xy)) && all(lessThanEqual(px, uViewport.xy + uViewport.zw));
  }
  // 1 ahead of the motion, 1 - uDark behind it, with a soft edge.
  float front(vec3 d) {
    return 1.0 - uDark + uDark * smoothstep(-${EDGE.toFixed(2)}, ${EDGE.toFixed(2)}, dot(d, uVel));
  }
`;

/**
 * One streak pass: the brightest of 8 sources further from the direction of motion, fading with the distance
 * (exp(-x / uLambda)). Four passes with steps δ, 8δ, 64δ and 512δ give continuous streaks
 * 4095δ long.
 */
const streakFragmentShader = /* glsl */ `
  ${common}
  uniform float uStep;
  uniform float uLambda;
  void main() {
    vec3 d = viewDir(gl_FragCoord.xy);
    vec3 away = d * dot(d, uVel) - uVel;
    vec3 color = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float x = float(i) * uStep;
      vec3 s = normalize(d + away * x);
      vec2 px;
      if (!toPixel(s, px)) break;
      vec3 c = texture2D(uSrc, px / uSize).rgb;
      if (uFront > 0.5) c *= front(s);
      color = max(color, c * exp(-x / uLambda));
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** Back into the frame: the streaked copy, or the copy darkened behind the motion. */
const compositeFragmentShader = /* glsl */ `
  ${common}
  void main() {
    vec3 c = texture2D(uSrc, gl_FragCoord.xy / uSize).rgb;
    if (uFront > 0.5) c *= front(viewDir(gl_FragCoord.xy));
    gl_FragColor = vec4(c, 1.0);
  }
`;

type Uniforms = Record<string, { value: unknown }>;

export class WarpBubble {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly enabled = effectUniform('warp');
  private frame: FramebufferTexture | undefined;
  private targets: [WebGLRenderTarget, WebGLRenderTarget] | undefined;
  private readonly size = new Vector2();
  private readonly viewport = new Vector4();
  private readonly projection = new Matrix4();
  private readonly velocityView = new Vector3();
  private readonly shared: Uniforms;
  private readonly onUniform = { value: 0 };
  private readonly darkUniform = { value: 0 };
  private readonly streakMaterial: ShaderMaterial;
  private readonly passScene = new Scene();
  private readonly passCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private previousKm: Vec3 | undefined;
  private previousFollowedKm: Vec3 | undefined;
  /** Smoothed speed (km/s), the darkness and the streak length. */
  private speedKmS = 0;
  private readonly heading = new Vector3();
  private dark = 0;
  private streak = 0;
  /** How steady the direction of motion is (0 while it reverses, 1 when constant). */
  private steady = 0;
  /** Streak length drawn (rad), eased. */
  private lengthRad = 0;
  private lastPrepareMs: number | undefined;

  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.shared = {
      uOn: this.onUniform,
      uViewport: { value: this.viewport },
      uProj: { value: this.projection },
      uVel: { value: this.velocityView },
      uDark: this.darkUniform,
      uSize: { value: this.size },
    };
    const material = (fragmentShader: string, extra: Uniforms): ShaderMaterial =>
      new ShaderMaterial({
        uniforms: { ...this.shared, uSrc: { value: null }, uFront: { value: 0 }, ...extra },
        vertexShader,
        fragmentShader,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
      });
    this.mesh = new Mesh(geometry, material(compositeFragmentShader, {}));
    this.mesh.name = 'warp-bubble';
    this.mesh.frustumCulled = false;
    // Opaque pass: after the sky, the stars, the bodies, the Sun and the window's dimming (4), before the markers
    // and satellites (5) and the transparent pass.
    this.mesh.renderOrder = 4.5;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.prepare(renderer, camera);
    this.streakMaterial = material(streakFragmentShader, { uStep: { value: 0 }, uLambda: { value: 1 } });
    const quad = new Mesh(geometry, this.streakMaterial);
    quad.frustumCulled = false;
    this.passScene.add(quad);
  }

  /**
   * Called each frame with the camera's position (scene frame, km) and the followed point, if any. `jumped`: the
   * camera was cut to a new place (view switch, frame change, link): no motion is measured across it.
   */
  update(cameraKm: Vec3, followedKm: Vec3 | undefined, dtS: number, jumped: boolean): void {
    if (this.enabled.value === 0 || jumped || dtS <= 0 || !this.previousKm) {
      this.previousKm = cameraKm;
      this.previousFollowedKm = followedKm;
      if (this.enabled.value === 0 || jumped) this.reset();
      return;
    }
    // The camera's own motion: the followed object's is taken out.
    const f0 = this.previousFollowedKm;
    const carried: Vec3 =
      followedKm && f0 ? [followedKm[0] - f0[0], followedKm[1] - f0[1], followedKm[2] - f0[2]] : [0, 0, 0];
    const dx = cameraKm[0] - this.previousKm[0] - carried[0];
    const dy = cameraKm[1] - this.previousKm[1] - carried[1];
    const dz = cameraKm[2] - this.previousKm[2] - carried[2];
    this.previousKm = cameraKm;
    this.previousFollowedKm = followedKm;
    const stepKm = Math.hypot(dx, dy, dz);
    const ease = (tauS: number): number => 1 - Math.exp(-dtS / tauS);
    // Linear, not logarithmic: frames without a pointer event between two of a drag only lower it a little.
    this.speedKmS += (stepKm / dtS - this.speedKmS) * ease(SPEED_S);
    // Averaged unit steps, not renormalised: a reversal goes through zero and flips. Below the speed of light the
    // average fades to zero, so the next move starts from its own direction, not from the last one (a turn before
    // a zoom would bend the first streaks).
    const k = ease(DIRECTION_S);
    const m = this.heading;
    if (this.speedKmS < C_KM_S) m.multiplyScalar(1 - k);
    else if (stepKm > 0)
      m.set(m.x + (dx / stepKm - m.x) * k, m.y + (dy / stepKm - m.y) * k, m.z + (dz / stepKm - m.z) * k);
    if (m.lengthSq() > 1e-12) motion.copy(m).normalize();
    // A quick reversal (zoom in then out, a turn the other way) goes through a heading of nearly zero length:
    // the darkness fades out and back in on the other side instead of jumping across.
    this.steady = smooth(0.2, 0.8, this.heading.length());
    const target = warpTargets(this.speedKmS);
    target.dark *= this.steady;
    this.dark += (target.dark - this.dark) * ease(target.dark > this.dark ? DARK_IN_S : DARK_OUT_S);
    this.streak += (target.streak - this.streak) * ease(STREAK_S);
    if (this.dark < 1e-3 && target.dark === 0) this.dark = 0;
    if (this.streak < 1e-3 && target.streak === 0) this.streak = 0;
    darkNow = this.dark;
  }

  private reset(): void {
    this.speedKmS = 0;
    this.dark = 0;
    this.streak = 0;
    this.steady = 0;
    this.lengthRad = 0;
    this.heading.set(0, 0, 0);
    darkNow = 0;
  }

  private prepare(renderer: WebGLRenderer, camera: Camera): void {
    const u = this.mesh.material.uniforms;
    // The canvas only (not the picking pass).
    const on =
      this.enabled.value > 0 &&
      (this.dark > 0 || this.streak > 0 || this.lengthRad > 0) &&
      renderer.getRenderTarget() === null;
    this.onUniform.value = on ? 1 : 0;
    const now = performance.now();
    const dtS = this.lastPrepareMs === undefined ? 0 : Math.min(0.1, (now - this.lastPrepareMs) / 1000);
    this.lastPrepareMs = now;
    if (!on) return;
    renderer.getCurrentViewport(this.viewport);
    renderer.getDrawingBufferSize(this.size);
    const w = Math.floor(this.size.x);
    const h = Math.floor(this.size.y);
    if (this.frame?.image.width !== w || this.frame.image.height !== h) {
      this.frame?.dispose();
      this.frame = new FramebufferTexture(w, h);
      this.frame.minFilter = LinearFilter;
      this.frame.magFilter = LinearFilter;
      for (const t of this.targets ?? []) t.dispose();
      const target = (): WebGLRenderTarget =>
        new WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
      this.targets = [target(), target()];
    }
    renderer.copyFramebufferToTexture(this.frame);
    this.projection.copy(camera.projectionMatrix);
    this.velocityView.copy(motion).transformDirection(camera.matrixWorldInverse);
    this.darkUniform.value = this.dark;
    const src = u['uSrc'] as { value: unknown };
    const front = u['uFront'] as { value: number };
    // Longest heading into the view (zooming in, flying ahead), shorter obliquely and short sideways (turning),
    // where long ones would cross the screen as parallel lines; eased so reversals do not flicker.
    const ahead = Math.max(0, -this.velocityView.z);
    const targetRad = this.streak * STREAK_RAD * this.steady * (SIDEWAYS + (1 - SIDEWAYS) * ahead);
    this.lengthRad += (targetRad - this.lengthRad) * (1 - Math.exp(-dtS / LENGTH_S));
    if (this.lengthRad < 1e-4 && targetRad === 0) this.lengthRad = 0;
    const lengthRad = this.lengthRad;
    if (lengthRad < 1e-4 || !this.targets) {
      src.value = this.frame;
      front.value = 1;
      return;
    }
    // Streaks: four passes off screen (frame → A → B → A → B), then B drawn back into the frame.
    const [a, b] = this.targets;
    const delta = lengthRad / 4095;
    const p = this.streakMaterial.uniforms;
    (p['uLambda'] as { value: number }).value = lengthRad / 3;
    const passes: [Texture, WebGLRenderTarget, number, number][] = [
      [this.frame, a, delta, 1],
      [a.texture, b, delta * 8, 0],
      [b.texture, a, delta * 64, 0],
      [a.texture, b, delta * 512, 0],
    ];
    const previous = renderer.getRenderTarget();
    for (const [from, to, step, withFront] of passes) {
      (p['uSrc'] as { value: unknown }).value = from;
      (p['uStep'] as { value: number }).value = step;
      (p['uFront'] as { value: number }).value = withFront;
      renderer.setRenderTarget(to);
      renderer.render(this.passScene, this.passCamera);
    }
    renderer.setRenderTarget(previous);
    src.value = b.texture;
    front.value = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.streakMaterial.dispose();
    this.frame?.dispose();
    for (const t of this.targets ?? []) t.dispose();
  }
}
