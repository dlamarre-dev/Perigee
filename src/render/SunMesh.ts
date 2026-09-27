/**
 * The Sun's visible surface (photosphere), procedural: quadratic limb darkening (visible-light coefficients
 * u₁ ≈ 0.47, u₂ ≈ 0.23; Cox, Allen's Astrophysical Quantities, 2000) and animated granulation (cells of ~1000 km)
 * over larger supergranulation mottling. No sunspots: a fixed map of them would be wrong on any given day.
 * Fine noise octaves fade with their screen-space frequency, so the disc does not shimmer when seen from afar.
 */
import { Mesh, ShaderMaterial, SphereGeometry } from 'three';

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
    float t = uTime * 0.02;
    float gran = (noise(vObject * 700.0 + vec3(t)) - 0.5) * visible(700.0, pixel);
    gran += 0.5 * (noise(vObject * 1400.0 - vec3(t)) - 0.5) * visible(1400.0, pixel);
    float meso = (noise(vObject * 150.0 - vec3(t * 0.2)) - 0.5) * visible(150.0, pixel);
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
