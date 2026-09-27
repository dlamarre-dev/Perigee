/** Side panel of the solar-system view: planets, spacecraft (status, ephemeris availability), log scale. */
import type { PlanetInfo } from '../astro/planets';
import type { Mission } from '../data/schemas';
import type { I18n } from '../i18n';
import { h } from './dom';
import { formatUtcDate } from './labels';

export interface SolarPanelCallbacks {
  readonly onSelectPlanet: (p: PlanetInfo) => void;
  readonly onSelectMission: (m: Mission) => void;
  readonly onToggleLogScale: (on: boolean) => void;
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

  constructor(
    private readonly i18n: I18n,
    private readonly planets: readonly PlanetInfo[],
    private readonly missions: readonly Mission[],
    private readonly colors: ReadonlyMap<string, string>,
    private readonly hasEphemeris: (m: Mission) => boolean,
    logScale: boolean,
    private readonly callbacks: SolarPanelCallbacks,
  ) {
    this.logToggle.checked = logScale;
    this.logToggle.addEventListener('change', () => callbacks.onToggleLogScale(this.logToggle.checked));
    this.element = h(
      'aside',
      { class: 'panel side-panel filters', id: 'side-panel', 'aria-labelledby': 'solar-panel-title' },
      [
        this.title,
        this.fetched,
        h('p', { class: 'search-row' }, [this.logToggle, this.logLabel]),
        this.planetsTitle,
        this.planetsList,
        this.missionsTitle,
        this.missionsList,
      ],
    );
    i18n.onChange(() => this.render());
    this.render();
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

  render(): void {
    const t = this.i18n.t.bind(this.i18n);
    const lang = this.i18n.lang;
    this.title.textContent = t('solar.panel');
    this.fetched.textContent = this.fetchedAt
      ? this.i18n.format('moon.fetched', { date: formatUtcDate(this.fetchedAt) })
      : '';
    this.logLabel.textContent = t('solar.logScale');
    this.planetsTitle.textContent = t('solar.planets');
    this.missionsTitle.textContent = t('solar.probes');
    this.planetsList.replaceChildren(
      ...this.planets.map((p) => {
        const b = h('button', { type: 'button', class: 'result', 'data-planet': p.id }, [
          h('span', { class: 'result-name' }, [
            h('span', { class: 'dot', style: `background:${p.color}` }),
            p.name[lang],
          ]),
          h('span', { class: 'result-id' }, [p.dwarf ? t('solar.dwarf') : '']),
        ]);
        b.addEventListener('click', () => this.callbacks.onSelectPlanet(p));
        return h('li', {}, [b]);
      }),
    );
    this.missionsList.replaceChildren(
      ...this.missions.map((m) => {
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
        return h('li', {}, [b]);
      }),
    );
  }
}
