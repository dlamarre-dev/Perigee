/**
 * Earth-view object catalogue: merges GP elements (required) with SATCAT metadata, CelesTrak group
 * membership and the curated operators table (all optional). NORAD_CAT_ID is always an integer key —
 * 6-digit numbers (≥ 100000) are first-class.
 */
import { apsides, orbitRegime, periodMin, type OrbitRegime } from '../astro/orbit';
import { DEG_TO_RAD, MS_PER_DAY } from '../astro/constants';
import type { Groups, LaunchSite, Omm, OperatorsCatalog, SatcatRecord } from '../data/schemas';

/** Elements older than this are flagged "stale" (CLAUDE.md §5.1). */
export const STALE_AFTER_DAYS = 14;

export interface SatObject {
  readonly index: number;
  readonly noradId: number;
  readonly name: string;
  readonly cosparId: string;
  readonly omm: Omm;
  readonly satcat: SatcatRecord | undefined;
  readonly groups: readonly string[];
  readonly operatorId: string | undefined;
  /** Instruments of other operators carried by this satellite (catalog/operators.json hostedPayloads). */
  readonly hostedPayloads: readonly { readonly operatorId: string; readonly name: string }[];
  readonly ownerCode: string | undefined;
  readonly objectType: string;
  /** SATCAT LAUNCH_SITE code. */
  readonly launchSite: string | undefined;
  readonly regime: OrbitRegime;
  readonly epochMs: number;
  readonly periodMin: number;
  readonly inclinationRad: number;
  readonly perigeeAltKm: number;
  readonly apogeeAltKm: number;
  /** Lower-case name and COSPAR for text search (NORAD numbers are matched exactly). */
  readonly searchText: string;
}

export interface SatCatalog {
  readonly objects: readonly SatObject[];
  readonly byNorad: ReadonlyMap<number, SatObject>;
  readonly operators: OperatorsCatalog;
  /** SATCAT LAUNCH_SITE code → curated launch site. */
  readonly launchSiteByCode: ReadonlyMap<string, LaunchSite>;
}

/** OMM EPOCH is UTC without a zone designator and may carry microseconds. */
export function parseOmmEpochMs(epoch: string): number {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(epoch);
  if (!m) return Number.NaN;
  const fraction = m[2] ? Number(`0${m[2]}`) : 0;
  return Date.parse(`${m[1]}Z`) + fraction * 1000;
}

export function elementAgeDays(obj: Pick<SatObject, 'epochMs'>, nowMs: number): number {
  return (nowMs - obj.epochMs) / MS_PER_DAY;
}

export function isStale(obj: Pick<SatObject, 'epochMs'>, nowMs: number): boolean {
  return Math.abs(elementAgeDays(obj, nowMs)) > STALE_AFTER_DAYS;
}

export function buildCatalog(
  gp: readonly Omm[],
  satcat: readonly SatcatRecord[] | undefined,
  groups: Groups | undefined,
  operators: OperatorsCatalog,
  launchSites: readonly LaunchSite[] = [],
): SatCatalog {
  const satcatByNorad = new Map((satcat ?? []).map((r) => [r.NORAD_CAT_ID, r]));
  const groupsByNorad = new Map<number, string[]>();
  for (const [group, ids] of Object.entries(groups ?? {})) {
    for (const id of ids) {
      const list = groupsByNorad.get(id);
      if (list) list.push(group);
      else groupsByNorad.set(id, [group]);
    }
  }

  // CelesTrak occasionally lists the same object twice; keep the most recent epoch.
  const latest = new Map<number, Omm>();
  for (const omm of gp) {
    const prev = latest.get(omm.NORAD_CAT_ID);
    if (!prev || parseOmmEpochMs(omm.EPOCH) > parseOmmEpochMs(prev.EPOCH)) latest.set(omm.NORAD_CAT_ID, omm);
  }

  const nameRules = operators.nameRules.map((r) => ({
    operator: r.operator,
    re: new RegExp(r.pattern, 'i'),
  }));
  const hostedByNorad = new Map<number, { operatorId: string; name: string }[]>();
  for (const p of operators.hostedPayloads) {
    hostedByNorad.set(p.norad, [
      ...(hostedByNorad.get(p.norad) ?? []),
      { operatorId: p.operator, name: p.name },
    ]);
  }

  const objects: SatObject[] = [];
  for (const omm of latest.values()) {
    const sc = satcatByNorad.get(omm.NORAD_CAT_ID);
    const memberOf = groupsByNorad.get(omm.NORAD_CAT_ID) ?? [];
    // CelesTrak group first (constellations), then curated name rules (operators without a group).
    const operatorId =
      memberOf.map((g) => operators.groups[g]?.operator).find((o) => o !== undefined) ??
      nameRules.find((r) => r.re.test(omm.OBJECT_NAME))?.operator;
    const hostedPayloads = hostedByNorad.get(omm.NORAD_CAT_ID) ?? [];
    const { perigeeAltKm, apogeeAltKm } = apsides(omm.MEAN_MOTION, omm.ECCENTRICITY);
    objects.push({
      index: objects.length,
      noradId: omm.NORAD_CAT_ID,
      name: omm.OBJECT_NAME,
      cosparId: omm.OBJECT_ID,
      omm,
      satcat: sc,
      groups: memberOf,
      operatorId,
      hostedPayloads,
      ownerCode: sc?.OWNER,
      objectType: sc?.OBJECT_TYPE ?? 'UNK',
      launchSite: sc?.LAUNCH_SITE ?? undefined,
      regime: orbitRegime(omm.MEAN_MOTION, omm.ECCENTRICITY),
      epochMs: parseOmmEpochMs(omm.EPOCH),
      periodMin: periodMin(omm.MEAN_MOTION),
      inclinationRad: omm.INCLINATION * DEG_TO_RAD,
      perigeeAltKm,
      apogeeAltKm,
      searchText: [omm.OBJECT_NAME, omm.OBJECT_ID, ...hostedPayloads.map((p) => p.name)]
        .join(' ')
        .toLowerCase(),
    });
  }
  const launchSiteByCode = new Map(launchSites.flatMap((s) => s.satcatCodes.map((c) => [c, s] as const)));
  return { objects, byNorad: new Map(objects.map((o) => [o.noradId, o])), operators, launchSiteByCode };
}
