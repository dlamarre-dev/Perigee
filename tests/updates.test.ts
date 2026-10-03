import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_RELOAD_GAP_MS,
  CAMERA_SNAPSHOT_TTL_MS,
  UpdateWatcher,
  claimAutoReload,
  datasetKey,
  detectUpdate,
  ephemerisKey,
  saveCamera,
  takeCamera,
  type CameraSnapshot,
} from '../src/app/updates';
import type { Manifest } from '../src/data/schemas';

const H = (c: string): string => c.repeat(64);

function manifest(gp: string, lro: string): Manifest {
  const entry = (sha256: string) => ({
    path: 'x',
    source: 's',
    fetchedAt: '2026-10-03T00:00:00Z',
    count: 1,
    bytes: 1,
    sha256,
  });
  return {
    version: 1,
    generatedAt: '2026-10-03T00:00:00Z',
    datasets: { 'earth.gp': entry(gp) },
    ephemerides: {
      lro: {
        ...entry(lro),
        horizonsId: '-85',
        center: '500@301',
        centralBody: 'moon',
        startTdbJd: 0,
        endTdbJd: 1,
        stepMin: 2,
      },
    },
  } as Manifest;
}

describe('detectUpdate', () => {
  const loaded = new Map([[datasetKey('earth.gp'), H('a')]]);

  it('reports a new build, but not in development builds', () => {
    expect(detectUpdate('abc1234', 'def5678', loaded, undefined)).toBe('app');
    expect(detectUpdate('dev', 'def5678', loaded, undefined)).toBeUndefined();
    expect(detectUpdate('abc1234', 'abc1234', loaded, undefined)).toBeUndefined();
    expect(detectUpdate('abc1234', undefined, loaded, undefined)).toBeUndefined();
  });

  it('reports newer data only for what the view loaded', () => {
    expect(detectUpdate('c', 'c', loaded, manifest(H('a'), H('b')))).toBeUndefined();
    // The Moon ephemeris changed, but this view (Earth) did not load it.
    expect(detectUpdate('c', 'c', loaded, manifest(H('a'), H('c')))).toBeUndefined();
    expect(detectUpdate('c', 'c', loaded, manifest(H('d'), H('b')))).toBe('data');
    const moon = new Map([[ephemerisKey('lro'), H('b')]]);
    expect(detectUpdate('c', 'c', moon, manifest(H('d'), H('e')))).toBe('data');
    // A dataset that vanished from the manifest is not newer data.
    expect(detectUpdate('c', 'c', new Map([[ephemerisKey('gone'), H('b')]]), manifest(H('a'), H('b')))).toBe(
      undefined,
    );
  });
});

describe('UpdateWatcher.check', () => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  function watcher(
    fetchImpl: typeof fetch,
    m: Manifest,
    loaded = new Map([[datasetKey('earth.gp'), H('a')]]),
  ) {
    const onUpdate = vi.fn();
    const w = new UpdateWatcher({
      baseUrl: '/Perigee/',
      commit: 'abc1234',
      loaded: () => loaded,
      loadManifest: () => Promise.resolve(m),
      onUpdate,
      fetch: fetchImpl,
    });
    return { w, onUpdate };
  }

  it('asks version.json past the HTTP cache and reports a new build once', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json({ commit: 'fff0000' })));
    const { w, onUpdate } = watcher(fetchImpl as unknown as typeof fetch, manifest(H('a'), H('b')));
    expect(await w.check()).toBe('app');
    expect(fetchImpl).toHaveBeenCalledWith('/Perigee/version.json', { cache: 'no-cache' });
    expect(await w.check()).toBeUndefined();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('reports newer data when the build is the same, even without version.json', async () => {
    const same = watcher(
      (() => Promise.resolve(json({ commit: 'abc1234' }))) as typeof fetch,
      manifest(H('z'), H('b')),
    );
    expect(await same.w.check()).toBe('data');
    const missing = watcher((() => Promise.resolve(json({}, 404))) as typeof fetch, manifest(H('z'), H('b')));
    expect(await missing.w.check()).toBe('data');
  });

  it('stays quiet when offline or when nothing changed', async () => {
    const offline = watcher(
      (() => Promise.reject(new TypeError('offline'))) as typeof fetch,
      manifest(H('z'), H('b')),
    );
    expect(await offline.w.check()).toBeUndefined();
    const quiet = watcher(
      (() => Promise.resolve(json({ commit: 'abc1234' }))) as typeof fetch,
      manifest(H('a'), H('b')),
    );
    expect(await quiet.w.check()).toBeUndefined();
    expect(offline.onUpdate).not.toHaveBeenCalled();
    expect(quiet.onUpdate).not.toHaveBeenCalled();
  });
});

describe('camera snapshot and reload guard', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const snap = (savedAtMs: number): CameraSnapshot => ({
    view: 'moon',
    frame: 'fixed',
    savedAtMs,
    targetKm: [0, 0, 0],
    distanceKm: 5000,
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    following: false,
  });

  it('restores the camera once, for the same view and frame, shortly after saving', () => {
    saveCamera(snap(1000));
    expect(takeCamera('moon', 'fixed', 2000)?.distanceKm).toBe(5000);
    expect(takeCamera('moon', 'fixed', 2000)).toBeUndefined();
    saveCamera(snap(1000));
    expect(takeCamera('mars', 'fixed', 2000)).toBeUndefined();
    saveCamera(snap(1000));
    expect(takeCamera('moon', 'inertial', 2000)).toBeUndefined();
    saveCamera(snap(1000));
    expect(takeCamera('moon', 'fixed', 1000 + CAMERA_SNAPSHOT_TTL_MS)).toBeUndefined();
  });

  it('allows one automatic reload per minute', () => {
    expect(claimAutoReload(10_000_000)).toBe(true);
    expect(claimAutoReload(10_000_000 + AUTO_RELOAD_GAP_MS - 1)).toBe(false);
    expect(claimAutoReload(10_000_000 + AUTO_RELOAD_GAP_MS)).toBe(true);
  });
});
