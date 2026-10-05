import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkSupGpSets, parseSupGpFiles } from '../pipeline/audit';
import { checkChanges } from '../pipeline/catalog-guard';
import { mergeSupplemental } from '../pipeline/supgp';
import { OperatorsCatalogSchema, type Omm, type SupGpRecord } from '../src/data/schemas';

const NOW = Date.parse('2026-10-05T12:00:00Z');

const gp = (norad: number, epoch: string): Omm => ({
  OBJECT_NAME: `GP ${norad}`,
  OBJECT_ID: `2020-001${String.fromCharCode(64 + (norad % 26) + 1)}`,
  EPOCH: epoch,
  MEAN_MOTION: 15.5,
  ECCENTRICITY: 0.001,
  INCLINATION: 51.6,
  RA_OF_ASC_NODE: 10,
  ARG_OF_PERICENTER: 20,
  MEAN_ANOMALY: 30,
  NORAD_CAT_ID: norad,
  ELEMENT_SET_NO: 999,
  BSTAR: 0.0001,
  MEAN_MOTION_DOT: 0,
  MEAN_MOTION_DDOT: 0,
});
const sup = (norad: number, epoch: string, rms = 0.4): SupGpRecord => ({
  ...gp(norad, epoch),
  OBJECT_NAME: `OPERATOR NAME ${norad}`,
  MEAN_MOTION: 15.6,
  RMS: rms,
  DATA_SOURCE: 'operator',
});

describe('supplemental GP merge', () => {
  it('uses a fresh operator fit, keeping the GP name and marking the source', () => {
    const { omm, used } = mergeSupplemental(
      [gp(1, '2026-09-20T00:00:00'), gp(2, '2026-10-04T00:00:00')],
      new Map([['ses', [sup(1, '2026-10-05T00:00:00')]]]),
      NOW,
    );
    expect(omm[0]).toMatchObject({ OBJECT_NAME: 'GP 1', MEAN_MOTION: 15.6, SOURCE: 'ses', RMS: 0.4 });
    expect(omm[0]?.EPOCH).toBe('2026-10-05T00:00:00');
    expect(omm[1]).toEqual(gp(2, '2026-10-04T00:00:00'));
    expect(used).toEqual({ ses: 1 });
  });

  it('accepts predictions a few days ahead (GPS almanac), not stale or far-future fits, nor fits older than GP', () => {
    const { omm, used } = mergeSupplemental(
      [
        gp(1, '2026-09-20T00:00:00'),
        gp(2, '2026-09-20T00:00:00'),
        gp(3, '2026-09-20T00:00:00'),
        gp(4, '2026-10-05T06:00:00'),
      ],
      new Map([
        [
          'gps',
          [
            sup(1, '2026-10-07T16:44:30'),
            sup(2, '2026-09-30T00:00:00'),
            sup(3, '2026-10-20T00:00:00'),
            sup(4, '2026-10-05T00:00:00'),
          ],
        ],
      ]),
      NOW,
    );
    expect(omm.map((o) => o.SOURCE)).toEqual(['gps', undefined, undefined, undefined]);
    expect(used).toEqual({ gps: 1 });
  });

  it('takes the freshest of several sets and never adds objects missing from the GP data', () => {
    const { omm, used } = mergeSupplemental(
      [gp(1, '2026-10-01T00:00:00')],
      new Map([
        ['a', [sup(1, '2026-10-04T00:00:00'), sup(99, '2026-10-05T00:00:00')]],
        ['b', [sup(1, '2026-10-05T00:00:00')]],
      ]),
      NOW,
    );
    expect(omm).toHaveLength(1);
    expect(omm[0]?.SOURCE).toBe('b');
    expect(used).toEqual({ a: 0, b: 1 });
  });
});

describe('supplemental GP catalog and audit', () => {
  const operators = OperatorsCatalogSchema.parse(JSON.parse(readFileSync('catalog/operators.json', 'utf8')));

  it('flags sets on the index page that are neither merged nor ignored', () => {
    const html =
      '<a href="sup-gp.php?FILE=starlink&FORMAT=csv">x</a><a href="sup-gp.php?FILE=cpf&FORMAT=tle">' +
      '<a href="sup-gp.php?FILE=transporter-19&FORMAT=csv">';
    const files = parseSupGpFiles(html);
    expect(files).toEqual(['cpf', 'starlink', 'transporter-19']);
    expect(checkSupGpSets(files, operators).map((i) => i.key)).toEqual(['transporter-19']);
  });

  it('guards the supplemental sets like other sourced entries', () => {
    const OPS = 'catalog/operators.json';
    const opsBase = readFileSync(OPS, 'utf8');
    const removed = JSON.parse(opsBase) as { supplemental: Record<string, unknown> };
    delete removed.supplemental['ses'];
    expect(
      checkChanges([{ path: OPS, base: opsBase, head: JSON.stringify(removed) }], '2026-10-05').join(),
    ).toContain('entry "sup:ses" was deleted');
    const unsourced = JSON.parse(opsBase) as {
      verified: string;
      supplemental: Record<string, { sources: string[] }>;
    };
    unsourced.verified = '2026-10-06';
    const ses = unsourced.supplemental['ses'];
    if (!ses) throw new Error('no ses set');
    ses.sources = ['http://example.com/'];
    expect(
      checkChanges([{ path: OPS, base: opsBase, head: JSON.stringify(unsourced) }], '2026-10-06').join(),
    ).toContain('entry "sup:ses" needs at least one https source');
  });
});
