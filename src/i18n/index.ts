import { en, type MessageKey, type Messages } from './en';
import { fr } from './fr';

export type Lang = 'en' | 'fr';
export const LANGS: readonly Lang[] = ['en', 'fr'];

const tables: Record<Lang, Messages> = { en, fr };

export function isLang(value: string | null | undefined): value is Lang {
  return value === 'en' || value === 'fr';
}

/** `?lang=` wins; otherwise the browser language (fr* → FR, anything else → EN). */
export function detectLang(urlLang: string | null, navigatorLanguages: readonly string[]): Lang {
  if (isLang(urlLang)) return urlLang;
  const first = navigatorLanguages[0]?.toLowerCase() ?? '';
  return first.startsWith('fr') ? 'fr' : 'en';
}

type Listener = (lang: Lang) => void;

/** Current language and translation lookup. UI components subscribe to re-render on change. */
export class I18n {
  private langValue: Lang;
  private readonly listeners = new Set<Listener>();

  constructor(lang: Lang) {
    this.langValue = lang;
  }

  get lang(): Lang {
    return this.langValue;
  }

  t(key: MessageKey): string {
    return tables[this.langValue][key];
  }

  setLang(lang: Lang): void {
    if (lang === this.langValue) return;
    this.langValue = lang;
    for (const l of this.listeners) l(lang);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export { en, fr };
export type { MessageKey, Messages };
