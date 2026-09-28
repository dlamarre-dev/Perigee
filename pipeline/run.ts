/**
 * Pipeline entry point.
 *
 *   tsx pipeline/run.ts gp      [--data-dir <dir>]   # GP "active" elements (every 4 h in CI)
 *   tsx pipeline/run.ts satcat  [--data-dir <dir>]   # SATCAT + group membership (daily in CI)
 *   tsx pipeline/run.ts horizons [--data-dir <dir>]  # JPL Horizons vectors for catalog/missions.json (daily)
 *   tsx pipeline/run.ts rovers  [--data-dir <dir>]   # Mars rover positions from NASA MMGIS feeds (daily)
 *   tsx pipeline/run.ts audit   [--data-dir <dir>]   # weekly maintenance audit → audit.json + audit.md
 *
 * The data directory holds the currently published files and is updated in place.
 * Outside CI a local guard refuses to hit CelesTrak twice for the same resource within 2 h.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { LATEST_LEAP_SECOND } from '../src/astro/leapSeconds';
import {
  LandingSitesSchema,
  LaunchSitesSchema,
  MissionsCatalogSchema,
  OperatorsCatalogSchema,
  SatcatListSchema,
  type Groups,
} from '../src/data/schemas';
import {
  candidateItems,
  checkCelestrakGroups,
  checkEphemerisCoverage,
  checkLaunchSiteCodes,
  checkLeapSeconds,
  checkOwnerCodes,
  checkStaleVerification,
  deepSpaceCandidates,
  parseCelestrakGroups,
  parseIersLeapSeconds,
  renderMarkdown,
  type AuditItem,
  type SatcatLaunchRow,
} from './audit';
import { politeGet } from './http';
import { readManifest } from './publish';
import { NotUpdatedError, SATCAT_URL, fetchGp, fetchSatcatActive, gpUrl } from './celestrak';
import { CENTER_CODES, fetchMissionVectors, float64LittleEndian } from './horizons';
import { publishDatasets, publishEphemerides, type EphemerisToWrite } from './publish';
import { fetchRoverPositions } from './rovers';

const LOCAL_MIN_INTERVAL_MS = 2 * 3600_000;
const LOCAL_LOG = resolve('node_modules/.cache/perigee/fetch-log.json');

/** Local-only rate guard: checks every URL up front, then logs each one right before it is requested. */
class LocalFetchGuard {
  private constructor(
    private readonly log: Record<string, string>,
    private readonly enabled: boolean,
  ) {}

  static async load(): Promise<LocalFetchGuard> {
    const enabled = !process.env['CI'];
    const log = enabled && existsSync(LOCAL_LOG) ? JSON.parse(await readFile(LOCAL_LOG, 'utf8')) : {};
    return new LocalFetchGuard(log, enabled);
  }

  assertAllowed(urls: readonly string[]): void {
    if (!this.enabled) return;
    const now = Date.now();
    for (const url of urls) {
      const last = this.log[url];
      const elapsed = last ? now - Date.parse(last) : Infinity;
      if (elapsed < LOCAL_MIN_INTERVAL_MS) {
        const waitMin = Math.ceil((LOCAL_MIN_INTERVAL_MS - elapsed) / 60_000);
        throw new Error(
          `Refusing to re-fetch ${url} (last fetch ${last}); wait ${waitMin} min or use data:pull.`,
        );
      }
    }
  }

  async mark(url: string): Promise<void> {
    if (!this.enabled) return;
    this.log[url] = new Date().toISOString();
    await mkdir(dirname(LOCAL_LOG), { recursive: true });
    await writeFile(LOCAL_LOG, JSON.stringify(this.log, null, 2));
  }
}

async function loadOperators() {
  return OperatorsCatalogSchema.parse(JSON.parse(await readFile(resolve('catalog/operators.json'), 'utf8')));
}

async function runGp(dataDir: string, guard: LocalFetchGuard): Promise<void> {
  const url = gpUrl('active');
  guard.assertAllowed([url]);
  const fetchedAt = new Date();
  await guard.mark(url);
  const { records: omm, rejected } = await fetchGp('active');
  if (rejected > 0) console.warn(`GP: ${rejected} malformed records dropped`);
  await publishDatasets(dataDir, [
    {
      key: 'earth.gp',
      path: 'earth/gp-active.json.gz',
      source: url,
      fetchedAt,
      count: omm.length,
      payload: omm,
    },
  ]);
}

async function runSatcat(dataDir: string, guard: LocalFetchGuard): Promise<void> {
  const operators = await loadOperators();
  const groupNames = Object.keys(operators.groups);
  guard.assertAllowed([SATCAT_URL, ...groupNames.map(gpUrl)]);

  const fetchedAt = new Date();
  await guard.mark(SATCAT_URL);
  const { records, rejected } = await fetchSatcatActive();
  if (rejected > 0) console.warn(`SATCAT: ${rejected} malformed rows dropped`);

  const unknownOwners = [...new Set(records.map((r) => r.OWNER))].filter((o) => !(o in operators.owners));
  if (unknownOwners.length > 0) {
    console.warn(
      `SATCAT owner codes missing from catalog/operators.json: ${unknownOwners.sort().join(', ')}`,
    );
  }

  // One request per group, sequentially; any non-200 aborts the whole run.
  const groups: Groups = {};
  for (const name of groupNames) {
    await guard.mark(gpUrl(name));
    try {
      groups[name] = (await fetchGp(name)).records.map((o) => o.NORAD_CAT_ID);
    } catch (err) {
      if (!(err instanceof NotUpdatedError)) throw err;
      console.warn(err.message);
    }
  }
  const groupMembers = Object.values(groups).reduce((n, ids) => n + ids.length, 0);

  await publishDatasets(dataDir, [
    {
      key: 'earth.satcat',
      path: 'earth/satcat.json.gz',
      source: SATCAT_URL,
      fetchedAt,
      count: records.length,
      payload: records,
    },
    {
      key: 'earth.groups',
      path: 'earth/groups.json.gz',
      source: gpUrl('<group>'),
      fetchedAt,
      count: groupMembers,
      payload: groups,
    },
  ]);
}

/**
 * One Horizons request per mission (a second one only when coverage ends inside the window).
 * Any HTTP failure aborts the run before anything is published.
 */
async function runHorizons(dataDir: string): Promise<void> {
  const catalog = MissionsCatalogSchema.parse(
    JSON.parse(await readFile(resolve('catalog/missions.json'), 'utf8')),
  );
  const now = new Date();
  const out: EphemerisToWrite[] = [];
  for (const mission of catalog.missions) {
    if (mission.ephemeris !== 'horizons' || !mission.horizonsId || !mission.sampling) continue;
    const { data, url, clamped } = await fetchMissionVectors(mission, now);
    if (clamped) {
      console.warn(
        `${mission.id}: Horizons coverage ends ${clamped.kind} ${clamped.date.toISOString()}; window moved`,
      );
    }
    out.push({
      missionId: mission.id,
      horizonsId: mission.horizonsId,
      center: CENTER_CODES[mission.centralBody],
      centralBody: mission.centralBody,
      stepMin: mission.sampling.stepMin,
      source: url,
      fetchedAt: now,
      rows: data,
      bytes: float64LittleEndian(data),
      ...(clamped?.kind === 'after' ? { coverageEnd: clamped.date } : {}),
    });
  }
  await publishEphemerides(dataDir, out);
}

/** One request per rover feed declared in catalog/landing-sites/*.json. */
async function runRovers(dataDir: string): Promise<void> {
  const mars = LandingSitesSchema.parse(
    JSON.parse(await readFile(resolve('catalog/landing-sites/mars.json'), 'utf8')),
  );
  const fetchedAt = new Date();
  const positions = await fetchRoverPositions([mars]);
  for (const [id, p] of Object.entries(positions)) {
    console.log(`${id}: sol ${p.sol}, ${p.latDeg.toFixed(5)}, ${p.lonDeg.toFixed(5)}`);
  }
  await publishDatasets(dataDir, [
    {
      key: 'mars.rovers',
      path: 'mars/rovers.json.gz',
      source: 'https://mars.nasa.gov/mmgis-maps/',
      fetchedAt,
      count: Object.keys(positions).length,
      payload: positions,
    },
  ]);
}

const CELESTRAK_INDEX_URL = 'https://celestrak.org/NORAD/elements/';
const IERS_LEAP_SECONDS_URL = 'https://hpiers.obspm.fr/iers/bul/bulc/Leap_Second.dat';
const satcatLaunchesUrl = (year: number): string =>
  `https://celestrak.org/satcat/records.php?INTDES=${year}&FORMAT=JSON`;
const horizonsLookupUrl = (cospar: string): string =>
  `https://ssd.jpl.nasa.gov/api/horizons_lookup.api?sstr=${encodeURIComponent(cospar)}&group=sct`;
/** Horizons lookups per run, at most (new deep-space payloads are rare). */
const MAX_HORIZONS_LOOKUPS = 8;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

/**
 * Weekly maintenance audit: compares the published data and a few upstream lists with the curated catalog.
 * Writes audit.json and audit.md into the data directory (published with the data branch). Never edits catalog/.
 */
async function runAudit(dataDir: string, guard: LocalFetchGuard): Promise<void> {
  const now = new Date();
  const operators = await loadOperators();
  const launchSites = LaunchSitesSchema.parse(await readJson('catalog/launch-sites.json'));
  const missionsCatalog = MissionsCatalogSchema.parse(await readJson('catalog/missions.json'));
  const moon = LandingSitesSchema.parse(await readJson('catalog/landing-sites/moon.json'));
  const mars = LandingSitesSchema.parse(await readJson('catalog/landing-sites/mars.json'));
  const manifest = await readManifest(dataDir);
  const satcat = SatcatListSchema.parse(
    JSON.parse(gunzipSync(await readFile(join(dataDir, 'earth/satcat.json.gz'))).toString('utf8')),
  );
  const missions = missionsCatalog.missions;

  // Upstream lists: one request each (CelesTrak ones go through the local 2 h guard too).
  const years =
    now.getUTCMonth() === 0 ? [now.getUTCFullYear() - 1, now.getUTCFullYear()] : [now.getUTCFullYear()];
  const celestrakUrls = [CELESTRAK_INDEX_URL, ...years.map(satcatLaunchesUrl)];
  guard.assertAllowed(celestrakUrls);
  await guard.mark(CELESTRAK_INDEX_URL);
  const indexGroups = parseCelestrakGroups(await politeGet(CELESTRAK_INDEX_URL, { accept: 'text/html' }));
  const launches: SatcatLaunchRow[] = [];
  for (const year of years) {
    const url = satcatLaunchesUrl(year);
    await guard.mark(url);
    launches.push(
      ...(JSON.parse(
        await politeGet(url, { accept: 'application/json', timeoutMs: 300_000 }),
      ) as SatcatLaunchRow[]),
    );
  }
  const iers = parseIersLeapSeconds(await politeGet(IERS_LEAP_SECONDS_URL, { accept: 'text/plain' }));

  const candidates = deepSpaceCandidates(launches, missions);
  const matches = new Map<string, { name: string; spkid: string }[]>();
  for (const c of candidates.slice(0, MAX_HORIZONS_LOOKUPS)) {
    const body = JSON.parse(
      await politeGet(horizonsLookupUrl(c.OBJECT_ID), { accept: 'application/json' }),
    ) as { result?: { name: string; spkid: string }[] };
    matches.set(
      String(c.NORAD_CAT_ID),
      (body.result ?? []).map((r) => ({ name: r.name, spkid: r.spkid })),
    );
  }

  const items: AuditItem[] = [
    ...checkLaunchSiteCodes(satcat, launchSites),
    ...checkOwnerCodes(satcat, operators),
    ...checkCelestrakGroups(indexGroups, operators),
    ...candidateItems(candidates, matches),
    ...checkEphemerisCoverage(manifest, missions, now),
    ...checkStaleVerification(
      [
        { path: 'catalog/launch-sites.json', verified: launchSites.verified },
        { path: 'catalog/operators.json', verified: operators.verified },
        { path: 'catalog/landing-sites/moon.json', verified: moon.verified },
        { path: 'catalog/landing-sites/mars.json', verified: mars.verified },
      ],
      missions,
      now,
    ),
    ...checkLeapSeconds(iers, LATEST_LEAP_SECOND, now),
  ];
  const report = { generatedAt: now.toISOString(), items };
  await writeFile(join(dataDir, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(dataDir, 'audit.md'), renderMarkdown(report));
  console.log(renderMarkdown(report));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const dirFlag = rest.indexOf('--data-dir');
  const dataDir = resolve(dirFlag >= 0 ? (rest[dirFlag + 1] ?? '') : 'public/data');
  await mkdir(join(dataDir, 'earth'), { recursive: true });
  const guard = await LocalFetchGuard.load();

  switch (command) {
    case 'gp':
      await runGp(dataDir, guard);
      break;
    case 'satcat':
      await runSatcat(dataDir, guard);
      break;
    case 'horizons':
      await runHorizons(dataDir);
      break;
    case 'rovers':
      await runRovers(dataDir);
      break;
    case 'audit':
      await runAudit(dataDir, guard);
      break;
    default:
      throw new Error('Usage: tsx pipeline/run.ts <gp|satcat|horizons|rovers|audit> [--data-dir <dir>]');
  }
}

main().catch((err: unknown) => {
  if (err instanceof NotUpdatedError) {
    // Not a failure: previously published data stays in place.
    console.log(err.message);
    return;
  }
  console.error(err);
  process.exitCode = 1;
});
