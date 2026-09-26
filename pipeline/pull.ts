/**
 * Downloads the latest published `data` branch into public/data (normal development workflow).
 * Reads from GitHub, never from CelesTrak or Horizons.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ManifestSchema } from '../src/data/schemas';
import { USER_AGENT } from './http';

const RAW = 'https://raw.githubusercontent.com/dlamarre-dev/Perigee/data';

async function get(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  const outDir = resolve('public/data');
  const manifestBytes = await get(`${RAW}/manifest.json`);
  const manifest = ManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  for (const entry of Object.values(manifest.datasets)) {
    const bytes = await get(`${RAW}/${entry.path}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== entry.sha256) throw new Error(`Hash mismatch for ${entry.path}`);
    const file = join(outDir, entry.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    console.log(`pulled ${entry.path} (${entry.count} records, fetched ${entry.fetchedAt})`);
  }
  await writeFile(join(outDir, 'manifest.json'), manifestBytes);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
