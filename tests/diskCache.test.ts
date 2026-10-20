import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskCache } from '../mcp/src/diskCache';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perigee-mcp-cache-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bytes = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
const text = (b: ArrayBuffer | undefined): string | undefined =>
  b ? new TextDecoder().decode(b) : undefined;

describe('MCP disk cache', () => {
  it('stores, replaces older versions, deletes, and leaves no temporary file', async () => {
    const cache = new DiskCache(dir);
    await cache.set('earth/gp.json.gz@aaaa', bytes('one'));
    expect(text(await cache.get('earth/gp.json.gz@aaaa'))).toBe('one');
    await cache.set('earth/gp.json.gz@bbbb', bytes('two'));
    expect(await cache.get('earth/gp.json.gz@aaaa')).toBeUndefined();
    expect(await readdir(dir)).toEqual(['earth_gp.json.gz@bbbb']);
    await cache.delete('earth/gp.json.gz@bbbb');
    expect(await cache.get('earth/gp.json.gz@bbbb')).toBeUndefined();
  });

  it('cleans the temporary files of an interrupted write', async () => {
    await writeFile(join(dir, 'earth_gp.json.gz@cccc.1234.99.tmp'), 'trunc');
    const cache = new DiskCache(dir);
    await cache.set('ephem/lro.bin@dddd', bytes('lro'));
    expect(await readdir(dir)).toEqual(['ephem_lro.bin@dddd']);
  });
});
