/**
 * Planetary ring disc, a child of the planet's BodyMesh (body-fixed frame, ring plane = equator, Z = pole).
 * The radial texture (RGBA strip, u = radius) holds the lit-side colour and sqrt(τ / RING_TAU_SCALE), τ being the
 * normal optical depth; opacity follows the slant path: α = 1 − exp(−τ / |cos θ|), θ = angle to the ring normal.
 * The planet's shadow is computed per fragment (ray toward the Sun against the planet sphere).
 */
import {
  ClampToEdgeWrapping,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Texture,
} from 'three';
import type { Vec3 } from '../astro/vec3';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying float vRadius;
  varying vec3 vPositionW;
  varying vec3 vNormalW;
  void main() {
    vRadius = length(position.xy);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vPositionW = worldPosition.xyz;
    vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D ringMap;
  uniform float innerKm;
  uniform float outerKm;
  uniform float tauScale;
  uniform vec3 sunDirection;
  uniform vec3 planetCenter;
  uniform float planetRadius;
  varying float vRadius;
  varying vec3 vPositionW;
  varying vec3 vNormalW;
  void main() {
    #include <logdepthbuf_fragment>
    float u = (vRadius - innerKm) / (outerKm - innerKm);
    if (u < 0.0 || u > 1.0) discard;
    vec4 texel = texture2D(ringMap, vec2(u, 0.5));
    float tau = texel.a * texel.a * tauScale;
    vec3 viewDir = normalize(cameraPosition - vPositionW);
    float mu = max(abs(dot(viewDir, vNormalW)), 0.02);
    float alpha = 1.0 - exp(-tau / mu);
    if (alpha < 0.003) discard;
    // Planet shadow: does the ray from this point toward the Sun hit the planet?
    vec3 toCenter = planetCenter - vPositionW;
    float along = dot(toCenter, sunDirection);
    float miss = length(toCenter - sunDirection * along);
    float lit = along > 0.0 ? smoothstep(planetRadius * 0.98, planetRadius * 1.02, miss) : 1.0;
    // Seen from the unlit side, light diffuses through: fainter for optically thick rings.
    bool sameSide = dot(viewDir, vNormalW) * dot(sunDirection, vNormalW) > 0.0;
    float sunMu = max(abs(dot(sunDirection, vNormalW)), 0.02);
    float transmitted = exp(-tau / sunMu) * 0.6 + 0.15;
    float brightness = sameSide ? 1.0 : transmitted;
    vec3 color = texel.rgb * (0.03 + 0.97 * lit * brightness);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface RingMeshOptions {
  readonly url: string;
  readonly innerKm: number;
  readonly outerKm: number;
  readonly tauScale: number;
  readonly planetRadiusKm: number;
}

export class RingMesh {
  readonly mesh: Mesh<RingGeometry, ShaderMaterial>;
  private readonly sunDirection = new Vector3(1, 0, 0);
  private readonly planetCenter = new Vector3();
  private texture: Texture | undefined;

  constructor(o: RingMeshOptions) {
    const geometry = new RingGeometry(o.innerKm, o.outerKm, 256, 1);
    const material = new ShaderMaterial({
      uniforms: {
        ringMap: { value: null },
        innerKm: { value: o.innerKm },
        outerKm: { value: o.outerKm },
        tauScale: { value: o.tauScale },
        sunDirection: { value: this.sunDirection },
        planetCenter: { value: this.planetCenter },
        planetRadius: { value: o.planetRadiusKm },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'rings';
    // Invisible until the profile arrives (no placeholder disc).
    this.mesh.visible = false;
    new TextureLoader().load(
      o.url,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        tex.wrapS = ClampToEdgeWrapping;
        tex.wrapT = ClampToEdgeWrapping;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        this.texture = tex;
        const uniform = material.uniforms['ringMap'];
        if (uniform) uniform.value = tex;
        this.mesh.visible = true;
      },
      undefined,
      () => console.warn(`Ring texture unavailable: ${o.url}`),
    );
  }

  /** Unit Sun direction and planet centre, in the scene (world, camera-relative) frame. */
  setLighting(sunDirection: Vec3, planetCenterKm: Vec3): void {
    this.sunDirection.set(sunDirection[0], sunDirection[1], sunDirection[2]);
    this.planetCenter.set(planetCenterKm[0], planetCenterKm[1], planetCenterKm[2]);
  }

  get loaded(): boolean {
    return this.texture !== undefined;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture?.dispose();
  }
}
