/**
 * Position of a mission around its central body at a given TDB time, with an honest provenance
 * (CLAUDE.md §2.5, §5.2): interpolated inside the Horizons window, Kepler-extrapolated just outside,
 * hidden beyond a limit. Pure, Float64, frame = the ephemeris frame (ICRF/EQJ, body-centred).
 */
import { SECONDS_PER_DAY } from './constants';
import type { EphemerisTable, StateVector } from './hermite';
import { osculatingElements, propagateKepler } from './kepler';
import { trajectoryTimes } from './trajectory';

export type TrackKind = 'interpolated' | 'extrapolated' | 'hidden' | 'none';

export interface TrackSample {
  readonly kind: TrackKind;
  /** Undefined for "hidden" and "none". */
  readonly state: StateVector | undefined;
  /** Seconds beyond the window edge (0 inside). */
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

export class EphemerisTrack {
  constructor(
    readonly table: EphemerisTable | undefined,
    readonly options: TrackOptions,
  ) {}

  sample(tTdbJd: number): TrackSample {
    const table = this.table;
    if (!table) return { kind: 'none', state: undefined, beyondS: 0 };
    const inside = table.interpolate(tTdbJd);
    if (inside) return { kind: 'interpolated', state: inside, beyondS: 0 };

    const after = tTdbJd > table.endTdbJd;
    const edgeIndex = after ? table.rows - 1 : 0;
    const edgeJd = table.time(edgeIndex);
    const dtS = (tTdbJd - edgeJd) * SECONDS_PER_DAY;
    const beyondS = Math.abs(dtS);
    if (beyondS > this.options.maxExtrapolationDays * SECONDS_PER_DAY) {
      return { kind: 'hidden', state: undefined, beyondS };
    }
    return {
      kind: 'extrapolated',
      state: propagateKepler(table.state(edgeIndex), dtS, this.options.muKm3S2),
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
    return this.table ? this.table.state(this.table.rows - 1) : undefined;
  }

  /**
   * Positions (km) over [tCentre − span/2, tCentre + span/2], packed xyz. Hidden samples are skipped; for a
   * hidden track, the last tabulated revolution is returned instead (drawn greyed by the caller).
   */
  trajectory(tCentreJd: number, spanS: number, points: number): Float64Array {
    const table = this.table;
    if (!table) return new Float64Array(0);
    let centre = tCentreJd;
    const hidden = this.sample(tCentreJd).kind === 'hidden';
    if (hidden) {
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
