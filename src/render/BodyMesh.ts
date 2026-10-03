/**
 * Textured, Sun-lit sphere for a central body (Earth, Moon, Mars…).
 * Geometry is Z-up (north pole on +Z, prime meridian on +X, 90°E on +Y) to match the body-fixed astro frames.
 * Uses Three.js logarithmic depth chunks: the renderer always runs with a logarithmic depth buffer.
 */
import {
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  type BufferGeometry,
  Vector3,
  type Texture,
} from 'three';
import type { Quat } from '../astro/quat';
import type { Vec3 } from '../astro/vec3';
import { PICK_LAYER } from './SatellitePoints';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  void main() {
    vUv = uv;
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
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    float cosSun = dot(n, sunDirection);
    // Soft terminator (about ±5°); airless bodies use a sharper one via ambient.
    float dayMix = smoothstep(-0.09, 0.09, cosSun);
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    vec3 lit = day * (ambient + (1.0 - ambient) * clamp(cosSun * 1.15 + 0.1, 0.0, 1.0));
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
}

export class BodyMesh {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly occluder: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly radiusKm: number;
  private readonly sunDirection = new Vector3(1, 0, 0);
  private readonly detailRequests: (() => void)[] = [];
  private disposed = false;

  constructor(o: BodyMeshOptions) {
    this.radiusKm = o.radiusKm;
    const geometry = new SphereGeometry(o.radiusKm, 192, 96);
    // Three's sphere is Y-up with u = 0.5 on +X; rotating +90° about X puts the pole on +Z and 90°E on +Y.
    geometry.rotateX(Math.PI / 2);
    const material = new ShaderMaterial({
      uniforms: {
        dayMap: { value: o.dayMap },
        nightMap: { value: o.nightMap },
        nightStrength: { value: o.nightStrength ?? 0 },
        ambient: { value: o.ambient ?? 0.06 },
        atmosphereColor: { value: new Vector3(...(o.atmosphereColor ?? [0, 0, 0])) },
        atmosphereStrength: { value: o.atmosphereStrength ?? 0 },
        sunDirection: { value: this.sunDirection },
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
  }

  /** Registers what to load when high detail is wanted (see `requestDetail`). */
  onDetailRequest(handler: () => void): void {
    this.detailRequests.push(handler);
  }

  /** The camera is close: load the high-detail texture levels, if any (idempotent). */
  requestDetail(): void {
    for (const handler of this.detailRequests.splice(0)) handler();
  }

  /** Replaces the sphere by a body-frame shape (km), e.g. a NASA model of an irregular moon. */
  setGeometry(geometry: BufferGeometry): void {
    const old = this.mesh.geometry;
    this.mesh.geometry = geometry;
    this.occluder.geometry = geometry;
    old.dispose();
  }

  setDayMap(texture: Texture): void {
    this.setMap('dayMap', texture);
  }

  setNightMap(texture: Texture): void {
    this.setMap('nightMap', texture);
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
    for (const name of ['dayMap', 'nightMap'] as const) {
      (this.mesh.material.uniforms[name]?.value as Texture | null | undefined)?.dispose();
    }
    this.mesh.material.dispose();
    this.occluder.material.dispose();
  }

  private setMap(name: 'dayMap' | 'nightMap', texture: Texture): void {
    // A progressive level arriving after dispose: free it right away.
    if (this.disposed) {
      texture.dispose();
      return;
    }
    const uniform = this.mesh.material.uniforms[name];
    if (uniform) uniform.value = texture;
  }
}
