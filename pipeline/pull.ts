/**
 * Downloads the latest published `data` branch into public/data (normal development workflow).
 * Reads from GitHub, never from CelesTrak or Horizons.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ManifestSchema, ShardIndexSchema } from '../src/data/schemas';
import { shardPath } from '../src/data/shards';
import { USER_AGENT } from './http';

const RAW = 'https://raw.githubusercontent.com/dlamarre-dev/Perigee/data';

async function get(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  const dirFlag = process.argv.indexOf('--data-dir');
  const outDir = resolve(dirFlag >= 0 ? (process.argv[dirFlag + 1] ?? 'public/data') : 'public/data');
  const manifestBytes = await get(`${RAW}/manifest.json`);
  const manifest = ManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  for (const entry of [
    ...Object.values(manifest.datasets),
    ...Object.values(manifest.ephemerides),
    ...Object.values(manifest.moons),
    ...Object.values(manifest.comets),
    ...Object.values(manifest.asteroids),
    // The 30-day archives before the windows (past dates), with their mission's fetch time.
    ...Object.values(manifest.ephemerides).flatMap((e) =>
      e.past ? [{ ...e.past, fetchedAt: e.fetchedAt }] : [],
    ),
  ]) {
    const bytes = await get(`${RAW}/${entry.path}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== entry.sha256) throw new Error(`Hash mismatch for ${entry.path}`);
    const file = join(outDir, entry.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    console.log(`pulled ${entry.path} (${entry.count} records, fetched ${entry.fetchedAt})`);
  }
  // What the headless engine reads besides (landing pages and the embed API in dev): the shards of the Earth
  // datasets, checked against their index, the name index and the counts.
  for (const entry of Object.values(manifest.datasets)) {
    const extra: { path: string; sha256?: string }[] = [];
    if (entry.names)
      extra.push({ path: entry.names, ...(entry.namesSha256 ? { sha256: entry.namesSha256 } : {}) });
    const shards = entry.shards;
    if (shards?.index && shards.indexSha256) {
      const indexBytes = await get(`${RAW}/${shards.index}`);
      if (createHash('sha256').update(indexBytes).digest('hex') !== shards.indexSha256)
        throw new Error(`Hash mismatch for ${shards.index}`);
      await mkdir(dirname(join(outDir, shards.index)), { recursive: true });
      await writeFile(join(outDir, shards.index), indexBytes);
      const index = ShardIndexSchema.parse(JSON.parse(gunzipSync(indexBytes).toString('utf8')));
      index.sha256.forEach((sha256, k) => extra.push({ path: shardPath(shards.path, k), sha256 }));
    }
    for (let i = 0; i < extra.length; i += 8) {
      await Promise.all(
        extra.slice(i, i + 8).map(async (f) => {
          const bytes = await get(`${RAW}/${f.path}`);
          if (f.sha256 && createHash('sha256').update(bytes).digest('hex') !== f.sha256)
            throw new Error(`Hash mismatch for ${f.path}`);
          await mkdir(dirname(join(outDir, f.path)), { recursive: true });
          await writeFile(join(outDir, f.path), bytes);
        }),
      );
    }
    if (extra.length) console.log(`pulled ${extra.length} engine files of ${entry.path}`);
  }
  if (manifest.stats) {
    const bytes = await get(`${RAW}/${manifest.stats.path}`);
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.stats.sha256)
      throw new Error(`Hash mismatch for ${manifest.stats.path}`);
    await writeFile(join(outDir, manifest.stats.path), bytes);
    console.log(`pulled ${manifest.stats.path}`);
  }
  await writeFile(join(outDir, 'manifest.json'), manifestBytes);
  // Latest maintenance audit (weekly; absent until the first run).
  for (const name of ['audit.json', 'audit.md']) {
    try {
      await writeFile(join(outDir, name), await get(`${RAW}/${name}`));
      console.log(`pulled ${name}`);
    } catch {
      console.log(`no ${name} published yet`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
