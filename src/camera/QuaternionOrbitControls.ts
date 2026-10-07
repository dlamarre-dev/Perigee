/**
 * Quaternion orbit camera controller (CLAUDE.md §6). Replaces Three.js OrbitControls, which constrains the
 * up vector and gimbal-locks at the poles. All state math lives in ./orbitMath (pure, tested); this class
 * only maps DOM input to it and drives the Three.js camera orientation.
 *
 * With camera-relative rendering the Three.js camera stays at the origin: callers read
 * `cameraPositionKm` (Float64) as the floating origin and copy `orientation` into the camera.
 */
import type { Camera } from 'three';
import type { Vec3 } from '../astro/vec3';
import {
  arcballRotationVector,
  cameraPositionKm,
  clampDistance,
  easeDistanceKm,
  interpolateOrbit,
  roll,
  rotateByVector,
  smoothstep,
  twistRollRad,
  type OrbitLimits,
  type OrbitState,
  type Quat,
} from './orbitMath';

export interface QuaternionOrbitControlsOptions {
  readonly limits: OrbitLimits;
  readonly home: OrbitState;
  /** Exponential damping time constant for inertia (s); 0 disables inertia. */
  readonly inertiaTimeS?: number;
}

interface FlyAnimation {
  readonly from: OrbitState;
  readonly to: OrbitState;
  readonly durationS: number;
  elapsedS: number;
}

const ZOOM_WHEEL_K = 0.0015;
const ZOOM_KEY_STEP = 0.15;
const KEY_ROTATE_RAD = (3 * Math.PI) / 180;
const KEY_ROLL_RAD = (3 * Math.PI) / 180;
const ROLL_RAD_PER_PX = 0.005;
const MIN_INERTIA_RAD_PER_S = 1e-3;
/** Smooth zoom: time constant of the ease towards the requested distance (wheel, keys). */
const ZOOM_SMOOTH_S = 0.12;
/** Pinch follows the fingers more closely. */
const PINCH_SMOOTH_S = 0.05;
/** Touch screens: a finger moves farther than a mouse for the same intent. */
const TOUCH_ROTATE_GAIN = 0.75;
const TOUCH_PINCH_GAIN = 0.75;
/** Two-finger twist: no roll until the fingers turned this much, then a reduced gain. */
const TOUCH_TWIST_DEAD_RAD = (6 * Math.PI) / 180;
const TOUCH_TWIST_GAIN = 0.6;
const TOUCH_INERTIA_FACTOR = 0.7;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class QuaternionOrbitControls {
  private stateValue: OrbitState;
  private limitsValue: OrbitLimits;
  private home: OrbitState;
  private readonly inertiaTimeS: number;
  /** Angular velocity in the camera frame (rad/s), used for inertia. */
  private angularVelocity: Vec3 = [0, 0, 0];
  private fly: FlyAnimation | undefined;
  private follow: (() => Vec3 | undefined) | undefined;
  private readonly pointers = new Map<number, { x: number; y: number; button: number; touch: boolean }>();
  private lastMoveTimeMs = 0;
  /** Requested distance, reached smoothly in update(); undefined when idle. */
  private zoomTargetKm: number | undefined;
  private zoomSmoothS = ZOOM_SMOOTH_S;
  /** The last drag came from a finger (shorter inertia). */
  private touchDrag = false;
  /** Two-finger gesture: accumulated twist and the roll already applied for it. */
  private twistRad = 0;
  private twistRolledRad = 0;
  private readonly abort = new AbortController();

  constructor(
    private readonly element: HTMLElement,
    options: QuaternionOrbitControlsOptions,
  ) {
    this.limitsValue = options.limits;
    this.home = options.home;
    this.stateValue = options.home;
    this.inertiaTimeS = options.inertiaTimeS ?? 0.35;

    const signal = this.abort.signal;
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal });
    element.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    element.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal });
    element.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal });
    element.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { signal });
  }

  get state(): OrbitState {
    return this.stateValue;
  }

  get orientation(): Quat {
    return this.stateValue.orientation;
  }

  get cameraPositionKm(): Vec3 {
    return cameraPositionKm(this.stateValue);
  }

  get limits(): OrbitLimits {
    return this.limitsValue;
  }

  setLimits(limits: OrbitLimits): void {
    this.limitsValue = limits;
    // Clamp without cancelling a running fly-to animation.
    this.stateValue = { ...this.stateValue, distanceKm: clampDistance(this.stateValue.distanceKm, limits) };
    if (this.zoomTargetKm !== undefined) this.zoomTargetKm = clampDistance(this.zoomTargetKm, limits);
    if (this.fly) {
      this.fly = {
        ...this.fly,
        to: { ...this.fly.to, distanceKm: clampDistance(this.fly.to.distanceKm, limits) },
      };
    }
  }

  setHome(home: OrbitState): void {
    this.home = home;
  }

  setState(state: OrbitState): void {
    this.fly = undefined;
    this.zoomTargetKm = undefined;
    this.stateValue = state;
  }

  /** Corrects the current state (e.g. out of a body) without cancelling animations, zoom or inertia. */
  constrain(state: OrbitState): void {
    this.stateValue = state;
  }

  /** Smoothly moves to a new state (target lerp, distance log-lerp, orientation slerp). */
  flyTo(to: OrbitState, durationS = 0.8): void {
    this.angularVelocity = [0, 0, 0];
    this.zoomTargetKm = undefined;
    // Reduced motion: a near-cut instead of a long glide (keeps the same code path).
    if (prefersReducedMotion()) durationS = Math.min(durationS, 0.12);
    const clamped = { ...to, distanceKm: clampDistance(to.distanceKm, this.limitsValue) };
    this.fly = { from: this.stateValue, to: clamped, durationS, elapsedS: 0 };
  }

  /** Back to the home view of the current body (stops following). */
  reset(): void {
    this.follow = undefined;
    this.flyTo(this.home);
  }

  /**
   * Keeps the target locked on a moving point (e.g. the selected satellite), evaluated every frame.
   * Combined with flyTo, the animation glides towards the live position. Undefined stops following.
   */
  setFollow(target: (() => Vec3 | undefined) | undefined): void {
    this.follow = target;
  }

  get following(): boolean {
    return this.follow !== undefined;
  }

  /** The camera is being dragged, gliding, zooming, following or coasting on inertia. */
  get moving(): boolean {
    const w = this.angularVelocity;
    return (
      this.pointers.size > 0 ||
      this.fly !== undefined ||
      this.follow !== undefined ||
      this.zoomTargetKm !== undefined ||
      Math.hypot(w[0], w[1], w[2]) > MIN_INERTIA_RAD_PER_S
    );
  }

  /** Advances inertia, follow and fly-to animations. Call once per frame. */
  update(dtS: number): void {
    const followed = this.follow?.();
    if (this.fly) {
      this.fly.elapsedS += dtS;
      const t = this.fly.elapsedS / this.fly.durationS;
      const to = followed ? { ...this.fly.to, targetKm: followed } : this.fly.to;
      this.stateValue = interpolateOrbit(this.fly.from, to, smoothstep(t));
      if (t >= 1) this.fly = undefined;
      return;
    }
    if (followed) this.stateValue = { ...this.stateValue, targetKm: followed };
    if (this.zoomTargetKm !== undefined) {
      const distanceKm = easeDistanceKm(this.stateValue.distanceKm, this.zoomTargetKm, dtS, this.zoomSmoothS);
      this.stateValue = { ...this.stateValue, distanceKm };
      if (distanceKm === this.zoomTargetKm) this.zoomTargetKm = undefined;
    }
    if (this.pointers.size === 0 && this.inertiaTimeS > 0) {
      const w = this.angularVelocity;
      if (Math.hypot(w[0], w[1], w[2]) > MIN_INERTIA_RAD_PER_S) {
        this.stateValue = rotateByVector(this.stateValue, [w[0] * dtS, w[1] * dtS, w[2] * dtS]);
        const tau = this.inertiaTimeS * (this.touchDrag ? TOUCH_INERTIA_FACTOR : 1);
        const decay = Math.exp(-dtS / tau);
        this.angularVelocity = [w[0] * decay, w[1] * decay, w[2] * decay];
      }
    }
  }

  applyTo(camera: Camera): void {
    const q = this.stateValue.orientation;
    camera.position.set(0, 0, 0);
    camera.quaternion.set(q.x, q.y, q.z, q.w);
    camera.updateMatrixWorld();
  }

  dispose(): void {
    this.abort.abort();
  }

  /** Requests a camera distance (HUD altimeter), eased like a pinch. */
  zoomTo(distanceKm: number): void {
    this.fly = undefined;
    this.zoomTargetKm = clampDistance(distanceKm, this.limitsValue);
    this.zoomSmoothS = PINCH_SMOOTH_S;
  }

  /** Requests a zoom by exp(kDelta), eased over a few frames from the current request. */
  private zoomBy(kDelta: number, smoothS: number): void {
    this.fly = undefined;
    const from = this.zoomTargetKm ?? this.stateValue.distanceKm;
    this.zoomTargetKm = clampDistance(from * Math.exp(kDelta), this.limitsValue);
    this.zoomSmoothS = smoothS;
  }

  /** Rotation speed shrinks near the surface so the ground does not fly past. */
  private radPerPx(): number {
    // Following an object, the camera turns around it, not around the body: no surface slowdown (it made the
    // view crawl when zoomed in on a spacecraft, the follow limits being far below the body radius).
    if (this.follow) return Math.PI / Math.max(1, this.element.clientHeight);
    const bodyRadiusKm = this.limitsValue.minDistanceKm / 1.02;
    const altitudeFactor = Math.min(
      1,
      Math.max(0.02, (this.stateValue.distanceKm - bodyRadiusKm) / bodyRadiusKm),
    );
    return (Math.PI / Math.max(1, this.element.clientHeight)) * altitudeFactor;
  }

  private onPointerDown(e: PointerEvent): void {
    this.element.setPointerCapture(e.pointerId);
    const touch = e.pointerType === 'touch';
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, touch });
    this.touchDrag = touch;
    this.twistRad = 0;
    this.twistRolledRad = 0;
    this.fly = undefined;
    this.angularVelocity = [0, 0, 0];
    this.lastMoveTimeMs = e.timeStamp;
  }

  private onPointerMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;

    if (this.pointers.size >= 2) {
      this.onMultiTouchMove(e.pointerId, e.clientX, e.clientY);
      return;
    }

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    const dtS = Math.max(1e-3, (e.timeStamp - this.lastMoveTimeMs) / 1000);
    this.lastMoveTimeMs = e.timeStamp;

    if (prev.button === 2) {
      this.stateValue = roll(this.stateValue, dx * ROLL_RAD_PER_PX);
      return;
    }
    const rv = arcballRotationVector(dx, dy, this.radPerPx() * (prev.touch ? TOUCH_ROTATE_GAIN : 1));
    this.stateValue = rotateByVector(this.stateValue, rv);
    // Low-pass the instantaneous angular velocity so a release after a pause does not fling.
    const a = 0.5;
    this.angularVelocity = [
      this.angularVelocity[0] * (1 - a) + (rv[0] / dtS) * a,
      this.angularVelocity[1] * (1 - a) + (rv[1] / dtS) * a,
      0,
    ];
  }

  private onMultiTouchMove(pointerId: number, x: number, y: number): void {
    const [p0, p1] = [...this.pointers.values()];
    if (!p0 || !p1) return;
    const before = { dx: p1.x - p0.x, dy: p1.y - p0.y };
    const moved = this.pointers.get(pointerId);
    if (!moved) return;
    moved.x = x;
    moved.y = y;
    const after = { dx: p1.x - p0.x, dy: p1.y - p0.y };

    const distBefore = Math.hypot(before.dx, before.dy);
    const distAfter = Math.hypot(after.dx, after.dy);
    if (distBefore > 0 && distAfter > 0) {
      this.zoomBy(Math.log(distBefore / distAfter) * TOUCH_PINCH_GAIN, PINCH_SMOOTH_S);
    }
    const twist = Math.atan2(after.dy, after.dx) - Math.atan2(before.dy, before.dx);
    this.twistRad += Math.atan2(Math.sin(twist), Math.cos(twist));
    const rollRad = twistRollRad(this.twistRad, TOUCH_TWIST_DEAD_RAD, TOUCH_TWIST_GAIN);
    this.stateValue = roll(this.stateValue, -(rollRad - this.twistRolledRad));
    this.twistRolledRad = rollRad;
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.twistRad = 0;
    this.twistRolledRad = 0;
    // Stale velocity: the pointer stopped before being released.
    if (e.timeStamp - this.lastMoveTimeMs > 80) this.angularVelocity = [0, 0, 0];
    if (this.element.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const scaleByMode =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 400 : 1;
    this.zoomBy(e.deltaY * scaleByMode * ZOOM_WHEEL_K, ZOOM_SMOOTH_S);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)))
      return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const s = this.stateValue;
    let next: OrbitState | undefined;
    switch (e.key) {
      case 'ArrowLeft':
        next = rotateByVector(s, [0, KEY_ROTATE_RAD, 0]);
        break;
      case 'ArrowRight':
        next = rotateByVector(s, [0, -KEY_ROTATE_RAD, 0]);
        break;
      case 'ArrowUp':
        next = rotateByVector(s, [KEY_ROTATE_RAD, 0, 0]);
        break;
      case 'ArrowDown':
        next = rotateByVector(s, [-KEY_ROTATE_RAD, 0, 0]);
        break;
      case 'q':
      case 'Q':
        next = roll(s, KEY_ROLL_RAD);
        break;
      case 'e':
      case 'E':
        next = roll(s, -KEY_ROLL_RAD);
        break;
      case '+':
      case '=':
        this.zoomBy(-ZOOM_KEY_STEP, ZOOM_SMOOTH_S);
        e.preventDefault();
        return;
      case '-':
      case '_':
        this.zoomBy(ZOOM_KEY_STEP, ZOOM_SMOOTH_S);
        e.preventDefault();
        return;
      case 'r':
      case 'R':
        this.reset();
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    this.fly = undefined;
    this.angularVelocity = [0, 0, 0];
    this.stateValue = next;
  }
}
