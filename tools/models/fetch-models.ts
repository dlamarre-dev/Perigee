/**
 * Offline 3D models (catalog/models.json) → public/models/<id>.glb: NASA 3D Resources GLBs, deduplicated,
 * welded, simplified to at most MAX_TRIANGLES, textures resized to MAX_TEXTURE_PX and re-encoded as WebP
 * (EXT_texture_webp), geometry compressed with meshoptimizer (EXT_meshopt_compression), scaled to metres.
 * One request per file, User-Agent, stop on any non-200 response. Downloads are cached in tools/models/src/.
 *
 *   npx tsx tools/models/fetch-models.ts [id…] [--dump-textures]
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
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
import { alignToGrid } from './alignBody';
import { ModelsCatalogSchema, type ModelEntry } from '../../src/data/schemas';

const USER_AGENT = 'Perigee model tool (https://github.com/dlamarre-dev/Perigee)';
const MAX_TRIANGLES = 60_000;
/** Models whose thin flat parts the simplifier tears apart (Fermi's solar arrays): kept whole. */
const KEEP_FULL_DETAIL = new Set(['fermi']);
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
const DROP_NODES: Readonly<Record<string, (centre: readonly number[]) => boolean>> = {
  iss: (c) => (c[1] ?? 0) > 35,
};

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

async function processModel(io: NodeIO, m: ModelEntry, dumpTextures: boolean): Promise<void> {
  const doc = await io.readBinary(await download(m));
  await maskLogos(doc, m.id);
  dropStrayNodes(doc, m.id);
  const trisIn = triangles(doc);
  await doc.transform(dedup(), prune(), weld());
  // Simplify in steps of growing tolerance until under budget (thin parts of trusses resist at low error).
  for (const error of [0.002, 0.01, 0.03, 0.08]) {
    const tris = triangles(doc);
    if (tris <= MAX_TRIANGLES || KEEP_FULL_DETAIL.has(m.id)) break;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: MAX_TRIANGLES / tris, error }));
  }
  // Scale: glTF units are metres; some exports are in centimetres or arbitrary units.
  const native = extentM(doc);
  const factor =
    !m.body && native > 0 && (native > m.sizeM * SCALE_TOLERANCE || native < m.sizeM / SCALE_TOLERANCE)
      ? m.sizeM / native
      : 1;
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
  if (factor !== 1) {
    const scale = [factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, 1] as const;
    for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, [...scale]);
    for (const node of doc.getRoot().listNodes()) {
      const t = node.getTranslation();
      node.setTranslation([t[0] * factor, t[1] * factor, t[2] * factor]);
    }
  }
  await doc.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      // Bodies are seen close up: keep their maps sharper.
      resize: m.body ? [2048, 2048] : [MAX_TEXTURE_PX, MAX_TEXTURE_PX],
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
