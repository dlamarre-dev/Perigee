import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export interface RendererOptions {
  /** Needed for view D (solar system) where depth spans many orders of magnitude. */
  readonly logarithmicDepthBuffer?: boolean;
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

  constructor(
    private readonly container: HTMLElement,
    options: RendererOptions = {},
  ) {
    const canvas = document.createElement('canvas');
    if (!canvas.getContext('webgl2')) throw new WebGLUnavailableError();
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: options.logarithmicDepthBuffer ?? false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.matrixAutoUpdate = true;
    canvas.tabIndex = 0;
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
    this.camera.updateProjectionMatrix();
  }

  start(onFrame: (dtS: number) => void): void {
    this.frameCallback = onFrame;
    this.renderer.setAnimationLoop((timeMs: number) => {
      const dtS = this.lastTimeMs === undefined ? 0 : Math.min(0.1, (timeMs - this.lastTimeMs) / 1000);
      this.lastTimeMs = timeMs;
      this.frameCallback?.(dtS);
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
