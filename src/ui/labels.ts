import type { OperatorsCatalog } from '../data/schemas';
import { NONE, type FacetKey } from '../earth/filters';
import type { I18n } from '../i18n';

/** Human-readable label for a facet value, in the current language. */
export function facetLabel(i18n: I18n, operators: OperatorsCatalog, facet: FacetKey, value: string): string {
  if (value === NONE) return i18n.t('filters.none');
  switch (facet) {
    case 'operators':
      return operators.operators[value]?.name ?? value;
    case 'owners': {
      const owner = operators.owners[value];
      return owner ? `${owner[i18n.lang]} (${value})` : value;
    }
    case 'groups':
      return operators.groups[value]?.[i18n.lang] ?? value;
    case 'regimes':
      return i18n.maybe(`regime.${value}`) ?? value;
    case 'types':
      return i18n.maybe(`type.${value}`) ?? value;
  }
}

export function formatUtcDate(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
