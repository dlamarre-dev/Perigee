import { describe, expect, it } from 'vitest';
import { I18n, LANGS, en, fr, type MessageKey } from '../src/i18n';
import { GLOSSARY, LABEL_TERMS } from '../src/i18n/glossary';
import { termForLabel } from '../src/ui/Glossary';

describe('glossary', () => {
  it('defines every term in every language', () => {
    for (const entry of Object.values(GLOSSARY)) {
      for (const lang of LANGS) expect(entry[lang].trim().length).toBeGreaterThan(40);
    }
  });

  it('every term is used by a label', () => {
    // The Moon's phase is named by its row (a probe's "Phase" has no definition).
    const used = new Set([...Object.values(LABEL_TERMS), 'moonPhase']);
    expect(Object.keys(GLOSSARY).filter((t) => !used.has(t as keyof typeof GLOSSARY))).toEqual([]);
  });

  it('labels with the same text share their term, in both languages', () => {
    for (const table of [en, fr]) {
      const seen = new Map<string, string>();
      for (const [key, term] of Object.entries(LABEL_TERMS)) {
        const text = table[key as MessageKey];
        const other = seen.get(text);
        if (other) expect(term, `"${text}"`).toBe(other);
        seen.set(text, term);
      }
    }
  });

  it('labels that look like a defined one but are not stay without a definition', () => {
    // "Type" is a satellite's object type, a site's landing type and a star's kind: too many meanings.
    for (const table of [en, fr]) {
      const defined = new Set(Object.keys(LABEL_TERMS).map((k) => table[k as MessageKey]));
      for (const key of ['info.type', 'star.type', 'sun.type'] as const)
        expect(defined.has(table[key])).toBe(false);
    }
  });

  it('finds a term from the label as shown', () => {
    const i18n = new I18n('fr');
    expect(termForLabel(i18n, 'Vitesse héliocentrique')).toBe('speedSun');
    expect(termForLabel(i18n, 'Type spectral')).toBe('spectralType');
    i18n.setLang('en');
    expect(termForLabel(i18n, 'Ephemeris window')).toBe('ephemerisWindow');
    expect(termForLabel(i18n, 'Agency')).toBeUndefined();
    expect(termForLabel(i18n, 'Phase')).toBeUndefined();
  });
});
