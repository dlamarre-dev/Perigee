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
});
export type Omm = z.infer<typeof OmmSchema>;
export const OmmListSchema = z.array(OmmSchema);

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

export const DatasetKeySchema = z.enum(['earth.gp', 'earth.satcat', 'earth.groups']);
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
});
export type EphemerisEntry = z.infer<typeof EphemerisEntrySchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  datasets: z.partialRecord(DatasetKeySchema, DatasetEntrySchema),
  ephemerides: z.record(z.string(), EphemerisEntrySchema).default({}),
});
export type Manifest = z.infer<typeof ManifestSchema>;

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const localized = z.object({ en: z.string(), fr: z.string() });
const iso2 = z.string().regex(/^[a-z]{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
      /** Precision caveats or source discrepancies (English, shown in the info panel). */
      note: z.string().optional(),
      sources: z.array(z.url()).min(1),
    }),
  ),
});
export type LandingSites = z.infer<typeof LandingSitesSchema>;
export type LandingSite = LandingSites['sites'][number];

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
      note: z.string().optional(),
      sources: z.array(z.url()).min(1),
    }),
  ),
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
});
export type OperatorsCatalog = z.infer<typeof OperatorsCatalogSchema>;
