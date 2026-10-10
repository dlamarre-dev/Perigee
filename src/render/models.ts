/**
 * NASA 3D models (catalog/models.json → public/models/<id>.glb, see tools/models): lookup by target, loading
 * (GLTFLoader + meshopt), and the model drawn in the scene in place of the marker once the camera is close
 * enough for it to cover a few pixels. Models are in metres; the scene is in kilometres.
 *
 * Their attitude is illustrative (see src/astro/attitude.ts). They use PBR materials, lit by the Sun (one
 * directional light) and a dim neutral environment for the specular reflections. With the "modelLighting"
 * immersive effect (high tier), the Sun is nearly the only light, as in space: the parts cast shadows on each
 * other (a shadow map fitted to the model), the environment and ambient fills drop to a trace, and the model
 * darkens in the shadow of the central body (eclipse, penumbra included).
 */
import {
  Box3,
  AmbientLight,
  BufferGeometry as BufferGeometryClass,
  Float32BufferAttribute,
  DirectionalLight,
  DoubleSide,
  ShaderChunk,
  Group,
  PCFShadowMap,
  PMREMGenerator,
  type BufferGeometry,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { quality } from './quality';
import { effectEnabled } from './effects';
import { sunlitFraction } from '../astro/eclipse';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getKtx2Loader } from './textures';
import modelsJson from '../../catalog/models.json';
import type { Quat } from '../astro/quat';
import type { Vec3 } from '../astro/vec3';
import { ModelsCatalogSchema, type ModelEntry } from '../data/schemas';
import { assetUrl } from './assetUrl';

const catalog = ModelsCatalogSchema.parse(modelsJson);
const byTarget = new Map<string, ModelEntry>();
for (const m of catalog.models) for (const t of m.targets) byTarget.set(t, m);

/** Model of a target: `mission:<id>`, `site:<id>` or `norad:<n>`. */
export function modelFor(target: string): ModelEntry | undefined {
  return byTarget.get(target);
}

/** `{ model }` for a detail panel when the target has one (spread into DetailContent). */
export function withModel(target: string): { model?: ModelEntry } {
  const model = byTarget.get(target);
  return model ? { model } : {};
}

/**
 * Following a spacecraft, rover or satellite with a model: the camera comes close enough for the model to fill
 * the middle of the screen (about 2.5 times its size). Natural bodies keep their own framing.
 */
export function modelFollowDistanceKm(target: string): number | undefined {
  const model = byTarget.get(target);
  return model && !model.body ? (model.sizeM * 2.5) / 1000 : undefined;
}

/** Follow option letting the camera come to about twice the model's size. */
export function modelMinDistance(target: string): { minDistanceKm?: number } {
  const model = byTarget.get(target);
  return model ? { minDistanceKm: (model.sizeM * 2) / 1000 } : {};
}

let loader: GLTFLoader | undefined;
const scenes = new Map<string, Promise<Object3D | undefined>>();

/** Loads a model once; every call gets its own clone (geometry and materials shared). */
/** Drops a cached model and frees its GPU resources (geometries, materials, textures). */
export async function releaseModel(id: string): Promise<void> {
  const p = scenes.get(id);
  if (!p) return;
  scenes.delete(id);
  const obj = await p;
  obj?.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(mat)) {
        if (value && typeof value === 'object' && (value as Texture).isTexture) (value as Texture).dispose();
      }
      mat.dispose();
    }
  });
}

export async function loadModel(baseUrl: string, id: string): Promise<Object3D | undefined> {
  let p = scenes.get(id);
  if (!p) {
    if (!loader) {
      loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const ktx2 = getKtx2Loader();
      if (ktx2) loader.setKTX2Loader(ktx2);
    }
    const l = loader;
    p = l
      .loadAsync(assetUrl(baseUrl, `models/${id}.glb`))
      .then((gltf) => {
        // Thin parts (solar panels, foils) are often single faces, some with reversed winding (Fermi's
        // arrays looked transparent): draw both sides.
        gltf.scene.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            mat.side = DoubleSide;
            // glTF BLEND parts (the ISS arrays and truss) are cut-outs in practice; drawn as transparent, three
            // disables their depth writes and they overlap in storage order. Alpha test keeps correct depth;
            // alpha to coverage (high tier, with MSAA) also keeps the soft edges.
            if (mat.transparent) {
              mat.transparent = false;
              mat.depthWrite = true;
              mat.alphaTest = 0.5;
              mat.alphaToCoverage = quality().alphaToCoverage;
            }
            // Two-sided lighting from the stored normal, not the winding: in some models the two triangles of
            // a quad are wound differently, and three's winding-based flip shaded them differently.
            mat.onBeforeCompile = (shader) => {
              shader.fragmentShader = shader.fragmentShader
                // three's alpha-to-coverage edge is smoothstep(a, a + fwidth(alpha), alpha): undefined in GLSL
                // where the alpha is flat across a pixel quad (fwidth = 0), which some mobile drivers turn into
                // holes. A minimum width keeps it a clean step there.
                .replace(
                  '#include <alphatest_fragment>',
                  ShaderChunk.alphatest_fragment.replace(
                    'alphaTest + fwidth( diffuseColor.a )',
                    'alphaTest + max( fwidth( diffuseColor.a ), 1e-4 )',
                  ),
                )
                .replace(
                  '#include <normal_fragment_begin>',
                  ShaderChunk.normal_fragment_begin.replace(
                    'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
                    'float faceDirection = dot( normalize( vNormal ), vViewPosition ) >= 0.0 ? 1.0 : - 1.0;',
                  ),
                );
            };
          }
        });
        return gltf.scene as Object3D;
      })
      .catch((err: unknown) => {
        console.warn(`Model unavailable: ${id}`, err);
        return undefined;
      });
    scenes.set(id, p);
  }
  const scene = await p;
  return scene?.clone(true);
}

/**
 * Natural-body model (`body` entries: Phobos, Deimos) as a BodyMesh geometry in km, in the IAU body frame,
 * with its own colour map (glTF UVs, flipY false like the GLTFLoader textures).
 */
export async function loadBodyShape(
  baseUrl: string,
  id: string,
): Promise<{ geometry: BufferGeometry; map: Texture | undefined } | undefined> {
  const obj = await loadModel(baseUrl, id);
  let found: Mesh | undefined;
  obj?.traverse((o) => {
    if (!found && (o as Mesh).isMesh) found = o as Mesh;
  });
  if (!found) return undefined;
  // meshopt output is quantized (normalized integers, dequantized by the node transform): rebuild Float32
  // attributes, then bake the node transform and the metre → km scale.
  const src = found.geometry;
  const geometry = new BufferGeometryClass();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const n = attr.count * attr.itemSize;
    const out = new Float32Array(n);
    for (let i = 0; i < attr.count; i++) {
      for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
    }
    geometry.setAttribute(name, new Float32BufferAttribute(out, attr.itemSize));
  }
  if (src.index) geometry.setIndex(src.index.clone());
  obj?.updateMatrixWorld(true);
  geometry.applyMatrix4(found.matrixWorld);
  geometry.scale(0.001, 0.001, 0.001);
  geometry.computeBoundingSphere();
  const material = found.material as MeshStandardMaterial | MeshStandardMaterial[];
  const map = (Array.isArray(material) ? material[0] : material)?.map ?? undefined;
  return { geometry, map };
}

const environments = new WeakMap<Scene, true>();
const ENVIRONMENT_INTENSITY = 0.35;

/** Dim neutral environment for PBR reflections (once per scene). */
export function ensureEnvironment(
  renderer: WebGLRenderer,
  scene: Scene,
  intensity = ENVIRONMENT_INTENSITY,
): void {
  if (environments.has(scene)) return;
  environments.set(scene, true);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = intensity;
  pmrem.dispose();
}

/** The model must stay this long above its full-quality threshold before the heavy variant is fetched. */
const HIGH_DWELL_MS = 500;
/**
 * Full-quality variants are tens of megabytes and hundreds of MB of GPU textures: high quality tier only (a
 * desktop-class GPU; phones flickered with the 2-million-triangle ISS), on large high-density screens where the
 * light model shows its limits.
 */
function highAllowed(): boolean {
  return (
    quality().highModels &&
    typeof window !== 'undefined' &&
    Math.max(window.screen.width, window.screen.height) * window.devicePixelRatio >= 2500
  );
}

/** Below this apparent size (CSS px) the marker stays; above it the model replaces it. */
const MODEL_MIN_PX = 4;

/** Sun light intensity; with the lighting effect, the fills that remain (a trace of reflected light). */
const SUN_INTENSITY = 3;
const AMBIENT_INTENSITY = 0.08;
const SPACE_AMBIENT_INTENSITY = 0.015;
const SPACE_ENVIRONMENT_INTENSITY = 0.06;
/** Shadow map texels across the model; the light frustum is fitted to the model's size every frame. */
const SHADOW_MAP_PX = 4096;

/** Body whose shadow can eclipse the model (scene frame, camera-relative like the model). */
export interface ModelOccluder {
  readonly centreKm: Vec3;
  readonly radiusKm: number;
  /** Distance from the model to the Sun (km), for the Sun's apparent size. */
  readonly sunDistanceKm: number;
}

export class SceneModel {
  private readonly group = new Group();
  private readonly sun = new DirectionalLight(0xffffff, 3);
  private readonly ambient = new AmbientLight(0xffffff, 0.08);
  private entry: ModelEntry | undefined;
  private object: Object3D | undefined;
  private loading = '';
  /** Full-quality variant (entry.high): requested after the model has stayed large for HIGH_DWELL_MS. */
  private high: Object3D | undefined;
  private highLoading = false;
  private largeSinceMs: number | undefined;
  private disposed = false;
  /** Bounds of the loaded model in its own frame (metres). */
  private bounds: Box3 | undefined;

  /**
   * How far the loaded model reaches from its origin along a model-frame unit axis (metres), e.g. the wheels
   * below a rover's origin along its nadir axis; undefined until loaded.
   */
  extentAlongM(axis: Vec3): number | undefined {
    const b = this.bounds;
    if (!b || !this.object) return undefined;
    const pick = (i: 0 | 1 | 2, key: 'x' | 'y' | 'z'): number => (axis[i] >= 0 ? b.max[key] : b.min[key]);
    return axis[0] * pick(0, 'x') + axis[1] * pick(1, 'y') + axis[2] * pick(2, 'z');
  }

  constructor(
    private readonly scene: Scene,
    private readonly renderer: WebGLRenderer,
    private readonly baseUrl: string,
  ) {
    this.group.visible = false;
    this.group.scale.setScalar(0.001);
    this.group.add(this.sun.target);
    scene.add(this.group, this.sun, this.ambient);
    if (quality().immersiveEffects) {
      // Only objects marked castShadow are drawn into the map, and only while the Sun light casts: the other
      // views' meshes are unaffected and nothing is rendered when the effect is off.
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFShadowMap;
      this.sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
    }
  }

  /**
   * Draws `entry` at `renderKm` (camera-relative, scene frame) with orientation `q` (model → scene), lit from
   * `sunDir` (unit, scene frame). Returns true when the model is visible (the caller then hides its marker).
   */
  update(
    entry: ModelEntry | undefined,
    renderKm: Vec3 | undefined,
    q: Quat,
    sunDir: Vec3,
    focalPx: number,
    occluder?: ModelOccluder,
  ): boolean {
    const distKm = renderKm ? Math.hypot(renderKm[0], renderKm[1], renderKm[2]) : Infinity;
    const sizePx = entry ? ((entry.sizeM / 1000) * focalPx) / Math.max(distKm, 1e-9) : 0;
    const wanted = entry !== undefined && renderKm !== undefined && sizePx >= MODEL_MIN_PX;
    if (entry?.id !== this.entry?.id) {
      if (this.object) this.group.remove(this.object);
      this.object = undefined;
      this.bounds = undefined;
      this.dropHigh();
      this.entry = entry;
    }
    this.updateHigh(entry, sizePx);
    if (wanted && !this.object && this.loading !== entry.id) {
      this.loading = entry.id;
      ensureEnvironment(this.renderer, this.scene);
      void loadModel(this.baseUrl, entry.id).then((obj) => {
        if (this.loading === entry.id) this.loading = '';
        if (!obj || this.entry?.id !== entry.id) return;
        this.object = obj;
        // Model-frame bounds (metres), before it joins the scaled group.
        this.bounds = new Box3().setFromObject(obj, true);
        castShadows(obj);
        this.group.add(obj);
      });
    }
    const shown = wanted && this.object !== undefined;
    this.group.visible = shown;
    this.sun.visible = shown;
    this.ambient.visible = shown;
    if (shown && renderKm) {
      this.group.position.set(renderKm[0], renderKm[1], renderKm[2]);
      this.group.quaternion.set(q.x, q.y, q.z, q.w);
      this.light(entry.sizeM / 1000, renderKm, sunDir, occluder);
    }
    return shown;
  }

  /** Places the Sun light (aimed at the model: its target is a child of the group) and sets the fills. */
  private light(sizeKm: number, renderKm: Vec3, sunDir: Vec3, occluder: ModelOccluder | undefined): void {
    const space = effectEnabled('modelLighting');
    // From the Sun side, far enough for the shadow frustum to hold the whole model in front of the light.
    const backKm = space ? 2 * sizeKm : 1;
    this.sun.position.set(
      renderKm[0] + sunDir[0] * backKm,
      renderKm[1] + sunDir[1] * backKm,
      renderKm[2] + sunDir[2] * backKm,
    );
    const lit =
      space && occluder
        ? sunlitFraction(
            [
              occluder.centreKm[0] - renderKm[0],
              occluder.centreKm[1] - renderKm[1],
              occluder.centreKm[2] - renderKm[2],
            ],
            occluder.radiusKm,
            sunDir,
            occluder.sunDistanceKm,
          )
        : 1;
    this.sun.intensity = SUN_INTENSITY * lit;
    this.ambient.intensity = space ? SPACE_AMBIENT_INTENSITY : AMBIENT_INTENSITY;
    this.scene.environmentIntensity = space ? SPACE_ENVIRONMENT_INTENSITY : ENVIRONMENT_INTENSITY;
    const cast = space && lit > 0;
    // Switching castShadow changes the lights' state: three recompiles the model's materials once.
    if (this.sun.castShadow !== cast) this.sun.castShadow = cast;
    if (!cast) return;
    const shadow = this.sun.shadow;
    const cam = shadow.camera;
    // sizeM is the largest dimension: a half-width of 0.75 of it covers the model whatever its orientation.
    const half = 0.75 * sizeKm;
    if (cam.right !== half) {
      cam.left = cam.bottom = -half;
      cam.right = cam.top = half;
      cam.near = 0.5 * sizeKm;
      cam.far = 4 * sizeKm;
      cam.updateProjectionMatrix();
      // Offsets against shadow acne on the thin, double-sided parts (km: scene units), about two texels.
      shadow.normalBias = (4 * half) / SHADOW_MAP_PX;
      shadow.bias = -0.0005;
    }
  }

  /**
   * Full quality only when the model fills the screen: requested once it has covered entry.high.minPx for a
   * moment, swapped in when loaded, released (GPU memory freed) below half that size.
   */
  private updateHigh(entry: ModelEntry | undefined, sizePx: number): void {
    const high = entry?.high;
    if (!entry || !high || !highAllowed()) return;
    const now = performance.now();
    if (sizePx >= high.minPx) this.largeSinceMs ??= now;
    else this.largeSinceMs = undefined;
    if (this.high && sizePx < high.minPx / 2) {
      this.dropHigh();
      return;
    }
    const due = this.largeSinceMs !== undefined && now - this.largeSinceMs > HIGH_DWELL_MS;
    if (!due || this.high || this.highLoading) return;
    this.highLoading = true;
    const id = `${entry.id}-high`;
    void loadModel(this.baseUrl, id).then((obj) => {
      this.highLoading = false;
      if (!obj) return;
      if (this.disposed || this.entry?.id !== entry.id || this.largeSinceMs === undefined) {
        void releaseModel(id);
        return;
      }
      this.high = obj;
      castShadows(obj);
      if (this.object) this.object.visible = false;
      this.group.add(obj);
    });
  }

  private dropHigh(): void {
    const high = this.high;
    if (!high) return;
    this.group.remove(high);
    this.high = undefined;
    if (this.object) this.object.visible = true;
    if (this.entry) void releaseModel(`${this.entry.id}-high`);
  }

  dispose(): void {
    this.disposed = true;
    this.dropHigh();
    this.scene.remove(this.group, this.sun, this.ambient);
    this.sun.shadow.dispose();
  }
}

/** Every part casts and receives shadows (used only while the Sun light casts, see SceneModel.light). */
function castShadows(obj: Object3D): void {
  obj.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}
