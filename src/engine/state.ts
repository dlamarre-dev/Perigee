/**
 * Heliocentric state of any engine object (EQJ = ICRF/J2000 equator, km, km/s, centred on the Sun's centre as the
 * solar view and JPL Horizons `500@10`), with its provenance. Built only from the app's own models
 * (src/astro, src/earth/sgp4): SGP4 for Earth satellites, Hermite interpolation of Horizons vectors with two-body
 * extrapolation for spacecraft, astronomy-engine for the planets, the Moon and the Galilean moons, JPL mean
 * elements for the other moons, IAU rotation models for surface sites.
 */
import { Astronomy } from '../astro/astronomy';
import { bodyOrientationEqj, MARS_RADIUS_KM, MOON_RADIUS_KM } from '../astro/bodies';
import { AU_KM, DEG_TO_RAD, J2000_JD, SECONDS_PER_DAY } from '../astro/constants';
import { latLonToUnit } from '../astro/frames';
import type { StateVector } from '../astro/hermite';
import { GM_KM3_S2 } from '../astro/kepler';
import { moonState } from '../astro/moons';
import { heliocentricState, PLANETS } from '../astro/planets';
import { quatRotate } from '../astro/quat';
import { utcToTdbJd } from '../astro/time';
import {
  EphemerisTrack,
  HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS,
  LOW_ORBIT_MAX_EXTRAPOLATION_DAYS,
} from '../astro/track';
import { add, scale, type Vec3 } from '../astro/vec3';
import { makeSatrec, propagateTeme } from '../earth/sgp4';
import type { EphemerisEntry, Mission, Omm } from '../data/schemas';
import type { PublishedData } from './data';
import type { ObjectRef } from './objects';
import {
  ACCURACY,
  ASTRONOMY_ENGINE,
  CELESTRAK,
  CELESTRAK_SUPGP,
  HORIZONS,
  JPL_SSD,
  SIMBAD,
  type DataState,
  type ModelId,
  type Provenance,
  type Source,
} from './provenance';

/** Elements older than this are flagged stale (as in the Earth view). */
const STALE_AFTER_DAYS = 14;
const LIGHT_YEAR_KM = 9_460_730_472_580.8;
const MS_PER_DAY = 86_400_000;

export interface HelioState {
  /** Undefined when the object has no position at that date (hidden, no public ephemeris). */
  readonly state: StateVector | undefined;
  readonly provenance: Provenance;
  /** Earth satellites: the SGP4 state in TEME (for Earth-fixed ground points) and the elements used. */
  readonly teme?: StateVector;
  readonly omm?: Omm;
}

function provenance(
  model: ModelId,
  method: string,
  state: DataState,
  sources: readonly Source[],
  extra: Partial<Omit<Provenance, 'model' | 'method' | 'state' | 'sources' | 'accuracy'>> = {},
): Provenance {
  return { model, method, state, sources, ...extra, accuracy: ACCURACY[model] };
}

function tdbJdToIso(tdbJd: number): string {
  // TDB − UTC ≈ 69.2 s in 2026: negligible at this precision.
  return new Date((tdbJd - J2000_JD) * MS_PER_DAY + Date.UTC(2000, 0, 1, 12) - 69_184).toISOString();
}

function fromAstronomy(s: {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}): StateVector {
  const kmS = AU_KM / SECONDS_PER_DAY;
  return { posKm: [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM], velKmS: [s.vx * kmS, s.vy * kmS, s.vz * kmS] };
}

function sum(a: StateVector, b: StateVector): StateVector {
  return { posKm: add(a.posKm, b.posKm), velKmS: add(a.velKmS, b.velKmS) };
}

const ORIGIN: StateVector = { posKm: [0, 0, 0], velKmS: [0, 0, 0] };

function planetHelio(id: string, date: Date): StateVector {
  const planet = PLANETS.find((p) => p.id === id);
  if (!planet) throw new Error(`No planet ${id}`);
  return heliocentricState(planet.body, date);
}

/** The Earth's Moon, heliocentric. */
function moonHelio(date: Date): StateVector {
  return sum(planetHelio('earth', date), fromAstronomy(Astronomy.GeoMoonState(date)));
}

/** TEME (SGP4) → EQJ: the true-of-date frame rotated back to J2000 (precession, nutation; the equation of the
 * equinoxes between TEME and the true equinox is below an arcsecond). */
function temeToEqj(v: Vec3, date: Date): Vec3 {
  const rot = Astronomy.Rotation_EQD_EQJ(Astronomy.MakeTime(date));
  const r = Astronomy.RotateVector(rot, new Astronomy.Vector(v[0], v[1], v[2], Astronomy.MakeTime(date)));
  return [r.x, r.y, r.z];
}

/** Position of every object, heliocentric EQJ, with where it comes from. */
/** SGP4 initialisation is the costly part: done once per element set (a series propagates the same one). */
const satrecs = new WeakMap<Omm, ReturnType<typeof makeSatrec>>();
export function satrecOf(omm: Omm): ReturnType<typeof makeSatrec> {
  if (!satrecs.has(omm)) satrecs.set(omm, makeSatrec(omm));
  return satrecs.get(omm);
}

/**
 * An Earth satellite's published elements, their SGP4 initialisation and the provenance of positions computed from
 * them at `date` (for answers that propagate them themselves, such as pass searches).
 */
export async function satelliteElementsAt(
  norad: number,
  date: Date,
  data: PublishedData,
): Promise<{ omm?: Omm; satrec?: NonNullable<ReturnType<typeof makeSatrec>>; provenance: Provenance }> {
  const { entry, omm: elements, snapshot } = await data.satelliteElements(norad, date);
  if (!elements)
    return {
      provenance: provenance(
        'sgp4-gp',
        'Not among the active satellites published by CelesTrak.',
        'none',
        [CELESTRAK],
        {
          dataFetchedAt: entry.fetchedAt,
        },
      ),
    };
  const supgp = elements.SOURCE !== undefined;
  const epochMs = Date.parse(`${elements.EPOCH}Z`);
  const ageDays = (date.getTime() - epochMs) / MS_PER_DAY;
  const satrec = satrecOf(elements);
  return {
    omm: elements,
    ...(satrec ? { satrec } : {}),
    provenance: provenance(
      supgp ? 'sgp4-supgp' : 'sgp4-gp',
      supgp
        ? `SGP4 from CelesTrak's fit to the operator's ephemerides (${elements.SOURCE}).`
        : 'SGP4 from CelesTrak general perturbations elements (US Space Force tracking).',
      satrec ? (Math.abs(ageDays) > STALE_AFTER_DAYS ? 'stale' : 'fresh') : 'none',
      supgp ? [CELESTRAK_SUPGP, CELESTRAK] : [CELESTRAK],
      {
        dataFetchedAt: entry.fetchedAt,
        elementEpoch: new Date(epochMs).toISOString(),
        elementAgeDays: ageDays,
        elementSet: snapshot ? `archive ${snapshot}` : 'current',
      },
    ),
  };
}

/**
 * A mission's track around its central body (Horizons window; before it, the 30-day archive joins it: rows
 * Horizons published on earlier days).
 */
export async function missionTrack(
  m: Mission,
  entry: EphemerisEntry,
  tdbJd: number,
  data: PublishedData,
): Promise<EphemerisTrack> {
  const main = await data.table(entry);
  const tables = entry.past && tdbJd < entry.startTdbJd ? [await data.table(entry.past), main] : main;
  return new EphemerisTrack(tables, {
    muKm3S2: GM_KM3_S2[m.centralBody],
    maxExtrapolationDays: m.lowOrbit ? LOW_ORBIT_MAX_EXTRAPOLATION_DAYS : HIGH_ORBIT_MAX_EXTRAPOLATION_DAYS,
  });
}

export async function helioState(ref: ObjectRef, date: Date, data: PublishedData): Promise<HelioState> {
  const tdbJd = utcToTdbJd(date);
  switch (ref.kind) {
    case 'sun':
      return {
        state: ORIGIN,
        provenance: provenance('origin', 'The Sun’s centre (heliocentric frame).', 'fresh', []),
      };

    case 'planet':
      return {
        state: heliocentricState(ref.planet.body, date),
        provenance: provenance(
          'vsop87',
          ref.planet.id === 'pluto'
            ? 'astronomy-engine: numerical integration under the giant planets’ attraction.'
            : 'astronomy-engine: VSOP87 planetary theory.',
          'fresh',
          [ASTRONOMY_ENGINE],
        ),
      };

    case 'moon': {
      const moon = ref.moon;
      if (moon.id === 'moon')
        return {
          state: moonHelio(date),
          provenance: provenance('astronomy-engine-moon', 'astronomy-engine lunar theory.', 'fresh', [
            ASTRONOMY_ENGINE,
          ]),
        };
      const planet = planetHelio(moon.planet, date);
      const entry = (await data.manifest()).moons[moon.id];
      if (entry) {
        const rel = (await data.table(entry)).interpolate(tdbJd);
        if (rel)
          return {
            state: sum(planet, rel),
            provenance: provenance(
              'moon-horizons',
              `JPL Horizons vectors relative to ${moon.planet}, interpolated (step ${entry.stepMin} min).`,
              'interpolated',
              [HORIZONS],
              {
                dataFetchedAt: entry.fetchedAt,
                validFrom: tdbJdToIso(entry.startTdbJd),
                validTo: tdbJdToIso(entry.endTdbJd),
              },
            ),
          };
      }
      const rel = moonState(moon, date, tdbJd);
      if (!rel)
        return {
          state: undefined,
          provenance: provenance('moon-mean-elements', 'No model for this moon.', 'none', []),
        };
      const meanElements = moon.model === 'mean-elements';
      return {
        state: sum(planet, rel),
        provenance: meanElements
          ? provenance(
              'moon-mean-elements',
              'JPL mean orbital elements (two-body motion with uniform precession).',
              'modelled',
              [JPL_SSD],
            )
          : provenance('astronomy-engine-moon', 'astronomy-engine analytical theory.', 'fresh', [
              ASTRONOMY_ENGINE,
            ]),
      };
    }

    case 'mission': {
      const m = ref.mission;
      const entry = (await data.manifest()).ephemerides[m.id];
      if (!entry)
        return {
          state: undefined,
          provenance: provenance(
            'horizons-interpolated',
            m.ephemeris === 'horizons'
              ? 'JPL Horizons ephemeris not published right now.'
              : 'No public ephemeris: the mission is listed but has no position.',
            'none',
            m.sources.map((url) => ({ name: new URL(url).hostname, url })),
          ),
        };
      const archived = entry.past !== undefined && tdbJd < entry.startTdbJd;
      const track = await missionTrack(m, entry, tdbJd, data);
      const sample = track.sample(tdbJd);
      const centre =
        m.centralBody === 'sun'
          ? ORIGIN
          : m.centralBody === 'moon'
            ? moonHelio(date)
            : planetHelio('mars', date);
      const window = {
        dataFetchedAt: entry.fetchedAt,
        validFrom: tdbJdToIso(archived && entry.past ? entry.past.startTdbJd : entry.startTdbJd),
        validTo: tdbJdToIso(entry.endTdbJd),
        ...(sample.beyondS > 0 ? { hoursBeyondWindow: sample.beyondS / 3600 } : {}),
      };
      if (sample.kind === 'interpolated' && sample.state)
        return {
          state: sum(centre, sample.state),
          provenance: provenance(
            'horizons-interpolated',
            archived
              ? `Archived JPL Horizons state vectors (Horizons id ${entry.horizonsId}, centre ${entry.center}; fetched daily and kept 30 days), cubic Hermite interpolation between samples up to ${Math.round(entry.past?.stepMin ?? entry.stepMin)} min apart.`
              : `JPL Horizons state vectors (Horizons id ${entry.horizonsId}, centre ${entry.center}), cubic Hermite interpolation between samples ${entry.stepMin} min apart.`,
            'interpolated',
            [HORIZONS],
            window,
          ),
        };
      if (sample.kind === 'extrapolated' && sample.state)
        return {
          state: sum(centre, sample.state),
          provenance: provenance(
            'kepler-extrapolated',
            `Two-body extrapolation from the nearest JPL Horizons state, ${(sample.beyondS / 3600).toFixed(1)} h beyond the published data.`,
            'extrapolated',
            [HORIZONS],
            window,
          ),
        };
      return {
        state: undefined,
        provenance: provenance(
          'kepler-extrapolated',
          `Too far beyond the published ephemeris (${(sample.beyondS / SECONDS_PER_DAY).toFixed(0)} days): no position.`,
          'hidden',
          [HORIZONS],
          window,
        ),
      };
    }

    case 'satellite': {
      const s = await satelliteElementsAt(ref.norad, date, data);
      const teme = s.satrec ? propagateTeme(s.satrec, date) : undefined;
      if (!s.omm || !teme)
        return {
          state: undefined,
          provenance: s.omm
            ? {
                ...s.provenance,
                state: 'none',
                method: 'SGP4 failed for these elements (decayed or invalid).',
              }
            : s.provenance,
        };
      return {
        teme,
        omm: s.omm,
        state: sum(planetHelio('earth', date), {
          posKm: temeToEqj(teme.posKm, date),
          velKmS: temeToEqj(teme.velKmS, date),
        }),
        provenance: s.provenance,
      };
    }

    case 'site': {
      const body = ref.body === 'moon' ? Astronomy.Body.Moon : Astronomy.Body.Mars;
      const radiusKm = ref.body === 'moon' ? MOON_RADIUS_KM : MARS_RADIUS_KM;
      const centre = ref.body === 'moon' ? moonHelio(date) : planetHelio('mars', date);
      const local = scale(latLonToUnit(ref.site.latDeg * DEG_TO_RAD, ref.site.lonDeg * DEG_TO_RAD), radiusKm);
      return {
        state: {
          posKm: add(centre.posKm, quatRotate(bodyOrientationEqj(body, date), local)),
          velKmS: centre.velKmS,
        },
        provenance: provenance(
          'site-coordinates',
          `Catalogued planetocentric coordinates (${ref.site.latDeg.toFixed(3)}°, ${ref.site.lonDeg.toFixed(3)}°) on the IAU rotation model.`,
          'fresh',
          ref.site.sources.map((url) => ({ name: new URL(url).hostname, url })),
        ),
      };
    }

    case 'launch': {
      const time = Astronomy.MakeTime(date);
      const observer = new Astronomy.Observer(ref.site.latDeg, ref.site.lonDeg, 0);
      const geo = Astronomy.ObserverVector(time, observer, false);
      const earth = planetHelio('earth', date);
      return {
        state: {
          posKm: add(earth.posKm, [geo.x * AU_KM, geo.y * AU_KM, geo.z * AU_KM]),
          velKmS: earth.velKmS,
        },
        provenance: provenance(
          'site-coordinates',
          `Launch site coordinates (${ref.site.latDeg.toFixed(3)}°, ${ref.site.lonDeg.toFixed(3)}°) on the Earth's rotation.`,
          'fresh',
          ref.site.sources.map((url) => ({ name: new URL(url).hostname, url })),
        ),
      };
    }

    case 'star': {
      const s = ref.star;
      const dir = latLonToUnit(s.decDeg * DEG_TO_RAD, s.raDeg * DEG_TO_RAD);
      return {
        state: { posKm: scale(dir, s.distanceLy * LIGHT_YEAR_KM), velKmS: [0, 0, 0] },
        provenance: provenance(
          'star-catalogue',
          'ICRS J2000 position (SIMBAD) and literature distance.',
          'fresh',
          [SIMBAD],
        ),
      };
    }
  }
}
