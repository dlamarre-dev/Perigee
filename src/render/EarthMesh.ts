import { Mesh, MeshBasicMaterial, ShaderMaterial, SphereGeometry, Vector3, type Texture } from 'three';
import { EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import type { Vec3 } from '../astro/vec3';
import { PICK_LAYER } from './SatellitePoints';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vPositionW = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  void main() {
    vec3 n = normalize(vNormalW);
    float cosSun = dot(n, sunDirection);
    // Soft terminator: civil-twilight-like band of about ±5°.
    float dayMix = smoothstep(-0.09, 0.09, cosSun);
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    vec3 lit = day * (0.06 + 0.94 * clamp(cosSun * 1.15 + 0.1, 0.0, 1.0));
    vec3 dark = night * 1.4 + day * 0.015;
    vec3 color = mix(dark, lit, dayMix);
    // Thin atmospheric rim on the day side.
    vec3 viewDir = normalize(cameraPosition - vPositionW);
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    color += vec3(0.25, 0.45, 1.0) * rim * 0.6 * smoothstep(-0.2, 0.3, cosSun);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Textured Earth with a day/night terminator driven by the real Sun direction.
 * Geometry is built Z-up (north pole on +Z, prime meridian on +X, 90°E on +Y) to match the astro frames.
 */
export class EarthMesh {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly sunDirection = new Vector3(1, 0, 0);

  constructor(dayMap: Texture, nightMap: Texture) {
    const geometry = new SphereGeometry(EARTH_EQUATORIAL_RADIUS_KM, 192, 96);
    // Three's sphere is Y-up with u = 0.5 on +X; rotating +90° about X puts the pole on +Z and 90°E on +Y.
    geometry.rotateX(Math.PI / 2);
    const material = new ShaderMaterial({
      uniforms: {
        dayMap: { value: dayMap },
        nightMap: { value: nightMap },
        sunDirection: { value: this.sunDirection },
      },
      vertexShader,
      fragmentShader,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'earth';
    // Black occluder in the pick pass, so objects behind the Earth cannot be picked.
    const occluder = new Mesh(geometry, new MeshBasicMaterial({ color: 0x000000 }));
    occluder.layers.set(PICK_LAYER);
    this.mesh.add(occluder);
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

  /** Rotation about the pole (rad): 0 in the Earth-fixed frame, GMST in the inertial frame. */
  setSpinAngle(angleRad: number): void {
    this.mesh.rotation.set(0, 0, angleRad);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private setMap(name: 'dayMap' | 'nightMap', texture: Texture): void {
    const uniform = this.mesh.material.uniforms[name];
    if (uniform) uniform.value = texture;
  }
}
