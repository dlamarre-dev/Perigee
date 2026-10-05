import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../src/data/schemas';

const omms = readFileSync('tests/fixtures/omm-sample.json');
const gz = gzipSync(omms);
const manifest = {
  version: 1,
  generatedAt: '2026-10-05T00:00:00Z',
  datasets: {
    'earth.gp': {
      path: 'earth/gp.json.gz',
      source: 's',
      fetchedAt: '2026-10-05T00:00:00Z',
      count: 3,
      bytes: gz.length,
      sha256: 'a'.repeat(64),
    },
  },
  ephemerides: {},
} as Manifest;

/** A decode worker that never answers and fails `failAfterMs` after creation, or after the first message. */
function stubWorker(mode: 'fails-at-start' | 'fails-after-request' | 'rejects-data'): void {
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      constructor() {
        if (mode === 'fails-at-start') setTimeout(() => this.onerror?.(new Event('error')), 0);
      }
      postMessage(msg: { id: number }): void {
        if (mode === 'fails-after-request') setTimeout(() => this.onerror?.(new Event('error')), 0);
        if (mode === 'rejects-data') {
          setTimeout(
            () => this.onmessage?.(new MessageEvent('message', { data: { id: msg.id, error: 'bad data' } })),
            0,
          );
        }
      }
    },
  );
}

/** fetch that answers after a short delay (so a worker failure can happen during the download). */
function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return new Response(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('loadBulkDataset', () => {
  it('decodes on the main thread when the worker fails before any request', async () => {
    stubWorker('fails-at-start');
    const fetchMock = stubFetch();
    const { loadBulkDataset } = await import('../src/data/loader');
    const r = await loadBulkDataset('/', manifest, 'earth.gp', 'omm');
    expect(r.data.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The dead worker is never used again.
    await loadBulkDataset('/', manifest, 'earth.gp', 'omm');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches again and decodes on the main thread when the worker dies with the request', async () => {
    stubWorker('fails-after-request');
    const fetchMock = stubFetch();
    const { loadBulkDataset } = await import('../src/data/loader');
    const r = await loadBulkDataset('/', manifest, 'earth.gp', 'omm');
    expect(r.data.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('still fails on invalid data', async () => {
    stubWorker('rejects-data');
    stubFetch();
    const { loadBulkDataset, DataUnavailableError } = await import('../src/data/loader');
    await expect(loadBulkDataset('/', manifest, 'earth.gp', 'omm')).rejects.toBeInstanceOf(
      DataUnavailableError,
    );
  });
});
