/**
 * Illustrative Earth clouds (immersive effect `clouds`, high quality tier): a sphere 12 km above the surface
 * drawing the NASA Blue Marble cloud composite (not today's weather), plus the shadow the clouds cast on the
 * ground (BodyMesh, `clouds` option).
 *
 * The map is altered from a seed so the clouds differ between visits (src/render/cloudSeed.ts): shifted in
 * longitude only (the latitude bands of the climate stay where they are: tropical convergence zone, clear
 * subtropics, mid-latitude storm tracks), its systems distorted by a smooth noise of a few degrees, and its cover
 * thinned or thickened region by region. That is computed on the GPU into a cloud-cover texture (`CloudBaker`).
 *
 * The clouds follow the simulation clock: two such layers (src/render/simTime.ts `layerCycle`), each drifting
 * with the prevailing winds (easterly trade winds, mid-latitude westerlies, ~12 m/s) for two simulated days, then
 * cross-fading into a new one drawn from the tab's seed and its cycle number. The same date thus shows the same
 * clouds in every view, and no layer is ever blended with a shifted copy of itself.
 */
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { cloudSeed, cloudSeedParams } from './cloudSeed';
import { effectUniform } from './effects';
import { layerCycle } from './simTime';

/** Altitude of the cloud layer (km): about the top of deep convection; never below the camera's floor. */
export const CLOUD_ALTITUDE_KM = 12;
/** Life of a cloud layer (simulated seconds). */
const CLOUD_CYCLE_S = 2 * 86_400;
/** Largest cloud-cover texture baked (the source map is 4k at most). */
const MAX_BAKE_WIDTH = 4096;

export interface CloudUniforms {
  /** Seeded cloud cover of the two layers (0–1 in the red channel), from `CloudBaker`. */
  readonly cloudCoverA: { value: Texture };
  readonly cloudCoverB: { value: Texture };
  /** Simulated seconds each layer has drifted, and the weight of layer A. */
  readonly cloudAgeA: { value: number };
  readonly cloudAgeB: { value: number };
  readonly cloudWeightA: { value: number };
  readonly clouds: { value: number };
}

export function createCloudUniforms(empty: Texture): CloudUniforms {
  return {
    cloudCoverA: { value: empty },
    cloudCoverB: { value: empty },
    cloudAgeA: { value: 0 },
    cloudAgeB: { value: 0 },
    cloudWeightA: { value: 1 },
    clouds: effectUniform('clouds'),
  };
}

/**
 * GLSL: `float cloudDensity(vec2 uv, vec2 dx, vec2 dy)`, cloud cover (0–1) at a map position, with the UV
 * derivatives of the caller (the map wraps at the date line and the shadow lookup has its own UVs).
 */
export const CLOUD_GLSL = /* glsl */ `
  uniform sampler2D cloudCoverA;
  uniform sampler2D cloudCoverB;
  uniform float cloudAgeA;
  uniform float cloudAgeB;
  uniform float cloudWeightA;
  uniform float clouds;
  // Eastward drift (map fraction per simulated second): schematic prevailing winds, ~12 m/s easterly at the
  // equator and westerly at mid-latitudes, weak at the poles.
  float cloudDrift(float lat) {
    float windMs = -12.0 * cos(3.0 * lat);
    return windMs / (6.28318531 * 6.371e6 * max(cos(lat), 0.1));
  }
  float cloudDensity(vec2 uv, vec2 dx, vec2 dy) {
    float drift = cloudDrift((uv.y - 0.5) * 3.14159265);
    float a = textureGrad(cloudCoverA, vec2(uv.x - drift * cloudAgeA, uv.y), dx, dy).r;
    float b = textureGrad(cloudCoverB, vec2(uv.x - drift * cloudAgeB, uv.y), dx, dy).r;
    return mix(b, a, cloudWeightA);
  }
`;

const bakeVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const bakeFragmentShader = /* glsl */ `
  uniform sampler2D cloudMap;
  uniform float lonOffset;
  uniform vec3 noiseOffset;
  varying vec2 vUv;
  float cloudHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float cloudNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(cloudHash(i), cloudHash(i + vec3(1, 0, 0)), f.x), mix(cloudHash(i + vec3(0, 1, 0)), cloudHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(cloudHash(i + vec3(0, 0, 1)), cloudHash(i + vec3(1, 0, 1)), f.x), mix(cloudHash(i + vec3(0, 1, 1)), cloudHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float cloudFbm(vec3 p) {
    return 0.6 * cloudNoise(p) + 0.3 * cloudNoise(p * 2.03) + 0.1 * cloudNoise(p * 4.07);
  }
  void main() {
    float lat = (vUv.y - 0.5) * 3.14159265;
    float lon = (vUv.x - 0.5) * 6.28318531;
    // Noise on the sphere, not the map: no seam at the date line, no pinching at the poles.
    vec3 p = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
    vec3 q = p * 2.5 + noiseOffset;
    vec2 warp = vec2(cloudFbm(q), cloudFbm(q + 19.1)) - 0.5;
    float x = vUv.x + lonOffset + warp.x * 0.03 / max(cos(lat), 0.2);
    float y = clamp(vUv.y + warp.y * 0.02, 0.0, 1.0);
    float c = textureLod(cloudMap, vec2(fract(x), y), 0.0).r;
    // The map is decoded as sRGB: back to its encoded value, the cover as drawn in the image.
    c = pow(c, 1.0 / 2.2);
    // Cover thinned or thickened by region.
    // Thickening is kept slight: a lower threshold turns the map's thin haze into a uniform veil.
    float k = max((cloudFbm(p * 1.7 + noiseOffset.zxy) - 0.5) * 0.6, -0.05);
    gl_FragColor = vec4(smoothstep(0.15 + k, 0.72 + k, c), 0.0, 0.0, 1.0);
  }
`;

/** Seed of one drawing of a layer: the tab's seed mixed with the cycle number and the layer. */
function layerSeed(index: number, layer: number): number {
  return (
    (Math.imul(cloudSeed() ^ Math.imul(index * 2 + layer, 0x9e3779b1), 0x85ebca6b) ^ (index >>> 3)) >>> 0
  );
}

/** Bakes the two layers' seeded cover from the cloud map as the simulation clock moves on (see the header). */
export class CloudBaker {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private source: Texture | undefined;
  private readonly targets: (WebGLRenderTarget | undefined)[] = [undefined, undefined];
  /** Cycle number baked into each layer (NaN: none yet). */
  private readonly baked = [Number.NaN, Number.NaN];

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly uniforms: CloudUniforms,
  ) {
    this.material = new ShaderMaterial({
      uniforms: {
        cloudMap: { value: null },
        lonOffset: { value: 0 },
        noiseOffset: { value: new Vector3() },
      },
      vertexShader: bakeVertexShader,
      fragmentShader: bakeFragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** A new level of the cloud map (the previous one is freed): both layers are baked again. */
  setSource(map: Texture): void {
    this.source?.dispose();
    this.source = map;
    const image = map.image as { width?: number } | undefined;
    const width = Math.min(MAX_BAKE_WIDTH, image?.width ?? 2048, this.renderer.capabilities.maxTextureSize);
    for (let layer = 0; layer < 2; layer++) {
      this.targets[layer]?.dispose();
      const target = new WebGLRenderTarget(width, width / 2, {
        format: RedFormat,
        depthBuffer: false,
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        magFilter: LinearFilter,
        wrapS: RepeatWrapping,
      });
      target.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.targets[layer] = target;
      this.baked[layer] = Number.NaN;
    }
    this.uniforms.cloudCoverA.value = this.targets[0]?.texture ?? map;
    this.uniforms.cloudCoverB.value = this.targets[1]?.texture ?? map;
  }

  /** Before each frame: layer ages and weights, and a new drawing for a layer starting a new cycle. */
  update(timeMs: number): void {
    const cycle = layerCycle(timeMs, CLOUD_CYCLE_S);
    this.uniforms.cloudAgeA.value = cycle.ageA;
    this.uniforms.cloudAgeB.value = cycle.ageB;
    this.uniforms.cloudWeightA.value = cycle.weightA;
    this.bakeLayer(0, cycle.indexA);
    this.bakeLayer(1, cycle.indexB);
  }

  private bakeLayer(layer: number, index: number): void {
    const target = this.targets[layer];
    if (!this.source || !target || this.baked[layer] === index) return;
    this.baked[layer] = index;
    const { lonOffset, noiseOffset } = cloudSeedParams(layerSeed(index, layer));
    const u = this.material.uniforms;
    (u['cloudMap'] as { value: Texture | null }).value = this.source;
    (u['lonOffset'] as { value: number }).value = lonOffset;
    (u['noiseOffset'] as { value: Vector3 }).value.set(...noiseOffset);
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousTarget);
  }

  dispose(): void {
    for (const target of this.targets) target?.dispose();
    this.source?.dispose();
    this.material.dispose();
    for (const child of this.scene.children) (child as Mesh).geometry.dispose();
  }
}

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormalW;
  ${CLOUD_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    float d = cloudDensity(vUv, dFdx(vUv), dFdy(vUv)) * clouds;
    if (d < 0.004) discard;
    float cosSun = dot(normalize(vNormalW), sunDirection);
    float light = clamp(cosSun * 1.1 + 0.12, 0.0, 1.0);
    // Reddened by the long path through the air near the terminator; nearly black at night.
    vec3 tint = mix(vec3(1.0, 0.62, 0.42), vec3(1.0), smoothstep(0.0, 0.3, cosSun));
    gl_FragColor = vec4(tint * (0.012 + 0.988 * light), d * 0.95);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The cloud sphere; add it as a child of the Earth mesh so it turns with the Earth. */
export class CloudLayer {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;

  constructor(radiusKm: number, uniforms: CloudUniforms, sunDirection: Vector3) {
    const geometry = new SphereGeometry(radiusKm + CLOUD_ALTITUDE_KM, 160, 80);
    // Z-up like BodyMesh (same UVs: prime meridian at u = 0.5 on +X).
    geometry.rotateX(Math.PI / 2);
    const material = new ShaderMaterial({
      uniforms: { ...uniforms, sunDirection: { value: sunDirection } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'clouds';
    this.mesh.renderOrder = 1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
