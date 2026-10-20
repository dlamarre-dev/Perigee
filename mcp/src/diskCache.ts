/**
 * Disk cache of Perigee's published files for the MCP server, keyed by path and content hash (src/engine/data.ts):
 * a hit is always current, and storing a new version of a file removes the older ones.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ByteCache } from '../../src/engine/data';

export function defaultCacheDir(): string {
  const root =
    process.env['XDG_CACHE_HOME'] ??
    (process.platform === 'win32'
      ? (process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'))
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches')
        : join(homedir(), '.cache'));
  return join(root, 'perigee-mcp');
}

/** "ephem/lro.bin@0123abcd" → "ephem_lro.bin@0123abcd". */
const fileName = (key: string): string => key.replace(/[^A-Za-z0-9.@-]/g, '_');

export class DiskCache implements ByteCache {
  constructor(private readonly dir: string) {}

  async get(key: string): Promise<ArrayBuffer | undefined> {
    try {
      const buf = await readFile(join(this.dir, fileName(key)));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch {
      return undefined;
    }
  }

  async set(key: string, bytes: ArrayBuffer): Promise<void> {
    const name = fileName(key);
    const stem = name.slice(0, name.lastIndexOf('@') + 1);
    try {
      await mkdir(this.dir, { recursive: true });
      for (const old of await readdir(this.dir)) {
        const stale = (stem && old.startsWith(stem) && old !== name) || old.endsWith('.tmp');
        if (stale) await rm(join(this.dir, old), { force: true });
      }
      // Written aside, then renamed: a process killed mid-write leaves a temporary file, never a truncated entry.
      // (The engine also checks every hit against its hash and deletes one that does not match.)
      const temp = join(this.dir, `${name}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temp, new Uint8Array(bytes));
      await rename(temp, join(this.dir, name));
    } catch {
      // A cache that cannot be written only costs a download next time.
    }
  }

  async delete(key: string): Promise<void> {
    await rm(join(this.dir, fileName(key)), { force: true }).catch(() => undefined);
  }
}
