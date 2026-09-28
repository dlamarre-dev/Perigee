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
});
