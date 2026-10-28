/**
 * Data schemas shared by the pipeline (Node) and the client (browser).
 * The pipeline validates before publishing; the client validates what it loads.
 */
import { z } from 'zod';

const numeric = z.coerce.number().refine(Number.isFinite, 'must be a finite number');

/**
 * CCSDS OMM mean elements as published by CelesTrak GP (JSON). NORAD_CAT_ID is an integer that may exceed
 * 99999 (6-digit catalogue numbers since 2026-07-11): never pad or parse it by fixed columns.
 */
export const OmmSchema = z.object({
  OBJECT_NAME: z.string(),
  OBJECT_ID: z.string(),
  EPOCH: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/, 'EPOCH must be ISO 8601 (UTC)'),
  MEAN_MOTION: numeric,
  ECCENTRICITY: numeric,
  INCLINATION: numeric,
  RA_OF_ASC_NODE: numeric,
  ARG_OF_PERICENTER: numeric,
  MEAN_ANOMALY: numeric,
  EPHEMERIS_TYPE: z.coerce.number().int().optional(),
  CLASSIFICATION_TYPE: z.enum(['U', 'C']).optional(),
  NORAD_CAT_ID: z.coerce.number().int().positive(),
  ELEMENT_SET_NO: z.coerce.number().int(),
  REV_AT_EPOCH: z.coerce.number().int().optional(),
  BSTAR: numeric,
  MEAN_MOTION_DOT: numeric,
  MEAN_MOTION_DDOT: numeric,
  /**
   * Set by the pipeline when the elements come from a CelesTrak supplemental GP set (SupGP: SGP4 fits to the
   * operator's own ephemerides) instead of the Space Force GP data: the set's file name, e.g. "ses".
   */
  SOURCE: z.string().optional(),
  /** RMS of that fit as CelesTrak reports it (unit undocumented; kept for reference, not shown). */
  RMS: z.coerce.number().optional().catch(undefined),
});
export type Omm = z.infer<typeof OmmSchema>;
export const OmmListSchema = z.array(OmmSchema);

/** A record of a CelesTrak supplemental GP set: OMM plus the fit's RMS and the operator data it came from. */
export const SupGpRecordSchema = OmmSchema.extend({
  DATA_SOURCE: z.string().optional(),
});
export type SupGpRecord = z.infer<typeof SupGpRecordSchema>;

const nullableNumber = z.coerce.number().nullable().catch(null);
const nullableString = z
  .string()
  .nullable()
  .transform((s) => (s === '' ? null : s));

/** Subset of CelesTrak SATCAT fields used by the info panel and filters. */
export const SatcatRecordSchema = z.object({
  NORAD_CAT_ID: z.coerce.number().int().positive(),
  OBJECT_NAME: z.string(),
  OBJECT_ID: z.string(),
  OBJECT_TYPE: z.string(),
  OPS_STATUS_CODE: nullableString,
  OWNER: z.string(),
  LAUNCH_DATE: nullableString,
  LAUNCH_SITE: nullableString,
  PERIOD: nullableNumber,
  INCLINATION: nullableNumber,
  APOGEE: nullableNumber,
  PERIGEE: nullableNumber,
  RCS: nullableNumber,
});
export type SatcatRecord = z.infer<typeof SatcatRecordSchema>;
export const SatcatListSchema = z.array(SatcatRecordSchema);

/** CelesTrak group name → NORAD catalogue numbers of its members. */
export const GroupsSchema = z.record(z.string(), z.array(z.number().int().positive()));
export type Groups = z.infer<typeof GroupsSchema>;

export const DatasetKeySchema = z.enum([
  'earth.gp',
  'earth.satcat',
  'earth.groups',
  'mars.rovers',
  'sun.regions',
]);
export type DatasetKey = z.infer<typeof DatasetKeySchema>;

export const DatasetEntrySchema = z.object({
  /** Path relative to the data root, e.g. "earth/gp-active.json.gz". */
  path: z.string(),
  source: z.string(),
  /** ISO 8601 UTC instant of the upstream fetch. */
  fetchedAt: z.string(),
  count: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /**
   * Machine interfaces (src/data/shards.ts): the same records split by NORAD number into `count` files at `path`
   * ("{shard}" replaced), written with the dataset, so its sha256 versions them too. Extra fields, so older clients
   * that do not know them still read the manifest.
   */
  shards: z
    .object({
      count: z.number().int().positive(),
      path: z.string(),
      /** Gzip JSON of the shards' SHA-256 (ShardIndexSchema), and its own hash: readers check every shard. */
      index: z.string().optional(),
      indexSha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    })
    .optional(),
  /** earth.gp: gzip text index of every record, one tab-separated "NORAD NAME COSPAR" line each (name searches). */
  names: z.string().optional(),
  namesSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type DatasetEntry = z.infer<typeof DatasetEntrySchema>;

/** Hashes of a dataset's shards (`shards.index`), for the dataset version `parent` (its sha256). */
export const ShardIndexSchema = z.object({
  parent: z.string().regex(/^[0-9a-f]{64}$/),
  sha256: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
});
export type ShardIndex = z.infer<typeof ShardIndexSchema>;

export const CentralBodySchema = z.enum(['moon', 'mars', 'sun']);
export type CentralBody = z.infer<typeof CentralBodySchema>;

/** One mission's Horizons state vectors: data/ephem/<id>.bin, rows of 7 Float64 LE (t_TDB JD, x, y, z, vx, vy, vz). */
export const EphemerisEntrySchema = DatasetEntrySchema.extend({
  horizonsId: z.string(),
  /** Horizons CENTER code, e.g. "500@301" (Moon). */
  center: z.string(),
  centralBody: CentralBodySchema,
  startTdbJd: z.number(),
  endTdbJd: z.number(),
  stepMin: z.number().positive(),
  /** End of the public Horizons ephemeris when it falls inside the requested window (ISO UTC). */
  coverageEnd: z.string().optional(),
  /**
   * Archive of the states before the window (data/ephem/past/<id>.bin, same rows), kept 30 days: each daily run
   * appends the rows that left the window (pipeline/publish.ts `mergePast`). Loaded only for earlier dates. Its
   * step can vary (`stepMin` is the largest) and it may have gaps (missed runs). An extra field: older clients
   * ignore it.
   */
  past: z
    .object({
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      count: z.number().int().positive(),
      startTdbJd: z.number(),
      endTdbJd: z.number(),
      stepMin: z.number().positive(),
    })
    .optional(),
});
export type EphemerisEntry = z.infer<typeof EphemerisEntrySchema>;
export type EphemerisPast = NonNullable<EphemerisEntry['past']>;

/**
 * One moon's Horizons state vectors relative to its planet (solar view): data/ephem/moons/<id>.bin, same rows as
 * EphemerisEntry. Natural moons have no coverage end.
 */
export const MoonEphemerisEntrySchema = DatasetEntrySchema.extend({
  horizonsId: z.string(),
  /** Horizons CENTER code of the planet, e.g. "500@699" (Saturn). */
  center: z.string(),
  planet: z.string(),
  startTdbJd: z.number(),
  endTdbJd: z.number(),
  stepMin: z.number().positive(),
});
export type MoonEphemerisEntry = z.infer<typeof MoonEphemerisEntrySchema>;

/**
 * A comet's or an asteroid's heliocentric Horizons state vectors (solar view): data/ephem/comets/<id>.bin or
 * data/ephem/asteroids/<id>.bin, same rows as EphemerisEntry (Horizons integrates the body with the planets'
 * perturbations), with the object data Horizons gives for it.
 */
export const SmallBodyEphemerisEntrySchema = DatasetEntrySchema.extend({
  horizonsId: z.string(),
  center: z.string(),
  startTdbJd: z.number(),
  endTdbJd: z.number(),
  stepMin: z.number().positive(),
  /** End of the Horizons orbit solution when it falls inside the requested window (ISO UTC). */
  coverageEnd: z.string().optional(),
  /** Total-magnitude law m = M1 + 5 log Δ + 2.5 k1 log r, from Horizons' object data (when given). */
  m1: z.number().optional(),
  k1: z.number().optional(),
  /** Asteroid absolute magnitude H and slope G (H–G phase law), from Horizons' object data. */
  h: z.number().optional(),
  g: z.number().optional(),
  /** Nucleus or body radius from Horizons' object data (when given). */
  radiusKm: z.number().positive().optional(),
});
export type SmallBodyEphemerisEntry = z.infer<typeof SmallBodyEphemerisEntrySchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  datasets: z.partialRecord(DatasetKeySchema, DatasetEntrySchema),
  ephemerides: z.record(z.string(), EphemerisEntrySchema).default({}),
  /** Moons positioned from Horizons in the solar view (the others use astronomy-engine). */
  moons: z.record(z.string(), MoonEphemerisEntrySchema).default({}),
  /** Comets of catalog/comets.json (solar view). An extra field: older clients ignore it. */
  comets: z.record(z.string(), SmallBodyEphemerisEntrySchema).default({}),
  /** Asteroids of catalog/asteroids.json (solar view), refreshed weekly. An extra field: older clients ignore it. */
  asteroids: z.record(z.string(), SmallBodyEphemerisEntrySchema).default({}),
  /**
   * CelesTrak supplemental GP sets merged into earth.gp: when each was last downloaded, how many records it had
   * and how many replaced the GP elements.
   */
  /**
   * Machine interfaces: counts of the active catalogue (src/earth/stats.ts), rewritten after each GP and SATCAT run.
   * An extra field: older clients ignore it.
   */
  stats: z
    .object({
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      generatedAt: z.string(),
      gpFetchedAt: z.string().optional(),
      satcatFetchedAt: z.string().optional(),
    })
    .optional(),
  supplemental: z
    .record(
      z.string(),
      z.object({
        fetchedAt: z.string(),
        count: z.number().int().nonnegative(),
        used: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  /**
   * Daily copies of earth.gp kept 30 days (data/earth/history/<YYYY-MM-DD>.json.gz and its shards): the last GP
   * run of each UTC day, copied when the next day's first run replaces it (no extra request). Past dates use the
   * copy taken just after them (src/data/history.ts). An extra field: older clients ignore it.
   */
  earthHistory: z
    .object({
      days: z.number().int().positive(),
      snapshots: z.array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          path: z.string(),
          fetchedAt: z.string(),
          count: z.number().int().nonnegative(),
          bytes: z.number().int().nonnegative(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
          shards: z
            .object({
              count: z.number().int().positive(),
              path: z.string(),
              index: z.string(),
              indexSha256: z.string().regex(/^[0-9a-f]{64}$/),
            })
            .optional(),
        }),
      ),
    })
    .optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;
export type EarthSnapshot = NonNullable<Manifest['earthHistory']>['snapshots'][number];

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const localized = z.object({ en: z.string(), fr: z.string() });

/**
 * Main page of a mission, shown first among its links. `lang` (ISO 639-1) only when the page exists neither in
 * English nor in French: the link then shows it, e.g. "cnsa.gov.cn (zh)".
 */
export const WebsiteSchema = z.object({
  url: z.url().startsWith('https://'),
  lang: z
    .string()
    .regex(/^[a-z]{2}$/)
    .refine((l) => l !== 'en' && l !== 'fr', 'omit lang for English or French pages')
    .optional(),
});
export type Website = z.infer<typeof WebsiteSchema>;

/**
 * A 3D model shown on its publisher's site (ESA SciFleet): linked from the panel, never downloaded or copied,
 * since SciFleet's licence does not allow redistributing the models.
 */
export const ModelLinkSchema = z.object({ url: z.url().startsWith('https://') });
export type ModelLink = z.infer<typeof ModelLinkSchema>;
const iso2 = z.string().regex(/^[a-z]{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** ISO date at the precision the source gives: YYYY, YYYY-MM or YYYY-MM-DD. */
const partialDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/);

export const MissionStatusSchema = z.enum(['active', 'inactive', 'ended', 'cruise', 'planned', 'unknown']);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

/** catalog/missions.json — missions beyond Earth orbit (CLAUDE.md §4.4). */
export const MissionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: localized,
  /** Spacecraft, or a natural satellite (Phobos, Deimos) tracked the same way. */
  objectType: z.enum(['spacecraft', 'natural']).default('spacecraft'),
  /** Mean radius of a natural satellite (km), drawn as a small sphere. */
  radiusKm: z.number().positive().optional(),
  /**
   * Ellipsoid semi-axes (km), drawn instead of a sphere where the flattening shows: x towards the prime
   * meridian (the planet, for a synchronous moon), y, z along the pole.
   */
  radiiKm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
  /**
   * A dwarf planet recognised by the IAU (Ceres, Haumea, Makemake, Eris), or a candidate the solar view lists apart,
   * behind its own box (Gonggong, Quaoar, Orcus, Sedna, 2026 ED138).
   */
  dwarfStatus: z.enum(['iau', 'candidate']).optional(),
  /** How the size was measured: by a visiting spacecraft, a stellar occultation, the thermal emission, or estimated from the brightness. */
  sizeMethod: z.enum(['spacecraft', 'occultation', 'thermal', 'brightness']).optional(),
  /** Range of a size still uncertain (km), shown beside the diameter (`radiusKm` is then the central estimate). */
  diameterRangeKm: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  /** Discovery of a natural object: date at the source's precision, and who. */
  discovered: partialDate.optional(),
  discoverer: z.string().optional(),
  /** Its moons, by name (listed in the panel; not drawn). */
  moons: z.array(localized).optional(),
  agency: z.string().optional(),
  country: iso2.optional(),
  launchDate: isoDate.optional(),
  centralBody: CentralBodySchema,
  status: MissionStatusSchema,
  /** Orbit description, e.g. "low polar", "NRHO". */
  orbit: localized.optional(),
  /** Current mission phase, e.g. "cruise to Jupiter". */
  phase: localized.optional(),
  /** Next key event (flyby, arrival…), with its date when known. */
  nextEvent: localized.extend({ date: partialDate.optional() }).optional(),
  ephemeris: z.enum(['horizons', 'kepler', 'none']),
  /** Resolved with horizons_lookup.api, never guessed. */
  horizonsId: z.string().optional(),
  norad: z.number().int().positive().optional(),
  /** Horizons sampling: step and window around the fetch time. */
  sampling: z
    .object({
      stepMin: z.number().positive(),
      pastDays: z.number().nonnegative(),
      futureDays: z.number().nonnegative(),
    })
    .optional(),
  /** Low orbiters are hidden when extrapolated more than 7 days beyond their window (CLAUDE.md §5.2). */
  lowOrbit: z.boolean().default(true),
  color: hexColor.optional(),
  /** Main objectives of the mission, for students (shown before the notes on its current state). */
  goals: localized.optional(),
  notes: localized.optional(),
  website: WebsiteSchema.optional(),
  model3d: ModelLinkSchema.optional(),
  verified: isoDate,
  sources: z.array(z.url()).min(1),
});
export type Mission = z.infer<typeof MissionSchema>;

/** A spacecraft whose mission is over or that no longer answers: listed in the panels' "inactive" section. */
export function isInactiveMission(m: Pick<Mission, 'status' | 'objectType'>): boolean {
  return m.objectType !== 'natural' && (m.status === 'ended' || m.status === 'inactive');
}

export const MissionsCatalogSchema = z
  .object({ verified: isoDate, missions: z.array(MissionSchema) })
  .refine((c) => c.missions.every((m) => m.ephemeris !== 'horizons' || (m.horizonsId && m.sampling)), {
    message: 'Missions with ephemeris "horizons" need horizonsId and sampling',
  })
  .refine(
    (c) =>
      c.missions.every(
        (m) => !m.dwarfStatus || (m.objectType === 'natural' && m.radiusKm !== undefined && m.sizeMethod),
      ),
    { message: 'Dwarf planets are natural objects with radiusKm and sizeMethod' },
  );
export type MissionsCatalog = z.infer<typeof MissionsCatalogSchema>;

export const LandingSiteTypeSchema = z.enum(['soft', 'hard', 'impact', 'crewed', 'rover-last-known']);
export type LandingSiteType = z.infer<typeof LandingSiteTypeSchema>;

/**
 * catalog/moons.json — natural satellites of the planets for the solar-system view. Positions are computed in the
 * browser: astronomy-engine for the Moon and the Galilean moons, JPL SSD mean orbital elements (two-body Kepler
 * plus apsidal and nodal precession) for the others.
 */
export const MoonPlanetSchema = z.enum(['earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']);
export type MoonPlanet = z.infer<typeof MoonPlanetSchema>;
export const MoonElementsSchema = z.object({
  /** Epoch of the elements, Julian date (TDB). */
  epochJdTdb: z.number(),
  aKm: z.number().positive(),
  e: z.number().min(0).max(1),
  /** Argument of periapsis, mean anomaly, inclination, longitude of the ascending node (degrees). */
  wDeg: z.number(),
  MDeg: z.number(),
  iDeg: z.number(),
  nodeDeg: z.number(),
  nDegPerDay: z.number().positive(),
  periodDays: z.number().positive(),
  /** Precession periods (years); positive = apsides advance / node regresses, as JPL tabulates them. */
  apsidalPeriodYears: z.number().optional(),
  nodalPeriodYears: z.number().optional(),
  /** Plane the angles refer to: the local Laplace plane (pole given), the planet's equator, or the ecliptic. */
  referencePlane: z.enum(['laplace', 'equator', 'ecliptic', 'icrf']),
  laplacePoleRaDeg: z.number().optional(),
  laplacePoleDecDeg: z.number().optional(),
});
export type MoonElements = z.infer<typeof MoonElementsSchema>;
export const MoonSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: localized,
  planet: MoonPlanetSchema,
  spkid: z.number().int().positive(),
  radiusKm: z.number().positive(),
  /**
   * Ellipsoid semi-axes (km), drawn instead of a sphere where the flattening shows: x towards the prime
   * meridian (the planet, for a synchronous moon), y, z along the pole.
   */
  radiiKm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
  color: hexColor,
  model: z.enum(['astronomy-engine', 'mean-elements']),
  elements: MoonElementsSchema.optional(),
  /** Irregular body: radius grid in public/shapes/<id>.json (tools/shapes) instead of a sphere. */
  shape: z.literal('grid').optional(),
  notes: localized.optional(),
  verified: isoDate,
  sources: z.array(z.url()).min(1),
});
export type Moon = z.infer<typeof MoonSchema>;
export const MoonsCatalogSchema = z
  .object({ verified: isoDate, sources: z.array(z.url()).min(1), moons: z.array(MoonSchema) })
  .refine((c) => c.moons.every((m) => m.model === 'astronomy-engine' || m.elements), {
    message: 'mean-elements moons need elements',
  });
export type MoonsCatalog = z.infer<typeof MoonsCatalogSchema>;

/**
 * Well-known stars named on the sky of the solar-system view (catalog/stars.json): ICRS J2000 position,
 * V magnitude and spectral type from SIMBAD, physical values of the primary star for multiple systems.
 */
export const StarSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: localized,
  /** Bayer designation (Greek letter + Latin genitive), the same in every language. */
  designation: z.string(),
  constellation: localized,
  raDeg: z.number().min(0).max(360),
  decDeg: z.number().min(-90).max(90),
  magnitude: z.number(),
  distanceLy: z.number().positive(),
  spectralType: z.string(),
  kind: localized,
  radiusSun: z.number().positive().optional(),
  massSun: z.number().positive().optional(),
  temperatureK: z.number().positive().optional(),
  luminositySun: z.number().positive().optional(),
  notes: localized,
  verified: isoDate,
  sources: z.array(z.url()).min(1),
});
export type Star = z.infer<typeof StarSchema>;

/**
 * Comets shown in the solar-system view (catalog/comets.json): a curated list, positioned from JPL Horizons state
 * vectors fetched daily (`horizonsId`: a DES=…;CAP;NOFRAG record, the current apparition's orbit).
 */
export const CometSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Official designation as written, e.g. "1P/Halley", "C/1995 O1 (Hale-Bopp)". */
  designation: z.string(),
  name: localized,
  horizonsId: z.string().regex(/^DES=[^;]+;CAP;NOFRAG$/),
  sampling: z.object({
    stepMin: z.number().positive(),
    pastDays: z.number().nonnegative(),
    futureDays: z.number().positive(),
  }),
  /** Periodic (P/, numbered) or long-period (C/), as designated; the orbit itself may be hyperbolic. */
  kind: z.enum(['periodic', 'long-period']),
  discovered: partialDate.optional(),
  /** Mean nucleus diameter when measured. */
  nucleusKm: z.number().positive().optional(),
  notes: localized,
  verified: isoDate,
  sources: z.array(z.url()).min(1),
});
export type Comet = z.infer<typeof CometSchema>;

export const CometsCatalogSchema = z
  .object({ verified: isoDate, sources: z.array(z.url()).min(1), comets: z.array(CometSchema) })
  .refine((c) => new Set(c.comets.map((x) => x.id)).size === c.comets.length, {
    message: 'duplicate comet id',
  });

/**
 * Notable asteroids shown in the solar-system view (catalog/asteroids.json): the largest (over 250 km, Ceres apart:
 * it is a dwarf planet of missions.json) and the spacecraft targets, positioned from JPL Horizons state vectors
 * (`horizonsId`: "<number>;", the small-body record), refreshed weekly.
 */
export const AsteroidSchema = z.object({
  /** "<number>-<name>", e.g. "4-vesta". */
  id: z.string().regex(/^\d+-[a-z0-9-]+$/),
  number: z.number().int().positive(),
  /** As written, e.g. "4 Vesta". */
  designation: z.string(),
  name: localized,
  horizonsId: z.string().regex(/^\d+;$/),
  sampling: z.object({
    stepMin: z.number().positive(),
    pastDays: z.number().nonnegative(),
    futureDays: z.number().positive(),
  }),
  group: z.enum(['main-belt', 'mars-crosser', 'near-earth', 'jupiter-trojan']),
  spectralType: z.string().optional(),
  /** Mean diameter. */
  diameterKm: z.number().positive(),
  /** Longest to shortest axis, when a shape was measured. */
  dimensionsKm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
  rotationHours: z.number().positive().optional(),
  discovered: partialDate.optional(),
  discoverer: z.string().optional(),
  /** Spacecraft encounters (flyby, orbit, landing, sample return, impact). */
  visits: z
    .array(
      z.object({
        mission: localized,
        /** Its catalog/missions.json id, when listed there. */
        missionId: z.string().optional(),
        year: z.string(),
        kind: localized,
      }),
    )
    .optional(),
  moons: z.array(localized).optional(),
  notes: localized,
  verified: isoDate,
  sources: z.array(z.url()).min(1),
});
export type Asteroid = z.infer<typeof AsteroidSchema>;

export const AsteroidsCatalogSchema = z
  .object({ verified: isoDate, sources: z.array(z.url()).min(1), asteroids: z.array(AsteroidSchema) })
  .refine((c) => new Set(c.asteroids.map((x) => x.id)).size === c.asteroids.length, {
    message: 'duplicate asteroid id',
  });
export const StarsCatalogSchema = z.object({
  verified: isoDate,
  sources: z.array(z.url()).min(1),
  stars: z.array(StarSchema).min(1),
});
export type StarsCatalog = z.infer<typeof StarsCatalogSchema>;

/** Model axis, in the GLB's own frame (glTF: +Y up, +Z front). */
export const ModelAxisSchema = z.enum(['+x', '-x', '+y', '-y', '+z', '-z']);
export type ModelAxis = z.infer<typeof ModelAxisSchema>;

/** NASA 3D model of a spacecraft, rover or Earth satellite (public/models/<id>.glb, tools/models). */
export const ModelEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  url: z.url(),
  /** What it depicts: a mission, a landing/rover site, or Earth satellites by NORAD number. */
  targets: z
    .array(
      z
        .string()
        .regex(/^(mission:[a-z0-9-]+|moon:[a-z0-9-]+|site:[a-z0-9-]+|asteroid:[a-z0-9-]+|norad:\d+)$/),
    )
    .min(1),
  /** Largest real dimension (m): sanity check of the model's units, and the scale when they are off. */
  sizeM: z.number().positive(),
  credit: z.string().min(1),
  /**
   * Natural body: the model replaces the body sphere (BodyMesh) at all distances, in the IAU body frame (x
   * towards the prime meridian, z north), aligned offline on this PDS radius grid (Thomas shape models).
   */
  body: z.object({ alignGridUrl: z.url() }).optional(),
  /**
   * Full-quality variant public/models/<id>-high.glb (tools/models --high), loaded only while the model covers
   * at least `minPx` on screen and released when it shrinks; the light model stays for the panel preview.
   */
  high: z.object({ minPx: z.number().positive() }).optional(),
  /** Axis pointed at the Earth (deep-space probes: high-gain antenna). Default +z. */
  earthAxis: ModelAxisSchema.optional(),
  /** Axis pointed at the Sun, used to fix the roll (solar panels). Default +y. */
  sunAxis: ModelAxisSchema.optional(),
  /** Axis along the velocity (Earth satellites). Default +z. */
  forwardAxis: ModelAxisSchema.optional(),
  /** Axis pointed down (Earth satellites: nadir; rovers: the ground). Default −y. */
  nadirAxis: ModelAxisSchema.optional(),
  verified: isoDate,
  sources: z.array(z.url()).min(1),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export const ModelsCatalogSchema = z.object({
  verified: isoDate,
  sources: z.array(z.url()).min(1),
  models: z.array(ModelEntrySchema),
});
export type ModelsCatalog = z.infer<typeof ModelsCatalogSchema>;

/**
 * Licences accepted for the panel images (CLAUDE.md §14): public domain, CC0, CC BY, CC BY-SA (only resized,
 * never altered otherwise) and attribution-only government licences (India GODL, Korea KOGL type 1).
 */
export const ImageLicenceSchema = z.enum([
  'public-domain',
  'cc0',
  'cc-by-2.0',
  'cc-by-3.0',
  'cc-by-3.0-de',
  'cc-by-4.0',
  'cc-by-sa-3.0',
  'cc-by-sa-3.0-igo',
  'cc-by-sa-4.0',
  'godl-india',
  'kogl-1',
]);
export type ImageLicence = z.infer<typeof ImageLicenceSchema>;

/**
 * What an image shows, named under it: the object photographed, an image it took, its site seen from orbit or
 * from the air, an artist's impression, a replica or test model, the same kind of craft (not this one), or its
 * launch.
 */
export const ImageKindSchema = z.enum([
  'photo',
  'observation',
  'telescope',
  'orbital',
  'aerial',
  'illustration',
  'replica',
  'similar',
  'launch',
]);
export type ImageKind = z.infer<typeof ImageKindSchema>;

/** Representative image of an object without a 3D model (public/images/<id>.webp, tools/images). */
export const ImageEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  target: z.string().regex(/^(mission|site|launch|comet|asteroid):[a-z0-9-]+$|^norad:\d+$/),
  kind: ImageKindSchema,
  /** Original file, downloaded and resized by tools/images. */
  file: z.url(),
  credit: z.string().min(1),
  licence: ImageLicenceSchema,
  verified: isoDate,
  /** The image's description page first (shown as its source link). */
  sources: z.array(z.url()).min(1),
});
export type ImageEntry = z.infer<typeof ImageEntrySchema>;
export const ImagesCatalogSchema = z.object({
  verified: isoDate,
  sources: z.array(z.url()).min(1),
  images: z.array(ImageEntrySchema),
});
export type ImagesCatalog = z.infer<typeof ImagesCatalogSchema>;

/** catalog/landing-sites/<body>.json — planetocentric coordinates, east-positive longitudes. */
export const LandingSitesSchema = z.object({
  verified: isoDate,
  sites: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      name: localized,
      mission: z.string().optional(),
      agency: z.string(),
      country: iso2.optional(),
      date: isoDate,
      type: LandingSiteTypeSchema,
      latDeg: z.number().min(-90).max(90),
      lonDeg: z.number().min(-180).max(180),
      /** Precision caveats or source discrepancies (shown in the info panel, so in both languages). */
      note: localized.optional(),
      /** Live position feed (NASA MMGIS current waypoint, GeoJSON), refreshed daily by the pipeline. */
      feed: z.object({ url: z.url(), solZeroDate: isoDate }).optional(),
      sources: z.array(z.url()).min(1),
    }),
  ),
});
export type LandingSites = z.infer<typeof LandingSitesSchema>;
export type LandingSite = LandingSites['sites'][number];

/** data/mars/rovers.json.gz: latest published rover positions, keyed by landing-site id. */
export const RoverPositionsSchema = z.record(
  z.string(),
  z.object({
    latDeg: z.number().min(-90).max(90),
    lonDeg: z.number().min(-180).max(180),
    sol: z.number().int().nonnegative(),
    distanceTotalM: z.number().nonnegative().optional(),
    source: z.url(),
  }),
);
export type RoverPositions = z.infer<typeof RoverPositionsSchema>;

/**
 * data/sun/regions.json.gz: NOAA SWPC solar active regions, one record per region and observation day (the last
 * ~30 days). Positions are as of the end of `date` (00:00 UT the next day): heliographic latitude and Carrington
 * longitude, both in degrees as published (whole degrees). Area in millionths of the solar hemisphere; null for
 * regions without spots (plage).
 */
export const SunRegionsSchema = z.array(
  z.object({
    region: z.number().int().positive(),
    date: isoDate,
    latDeg: z.number().min(-90).max(90),
    carringtonLonDeg: z.number().min(0).max(360),
    areaMh: z.number().nonnegative().nullable(),
    spots: z.number().int().nonnegative().nullable(),
  }),
);
export type SunRegions = z.infer<typeof SunRegionsSchema>;

/** catalog/launch-sites.json — orbital spaceports, geodetic coordinates, SATCAT LAUNCH_SITE codes. */
export const LaunchSitesSchema = z.object({
  verified: isoDate,
  sites: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      name: localized,
      operator: z.string(),
      country: iso2.optional(),
      satcatCodes: z.array(z.string()),
      latDeg: z.number().min(-90).max(90),
      lonDeg: z.number().min(-180).max(180),
      firstOrbitalLaunch: isoDate.optional(),
      active: z.boolean(),
      note: localized.optional(),
      sources: z.array(z.url()).min(1),
    }),
  ),
  /** SATCAT LAUNCH_SITE codes deliberately not placed on the globe (sea/air launch areas…), with the reason. */
  unplacedSatcatCodes: z.array(z.object({ code: z.string(), reason: z.string() })).default([]),
});
export type LaunchSites = z.infer<typeof LaunchSitesSchema>;
export type LaunchSite = LaunchSites['sites'][number];

/** catalog/operators.json — curated, reviewed by PR. */
export const OperatorsCatalogSchema = z.object({
  verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sources: z.array(z.url()).min(1),
  /** SATCAT OWNER code → label and optional ISO 3166-1 alpha-2 country. */
  owners: z.record(z.string(), localized.extend({ country: iso2.optional() })),
  operators: z.record(
    z.string(),
    z.object({ name: z.string(), country: iso2.optional(), color: hexColor, url: z.url().optional() }),
  ),
  /** CelesTrak groups fetched by the pipeline; `operator` links members to an operator id. */
  groups: z.record(z.string(), localized.extend({ operator: z.string().optional() })),
  /** CelesTrak index groups deliberately not fetched (overlapping or thematic lists), with the reason. */
  ignoredGroups: z.array(z.object({ group: z.string(), reason: z.string() })).default([]),
  /**
   * CelesTrak supplemental GP sets (SupGP, keyed by FILE name) merged into the GP data: SGP4 fits to operator
   * ephemerides, more accurate and fresher than the Space Force elements for the satellites they cover.
   */
  supplemental: z.record(z.string(), localized.extend({ sources: z.array(z.url()).min(1) })).default({}),
  /** SupGP sets deliberately not used (geodetic laser-ranging predictions, temporary launch sets…). */
  ignoredSupplemental: z.array(z.object({ file: z.string(), reason: z.string() })).default([]),
  /**
   * Operators without a CelesTrak group, recognised by SATCAT/GP object name (case-insensitive regular
   * expression), e.g. every "GHGSAT-…" satellite belongs to GHGSat.
   */
  nameRules: z
    .array(z.object({ operator: z.string(), pattern: z.string(), sources: z.array(z.url()).min(1) }))
    .default([]),
  /**
   * Instruments flown on another operator's satellite: the catalogue lists the host, so the payload is mapped
   * here by the host's NORAD number (shown in the info panel, the operator facet and text search).
   */
  hostedPayloads: z
    .array(
      z.object({
        norad: z.number().int().positive(),
        operator: z.string(),
        name: z.string(),
        sources: z.array(z.url()).min(1),
      }),
    )
    .default([]),
});
export type OperatorsCatalog = z.infer<typeof OperatorsCatalogSchema>;

/**
 * Space and Earth science satellites shown first in the Earth view (catalog/earth-science.json): the CelesTrak
 * "science" group plus curated members (the ISS), with the names people know, status, notes and sources,
 * re-verified monthly like the missions.
 */
export const EarthScienceSatelliteSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  norad: z.number().int().positive(),
  name: localized,
  agency: z.string().min(1),
  country: z.string().regex(/^[a-z]{2,3}$/),
  launchDate: isoDate.optional(),
  status: MissionStatusSchema,
  purpose: localized,
  /** Main objectives of the mission, for students (shown before the notes). */
  goals: localized.optional(),
  notes: localized.optional(),
  website: WebsiteSchema.optional(),
  model3d: ModelLinkSchema.optional(),
  verified: isoDate,
  sources: z.array(z.url()).min(1),
});
export type EarthScienceSatellite = z.infer<typeof EarthScienceSatelliteSchema>;
export const EarthScienceCatalogSchema = z
  .object({
    verified: isoDate,
    sources: z.array(z.url()).min(1),
    satellites: z.array(EarthScienceSatelliteSchema),
  })
  .refine((c) => new Set(c.satellites.map((x) => x.norad)).size === c.satellites.length, {
    message: 'duplicate NORAD number',
  });
export type EarthScienceCatalog = z.infer<typeof EarthScienceCatalogSchema>;
