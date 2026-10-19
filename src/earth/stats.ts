/**
 * Counts of the active satellite catalogue (machine interfaces: "how many Starlink satellites are active?"): by
 * owner (SATCAT country or organisation code), operator (CelesTrak groups and the curated name rules, as in the
 * Earth view's filters), CelesTrak group, orbit regime, object type, launch year and low-orbit altitude band.
 * Written by the pipeline from the published files (counting, no positions) and read by the engine. Pure.
 */
import { MS_PER_DAY } from '../astro/constants';
import type { OrbitRegime } from '../astro/orbit';
import { isStale, type SatCatalog } from './catalog';

type Localized = { readonly en: string; readonly fr: string };
export type RegimeCounts = Record<OrbitRegime, number>;

export interface CountRow {
  readonly id: string;
  readonly name: Localized;
  readonly country?: string;
  readonly total: number;
  readonly regimes: RegimeCounts;
}

export interface SatelliteStats {
  readonly version: 1;
  /** Instant the counts refer to (the elements' fetch time). */
  readonly asOf: string;
  readonly total: number;
  readonly regimes: RegimeCounts;
  readonly objectTypes: Record<string, number>;
  readonly owners: readonly CountRow[];
  readonly operators: readonly CountRow[];
  /** Satellites without a curated operator (most national and institutional ones). */
  readonly withoutOperator: number;
  readonly groups: readonly CountRow[];
  readonly launchYears: Record<string, number>;
  readonly launchedLast30Days: number;
  readonly launchedLast365Days: number;
  /** Perigee altitude bands of low-orbit satellites (km). */
  readonly leoPerigeeBands: Record<string, number>;
  /** Elements older than 14 days, and elements from CelesTrak supplemental GP (operator ephemerides). */
  readonly staleElements: number;
  readonly supplementalElements: number;
}

const zeroRegimes = (): RegimeCounts => ({ LEO: 0, MEO: 0, GEO: 0, HEO: 0 });
const LEO_BANDS: readonly [string, number][] = [
  ['<400', 400],
  ['400-600', 600],
  ['600-800', 800],
  ['800-1200', 1200],
  ['1200-2000', Infinity],
];

export function satelliteStats(catalog: SatCatalog, asOfMs: number): SatelliteStats {
  const { operators } = catalog;
  const owners = new Map<string, { total: number; regimes: RegimeCounts }>();
  const ops = new Map<string, { total: number; regimes: RegimeCounts }>();
  const groups = new Map<string, { total: number; regimes: RegimeCounts }>();
  const bump = (
    map: Map<string, { total: number; regimes: RegimeCounts }>,
    key: string,
    regime: OrbitRegime,
  ) => {
    let row = map.get(key);
    if (!row) map.set(key, (row = { total: 0, regimes: zeroRegimes() }));
    row.total++;
    row.regimes[regime]++;
  };
  const regimes = zeroRegimes();
  const objectTypes: Record<string, number> = {};
  const launchYears: Record<string, number> = {};
  const leoPerigeeBands: Record<string, number> = Object.fromEntries(LEO_BANDS.map(([k]) => [k, 0]));
  let withoutOperator = 0;
  let last30 = 0;
  let last365 = 0;
  let stale = 0;
  let supplemental = 0;
  for (const o of catalog.objects) {
    regimes[o.regime]++;
    objectTypes[o.objectType] = (objectTypes[o.objectType] ?? 0) + 1;
    bump(owners, o.ownerCode ?? 'UNK', o.regime);
    if (o.operatorId) bump(ops, o.operatorId, o.regime);
    else withoutOperator++;
    for (const g of o.groups) bump(groups, g, o.regime);
    const launch = o.satcat?.LAUNCH_DATE;
    if (launch) {
      const year = launch.slice(0, 4);
      launchYears[year] = (launchYears[year] ?? 0) + 1;
      const ageDays = (asOfMs - Date.parse(`${launch}T00:00:00Z`)) / MS_PER_DAY;
      if (ageDays >= 0 && ageDays <= 30) last30++;
      if (ageDays >= 0 && ageDays <= 365) last365++;
    }
    if (o.regime === 'LEO') {
      const band = LEO_BANDS.find(([, max]) => o.perigeeAltKm < max)?.[0];
      if (band) leoPerigeeBands[band] = (leoPerigeeBands[band] ?? 0) + 1;
    }
    if (isStale(o, asOfMs)) stale++;
    if (o.omm.SOURCE) supplemental++;
  }
  const rows = (
    map: Map<string, { total: number; regimes: RegimeCounts }>,
    label: (id: string) => { name: Localized; country?: string },
  ): CountRow[] =>
    [...map.entries()]
      .map(([id, r]) => ({ id, ...label(id), total: r.total, regimes: r.regimes }))
      .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  return {
    version: 1,
    asOf: new Date(asOfMs).toISOString(),
    total: catalog.objects.length,
    regimes,
    objectTypes,
    owners: rows(owners, (id) => {
      const o = operators.owners[id];
      return {
        name: o ? { en: o.en, fr: o.fr } : { en: id, fr: id },
        ...(o?.country ? { country: o.country } : {}),
      };
    }),
    operators: rows(ops, (id) => {
      const o = operators.operators[id];
      return {
        name: { en: o?.name ?? id, fr: o?.name ?? id },
        ...(o?.country ? { country: o.country } : {}),
      };
    }),
    withoutOperator,
    groups: rows(groups, (id) => {
      const g = operators.groups[id];
      return { name: g ? { en: g.en, fr: g.fr } : { en: id, fr: id } };
    }),
    launchYears,
    launchedLast30Days: last30,
    launchedLast365Days: last365,
    leoPerigeeBands,
    staleElements: stale,
    supplementalElements: supplemental,
  };
}
