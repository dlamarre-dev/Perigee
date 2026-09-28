/**
 * Guardrails for pull requests opened by the weekly maintenance agent (branches `maintenance/*`), enforced in
 * CI before auto-merge (CLAUDE.md §8, docs/maintenance-agent.md):
 * - only curated files may change (catalog/**, CLAUDE.md, src/astro/leapSeconds.ts);
 * - every catalog file still validates against its schema;
 * - no entry is deleted (an ended mission changes status instead);
 * - every added or changed entry cites https sources and carries a `verified` date that did not go back in
 *   time and is not in the future;
 * - at most MAX_CHANGED_ENTRIES entries change per pull request.
 *
 *   tsx pipeline/catalog-guard.ts <base-ref>
 */
import { execFileSync } from 'node:child_process';
import type { z } from 'zod';
import {
  LandingSitesSchema,
  LaunchSitesSchema,
  MissionsCatalogSchema,
  OperatorsCatalogSchema,
} from '../src/data/schemas';

export const ALLOWED_PATHS: readonly RegExp[] = [
  /^catalog\/.+\.json$/,
  /^CLAUDE\.md$/,
  /^src\/astro\/leapSeconds\.ts$/,
];
export const MAX_CHANGED_ENTRIES = 40;

export interface ChangedFile {
  readonly path: string;
  /** Contents at the base commit (undefined for a new file). */
  readonly base?: string;
  /** Contents at the head commit (undefined for a deleted file). */
  readonly head?: string;
}

interface EntryList {
  readonly schema: z.ZodType;
  /** Entries keyed by id, from a parsed file. */
  readonly entries: (parsed: unknown) => Map<string, Record<string, unknown>>;
}

const byId = (list: readonly { id: string }[]): Map<string, Record<string, unknown>> =>
  new Map(list.map((e) => [e.id, e as unknown as Record<string, unknown>]));

const CATALOGS: Readonly<Record<string, EntryList>> = {
  'catalog/missions.json': {
    schema: MissionsCatalogSchema,
    entries: (p) => byId((p as z.infer<typeof MissionsCatalogSchema>).missions),
  },
  'catalog/launch-sites.json': {
    schema: LaunchSitesSchema,
    entries: (p) => byId((p as z.infer<typeof LaunchSitesSchema>).sites),
  },
  'catalog/landing-sites/moon.json': {
    schema: LandingSitesSchema,
    entries: (p) => byId((p as z.infer<typeof LandingSitesSchema>).sites),
  },
  'catalog/landing-sites/mars.json': {
    schema: LandingSitesSchema,
    entries: (p) => byId((p as z.infer<typeof LandingSitesSchema>).sites),
  },
  'catalog/operators.json': {
    schema: OperatorsCatalogSchema,
    entries: (p) => {
      const o = p as z.infer<typeof OperatorsCatalogSchema>;
      const m = new Map<string, Record<string, unknown>>();
      for (const [k, v] of Object.entries(o.owners)) m.set(`owner:${k}`, v);
      for (const [k, v] of Object.entries(o.operators)) m.set(`operator:${k}`, v);
      for (const [k, v] of Object.entries(o.groups)) m.set(`group:${k}`, v);
      for (const r of o.nameRules) m.set(`rule:${r.operator}:${r.pattern}`, r);
      for (const p of o.hostedPayloads) m.set(`hosted:${p.norad}:${p.operator}`, p);
      return m;
    },
  },
};

const httpsSources = (e: Record<string, unknown>): boolean =>
  Array.isArray(e['sources']) &&
  e['sources'].length > 0 &&
  e['sources'].every((u) => typeof u === 'string' && u.startsWith('https://'));

export function checkChanges(files: readonly ChangedFile[], today: string): string[] {
  const errors: string[] = [];
  let changed = 0;
  for (const f of files) {
    if (!ALLOWED_PATHS.some((re) => re.test(f.path))) {
      errors.push(`${f.path}: the maintenance agent may not change this file`);
      continue;
    }
    const catalog = CATALOGS[f.path];
    if (!catalog) continue;
    if (f.head === undefined) {
      errors.push(`${f.path}: catalog files may not be deleted`);
      continue;
    }
    let head: unknown;
    try {
      head = catalog.schema.parse(JSON.parse(f.head));
    } catch (err) {
      errors.push(`${f.path}: invalid (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`);
      continue;
    }
    // Parsed like the head (schema defaults applied), so only real edits count as changes.
    const baseRaw = f.base === undefined ? undefined : (JSON.parse(f.base) as unknown);
    const baseParsed = baseRaw === undefined ? undefined : catalog.schema.safeParse(baseRaw);
    const base = baseParsed?.success ? baseParsed.data : baseRaw;
    const headEntries = catalog.entries(head);
    const baseEntries = base === undefined ? new Map() : catalog.entries(base);
    for (const id of baseEntries.keys()) {
      if (!headEntries.has(id))
        errors.push(`${f.path}: entry "${id}" was deleted (change its status instead)`);
    }
    for (const [id, entry] of headEntries) {
      const before = baseEntries.get(id);
      if (before && JSON.stringify(before) === JSON.stringify(entry)) continue;
      changed++;
      // Owner, operator and group labels carry no per-entry sources (the file's sources cover them); name rules
      // and hosted payloads do.
      const labelOnly = f.path === 'catalog/operators.json' && !/^(rule|hosted):/.test(id);
      if (!labelOnly && !httpsSources(entry)) {
        errors.push(`${f.path}: entry "${id}" needs at least one https source`);
      }
      const verified = entry['verified'];
      if (typeof verified === 'string') {
        if (verified > today) errors.push(`${f.path}: entry "${id}" has a future verified date ${verified}`);
        const prev = before?.['verified'];
        if (typeof prev === 'string' && verified < prev) {
          errors.push(`${f.path}: entry "${id}" verified date went back from ${prev} to ${verified}`);
        } else if (typeof prev === 'string' && verified === prev) {
          errors.push(`${f.path}: entry "${id}" changed without a new verified date`);
        }
      }
    }
    const fileVerified = (head as { verified?: string }).verified;
    if (fileVerified && fileVerified > today) errors.push(`${f.path}: future verified date ${fileVerified}`);
  }
  if (changed > MAX_CHANGED_ENTRIES) {
    errors.push(`${changed} entries changed: more than ${MAX_CHANGED_ENTRIES} in one maintenance PR`);
  }
  return errors;
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function show(ref: string, path: string): string | undefined {
  try {
    return git(['show', `${ref}:${path}`]);
  } catch {
    return undefined;
  }
}

function main(): void {
  const baseRef = process.argv[2];
  if (!baseRef) throw new Error('Usage: tsx pipeline/catalog-guard.ts <base-ref>');
  const mergeBase = git(['merge-base', baseRef, 'HEAD']).trim();
  const paths = git(['diff', '--name-only', mergeBase, 'HEAD']).split('\n').filter(Boolean);
  const files = paths.map((path) => {
    const base = show(mergeBase, path);
    const head = show('HEAD', path);
    return { path, ...(base !== undefined ? { base } : {}), ...(head !== undefined ? { head } : {}) };
  });
  const errors = checkChanges(files, new Date().toISOString().slice(0, 10));
  for (const e of errors) console.error(`✗ ${e}`);
  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${files.length} files checked`);
}

if (process.argv[1]?.endsWith('catalog-guard.ts')) main();
