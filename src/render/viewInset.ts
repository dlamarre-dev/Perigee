/**
 * Bottom inset: on phones a bottom sheet covers part of the canvas, so the projection centre is moved to the
 * middle of the part still visible (`frameObject` then centres objects where they can be seen). The canvas is
 * treated as the lower part of a taller virtual image (height h + c) whose top c pixels are cropped away; the
 * field of view is widened to that virtual height so the on-screen scale does not change.
 * The inset lives in `camera.userData.bottomInsetPx`, so every renderer of the camera (main pass, GPU picking)
 * applies the same projection.
 */
import type { PerspectiveCamera } from 'three';

const BASE_FOV_KEY = 'baseFovDeg';
const INSET_KEY = 'bottomInsetPx';

export function bottomInsetPx(camera: PerspectiveCamera): number {
  const v: unknown = camera.userData[INSET_KEY];
  return typeof v === 'number' ? v : 0;
}

export function setBottomInset(camera: PerspectiveCamera, insetPx: number): void {
  camera.userData[INSET_KEY] = Math.max(0, Math.round(insetPx));
}

/**
 * Applies the inset projection for a canvas of `widthCss` × `heightCss`; `region` (CSS px in the canvas) renders
 * only that window, as GPU picking needs.
 */
export function applyViewInset(
  camera: PerspectiveCamera,
  widthCss: number,
  heightCss: number,
  region?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): void {
  const baseFovDeg = (camera.userData[BASE_FOV_KEY] as number | undefined) ?? camera.fov;
  camera.userData[BASE_FOV_KEY] = baseFovDeg;
  const c = Math.min(bottomInsetPx(camera), heightCss * 0.8);
  const fullHeight = heightCss + c;
  // The virtual image's aspect ratio (three.js derives the frustum width from it).
  camera.aspect = widthCss / fullHeight;
  if (c === 0 && !region) {
    camera.fov = baseFovDeg;
    camera.clearViewOffset();
    return;
  }
  const halfRad = (baseFovDeg * Math.PI) / 360;
  camera.fov = (Math.atan((Math.tan(halfRad) * fullHeight) / heightCss) * 360) / Math.PI;
  const r = region ?? { x: 0, y: 0, width: widthCss, height: heightCss };
  camera.setViewOffset(widthCss, fullHeight, r.x, c + r.y, r.width, r.height);
}
