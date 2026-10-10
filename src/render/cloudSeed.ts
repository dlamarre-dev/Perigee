/**
 * Seed of the illustrative Earth clouds (src/render/clouds.ts): drawn once per browser tab, so the clouds differ
 * from one visit to the next but stay the same across view switches and the tab's own reloads (quality change,
 * "Refresh" notice, reload after a deployment), kept in sessionStorage.
 */
const KEY = 'perigee-cloud-seed';

let seed: number | undefined;

function draw(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 0;
}

/** Unsigned 32-bit seed of this tab. */
export function cloudSeed(): number {
  if (seed !== undefined) return seed;
  try {
    const stored = Number(sessionStorage.getItem(KEY));
    if (sessionStorage.getItem(KEY) !== null && Number.isInteger(stored) && stored >= 0 && stored < 2 ** 32) {
      seed = stored;
      return seed;
    }
    seed = draw();
    sessionStorage.setItem(KEY, String(seed));
  } catch {
    // No session storage: this page keeps its own seed.
    seed ??= draw();
  }
  return seed;
}

/** Forgets the in-memory seed (tests). */
export function resetCloudSeedForTests(): void {
  seed = undefined;
}

/** Shader parameters from the seed: a longitude offset (map fraction) and a noise-space offset. */
export function cloudSeedParams(s: number): { lonOffset: number; noiseOffset: [number, number, number] } {
  // Independent bit fields of the seed, each mapped to [0, 1).
  const lonOffset = (s & 0xffff) / 0x10000;
  const a = ((s >>> 16) & 0xff) / 0x100;
  const b = ((s >>> 24) & 0xff) / 0x100;
  const c = ((Math.imul(s, 2654435761) >>> 0) & 0xffff) / 0x10000;
  return { lonOffset, noiseOffset: [a * 97, b * 89, c * 83] };
}
