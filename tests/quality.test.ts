import { describe, expect, it } from 'vitest';
import { detectTier, settingsFor, type DeviceSignals } from '../src/render/quality';
import { AdaptiveResolution } from '../src/render/adaptiveResolution';

const desktop: DeviceSignals = {
  coarsePointer: false,
  deviceMemoryGb: 8,
  cores: 16,
  maxTextureSize: 16384,
  maxSamples: 8,
  gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  saveData: false,
};
const pixel10: DeviceSignals = {
  coarsePointer: true,
  deviceMemoryGb: 8,
  cores: 8,
  maxTextureSize: 16384,
  maxSamples: 4,
  gpu: 'PowerVR D-Series DXT-48-1536',
  saveData: false,
};

describe('quality tiers', () => {
  it('gives desktops the high tier, phones the medium one', () => {
    expect(detectTier(desktop).tier).toBe('high');
    // Safari and Firefox do not expose the memory size.
    expect(detectTier({ ...desktop, deviceMemoryGb: undefined }).tier).toBe('high');
    const phone = detectTier(pixel10);
    expect(phone.tier).toBe('medium');
    expect(phone.reasons).toContain('touch device');
  });

  it('falls back to low on any weak signal', () => {
    expect(detectTier({ ...pixel10, deviceMemoryGb: 3 }).tier).toBe('low');
    expect(detectTier({ ...pixel10, cores: 4 }).tier).toBe('low');
    expect(detectTier({ ...desktop, maxTextureSize: 4096 }).tier).toBe('low');
    expect(detectTier({ ...desktop, saveData: true }).tier).toBe('low');
    const sw = detectTier({
      ...desktop,
      gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    });
    expect(sw).toEqual({ tier: 'low', reasons: ['software GPU'] });
  });

  it('keeps the heavy assets for the high tier only', () => {
    expect(settingsFor('high')).toMatchObject({ highModels: true, textures8k: true, alphaToCoverage: true });
    expect(settingsFor('medium')).toMatchObject({ highModels: false, textures8k: false, msaa: true });
    expect(settingsFor('low')).toMatchObject({ highModels: false, msaa: false, panelBlur: false });
  });
});

describe('adaptive resolution', () => {
  const run = (a: AdaptiveResolution, intervalMs: number, durationMs: number): number[] => {
    const changes: number[] = [];
    for (let t = 0; t < durationMs; t += intervalMs) {
      const r = a.record(intervalMs);
      if (r !== undefined) changes.push(r);
    }
    return changes;
  };

  it('waits for the loading to settle, then steps down while frames are slow, never below the floor', () => {
    const a = new AdaptiveResolution(2, 1.25, 2);
    expect(run(a, 40, 5000)).toEqual([]);
    run(a, 16.7, 1000);
    expect(run(a, 40, 20_000)).toEqual([1.75, 1.5, 1.25]);
    expect(a.pixelRatio).toBe(1.25);
  });

  it('steps back up after keeping the display pace, and stops at a level that proved too much', () => {
    const a = new AdaptiveResolution(1.5, 1, 2);
    expect(run(a, 16.7, 16_000)).toEqual([1.75]);
    // Too slow at 1.75 right after going up: back down, and 1.5 becomes the ceiling.
    expect(run(a, 40, 2500)).toEqual([1.5]);
    expect(run(a, 16.7, 30_000)).toEqual([]);
  });

  it('ignores pauses (tab switches, loading) and keeps a 120 Hz display at full resolution', () => {
    const a = new AdaptiveResolution(2, 1, 2);
    expect(run(a, 500, 10_000)).toEqual([]);
    expect(run(a, 8.3, 20_000)).toEqual([]);
    expect(a.pixelRatio).toBe(2);
  });
});
