/**
 * Quaternion orbit camera controller (CLAUDE.md §6). Replaces Three.js OrbitControls, which constrains the
 * up vector and gimbal-locks at the poles. All state math lives in ./orbitMath (pure, tested); this class
 * only maps DOM input to it and drives the Three.js camera orientation.
 *
 * With camera-relative rendering the Three.js camera stays at the origin: callers read
 * `cameraPositionKm` (Float64) as the floating origin and copy `orientation` into the camera.
 *
 * Alt (Option) + left drag, Alt + arrows and a three-finger drag translate the pivot instead of turning around it;
 * the camera never leaves the cube `limits.boundsHalfKm` (src/render/GuardianGrid.ts shows its faces).
 */
import type { Camera } from 'three';
import { scale, type Vec3 } from '../astro/vec3';
import {
  arcballRotationVector,
  cameraPositionKm,
  clampDistanceAt,
  minDistanceFor,
  easeDistanceKm,
  flyOrbit,
  isFiniteState,
  keepInCube,
  keepInCubeByTranslation,
  panBy,
  panVector,
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
  /** Vertical field of view (rad), for the pan speed (the point under the pointer follows it). */
  readonly fovYRad?: number;
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
/** Keyboard rotation and roll: time constant of the ease towards the requested turn (as the wheel zoom). */
const KEY_SMOOTH_S = 0.12;
/** Alt + arrow: pan by this fraction of the visible height at the pivot. */
const KEY_PAN_FRACTION = 0.05;
/**
 * Three-finger drag pans (two fingers only pinch and twist: a pinch to zoom moved their midpoint enough to pan by
 * mistake, which also stopped following). Gain: the fingers' centroid follows them.
 */
const TOUCH_PAN_GAIN = 1;
/** Three-finger drag: no pan until the fingers' centroid moved this far. */
const TOUCH_PAN_DEAD_PX = 12;

type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Direction keys: the arrows, and W A S D by physical position (`code`), so they sit under the same fingers on
 * every layout (Z Q S D on AZERTY). Letters are read by position too for roll (Q/E: A/E on AZERTY) and reset (R).
 */
const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};
const WASD: Readonly<Record<string, Direction>> = { KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right' };

/**
 * Physical position of a letter key ("KeyF"). Some events carry none (`code` empty: Android's on-screen keyboard,
 * assistive tools, synthetic events): the typed letter stands in for it then.
 */
export function letterCode(e: KeyboardEvent): string {
  if (e.code) return e.code;
  return /^[a-z]$/i.test(e.key) ? `Key${e.key.toUpperCase()}` : '';
}

function directionOf(e: KeyboardEvent): Direction | undefined {
  return ARROWS[e.key] ?? WASD[letterCode(e)];
}

/** Alt + direction: screen direction of the view's move (x right, y down). */
const PAN_KEYS: Readonly<Record<Direction, readonly [number, number]>> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/** Rotation for a direction key, in the camera frame (x: pitch, y: yaw). */
const TURN_KEYS: Readonly<Record<Direction, Vec3>> = {
  left: [0, KEY_ROTATE_RAD, 0],
  right: [0, -KEY_ROTATE_RAD, 0],
  up: [KEY_ROTATE_RAD, 0, 0],
  down: [-KEY_ROTATE_RAD, 0, 0],
};

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
  /** Keyboard turn still to apply (rotation vector, camera frame, rad), eased in update(). */
  private pendingKeyTurn: Vec3 = [0, 0, 0];
  /** The last drag came from a finger (shorter inertia). */
  private touchDrag = false;
  /** Two-finger gesture: accumulated twist and the roll already applied for it. */
  private twistRad = 0;
  private twistRolledRad = 0;
  /** Three-finger gesture: centroid travel so far, and whether it has started panning. */
  private touchPanPx: [number, number] = [0, 0];
  private touchPanning = false;
  private readonly abort = new AbortController();
  private readonly fovYRad: number;
  /** A pan moved the pivot since the shell last asked (it then pushes the camera out of bodies by translation). */
  private pannedValue = false;
  /** Alt is held: the canvas shows a move cursor. */
  private altHeld = false;
  /** A pan happened while Alt was down: its release must not open the browser menu (Firefox). */
  private pannedWithAlt = false;

  constructor(
    private readonly element: HTMLElement,
    options: QuaternionOrbitControlsOptions,
  ) {
    this.limitsValue = options.limits;
    this.home = options.home;
    this.stateValue = options.home;
    this.inertiaTimeS = options.inertiaTimeS ?? 0.35;
    this.fovYRad = options.fovYRad ?? (45 * Math.PI) / 180;

    const signal = this.abort.signal;
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal });
    element.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    element.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal });
    element.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal });
    element.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { signal });
    window.addEventListener('keyup', (e) => this.onKeyUp(e), { signal });
    window.addEventListener('blur', () => this.setAltHeld(false), { signal });
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
    this.stateValue = { ...this.stateValue, distanceKm: this.clampFor(this.stateValue.distanceKm) };
    if (this.zoomTargetKm !== undefined) this.zoomTargetKm = this.clampFor(this.zoomTargetKm);
    if (this.fly) {
      const to = this.fly.to;
      this.fly = {
        ...this.fly,
        to: { ...to, distanceKm: clampDistanceAt(to.distanceKm, to.targetKm, limits) },
      };
    }
  }

  /** Did a pan move the pivot since the last call? (Read once per frame by the shell.) */
  takePanned(): boolean {
    const panned = this.pannedValue;
    this.pannedValue = false;
    return panned;
  }

  /** Distance clamped for the current pivot (body minimum at the centre, the pivot minimum elsewhere). */
  private clampFor(distanceKm: number): number {
    return clampDistanceAt(distanceKm, this.stateValue.targetKm, this.limitsValue);
  }

  /**
   * Cube bound after a zoom, a rotation or a glide: the distance capped at the wall, or the step refused (back to
   * `previous`, zoom and inertia stopped) when the camera would have to come closer than allowed to the pivot.
   */
  private bounded(state: OrbitState, previous: OrbitState): OrbitState {
    if (!isFiniteState(state)) return previous;
    const half = this.limitsValue.boundsHalfKm;
    if (half === undefined) return state;
    const kept = keepInCube(state, half, minDistanceFor(state.targetKm, this.limitsValue));
    if (kept) return kept;
    this.zoomTargetKm = undefined;
    this.angularVelocity = [0, 0, 0];
    this.pendingKeyTurn = [0, 0, 0];
    return previous;
  }

  /** Moves the pivot by a camera-frame vector: stops following, stops at the cube's walls. */
  private pan(panCam: Vec3): void {
    if (panCam[0] === 0 && panCam[1] === 0 && panCam[2] === 0) return;
    // Taking the camera off a followed object: it stays where it is (the shell restores the view limits).
    this.follow = undefined;
    this.fly = undefined;
    this.angularVelocity = [0, 0, 0];
    let s = panBy(this.stateValue, panCam);
    const half = this.limitsValue.boundsHalfKm;
    if (half !== undefined) s = keepInCubeByTranslation(s, half);
    if (!isFiniteState(s)) return;
    this.stateValue = s;
    this.pannedValue = true;
    // Around a point in space the body's closest approach no longer applies (and back at the centre it does).
    if (this.zoomTargetKm !== undefined) this.zoomTargetKm = this.clampFor(this.zoomTargetKm);
  }

  private panPx(dxPx: number, dyPx: number): void {
    this.pan(panVector(dxPx, dyPx, this.stateValue.distanceKm, this.fovYRad, this.element.clientHeight));
  }

  private setAltHeld(held: boolean): void {
    if (held === this.altHeld) return;
    this.altHeld = held;
    this.element.classList.toggle('pan-ready', held);
  }

  setHome(home: OrbitState): void {
    this.home = home;
  }

  setState(state: OrbitState): void {
    this.fly = undefined;
    this.pendingKeyTurn = [0, 0, 0];
    this.zoomTargetKm = undefined;
    this.stateValue = state;
  }

  /** Corrects the current state (e.g. out of a body) without cancelling animations, zoom or inertia. */
  constrain(state: OrbitState): void {
    if (isFiniteState(state)) this.stateValue = state;
  }

  /** Smoothly moves to a new state (target lerp, distance log-lerp, orientation slerp). */
  flyTo(to: OrbitState, durationS = 0.8): void {
    this.angularVelocity = [0, 0, 0];
    this.zoomTargetKm = undefined;
    this.pendingKeyTurn = [0, 0, 0];
    // Reduced motion: a near-cut instead of a long glide (keeps the same code path).
    if (prefersReducedMotion()) durationS = Math.min(durationS, 0.12);
    const clamped = { ...to, distanceKm: clampDistanceAt(to.distanceKm, to.targetKm, this.limitsValue) };
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
    const previous = this.stateValue;
    if (this.fly) {
      this.fly.elapsedS += dtS;
      const t = this.fly.elapsedS / this.fly.durationS;
      const to = followed ? { ...this.fly.to, targetKm: followed } : this.fly.to;
      this.stateValue = this.bounded(flyOrbit(this.fly.from, to, smoothstep(t)), previous);
      if (t >= 1) this.fly = undefined;
      return;
    }
    if (followed) this.stateValue = { ...this.stateValue, targetKm: followed };
    this.updateMotion(dtS);
    this.stateValue = this.bounded(this.stateValue, previous);
  }

  /** Zoom, keyboard turn and inertia of one frame (the cube bound is applied after). */
  private updateMotion(dtS: number): void {
    if (this.zoomTargetKm !== undefined) {
      const distanceKm = easeDistanceKm(this.stateValue.distanceKm, this.zoomTargetKm, dtS, this.zoomSmoothS);
      this.stateValue = { ...this.stateValue, distanceKm };
      if (distanceKm === this.zoomTargetKm) this.zoomTargetKm = undefined;
    }
    const turn = this.pendingKeyTurn;
    if (turn[0] !== 0 || turn[1] !== 0 || turn[2] !== 0) {
      // Ease towards the requested turn; the rest carries over (held keys add steps as they repeat).
      const done = Math.hypot(turn[0], turn[1], turn[2]) < 1e-5 ? 1 : 1 - Math.exp(-dtS / KEY_SMOOTH_S);
      this.stateValue = rotateByVector(this.stateValue, scale(turn, done));
      this.pendingKeyTurn = done === 1 ? [0, 0, 0] : scale(turn, 1 - done);
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
    this.zoomTargetKm = this.clampFor(distanceKm);
    this.zoomSmoothS = PINCH_SMOOTH_S;
  }

  /** Requests a zoom by exp(kDelta), eased over a few frames from the current request. */
  private zoomBy(kDelta: number, smoothS: number): void {
    this.fly = undefined;
    const from = this.zoomTargetKm ?? this.stateValue.distanceKm;
    this.zoomTargetKm = this.clampFor(from * Math.exp(kDelta));
    this.zoomSmoothS = smoothS;
  }

  /** Rotation speed shrinks near the surface so the ground does not fly past. */
  private radPerPx(): number {
    // Following an object, the camera turns around it, not around the body: no surface slowdown (it made the
    // view crawl when zoomed in on a spacecraft, the follow limits being far below the body radius).
    if (this.follow) return Math.PI / Math.max(1, this.element.clientHeight);
    const bodyRadiusKm = this.limitsValue.surfaceRadiusKm ?? this.limitsValue.minDistanceKm / 1.02;
    // Same when turning around another point (a selected moon or planet framed in the solar view): the
    // slowdown is for skimming the central body's surface, the target then being its centre.
    const t = this.stateValue.targetKm;
    if (Math.hypot(t[0], t[1], t[2]) > bodyRadiusKm) return Math.PI / Math.max(1, this.element.clientHeight);
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
    this.touchPanPx = [0, 0];
    this.touchPanning = false;
    this.fly = undefined;
    this.angularVelocity = [0, 0, 0];
    this.lastMoveTimeMs = e.timeStamp;
  }

  private onPointerMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;

    if (this.pointers.size >= 3) {
      this.onThreeFingerMove(e.pointerId, e.clientX, e.clientY);
      return;
    }
    if (this.pointers.size === 2) {
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
      this.stateValue = this.bounded(roll(this.stateValue, dx * ROLL_RAD_PER_PX), this.stateValue);
      return;
    }
    // Alt (Option) held: translate the pivot instead of turning around it (read on every move, so pressing or
    // releasing it mid-drag switches mode).
    if (e.altKey && !prev.touch) {
      this.setAltHeld(true);
      this.pannedWithAlt = true;
      this.panPx(dx, dy);
      return;
    }
    const rv = arcballRotationVector(dx, dy, this.radPerPx() * (prev.touch ? TOUCH_ROTATE_GAIN : 1));
    this.stateValue = this.bounded(rotateByVector(this.stateValue, rv), this.stateValue);
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
    this.stateValue = this.bounded(roll(this.stateValue, -(rollRad - this.twistRolledRad)), this.stateValue);
    this.twistRolledRad = rollRad;
  }

  /** Three fingers: their centroid pans the pivot, once it has moved past a dead zone. */
  private onThreeFingerMove(pointerId: number, x: number, y: number): void {
    const moved = this.pointers.get(pointerId);
    if (!moved) return;
    const n = this.pointers.size;
    const dx = (x - moved.x) / n;
    const dy = (y - moved.y) / n;
    moved.x = x;
    moved.y = y;
    this.touchPanPx = [this.touchPanPx[0] + dx, this.touchPanPx[1] + dy];
    if (!this.touchPanning && Math.hypot(this.touchPanPx[0], this.touchPanPx[1]) > TOUCH_PAN_DEAD_PX) {
      this.touchPanning = true;
    }
    if (this.touchPanning) this.panPx(dx * TOUCH_PAN_GAIN, dy * TOUCH_PAN_GAIN);
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
    if (e.key === 'Alt') this.setAltHeld(true);
    if (target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)))
      return;
    // Keys typed in a dialog drive only the controls inside it (the star map), not the view behind it.
    if (target?.closest?.('dialog') !== this.element.closest('dialog')) return;
    const direction = directionOf(e);
    const panKey = direction && PAN_KEYS[direction];
    if (e.altKey && !e.ctrlKey && !e.metaKey && panKey) {
      // Alt + arrows (or W A S D): the view moves the way the arrow points (the content the other way).
      const stepPx = this.element.clientHeight * KEY_PAN_FRACTION;
      this.panPx(-panKey[0] * stepPx, -panKey[1] * stepPx);
      this.pannedWithAlt = true;
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Rotation vector in the camera frame (x: pitch, y: yaw, z: roll), eased in update().
    let turn: Vec3 | undefined = direction && TURN_KEYS[direction];
    // roll(s, a) turns about the view axis by −a.
    const code = letterCode(e);
    if (code === 'KeyQ') turn = [0, 0, -KEY_ROLL_RAD];
    if (code === 'KeyE') turn = [0, 0, KEY_ROLL_RAD];
    if (code === 'KeyR') {
      this.reset();
      e.preventDefault();
      return;
    }
    if (!turn) {
      this.onZoomKey(e);
      return;
    }
    e.preventDefault();
    this.fly = undefined;
    this.angularVelocity = [0, 0, 0];
    if (prefersReducedMotion()) {
      this.stateValue = this.bounded(rotateByVector(this.stateValue, turn), this.stateValue);
      return;
    }
    const p = this.pendingKeyTurn;
    this.pendingKeyTurn = [p[0] + turn[0], p[1] + turn[1], p[2] + turn[2]];
  }

  /** + and − zoom (read by the character typed: where they sit differs between layouts). */
  private onZoomKey(e: KeyboardEvent): void {
    switch (e.key) {
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
      default:
        return;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key !== 'Alt') return;
    this.setAltHeld(false);
    // Firefox opens its menu bar when Alt is released alone: not after a pan.
    if (this.pannedWithAlt) e.preventDefault();
    this.pannedWithAlt = false;
  }
}
