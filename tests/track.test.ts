import { describe, expect, it } from 'vitest';
import { EPHEM_ROW, EphemerisTable } from '../src/astro/hermite';
import { EphemerisTrack, segmentsOf } from '../src/astro/track';

/** A straight line at 1 km/s along x: rows every `stepMin` minutes over [fromJd, toJd]. */
function table(fromJd: number, toJd: number, stepMin: number): EphemerisTable {
  const rows: number[] = [];
  const n = Math.round(((toJd - fromJd) * 1440) / stepMin);
  for (let i = 0; i <= n; i++) {
    const t = fromJd + (i * stepMin) / 1440;
    rows.push(t, (t - fromJd) * 86_400, 0, 0, 1, 0, 0);
  }
  return new EphemerisTable(Float64Array.from(rows));
}
const options = { muKm3S2: 4902.8, maxExtrapolationDays: 7 };

describe('ephemeris tracks over several tables', () => {
  it('joins the archive and the window across a change of step, without a segment break', () => {
    const past = table(100, 110, 10);
    const main = table(110, 114, 2);
    const segments = segmentsOf([past, main]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.rows).toBe(past.rows + main.rows - 1);
    const track = new EphemerisTrack([past, main], options);
    expect(track.sample(105).kind).toBe('interpolated');
    expect(track.sample(110.003).kind).toBe('interpolated');
    expect(track.table?.startTdbJd).toBe(100);
  });

  it('splits at a gap (a missed run): extrapolated from the nearest edge, hidden beyond the limit', () => {
    const early = table(80, 85, 10);
    const late = table(100, 104, 10);
    const track = new EphemerisTrack([early, late], options);
    expect(track.segments).toHaveLength(2);
    const nearEarly = track.sample(86);
    expect(nearEarly.kind).toBe('extrapolated');
    expect(nearEarly.beyondS).toBeCloseTo(86_400, 3);
    const nearLate = track.sample(99);
    expect(nearLate.kind).toBe('extrapolated');
    expect(nearLate.beyondS).toBeCloseTo(86_400, 3);
    // The middle of the gap is 7.5 days from both edges: hidden.
    expect(track.sample(92.5).kind).toBe('hidden');
    expect(track.table?.startTdbJd).toBe(100);
    expect(track.lastState()?.posKm[0]).toBeCloseTo(4 * 86_400, 3);
  });

  it('keeps a single table as is', () => {
    const t = table(0, 1, 60);
    const track = new EphemerisTrack(t, options);
    expect(track.table).toBe(t);
    expect(track.segments).toHaveLength(1);
    expect(new EphemerisTrack(undefined, options).sample(0).kind).toBe('none');
    expect(EPHEM_ROW).toBe(7);
  });
});
