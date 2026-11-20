/**
 * The Sun's glare and lens flare (immersive effect `sunGlare`, high tier): a blinding core and bloom around the
 * Sun, diffraction spikes, a horizontal anamorphic streak (HUD look), a faint veil over the whole view, and
 * ghosts of the lens aperture along the line from the Sun through the centre of the screen. One full-screen
 * additive pass, analytic in screen pixels, drawn after everything else.
 *
 * Its strength is the part of the Sun's disc in sight (the view gives the bodies in front and the selected 3D
 * model each frame, src/render/sunVisibility.ts: markers and satellites never count) times a power falling with
 * the distance from the Sun (faint from Voyager 1).
 *
 * Farther than NEAR_KM from the Sun, the photosphere mesh is hidden: the Sun is a blinding white disc of glare.
 * Within it, the mesh fades in, left untouched so the sunspots stay readable (the glare starts at the limb and
 * fades as the disc grows on screen), and the view dims behind it like an airliner's electrochromic window, at
 * the same pace: a quick tint creeping in from the edges of the view, the stars and the other objects nearly gone,
 * the Sun's surface kept bright. Without the effect the mesh is always drawn.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  SrcColorFactor,
  Vector2,
  Vector3,
  Vector4,
  ZeroFactor,
  type Camera,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import type { SunMesh } from './SunMesh';
import type { Vec3 } from '../astro/vec3';
import { effectUniform } from './effects';
import { glarePower, sunDiscSamples, sunDiscVisible, type SunOccluderSphere } from './sunVisibility';

/** Distance from the Sun's centre within which its mesh is drawn and the window dims (km), and the one beyond
 * which they go again (hysteresis). */
const NEAR_KM = 10e6;
const FAR_KM = 10.5e6;
/** Duration of the window's tint change (s). */
const DIM_S = 0.6;

const vertexShader = /* glsl */ `
  uniform float uVis;
  uniform float uStrength;
  void main() {
    // Nothing to draw: the triangle is put outside the clip volume, so no fragment runs.
    gl_Position = uVis * uStrength > 0.001 ? vec4(position.xy, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec2 uSun;
  uniform vec4 uViewport;
  uniform float uDisc;
  uniform float uStrength;
  uniform float uEdge;
  uniform float uTime;
  uniform float uVis;
  uniform float uMesh;
  uniform float uDim;

  // Soft disc (round or hexagonal, like a six-blade aperture), slightly brighter towards its rim.
  float ghost(vec2 p, vec2 c, float radius, float hex) {
    vec2 q = abs(p - c) / radius;
    float d = mix(length(q), max(q.x * 0.866025 + q.y * 0.5, q.y), hex);
    return (1.0 - smoothstep(0.82, 1.0, d)) * (0.55 + 0.45 * smoothstep(0.3, 0.95, d));
  }

  void main() {
    vec2 frag = gl_FragCoord.xy;
    float u = min(uViewport.z, uViewport.w);
    vec2 d = frag - uSun;
    float r = length(d);
    float e = max(r - uDisc, 0.0);
    // A resolved disc keeps its surface (sunspots) and only a faint rim; a point-like Sun is a blinding star.
    float resolved = smoothstep(0.015 * u, 0.12 * u, uDisc);
    float seen = uVis * uStrength * uEdge;
    float dazzle = mix(1.0, 0.1, resolved) * seen;
    // Over the drawn mesh nothing is added (sunspots); without it the disc itself is the glare, white-hot.
    float limb = smoothstep(uDisc - 1.0, uDisc + 1.5, r);
    float outside = mix(1.0, limb, smoothstep(0.004 * u, 0.02 * u, uDisc) * uMesh);
    vec3 disc = vec3(1.0, 0.97, 0.9) * (1.0 - limb) * (1.0 - uMesh) * seen;

    vec3 glare = vec3(0.0);
    // White-hot core and warm bloom with a long tail.
    glare += vec3(1.0, 0.96, 0.88) * 1.4 * exp(-e / (0.012 * u));
    glare += vec3(1.0, 0.82, 0.55) * (0.45 * exp(-e / (0.05 * u)) + 0.16 / (1.0 + pow(e / (0.12 * u), 2.0)));
    // Diffraction spikes (six, and six fainter between them) and fine irregular streaks, slowly shimmering.
    float a = atan(d.y, d.x);
    float spikes = pow(abs(cos(a * 3.0 + 0.3)), 220.0) + 0.5 * pow(abs(cos(a * 3.0 + 0.8236)), 500.0);
    float streaks = pow(0.5 + 0.5 * sin(a * 41.0 + 3.0 * sin(a * 7.0) + uTime * 0.05), 12.0)
      * (0.5 + 0.5 * sin(a * 17.0 - uTime * 0.03));
    glare += vec3(1.0, 0.95, 0.85)
      * (0.9 * spikes * exp(-e / (0.22 * u)) + 0.12 * streaks * exp(-e / (0.1 * u)))
      * smoothstep(0.0, 0.01 * u, e + 0.002 * u);
    // Horizontal anamorphic streak, cyan-tinted.
    glare += vec3(0.45, 0.75, 1.0) * 0.45 * exp(-abs(d.y) / (0.0028 * u)) * exp(-abs(d.x) / (0.45 * u));
    // Veiling glare over the whole view.
    glare += vec3(1.0, 0.9, 0.75) * 0.07 * exp(-r / (0.9 * u));

    // Aperture ghosts along the line from the Sun through the centre of the view, and a thin chromatic ring.
    vec2 axis = uViewport.xy + 0.5 * uViewport.zw - uSun;
    vec3 ghosts = vec3(0.0);
    ghosts += vec3(1.0, 0.55, 0.25) * 0.16 * ghost(frag, uSun + axis * 0.35, 0.018 * u, 0.0);
    ghosts += vec3(0.35, 0.75, 0.45) * 0.08 * ghost(frag, uSun + axis * 0.7, 0.045 * u, 1.0);
    ghosts += vec3(0.55, 0.4, 1.0) * 0.1 * ghost(frag, uSun + axis * 1.25, 0.03 * u, 1.0);
    ghosts += vec3(0.3, 0.6, 1.0) * 0.05 * ghost(frag, uSun + axis * 1.55, 0.09 * u, 0.0);
    ghosts += vec3(1.0, 0.75, 0.35) * 0.15 * ghost(frag, uSun + axis * 1.85, 0.02 * u, 0.0);
    ghosts += vec3(0.8, 0.35, 0.6) * 0.06 * ghost(frag, uSun + axis * 2.2, 0.06 * u, 1.0);
    vec3 ring = vec3(
      exp(-pow((r - 0.337 * u) / (0.01 * u), 2.0)),
      exp(-pow((r - 0.33 * u) / (0.01 * u), 2.0)),
      exp(-pow((r - 0.323 * u) / (0.01 * u), 2.0)));
    ghosts += ring * 0.06;

    // The window dims the glare too (it is drawn after the window's pass, like the markers and lines).
    vec3 color = ((glare * dazzle + ghosts * seen * mix(1.0, 0.25, resolved)) * outside + disc) * (1.0 - 0.85 * uDim);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const dimVertexShader = /* glsl */ `
  uniform float uDim;
  void main() {
    gl_Position = uDim > 0.0 ? vec4(position.xy, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

/** Multiplies the frame: a dark blue tint, light on the Sun's disc, creeping in from the edges of the view. */
const dimFragmentShader = /* glsl */ `
  uniform float uDim;
  uniform vec2 uSun;
  uniform float uDisc;
  uniform vec4 uViewport;
  void main() {
    vec2 q = (gl_FragCoord.xy - uViewport.xy - 0.5 * uViewport.zw) / (0.5 * uViewport.zw);
    float edge = clamp(max(abs(q.x), abs(q.y)), 0.0, 1.0);
    float local = smoothstep(0.0, 1.0, uDim * 1.6 - (1.0 - edge) * 0.6);
    float onDisc = 1.0 - smoothstep(uDisc - 1.5, uDisc + 1.5, length(gl_FragCoord.xy - uSun));
    vec3 tint = mix(vec3(0.12, 0.17, 0.27), vec3(1.0), onDisc);
    gl_FragColor = vec4(mix(vec3(1.0), tint, local), 1.0);
  }
`;

export class SunGlare {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** The window tint (multiplies the frame), drawn before the markers, lines and glare. */
  readonly dim: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly world = new Vector3();
  private readonly view = new Vector3();
  private readonly viewport = new Vector4();
  private visible = 0;
  private power = 0;
  /** Within NEAR_KM of the Sun (hysteresis): mesh drawn, window allowed. */
  private near = true;
  private dimProgress = 0;
  /** Mesh fade (0 hidden, 1 drawn); undefined until the first update, which sets it at once. */
  private meshProgress: number | undefined;
  private lastMs: number | undefined;

  /** `sun`: the photosphere mesh, whose world position is the Sun's centre. */
  constructor(
    private readonly sun: SunMesh,
    private readonly radiusKm: number,
  ) {
    const geometry = new BufferGeometry();
    // One triangle covering the screen.
    geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const shared = {
      uSun: { value: new Vector2() },
      uViewport: { value: this.viewport },
      uDisc: { value: 0 },
      uDim: { value: 0 },
    };
    this.mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: {
          ...shared,
          uVis: { value: 0 },
          uEdge: { value: 0 },
          uTime: { value: 0 },
          uMesh: { value: 1 },
          uStrength: effectUniform('sunGlare'),
        },
        vertexShader,
        fragmentShader,
        blending: AdditiveBlending,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.mesh.name = 'sun-glare';
    this.mesh.frustumCulled = false;
    // After everything else.
    this.mesh.renderOrder = 1e9;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.prepare(renderer, camera);
    this.dim = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: shared,
        vertexShader: dimVertexShader,
        fragmentShader: dimFragmentShader,
        blending: CustomBlending,
        blendSrc: ZeroFactor,
        blendDst: SrcColorFactor,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.dim.name = 'sun-window';
    this.dim.frustumCulled = false;
    // Opaque pass, after the sky, the stars, the bodies and the models (renderOrder ≤ 0) but before the
    // depth-tested markers (5) and the whole transparent pass (the Sun, lines, rings, glare): only the
    // background and the other objects are dimmed, the markers, lines and labels stay readable.
    this.dim.renderOrder = 4;
  }

  /** Both passes, to add to and remove from the scene. */
  get objects(): readonly Object3D[] {
    return [this.mesh, this.dim];
  }

  /**
   * Called by the view each frame (one frame, km): the camera, the Sun's centre, the bodies that may stand in
   * front, and the selected 3D model's ray test while one is drawn.
   */
  update(
    cameraKm: Vec3,
    sunKm: Vec3,
    spheres: readonly SunOccluderSphere[],
    modelBlocks?: (pointKm: Vec3) => boolean,
  ): void {
    let visible = sunDiscVisible(cameraKm, sunKm, this.radiusKm, spheres);
    if (visible > 0 && modelBlocks) {
      const samples = sunDiscSamples(cameraKm, sunKm, this.radiusKm);
      const blocked = samples.filter((p) => modelBlocks(p)).length;
      visible *= 1 - blocked / samples.length;
    }
    this.visible = visible;
    const distanceKm = Math.hypot(sunKm[0] - cameraKm[0], sunKm[1] - cameraKm[1], sunKm[2] - cameraKm[2]);
    this.power = glarePower(distanceKm);
    this.near = distanceKm < (this.near ? FAR_KM : NEAR_KM);
    // The page opens with the mesh as it should be, without a fade.
    if (this.meshProgress === undefined) {
      this.meshProgress = this.near ? 1 : 0;
      this.dimProgress = this.near ? 1 : 0;
    }
  }

  private prepare(renderer: WebGLRenderer, camera: Camera): void {
    const u = this.mesh.material.uniforms;
    const vis = u['uVis'] as { value: number };
    vis.value = 0;
    const on = (u['uStrength'] as { value: number }).value > 0;
    const discPx = on ? this.place(renderer, camera) : undefined;
    if (discPx !== undefined) vis.value = this.visible * this.power;
    // Near the Sun: the mesh fades in (far away the glare alone draws it; without the effect the mesh always
    // does) and the window dims while the Sun is in sight, both at the same pace.
    const now = performance.now();
    const dtS = this.lastMs === undefined ? 0 : Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    const step = dtS / DIM_S;
    const towards = (value: number, target: boolean): number =>
      Math.min(1, Math.max(0, value + (target ? step : -step)));
    this.meshProgress = on ? towards(this.meshProgress ?? 1, this.near) : 1;
    this.dimProgress = towards(this.dimProgress, on && this.near && discPx !== undefined);
    const ease = (p: number): number => p * p * (3 - 2 * p);
    const mesh = ease(this.meshProgress);
    this.sun.setOpacity(mesh);
    (u['uMesh'] as { value: number }).value = mesh;
    (this.dim.material.uniforms['uDim'] as { value: number }).value = ease(this.dimProgress);
  }

  /** Puts the Sun on the screen (uniforms); its disc radius in device px, undefined when not in front. */
  private place(renderer: WebGLRenderer, camera: Camera): number | undefined {
    const u = this.mesh.material.uniforms;
    this.sun.mesh.getWorldPosition(this.world);
    const v = this.view.copy(this.world).applyMatrix4(camera.matrixWorldInverse);
    if (v.z >= 0) return undefined;
    const distanceKm = v.length();
    if (distanceKm <= this.radiusKm) return undefined;
    renderer.getCurrentViewport(this.viewport);
    const vp = this.viewport;
    v.applyMatrix4(camera.projectionMatrix);
    const x = vp.x + (v.x * 0.5 + 0.5) * vp.z;
    const y = vp.y + (v.y * 0.5 + 0.5) * vp.w;
    const discPx =
      Math.tan(Math.asin(this.radiusKm / distanceKm)) *
      (camera.projectionMatrix.elements[5] ?? 1) *
      vp.w *
      0.5;
    // The flare needs the centre on screen (fading over the last 4 %); the window only part of the disc.
    const edgePx = Math.min(x - vp.x, vp.x + vp.z - x, y - vp.y, vp.y + vp.w - y);
    if (edgePx <= -discPx) return undefined;
    const t = Math.min(1, Math.max(0, edgePx / (Math.min(vp.z, vp.w) * 0.04)));
    (u['uEdge'] as { value: number }).value = t * t * (3 - 2 * t);
    (u['uSun']?.value as Vector2).set(x, y);
    (u['uDisc'] as { value: number }).value = discPx;
    (u['uTime'] as { value: number }).value = (performance.now() / 1000) % 100_000;
    return discPx;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.dim.material.dispose();
  }
}
