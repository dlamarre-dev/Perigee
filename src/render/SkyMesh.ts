/**
 * Real starry sky (all views): the NASA SVS Deep Star Maps 2020 (Hipparcos-2, Tycho-2, Gaia DR2) on a sphere
 * at infinity, in J2000 equatorial coordinates (EQJ). The map is a plate carrée with RA 0h at the centre and RA
 * increasing to the left, as seen from inside: u = 0.5 − α/2π, v = 0.5 + δ/π.
 *
 * The mesh is defined in the inertial frame like the procedural starfield it replaces (the shell rotates it by
 * the scene orientation). It is drawn first, without depth test or write, pinned to the far plane, so it never
 * hides anything; the procedural starfield stays visible until the texture arrives.
 */
import { BackSide, Mesh, ShaderMaterial, SphereGeometry, type Texture } from 'three';
import { progressiveTexture } from './textures';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Direction only: ignore translations and pin the sky to the far plane.
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * mat3(modelMatrix) * position, 1.0);
    gl_Position = clip.xyww;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float brightness;
  varying vec3 vDir;
  const float PI = 3.141592653589793;
  void main() {
    vec3 d = normalize(vDir);
    float u = 0.5 - atan(d.y, d.x) / (2.0 * PI);
    float v = 0.5 + asin(clamp(d.z, -1.0, 1.0)) / PI;
    // The atan wrap at RA 12h makes du/dx jump by 1 across one pixel column, which would pick the smallest
    // mip there (a visible seam): take derivatives of a copy of u that wraps elsewhere when they are smaller.
    float uAlt = fract(u + 0.5);
    vec2 dx = vec2(dFdx(u), dFdx(v));
    vec2 dy = vec2(dFdy(u), dFdy(v));
    vec2 dxAlt = vec2(dFdx(uAlt), dx.y);
    vec2 dyAlt = vec2(dFdy(uAlt), dy.y);
    if (abs(dxAlt.x) + abs(dyAlt.x) < abs(dx.x) + abs(dy.x)) {
      dx = dxAlt;
      dy = dyAlt;
    }
    vec3 c = textureGrad(map, vec2(u, v), dx, dy).rgb;
    gl_FragColor = vec4(c * brightness, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface SkyOptions {
  readonly baseUrl: string;
  readonly maxTextureSize: number;
  readonly anisotropy: number;
  /** Called once the first real texture replaces the placeholder. */
  readonly onReady?: () => void;
}

export class SkyMesh {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly requestDetailFn: () => void;

  constructor(options: SkyOptions) {
    let ready = false;
    const material = new ShaderMaterial({
      uniforms: { map: { value: null as Texture | null }, brightness: { value: 0.75 } },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
    });
    const texture = progressiveTexture({
      baseUrl: options.baseUrl,
      body: 'sky',
      name: 'stars',
      maxTextureSize: options.maxTextureSize,
      anisotropy: options.anisotropy,
      placeholderRgb: [0, 0, 0],
      onUpdate: (tex) => {
        const map = material.uniforms['map'];
        if (map) map.value = tex;
        this.mesh.visible = true;
        if (!ready) {
          ready = true;
          options.onReady?.();
        }
      },
    });
    const map = material.uniforms['map'];
    if (map) map.value = texture.initial;
    this.mesh = new Mesh(new SphereGeometry(1, 64, 32), material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
    this.mesh.visible = false;
    this.requestDetailFn = texture.requestDetail;
  }

  /** Loads the 8k level (UASTC, ~25 MB): worth it only on large, high-resolution screens. */
  requestDetail(): void {
    this.requestDetailFn();
  }
}
