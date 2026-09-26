import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';

const vertexShader = /* glsl */ `
  attribute float size;
  attribute float brightness;
  varying float vBrightness;
  void main() {
    vBrightness = brightness;
    // Direction only: ignore translations and pin the star to the far plane.
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * mat3(modelMatrix) * position, 1.0);
    gl_Position = clip.xyww;
    gl_PointSize = size;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vBrightness;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float falloff = smoothstep(0.5, 0.0, length(c));
    gl_FragColor = vec4(vec3(vBrightness * falloff), 1.0);
  }
`;

/** Deterministic PRNG (mulberry32) so the sky is identical between sessions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Placeholder decorative starfield (random, uniformly distributed directions), defined in the inertial
 * frame: rotate it by −GMST about Z when the scene is Earth-fixed.
 * To be replaced by a real star catalogue in a later milestone.
 */
export function createStarfield(count = 4000, pixelRatio = 1): Points {
  const rand = mulberry32(20_260_926);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const z = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    positions.set([r * Math.cos(phi), r * Math.sin(phi), z], i * 3);
    // Many faint stars, few bright ones.
    const m = Math.pow(rand(), 6);
    sizes[i] = (1.2 + m * 2.8) * pixelRatio;
    brightness[i] = 0.25 + m * 0.75;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('size', new BufferAttribute(sizes, 1));
  geometry.setAttribute('brightness', new BufferAttribute(brightness, 1));
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.name = 'starfield';
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
}
