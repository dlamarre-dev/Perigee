/**
 * Position of a mission around its central body at a given TDB time, with an honest provenance
 * (CLAUDE.md §2.5, §5.2): interpolated inside the Horizons data, Kepler-extrapolated just outside, hidden beyond
 * a limit. The data can be several tables (the 30-day archive, then the current window): their rows are joined
 * and split into contiguous segments wherever a gap is much longer than the steps around it (a missed daily run),
 * and the rules apply around each segment. Pure, Float64, frame = the ephemeris frame (ICRF/EQJ, body-centred).
 */
import { SECONDS_PER_DAY } from './constants';
import { EPHEM_ROW, EphemerisTable, type StateVector } from './hermite';
import { osculatingElements, propagateKepler } from './kepler';
import { trajectoryTimes } from './trajectory';

export type TrackKind = 'interpolated' | 'extrapolated' | 'hidden' | 'none';

export interface TrackSample {
  readonly kind: TrackKind;
  /** Undefined for "hidden" and "none". */
  readonly state: StateVector | undefined;
  /** Seconds beyond the nearest data edge (0 inside). */
  readonly beyondS: number;
}

export interface TrackOptions {
  readonly muKm3S2: number;
  /** Extrapolation beyond this many days hides the position (7 d for low orbiters, CLAUDE.md §5.2). */
  readonly maxExtrapolationDays: number;
}

export const LOW_ORBIT_MAX_EXTRAPOLATION_DAYS = 7;
/** Two-body extrapolation of high or three-body orbits degrades quickly too; cap it as well. */
export const HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS = 14;

/** A gap longer than this many times the steps on either side splits the data (no Hermite across it). */
const GAP_FACTOR = 1.5;

/**
 * Joins tables given oldest first (rows not after the previous table's last one are dropped) and splits the result
 * into contiguous segments.
 */
export function segmentsOf(tables: readonly EphemerisTable[]): EphemerisTable[] {
  const rows: number[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const table of tables) {
    for (let i = 0; i < table.rows; i++) {
      const t = table.time(i);
      if (t <= last) continue;
      for (let k = 0; k < EPHEM_ROW; k++) rows.push(table.data[i * EPHEM_ROW + k] ?? 0);
      last = t;
    }
  }
  const n = rows.length / EPHEM_ROW;
  if (n === 0) return [];
  const time = (i: number): number => rows[i * EPHEM_ROW] ?? 0;
  const step = (i: number): number => (i >= 1 && i < n ? time(i) - time(i - 1) : Number.NaN);
  const segments: EphemerisTable[] = [];
  let start = 0;
  for (let i = 1; i < n; i++) {
    const dt = step(i);
    // The steps either side (a change of step between the archive and the window is not a gap).
    const around = Math.max(step(i - 1) || 0, step(i + 1) || 0);
    if (around > 0 && dt > GAP_FACTOR * around) {
      segments.push(new EphemerisTable(Float64Array.from(rows.slice(start * EPHEM_ROW, i * EPHEM_ROW))));
      start = i;
    }
  }
  segments.push(new EphemerisTable(Float64Array.from(rows.slice(start * EPHEM_ROW))));
  return segments;
}

export class EphemerisTrack {
  /** Contiguous stretches of data, in time order. */
  readonly segments: readonly EphemerisTable[];

  constructor(
    tables: EphemerisTable | undefined | readonly EphemerisTable[],
    readonly options: TrackOptions,
  ) {
    const list = tables === undefined ? [] : tables instanceof EphemerisTable ? [tables] : tables;
    this.segments = list.length === 1 && list[0] ? [list[0]] : segmentsOf(list);
  }

  /** The latest segment: the current Horizons window (the solar view's trajectory drawing uses it alone). */
  get table(): EphemerisTable | undefined {
    return this.segments[this.segments.length - 1];
  }

  /** The segment containing t, or the one with the nearest edge and that edge's row index. */
  private locate(tTdbJd: number): { table: EphemerisTable; inside: boolean; edge: number } | undefined {
    let best: { table: EphemerisTable; inside: boolean; edge: number } | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const table of this.segments) {
      if (table.contains(tTdbJd)) return { table, inside: true, edge: 0 };
      const after = tTdbJd > table.endTdbJd;
      const gap = after ? tTdbJd - table.endTdbJd : table.startTdbJd - tTdbJd;
      if (gap < bestGap) {
        bestGap = gap;
        best = { table, inside: false, edge: after ? table.rows - 1 : 0 };
      }
    }
    return best;
  }

  sample(tTdbJd: number): TrackSample {
    const found = this.locate(tTdbJd);
    if (!found) return { kind: 'none', state: undefined, beyondS: 0 };
    const { table, inside, edge } = found;
    if (inside) {
      const state = table.interpolate(tTdbJd);
      if (state) return { kind: 'interpolated', state, beyondS: 0 };
    }
    const dtS = (tTdbJd - table.time(edge)) * SECONDS_PER_DAY;
    const beyondS = Math.abs(dtS);
    if (beyondS > this.options.maxExtrapolationDays * SECONDS_PER_DAY) {
      return { kind: 'hidden', state: undefined, beyondS };
    }
    return {
      kind: 'extrapolated',
      state: propagateKepler(table.state(edge), dtS, this.options.muKm3S2),
      beyondS,
    };
  }

  /** Osculating period (s) at the given time, if the orbit is bound. */
  periodS(tTdbJd: number): number | undefined {
    const s = this.sample(tTdbJd).state ?? this.lastState();
    return s ? osculatingElements(s, this.options.muKm3S2).periodS : undefined;
  }

  /** Last tabulated state (used to draw the last known trajectory of a hidden track). */
  lastState(): StateVector | undefined {
    const table = this.table;
    return table ? table.state(table.rows - 1) : undefined;
  }

  /**
   * Positions (km) over [tCentre − span/2, tCentre + span/2], packed xyz. Hidden samples are skipped; for a
   * hidden track, the nearest segment's revolution at its edge is returned instead (drawn greyed by the caller).
   */
  trajectory(tCentreJd: number, spanS: number, points: number): Float64Array {
    const found = this.locate(tCentreJd);
    if (!found) return new Float64Array(0);
    let centre = tCentreJd;
    const hidden = this.sample(tCentreJd).kind === 'hidden';
    if (hidden) {
      const { table } = found;
      centre = tCentreJd > table.endTdbJd ? table.endTdbJd - spanS / 2 / SECONDS_PER_DAY : table.startTdbJd;
    }
    const half = spanS / 2 / SECONDS_PER_DAY;
    // Around the current position: dense samples, the current time being one of them (see trajectoryTimes).
    const times = hidden
      ? Array.from({ length: points + 1 }, (_, i) => centre - half + (2 * half * i) / points)
      : trajectoryTimes(centre - half, centre + half, centre, points);
    const out: number[] = [];
    for (const t of times) {
      const s = this.sample(t).state;
      if (s) out.push(s.posKm[0], s.posKm[1], s.posKm[2]);
    }
    return Float64Array.from(out);
  }
}
