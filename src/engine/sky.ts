/**
 * The sky from a place (machine interface): where the Sun, the Moon, the planets and the bright named stars are at a
 * given time, which can be seen with the naked eye, the Moon's phase, and the next rises, sets, culminations and
 * twilights within a day. astronomy-engine (VSOP87, its lunar theory, IAU constellation boundaries), with
 * atmospheric refraction for altitudes; star positions from the catalogue (J2000, proper motion ignored).
 */
import * as Astronomy from 'astronomy-engine';
import { PLANETS } from '../astro/planets';
import { catalogs } from './objects';
import { compassPoint, round } from './ground';

type Lang = 'en' | 'fr';
type Localized = { readonly en: string; readonly fr: string };

export interface SkyOptions {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM?: number;
  readonly date: Date;
  readonly lang: Lang;
  /** Formats an instant as local time, when a time zone was given. */
  readonly local?: (ms: number) => string;
}

const MOON_PHASES: readonly Localized[] = [
  { en: 'new Moon', fr: 'nouvelle lune' },
  { en: 'waxing crescent', fr: 'premier croissant' },
  { en: 'first quarter', fr: 'premier quartier' },
  { en: 'waxing gibbous', fr: 'gibbeuse croissante' },
  { en: 'full Moon', fr: 'pleine lune' },
  { en: 'waning gibbous', fr: 'gibbeuse décroissante' },
  { en: 'last quarter', fr: 'dernier quartier' },
  { en: 'waning crescent', fr: 'dernier croissant' },
];

/** Name of the Moon's phase from its ecliptic elongation (0° new, 90° first quarter, 180° full, 270° last quarter). */
export function moonPhaseName(phaseDeg: number): Localized {
  const p = ((phaseDeg % 360) + 360) % 360;
  // The quarters and syzygies are given ±6° (about half a day); the shapes in between.
  const index =
    p < 6 || p >= 354
      ? 0
      : p < 84
        ? 1
        : p < 96
          ? 2
          : p < 174
            ? 3
            : p < 186
              ? 4
              : p < 264
                ? 5
                : p < 276
                  ? 6
                  : 7;
  return MOON_PHASES[index] ?? { en: '', fr: '' };
}

const SKY_STATES: Record<string, Localized> = {
  day: { en: 'daytime', fr: 'jour' },
  civil: { en: 'civil twilight', fr: 'crépuscule civil' },
  nautical: { en: 'nautical twilight', fr: 'crépuscule nautique' },
  astronomical: { en: 'astronomical twilight', fr: 'crépuscule astronomique' },
  night: { en: 'night (dark sky)', fr: 'nuit noire' },
};

/** Day, twilights or night from the Sun's altitude (degrees, centre, refraction included). */
export function skyState(sunAltitudeDeg: number): keyof typeof SKY_STATES {
  if (sunAltitudeDeg > -0.833) return 'day';
  if (sunAltitudeDeg > -6) return 'civil';
  if (sunAltitudeDeg > -12) return 'nautical';
  if (sunAltitudeDeg > -18) return 'astronomical';
  return 'night';
}

/**
 * Faintest magnitude seen with the naked eye, by state of the sky (rough limits for a clear sky away from city
 * lights): only the brightest planets and stars in civil twilight, more as the sky darkens. One rule for stars and
 * planets. Undefined: daytime, nothing counted.
 */
export const NAKED_EYE_LIMIT: Readonly<Record<string, number | undefined>> = {
  day: undefined,
  civil: 0,
  nautical: 3,
  astronomical: 5,
  night: 6,
};

export function skyFrom(o: SkyOptions): Record<string, unknown> {
  const observer = new Astronomy.Observer(o.latDeg, o.lonDeg, o.heightM ?? 0);
  const time = Astronomy.MakeTime(o.date);
  const when = (t: Astronomy.AstroTime | null | undefined): Record<string, string> | undefined =>
    t ? { time: t.date.toISOString(), ...(o.local ? { local: o.local(t.date.getTime()) } : {}) } : undefined;
  const horizontal = (body: Astronomy.Body) => {
    const eq = Astronomy.Equator(body, time, observer, true, true);
    const hor = Astronomy.Horizon(time, observer, eq.ra, eq.dec, 'normal');
    return { eq, hor };
  };
  const place = (hor: Astronomy.HorizontalCoordinates) => ({
    altitudeDeg: round(hor.altitude, 1),
    azimuthDeg: round(hor.azimuth, 1),
    direction: compassPoint((hor.azimuth * Math.PI) / 180),
    aboveHorizon: hor.altitude > 0,
  });
  /**
   * Next rise and set within a day (an always-up or never-up body has none), and for the Sun and the Moon the next
   * culmination (searches cost CPU: the planets go without).
   */
  const events = (body: Astronomy.Body, culmination = false) => {
    const rise = Astronomy.SearchRiseSet(body, observer, +1, time, 1);
    const set = Astronomy.SearchRiseSet(body, observer, -1, time, 1);
    const transit = culmination ? Astronomy.SearchHourAngle(body, observer, 0, time, +1) : undefined;
    return {
      ...(rise ? { rise: when(rise) } : {}),
      ...(transit && transit.time.ut - time.ut <= 1
        ? { culmination: { ...when(transit.time), altitudeDeg: round(transit.hor.altitude, 1) } }
        : {}),
      ...(set ? { set: when(set) } : {}),
    };
  };

  // The Sun: day or night, and the next twilight boundaries.
  const sun = horizontal(Astronomy.Body.Sun);
  const state = skyState(sun.hor.altitude);
  const limit = NAKED_EYE_LIMIT[state];
  const nakedEye = (altitudeDeg: number, magnitude: number): boolean =>
    limit !== undefined && altitudeDeg > 0 && magnitude <= limit;
  const twilight = (direction: number, altitude: number) =>
    when(Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, direction, time, 1, altitude));

  // The Moon.
  const moon = horizontal(Astronomy.Body.Moon);
  const moonIllum = Astronomy.Illumination(Astronomy.Body.Moon, time);
  const phaseDeg = Astronomy.MoonPhase(time);
  const quarter = Astronomy.SearchMoonQuarter(time);
  // Constellation boundaries are defined on J2000 coordinates.
  const constellation = (body: Astronomy.Body): string => {
    const j2000 = Astronomy.Equator(body, time, observer, false, true);
    return Astronomy.Constellation(j2000.ra, j2000.dec).name;
  };

  const planets = PLANETS.filter((p) => !p.dwarf && p.id !== 'earth').map((p) => {
    const { hor } = horizontal(p.body);
    const illum = Astronomy.Illumination(p.body, time);
    const visible = nakedEye(hor.altitude, illum.mag);
    return {
      id: p.id,
      name: p.name[o.lang],
      ...place(hor),
      magnitude: round(illum.mag, 1),
      nakedEyeNow: visible,
      angleFromSunDeg: round(Astronomy.AngleFromSun(p.body, time), 1),
      constellation: constellation(p.body),
      ...events(p.body),
    };
  });

  // Named stars of the catalogue above the horizon, brightest first.
  const toHor = Astronomy.Rotation_EQJ_HOR(time, observer);
  const stars = catalogs.stars
    .map((s) => {
      const ra = (s.raDeg * Math.PI) / 180;
      const dec = (s.decDeg * Math.PI) / 180;
      const v = new Astronomy.Vector(
        Math.cos(dec) * Math.cos(ra),
        Math.cos(dec) * Math.sin(ra),
        Math.sin(dec),
        time,
      );
      const hor = Astronomy.HorizonFromVector(Astronomy.RotateVector(toHor, v), 'normal');
      const azimuthDeg = hor.lon;
      return { s, altitudeDeg: hor.lat, azimuthDeg };
    })
    .filter((x) => x.altitudeDeg > 0)
    .sort((a, b) => a.s.magnitude - b.s.magnitude)
    .map((x) => ({
      id: `star:${x.s.id}`,
      name: x.s.name[o.lang],
      constellation: x.s.constellation[o.lang],
      magnitude: x.s.magnitude,
      altitudeDeg: round(x.altitudeDeg, 1),
      azimuthDeg: round(x.azimuthDeg, 1),
      direction: compassPoint((x.azimuthDeg * Math.PI) / 180),
      nakedEyeNow: nakedEye(x.altitudeDeg, x.s.magnitude),
    }));

  return {
    observer: { latDeg: o.latDeg, lonDeg: o.lonDeg, heightM: o.heightM ?? 0 },
    ...when(time),
    sky: SKY_STATES[state]?.[o.lang],
    sun: {
      ...place(sun.hor),
      ...events(Astronomy.Body.Sun, true),
      ...(sun.hor.altitude > -6
        ? { nextDusk: twilight(-1, -6), nextAstronomicalNight: twilight(-1, -18) }
        : {}),
      ...(sun.hor.altitude <= -6 ? { nextDawn: twilight(+1, -6) } : {}),
    },
    moon: {
      ...place(moon.hor),
      phase: moonPhaseName(phaseDeg)[o.lang],
      phaseAngleDeg: round(phaseDeg, 1),
      illuminatedPercent: round(moonIllum.phase_fraction * 100, 0),
      magnitude: round(moonIllum.mag, 1),
      distanceKm: Math.round(moon.eq.dist * 149_597_870.7),
      constellation: constellation(Astronomy.Body.Moon),
      nextQuarter: { ...when(quarter.time), phase: MOON_PHASES[quarter.quarter * 2]?.[o.lang] },
      ...events(Astronomy.Body.Moon, true),
    },
    planets,
    brightStars: stars,
    notes: {
      en: 'Altitudes include standard atmospheric refraction; rise and set are those of the upper limb of the Sun and the Moon and of a planet’s centre, within the next 24 hours. “nakedEyeNow”: above the horizon, Sun set, and bright enough for the sky at that time (magnitude 0 or brighter in civil twilight, 3 in nautical twilight, 5 in astronomical twilight, 6 at night); city lights, haze and the horizon’s relief are not known. Magnitudes: smaller is brighter.',
      fr: 'Les hauteurs tiennent compte de la réfraction atmosphérique moyenne ; le lever et le coucher sont ceux du bord supérieur du Soleil et de la Lune, et du centre des planètes, dans les 24 heures qui suivent. « nakedEyeNow » : au-dessus de l’horizon, Soleil couché, et assez brillant pour le ciel du moment (magnitude 0 ou moins au crépuscule civil, 3 au crépuscule nautique, 5 au crépuscule astronomique, 6 de nuit) ; l’éclairage urbain, la brume et le relief de l’horizon ne sont pas connus. Magnitudes : plus petit est plus brillant.',
    }[o.lang],
  };
}
