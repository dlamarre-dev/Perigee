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

  /** Translation with `{name}` placeholders replaced. */
  format(key: MessageKey, vars: Record<string, string | number>): string {
    return this.t(key).replace(/\{(\w+)\}/g, (m, name: string) => {
      const v = vars[name];
      return v === undefined ? m : typeof v === 'number' ? this.number(v) : v;
    });
  }

  /** Lookup for keys built at runtime (e.g. `status.${code}`); undefined when absent. */
  maybe(key: string): string | undefined {
    return (tables[this.langValue] as Record<string, string>)[key];
  }

  /** BCP 47 locale used for number/date formatting. */
  get locale(): string {
    return this.langValue === 'fr' ? 'fr-CA' : 'en-CA';
  }

  number(value: number, maximumFractionDigits = 0): string {
    return value.toLocaleString(this.locale, { maximumFractionDigits });
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
