/**
 * Side panel of the solar-system view: planets (their moons folded underneath, unfolded while the planet or
 * one of its moons is selected), spacecraft (status, ephemeris availability), log scale.
 */
import type { PlanetInfo } from '../astro/planets';
import type { Mission, Moon } from '../data/schemas';
import type { I18n } from '../i18n';
import { h, markCurrent, sidePanel } from './dom';
import { MissionToggles } from './missionToggles';

export interface SolarPanelCallbacks {
  readonly onSelectPlanet: (p: PlanetInfo) => void;
  readonly onSelectSun: () => void;
  readonly onSelectMission: (m: Mission) => void;
  readonly onSelectMoon: (m: Moon) => void;
  readonly onToggleLogScale: (on: boolean) => void;
  /** Spacecraft whose markers, trajectories and labels are not drawn. */
  readonly onMissionVisibility: (hidden: ReadonlySet<string>) => void;
}

export class SolarPanel {
  readonly element: HTMLElement;
  private readonly title = h('h2', { class: 'panel-title', id: 'solar-panel-title' });
  private readonly fetched = h('p', { class: 'muted small' });
  private readonly logToggle = h('input', { type: 'checkbox', id: 'toggle-log-scale' });
  private readonly logLabel = h('label', { for: 'toggle-log-scale' });
  private readonly planetsTitle = h('h3', { class: 'results-title' });
  private readonly planetsList = h('ul', { class: 'results' });
  private readonly missionsTitle = h('h3', { class: 'results-title' });
  private readonly missionsList = h('ul', { class: 'results' });
  private fetchedAt: Date | undefined;
  /** Sunspots drawn: latest NOAA report used (visual honesty), undefined when none are drawn. */
  private readonly sunspots = h('p', { class: 'muted small' });
  private sunspotsDate: string | undefined;
  private readonly toggles: MissionToggles;

  constructor(
    private readonly i18n: I18n,
    private readonly planets: readonly PlanetInfo[],
    private readonly moons: readonly Moon[],
    private readonly missions: readonly Mission[],
    private readonly colors: ReadonlyMap<string, string>,
    private readonly hasEphemeris: (m: Mission) => boolean,
    logScale: boolean,
    private readonly callbacks: SolarPanelCallbacks,
    hiddenMissions: ReadonlySet<string> = new Set(),
  ) {
    this.toggles = new MissionToggles(
      i18n,
      () => missions.filter((m) => m.objectType !== 'natural'),
      hiddenMissions,
      callbacks.onMissionVisibility,
    );
    this.logToggle.checked = logScale;
    this.logToggle.addEventListener('change', () => callbacks.onToggleLogScale(this.logToggle.checked));
    this.element = sidePanel(
      { class: 'panel side-panel filters', id: 'side-panel', 'aria-labelledby': 'solar-panel-title' },
      [
        this.title,
        this.fetched,
        this.sunspots,
        h('p', { class: 'search-row' }, [this.logToggle, this.logLabel]),
        this.planetsTitle,
        this.planetsList,
        this.missionsTitle,
        this.toggles.toolbar,
        this.missionsList,
      ],
    );
    i18n.onChange(() => this.render());
    this.render();
  }

  private selectedKey: string | undefined;

  /**
   * Highlights the selection: "mission:<id>", "planet:<id>" or "moon:<id>" (scrolls when it changes) and unfolds
   * the moons of the selected planet (or of the selected moon's planet); every other list folds.
   */
  setSelected(key: string | undefined): void {
    const changed = key !== this.selectedKey;
    this.selectedKey = key;
    this.applyExpanded();
    this.applySelected(changed);
  }

  private expandedPlanet(): string | undefined {
    const key = this.selectedKey;
    if (key?.startsWith('planet:')) return key.slice('planet:'.length);
    if (key?.startsWith('moon:')) return this.moons.find((m) => `moon:${m.id}` === key)?.planet;
    return undefined;
  }

  private applyExpanded(): void {
    const open = this.expandedPlanet();
    for (const list of this.planetsList.querySelectorAll<HTMLElement>('ul.moon-list')) {
      const expanded = list.dataset['planet'] === open;
      list.hidden = !expanded;
      const toggle = this.planetsList.querySelector(`button[data-planet="${list.dataset['planet']}"]`);
      toggle?.setAttribute('aria-expanded', String(expanded));
    }
  }

  private applySelected(scroll: boolean): void {
    const key = this.selectedKey;
    markCurrent(
      this.element,
      (el) =>
        key !== undefined &&
        ((el.dataset['mission'] !== undefined && `mission:${el.dataset['mission']}` === key) ||
          (el.dataset['site'] !== undefined && `site:${el.dataset['site']}` === key) ||
          (el.dataset['planet'] !== undefined && `planet:${el.dataset['planet']}` === key) ||
          (el.dataset['sun'] !== undefined && key === 'sun') ||
          (el.dataset['moon'] !== undefined && `moon:${el.dataset['moon']}` === key)),
      scroll,
    );
  }

  set visible(v: boolean) {
    this.element.hidden = !v;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  setFetched(date: Date | undefined): void {
    this.fetchedAt = date;
    this.render();
  }

  /** Observation day (YYYY-MM-DD, a calendar date: not converted to the display zone). */
  setSunspotReport(date: string | undefined): void {
    if (date === this.sunspotsDate) return;
    this.sunspotsDate = date;
    this.render();
  }

  render(): void {
    const t = this.i18n.t.bind(this.i18n);
    const lang = this.i18n.lang;
    this.title.textContent = t('solar.panel');
    this.fetched.textContent = this.fetchedAt
      ? this.i18n.format('moon.fetched', { date: this.i18n.dateTime(this.fetchedAt) })
      : '';
    this.sunspots.hidden = !this.sunspotsDate;
    this.sunspots.textContent = this.sunspotsDate
      ? this.i18n.format('solar.sunspots', { date: this.sunspotsDate })
      : '';
    this.logLabel.textContent = t('solar.logScale');
    this.planetsTitle.textContent = t('solar.planets');
    this.missionsTitle.textContent = t('solar.probes');
    this.toggles.renderLabels();
    const sun = h('button', { type: 'button', class: 'result', 'data-sun': '' }, [
      h('span', { class: 'result-name' }, [
        h('span', { class: 'dot', style: 'background:#ffcf6b' }),
        t('sun.name'),
      ]),
      h('span', { class: 'result-id' }, [t('sun.kind')]),
    ]);
    sun.addEventListener('click', () => this.callbacks.onSelectSun());
    this.planetsList.replaceChildren(
      h('li', {}, [sun]),
      ...this.planets.map((p) => {
        const moons = this.moons.filter((m) => m.planet === p.id);
        const listId = `moons-${p.id}`;
        const count =
          moons.length === 1
            ? t('solar.moonCountOne')
            : moons.length > 1
              ? this.i18n.format('solar.moonCount', { n: String(moons.length) })
              : '';
        const b = h(
          'button',
          {
            type: 'button',
            class: 'result',
            'data-planet': p.id,
            ...(moons.length > 0 ? { 'aria-controls': listId, 'aria-expanded': 'false' } : {}),
          },
          [
            h('span', { class: 'result-name' }, [
              h('span', { class: 'dot', style: `background:${p.color}` }),
              p.name[lang],
            ]),
            h('span', { class: 'result-id' }, [
              [p.dwarf ? t('solar.dwarf') : '', count].filter(Boolean).join(' · '),
            ]),
          ],
        );
        b.addEventListener('click', () => this.callbacks.onSelectPlanet(p));
        if (moons.length === 0) return h('li', {}, [b]);
        const list = h(
          'ul',
          { class: 'results moon-list', id: listId, 'data-planet': p.id, hidden: true },
          moons.map((m) => {
            const mb = h('button', { type: 'button', class: 'result', 'data-moon': m.id }, [
              h('span', { class: 'result-name' }, [
                h('span', { class: 'dot', style: `background:${m.color}` }),
                m.name[lang],
              ]),
              h('span', { class: 'result-id' }, [`${this.i18n.number(m.radiusKm)} km`]),
            ]);
            mb.addEventListener('click', () => this.callbacks.onSelectMoon(m));
            return h('li', {}, [mb]);
          }),
        );
        return h('li', {}, [b, list]);
      }),
    );
    this.planetsList.append(
      ...this.missions
        .filter((m) => m.objectType === 'natural')
        .map((m) => {
          const b = h('button', { type: 'button', class: 'result', 'data-mission': m.id }, [
            h('span', { class: 'result-name' }, [
              h('span', { class: 'dot', style: `background:${this.colors.get(m.id) ?? '#888'}` }),
              m.name[lang],
            ]),
            h('span', { class: 'result-id' }, [t('solar.dwarf')]),
          ]);
          b.addEventListener('click', () => this.callbacks.onSelectMission(m));
          return h('li', {}, [b]);
        }),
    );
    this.missionsList.replaceChildren(
      ...this.missions
        .filter((m) => m.objectType !== 'natural')
        .map((m) => {
          const status = this.i18n.maybe(`mission.status.${m.status}`) ?? m.status;
          const extra = this.hasEphemeris(m) ? '' : ` · ${t('moon.noEphemeris')}`;
          const b = h('button', { type: 'button', class: 'result', 'data-mission': m.id }, [
            h('span', { class: 'result-name' }, [
              h('span', { class: 'dot', style: `background:${this.colors.get(m.id) ?? '#888'}` }),
              m.name[lang],
            ]),
            h('span', { class: 'result-id' }, [`${status}${extra}`]),
          ]);
          b.addEventListener('click', () => this.callbacks.onSelectMission(m));
          return this.toggles.row(m, b);
        }),
    );
    this.applyExpanded();
    this.applySelected(false);
  }
}
