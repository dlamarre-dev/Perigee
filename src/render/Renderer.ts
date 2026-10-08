import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { AdaptiveResolution } from './adaptiveResolution';
import { DisplayInterval, shouldDrawFrame } from './frameCap';
import { PIXEL_RATIO_UNIFORM } from './pixelRatio';
import { applyViewInset, bottomInsetPx, setBottomInset } from './viewInset';

export interface RendererOptions {
  /** Depth precision from metres to the Sun (all views, CLAUDE.md §5.4). */
  readonly logarithmicDepthBuffer?: boolean;
  /** Multisampling (quality tier). */
  readonly antialias?: boolean;
  /** Pixel ratio cap, floor of the adaptive resolution, and the level to start from (remembered). */
  readonly maxPixelRatio?: number;
  readonly minPixelRatio?: number;
  readonly startPixelRatio?: number | undefined;
  /** Frame-rate cap (undefined: the display's rate), and the rate while `isIdle()` holds. */
  readonly maxFps?: number | undefined;
  readonly idleFps?: number | undefined;
  readonly isIdle?: () => boolean;
  /** Called when the adaptive resolution changes the pixel ratio (to remember it). */
  readonly onPixelRatio?: (ratio: number) => void;
}

export class WebGLUnavailableError extends Error {
  constructor() {
    super('WebGL 2 is not available');
  }
}

/** Owns the WebGL renderer, the scene, the camera and the animation loop. */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 1, 1e6);
  private readonly resizeObserver: ResizeObserver;
  private frameCallback: ((dtS: number) => void) | undefined;
  private lastTimeMs: number | undefined;
  private readonly adaptive: AdaptiveResolution;
  private readonly display = new DisplayInterval();
  /** Container size, kept by the resize observer (reading it every frame could force a layout). */
  private widthPx = 0;
  private heightPx = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: RendererOptions = {},
  ) {
    const canvas = document.createElement('canvas');
    if (!canvas.getContext('webgl2')) throw new WebGLUnavailableError();
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: options.antialias ?? true,
      logarithmicDepthBuffer: options.logarithmicDepthBuffer ?? false,
    });
    const max = Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 2);
    const min = Math.min(max, options.minPixelRatio ?? max);
    this.adaptive = new AdaptiveResolution(options.startPixelRatio ?? max, min, max);
    this.applyPixelRatio(this.adaptive.pixelRatio);
    this.camera.matrixAutoUpdate = true;
    canvas.tabIndex = 0;
    // Focus ring only when the canvas was reached with Tab: Chrome would otherwise switch it on at the first
    // key press (Q/E, arrows) after a click on the view.
    canvas.addEventListener('pointerdown', () => canvas.classList.add('pointer-focus'));
    canvas.addEventListener('blur', () => canvas.classList.remove('pointer-focus'));
    // The 3D scene is an image for assistive technologies; the side panels carry the same content as text.
    canvas.setAttribute('role', 'img');
    container.appendChild(canvas);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get maxTextureSize(): number {
    return this.renderer.capabilities.maxTextureSize;
  }

  /** Sets near/far planes (km) around the visible content to keep depth precision. */
  setClipPlanes(nearKm: number, farKm: number): void {
    if (this.camera.near === nearKm && this.camera.far === farKm) return;
    this.camera.near = nearKm;
    this.camera.far = farKm;
    applyViewInset(this.camera, this.widthPx, this.heightPx);
  }

  get pixelRatio(): number {
    return this.adaptive.pixelRatio;
  }

  start(onFrame: (dtS: number) => void): void {
    this.frameCallback = onFrame;
    const { maxFps, idleFps, isIdle } = this.options;
    this.renderer.setAnimationLoop((timeMs: number) => {
      const idle = idleFps !== undefined && (isIdle?.() ?? false);
      const fps = idle ? idleFps : maxFps;
      this.display.record(timeMs);
      if (this.lastTimeMs !== undefined && !shouldDrawFrame(timeMs - this.lastTimeMs, fps, this.display.ms))
        return;
      const intervalMs = this.lastTimeMs === undefined ? 0 : timeMs - this.lastTimeMs;
      this.lastTimeMs = timeMs;
      // Idle frames are slow on purpose: they say nothing about what the device can sustain.
      if (!idle) {
        const ratio = this.adaptive.record(intervalMs);
        if (ratio !== undefined) {
          this.applyPixelRatio(ratio);
          this.resize();
          this.options.onPixelRatio?.(ratio);
        }
      }
      this.frameCallback?.(Math.min(0.1, intervalMs / 1000));
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Draws the scene now (photo mode reads the canvas right after, before the browser clears it). */
  renderNow(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private applyPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
    PIXEL_RATIO_UNIFORM.value = ratio;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.widthPx = w;
    this.heightPx = h;
    this.renderer.setSize(w, h, false);
    applyViewInset(this.camera, w, h);
  }

  /** Height (CSS px) covered by a bottom sheet: the projection centre moves to the visible part. */
  setBottomInset(insetPx: number): void {
    if (Math.round(insetPx) === bottomInsetPx(this.camera)) return;
    setBottomInset(this.camera, insetPx);
    this.resize();
  }
}
