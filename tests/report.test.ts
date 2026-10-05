import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/ui/ReportDialog';

const ctx = {
  url: 'https://x.test/?view=moon',
  build: 'abc (2026-10-03)',
  lang: 'fr',
  viewport: '1400×850 @1x',
  quality: 'quality high (auto: desktop-class GPU), render ×1, GPU test',
};

describe('report payload', () => {
  it('carries the type, the trimmed message, the context and the access key', () => {
    const p = buildReport('data', '  LRO is shown at the wrong place\nmore details  ', '', ctx);
    expect(p['type']).toBe('data');
    expect(p['message']).toBe('LRO is shown at the wrong place\nmore details');
    expect(p['subject']).toBe('[Perigee] data: LRO is shown at the wrong place');
    expect(p['page']).toBe(ctx.url);
    expect(typeof p['access_key']).toBe('string');
    expect(p['botcheck']).toBe(false);
  });

  it('includes the e-mail only when given, and flags the honeypot', () => {
    expect('email' in buildReport('bug', 'something broke here', '   ', ctx)).toBe(false);
    expect(buildReport('bug', 'something broke here', ' a@b.ca ', ctx)['email']).toBe('a@b.ca');
    expect(buildReport('bug', 'something broke here', '', ctx, 'on')['botcheck']).toBe(true);
  });
});
