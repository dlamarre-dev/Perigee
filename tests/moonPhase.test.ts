import { describe, expect, it } from 'vitest';
import { moonPhase } from '../src/astro/moonPhase';

describe('Moon phase names', () => {
  it('splits the elongation into eight phases centred on the quarters', () => {
    expect(moonPhase(0)).toBe('new');
    expect(moonPhase(350)).toBe('new');
    expect(moonPhase(30)).toBe('waxingCrescent');
    expect(moonPhase(90)).toBe('firstQuarter');
    expect(moonPhase(180)).toBe('full');
    expect(moonPhase(270)).toBe('lastQuarter');
    expect(moonPhase(320)).toBe('waningCrescent');
    expect(moonPhase(-90)).toBe('lastQuarter');
  });
});
