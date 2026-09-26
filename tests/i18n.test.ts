import { describe, expect, it } from 'vitest';
import { I18n, detectLang, en, fr } from '../src/i18n';

describe('i18n', () => {
  it('EN and FR tables have identical, non-empty keys', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const table of [en, fr]) {
      for (const value of Object.values(table)) expect(value.trim()).not.toBe('');
    }
  });

  it('detects the language from the URL first, then the browser', () => {
    expect(detectLang('en', ['fr-CA'])).toBe('en');
    expect(detectLang(null, ['fr-CA', 'en'])).toBe('fr');
    expect(detectLang('xx', ['de-DE'])).toBe('en');
    expect(detectLang(null, [])).toBe('en');
  });

  it('notifies listeners on language change', () => {
    const i18n = new I18n('en');
    const seen: string[] = [];
    i18n.onChange((l) => seen.push(l));
    i18n.setLang('fr');
    i18n.setLang('fr');
    expect(seen).toEqual(['fr']);
    expect(i18n.t('time.now')).toBe('Maintenant');
  });
});
