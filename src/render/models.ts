/**
 * NASA 3D models (catalog/models.json → public/models/<id>.glb, see tools/models): lookup by target, loading
 * (GLTFLoader + meshopt), and the model drawn in the scene in place of the marker once the camera is close
 * enough for it to cover a few pixels. Models are in metres; the scene is in kilometres.
 *
 * Their attitude is illustrative (see src/astro/attitude.ts). They use PBR materials, lit by the Sun (one
 * directional light) and a dim neutral environment for the specular reflections.
 */
import {
  AmbientLight,
  BufferGeometry as BufferGeometryClass,
  Float32BufferAttribute,
  DirectionalLight,
  DoubleSide,
  Group,
  PMREMGenerator,
  type BufferGeometry,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import modelsJson from '../../catalog/models.json';
import type { Quat } from '../astro/quat';
import type { Vec3 } from '../astro/vec3';
import { ModelsCatalogSchema, type ModelEntry } from '../data/schemas';

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
export async function loadModel(baseUrl: string, id: string): Promise<Object3D | undefined> {
  let p = scenes.get(id);
  if (!p) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const l = loader;
    p = l
      .loadAsync(`${baseUrl}models/${id}.glb`)
      .then((gltf) => {
        // Thin parts (solar panels, foils) are often single faces, some with reversed winding (Fermi's
        // arrays looked transparent): draw both sides.
        gltf.scene.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            mat.side = DoubleSide;
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

/** Dim neutral environment for PBR reflections (once per scene). */
export function ensureEnvironment(renderer: WebGLRenderer, scene: Scene, intensity = 0.35): void {
  if (environments.has(scene)) return;
  environments.set(scene, true);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = intensity;
  pmrem.dispose();
}

/** Below this apparent size (CSS px) the marker stays; above it the model replaces it. */
const MODEL_MIN_PX = 4;

export class SceneModel {
  private readonly group = new Group();
  private readonly sun = new DirectionalLight(0xffffff, 3);
  private readonly ambient = new AmbientLight(0xffffff, 0.08);
  private entry: ModelEntry | undefined;
  private object: Object3D | undefined;
  private loading = '';

  constructor(
    private readonly scene: Scene,
    private readonly renderer: WebGLRenderer,
    private readonly baseUrl: string,
  ) {
    this.group.visible = false;
    this.group.scale.setScalar(0.001);
    this.group.add(this.sun.target);
    scene.add(this.group, this.sun, this.ambient);
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
  ): boolean {
    const distKm = renderKm ? Math.hypot(renderKm[0], renderKm[1], renderKm[2]) : Infinity;
    const sizePx = entry ? ((entry.sizeM / 1000) * focalPx) / Math.max(distKm, 1e-9) : 0;
    const wanted = entry !== undefined && renderKm !== undefined && sizePx >= MODEL_MIN_PX;
    if (entry?.id !== this.entry?.id) {
      if (this.object) this.group.remove(this.object);
      this.object = undefined;
      this.entry = entry;
    }
    if (wanted && !this.object && this.loading !== entry.id) {
      this.loading = entry.id;
      ensureEnvironment(this.renderer, this.scene);
      void loadModel(this.baseUrl, entry.id).then((obj) => {
        if (this.loading === entry.id) this.loading = '';
        if (!obj || this.entry?.id !== entry.id) return;
        this.object = obj;
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
      // Directional light: from the Sun side, aimed at the model (target is a child of the group).
      this.sun.position.set(renderKm[0] + sunDir[0], renderKm[1] + sunDir[1], renderKm[2] + sunDir[2]);
    }
    return shown;
  }

  dispose(): void {
    this.scene.remove(this.group, this.sun, this.ambient);
  }
}
