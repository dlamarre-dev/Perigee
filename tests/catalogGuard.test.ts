import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkChanges, MAX_CHANGED_ENTRIES } from '../pipeline/catalog-guard';

const MISSIONS = 'catalog/missions.json';
const base = readFileSync(MISSIONS, 'utf8');
const TODAY = '2026-09-28';

type Catalog = { verified: string; missions: Record<string, unknown>[] };
const edit = (fn: (c: Catalog) => void): string => {
  const c = JSON.parse(base) as Catalog;
  fn(c);
  return JSON.stringify(c, null, 2);
};

describe('catalog guard (maintenance PRs)', () => {
  it('accepts a sourced status change with a new verified date', () => {
    const head = edit((c) => {
      const m = c.missions[0];
      if (!m) throw new Error('empty catalog');
      m['status'] = 'ended';
      m['verified'] = TODAY;
      m['sources'] = [...(m['sources'] as string[]), 'https://www.nasa.gov/news/'];
    });
    expect(checkChanges([{ path: MISSIONS, base, head }], TODAY)).toEqual([]);
  });

  it('rejects files outside the curated set', () => {
    expect(checkChanges([{ path: 'src/app/main.ts', base: 'a', head: 'b' }], TODAY)[0]).toContain(
      'may not change',
    );
  });

  it('rejects deleted entries and changes without a new verified date', () => {
    const deleted = edit((c) => void c.missions.shift());
    expect(checkChanges([{ path: MISSIONS, base, head: deleted }], TODAY).join()).toContain('was deleted');
    const stale = edit((c) => {
      const m = c.missions[0];
      if (m) m['status'] = 'ended';
    });
    expect(checkChanges([{ path: MISSIONS, base, head: stale }], TODAY).join()).toContain(
      'without a new verified',
    );
  });

  it('rejects unsourced or non-https entries and future dates', () => {
    const insecure = edit((c) => {
      const m = c.missions[0];
      if (!m) return;
      m['sources'] = ['http://example.org/'];
      m['verified'] = TODAY;
    });
    expect(checkChanges([{ path: MISSIONS, base, head: insecure }], TODAY).join()).toContain('https source');
    const future = edit((c) => {
      const m = c.missions[0];
      if (m) m['verified'] = '2099-01-01';
    });
    expect(checkChanges([{ path: MISSIONS, base, head: future }], TODAY).join()).toContain('future verified');
  });

  it('rejects invalid files and oversized changes', () => {
    expect(checkChanges([{ path: MISSIONS, base, head: '{"verified":"x"}' }], TODAY).join()).toContain(
      'invalid',
    );
    const many = edit((c) => {
      c.missions.slice(0, MAX_CHANGED_ENTRIES + 1).forEach((m) => {
        m['verified'] = TODAY;
        m['notes'] = { en: 'checked', fr: 'vérifié' };
      });
    });
    const errors = checkChanges([{ path: MISSIONS, base, head: many }], TODAY);
    expect(errors.join()).toContain(`more than ${MAX_CHANGED_ENTRIES}`);
  });

  it('rejects unknown catalog files (renames show as a deletion plus an addition)', () => {
    const renamed = checkChanges(
      [
        { path: MISSIONS, base },
        { path: 'catalog/missions-old.json', head: base },
      ],
      TODAY,
    ).join();
    expect(renamed).toContain('may not be deleted');
    expect(renamed).toContain('unknown catalog file');
  });

  it('treats an edited name-rule pattern as a change, and keeps undated changes under the file date', () => {
    const OPS = 'catalog/operators.json';
    const opsBase = readFileSync(OPS, 'utf8');
    const ops = JSON.parse(opsBase) as { verified: string; nameRules: { pattern: string }[] };
    const rule = ops.nameRules[0];
    if (!rule) throw new Error('no name rule');
    rule.pattern = `${rule.pattern}|EXTRA`;
    const later = '2026-12-01';
    const sameDate = checkChanges([{ path: OPS, base: opsBase, head: JSON.stringify(ops) }], later).join();
    expect(sameDate).not.toContain('deleted');
    expect(sameDate).toContain('without a new file verified date');
    ops.verified = later;
    expect(checkChanges([{ path: OPS, base: opsBase, head: JSON.stringify(ops) }], later)).toEqual([]);
  });

  it('requires new entries to be verified recently', () => {
    const head = edit((c) => {
      const copy = { ...(c.missions[0] ?? {}), id: 'new-probe', verified: '2025-01-01' };
      c.missions.push(copy);
    });
    expect(checkChanges([{ path: MISSIONS, base, head }], TODAY).join()).toContain('verified recently');
  });
});
