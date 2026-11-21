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
  FramebufferTexture,
  LinearFilter,
  Mesh,
  NoBlending,
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
import { warpFront } from './WarpBubble';
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

    // Aperture ghosts along the line from the Sun through the centre of the view (stacked on the Sun when it is
    // looked at straight on), and a thin chromatic ring.
    vec2 axis = uViewport.xy + 0.5 * uViewport.zw - uSun;
    vec3 ghosts = vec3(0.0);
    ghosts += vec3(1.0, 0.55, 0.25) * 0.22 * ghost(frag, uSun + axis * 0.35, 0.018 * u, 0.0);
    ghosts += vec3(0.35, 0.75, 0.45) * 0.12 * ghost(frag, uSun + axis * 0.7, 0.045 * u, 1.0);
    ghosts += vec3(0.55, 0.4, 1.0) * 0.14 * ghost(frag, uSun + axis * 1.25, 0.03 * u, 1.0);
    ghosts += vec3(0.3, 0.6, 1.0) * 0.07 * ghost(frag, uSun + axis * 1.55, 0.09 * u, 0.0);
    ghosts += vec3(1.0, 0.75, 0.35) * 0.2 * ghost(frag, uSun + axis * 1.85, 0.02 * u, 0.0);
    ghosts += vec3(0.8, 0.35, 0.6) * 0.09 * ghost(frag, uSun + axis * 2.2, 0.06 * u, 1.0);
    vec3 ring = vec3(
      exp(-pow((r - 0.337 * u) / (0.01 * u), 2.0)),
      exp(-pow((r - 0.33 * u) / (0.01 * u), 2.0)),
      exp(-pow((r - 0.323 * u) / (0.01 * u), 2.0)));
    ghosts += ring * 0.06;

    // The lens flare follows the glare's power and fades out as the Sun's mesh fades in (near the Sun).
    // The window dims the glare too (it is drawn after the window's pass, like the markers and lines).
    vec3 color = ((glare * dazzle + ghosts * seen * (1.0 - uMesh)) * outside + disc) * (1.0 - 0.85 * uDim);
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

/**
 * Spacecraft window (immersive effect `glass`, high tier, all views): a faint cool haze, smudges, dust and fine
 * polishing scratches on a pane with no visible frame, almost invisible until the Sun lights them up around its
 * place on screen (even just off screen).
 */
const glassVertexShader = /* glsl */ `
  uniform float uGlass;
  void main() {
    gl_Position = uGlass > 0.0 ? vec4(position.xy, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const glassFragmentShader = /* glsl */ `
  uniform float uGlass;
  uniform vec4 uViewport;
  uniform vec2 uSun;
  uniform float uSunLight;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * noise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec2 frag = gl_FragCoord.xy - uViewport.xy;
    float u = min(uViewport.z, uViewport.w);
    // Pane coordinates: fixed to the screen, independent of its size.
    vec2 p = frag / u;
    // Smudges: soft blotches at two scales.
    float smudge = smoothstep(0.55, 0.85, fbm(p * 2.6 + 7.3)) * 0.7 + smoothstep(0.6, 0.9, fbm(p * 8.0 + 1.7)) * 0.3;
    // Dust: sparse specks.
    vec2 cell = floor(p * 70.0);
    vec2 offset = vec2(hash(cell + 3.1), hash(cell + 9.7)) - 0.5;
    float speck = step(0.996, hash(cell)) * (1.0 - smoothstep(0.05, 0.18, length(fract(p * 70.0) - 0.5 - offset * 0.5)));
    // Polishing scratches: hairline arcs around a point off the pane, in short broken segments.
    vec2 c = p - vec2(-0.6, 1.7);
    float ring = length(c) * 55.0;
    float hair = 1.0 - smoothstep(0.0, 0.06, abs(fract(ring + 0.4 * noise(p * 6.0)) - 0.5));
    float scratch = hair * smoothstep(0.88, 0.97, noise(vec2(floor(ring) * 3.7, atan(c.y, c.x) * 30.0)));
    // Sunlight scattered by the dirt, strongest around the Sun's place.
    float dist = length(gl_FragCoord.xy - uSun) / u;
    float light = uSunLight * (exp(-dist / 0.22) + 0.12 * exp(-dist / 0.9));
    vec3 lit = vec3(1.0, 0.93, 0.8) * (0.22 * smudge + 0.2 * speck + 0.1 * scratch) * light;
    // Unlit: a faint cool haze, barely visible smudges and a soft diagonal sheen of the glass.
    float sheen = exp(-pow((p.x * 0.6 + p.y - 0.9) / 0.35, 2.0));
    vec3 ambient = vec3(0.004, 0.007, 0.01) + vec3(0.7, 0.85, 1.0) * (0.006 * smudge + 0.008 * sheen);
    gl_FragColor = vec4((lit + ambient) * uGlass, 1.0);
  }
`;

/**
 * The pane is slightly curved: near the edges of the view the image is magnified a little, with a faint colour
 * fringe, from a copy of the frame (glare included) taken just before this pass. The centre is left untouched.
 */
const refractFragmentShader = /* glsl */ `
  uniform sampler2D uFrame;
  uniform vec2 uFrameSize;
  uniform vec4 uViewport;
  void main() {
    vec2 frag = gl_FragCoord.xy - uViewport.xy;
    vec2 q = frag / uViewport.zw * 2.0 - 1.0;
    // Rounded-rectangle distance from the centre: 0 there, 1 on the edges, more in the corners.
    vec2 a = abs(q);
    float s = pow(pow(a.x, 4.0) + pow(a.y, 4.0), 0.25);
    float w = smoothstep(0.6, 1.25, s);
    w *= w;
    if (w <= 0.0) discard;
    // Sampled towards the centre: the content near the edges is stretched outwards.
    vec2 shift = q / max(s, 1e-3) * w * 0.009 * min(uViewport.z, uViewport.w);
    vec2 px = 1.0 / uFrameSize;
    vec3 color = vec3(
      texture2D(uFrame, (gl_FragCoord.xy - shift * 0.9) * px).r,
      texture2D(uFrame, (gl_FragCoord.xy - shift) * px).g,
      texture2D(uFrame, (gl_FragCoord.xy - shift * 1.12) * px).b);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export class SunGlare {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** The window tint (multiplies the frame), drawn before the markers, lines and glare. */
  readonly dim: Mesh<BufferGeometry, ShaderMaterial>;
  /** The spacecraft window's pane, drawn last. */
  readonly glass: Mesh<BufferGeometry, ShaderMaterial>;
  /** The pane's curved edges, redrawing a copy of the frame. */
  readonly refract: Mesh<BufferGeometry, ShaderMaterial>;
  private frame: FramebufferTexture | undefined;
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
    this.glass = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: {
          uSun: shared.uSun,
          uViewport: shared.uViewport,
          uSunLight: { value: 0 },
          uGlass: effectUniform('glass'),
        },
        vertexShader: glassVertexShader,
        fragmentShader: glassFragmentShader,
        blending: AdditiveBlending,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.glass.name = 'window-glass';
    this.glass.frustumCulled = false;
    // After the refraction: the dirt is on the pane's surface.
    this.glass.renderOrder = 1e9 + 2;
    const glassOn = effectUniform('glass');
    const refractOn = { value: 0 };
    const frameSize = new Vector2();
    this.refract = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: {
          uGlass: refractOn,
          uViewport: shared.uViewport,
          uFrame: { value: null },
          uFrameSize: { value: frameSize },
        },
        vertexShader: glassVertexShader,
        fragmentShader: refractFragmentShader,
        blending: NoBlending,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.refract.name = 'window-refraction';
    this.refract.frustumCulled = false;
    this.refract.renderOrder = 1e9 + 1;
    this.refract.onBeforeRender = (renderer) => {
      // The canvas only (not the picking pass): the frame drawn so far, glare included, is copied and redrawn
      // through the curved edges.
      refractOn.value = glassOn.value > 0 && renderer.getRenderTarget() === null ? 1 : 0;
      if (refractOn.value === 0) return;
      renderer.getDrawingBufferSize(frameSize);
      const w = Math.floor(frameSize.x);
      const h = Math.floor(frameSize.y);
      if (this.frame?.image.width !== w || this.frame.image.height !== h) {
        this.frame?.dispose();
        this.frame = new FramebufferTexture(w, h);
        this.frame.minFilter = LinearFilter;
        this.frame.magFilter = LinearFilter;
        (this.refract.material.uniforms['uFrame'] as { value: unknown }).value = this.frame;
      }
      renderer.copyFramebufferToTexture(this.frame);
    };
  }

  /** The passes, to add to and remove from the scene. */
  get objects(): readonly Object3D[] {
    return [this.mesh, this.dim, this.refract, this.glass];
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
    const front = this.place(renderer, camera);
    const discPx = on && front?.onScreen ? front.discPx : undefined;
    // Beyond the speed of light, no light comes from behind the motion (warp bubble).
    const seen = front
      ? this.visible * this.power * warpFront(this.view.copy(this.world).sub(camera.position))
      : 0;
    if (discPx !== undefined) vis.value = seen;
    (this.glass.material.uniforms['uSunLight'] as { value: number }).value =
      seen * (1 - 0.85 * (u['uDim'] as { value: number }).value);
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

  /**
   * Puts the Sun on the screen (uniforms): undefined when behind the camera; else its disc radius in device px
   * and whether part of the disc is on screen.
   */
  private place(renderer: WebGLRenderer, camera: Camera): { discPx: number; onScreen: boolean } | undefined {
    const u = this.mesh.material.uniforms;
    renderer.getCurrentViewport(this.viewport);
    const vp = this.viewport;
    this.sun.mesh.getWorldPosition(this.world);
    const v = this.view.copy(this.world).applyMatrix4(camera.matrixWorldInverse);
    if (v.z >= 0) return undefined;
    const distanceKm = v.length();
    if (distanceKm <= this.radiusKm) return undefined;
    v.applyMatrix4(camera.projectionMatrix);
    const x = vp.x + (v.x * 0.5 + 0.5) * vp.z;
    const y = vp.y + (v.y * 0.5 + 0.5) * vp.w;
    const discPx =
      Math.tan(Math.asin(this.radiusKm / distanceKm)) *
      (camera.projectionMatrix.elements[5] ?? 1) *
      vp.w *
      0.5;
    // The flare needs the centre on screen (fading over the last 4 %); the window only part of the disc; the
    // pane's dirt is lit from just off screen too.
    const edgePx = Math.min(x - vp.x, vp.x + vp.z - x, y - vp.y, vp.y + vp.w - y);
    const t = Math.min(1, Math.max(0, edgePx / (Math.min(vp.z, vp.w) * 0.04)));
    (u['uEdge'] as { value: number }).value = t * t * (3 - 2 * t);
    (u['uSun']?.value as Vector2).set(x, y);
    (u['uDisc'] as { value: number }).value = discPx;
    (u['uTime'] as { value: number }).value = (performance.now() / 1000) % 100_000;
    return { discPx, onScreen: edgePx > -discPx };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.dim.material.dispose();
    this.glass.material.dispose();
    this.refract.material.dispose();
    this.frame?.dispose();
  }
}
