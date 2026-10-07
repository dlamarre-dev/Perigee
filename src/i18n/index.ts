import { en, type MessageKey, type Messages } from './en';
import { fr } from './fr';
import { AUTO_ZONE, formatWallClock, resolveZone, zoneAbbreviation, type TimeZoneSetting } from './timeZone';

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

/**
 * Current language, display time zone and translation lookup. UI components subscribe to re-render on change
 * (of either: dates and times are formatted here too).
 */
export class I18n {
  private langValue: Lang;
  private zoneSettingValue: TimeZoneSetting;
  private zoneValue: string;
  private readonly listeners = new Set<Listener>();

  constructor(lang: Lang, zoneSetting: TimeZoneSetting = AUTO_ZONE) {
    this.langValue = lang;
    this.zoneSettingValue = zoneSetting;
    this.zoneValue = resolveZone(zoneSetting);
  }

  /** "auto", "UTC" or an IANA id, as chosen. */
  get timeZoneSetting(): TimeZoneSetting {
    return this.zoneSettingValue;
  }

  /** IANA id (or "UTC") of the zone dates are shown in. */
  get timeZone(): string {
    return this.zoneValue;
  }

  setTimeZone(setting: TimeZoneSetting): void {
    const zone = resolveZone(setting);
    if (setting === this.zoneSettingValue && zone === this.zoneValue) return;
    this.zoneSettingValue = setting;
    this.zoneValue = zone;
    for (const l of this.listeners) l(this.langValue);
  }

  /** "2026-10-07 09:35 HAE": an instant in the display zone, with the zone's name at that date. */
  dateTime(date: Date, seconds = false): string {
    return `${formatWallClock(date, this.zoneValue, seconds)} ${this.zoneAbbreviation(date)}`;
  }

  /** Short name of the display zone at that date ("EDT"/"HAE", "UTC", "UTC+05:30"). */
  zoneAbbreviation(date: Date): string {
    return zoneAbbreviation(date, this.zoneValue, this.locale);
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

  /**
   * Planetocentric or geodetic coordinates, 3 decimals: "0.674° N, 23.473° W" in English, "0,674° N; 23,473° O"
   * in French (decimal comma, so the two values are separated by a semicolon).
   */
  latLon(latDeg: number, lonDeg: number): string {
    const deg = (v: number): string =>
      `${Math.abs(v).toLocaleString(this.locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}°`;
    const lat = `${deg(latDeg)} ${this.t(latDeg >= 0 ? 'coord.north' : 'coord.south')}`;
    const lon = `${deg(lonDeg)} ${this.t(lonDeg >= 0 ? 'coord.east' : 'coord.west')}`;
    return this.langValue === 'fr' ? `${lat}; ${lon}` : `${lat}, ${lon}`;
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
