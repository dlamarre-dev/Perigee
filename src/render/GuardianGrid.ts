/**
 * "Guardian" grid (as in VR headsets) on the faces of the cube the camera cannot leave (OrbitLimits.boundsHalfKm):
 * a face fades in as the camera comes near it, its lines fading out around the point closest to the camera.
 *
 * Camera-relative like everything else (CLAUDE.md §5.4): each face is a patch centred on the point of the face
 * nearest the camera, placed at (that point − camera) computed in Float64; the grid phase is passed modulo one
 * cell, so the GPU never sees raw coordinates of a 400 AU cube.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { Vec3 } from '../astro/vec3';

/** The grid sits this fraction beyond the camera's bound, so it is in front of the camera when it touches. */
const GRID_BEYOND = 0.015;
/** Faces start to show when the camera is closer than this fraction of the half-size. */
const SHOW_WITHIN = 0.1;
/** Half-width of the drawn patch, and largest grid cell, as fractions of the half-size. */
const PATCH_HALF = 0.3;
const CELL = 1 / 24;

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  void main() {
    vLocal = (modelMatrix * vec4(position, 0.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec3 uAxisU;
  uniform vec3 uAxisV;
  uniform vec2 uPhase;
  uniform float uCell;
  uniform float uPatch;
  uniform vec2 uEdgeMin;
  uniform vec2 uEdgeMax;
  varying vec3 vLocal;
  // Antialiased lines of a grid of the given cell size (km) at face coordinates q.
  float gridLines(vec2 q, float cell) {
    vec2 g = q / cell;
    vec2 w = fwidth(g) * 1.2;
    vec2 d = abs(fract(g - 0.5) - 0.5);
    return max(1.0 - smoothstep(0.0, w.x, d.x), 1.0 - smoothstep(0.0, w.y, d.y));
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vec2(dot(vLocal, uAxisU), dot(vLocal, uAxisV));
    // Lines stop at the cube's edges.
    if (any(lessThan(p, uEdgeMin)) || any(greaterThan(p, uEdgeMax))) discard;
    vec2 q = p + uPhase;
    // Cells subdivide by 4 as the camera comes close (about 48 px apart on screen), so a face seen from very
    // near still shows lines instead of one cell larger than the screen; the finer level fades in.
    float kmPerPx = max(length(fwidth(p)), 1e-9);
    float levels = clamp(log2(uCell / (kmPerPx * 48.0)) / 2.0, 0.0, 8.0);
    float level = floor(levels);
    float cell = uCell / pow(4.0, level);
    float line = max(gridLines(q, cell), gridLines(q, cell / 4.0) * fract(levels) * 0.8);
    float fade = 1.0 - smoothstep(0.45, 1.0, length(p) / uPatch);
    // A faint fill that grows near the wall, so a face seen head-on still reads as a surface.
    float fill = 0.05 + 0.12 * uOpacity;
    float a = uOpacity * fade * (fill + (1.0 - fill) * line);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`;

interface FaceUniforms {
  readonly uColor: { value: Color };
  readonly uOpacity: { value: number };
  readonly uAxisU: { value: Vector3 };
  readonly uAxisV: { value: Vector3 };
  readonly uPhase: { value: Vector2 };
  readonly uCell: { value: number };
  readonly uPatch: { value: number };
  readonly uEdgeMin: { value: Vector2 };
  readonly uEdgeMax: { value: Vector2 };
}

interface Face {
  readonly axis: 0 | 1 | 2;
  readonly sign: 1 | -1;
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly uniforms: FaceUniforms;
}

export class GuardianGrid {
  readonly group = new Group();
  private readonly faces: Face[] = [];

  constructor() {
    for (const axis of [0, 1, 2] as const) {
      for (const sign of [1, -1] as const) {
        const geometry = new PlaneGeometry(2, 2);
        // The plane's normal (+z) turned onto the face's axis.
        if (axis === 0) geometry.rotateY(Math.PI / 2);
        if (axis === 1) geometry.rotateX(Math.PI / 2);
        const u = (axis + 1) % 3;
        const v = (axis + 2) % 3;
        const uniforms: FaceUniforms = {
          uColor: { value: new Color(0x5ad7ff) },
          uOpacity: { value: 0 },
          uAxisU: { value: new Vector3(u === 0 ? 1 : 0, u === 1 ? 1 : 0, u === 2 ? 1 : 0) },
          uAxisV: { value: new Vector3(v === 0 ? 1 : 0, v === 1 ? 1 : 0, v === 2 ? 1 : 0) },
          uPhase: { value: new Vector2() },
          uCell: { value: 1 },
          uPatch: { value: 1 },
          uEdgeMin: { value: new Vector2() },
          uEdgeMax: { value: new Vector2() },
        };
        const material = new ShaderMaterial({
          uniforms: { ...uniforms },
          vertexShader,
          fragmentShader,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        });
        const mesh = new Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = 10;
        this.group.add(mesh);
        this.faces.push({ axis, sign, mesh, uniforms });
      }
    }
  }

  /**
   * Places the faces around the camera (scene frame, km) for a cube of half-size `boundsHalfKm` (the camera's
   * bound; undefined hides the grid). Faces farther than SHOW_WITHIN are hidden (no cost in normal use).
   */
  update(cameraKm: Vec3, boundsHalfKm: number | undefined): void {
    for (const f of this.faces) {
      f.mesh.visible = false;
      if (boundsHalfKm === undefined) continue;
      const along = cameraKm[f.axis] ?? 0;
      const gapKm = boundsHalfKm - f.sign * along;
      const showKm = SHOW_WITHIN * boundsHalfKm;
      if (gapKm > showKm) continue;
      const closeness = 1 - Math.max(0, gapKm) / showKm;
      const gridHalfKm = boundsHalfKm * (1 + GRID_BEYOND);
      const u = (f.axis + 1) % 3;
      const v = (f.axis + 2) % 3;
      const cu = Math.max(-gridHalfKm, Math.min(gridHalfKm, cameraKm[u] ?? 0));
      const cv = Math.max(-gridHalfKm, Math.min(gridHalfKm, cameraKm[v] ?? 0));
      // Patch centre: the point of the face nearest the camera, relative to the camera (Float64 here).
      const centre: [number, number, number] = [0, 0, 0];
      centre[f.axis] = f.sign * gridHalfKm - along;
      centre[u] = cu - (cameraKm[u] ?? 0);
      centre[v] = cv - (cameraKm[v] ?? 0);
      const patchKm = PATCH_HALF * boundsHalfKm;
      const cellKm = CELL * boundsHalfKm;
      f.mesh.position.set(centre[0], centre[1], centre[2]);
      f.mesh.scale.setScalar(patchKm);
      const uni = f.uniforms;
      uni.uOpacity.value = closeness * closeness;
      uni.uPhase.value.set(mod(cu, cellKm), mod(cv, cellKm));
      uni.uCell.value = cellKm;
      uni.uPatch.value = patchKm;
      uni.uEdgeMin.value.set(-gridHalfKm - cu, -gridHalfKm - cv);
      uni.uEdgeMax.value.set(gridHalfKm - cu, gridHalfKm - cv);
      f.mesh.visible = true;
    }
  }

  dispose(): void {
    for (const f of this.faces) {
      f.mesh.geometry.dispose();
      f.mesh.material.dispose();
    }
  }
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;
