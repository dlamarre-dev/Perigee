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

export const DatasetKeySchema = z.enum(['earth.gp', 'earth.satcat', 'earth.groups', 'mars.rovers']);
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
});
export type DatasetEntry = z.infer<typeof DatasetEntrySchema>;

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
});
export type EphemerisEntry = z.infer<typeof EphemerisEntrySchema>;

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

export const ManifestSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  datasets: z.partialRecord(DatasetKeySchema, DatasetEntrySchema),
  ephemerides: z.record(z.string(), EphemerisEntrySchema).default({}),
  /** Moons positioned from Horizons in the solar view (the others use astronomy-engine). */
  moons: z.record(z.string(), MoonEphemerisEntrySchema).default({}),
  /**
   * CelesTrak supplemental GP sets merged into earth.gp: when each was last downloaded, how many records it had
   * and how many replaced the GP elements.
   */
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
});
export type Manifest = z.infer<typeof ManifestSchema>;

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const localized = z.object({ en: z.string(), fr: z.string() });
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
  notes: localized.optional(),
  verified: isoDate,
  sources: z.array(z.url()).min(1),
});
export type Mission = z.infer<typeof MissionSchema>;

export const MissionsCatalogSchema = z
  .object({ verified: isoDate, missions: z.array(MissionSchema) })
  .refine((c) => c.missions.every((m) => m.ephemeris !== 'horizons' || (m.horizonsId && m.sampling)), {
    message: 'Missions with ephemeris "horizons" need horizonsId and sampling',
  });
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

/** Model axis, in the GLB's own frame (glTF: +Y up, +Z front). */
export const ModelAxisSchema = z.enum(['+x', '-x', '+y', '-y', '+z', '-z']);
export type ModelAxis = z.infer<typeof ModelAxisSchema>;

/** NASA 3D model of a spacecraft, rover or Earth satellite (public/models/<id>.glb, tools/models). */
export const ModelEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  url: z.url(),
  /** What it depicts: a mission, a landing/rover site, or Earth satellites by NORAD number. */
  targets: z
    .array(z.string().regex(/^(mission:[a-z0-9-]+|moon:[a-z0-9-]+|site:[a-z0-9-]+|norad:\d+)$/))
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
  notes: localized.optional(),
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
