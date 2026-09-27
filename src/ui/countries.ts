import type { I18n } from '../i18n';

/** Localised country name from an ISO 3166-1 alpha-2 code ("su" = Soviet Union, "eu" = European Union). */
export function countryName(i18n: I18n, code: string): string {
  const special = i18n.maybe(`country.${code}`);
  if (special) return special;
  try {
    return new Intl.DisplayNames([i18n.locale], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code.toUpperCase();
  }
}
