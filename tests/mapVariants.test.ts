import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { altShown, MAP_VARIANTS, onMapVariantChange, setAltShown } from '../src/render/mapVariants';
import { textureLevels } from '../src/render/textureLevels';

describe('map variants', () => {
  it('ship both maps of each body, with their texts', () => {
    for (const [body, variant] of Object.entries(MAP_VARIANTS)) {
      for (const name of ['color', variant.alt]) {
        const levels = textureLevels(body, name) ?? { webp: [], ktx2: [] };
        expect(levels.webp.length, `${body}/${name}`).toBeGreaterThan(0);
        for (const k of levels.webp)
          expect(existsSync(`public/textures/${body}/${name}-${k}k.webp`)).toBe(true);
        for (const k of levels.ktx2)
          expect(existsSync(`public/textures/${body}/${name}-${k}k.ktx2`)).toBe(true);
      }
      for (const key of [variant.mainLabel, variant.altLabel, variant.mainCaption, variant.altCaption]) {
        expect(en[key]).toBeTruthy();
      }
    }
  });

  it('notify a change once', () => {
    const seen: string[] = [];
    const off = onMapVariantChange((body) => seen.push(body));
    setAltShown('titan', true);
    setAltShown('titan', true);
    expect(altShown('titan')).toBe(true);
    setAltShown('titan', false);
    off();
    setAltShown('venus', true);
    setAltShown('venus', false);
    expect(seen).toEqual(['titan', 'titan']);
  });
});
