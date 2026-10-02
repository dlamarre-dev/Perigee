/**
 * Weekly maintenance audit (CLAUDE.md §8, §13): finds what the curated catalog is missing or what needs
 * re-checking, and writes `audit.json` + `audit.md` next to the published data. It never edits `catalog/`;
 * the weekly maintenance agent (docs/maintenance-agent.md) works from its report.
 *
 * Network: a few polite requests per week (CelesTrak index page, this year's SATCAT launches, IERS leap-second
 * file, one Horizons lookup per deep-space candidate). Everything else comes from already-published data.
 */
import type {
  LaunchSites,
  Manifest,
  Mission,
  Moon,
  OperatorsCatalog,
  SatcatRecord,
} from '../src/data/schemas';

export type AuditKind =
  | 'launch-site-code'
  | 'owner-code'
  | 'celestrak-group'
  | 'deep-space-candidate'
  | 'ephemeris-ending'
  | 'ephemeris-ended-active'
  | 'stale-verification'
  | 'moon-anchor'
  | 'leap-second';

export interface AuditItem {
  readonly kind: AuditKind;
  /** Stable identifier of the item (code, group, NORAD number, mission id…). */
  readonly key: string;
  readonly summary: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface AuditReport {
  readonly generatedAt: string;
  readonly items: readonly AuditItem[];
}

const DAY_MS = 86_400_000;
/**
 * Missions are re-verified monthly: due after STALE_AFTER_DAYS, at most MAX_STALE_PER_AUDIT per weekly audit
 * (oldest first), so the agent's budget and the catalog-guard limit hold even when many dates coincide; an
 * entry waits at most a week or two once due. Catalog files (sites, operators, moons) every FILE_STALE_AFTER_DAYS.
 */
export const STALE_AFTER_DAYS = 21;
export const MAX_STALE_PER_AUDIT = 15;
export const FILE_STALE_AFTER_DAYS = 180;
export const COVERAGE_WARNING_DAYS = 30;
/** Mean-element moons drift by a few degrees a year from their anchoring epoch (tools/moons/anchor.ts). */
export const MOON_ANCHOR_MAX_DAYS = 365;

function examples(records: readonly SatcatRecord[], n = 3): string[] {
  return records.slice(0, n).map((r) => `${r.OBJECT_NAME} (${r.NORAD_CAT_ID})`);
}

/** SATCAT LAUNCH_SITE codes neither placed on the globe nor deliberately unplaced. */
export function checkLaunchSiteCodes(satcat: readonly SatcatRecord[], sites: LaunchSites): AuditItem[] {
  const known = new Set([
    ...sites.sites.flatMap((s) => s.satcatCodes),
    ...sites.unplacedSatcatCodes.map((u) => u.code),
  ]);
  const byCode = new Map<string, SatcatRecord[]>();
  for (const r of satcat) {
    const code = r.LAUNCH_SITE;
    if (!code || known.has(code)) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), r]);
  }
  return [...byCode].map(([code, records]) => ({
    kind: 'launch-site-code' as const,
    key: code,
    summary: `SATCAT launch site code ${code} (${records.length} active objects) is not in catalog/launch-sites.json`,
    details: { count: records.length, examples: examples(records) },
  }));
}

/** SATCAT OWNER codes without a label in catalog/operators.json. */
export function checkOwnerCodes(satcat: readonly SatcatRecord[], operators: OperatorsCatalog): AuditItem[] {
  const byOwner = new Map<string, SatcatRecord[]>();
  for (const r of satcat) {
    if (r.OWNER in operators.owners) continue;
    byOwner.set(r.OWNER, [...(byOwner.get(r.OWNER) ?? []), r]);
  }
  return [...byOwner].map(([owner, records]) => ({
    kind: 'owner-code' as const,
    key: owner,
    summary: `SATCAT owner code ${owner} (${records.length} active objects) has no label in catalog/operators.json`,
    details: { count: records.length, examples: examples(records) },
  }));
}

/** GP group names linked from the CelesTrak index page (`gp.php?GROUP=<name>`). */
export function parseCelestrakGroups(indexHtml: string): string[] {
  return [...new Set([...indexHtml.matchAll(/gp\.php\?GROUP=([A-Za-z0-9._-]+)/g)].map((m) => m[1] ?? ''))]
    .filter(Boolean)
    .sort();
}

/** Groups on the index page that are neither fetched nor deliberately ignored (new constellations…). */
export function checkCelestrakGroups(
  indexGroups: readonly string[],
  operators: OperatorsCatalog,
): AuditItem[] {
  const known = new Set([...Object.keys(operators.groups), ...operators.ignoredGroups.map((g) => g.group)]);
  return indexGroups
    .filter((g) => !known.has(g))
    .map((g) => ({
      kind: 'celestrak-group' as const,
      key: g,
      summary: `New CelesTrak group "${g}": add it to operators.json groups (constellation) or ignoredGroups`,
      details: { url: `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=JSON` },
    }));
}

/** Raw SATCAT row as returned by records.php (more fields than SatcatRecord). */
export interface SatcatLaunchRow {
  readonly NORAD_CAT_ID: number | string;
  readonly OBJECT_NAME: string;
  readonly OBJECT_ID: string;
  readonly OBJECT_TYPE: string;
  readonly OWNER: string;
  readonly LAUNCH_DATE: string | null;
  readonly ORBIT_CENTER?: string | null;
  readonly DECAY_DATE?: string | null;
}

/** Payloads launched this year that left Earth orbit (still flying) and are not in catalog/missions.json. */
export function deepSpaceCandidates(
  launches: readonly SatcatLaunchRow[],
  missions: readonly Mission[],
): SatcatLaunchRow[] {
  const listed = new Set(missions.map((m) => m.norad).filter((n): n is number => n !== undefined));
  return launches.filter(
    (r) =>
      r.OBJECT_TYPE === 'PAY' &&
      // Orbit centre codes are letters (EA Earth, SU Sun, EM Earth-Moon, MO, MA…); a NORAD number means
      // docked to that object (ISS, Tiangong).
      /^[A-Z]+$/.test(r.ORBIT_CENTER ?? '') &&
      r.ORBIT_CENTER !== 'EA' &&
      !r.DECAY_DATE &&
      !listed.has(Number(r.NORAD_CAT_ID)),
  );
}

export function candidateItems(
  candidates: readonly SatcatLaunchRow[],
  horizons: ReadonlyMap<string, readonly { name: string; spkid: string }[]>,
): AuditItem[] {
  return candidates.map((r) => ({
    kind: 'deep-space-candidate' as const,
    key: String(r.NORAD_CAT_ID),
    summary: `${r.OBJECT_NAME} (${r.OBJECT_ID}, launched ${r.LAUNCH_DATE ?? '?'}, orbit centre ${r.ORBIT_CENTER}) is not in catalog/missions.json`,
    details: {
      owner: r.OWNER,
      horizonsMatches: horizons.get(String(r.NORAD_CAT_ID)) ?? [],
    },
  }));
}

/** Public ephemerides ending soon, or already ended while the mission is still listed as active. */
export function checkEphemerisCoverage(
  manifest: Manifest,
  missions: readonly Mission[],
  now: Date,
): AuditItem[] {
  const items: AuditItem[] = [];
  for (const m of missions) {
    const end = manifest.ephemerides[m.id]?.coverageEnd;
    if (!end) continue;
    const endMs = Date.parse(end);
    if (endMs < now.getTime() && (m.status === 'active' || m.status === 'cruise')) {
      items.push({
        kind: 'ephemeris-ended-active',
        key: m.id,
        summary: `${m.name.en}: public Horizons ephemeris ended ${end.slice(0, 10)} but status is "${m.status}" — check whether the mission ended or the ephemeris is just late`,
        details: { horizonsId: m.horizonsId, coverageEnd: end },
      });
    } else if (endMs >= now.getTime() && endMs - now.getTime() < COVERAGE_WARNING_DAYS * DAY_MS) {
      items.push({
        kind: 'ephemeris-ending',
        key: m.id,
        summary: `${m.name.en}: public Horizons ephemeris ends ${end.slice(0, 10)} (within ${COVERAGE_WARNING_DAYS} days)`,
        details: { horizonsId: m.horizonsId, coverageEnd: end },
      });
    }
  }
  return items;
}

/** Missions due for re-verification (oldest first, capped) and catalog files older than FILE_STALE_AFTER_DAYS. */
export function checkStaleVerification(
  files: readonly { path: string; verified: string }[],
  missions: readonly Mission[],
  now: Date,
): AuditItem[] {
  const age = (iso: string): number => Math.floor((now.getTime() - Date.parse(`${iso}T00:00:00Z`)) / DAY_MS);
  const items: AuditItem[] = [];
  const due = missions
    .filter((m) => m.status !== 'ended' && age(m.verified) > STALE_AFTER_DAYS)
    .sort((a, b) => a.verified.localeCompare(b.verified) || a.id.localeCompare(b.id));
  for (const m of due.slice(0, MAX_STALE_PER_AUDIT)) {
    const days = age(m.verified);
    items.push({
      kind: 'stale-verification',
      key: `mission:${m.id}`,
      summary: `${m.name.en} (${m.centralBody}, ${m.status}): last verified ${m.verified} (${days} days ago)`,
      details: { verified: m.verified },
    });
  }
  if (due.length > MAX_STALE_PER_AUDIT) {
    items.push({
      kind: 'stale-verification',
      key: 'missions:deferred',
      summary: `${due.length - MAX_STALE_PER_AUDIT} more missions are due and deferred to next week (at most ${MAX_STALE_PER_AUDIT} per audit)`,
      details: { deferred: due.slice(MAX_STALE_PER_AUDIT).map((m) => m.id) },
    });
  }
  for (const f of files) {
    const days = age(f.verified);
    if (days > FILE_STALE_AFTER_DAYS) {
      items.push({
        kind: 'stale-verification',
        key: `file:${f.path}`,
        summary: `${f.path}: last verified ${f.verified} (${days} days ago)`,
        details: { verified: f.verified },
      });
    }
  }
  return items;
}

/** Mean-element moons whose anchoring epoch is older than MOON_ANCHOR_MAX_DAYS. */
export function checkMoonAnchors(moons: readonly Moon[], now: Date): AuditItem[] {
  const nowJd = now.getTime() / DAY_MS + 2440587.5;
  const old = moons.filter((m) => m.elements && nowJd - m.elements.epochJdTdb > MOON_ANCHOR_MAX_DAYS);
  if (old.length === 0) return [];
  return [
    {
      kind: 'moon-anchor',
      key: 'catalog/moons.json',
      summary: `${old.length} moons were anchored more than ${MOON_ANCHOR_MAX_DAYS} days ago (${old.map((m) => m.id).join(', ')}): run npm run moons:anchor`,
      details: { moons: old.map((m) => m.id) },
    },
  ];
}

/** IERS Leap_Second.dat: last TAI − UTC step and the file's expiry date. */
export function parseIersLeapSeconds(text: string): {
  lastUnixMs: number;
  taiMinusUtcS: number;
  expires?: string;
} {
  let last: { lastUnixMs: number; taiMinusUtcS: number } | undefined;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\d+\.\d+\s+(\d{1,2})\s+(\d{1,2})\s+(\d{4})\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    last = { lastUnixMs: Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])), taiMinusUtcS: Number(m[4]) };
  }
  if (!last) throw new Error('No leap-second entries in the IERS file');
  const exp = /File expires on\s+(\d{1,2} \w+ \d{4})/.exec(text)?.[1];
  return { ...last, ...(exp ? { expires: exp } : {}) };
}

export function checkLeapSeconds(
  iers: { lastUnixMs: number; taiMinusUtcS: number; expires?: string },
  table: { effectiveUnixMs: number; taiMinusUtcS: number },
  now: Date,
): AuditItem[] {
  const items: AuditItem[] = [];
  if (iers.taiMinusUtcS !== table.taiMinusUtcS || iers.lastUnixMs !== table.effectiveUnixMs) {
    items.push({
      kind: 'leap-second',
      key: `tai-utc-${iers.taiMinusUtcS}`,
      summary: `IERS announces TAI − UTC = ${iers.taiMinusUtcS} s from ${new Date(iers.lastUnixMs).toISOString().slice(0, 10)}; src/astro/leapSeconds.ts ends at ${table.taiMinusUtcS} s`,
      details: { source: 'https://hpiers.obspm.fr/iers/bul/bulc/Leap_Second.dat' },
    });
  }
  if (iers.expires && Date.parse(iers.expires) < now.getTime()) {
    items.push({
      kind: 'leap-second',
      key: 'expired',
      summary: `The IERS leap-second file expired on ${iers.expires}: check that IERS is still publishing it`,
    });
  }
  return items;
}

const TITLES: Record<AuditKind, string> = {
  'launch-site-code': 'Launch site codes not in catalog/launch-sites.json',
  'owner-code': 'SATCAT owner codes without a label',
  'celestrak-group': 'New CelesTrak groups',
  'deep-space-candidate': 'Deep-space payloads not in catalog/missions.json',
  'ephemeris-ended-active': 'Ephemerides ended while the mission is listed as active',
  'ephemeris-ending': 'Public ephemerides ending within 30 days',
  'stale-verification': 'Entries due for re-verification',
  'moon-anchor': 'Moon mean elements due for re-anchoring',
  'leap-second': 'Leap seconds',
};

export function renderMarkdown(report: AuditReport): string {
  const lines = [`Maintenance audit, ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC.`, ''];
  if (report.items.length === 0) return `${lines[0]}\n\nNothing to do.\n`;
  for (const kind of Object.keys(TITLES) as AuditKind[]) {
    const items = report.items.filter((i) => i.kind === kind);
    if (items.length === 0) continue;
    lines.push(`### ${TITLES[kind]} (${items.length})`, '');
    for (const i of items) lines.push(`- [ ] ${i.summary}`);
    lines.push('');
  }
  lines.push('Machine-readable version: `data/audit.json` on the `data` branch.');
  return `${lines.join('\n')}\n`;
}
