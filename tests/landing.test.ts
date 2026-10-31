import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSetParams } from '../src/app/embedApi';
import { resolve } from '../src/engine/objects';
import { nightPath, subsolarPoint, trackPath } from '../src/landing/GroundTrackMap';
import { forgetPlace, loadPlace, OBSERVER_KEY, roundPlace, savePlace } from '../src/landing/observer';
import { CREDITS_PATHS, listedObjects, renderAll, renderSitemap, viewQuery } from '../src/landing/render';
import { THEMES, TOPICS, topicPath } from '../src/landing/topics';

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const CTX = { site: 'https://perigee.info/', base: '/', version: '9.9.9' };
const TEMPLATE = readFileSync('landing.html', 'utf8');

describe('landing topics', () => {
  it('have unique ids and slugs, complete texts and known themes', () => {
    expect(TOPICS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    for (const lang of ['en', 'fr'] as const) {
      expect(new Set(TOPICS.map((t) => t.slug[lang])).size).toBe(TOPICS.length);
      for (const t of TOPICS) {
        expect(t.slug[lang]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(t.question[lang].length).toBeGreaterThan(10);
        expect(t.description[lang].length, `${t.id} description`).toBeLessThanOrEqual(170);
        expect(t.intro[lang].split(/\s+/).length, `${t.id} intro`).toBeGreaterThanOrEqual(70);
        expect(t.faq.length).toBeGreaterThanOrEqual(2);
      }
    }
    for (const t of TOPICS) expect(THEMES.map((x) => x.id)).toContain(t.theme);
  });

  it('name objects the catalogues know, and related topics that exist', () => {
    for (const t of TOPICS) {
      for (const id of [t.target, ...(t.targets ?? [])].filter((x): x is string => !!x)) {
        expect(() => resolve(id), `${t.id}: ${id}`).not.toThrow();
      }
      for (const r of t.related)
        expect(
          TOPICS.map((x) => x.id),
          `${t.id} → ${r}`,
        ).toContain(r);
      if (t.kind === 'around' || t.kind === 'bodies' || t.kind === 'sites')
        expect(listedObjects(t).length, t.id).toBeGreaterThan(0);
    }
  });

  it('link to the app view in embed mode', () => {
    expect(viewQuery({ view: 'earth', sel: '25544', follow: true }, 'fr', true)).toBe(
      '?sel=25544&lang=fr&follow=1&embed=1',
    );
    expect(viewQuery({ view: 'solar', params: { candidates: '1' } }, 'en', false)).toBe(
      '?view=solar&candidates=1&lang=en',
    );
    // The Apollo sites alone: the spacecraft around the Moon hidden, from the catalogue.
    const apollo = new URLSearchParams(viewQuery({ view: 'moon', hideMissions: true }, 'en', true));
    expect(apollo.get('hide')?.split(',')).toEqual(
      expect.arrayContaining(['lro', 'danuri', 'chandrayaan-2']),
    );
    // A page about one spacecraft hides the others, not it, nor the dwarf planets.
    const hide = new URLSearchParams(
      viewQuery({ view: 'solar', sel: 'voyager-1', hideMissions: true }, 'en', true),
    )
      .get('hide')
      ?.split(',');
    expect(hide).toContain('voyager-2');
    expect(hide).not.toContain('voyager-1');
    expect(hide).not.toContain('ceres');
  });
});

describe('landing pages', () => {
  const pages = renderAll(TEMPLATE, CTX);

  it('are written for every topic and language, plus the two indexes and the credits', () => {
    expect(pages.size).toBe(TOPICS.length * 2 + 4);
    expect(pages.has('en/where-is-the-iss/index.html')).toBe(true);
    expect(pages.has('fr/ou-est-la-station-spatiale/index.html')).toBe(true);
    expect(pages.has('fr/index.html')).toBe(true);
    // Every credit of the About dialog is on the credits page; the other pages only link to it.
    const credits = pages.get(`${CREDITS_PATHS.fr}index.html`) ?? '';
    expect(credits).toContain('Solar System Scope (INOVE)');
    expect(credits).toContain('Saira, Omnibus-Type (OFL-1.1)');
    const topic = pages.get('fr/ou-est-la-station-spatiale/index.html') ?? '';
    expect(topic).toContain(`href="/${CREDITS_PATHS.fr}"`);
    expect(topic).not.toContain('Solar System Scope');
  });

  it('carry their title, canonical, hreflang pair and structured data', () => {
    const html = pages.get('fr/ou-est-la-station-spatiale/index.html') ?? '';
    expect(html).toContain('<html lang="fr"');
    expect(html).toContain('<title>Où est la Station spatiale internationale ? | Périgée</title>');
    expect(html).toContain(
      '<link rel="canonical" href="https://perigee.info/fr/ou-est-la-station-spatiale/">',
    );
    expect(html).toContain('hreflang="en" href="https://perigee.info/en/where-is-the-iss/"');
    expect(html).toContain('hreflang="x-default" href="https://perigee.info/en/where-is-the-iss/"');
    expect(html).toContain('src="/?sel=25544&amp;lang=fr&amp;follow=1&amp;embed=1"');
    expect(html).toContain('id="lp-locate"');
    expect(html).toContain('href="/confidentialite.html"');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) =>
      JSON.parse(m[1] ?? ''),
    );
    expect(blocks.map((b: { '@type': string }) => b['@type'])).toEqual([
      'WebPage',
      'BreadcrumbList',
      'FAQPage',
    ]);
    expect(html).not.toMatch(/<!--lp:/);
  });

  it('only ask for the place where it is used', () => {
    expect(pages.get('en/how-far-is-voyager-1/index.html')).not.toContain('id="lp-locate"');
    expect(pages.get('en/what-is-in-the-sky-tonight/index.html')).toContain('id="lp-locate"');
  });

  it('are all in the sitemap with their alternates', () => {
    const xml = renderSitemap(CTX, '2026-10-30');
    for (const t of TOPICS) {
      expect(xml).toContain(`<loc>https://perigee.info/${topicPath(t, 'en')}</loc>`);
      expect(xml).toContain(`<loc>https://perigee.info/${topicPath(t, 'fr')}</loc>`);
    }
    expect(xml).toContain('<loc>https://perigee.info/?lang=fr&amp;view=moon</loc>');
    expect(xml).toContain('<loc>https://perigee.info/fr/</loc>');
    expect(xml).toContain(`<loc>https://perigee.info/${CREDITS_PATHS.en}</loc>`);
  });
});

describe('landing place', () => {
  it('is rounded to about a kilometre and kept until forgotten', () => {
    expect(roundPlace(45.50171, -73.56732)).toEqual({ latDeg: 45.5, lonDeg: -73.57 });
    expect(roundPlace(10, 190)).toEqual({ latDeg: 10, lonDeg: -170 });
    const s = new MemoryStorage() as unknown as Storage;
    expect(loadPlace(s)).toBeUndefined();
    savePlace(s, { latDeg: 48.85661, lonDeg: 2.35222 });
    expect(JSON.parse(s.getItem(OBSERVER_KEY) ?? '')).toEqual({ latDeg: 48.86, lonDeg: 2.35 });
    expect(loadPlace(s)).toEqual({ latDeg: 48.86, lonDeg: 2.35 });
    forgetPlace(s);
    expect(loadPlace(s)).toBeUndefined();
    s.setItem(OBSERVER_KEY, '{"latDeg":95,"lonDeg":0}');
    expect(loadPlace(s)).toBeUndefined();
    s.setItem(OBSERVER_KEY, 'not json');
    expect(loadPlace(s)).toBeUndefined();
  });

  it('reaches the 3D view only through a checked embed parameter', () => {
    expect(parseSetParams({ observer: { latDeg: 45.5, lonDeg: -73.57 } })).toEqual({
      observer: { latDeg: 45.5, lonDeg: -73.57 },
    });
    expect(parseSetParams({ observer: null })).toEqual({ observer: null });
    expect(() => parseSetParams({ observer: { latDeg: 91, lonDeg: 0 } })).toThrow(/observer/);
    expect(() => parseSetParams({ observer: { latDeg: 0, lonDeg: 0, name: 'x' } })).toThrow(/observer/);
    expect(() => parseSetParams({ observer: '45,-73' })).toThrow(/observer/);
  });
});

describe('ground-track map', () => {
  it('puts the Sun overhead near the right place', () => {
    // June solstice at noon UTC: the Sun stands over the Tropic of Cancer, near Greenwich (equation of time −2 min).
    const june = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
    expect(june.latDeg).toBeCloseTo(23.44, 1);
    expect(Math.abs(june.lonDeg)).toBeLessThan(1.5);
    // 18:00 UTC: a quarter turn west.
    expect(subsolarPoint(new Date('2026-06-21T18:00:00Z')).lonDeg).toBeCloseTo(-90, 0);
  });

  it('shades the side away from the Sun and cuts tracks at the antimeridian', () => {
    const d = nightPath({ latDeg: 20, lonDeg: 0 });
    // Northern summer: the night side holds the south pole (y = 180).
    expect(d.endsWith('L360 180L0 180Z')).toBe(true);
    expect(
      trackPath([
        { latDeg: 0, lonDeg: 170 },
        { latDeg: 1, lonDeg: 179 },
        { latDeg: 2, lonDeg: -172 },
      ]),
    ).toBe('M350.00 90.00L359.00 89.00M8.00 88.00');
  });
});
