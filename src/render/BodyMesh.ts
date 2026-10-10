/**
 * Textured, Sun-lit sphere for a central body (Earth, Moon, Mars…).
 * Geometry is Z-up (north pole on +Z, prime meridian on +X, 90°E on +Y) to match the body-fixed astro frames.
 * Uses Three.js logarithmic depth chunks: the renderer always runs with a logarithmic depth buffer.
 */
import {
  Mesh,
  PerspectiveCamera,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Raycaster,
  Vector2,
  Vector3,
  type Texture,
} from 'three';
import type { Quat } from '../astro/quat';
import type { Vec3 } from '../astro/vec3';
import { CLOUD_GLSL, type CloudUniforms } from './clouds';
import { effectUniform } from './effects';
import { quality } from './quality';
import { layerCycle, simTimeMs } from './simTime';
import { placeholderTexture } from './textures';
import { PICK_LAYER } from './SatellitePoints';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform vec3 patchOffset;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  varying vec3 vBody;
  varying vec3 vSunBody;
  void main() {
    vUv = uv;
    vBody = position + patchOffset;
    // Sun direction in the body frame (the model matrix is a rotation and a translation).
    vSunBody = transpose(mat3(modelMatrix)) * sunDirection;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vPositionW = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform float nightStrength;
  uniform float ambient;
  uniform vec3 atmosphereColor;
  uniform float atmosphereStrength;
  uniform vec3 sunDirection;
  uniform vec3 patchDir;
  uniform float patchCos;
  uniform float patchSide;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  varying vec3 vBody;
  varying vec3 vSunBody;

  #ifdef CLOUD_SHADOW
  ${CLOUD_GLSL}
  // Cover of the clouds between this point and the Sun: the cloud map looked up a little towards the Sun
  // (about the offset of a 12 km high cloud's shadow with the Sun 35 degrees up).
  float cloudShadow() {
    vec3 p = normalize(vBody);
    vec3 s = normalize(vSunBody);
    vec3 q = normalize(p + (s - p * dot(p, s)) * 0.0027);
    vec2 uv = vec2(atan(q.y, q.x) / 6.28318531 + 0.5, asin(clamp(q.z, -1.0, 1.0)) / 3.14159265 + 0.5);
    return cloudDensity(uv, dFdx(vUv), dFdy(vUv)) * clouds;
  }
  #endif

  #ifdef RELIEF
  // Relief (normal map in the local east/north/up frame, tools/textures/normals.ts), lit in the body frame.
  uniform sampler2D normalMap;
  uniform float relief;
  uniform float reliefStrength;
  float reliefCosSun() {
    vec3 p = normalize(vBody);
    vec2 h = vec2(-p.y, p.x);
    float hl = length(h);
    vec3 east = hl > 1e-5 ? vec3(h / hl, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 north = cross(p, east);
    vec3 t = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    t.xy *= reliefStrength;
    vec3 nb = normalize(east * t.x + north * t.y + p * max(t.z, 0.05));
    return dot(nb, normalize(vSunBody));
  }
  #endif

  #ifdef GAS_FLOW
  // Moving gas (Venus, giant planets): the bands slide along schematic zonal wind profiles with the simulation
  // clock, as two layers of the map that each drift for a few days, then cross-fade into a fresh one
  // (src/render/simTime.ts layerCycle), so the shear never piles up.
  uniform float gasAgeA;
  uniform float gasAgeB;
  uniform float gasWeightA;
  uniform float gasMotion;
  uniform float gasProfile;
  uniform float gasRadiusM;
  // Eastward wind (m/s) against latitude, relative to the body's rotation model: rough shapes and speeds of the
  // observed profiles, tapered towards the poles.
  float zonalWindMs(float lat) {
    float c = cos(lat);
    float s2 = sin(lat) * sin(lat);
    if (gasProfile < 0.5) return -100.0 * c; // Venus: cloud tops turn westward in ~4 days (superrotation)
    if (gasProfile < 1.5) return 120.0 * c * (0.45 * cos(lat * 14.0) + 0.55 * exp(-lat * lat * 30.0)); // Jupiter
    if (gasProfile < 2.5) return 400.0 * c * (exp(-lat * lat * 5.0) + 0.2 * cos(lat * 12.0)); // Saturn
    return 250.0 * c * clamp(-0.8 + 2.4 * s2, -0.8, 1.0); // Uranus, Neptune: retrograde equator
  }
  vec3 dayColor() {
    float lat = (vUv.y - 0.5) * 3.14159265;
    // Map fraction per simulated second.
    float drift = gasMotion * zonalWindMs(lat) / (6.28318531 * gasRadiusM * max(cos(lat), 0.05));
    vec2 dx = dFdx(vUv);
    vec2 dy = dFdy(vUv);
    vec3 a = textureGrad(dayMap, vec2(fract(vUv.x - drift * gasAgeA), vUv.y), dx, dy).rgb;
    vec3 b = textureGrad(dayMap, vec2(fract(vUv.x - drift * gasAgeB), vUv.y), dx, dy).rgb;
    return mix(b, a, gasWeightA);
  }
  #else
  vec3 dayColor() {
    return texture2D(dayMap, vUv).rgb;
  }
  #endif

  void main() {
    // Local patch (see BodyMesh.setLocalPatch): the sphere leaves the cap to the patch, the patch draws only it.
    if (patchSide != 0.0 && (dot(normalize(vBody), patchDir) > patchCos) == (patchSide > 0.0)) discard;
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    float cosSun = dot(n, sunDirection);
    // Soft terminator (about ±5°); airless bodies use a sharper one via ambient.
    float dayMix = smoothstep(-0.09, 0.09, cosSun);
    vec3 day = dayColor();
    vec3 night = texture2D(nightMap, vUv).rgb;
    // Diffuse light from the relief when drawn; the day/night mix stays on the sphere, so slopes facing the Sun
    // beyond the terminator do not light up the night side.
    float cosLight = cosSun;
    #ifdef RELIEF
    if (relief > 0.0) cosLight = mix(cosSun, reliefCosSun(), relief);
    #endif
    vec3 lit = day * (ambient + (1.0 - ambient) * clamp(cosLight * 1.15 + 0.1, 0.0, 1.0));
    #ifdef CLOUD_SHADOW
    if (clouds > 0.0 && cosSun > -0.1) lit *= 1.0 - 0.5 * cloudShadow();
    #endif
    vec3 dark = night * nightStrength + day * ambient * 0.25;
    vec3 color = mix(dark, lit, dayMix);
    vec3 viewDir = normalize(cameraPosition - vPositionW);
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    color += atmosphereColor * rim * atmosphereStrength * smoothstep(-0.2, 0.3, cosSun);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface BodyMeshOptions {
  readonly name: string;
  readonly radiusKm: number;
  readonly dayMap: Texture;
  /** Night-side emission (city lights); black texture when absent. */
  readonly nightMap: Texture;
  readonly nightStrength?: number;
  readonly ambient?: number;
  readonly atmosphereColor?: readonly [number, number, number];
  readonly atmosphereStrength?: number;
  /** Moving gas (effect `gasMotion`): which zonal wind profile the map drifts along. */
  readonly gasFlow?: GasProfile | undefined;
  /** Relief from a normal map (effect `relief`; src/render/relief.ts), with this slope scale. */
  readonly relief?: number | undefined;
  /** Earth: shadows of the illustrative cloud layer (effect `clouds`), sharing its uniforms. */
  readonly clouds?: CloudUniforms | undefined;
}

export type GasProfile = 'venus' | 'jupiter' | 'saturn' | 'iceGiant';
const GAS_PROFILES: Record<GasProfile, number> = { venus: 0, jupiter: 1, saturn: 2, iceGiant: 3 };
/** Life of a moving-gas layer (simulated seconds): long enough to see the bands slide, short enough to keep
 * storms from smearing. */
const GAS_CYCLE_S = 4 * 86_400;

const surfaceRay = new Raycaster();
const surfaceOrigin = new Vector3();
const surfaceDir = new Vector3();
/** Untransformed mesh used to cast rays against a body's geometry in its own frame. */
const surfaceProbe = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ side: DoubleSide }));

/** Cap drawn by the local patch (0.01 rad: 34 km on Mars, beyond the horizon from a rover's height). */
const PATCH_CAP_RAD = 0.01;
/** Facets whose centre lies this far beyond the cap are included, so the patch covers the whole cap. */
const PATCH_MARGIN_RAD = 0.05;

const LIGHT_BELOW_PX = 40;
const FULL_ABOVE_PX = 56;
const viewSize = new Vector2();

/** Full-resolution body sphere, e.g. to displace into an irregular shape and pass to `setGeometry`. */
export function bodySphere(radiusKm: number): BufferGeometry {
  return sphere(radiusKm, 192, 96);
}

/** UV sphere with the pole on +Z (three's sphere is Y-up with u = 0.5 on +X; +90° about X puts 90°E on +Y). */
function sphere(radiusKm: number, widthSegments: number, heightSegments: number): BufferGeometry {
  const geometry = new SphereGeometry(radiusKm, widthSegments, heightSegments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export class BodyMesh {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly occluder: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly radiusKm: number;
  private readonly sunDirection = new Vector3(1, 0, 0);
  private readonly detailRequests: (() => void)[] = [];
  private disposed = false;
  /** Full sphere, and a light one for when the body is small on screen (both undefined once a shape is set). */
  private full: BufferGeometry | undefined;
  private light: BufferGeometry | undefined;
  /** Facets around a surface point, drawn relative to it (see setLocalPatch). */
  private patch: Mesh<BufferGeometry, ShaderMaterial> | undefined;
  private patchKey = '';
  private boundingKm: number;
  private readonly defines: Record<string, string>;
  private readonly disposers: (() => void)[] = [];

  constructor(o: BodyMeshOptions) {
    this.radiusKm = o.radiusKm;
    this.boundingKm = o.radiusKm;
    const geometry = sphere(o.radiusKm, 192, 96);
    this.full = geometry;
    this.defines = {
      ...(o.gasFlow && { GAS_FLOW: '' }),
      ...(o.clouds && { CLOUD_SHADOW: '' }),
      ...(o.relief !== undefined && { RELIEF: '' }),
    };
    const material = new ShaderMaterial({
      defines: { ...this.defines },
      uniforms: {
        dayMap: { value: o.dayMap },
        nightMap: { value: o.nightMap },
        nightStrength: { value: o.nightStrength ?? 0 },
        ambient: { value: o.ambient ?? 0.06 },
        atmosphereColor: { value: new Vector3(...(o.atmosphereColor ?? [0, 0, 0])) },
        atmosphereStrength: { value: o.atmosphereStrength ?? 0 },
        sunDirection: { value: this.sunDirection },
        patchOffset: { value: new Vector3() },
        patchDir: { value: new Vector3(1, 0, 0) },
        patchCos: { value: 1 },
        patchSide: { value: 0 },
        ...o.clouds,
        ...(o.relief !== undefined && {
          normalMap: { value: placeholderTexture([128, 128, 255], true) },
          relief: effectUniform('relief'),
          reliefStrength: { value: o.relief },
        }),
        ...(o.gasFlow && {
          gasAgeA: { value: 0 },
          gasAgeB: { value: 0 },
          gasWeightA: { value: 1 },
          gasMotion: effectUniform('gasMotion'),
          gasProfile: { value: GAS_PROFILES[o.gasFlow] },
          gasRadiusM: { value: o.radiusKm * 1000 },
        }),
      },
      vertexShader,
      fragmentShader,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = o.name;
    // Black occluder in the pick pass, so objects behind the body cannot be picked.
    this.occluder = new Mesh(geometry, new MeshBasicMaterial({ color: 0x000000 }));
    this.occluder.layers.set(PICK_LAYER);
    this.mesh.add(this.occluder);
    // A body a few pixels wide does not need 37k triangles (dozens of them in the solar view): switch to a
    // light sphere below LIGHT_BELOW_PX of screen radius, back above FULL_ABOVE_PX. Takes effect next frame.
    const gas = o.gasFlow ? material.uniforms : undefined;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      if (gas) {
        const cycle = layerCycle(simTimeMs(), GAS_CYCLE_S);
        (gas['gasAgeA'] as { value: number }).value = cycle.ageA;
        (gas['gasAgeB'] as { value: number }).value = cycle.ageB;
        (gas['gasWeightA'] as { value: number }).value = cycle.weightA;
      }
      if (!this.full || !(camera instanceof PerspectiveCamera)) return;
      const e = this.mesh.matrixWorld.elements;
      const c = camera.matrixWorld.elements;
      const distance = Math.hypot(
        (e[12] ?? 0) - (c[12] ?? 0),
        (e[13] ?? 0) - (c[13] ?? 0),
        (e[14] ?? 0) - (c[14] ?? 0),
      );
      const heightPx = renderer.getSize(viewSize).y;
      const radiusPx =
        (this.radiusKm / Math.max(distance, 1e-9)) * (heightPx / 2 / Math.tan((camera.fov * Math.PI) / 360));
      const usingLight = this.mesh.geometry === this.light;
      if (!usingLight && radiusPx < LIGHT_BELOW_PX) {
        this.light ??= sphere(this.radiusKm, 48, 24);
        this.useGeometry(this.light);
      } else if (usingLight && radiusPx > FULL_ABOVE_PX) {
        this.useGeometry(this.full);
      }
    };
  }

  /**
   * Distance (km) from the centre to the surface actually drawn, along a body-frame unit direction: the sphere's
   * flat facets sit up to R·(1 − cos(π/96)) ≈ 1.3·10⁻⁴ R inside its radius (450 m on Mars), so objects resting on
   * the ground (rovers) are placed on the facet, not on the ideal sphere.
   */
  surfaceDistanceKm(dir: Vec3): number {
    const geometry = this.full ?? this.mesh.geometry;
    surfaceProbe.geometry = geometry;
    surfaceRay.set(surfaceOrigin.set(0, 0, 0), surfaceDir.set(dir[0], dir[1], dir[2]).normalize());
    const hit = surfaceRay.intersectObject(surfaceProbe, false)[0];
    return hit ? hit.distance : this.radiusKm;
  }

  /**
   * Draws the surface around `dirBody` (body-frame unit direction) at full precision, or stops (undefined).
   *
   * The sphere's vertices sit ~R from its centre, and the GPU adds the camera-relative translation (also ~R) in
   * Float32: the sum loses ~R·6e-8 (20 cm on Mars) and wobbles as the view turns, so a rover standing on the
   * ground flickers through it. The patch holds the facets around the point with vertices relative to that point
   * (subtracted in Float64 on the CPU): a vertex 100 km away keeps ~6 mm, and the large translation stays in the
   * Float64 matrices, so the GPU never sums two large numbers there. The sphere
   * discards the cap the patch covers, and the patch everything outside it, so the two never overlap.
   */
  setLocalPatch(dirBody: Vec3 | undefined): void {
    const full = this.full;
    const key = dirBody && full ? dirBody.map((v) => v.toFixed(9)).join(',') : '';
    if (key === this.patchKey) return;
    this.patchKey = key;
    const uniforms = this.mesh.material.uniforms;
    if (this.patch) {
      this.mesh.remove(this.patch);
      this.patch.geometry.dispose();
      this.patch.material.dispose();
      this.patch = undefined;
    }
    (uniforms['patchSide'] as { value: number }).value = 0;
    if (!dirBody || !full) return;

    const n = Math.hypot(dirBody[0], dirBody[1], dirBody[2]);
    const dir: Vec3 = [dirBody[0] / n, dirBody[1] / n, dirBody[2] / n];
    const origin: Vec3 = [dir[0] * this.radiusKm, dir[1] * this.radiusKm, dir[2] * this.radiusKm];
    const pos = full.getAttribute('position');
    const nor = full.getAttribute('normal');
    const uv = full.getAttribute('uv');
    const index = full.getIndex();
    const count = index ? index.count : pos.count;
    const vertex = (k: number): number => (index ? index.getX(k) : k);
    const cosSelect = Math.cos(PATCH_CAP_RAD + PATCH_MARGIN_RAD);
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    for (let k = 0; k < count; k += 3) {
      const a = vertex(k);
      const b = vertex(k + 1);
      const c = vertex(k + 2);
      const cx = pos.getX(a) + pos.getX(b) + pos.getX(c);
      const cy = pos.getY(a) + pos.getY(b) + pos.getY(c);
      const cz = pos.getZ(a) + pos.getZ(b) + pos.getZ(c);
      if ((cx * dir[0] + cy * dir[1] + cz * dir[2]) / Math.hypot(cx, cy, cz) < cosSelect) continue;
      for (const v of [a, b, c]) {
        positions.push(pos.getX(v) - origin[0], pos.getY(v) - origin[1], pos.getZ(v) - origin[2]);
        normals.push(nor.getX(v), nor.getY(v), nor.getZ(v));
        uvs.push(uv.getX(v), uv.getY(v));
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    // Same textures and lighting (shared uniform objects), its own offset and side.
    const material = new ShaderMaterial({
      defines: { ...this.defines },
      uniforms: {
        ...uniforms,
        patchOffset: { value: new Vector3(origin[0], origin[1], origin[2]) },
        patchSide: { value: -1 },
      },
      vertexShader,
      fragmentShader,
    });
    this.patch = new Mesh(geometry, material);
    this.patch.position.set(origin[0], origin[1], origin[2]);
    this.mesh.add(this.patch);
    (uniforms['patchDir'] as { value: Vector3 }).value.set(dir[0], dir[1], dir[2]);
    (uniforms['patchCos'] as { value: number }).value = Math.cos(PATCH_CAP_RAD);
    (uniforms['patchSide'] as { value: number }).value = 1;
  }

  /** Largest distance from the centre to the drawn surface (the radius, or a shape's farthest vertex). */
  get boundingRadiusKm(): number {
    return this.boundingKm;
  }

  /**
   * Drawn-surface distance from the centre along a body-frame unit direction, cheap enough for every frame:
   * exact on the local patch, `boundingRadiusKm` elsewhere (a camera kept above it never goes under the ground).
   */
  surfaceUnderKm(dirBody: Vec3): number {
    const patch = this.patch;
    const u = this.mesh.material.uniforms;
    if (!patch) return this.boundingKm;
    const pd = (u['patchDir'] as { value: Vector3 }).value;
    if (dirBody[0] * pd.x + dirBody[1] * pd.y + dirBody[2] * pd.z < Math.cos(PATCH_CAP_RAD))
      return this.boundingKm;
    // Ray from the centre, in the patch's frame (vertices relative to patch.position).
    surfaceProbe.geometry = patch.geometry;
    surfaceRay.set(
      surfaceOrigin.copy(patch.position).negate(),
      surfaceDir.set(dirBody[0], dirBody[1], dirBody[2]).normalize(),
    );
    const hit = surfaceRay.intersectObject(surfaceProbe, false)[0];
    return hit ? hit.distance : this.boundingKm;
  }

  private useGeometry(geometry: BufferGeometry): void {
    this.mesh.geometry = geometry;
    this.occluder.geometry = geometry;
  }

  /** Registers what to load when high detail is wanted (see `requestDetail`). */
  onDetailRequest(handler: () => void): void {
    this.detailRequests.push(handler);
  }

  /**
   * The camera is close: load the high-detail texture levels, if any (idempotent). The 8k levels (7–29 MB each)
   * are for the high quality tier only.
   */
  requestDetail(): void {
    if (!quality().textures8k) return;
    for (const handler of this.detailRequests.splice(0)) handler();
  }

  /** Replaces the sphere by a body-frame shape (km), e.g. a NASA model of an irregular moon. */
  setGeometry(geometry: BufferGeometry): void {
    this.setLocalPatch(undefined);
    const pos = geometry.getAttribute('position');
    let max = 0;
    for (let i = 0; i < pos.count; i++)
      max = Math.max(max, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
    this.boundingKm = max;
    this.full?.dispose();
    this.light?.dispose();
    this.full = undefined;
    this.light = undefined;
    this.useGeometry(geometry);
  }

  setDayMap(texture: Texture): void {
    this.setMap('dayMap', texture);
  }

  setNightMap(texture: Texture): void {
    this.setMap('nightMap', texture);
  }

  /** Relief normal map (only drawn with the `relief` option). */
  setNormalMap(texture: Texture): void {
    if (!this.mesh.material.uniforms['normalMap']) {
      texture.dispose();
      return;
    }
    this.setMap('normalMap', texture);
  }

  /** The Sun direction uniform's vector (shared with layers drawn over the body, e.g. clouds). */
  get sunDirectionVector(): Vector3 {
    return this.sunDirection;
  }

  /** Something to free with the body (e.g. a child layer). */
  addDisposer(dispose: () => void): void {
    this.disposers.push(dispose);
  }

  /** Unit Sun direction in the scene (world) frame. */
  setSunDirection(dir: Vec3): void {
    this.sunDirection.set(dir[0], dir[1], dir[2]);
  }

  /** Orientation of the body-fixed frame in the scene frame. */
  setOrientation(q: Quat): void {
    this.mesh.quaternion.copy(new Quaternion(q.x, q.y, q.z, q.w));
  }

  /** Frees the geometry, materials and textures (also those that finish loading afterwards). */
  dispose(): void {
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.full?.dispose();
    this.light?.dispose();
    for (const name of ['dayMap', 'nightMap', 'normalMap'] as const) {
      (this.mesh.material.uniforms[name]?.value as Texture | null | undefined)?.dispose();
    }
    this.setLocalPatch(undefined);
    this.mesh.material.dispose();
    this.occluder.material.dispose();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private setMap(name: 'dayMap' | 'nightMap' | 'normalMap', texture: Texture): void {
    // A progressive level arriving after dispose: free it right away.
    if (this.disposed) {
      texture.dispose();
      return;
    }
    const uniform = this.mesh.material.uniforms[name];
    if (uniform) uniform.value = texture;
  }
}
