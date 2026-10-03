/**
 * Offline 3D models (catalog/models.json) → public/models/<id>.glb: NASA 3D Resources GLBs, deduplicated,
 * welded, simplified to at most MAX_TRIANGLES, textures resized to MAX_TEXTURE_PX and re-encoded as WebP
 * (EXT_texture_webp), geometry compressed with meshoptimizer (EXT_meshopt_compression), scaled to metres.
 * One request per file, User-Agent, stop on any non-200 response. Downloads are cached in tools/models/src/.
 *
 *   npx tsx tools/models/fetch-models.ts [id…] [--dump-textures] [--high]   (--high: full-quality variants only)
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document, type Texture, type Transform } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  join as joinPrimitives,
  getBounds,
  prune,
  simplify,
  textureCompress,
  weld,
  meshopt,
  transformMesh,
} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { encodeKtx2 } from '../textures/basisu';
import { alignToGrid } from './alignBody';
import { ModelsCatalogSchema, type ModelEntry } from '../../src/data/schemas';

const USER_AGENT = 'Perigee model tool (https://github.com/dlamarre-dev/Perigee)';
const MAX_TRIANGLES = 60_000;
/** Models whose thin flat parts the simplifier tears apart (Fermi's solar arrays): kept whole. */
const KEEP_FULL_DETAIL = new Set(['fermi']);
/**
 * Models made of thousands of small parts (the IGOAL ISS): parts merged by material before simplifying, a
 * looser final tolerance, smaller textures.
 */
const HEAVY_MODELS: Readonly<
  Record<
    string,
    {
      readonly maxError: number;
      readonly texturePx: number;
      readonly maxTriangles: number;
      /** Parts left out (fine details invisible at the scales shown). */
      readonly dropNames?: RegExp;
      /** The export is mirrored (left-handed): flip X so the layout matches the real spacecraft. */
      readonly mirrorX?: boolean;
    }
  >
> = {
  iss: {
    maxError: 0.3,
    texturePx: 512,
    maxTriangles: 200_000,
    dropNames: /detail|handrail|misc|bolt|cable|wire/i,
    // Columbus and the S trusses sit to starboard of a forward-flying lab, the Cupola under Node 3: only a
    // mirror image satisfies all three in this export.
    mirrorX: true,
  },
};
const MAX_TEXTURE_PX = 1024;
/** Models whose native extent is within this factor of the catalog size keep their own scale. */
const SCALE_TOLERANCE = 1.3;
const here = dirname(fileURLToPath(import.meta.url));

async function downloadText(name: string, url: string): Promise<string> {
  const file = join(here, 'src', `${name}.tab`);
  if (existsSync(file)) return readFile(file, 'utf8');
  console.log(`fetch   ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return text;
}

async function download(m: ModelEntry): Promise<Uint8Array> {
  const file = join(here, 'src', `${m.id}.glb`);
  if (existsSync(file)) return new Uint8Array(await readFile(file));
  console.log(`fetch   ${m.url}`);
  const res = await fetch(m.url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${m.url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}

function triangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += Math.floor((idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3);
    }
  }
  return n;
}

function extentM(doc: Document): number {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return 0;
  const { min, max } = getBounds(scene);
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

/**
 * Decals showing the NASA insignia ("meatball") or the JPL logo, which are not public domain (NASA media
 * guidelines): covered with the surrounding colour. Rectangles in pixels of the source texture, by model and
 * texture name.
 */
const LOGO_MASKS: Readonly<
  Record<string, readonly { texture: string; x: number; y: number; w: number; h: number }[]>
> = {
  // ISS (IGOAL model): the NASA insignia on the Airlock, Unity (Node 1), Node 2/3, PMM and Lab decals.
  iss: [
    { texture: 'Airlock_Diffuse', x: 700, y: 640, w: 130, h: 128 },
    { texture: 'Node1_Diffuse', x: 700, y: 508, w: 76, h: 60 },
    { texture: 'Node2_Node3_Diffuse', x: 290, y: 414, w: 126, h: 128 },
    { texture: 'PMM_Diffuse', x: 562, y: 434, w: 130, h: 120 },
    { texture: 'USLab_diffuse', x: 896, y: 896, w: 124, h: 124 },
  ],
  curiosity: [
    { texture: 'tex_05.jpg', x: 412, y: 343, w: 102, h: 102 },
    { texture: 'tex_05.jpg', x: 416, y: 148, w: 96, h: 96 },
  ],
  ingenuity: [
    { texture: 'blade', x: 884, y: 388, w: 122, h: 122 },
    { texture: 'blade', x: 22, y: 152, w: 136, h: 64 },
  ],
  perseverance: [
    { texture: 'arm_graphics', x: 98, y: 258, w: 94, h: 94 },
    { texture: 'arm_graphics', x: 188, y: 280, w: 102, h: 60 },
    // Ingenuity, carried under the rover.
    { texture: 'blade', x: 884, y: 388, w: 122, h: 122 },
    { texture: 'blade', x: 22, y: 152, w: 136, h: 64 },
  ],
};

/** Stray parts left in some exports (e.g. seven discs floating 41 units above the ISS model, before rescaling). */
const DROP_NODES: Readonly<Record<string, (centre: readonly number[]) => boolean>> = {};

function dropStrayNodes(doc: Document, modelId: string): void {
  const drop = DROP_NODES[modelId];
  if (!drop) return;
  let n = 0;
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    const b = getBounds(node);
    if (drop(b.min.map((v, i) => (v + (b.max[i] ?? 0)) / 2))) {
      node.dispose();
      n++;
    }
  }
  console.log(`drop    ${modelId}: ${n} stray node(s)`);
}

/** Fills each rectangle with the median colour of a thin ring around it. */
async function maskLogos(doc: Document, modelId: string): Promise<void> {
  const masks = LOGO_MASKS[modelId] ?? [];
  for (const tex of doc.getRoot().listTextures()) {
    const mine = masks.filter((mk) => tex.getName() === mk.texture);
    const image = tex.getImage();
    if (mine.length === 0 || !image) continue;
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    for (const mk of mine) {
      const ring: number[][] = [[], [], [], []];
      for (let y = Math.max(0, mk.y - 4); y < Math.min(H, mk.y + mk.h + 4); y++) {
        for (let x = Math.max(0, mk.x - 4); x < Math.min(W, mk.x + mk.w + 4); x++) {
          const inside = x >= mk.x && x < mk.x + mk.w && y >= mk.y && y < mk.y + mk.h;
          if (inside) continue;
          for (let c = 0; c < 4; c++) ring[c]?.push(data[(y * W + x) * 4 + c] ?? 0);
        }
      }
      const median = ring.map((v) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0);
      for (let y = mk.y; y < Math.min(H, mk.y + mk.h); y++) {
        for (let x = mk.x; x < Math.min(W, mk.x + mk.w); x++) {
          for (let c = 0; c < 4; c++) data[(y * W + x) * 4 + c] = median[c] ?? 0;
        }
      }
    }
    tex.setImage(
      new Uint8Array(
        await sharp(data, { raw: { width: W, height: H, channels: 4 } })
          .png()
          .toBuffer(),
      ),
    );
    tex.setMimeType('image/png');
    console.log(`mask    ${modelId}/${tex.getName()}: ${mine.length} logo(s) covered`);
  }
  const missing = masks.filter(
    (mk) =>
      !doc
        .getRoot()
        .listTextures()
        .some((t) => t.getName() === mk.texture),
  );
  if (missing.length > 0)
    throw new Error(
      `${modelId}: logo mask textures not found: ${missing.map((mk) => mk.texture).join(', ')}`,
    );
}

/**
 * Full-quality variant (`high` entries, loaded by the client only when the model fills the screen): every part
 * kept, no simplification, unused vertex attributes stripped, textures ≤ HIGH_TEXTURE_PX as KTX2 (Basis:
 * ETC1S for colour, UASTC for normal maps), so GPU memory stays a fraction of the uncompressed size.
 */
const HIGH_TEXTURE_PX = 2048;

async function compressTexturesKtx2(doc: Document, modelId: string): Promise<void> {
  const linear = new Set<Texture>();
  const normals = new Set<Texture>();
  for (const mat of doc.getRoot().listMaterials()) {
    for (const t of [mat.getMetallicRoughnessTexture(), mat.getOcclusionTexture()]) if (t) linear.add(t);
    const n = mat.getNormalTexture();
    if (n) normals.add(n);
  }
  const textures = doc.getRoot().listTextures();
  let i = 0;
  for (const tex of textures) {
    i++;
    const image = tex.getImage();
    if (!image) continue;
    const meta = await sharp(image).metadata();
    // Normal maps (UASTC, ~8 bits/texel) at most 1024 px: they dominated the file at 2048.
    const cap = normals.has(tex) ? HIGH_TEXTURE_PX / 2 : HIGH_TEXTURE_PX;
    const size = Math.min(cap, Math.max(meta.width ?? 4, meta.height ?? 4));
    // Basis needs dimensions that are multiples of 4; powers of two keep the mip chain clean.
    const pot = 2 ** Math.round(Math.log2(size));
    const png = await sharp(image).resize(pot, pot, { fit: 'fill' }).png().toBuffer();
    const out = join(here, 'src', 'tmp', `${modelId}-${i}.ktx2`);
    await encodeKtx2(png, out, {
      workDir: join(here, 'src', 'tmp', 'w'),
      cacheDir: join(here, '..', 'textures', 'src', 'bin'),
      userAgent: USER_AGENT,
      codec: normals.has(tex) ? 'uastc' : 'etc1s',
      srgb: !(normals.has(tex) || linear.has(tex)),
      yFlip: false,
    });
    tex.setImage(new Uint8Array(await readFile(out))).setMimeType('image/ktx2');
    if (i % 10 === 0) console.log(`ktx2    ${modelId}: ${i}/${textures.length}`);
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
}

async function processHigh(io: NodeIO, m: ModelEntry): Promise<void> {
  const doc = await io.readBinary(await download(m));
  await maskLogos(doc, m.id);
  dropStrayNodes(doc, m.id);
  const heavy = HEAVY_MODELS[m.id];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) {
        if (/^COLOR_|^TEXCOORD_[1-9]/.test(semantic)) prim.setAttribute(semantic, null);
      }
    }
  }
  await doc.transform(dedup(), prune(), flatten(), joinPrimitives(), weld());
  // Error bound only (1e-3 of the extent, ~11 cm on the ISS): removes redundant vertices, invisible at the
  // closest follow distance.
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: 0.001 }));
  const native = extentM(doc);
  const factor =
    native > 0 && (native > m.sizeM * SCALE_TOLERANCE || native < m.sizeM / SCALE_TOLERANCE)
      ? m.sizeM / native
      : 1;
  if (heavy?.mirrorX) mirrorScene(doc);
  if (factor !== 1) scaleScene(doc, factor);
  await compressTexturesKtx2(doc, m.id);
  await doc.transform(
    prune(),
    (d: Document) => {
      d.getRoot()
        .listExtensionsUsed()
        .find((e) => e.extensionName === 'KHR_draco_mesh_compression')
        ?.dispose();
    },
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const out = join(here, '..', '..', 'public', 'models', `${m.id}-high.glb`);
  const bytes = await io.writeBinary(doc);
  await writeFile(out, bytes);
  console.log(
    `write   ${(m.id + '-high').padEnd(20)} ${(bytes.byteLength / 1e6).toFixed(2)} MB  ${triangles(doc)} tris  textures ${doc.getRoot().listTextures().length}`,
  );
}

function mirrorScene(doc: Document): void {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return;
  const mirror = doc.createNode('mirror').setScale([-1, 1, 1]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    mirror.addChild(child);
  }
  scene.addChild(mirror);
}

function scaleScene(doc: Document, factor: number): void {
  const scale = [factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, 1] as const;
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, [...scale]);
  for (const node of doc.getRoot().listNodes()) {
    const t = node.getTranslation();
    node.setTranslation([t[0] * factor, t[1] * factor, t[2] * factor]);
  }
}

async function processModel(io: NodeIO, m: ModelEntry, dumpTextures: boolean): Promise<void> {
  const doc = await io.readBinary(await download(m));
  await maskLogos(doc, m.id);
  dropStrayNodes(doc, m.id);
  const trisIn = triangles(doc);
  const heavy = HEAVY_MODELS[m.id];
  if (heavy?.dropNames) {
    let dropped = 0;
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (mesh && heavy.dropNames.test(`${node.getName()} ${mesh.getName()}`)) {
        node.dispose();
        dropped++;
      }
    }
    console.log(`drop    ${m.id}: ${dropped} detail part(s)`);
  }
  const merge: Transform[] = heavy ? [flatten(), joinPrimitives()] : [];
  await doc.transform(dedup(), prune(), ...merge, weld());
  // Simplify in steps of growing tolerance until under budget (thin parts of trusses resist at low error).
  for (const error of [0.002, 0.01, 0.03, 0.08, ...(heavy ? [0.15, heavy.maxError] : [])]) {
    const tris = triangles(doc);
    const budget = heavy?.maxTriangles ?? MAX_TRIANGLES;
    if (tris <= budget || KEEP_FULL_DETAIL.has(m.id)) break;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: budget / tris, error }));
  }
  // Scale: glTF units are metres; some exports are in centimetres or arbitrary units.
  const native = extentM(doc);
  const factor =
    !m.body && native > 0 && (native > m.sizeM * SCALE_TOLERANCE || native < m.sizeM / SCALE_TOLERANCE)
      ? m.sizeM / native
      : 1;
  if (heavy?.mirrorX) mirrorScene(doc);
  if (m.body) {
    // Bake node transforms, then rotate and scale into the IAU body frame (metres), fitted on the PDS grid.
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (mesh) transformMesh(mesh, node.getWorldMatrix());
    }
    for (const node of doc.getRoot().listNodes()) {
      node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    }
    const fit = alignToGrid(doc, await downloadText(`${m.id}-grid`, m.body.alignGridUrl));
    for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, fit.matrix);
    console.log(
      `align   ${m.id}: ${fit.scaleKmPerUnit.toFixed(4)} km/unit, residual ${fit.rmsKm.toFixed(2)} km RMS vs the PDS grid`,
    );
  }
  if (factor !== 1) scaleScene(doc, factor);
  await doc.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      // Bodies are seen close up: keep their maps sharper.
      resize: m.body
        ? [2048, 2048]
        : [heavy?.texturePx ?? MAX_TEXTURE_PX, heavy?.texturePx ?? MAX_TEXTURE_PX],
    }),
    prune(),
    // Output without Draco (meshopt only, decoded by three's MeshoptDecoder).
    (d: Document) => {
      d.getRoot()
        .listExtensionsUsed()
        .find((e) => e.extensionName === 'KHR_draco_mesh_compression')
        ?.dispose();
    },
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  if (dumpTextures) {
    const dir = join(here, 'src', 'textures', m.id);
    await mkdir(dir, { recursive: true });
    for (const [i, tex] of doc.getRoot().listTextures().entries()) {
      const img = tex.getImage();
      if (img)
        await sharp(img)
          .png()
          .toFile(join(dir, `${i}-${(tex.getName() || 'texture').replace(/[^a-z0-9_-]+/gi, '_')}.png`));
    }
  }
  const out = join(here, '..', '..', 'public', 'models', `${m.id}.glb`);
  await mkdir(dirname(out), { recursive: true });
  const bytes = await io.writeBinary(doc);
  await writeFile(out, bytes);
  console.log(
    `write   ${m.id.padEnd(20)} ${(bytes.byteLength / 1e6).toFixed(2)} MB  ${trisIn} → ${triangles(doc)} tris  ` +
      `extent ${native.toFixed(2)} → ${extentM(doc).toFixed(2)} m  textures ${doc.getRoot().listTextures().length}`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dumpTextures = args.includes('--dump-textures');
  const ids = args.filter((a) => !a.startsWith('--'));
  const catalog = ModelsCatalogSchema.parse(
    JSON.parse(await readFile(join(here, '..', '..', 'catalog', 'models.json'), 'utf8')),
  );
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    // Some NASA exports use Draco: decoded on read, re-encoded with meshoptimizer.
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const failed: string[] = [];
  for (const m of catalog.models) {
    if (ids.length > 0 && !ids.includes(m.id)) continue;
    try {
      if (args.includes('--high')) {
        if (m.high) await processHigh(io, m);
        continue;
      }
      await processModel(io, m, dumpTextures);
    } catch (err) {
      failed.push(`${m.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((ok) => setTimeout(ok, 300));
  }
  if (failed.length > 0) {
    console.error(['Failed:', ...failed].join('\n  '));
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
