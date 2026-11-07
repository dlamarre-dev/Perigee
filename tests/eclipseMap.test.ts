import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import {
  groundDistanceKm,
  shadowFootprint,
  solarEclipseMap,
  sunMoonEcef,
  wrapLon,
  type CoverageGrid,
} from '../src/astro/eclipseMap';
import { localLunarEclipse, localSolarEclipse, lunarEclipseContacts } from '../src/engine/events';
import { isoline } from '../src/landing/contours';

/** Grid value at the node nearest a place. */
function valueAt(g: CoverageGrid, centreLonDeg: number, latDeg: number, lonDeg: number): number {
  const c = Math.round((wrapLon(lonDeg - centreLonDeg) - g.lonMinDeg) / g.stepDeg);
  const r = Math.round((latDeg - g.latMinDeg) / g.stepDeg);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return 0;
  return g.values[r * g.cols + c] ?? 0;
}

describe('solar eclipse maps', () => {
  // NASA (Espenak): total eclipse of 2027-08-02, greatest eclipse 25.5° N 33.2° E, magnitude 1.079, path 258 km
  // wide, 6 min 23 s of totality.
  const total = Astronomy.SearchGlobalSolarEclipse(new Date('2027-07-25T00:00:00Z'));
  const map = solarEclipseMap(total.peak.date);

  it('puts the shadow where astronomy-engine puts the greatest eclipse, as wide as NASA says', () => {
    const s = sunMoonEcef(total.peak.date);
    const f = shadowFootprint(s.sun, s.moon);
    expect(f).toBeDefined();
    if (!f || total.latitude === undefined || total.longitude === undefined) return;
    expect(groundDistanceKm(f.centre, { latDeg: total.latitude, lonDeg: total.longitude })).toBeLessThan(5);
    expect(f.umbraKm).toBeGreaterThan(0);
    let width = Infinity;
    // The footprint's smallest extent through its centre: about the path's width.
    for (const a of f.ring) {
      let far = 0;
      for (const b of f.ring) far = Math.max(far, groundDistanceKm(a, b));
      width = Math.min(width, far);
    }
    expect(width).toBeGreaterThan(240);
    expect(width).toBeLessThan(275);
  });

  it('maps the partial zone and the path of totality', () => {
    expect(map.path?.kind).toBe('total');
    expect(map.path?.polygons.length).toBeGreaterThan(100);
    let max = 0;
    for (const v of map.grid.values) max = Math.max(max, v);
    expect(max).toBeCloseTo(1.079, 2);
    // Partial in Paris and Madrid, nothing in Tokyo (night) or Buenos Aires.
    expect(valueAt(map.grid, map.centreLonDeg, 48.86, 2.35)).toBeGreaterThan(0.4);
    expect(valueAt(map.grid, map.centreLonDeg, 40.42, -3.7)).toBeGreaterThan(0.7);
    expect(valueAt(map.grid, map.centreLonDeg, 35.68, 139.69)).toBe(0);
    expect(valueAt(map.grid, map.centreLonDeg, -34.6, -58.38)).toBe(0);
    // Centred and framed on the zone, around the greatest eclipse.
    expect(Math.abs(wrapLon(map.centreLonDeg - 33.2))).toBeLessThan(1);
    expect(map.focus).toBeDefined();
    const gx = wrapLon(33.2 - map.centreLonDeg);
    expect(map.focus && gx > map.focus.west && gx < map.focus.east).toBe(true);
  });

  it('gives contour fields that agree with the coverage at every node', () => {
    const g = map.grid;
    let disagree = 0;
    for (let i = 0; i < g.values.length; i++) {
      const v = g.values[i] ?? 0;
      if (v > 0 !== (g.limitField[i] ?? 0) > 0) disagree++;
      if (v >= 0.5 !== (g.halfField[i] ?? 0) >= 0) disagree++;
    }
    expect(disagree).toBe(0);
    // Negative beyond the limit, not clamped to 0: what lets the outer limit fall between nodes.
    expect(Math.min(...g.limitField)).toBeLessThan(-0.05);
  });

  it('gives the local circumstances, totality included', () => {
    const at = (latDeg: number, lonDeg: number) =>
      localSolarEclipse(total.peak, new Astronomy.Observer(latDeg, lonDeg, 0)) ?? {};
    const luxor = at(25.5, 33.2);
    expect(luxor).toMatchObject({ visible: true, kind: 'total' });
    expect(luxor['centralSeconds']).toBeGreaterThan(370);
    expect(luxor['centralSeconds']).toBeLessThan(395);
    expect(luxor['magnitude']).toBeCloseTo(1.079, 2);
    const paris = at(48.86, 2.35);
    expect(paris).toMatchObject({ visible: true, kind: 'partial' });
    expect(paris['centralBegins']).toBeUndefined();
  });

  it('maps an annular eclipse (2027-02-06: magnitude 0.928, 7 min 51 s of annularity)', () => {
    const e = Astronomy.SearchGlobalSolarEclipse(new Date('2027-01-30T00:00:00Z'));
    expect(e.kind).toBe('annular');
    const m = solarEclipseMap(e.peak.date);
    expect(m.path?.kind).toBe('annular');
    const local =
      localSolarEclipse(e.peak, new Astronomy.Observer(e.latitude ?? 0, e.longitude ?? 0, 0)) ?? {};
    expect(local).toMatchObject({ kind: 'annular' });
    expect(local['magnitude']).toBeCloseTo(0.928, 2);
    expect(local['centralSeconds']).toBeGreaterThan(460);
    expect(local['centralSeconds']).toBeLessThan(480);
  });
});

/** Whether a place lies in one of the path's polygons (even-odd rule, longitudes taken near the place's). */
function onPath(
  polygons: readonly (readonly { latDeg: number; lonDeg: number }[])[],
  lat: number,
  lon: number,
) {
  return polygons.some((poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (!a || !b) continue;
      const ax = lon + wrapLon(a.lonDeg - lon);
      const bx = lon + wrapLon(b.lonDeg - lon);
      if (
        a.latDeg > lat !== b.latDeg > lat &&
        lon < ((bx - ax) * (lat - a.latDeg)) / (b.latDeg - a.latDeg) + ax
      )
        inside = !inside;
    }
    return inside;
  });
}

describe('the ends of a central path', () => {
  it('maps where the cone touches the Earth before its axis does', () => {
    // 2027-02-06, south Pacific at sunrise: annular for over 2 minutes with the Sun about 3° up, while the shadow's
    // axis still passes beside the Earth.
    const e = Astronomy.SearchGlobalSolarEclipse(new Date('2027-01-30T00:00:00Z'));
    const local = localSolarEclipse(e.peak, new Astronomy.Observer(-38.6, -127.46, 0)) ?? {};
    expect(local).toMatchObject({ kind: 'annular' });
    expect(local['centralSeconds']).toBeGreaterThan(100);
    const s = sunMoonEcef(new Date(Date.parse(String(local['centralBegins'])) + 60_000));
    expect(shadowFootprint(s.sun, s.moon)?.axisHits).toBe(false);
    expect(onPath(solarEclipseMap(e.peak.date).path?.polygons ?? [], -38.6, -127.46)).toBe(true);
  });

  it('gives no totality where it happens with the Sun below the horizon', () => {
    // 2026-08-12 at sunset: total near Valencia, Sun up; further east, totality after sunset.
    const e = Astronomy.SearchGlobalSolarEclipse(new Date('2026-08-01T00:00:00Z'));
    const map = solarEclipseMap(e.peak.date);
    const at = (lat: number, lon: number) =>
      localSolarEclipse(e.peak, new Astronomy.Observer(lat, lon, 0)) ?? {};
    expect(at(39.5, 2)).toMatchObject({ kind: 'total' });
    expect(onPath(map.path?.polygons ?? [], 39.5, 2)).toBe(true);
    const sea = at(38, 7);
    expect(sea).toMatchObject({ visible: true, kind: 'partial', centralBelowHorizon: 'total' });
    expect(sea['centralSeconds']).toBeUndefined();
    expect(onPath(map.path?.polygons ?? [], 38, 7)).toBe(false);
  });
});

describe('lunar eclipses from a place', () => {
  // NASA: total lunar eclipse of 2025-09-07, totality 17:30:24–18:52:35 UTC.
  const e = Astronomy.SearchLunarEclipse(new Date('2025-09-01T00:00:00Z'));
  const contacts = lunarEclipseContacts(e);

  it('lists the contacts in order', () => {
    expect(Object.keys(contacts)).toEqual([
      'penumbralBegins',
      'partialBegins',
      'totalBegins',
      'peak',
      'totalEnds',
      'partialEnds',
      'penumbralEnds',
    ]);
    expect(
      Math.abs(Date.parse(contacts['totalBegins'] ?? '') - Date.parse('2025-09-07T17:30:24Z')),
    ).toBeLessThan(90_000);
    expect(
      Math.abs(Date.parse(contacts['totalEnds'] ?? '') - Date.parse('2025-09-07T18:52:35Z')),
    ).toBeLessThan(90_000);
  });

  it('says where the Moon is up during it', () => {
    expect(localLunarEclipse(contacts, new Astronomy.Observer(28.61, 77.21, 0)).visibility).toBe('whole');
    expect(localLunarEclipse(contacts, new Astronomy.Observer(45.5, -73.57, 0)).visibility).toBe('none');
    // Paris: the Moon rises during the eclipse.
    expect(localLunarEclipse(contacts, new Astronomy.Observer(48.86, 2.35, 0)).visibility).toBe('part');
  });
});

describe('contour lines', () => {
  it('closes a zone touching the grid edge and interpolates between nodes', () => {
    // 3 × 3 grid, a single high node in the corner.
    const values = [1, 0, 0, 0, 0, 0, 0, 0, 0];
    const d = isoline(values, 3, 3, 0.5, (c, r) => [c, r]);
    // Around the corner node: four cells, the two outside the grid included, chained into one closed curve.
    expect(d.match(/M/g)?.length).toBe(1);
    expect(d.match(/C/g)?.length).toBe(4);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('0.50 0.00');
    expect(isoline(values, 3, 3, 2, (c, r) => [c, r])).toBe('');
  });
});
