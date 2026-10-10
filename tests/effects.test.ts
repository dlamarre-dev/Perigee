import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudSeed, cloudSeedParams, resetCloudSeedForTests } from '../src/render/cloudSeed';
import { EFFECT_NAMES, effectEnabled, formatEffectPrefs, parseEffectPrefs } from '../src/render/effects';
import { setQuality, settingsFor, type DeviceSignals } from '../src/render/quality';
import { layerCycle } from '../src/render/simTime';
import { normalMap, resampleHeights, rollToPrimeMeridian } from '../tools/textures/normals';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const signals: DeviceSignals = {
  coarsePointer: false,
  deviceMemoryGb: 8,
  cores: 8,
  maxTextureSize: 16384,
  maxSamples: 8,
  gpu: undefined,
  saveData: false,
};

describe('immersive effect preferences', () => {
  it('are all on by default and only the switched-off ones are stored', () => {
    const all = parseEffectPrefs(null);
    expect(EFFECT_NAMES.every((n) => all[n])).toBe(true);
    expect(formatEffectPrefs(all)).toBe('');
    const someOff = { ...all, clouds: false, sunspots: false };
    expect(formatEffectPrefs(someOff)).toBe('-clouds,-sunspots');
    expect(parseEffectPrefs('-clouds,-sunspots')).toEqual(someOff);
    // Unknown or malformed entries are ignored.
    expect(parseEffectPrefs('-nonsense,relief')).toEqual(all);
  });

  it('are drawn on the high tier only', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      setQuality({
        choice: tier,
        detected: { tier: 'high', reasons: [] },
        settings: settingsFor(tier),
        signals,
      });
      expect(effectEnabled('relief')).toBe(tier === 'high');
    }
  });
});

describe('cloud seed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetCloudSeedForTests();
  });

  it('stays the same within a tab (session storage), across reloads of the page', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const first = cloudSeed();
    resetCloudSeedForTests(); // a reload: memory gone, session storage kept
    expect(cloudSeed()).toBe(first);
  });

  it('differs between tabs', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 8; i++) {
      vi.stubGlobal('sessionStorage', memoryStorage());
      resetCloudSeedForTests();
      seeds.add(cloudSeed());
    }
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('works without session storage', () => {
    const s = cloudSeed();
    expect(cloudSeed()).toBe(s);
  });

  it('maps to a longitude offset in [0, 1) and distinct noise offsets', () => {
    const a = cloudSeedParams(0x12345678);
    const b = cloudSeedParams(0x87654321);
    expect(a.lonOffset).toBeGreaterThanOrEqual(0);
    expect(a.lonOffset).toBeLessThan(1);
    expect(a.noiseOffset).not.toEqual(b.noiseOffset);
  });
});

describe('normal maps from elevation models', () => {
  const decode = (rgb: Buffer, k: number): [number, number, number] => [
    ((rgb[k] ?? 0) / 255) * 2 - 1,
    ((rgb[k + 1] ?? 0) / 255) * 2 - 1,
    ((rgb[k + 2] ?? 0) / 255) * 2 - 1,
  ];

  it('is flat (straight up) for a flat surface', () => {
    const w = 64;
    const h = 32;
    const rgb = normalMap(new Float32Array(w * h).fill(1234), w, h, 1e6, 1);
    const [x, y, z] = decode(rgb, (16 * w + 10) * 3);
    expect(Math.abs(x)).toBeLessThan(0.01);
    expect(Math.abs(y)).toBeLessThan(0.01);
    expect(z).toBeGreaterThan(0.99);
  });

  it('leans towards the west on a slope rising to the east, and towards the south on one rising north', () => {
    const w = 360;
    const h = 180;
    const radiusM = 1e6;
    // On the equator, 1 degree is 17.45 km: 1745 m per degree gives a 0.1 slope.
    const east = new Float32Array(w * h);
    const north = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        east[j * w + i] = Math.min(i, 200) * 1745.3;
        north[j * w + i] = (h - j) * 1745.3;
      }
    }
    const e = decode(normalMap(east, w, h, radiusM, 1), (90 * w + 100) * 3);
    expect(e[0]).toBeCloseTo(-0.1 / Math.hypot(0.1, 1), 1);
    const n = decode(normalMap(north, w, h, radiusM, 1), (90 * w + 100) * 3);
    expect(n[1]).toBeCloseTo(-0.1 / Math.hypot(0.1, 1), 1);
  });

  it('averages areas when shrinking and rolls a 0–360° map to the prime meridian', () => {
    const src = new Float32Array([1, 3, 5, 7, 1, 3, 5, 7]);
    expect([...resampleHeights(src, 4, 2, 2, 1)]).toEqual([2, 6]);
    expect([...rollToPrimeMeridian(new Float32Array([0, 1, 2, 3]), 4, 1, 180)]).toEqual([2, 3, 0, 1]);
  });
});

describe('two-layer cycle of the moving clouds and gas', () => {
  const cycleS = 86_400;

  it('cross-fades smoothly and shows each layer alone around the middle of its life', () => {
    let previous = layerCycle(0, cycleS).weightA;
    for (let t = 60_000; t <= 3 * cycleS * 1000; t += 60_000) {
      const c = layerCycle(t, cycleS);
      expect(Math.abs(c.weightA - previous)).toBeLessThan(0.02);
      previous = c.weightA;
      expect(c.ageA).toBeGreaterThanOrEqual(0);
      expect(c.ageA).toBeLessThan(cycleS);
      expect(c.ageB).toBeGreaterThanOrEqual(0);
      expect(c.ageB).toBeLessThan(cycleS);
      // A layer just started or about to end (same as its previous drawing, or most drifted) is never shown.
      if (c.ageA < 0.2 * cycleS || c.ageA > 0.8 * cycleS) expect(c.weightA).toBe(0);
      if (c.ageB < 0.2 * cycleS || c.ageB > 0.8 * cycleS) expect(c.weightA).toBe(1);
    }
  });

  it('depends on the simulated date only', () => {
    const t = Date.parse('2026-10-10T12:00:00Z');
    expect(layerCycle(t, cycleS)).toEqual(layerCycle(t, cycleS));
    expect(layerCycle(t + cycleS * 1000, cycleS).indexA).toBe(layerCycle(t, cycleS).indexA + 1);
  });
});
