/**
 * Astronomical events over a period (machine interface): Moon phases, lunar perigees and apogees (with super and
 * micro full Moons), lunar and solar eclipses (worldwide, and as seen from a place when one is given), equinoxes and
 * solstices, the Earth's perihelion and aphelion, planet oppositions, conjunctions and greatest elongations, and the
 * next key events of the missions in the catalogue. astronomy-engine searches (no published data needed).
 */
import * as Astronomy from 'astronomy-engine';
import { PLANETS } from '../astro/planets';
import { catalogs } from './objects';
import { round } from './ground';

type Lang = 'en' | 'fr';
type Localized = { readonly en: string; readonly fr: string };

export interface EventOptions {
  readonly start: Date;
  readonly end: Date;
  readonly lang: Lang;
  /** A place on the Earth: eclipses are then also described as seen from there. */
  readonly observer?: { readonly latDeg: number; readonly lonDeg: number; readonly heightM?: number };
  readonly local?: (ms: number) => string;
  /** Event kinds to include (default: all). */
  readonly kinds?: readonly EventKind[];
}

export const EVENT_KINDS = ['moon', 'eclipse', 'season', 'planet', 'mission'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface SkyEvent {
  readonly time: string;
  readonly local?: string;
  readonly kind: EventKind;
  readonly title: string;
  readonly details?: Record<string, unknown>;
}

const QUARTERS: readonly Localized[] = [
  { en: 'New Moon', fr: 'Nouvelle lune' },
  { en: 'First quarter', fr: 'Premier quartier' },
  { en: 'Full Moon', fr: 'Pleine lune' },
  { en: 'Last quarter', fr: 'Dernier quartier' },
];

const ECLIPSE_KINDS: Record<string, Localized> = {
  penumbral: { en: 'penumbral', fr: 'par la pénombre' },
  partial: { en: 'partial', fr: 'partielle' },
  annular: { en: 'annular', fr: 'annulaire' },
  total: { en: 'total', fr: 'totale' },
};

/** Ecliptic latitude of the Moon beyond which no eclipse can happen at that syzygy (limits: about 1.6°, with margin). */
const ECLIPSE_LATITUDE_LIMIT_DEG = 1.8;

/** Full Moons nearer than this are commonly called supermoons, farther than the next one micromoons. */
const SUPERMOON_KM = 360_000;
const MICROMOON_KM = 405_000;

/**
 * A solar eclipse as seen from a place, around the global peak: the Sun and the Moon seen from the observer
 * (topocentric) every 10 minutes over ±3 h, then a golden-section search for the greatest coverage. Bounded cost,
 * unlike a search for the next eclipse visible from there (which may lie years ahead).
 */
function localSolarEclipse(
  peak: Astronomy.AstroTime,
  observer: Astronomy.Observer,
): Record<string, unknown> | undefined {
  const SUN_KM = 695_700;
  const MOON_KM = 1737.4;
  const look = (t: Astronomy.AstroTime) => {
    const sun = Astronomy.Equator(Astronomy.Body.Sun, t, observer, true, true);
    const moon = Astronomy.Equator(Astronomy.Body.Moon, t, observer, true, true);
    const rad = Math.PI / 180;
    const sep =
      Math.acos(
        Math.min(
          1,
          Math.sin(sun.dec * rad) * Math.sin(moon.dec * rad) +
            Math.cos(sun.dec * rad) * Math.cos(moon.dec * rad) * Math.cos((sun.ra - moon.ra) * 15 * rad),
        ),
      ) / rad;
    const rs = Math.asin(SUN_KM / (sun.dist * 149_597_870.7)) / rad;
    const rm = Math.asin(MOON_KM / (moon.dist * 149_597_870.7)) / rad;
    return { t, sep, rs, rm, sun };
  };
  let best: ReturnType<typeof look> | undefined;
  let begins: Astronomy.AstroTime | undefined;
  let ends: Astronomy.AstroTime | undefined;
  for (let m = -180; m <= 180; m += 10) {
    const s = look(peak.AddDays(m / 1440));
    if (s.sep < s.rs + s.rm) {
      begins ??= s.t;
      ends = s.t;
    }
    if (!best || s.sep - s.rs - s.rm < best.sep - best.rs - best.rm) best = s;
  }
  if (!best || !begins || !ends) return undefined;
  // Refine the greatest eclipse within ±10 minutes of the best sample.
  let a = best.t.AddDays(-10 / 1440).ut;
  let b = best.t.AddDays(10 / 1440).ut;
  const f = (ut: number) => look(Astronomy.MakeTime(ut));
  while (b - a > 2 / 86_400) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (f(m1).sep < f(m2).sep) b = m2;
    else a = m1;
  }
  const top = f((a + b) / 2);
  // First and last contacts to about a second, between a sample without overlap and one with.
  const overlaps = (ut: number): boolean => {
    const x = f(ut);
    return x.sep < x.rs + x.rm;
  };
  const contact = (outside: number, inside: number): Astronomy.AstroTime => {
    while (Math.abs(inside - outside) > 1 / 86_400) {
      const mid = (inside + outside) / 2;
      if (overlaps(mid)) inside = mid;
      else outside = mid;
    }
    return Astronomy.MakeTime((inside + outside) / 2);
  };
  const first = contact(begins.AddDays(-10 / 1440).ut, begins.ut);
  const last = contact(ends.AddDays(10 / 1440).ut, ends.ut);
  const hor = Astronomy.Horizon(top.t, observer, top.sun.ra, top.sun.dec, 'normal');
  if (hor.altitude <= 0)
    return { visible: false, note: 'the Sun is below the horizon at the greatest eclipse' };
  const kind = top.sep <= top.rm - top.rs ? 'total' : top.sep <= top.rs - top.rm ? 'annular' : 'partial';
  // Fraction of the Sun's diameter covered (the usual "magnitude").
  const magnitude = Math.max(0, (top.rs + top.rm - top.sep) / (2 * top.rs));
  return {
    visible: true,
    kind,
    greatest: top.t.date.toISOString(),
    magnitude: round(magnitude, 3),
    sunAltitudeDeg: round(hor.altitude, 1),
    begins: first.date.toISOString(),
    ends: last.date.toISOString(),
    note: 'Contacts and greatest eclipse from the topocentric Sun and Moon (spheres, no lunar limb profile): to within seconds; the Sun may rise or set during the eclipse.',
  };
}

/** "de Mars", "d’Uranus". */
const deFr = (name: string): string => (/^[AEIOUYÉÈ]/i.test(name) ? `d’${name}` : `de ${name}`);

export function eventsBetween(o: EventOptions): SkyEvent[] {
  const t0 = Astronomy.MakeTime(o.start);
  const endUt = Astronomy.MakeTime(o.end).ut;
  const wanted = (k: EventKind): boolean => !o.kinds || o.kinds.includes(k);
  const out: SkyEvent[] = [];
  const add = (
    time: Astronomy.AstroTime | Date,
    kind: EventKind,
    title: Localized,
    details?: Record<string, unknown>,
  ) => {
    const date = time instanceof Date ? time : time.date;
    out.push({
      time: date.toISOString(),
      ...(o.local ? { local: o.local(date.getTime()) } : {}),
      kind,
      title: title[o.lang],
      ...(details ? { details } : {}),
    });
  };
  const inRange = (t: Astronomy.AstroTime): boolean => t.ut >= t0.ut && t.ut <= endUt;
  const observer = o.observer
    ? new Astronomy.Observer(o.observer.latDeg, o.observer.lonDeg, o.observer.heightM ?? 0)
    : undefined;

  if (wanted('moon')) {
    for (let q = Astronomy.SearchMoonQuarter(t0); q.time.ut <= endUt; q = Astronomy.NextMoonQuarter(q)) {
      const title = QUARTERS[q.quarter] ?? QUARTERS[0];
      if (!title) continue;
      let details: Record<string, unknown> | undefined;
      if (q.quarter === 2) {
        const km = Math.round(Astronomy.GeoMoon(q.time).Length() * 149_597_870.7);
        details = {
          distanceKm: km,
          ...(km < SUPERMOON_KM ? { supermoon: true } : km > MICROMOON_KM ? { micromoon: true } : {}),
        };
      }
      add(q.time, 'moon', title, details);
    }
    for (let a = Astronomy.SearchLunarApsis(t0); a.time.ut <= endUt; a = Astronomy.NextLunarApsis(a)) {
      add(
        a.time,
        'moon',
        a.kind === Astronomy.ApsisKind.Pericenter
          ? { en: 'Moon at perigee', fr: 'Lune au périgée' }
          : { en: 'Moon at apogee', fr: 'Lune à l’apogée' },
        {
          distanceKm: Math.round(a.dist_km),
        },
      );
    }
  }

  if (wanted('eclipse')) {
    // An eclipse needs the Moon near the ecliptic at full (lunar) or new (solar) Moon: only those syzygies of the
    // period get the precise searches (each of which would otherwise scan ahead to the next eclipse, months away).
    const lunar: Astronomy.LunarEclipseInfo[] = [];
    const solar: Astronomy.GlobalSolarEclipseInfo[] = [];
    for (
      let q = Astronomy.SearchMoonQuarter(t0.AddDays(-2));
      q.time.ut <= endUt + 2;
      q = Astronomy.NextMoonQuarter(q)
    ) {
      if (q.quarter !== 0 && q.quarter !== 2) continue;
      if (Math.abs(Astronomy.EclipticGeoMoon(q.time).lat) > ECLIPSE_LATITUDE_LIMIT_DEG) continue;
      const from = q.time.AddDays(-2);
      if (q.quarter === 2) {
        const e = Astronomy.SearchLunarEclipse(from);
        if (Math.abs(e.peak.ut - q.time.ut) < 2 && inRange(e.peak)) lunar.push(e);
      } else {
        const e = Astronomy.SearchGlobalSolarEclipse(from);
        if (Math.abs(e.peak.ut - q.time.ut) < 2 && inRange(e.peak)) solar.push(e);
      }
    }
    for (const e of lunar) {
      const kind = ECLIPSE_KINDS[e.kind] ?? { en: e.kind, fr: e.kind };
      const fromHere = observer
        ? (() => {
            const eq = Astronomy.Equator(Astronomy.Body.Moon, e.peak, observer, true, true);
            const alt = Astronomy.Horizon(e.peak, observer, eq.ra, eq.dec, 'normal').altitude;
            return { moonAltitudeAtPeakDeg: round(alt, 1), visibleAtPeak: alt > 0 };
          })()
        : {};
      add(
        e.peak,
        'eclipse',
        { en: `Lunar eclipse (${kind.en})`, fr: `Éclipse de Lune ${kind.fr}` },
        {
          kind: e.kind,
          totalMinutes: round(e.sd_total * 2, 0),
          partialMinutes: round(e.sd_partial * 2, 0),
          penumbralMinutes: round(e.sd_penum * 2, 0),
          obscuration: round(e.obscuration, 3),
          ...fromHere,
        },
      );
    }
    for (const e of solar) {
      const kind = ECLIPSE_KINDS[e.kind] ?? { en: e.kind, fr: e.kind };
      const fromHere = observer ? localSolarEclipse(e.peak, observer) : undefined;
      add(
        e.peak,
        'eclipse',
        { en: `Solar eclipse (${kind.en})`, fr: `Éclipse de Soleil ${kind.fr}` },
        {
          kind: e.kind,
          ...(e.latitude !== undefined && e.longitude !== undefined
            ? { greatestEclipse: { latDeg: round(e.latitude, 2), lonDeg: round(e.longitude, 2) } }
            : {}),
          ...(observer ? { fromHere: fromHere ?? { visible: false } } : {}),
        },
      );
    }
  }

  if (wanted('season')) {
    for (let year = o.start.getUTCFullYear(); year <= o.end.getUTCFullYear(); year++) {
      const s = Astronomy.Seasons(year);
      const list: [Astronomy.AstroTime, Localized][] = [
        [s.mar_equinox, { en: 'March equinox', fr: 'Équinoxe de mars' }],
        [s.jun_solstice, { en: 'June solstice', fr: 'Solstice de juin' }],
        [s.sep_equinox, { en: 'September equinox', fr: 'Équinoxe de septembre' }],
        [s.dec_solstice, { en: 'December solstice', fr: 'Solstice de décembre' }],
      ];
      for (const [t, title] of list) if (inRange(t)) add(t, 'season', title);
    }
    for (
      let a = Astronomy.SearchPlanetApsis(Astronomy.Body.Earth, t0);
      a.time.ut <= endUt;
      a = Astronomy.NextPlanetApsis(Astronomy.Body.Earth, a)
    ) {
      add(
        a.time,
        'season',
        a.kind === Astronomy.ApsisKind.Pericenter
          ? { en: 'Earth at perihelion', fr: 'Terre au périhélie' }
          : { en: 'Earth at aphelion', fr: 'Terre à l’aphélie' },
        {
          distanceAu: round(a.dist_au, 6),
        },
      );
    }
  }

  if (wanted('planet')) {
    for (const p of PLANETS) {
      if (p.dwarf || p.id === 'earth') continue;
      const name = p.name;
      const inner = p.id === 'mercury' || p.id === 'venus';
      // Relative longitude 0°: inferior conjunction (inner) or opposition (outer); 180°: (superior) conjunction.
      for (const [target, title] of [
        [
          0,
          inner
            ? { en: `${name.en} at inferior conjunction`, fr: `Conjonction inférieure ${deFr(name.fr)}` }
            : { en: `${name.en} at opposition`, fr: `Opposition ${deFr(name.fr)}` },
        ],
        [
          180,
          inner
            ? { en: `${name.en} at superior conjunction`, fr: `Conjonction supérieure ${deFr(name.fr)}` }
            : {
                en: `${name.en} in conjunction with the Sun`,
                fr: `Conjonction ${deFr(name.fr)} avec le Soleil`,
              },
        ],
      ] as const) {
        let t = Astronomy.SearchRelativeLongitude(p.body, target, t0);
        while (t.ut <= endUt) {
          const details =
            !inner && target === 0
              ? {
                  magnitude: round(Astronomy.Illumination(p.body, t).mag, 1),
                  distanceAu: round(Astronomy.GeoVector(p.body, t, true).Length(), 3),
                }
              : undefined;
          add(t, 'planet', title, details);
          t = Astronomy.SearchRelativeLongitude(p.body, target, t.AddDays(1));
        }
      }
      if (inner) {
        for (
          let e = Astronomy.SearchMaxElongation(p.body, t0);
          e.time.ut <= endUt;
          e = Astronomy.SearchMaxElongation(p.body, e.time.AddDays(1))
        ) {
          add(
            e.time,
            'planet',
            e.visibility === 'morning'
              ? {
                  en: `${name.en} at greatest western elongation (morning sky)`,
                  fr: `Plus grande élongation ouest ${deFr(name.fr)} (ciel du matin)`,
                }
              : {
                  en: `${name.en} at greatest eastern elongation (evening sky)`,
                  fr: `Plus grande élongation est ${deFr(name.fr)} (ciel du soir)`,
                },
            { elongationDeg: round(e.elongation, 1) },
          );
        }
      }
    }
  }

  if (wanted('mission')) {
    const startDay = o.start.toISOString().slice(0, 10);
    const endDay = o.end.toISOString().slice(0, 10);
    for (const m of catalogs.missions) {
      const ev = m.nextEvent;
      if (!ev?.date) continue;
      // Partial dates ("2026-12", "2027") match when the period overlaps them.
      const from = ev.date.padEnd(10, ev.date.length === 4 ? '-01-01' : '-01').slice(0, 10);
      const to =
        ev.date.length === 10 ? ev.date : ev.date.length === 7 ? `${ev.date}-31` : `${ev.date}-12-31`;
      if (to < startDay || from > endDay) continue;
      out.push({
        // A partial date is placed at the start of its overlap with the period.
        time: `${ev.date.length === 10 ? ev.date : from < startDay ? startDay : from}T00:00:00.000Z`,
        kind: 'mission',
        title: `${m.name[o.lang]}: ${ev[o.lang]}`,
        details: {
          mission: m.id,
          date: ev.date,
          ...(ev.date.length < 10 ? { approximate: true } : {}),
          verified: m.verified,
        },
      });
    }
  }

  return out.sort((a, b) => a.time.localeCompare(b.time));
}
