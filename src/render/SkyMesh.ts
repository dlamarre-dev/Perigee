/**
 * Real starry sky (all views): the NASA SVS Deep Star Maps 2020 (Hipparcos-2, Tycho-2, Gaia DR2) on a sphere
 * at infinity, in J2000 equatorial coordinates (EQJ). The map is a plate carrée with RA 0h at the centre and RA
 * increasing to the left, as seen from inside: u = 0.5 − α/2π, v = 0.5 + δ/π (computed per vertex).
 *
 * The mesh is defined in the inertial frame like the procedural starfield it replaces (the shell rotates it by
 * the scene orientation). It is drawn first, without depth test or write, pinned to the far plane, so it never
 * hides anything; the procedural starfield stays visible until the texture arrives.
 */
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  type Texture,
} from 'three';
import { progressiveTexture } from './textures';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Direction only: ignore translations and pin the sky to the far plane.
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * mat3(modelMatrix) * position, 1.0);
    gl_Position = clip.xyww;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float brightness;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(map, vUv).rgb * brightness, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Unit sphere in EQJ with the map's coordinates per vertex: column i at RA α = 2π·i/N has u = 0.5 − i/N
 * (continuous, wrapping through negative values with RepeatWrapping), so the fragment shader is a single
 * texture lookup (cheap on software renderers) and there is no seam.
 */
function skyGeometry(nRa = 128, nDec = 64): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= nDec; j++) {
    const dec = -Math.PI / 2 + (Math.PI * j) / nDec;
    for (let i = 0; i <= nRa; i++) {
      const ra = (2 * Math.PI * i) / nRa;
      pos.push(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
      uv.push(0.5 - i / nRa, j / nDec);
    }
  }
  const row = nRa + 1;
  for (let j = 0; j < nDec; j++) {
    for (let i = 0; i < nRa; i++) {
      const a = j * row + i;
      // Seen from inside: wind so the inner faces are front faces.
      index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

export interface SkyOptions {
  readonly baseUrl: string;
  readonly maxTextureSize: number;
  readonly anisotropy: number;
  /** Called once the first real texture replaces the placeholder. */
  readonly onReady?: () => void;
}

export class SkyMesh {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly requestDetailFn: () => void;

  constructor(options: SkyOptions) {
    let ready = false;
    const material = new ShaderMaterial({
      uniforms: { map: { value: null as Texture | null }, brightness: { value: 0.75 } },
      vertexShader,
      fragmentShader,
      side: DoubleSide,
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
        tex.wrapS = RepeatWrapping;
        tex.needsUpdate = true;
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
    this.mesh = new Mesh(skyGeometry(), material);
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
