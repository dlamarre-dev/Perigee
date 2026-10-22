/**
 * Ground track of an Earth satellite (machine interface): the points below it over one or two orbits, WGS 84
 * geodetic, and a GeoJSON MultiLineString split where the track crosses the antimeridian (so maps do not draw a
 * line across the whole world). SGP4 in TEME, Earth-fixed by GMST (polar motion neglected, as in the app).
 */
import type { SatRec } from 'satellite.js';
import { gmstRad } from '../astro/time';
import { propagateTeme } from '../earth/sgp4';
import { degrees, geodeticFromEcef, round } from './ground';
import { temeToEcef } from './passes';

export interface TrackPoint {
  readonly time: string;
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightKm: number;
}

/** `count + 1` points evenly spaced over [startMs, endMs] (positions SGP4 cannot give are skipped). */
export function groundTrackPoints(
  satrec: SatRec,
  startMs: number,
  endMs: number,
  count: number,
): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const date = new Date(startMs + ((endMs - startMs) * i) / count);
    const teme = propagateTeme(satrec, date);
    if (!teme) continue;
    const g = geodeticFromEcef(temeToEcef(teme.posKm, gmstRad(date)));
    out.push({
      time: date.toISOString(),
      latDeg: degrees(g.latRad, 3),
      lonDeg: degrees(g.lonRad, 3),
      heightKm: round(g.heightKm, 1),
    });
  }
  return out;
}

/**
 * GeoJSON MultiLineString ([longitude, latitude] pairs) of the track, cut where consecutive points are more than
 * 180° of longitude apart: each piece is closed at ±180° by interpolating the crossing latitude.
 */
export function trackGeoJson(points: readonly TrackPoint[]): {
  readonly type: 'MultiLineString';
  readonly coordinates: [number, number][][];
} {
  const lines: [number, number][][] = [];
  let line: [number, number][] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && Math.abs(p.lonDeg - prev.lonDeg) > 180) {
      // Eastward across +180 (prev near +180, p near −180) or westward.
      const east = prev.lonDeg > 0;
      const edge = east ? 180 : -180;
      const nextLon = p.lonDeg + (east ? 360 : -360);
      const f = (edge - prev.lonDeg) / (nextLon - prev.lonDeg);
      const lat = round(prev.latDeg + f * (p.latDeg - prev.latDeg), 3);
      line.push([edge, lat]);
      lines.push(line);
      line = [[-edge, lat]];
    }
    line.push([p.lonDeg, p.latDeg]);
  });
  if (line.length > 0) lines.push(line);
  return { type: 'MultiLineString', coordinates: lines.filter((l) => l.length > 1) };
}
