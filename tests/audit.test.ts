import { describe, expect, it } from 'vitest';
import {
  checkCelestrakGroups,
  checkEphemerisCoverage,
  checkLaunchSiteCodes,
  checkLeapSeconds,
  checkOwnerCodes,
  checkMoonAnchors,
  checkStaleVerification,
  deepSpaceCandidates,
  parseCelestrakGroups,
  parseIersLeapSeconds,
  renderMarkdown,
  type SatcatLaunchRow,
} from '../pipeline/audit';
import {
  LaunchSitesSchema,
  ManifestSchema,
  MissionSchema,
  OperatorsCatalogSchema,
  type SatcatRecord,
} from '../src/data/schemas';

const sat = (id: number, owner: string, site: string | null): SatcatRecord => ({
  NORAD_CAT_ID: id,
  OBJECT_NAME: `SAT ${id}`,
  OBJECT_ID: `2026-${id}A`,
  OBJECT_TYPE: 'PAY',
  OPS_STATUS_CODE: '+',
  OWNER: owner,
  LAUNCH_DATE: '2026-01-01',
  LAUNCH_SITE: site,
  PERIOD: null,
  INCLINATION: null,
  APOGEE: null,
  PERIGEE: null,
  RCS: null,
});

const launchSites = LaunchSitesSchema.parse({
  verified: '2026-09-26',
  sites: [
    {
      id: 'ksc',
      name: { en: 'KSC', fr: 'KSC' },
      operator: 'NASA',
      satcatCodes: ['AFETR'],
      latDeg: 28.5,
      lonDeg: -80.6,
      active: true,
      sources: ['https://www.nasa.gov/'],
    },
  ],
  unplacedSatcatCodes: [{ code: 'SEAL', reason: 'mobile platform' }],
});

const operators = OperatorsCatalogSchema.parse({
  verified: '2026-09-26',
  sources: ['https://celestrak.org/satcat/sources.php'],
  owners: { US: { en: 'United States', fr: 'États-Unis' } },
  operators: {},
  groups: { starlink: { en: 'Starlink', fr: 'Starlink' } },
  ignoredGroups: [{ group: 'active', reason: 'base dataset' }],
});

const mission = (over: Record<string, unknown>) =>
  MissionSchema.parse({
    id: 'probe',
    name: { en: 'Probe', fr: 'Sonde' },
    centralBody: 'sun',
    status: 'active',
    ephemeris: 'horizons',
    horizonsId: '-999',
    verified: '2026-09-01',
    sources: ['https://www.nasa.gov/'],
    ...over,
  });

const NOW = new Date('2026-09-28T12:00:00Z');

describe('maintenance audit', () => {
  it('reports unknown launch-site codes, not placed or deliberately unplaced ones', () => {
    const items = checkLaunchSiteCodes(
      [
        sat(1, 'US', 'AFETR'),
        sat(2, 'US', 'SEAL'),
        sat(3, 'US', 'JJSLA'),
        sat(4, 'US', 'JJSLA'),
        sat(5, 'US', null),
      ],
      launchSites,
    );
    expect(items.map((i) => i.key)).toEqual(['JJSLA']);
    expect(items[0]?.details?.['count']).toBe(2);
  });

  it('reports owner codes without a label', () => {
    expect(checkOwnerCodes([sat(1, 'US', null), sat(2, 'NEW', null)], operators).map((i) => i.key)).toEqual([
      'NEW',
    ]);
  });

  it('parses the CelesTrak index and reports groups neither fetched nor ignored', () => {
    const html =
      '<a href="gp.php?GROUP=active&FORMAT=tle">x</a><a href="gp.php?GROUP=starlink&FORMAT=tle">' +
      '<a href="gp.php?GROUP=iridium-NEXT&FORMAT=tle"><a href="gp.php?GROUP=newconst&FORMAT=tle">';
    const groups = parseCelestrakGroups(html);
    expect(groups).toEqual(['active', 'iridium-NEXT', 'newconst', 'starlink']);
    expect(checkCelestrakGroups(groups, operators).map((i) => i.key)).toEqual(['iridium-NEXT', 'newconst']);
  });

  it('finds deep-space payloads missing from the catalog, not docked or decayed ones', () => {
    const row = (id: number, center: string, extra: Partial<SatcatLaunchRow> = {}): SatcatLaunchRow => ({
      NORAD_CAT_ID: id,
      OBJECT_NAME: `OBJ ${id}`,
      OBJECT_ID: `2026-${id}A`,
      OBJECT_TYPE: 'PAY',
      OWNER: 'US',
      LAUNCH_DATE: '2026-05-01',
      ORBIT_CENTER: center,
      DECAY_DATE: '',
      ...extra,
    });
    const launches = [
      row(1, 'EA'),
      row(2, 'SU'),
      row(3, '25544'),
      row(4, 'MO', { DECAY_DATE: '2026-06-01' }),
      row(5, 'EM', { OBJECT_TYPE: 'R/B' }),
      row(6, 'MA'),
    ];
    const found = deepSpaceCandidates(launches, [mission({ norad: 6 })]);
    expect(found.map((r) => r.NORAD_CAT_ID)).toEqual([2]);
  });

  it('flags ephemerides ending soon and ended ones for active missions', () => {
    const entry = (coverageEnd: string) => ({
      path: 'ephem/x.bin',
      source: 'https://ssd.jpl.nasa.gov/api/horizons.api',
      fetchedAt: '2026-09-28T00:00:00Z',
      count: 10,
      bytes: 560,
      sha256: 'a'.repeat(64),
      horizonsId: '-1',
      center: '500@10',
      centralBody: 'sun',
      startTdbJd: 2461000,
      endTdbJd: 2461010,
      stepMin: 1440,
      coverageEnd,
    });
    const manifest = ManifestSchema.parse({
      version: 1,
      generatedAt: '2026-09-28T00:00:00Z',
      datasets: {},
      ephemerides: {
        soon: entry('2026-10-10T00:00:00Z'),
        ended: entry('2026-08-14T00:00:00Z'),
        late: entry('2027-06-01T00:00:00Z'),
        over: entry('2026-03-01T00:00:00Z'),
      },
    });
    const items = checkEphemerisCoverage(
      manifest,
      [
        mission({ id: 'soon' }),
        mission({ id: 'ended' }),
        mission({ id: 'late' }),
        mission({ id: 'over', status: 'ended' }),
      ],
      NOW,
    );
    expect(items.map((i) => `${i.kind}:${i.key}`)).toEqual([
      'ephemeris-ending:soon',
      'ephemeris-ended-active:ended',
    ]);
  });

  it('lists entries due for re-verification', () => {
    const items = checkStaleVerification(
      [
        { path: 'catalog/a.json', verified: '2026-01-01' },
        { path: 'catalog/b.json', verified: '2026-09-01' },
      ],
      [
        mission({ id: 'old', verified: '2026-05-01' }),
        mission({ id: 'fresh', verified: '2026-09-20' }),
        mission({ id: 'gone', status: 'ended', verified: '2025-01-01' }),
      ],
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual(['mission:old', 'file:catalog/a.json']);
  });

  it('caps monthly re-verification at 15 missions per audit, oldest first', () => {
    const many = Array.from({ length: 58 }, (_, i) =>
      mission({ id: `m${String(i).padStart(2, '0')}`, verified: i < 20 ? '2026-08-01' : '2026-09-01' }),
    );
    const items = checkStaleVerification([], many, NOW);
    const missions = items.filter((i) => i.key.startsWith('mission:'));
    expect(missions).toHaveLength(15);
    expect(missions.every((i) => (i.details as { verified: string }).verified === '2026-08-01')).toBe(true);
    expect(items.find((i) => i.key === 'missions:deferred')?.summary).toMatch(/^43 more missions/);
    // Not due yet: verified within the last three weeks.
    expect(checkStaleVerification([], [mission({ id: 'x', verified: '2026-09-10' })], NOW)).toEqual([]);
  });

  it('asks for a re-anchoring of mean-element moons after a year', () => {
    const moon = (id: string, epochJdTdb: number) =>
      ({ id, elements: { epochJdTdb } }) as unknown as Parameters<typeof checkMoonAnchors>[0][number];
    const nowJd = NOW.getTime() / 86_400_000 + 2440587.5;
    expect(checkMoonAnchors([moon('a', nowJd - 100), moon('b', nowJd - 400)], NOW)).toMatchObject([
      { kind: 'moon-anchor', details: { moons: ['b'] } },
    ]);
    expect(checkMoonAnchors([moon('a', nowJd - 100)], NOW)).toEqual([]);
  });

  it('compares the IERS leap-second file with the table', () => {
    const text = [
      '#  File expires on 28 June 2027',
      '    57204.0    1  7 2015       36',
      '    57754.0    1  1 2017       37',
    ].join('\n');
    const iers = parseIersLeapSeconds(text);
    expect(iers).toEqual({ lastUnixMs: Date.UTC(2017, 0, 1), taiMinusUtcS: 37, expires: '28 June 2027' });
    expect(checkLeapSeconds(iers, { effectiveUnixMs: Date.UTC(2017, 0, 1), taiMinusUtcS: 37 }, NOW)).toEqual(
      [],
    );
    const newer = parseIersLeapSeconds(`${text}\n    61771.0    1  1 2028       38`);
    expect(
      checkLeapSeconds(newer, { effectiveUnixMs: Date.UTC(2017, 0, 1), taiMinusUtcS: 37 }, NOW),
    ).toHaveLength(1);
  });

  it('renders a checklist, or "nothing to do"', () => {
    expect(renderMarkdown({ generatedAt: NOW.toISOString(), items: [] })).toContain('Nothing to do');
    const md = renderMarkdown({
      generatedAt: NOW.toISOString(),
      items: checkOwnerCodes([sat(2, 'NEW', null)], operators),
    });
    expect(md).toContain('- [ ] SATCAT owner code NEW');
  });
});
