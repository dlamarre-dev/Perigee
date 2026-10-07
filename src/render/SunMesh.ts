/**
 * The Sun's visible surface (photosphere), procedural: quadratic limb darkening (visible-light coefficients
 * u₁ ≈ 0.47, u₂ ≈ 0.23; Cox, Allen's Astrophysical Quantities, 2000) and animated granulation (cells of ~1000 km)
 * over larger supergranulation mottling. No sunspots: a fixed map of them would be wrong on any given day.
 * Fine noise octaves fade with their screen-space frequency, so the disc does not shimmer when seen from afar.
 */
import { keepInPhoto } from './photo';
import {
  AdditiveBlending,
  CanvasTexture,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Scene,
} from 'three';
import type { Vec3 } from '../astro/vec3';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vObject;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  void main() {
    vObject = normalize(position);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vPositionW = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  varying vec3 vObject;
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  // Octave weight: 1 while a noise cell spans several pixels, 0 once it is smaller than a pixel.
  float visible(float frequency, float pixel) {
    return 1.0 - smoothstep(0.25, 1.0, frequency * pixel);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vPositionW);
    float mu = clamp(dot(n, viewDir), 0.0, 1.0);
    float limb = 1.0 - 0.47 * (1.0 - mu) - 0.23 * (1.0 - mu) * (1.0 - mu);
    float pixel = length(fwidth(vObject));
    // Granulation (~700 cells per solar radius), mesogranulation (~150) and supergranulation (~25), slowly
    // evolving; each scale fades once its cells get smaller than a pixel.
    // Octaves whose weight is zero are skipped (8 hashes each): seen from afar only the coarse ones remain.
    float t = uTime * 0.02;
    float w700 = visible(700.0, pixel);
    float w1400 = visible(1400.0, pixel);
    float w150 = visible(150.0, pixel);
    float gran = 0.0;
    if (w700 > 0.0) gran += (noise(vObject * 700.0 + vec3(t)) - 0.5) * w700;
    if (w1400 > 0.0) gran += 0.5 * (noise(vObject * 1400.0 - vec3(t)) - 0.5) * w1400;
    float meso = w150 > 0.0 ? (noise(vObject * 150.0 - vec3(t * 0.2)) - 0.5) * w150 : 0.0;
    float mottle = (noise(vObject * 25.0 + vec3(t * 0.05)) - 0.5) * visible(25.0, pixel);
    float intensity = limb * (1.0 + 0.16 * gran + 0.10 * meso + 0.08 * mottle);
    // Warmer towards the limb, where one sees higher, cooler layers (linear RGB; about sRGB #FFCE7C at the centre).
    vec3 centre = vec3(1.0, 0.62, 0.2);
    vec3 edge = vec3(0.8, 0.2, 0.025);
    vec3 color = mix(edge, centre, pow(mu, 0.6)) * intensity;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SunMesh {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;

  constructor(radiusKm: number) {
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader,
      fragmentShader,
    });
    this.mesh = new Mesh(new SphereGeometry(radiusKm, 128, 64), material);
    this.mesh.name = 'sun';
    this.mesh.onBeforeRender = () => {
      const uniform = material.uniforms['uTime'];
      if (uniform) uniform.value = (performance.now() / 1000) % 100_000;
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function glowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.25, 'rgba(255,210,120,0.6)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

/** Screen-sized halo around the Sun (additive; hidden by bodies in front through the depth test). */
export function createSunGlow(screenFraction = 0.05): Sprite {
  const glow = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      blending: AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    }),
  );
  glow.scale.set(screenFraction, screenFraction, 1);
  glow.name = 'sun-glow';
  // Part of the Sun's look: kept in the photo without markers.
  keepInPhoto(glow);
  return glow;
}

/**
 * The Sun seen from a planet or a moon (Earth, Moon and Mars views): photosphere at its true size and distance
 * plus its glow, placed camera-relative in Float64 (positions up to ~2.5e8 km). Bodies in front hide it
 * through the depth buffer, eclipses included.
 */
export class DistantSun {
  readonly sun: SunMesh;
  readonly glow: Sprite;

  constructor(
    private readonly scene: Scene,
    radiusKm: number,
    glowFraction = 0.04,
  ) {
    this.sun = new SunMesh(radiusKm);
    this.glow = createSunGlow(glowFraction);
    scene.add(this.sun.mesh, this.glow);
  }

  /** `sceneKm`: the Sun centre in the scene frame; `originKm`: the camera (floating origin). */
  place(sceneKm: Vec3, originKm: Vec3): void {
    const x = sceneKm[0] - originKm[0];
    const y = sceneKm[1] - originKm[1];
    const z = sceneKm[2] - originKm[2];
    this.sun.mesh.position.set(x, y, z);
    this.glow.position.set(x, y, z);
  }

  dispose(): void {
    this.scene.remove(this.sun.mesh, this.glow);
    this.sun.dispose();
    this.glow.material.map?.dispose();
    this.glow.material.dispose();
  }
}
