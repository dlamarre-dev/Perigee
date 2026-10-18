/**
 * Where a computed value comes from and how far to trust it (machine interface, CLAUDE.md §2.5): every engine
 * answer carries one of these. Accuracy figures are typical orders of magnitude with their basis, written for an
 * AI that has to tell a student how reliable a number is; they are not error bars.
 */

/** How a position was obtained. */
export type ModelId =
  | 'sgp4-gp'
  | 'sgp4-supgp'
  | 'horizons-interpolated'
  | 'kepler-extrapolated'
  | 'vsop87'
  | 'astronomy-engine-moon'
  | 'moon-horizons'
  | 'moon-mean-elements'
  | 'site-coordinates'
  | 'star-catalogue'
  | 'origin';

/**
 * State of the data behind a value: fresh elements or interpolated ephemerides; stale elements (older than
 * 14 days); extrapolated beyond the ephemeris window; hidden (too far beyond it: no position); modelled from mean
 * elements; none (no public ephemeris).
 */
export type DataState = 'fresh' | 'interpolated' | 'stale' | 'extrapolated' | 'hidden' | 'modelled' | 'none';

export interface Source {
  readonly name: string;
  readonly url: string;
}

export interface Provenance {
  readonly model: ModelId;
  /** Plain-language description of the model. */
  readonly method: string;
  readonly state: DataState;
  readonly sources: readonly Source[];
  /** When Perigee's pipeline downloaded the data (ISO UTC), if the value rests on published data. */
  readonly dataFetchedAt?: string;
  /** Epoch of the orbital elements (ISO UTC) and their age at the requested date (days, negative = ahead). */
  readonly elementEpoch?: string;
  readonly elementAgeDays?: number;
  /** Ephemeris coverage (ISO UTC) and how far outside it the date falls (hours). */
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly hoursBeyondWindow?: number;
  /** Typical position error, with what it rests on. */
  readonly accuracy: { readonly typicalKm?: number; readonly note: string };
}

export const CELESTRAK: Source = {
  name: 'CelesTrak (T.S. Kelso), US Space Force tracking',
  url: 'https://celestrak.org',
};
export const CELESTRAK_SUPGP: Source = {
  name: 'CelesTrak supplemental GP (fits to operator ephemerides)',
  url: 'https://celestrak.org/NORAD/elements/supplemental/',
};
export const HORIZONS: Source = { name: 'NASA/JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/' };
export const ASTRONOMY_ENGINE: Source = {
  name: 'astronomy-engine (Don Cross, MIT)',
  url: 'https://github.com/cosinekitty/astronomy',
};
export const JPL_SSD: Source = {
  name: 'NASA/JPL SSD planetary satellite mean elements',
  url: 'https://ssd.jpl.nasa.gov/sats/elem/',
};
export const SIMBAD: Source = {
  name: 'SIMBAD (CDS, Strasbourg)',
  url: 'https://simbad.cds.unistra.fr/simbad/',
};

/** Typical accuracy of each model (orders of magnitude, with their basis). */
export const ACCURACY: Readonly<Record<ModelId, { readonly typicalKm?: number; readonly note: string }>> = {
  'sgp4-gp': {
    typicalKm: 1,
    note: 'SGP4 from US Space Force general perturbations elements: about 1 km near the element epoch, growing by roughly 1 to 3 km per day for low orbits (more during strong solar activity).',
  },
  'sgp4-supgp': {
    typicalKm: 0.1,
    note: 'SGP4 fitted by CelesTrak to the operator’s own ephemerides: about ten times more accurate than GP near the epoch.',
  },
  'horizons-interpolated': {
    typicalKm: 0.01,
    note: 'Cubic Hermite interpolation between JPL Horizons state vectors: reproduces the ephemeris to well under 1 km; the ephemeris’ own uncertainty depends on the mission’s orbit determination.',
  },
  'kepler-extrapolated': {
    note: 'Two-body Kepler motion from the last Horizons state, beyond the published window: the error grows with time, from kilometres after hours to thousands of kilometres after days for low or perturbed orbits.',
  },
  vsop87: {
    note: 'astronomy-engine (VSOP87 series): documented to agree with JPL within about 1 arcminute in sky position; heliocentric distances are good to a small fraction of a percent.',
  },
  'astronomy-engine-moon': {
    typicalKm: 50,
    note: 'astronomy-engine analytical theory (the Moon, the Galilean moons): typically 10 to 90 km from JPL Horizons.',
  },
  'moon-horizons': {
    typicalKm: 1,
    note: 'Interpolation of JPL Horizons vectors of the moon relative to its planet (refreshed daily).',
  },
  'moon-mean-elements': {
    note: 'JPL mean orbital elements with uniform precession, re-anchored on Horizons about once a year: within a few degrees along the orbit (at most about 7° after a year).',
  },
  'site-coordinates': {
    typicalKm: 0.1,
    note: 'Catalogued surface coordinates (cited source) turned with the body’s IAU rotation model.',
  },
  'star-catalogue': {
    note: 'ICRS J2000 position from SIMBAD; the distance comes from the cited literature (parallax); proper motion is ignored.',
  },
  origin: { typicalKm: 0, note: 'The reference point itself.' },
};

/** Shown with every answer: Perigee is for education. */
export const DISCLAIMER =
  'Educational use only: not intended for navigation, collision avoidance or conjunction assessment.';
