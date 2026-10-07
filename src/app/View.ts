/**
 * Contract between the application shell (src/app/main.ts) and a view (Earth, Moon, …).
 *
 * The shell owns the renderer, clock, camera controller, toolbar, time bar, URL and follow mode. Each view
 * owns its central body, its objects and its panels. Frames: every view has an inertial frame and a
 * body-fixed frame; `bodyOrientation` gives inertial ← body-fixed, and the shell passes the scene ← inertial
 * rotation (identity in the inertial view, the inverse body orientation in the body-fixed view).
 */
import type { Quat } from '../astro/quat';
import type { SimClock } from '../astro/time';
import type { Vec3 } from '../astro/vec3';
import type { QuaternionOrbitControls } from '../camera/QuaternionOrbitControls';
import type { CameraObstacle, OrbitLimits } from '../camera/orbitMath';
import type { I18n, MessageKey } from '../i18n';
import type { Renderer } from '../render/Renderer';
import type { FrameMode, ViewId } from './urlState';

export interface ViewFrame {
  readonly nowMs: number;
  readonly dtS: number;
  readonly rate: number;
  readonly clockEpoch: number;
  readonly frame: FrameMode;
  /** inertial ← body-fixed. */
  readonly bodyQ: Quat;
  /** scene ← inertial. */
  readonly sceneFromInertial: Quat;
}

export interface FollowApi {
  /**
   * Locks the camera on a moving scene-frame point, framed from above at `distanceKm` (radially outward
   * from the scene origin), or from `viewFrom` (scene-frame direction from the point towards the camera).
   * `minDistanceKm` lets the camera come closer than the default (objects with a 3D model of a few metres).
   * `onEnd` runs once when following stops for any reason (button, recenter, R key, view change).
   */
  start(
    scenePosition: () => Vec3 | undefined,
    distanceKm: number,
    onEnd: () => void,
    options?: {
      readonly viewFrom?: Vec3;
      readonly minDistanceKm?: number;
      /** Radius of a followed celestial body: the altimeter then reads the height above its surface. */
      readonly surfaceRadiusKm?: number;
    },
  ): boolean;
  stop(): void;
  readonly active: boolean;
}

export interface ViewHost {
  readonly renderer: Renderer;
  readonly controls: QuaternionOrbitControls;
  readonly clock: SimClock;
  readonly i18n: I18n;
  readonly baseUrl: string;
  /** URL parameters present at startup (only for the initial view). */
  readonly initialParams: URLSearchParams;
  /** `?e2e` was present at startup: views may expose test hooks. */
  readonly e2e: boolean;
  readonly follow: FollowApi;
  /**
   * Flies the camera (without following) to a viewpoint that shows a scene-frame point in front of the central
   * body, north up. `tiltRad` lifts the viewpoint above the radial direction (so the object does not sit on top
   * of the body). The camera never moves closer than it is, only further out when needed to show the object.
   */
  frameObject(
    scenePositionKm: Vec3,
    options?: {
      tiltRad?: number;
      minDistanceKm?: number;
      /** Aim between the body centre (0) and the object (1). */
      targetFraction?: number;
      /** Exact distance, overriding the "never closer" rule. */
      distanceKm?: number;
    },
  ): void;
  frame(): FrameMode;
  /** scene ← inertial rotation for the current frame mode. */
  sceneFromInertial(date: Date): Quat;
  /** Adds view-owned DOM (panels) to the page; removed by the shell when the view is disposed. */
  mount(element: HTMLElement): void;
  syncUrl(): void;
  showNotice(text: string | undefined): void;
  /** Label and handler of the toolbar's panel button (undefined hides it). */
  setPanelToggle(labelKey: MessageKey | undefined, toggle?: () => boolean, initiallyOpen?: boolean): void;
}

export interface View {
  readonly id: ViewId;
  readonly limits: OrbitLimits;
  /** Highest time rate the view can render faithfully (default: the time bar's maximum). */
  readonly maxRate?: number;
  /** Explanation shown on the disabled faster speeds. */
  readonly maxRateHint?: MessageKey;
  readonly bodyRadiusKm: number;
  /** Default viewpoint, as a direction in the body-fixed frame, and its distance. */
  readonly homeDirectionBody: Vec3;
  readonly homeDistanceKm: number;
  /** Farthest content from the body centre (km), for the far clipping plane. */
  readonly farKm: number;
  /** Distance from the camera to the nearest surface other than the central body (km), for the near plane. */
  nearestSurfaceKm?(originKm: Vec3): number;
  /** Bodies the camera must not enter (scene frame); the shell keeps it above their surface. */
  cameraObstacles?(): readonly CameraObstacle[];
  /** False while scene distances are not to scale (solar view's logarithmic mode); default true. */
  distancesToScale?(): boolean;
  bodyOrientation(date: Date): Quat;
  /** Per-frame logic (positions, orientations, sampling), before the camera moves. */
  update(frame: ViewFrame): void;
  /** Applies the floating origin: the final camera position in the scene frame (km). */
  placeOrigin(originKm: Vec3): void;
  /** Low-rate UI refresh (a few times per second). */
  uiTick(nowMs: number): void;
  click(xCss: number, yCss: number, double: boolean): void;
  /** Keyboard F: follow the selected object, or stop following (no-op without a selection). */
  toggleFollow(): void;
  writeUrl(params: URLSearchParams): void;
  /** Hashes of the published data this view loaded (src/app/updates.ts keys), to detect newer data. */
  dataVersions?(): ReadonlyMap<string, string>;
  dispose(): void;
}

export type ViewFactory = (host: ViewHost) => View;
