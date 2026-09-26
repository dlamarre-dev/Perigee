import type { SatCatalog, SatObject } from '../earth/catalog';
import {
  EMPTY_FILTERS,
  FACET_KEYS,
  facetCounts,
  isEmptyFilter,
  type FacetKey,
  type FilterState,
} from '../earth/filters';
import type { SatStats } from '../earth/EarthSatellites';
import type { I18n, MessageKey } from '../i18n';
import { h } from './dom';
import { facetLabel, formatUtcDate } from './labels';

const FACET_TITLES: Record<FacetKey, MessageKey> = {
  operators: 'filters.operators',
  owners: 'filters.owners',
  groups: 'filters.groups',
  regimes: 'filters.regimes',
  types: 'filters.types',
};
const MAX_LISTED = 100;
const SEARCH_DEBOUNCE_MS = 150;

export interface FilterPanelCallbacks {
  readonly onChange: (filters: FilterState) => void;
  readonly onSelect: (object: SatObject) => void;
}

/**
 * Faceted filters (OR within a facet, AND across facets), free-text search, statistics, and an accessible
 * text list of the matching objects.
 */
export class FilterPanel {
  readonly element: HTMLElement;
  private readonly title = h('h2', { class: 'panel-title', id: 'filters-title' });
  private readonly stats = h('p', { class: 'stats', 'aria-live': 'polite' });
  private readonly fetched = h('p', { class: 'muted small' });
  private readonly searchLabel = h('label', { class: 'visually-hidden', for: 'filter-search' });
  private readonly search = h('input', {
    id: 'filter-search',
    type: 'search',
    class: 'input',
    autocomplete: 'off',
  });
  private readonly clear = h('button', { type: 'button', class: 'btn' });
  private readonly facetsBox = h('div', { class: 'facets' });
  private readonly resultsTitle = h('h3', { class: 'results-title' });
  private readonly results = h('ul', { class: 'results' });
  private readonly more = h('p', { class: 'muted small' });
  private filters: FilterState;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private lastStats: SatStats | undefined;
  private matching: readonly SatObject[] = [];
  private readonly summaries = new Map<FacetKey, HTMLElement>();

  constructor(
    private readonly i18n: I18n,
    private readonly catalog: SatCatalog,
    initial: FilterState,
    private readonly fetchedAt: Date | undefined,
    private readonly callbacks: FilterPanelCallbacks,
  ) {
    this.filters = initial;
    this.search.value = initial.query;
    this.search.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(
        () => this.update({ ...this.filters, query: this.search.value }),
        SEARCH_DEBOUNCE_MS,
      );
    });
    this.clear.addEventListener('click', () => {
      this.search.value = '';
      this.update(EMPTY_FILTERS);
      this.renderFacets();
    });

    this.element = h('aside', { class: 'panel side-panel filters', 'aria-labelledby': 'filters-title' }, [
      this.title,
      this.stats,
      this.fetched,
      h('div', { class: 'search-row' }, [this.searchLabel, this.search, this.clear]),
      this.facetsBox,
      this.resultsTitle,
      this.results,
      this.more,
    ]);
    i18n.onChange(() => this.renderAll());
    this.renderAll();
  }

  get state(): FilterState {
    return this.filters;
  }

  set visible(v: boolean) {
    this.element.hidden = !v;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /** Refreshes counters and the matching list (called when stats or filters change). */
  setResults(matching: readonly SatObject[], stats: SatStats): void {
    this.matching = matching;
    this.lastStats = stats;
    this.renderStats();
    this.renderResults();
  }

  updateStats(stats: SatStats): void {
    if (
      this.lastStats &&
      stats.shown === this.lastStats.shown &&
      stats.invalid === this.lastStats.invalid &&
      stats.stale === this.lastStats.stale
    ) {
      return;
    }
    this.lastStats = stats;
    this.renderStats();
  }

  private update(filters: FilterState): void {
    this.filters = filters;
    this.clear.disabled = isEmptyFilter(filters);
    this.callbacks.onChange(filters);
  }

  private toggle(facet: FacetKey, value: string, on: boolean): void {
    const current = this.filters[facet] as readonly string[];
    const next = on ? [...current, value] : current.filter((v) => v !== value);
    this.update({ ...this.filters, [facet]: next });
    this.renderSummary(facet);
  }

  private renderSummary(facet: FacetKey): void {
    const summary = this.summaries.get(facet);
    if (!summary) return;
    const n = this.filters[facet].length;
    summary.textContent = `${this.i18n.t(FACET_TITLES[facet])}${n ? ` (${n})` : ''}`;
  }

  private renderAll(): void {
    const t = this.i18n.t.bind(this.i18n);
    this.title.textContent = t('filters.title');
    this.searchLabel.textContent = t('filters.search');
    this.search.placeholder = t('filters.search');
    this.clear.textContent = t('filters.clear');
    this.clear.disabled = isEmptyFilter(this.filters);
    this.resultsTitle.textContent = t('filters.results');
    this.fetched.textContent = this.fetchedAt
      ? this.i18n.format('stats.fetched', { date: formatUtcDate(this.fetchedAt) })
      : '';
    this.renderFacets();
    this.renderStats();
    this.renderResults();
  }

  private renderFacets(): void {
    const open = new Set(
      [...this.facetsBox.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset['facet']),
    );
    const sections = FACET_KEYS.map((facet) => {
      const counts = facetCounts(this.catalog.objects, facet);
      const selected = new Set(this.filters[facet] as readonly string[]);
      const items = counts.map(([value, count]) => {
        const id = `f-${facet}-${value.replace(/[^a-z0-9]/gi, '_')}`;
        const box = h('input', { type: 'checkbox', id, checked: selected.has(value) });
        box.addEventListener('change', () => this.toggle(facet, value, box.checked));
        return h('li', {}, [
          box,
          h('label', { for: id }, [facetLabel(this.i18n, this.catalog.operators, facet, value)]),
          h('span', { class: 'count' }, [this.i18n.number(count)]),
        ]);
      });
      const summary = h('summary');
      this.summaries.set(facet, summary);
      return h('details', { 'data-facet': facet, open: open.has(facet) || selected.size > 0 }, [
        summary,
        h('ul', { class: 'facet-list' }, items),
      ]);
    });
    this.facetsBox.replaceChildren(...sections);
    for (const facet of FACET_KEYS) this.renderSummary(facet);
  }

  private renderStats(): void {
    const s = this.lastStats;
    if (!s) {
      this.stats.textContent = this.i18n.t('sat.loading');
      return;
    }
    const parts = [this.i18n.format('stats.shown', { shown: s.shown, total: s.total })];
    if (s.invalid) parts.push(this.i18n.format('stats.invalid', { n: s.invalid }));
    if (s.stale) parts.push(this.i18n.format('stats.stale', { n: s.stale }));
    this.stats.textContent = parts.join(' · ');
  }

  private renderResults(): void {
    const list = this.matching.slice(0, MAX_LISTED).map((obj) => {
      const b = h('button', { type: 'button', class: 'result', 'data-norad': obj.noradId }, [
        h('span', { class: 'result-name' }, [obj.name]),
        h('span', { class: 'result-id' }, [String(obj.noradId)]),
      ]);
      b.addEventListener('click', () => this.callbacks.onSelect(obj));
      return h('li', {}, [b]);
    });
    this.results.replaceChildren(...list);
    const rest = this.matching.length - MAX_LISTED;
    this.more.textContent =
      this.matching.length === 0
        ? this.i18n.t('filters.empty')
        : rest > 0
          ? this.i18n.format('filters.more', { n: rest })
          : '';
  }
}
