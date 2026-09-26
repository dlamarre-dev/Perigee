/**
 * Writes deterministic fixture data into dist/data for the Playwright run, using the pipeline's own
 * publishing code. Never touches the network.
 */
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { publishDatasets } from '../../pipeline/publish';
import { OmmListSchema, type SatcatRecord } from '../../src/data/schemas';

const dataDir = resolve('dist/data');
const omms = OmmListSchema.parse(JSON.parse(readFileSync(resolve('tests/fixtures/omm-sample.json'), 'utf8')));
const satcat: SatcatRecord[] = [
  {
    NORAD_CAT_ID: 25544,
    OBJECT_NAME: 'ISS (ZARYA)',
    OBJECT_ID: '1998-067A',
    OBJECT_TYPE: 'PAY',
    OPS_STATUS_CODE: '+',
    OWNER: 'ISS',
    LAUNCH_DATE: '1998-11-20',
    LAUNCH_SITE: 'TYMSC',
    PERIOD: 92.9,
    INCLINATION: 51.6,
    APOGEE: 425,
    PERIGEE: 416,
    RCS: null,
  },
];
const fetchedAt = new Date('2026-09-26T12:00:00Z');

await rm(dataDir, { recursive: true, force: true });
await publishDatasets(dataDir, [
  {
    key: 'earth.gp',
    path: 'earth/gp-active.json.gz',
    source: 'fixture',
    fetchedAt,
    count: omms.length,
    payload: omms,
  },
  {
    key: 'earth.satcat',
    path: 'earth/satcat.json.gz',
    source: 'fixture',
    fetchedAt,
    count: 1,
    payload: satcat,
  },
  {
    key: 'earth.groups',
    path: 'earth/groups.json.gz',
    source: 'fixture',
    fetchedAt,
    count: 1,
    payload: { stations: [25544] },
  },
]);
