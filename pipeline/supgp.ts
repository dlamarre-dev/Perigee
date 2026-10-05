/**
 * Merge of CelesTrak supplemental GP sets (SupGP) into the GP "active" elements. Pure (no I/O); reformatting
 * only, no astrodynamics (CLAUDE.md §2.1).
 *
 * SupGP sets are SGP4 fits by CelesTrak to the operators' own ephemerides (SpaceX, SES, Intelsat, NASA/CMS for
 * the ISS and CSS, the GPS almanac, GLONASS ephemerides…): about ten times more accurate than the Space Force
 * elements, usually less than a day old, manoeuvres included. Some fit operator predictions, so their epoch can
 * be a few days ahead.
 */
import type { Omm, SupGpRecord } from '../src/data/schemas';

/** A SupGP record is used when its epoch lies within this window around the merge time. */
export const SUPGP_MAX_AGE_DAYS = 3;
export const SUPGP_MAX_AHEAD_DAYS = 7;

const DAY_MS = 86_400_000;

const epochMs = (epoch: string): number => Date.parse(`${epoch}Z`);

export interface MergeResult {
  readonly omm: Omm[];
  /** Per set, how many GP records its elements replaced. */
  readonly used: Record<string, number>;
}

/**
 * For each object of the GP set, the elements of the freshest usable SupGP record covering it, when there is
 * one: epoch within [now − SUPGP_MAX_AGE_DAYS, now + SUPGP_MAX_AHEAD_DAYS] and not older than the GP epoch. The
 * object keeps its GP name and designator and gains `SOURCE` (the set) and `RMS`. Objects only present in a
 * SupGP set are not added: the objects shown remain the GP "active" group.
 */
export function mergeSupplemental(
  gp: readonly Omm[],
  sets: ReadonlyMap<string, readonly SupGpRecord[]>,
  nowMs: number,
): MergeResult {
  const best = new Map<number, { set: string; record: SupGpRecord; epochMs: number }>();
  for (const [set, records] of sets) {
    for (const record of records) {
      const t = epochMs(record.EPOCH);
      if (!(t >= nowMs - SUPGP_MAX_AGE_DAYS * DAY_MS && t <= nowMs + SUPGP_MAX_AHEAD_DAYS * DAY_MS)) continue;
      const current = best.get(record.NORAD_CAT_ID);
      if (!current || t > current.epochMs) best.set(record.NORAD_CAT_ID, { set, record, epochMs: t });
    }
  }
  const used: Record<string, number> = Object.fromEntries([...sets.keys()].map((set) => [set, 0]));
  const omm = gp.map((o) => {
    const sup = best.get(o.NORAD_CAT_ID);
    if (!sup || sup.epochMs < epochMs(o.EPOCH)) return o;
    used[sup.set] = (used[sup.set] ?? 0) + 1;
    const r = sup.record;
    return {
      OBJECT_NAME: o.OBJECT_NAME,
      OBJECT_ID: o.OBJECT_ID,
      EPOCH: r.EPOCH,
      MEAN_MOTION: r.MEAN_MOTION,
      ECCENTRICITY: r.ECCENTRICITY,
      INCLINATION: r.INCLINATION,
      RA_OF_ASC_NODE: r.RA_OF_ASC_NODE,
      ARG_OF_PERICENTER: r.ARG_OF_PERICENTER,
      MEAN_ANOMALY: r.MEAN_ANOMALY,
      ...(r.EPHEMERIS_TYPE !== undefined ? { EPHEMERIS_TYPE: r.EPHEMERIS_TYPE } : {}),
      ...(o.CLASSIFICATION_TYPE !== undefined ? { CLASSIFICATION_TYPE: o.CLASSIFICATION_TYPE } : {}),
      NORAD_CAT_ID: o.NORAD_CAT_ID,
      ELEMENT_SET_NO: r.ELEMENT_SET_NO,
      ...(r.REV_AT_EPOCH !== undefined ? { REV_AT_EPOCH: r.REV_AT_EPOCH } : {}),
      BSTAR: r.BSTAR,
      MEAN_MOTION_DOT: r.MEAN_MOTION_DOT,
      MEAN_MOTION_DDOT: r.MEAN_MOTION_DDOT,
      SOURCE: sup.set,
      ...(r.RMS !== undefined ? { RMS: r.RMS } : {}),
    } satisfies Omm;
  });
  return { omm, used };
}
