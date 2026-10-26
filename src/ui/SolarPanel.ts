/**
 * Side panel of the solar-system view: planets (their moons folded underneath, unfolded while the planet or
 * one of its moons is selected), well-known stars in two groups (the bright ones, and those within 20 light-years;
 * each named on the sky when ticked), comets (drawn and listed when ticked, brightest first), notable asteroids
 * (likewise, largest first), spacecraft (status,
 * ephemeris availability), log scale.
 */
import type { PlanetInfo } from '../astro/planets';
import { isBrightStar, isNearbyStar, NEARBY_STAR_MAX_LY } from '../astro/stars';
import {
  isInactiveMission,
  type Asteroid,
  type Comet,
  type Mission,
  type Moon,
  type Star,
} from '../data/schemas';
import type { I18n } from '../i18n';
import { h, markCurrent, sidePanel } from './dom';
import { MissionToggles } from './missionToggles';

export interface SolarPanelCallbacks {
  readonly onSelectPlanet: (p: PlanetInfo) => void;
  readonly onSelectSun: () => void;
  readonly onSelectMission: (m: Mission) => void;
  readonly onSelectMoon: (m: Moon) => void;
  readonly onSelectStar: (s: Star) => void;
  /** Names the bright stars on the sky (off by default). */
  readonly onToggleStars: (on: boolean) => void;
  /** Names the stars within 20 light-years on the sky (off by default). */
  readonly onToggleNearbyStars: (on: boolean) => void;
  /** Draws the comets of catalog/comets.json (off by default). */
  readonly onToggleComets: (on: boolean) => void;
  readonly onSelectComet: (c: Comet) => void;
  /** Draws the asteroids of catalog/asteroids.json (off by default). */
  readonly onToggleAsteroids: (on: boolean) => void;
  readonly onSelectAsteroid: (a: Asteroid) => void;
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
  private readonly starsToggle = h('input', { type: 'checkbox', id: 'toggle-stars' });
  private readonly starsLabel = h('label', { for: 'toggle-stars' });
  private readonly starsList = h('ul', { class: 'results moon-list star-list', id: 'star-list' });
  private readonly nearbyToggle = h('input', { type: 'checkbox', id: 'toggle-nearby-stars' });
  private readonly nearbyLabel = h('label', { for: 'toggle-nearby-stars' });
  private readonly nearbyList = h('ul', { class: 'results moon-list star-list', id: 'nearby-star-list' });
  private readonly cometsToggle = h('input', { type: 'checkbox', id: 'toggle-comets' });
  private readonly cometsLabel = h('label', { for: 'toggle-comets' });
  private readonly cometsList = h('ul', { class: 'results moon-list star-list', id: 'comet-list' });
  private readonly asteroidsToggle = h('input', { type: 'checkbox', id: 'toggle-asteroids' });
  private readonly asteroidsLabel = h('label', { for: 'toggle-asteroids' });
  private readonly asteroidsList = h('ul', { class: 'results moon-list star-list', id: 'asteroid-list' });
  /** Estimated magnitude now, by comet id (from their vectors, once loaded). */
  private cometMagnitudes: ReadonlyMap<string, number> = new Map();
  private readonly missionsTitle = h('h3', { class: 'results-title' });
  private readonly missionsList = h('ul', { class: 'results' });
  private readonly inactiveTitle = h('h3', { class: 'results-title' });
  private readonly inactiveList = h('ul', { class: 'results' });
  private fetchedAt: Date | undefined;
  /** Sunspots drawn: latest NOAA report used (visual honesty), undefined when none are drawn. */
  private readonly sunspots = h('p', { class: 'muted small' });
  private sunspotsDate: string | undefined;
  private readonly toggles: MissionToggles;

  constructor(
    private readonly i18n: I18n,
    private readonly planets: readonly PlanetInfo[],
    private readonly moons: readonly Moon[],
    private readonly stars: readonly Star[],
    private readonly missions: readonly Mission[],
    private readonly colors: ReadonlyMap<string, string>,
    private readonly hasEphemeris: (m: Mission) => boolean,
    logScale: boolean,
    private readonly callbacks: SolarPanelCallbacks,
    hiddenMissions: ReadonlySet<string> = new Set(),
    showStars = false,
    showNearbyStars = false,
    private readonly comets: readonly Comet[] = [],
    showComets = false,
    private readonly asteroids: readonly Asteroid[] = [],
    showAsteroids = false,
  ) {
    this.toggles = new MissionToggles(
      i18n,
      () => missions.filter((m) => m.objectType !== 'natural'),
      hiddenMissions,
      callbacks.onMissionVisibility,
    );
    this.logToggle.checked = logScale;
    this.logToggle.addEventListener('change', () => callbacks.onToggleLogScale(this.logToggle.checked));
    this.starsToggle.checked = showStars;
    this.starsToggle.setAttribute('aria-controls', 'star-list');
    this.starsToggle.addEventListener('change', () => {
      this.starsList.hidden = !this.starsToggle.checked;
      callbacks.onToggleStars(this.starsToggle.checked);
    });
    this.starsList.hidden = !showStars;
    this.nearbyToggle.checked = showNearbyStars;
    this.nearbyToggle.setAttribute('aria-controls', 'nearby-star-list');
    this.nearbyToggle.addEventListener('change', () => {
      this.nearbyList.hidden = !this.nearbyToggle.checked;
      callbacks.onToggleNearbyStars(this.nearbyToggle.checked);
    });
    this.nearbyList.hidden = !showNearbyStars;
    this.cometsToggle.checked = showComets;
    this.cometsToggle.setAttribute('aria-controls', 'comet-list');
    this.cometsToggle.addEventListener('change', () => {
      this.cometsList.hidden = !this.cometsToggle.checked;
      callbacks.onToggleComets(this.cometsToggle.checked);
    });
    this.cometsList.hidden = !showComets;
    this.asteroidsToggle.checked = showAsteroids;
    this.asteroidsToggle.setAttribute('aria-controls', 'asteroid-list');
    this.asteroidsToggle.addEventListener('change', () => {
      this.asteroidsList.hidden = !this.asteroidsToggle.checked;
      callbacks.onToggleAsteroids(this.asteroidsToggle.checked);
    });
    this.asteroidsList.hidden = !showAsteroids;
    this.element = sidePanel(
      { class: 'panel side-panel filters', id: 'side-panel', 'aria-labelledby': 'solar-panel-title' },
      [
        this.title,
        this.fetched,
        this.sunspots,
        h('p', { class: 'search-row' }, [this.logToggle, this.logLabel]),
        this.planetsTitle,
        this.planetsList,
        h('p', { class: 'search-row' }, [this.starsToggle, this.starsLabel]),
        this.starsList,
        h('p', { class: 'search-row' }, [this.nearbyToggle, this.nearbyLabel]),
        this.nearbyList,
        h('p', { class: 'search-row' }, [this.cometsToggle, this.cometsLabel]),
        this.cometsList,
        h('p', { class: 'search-row' }, [this.asteroidsToggle, this.asteroidsLabel]),
        this.asteroidsList,
        this.missionsTitle,
        this.toggles.toolbar,
        this.missionsList,
        this.inactiveTitle,
        this.toggles.inactiveToolbar,
        this.inactiveList,
      ],
    );
    i18n.onChange(() => this.render());
    this.render();
  }

  /** Draws a hidden mission again (it was just selected). */
  showMission(id: string): void {
    this.toggles.show(id);
  }

  /** Brightest first once magnitudes are known (the list keeps the catalogue order until then). */
  setCometMagnitudes(magnitudes: ReadonlyMap<string, number>): void {
    this.cometMagnitudes = magnitudes;
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
          (el.dataset['star'] !== undefined && `star:${el.dataset['star']}` === key) ||
          (el.dataset['comet'] !== undefined && `comet:${el.dataset['comet']}` === key) ||
          (el.dataset['asteroid'] !== undefined && `asteroid:${el.dataset['asteroid']}` === key) ||
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
    this.starsLabel.textContent = t('solar.stars');
    this.nearbyLabel.textContent = this.i18n.format('solar.nearbyStars', { ly: NEARBY_STAR_MAX_LY });
    const item = (s: Star, detail: string): HTMLLIElement => {
      const b = h('button', { type: 'button', class: 'result', 'data-star': s.id }, [
        h('span', { class: 'result-name' }, [s.name[lang]]),
        h('span', { class: 'result-id' }, [detail]),
      ]);
      b.addEventListener('click', () => this.callbacks.onSelectStar(s));
      return h('li', {}, [b]);
    };
    // Brightest first (lowest apparent magnitude).
    this.starsList.replaceChildren(
      ...this.stars
        .filter(isBrightStar)
        .sort((a, b) => a.magnitude - b.magnitude)
        .map((s) =>
          item(s, this.i18n.format('star.magnitudeShort', { mag: this.i18n.number(s.magnitude, 2) })),
        ),
    );
    // Nearest first.
    this.nearbyList.replaceChildren(
      ...this.stars
        .filter(isNearbyStar)
        .sort((a, b) => a.distanceLy - b.distanceLy)
        .map((s) =>
          item(s, this.i18n.format('star.distanceShort', { ly: this.i18n.number(s.distanceLy, 2) })),
        ),
    );
    this.cometsLabel.textContent = t('solar.comets');
    const mag = (c: Comet): number => this.cometMagnitudes.get(c.id) ?? Infinity;
    this.cometsList.replaceChildren(
      ...[...this.comets]
        .sort((a, b) => mag(a) - mag(b))
        .map((c) => {
          const m = this.cometMagnitudes.get(c.id);
          const b = h('button', { type: 'button', class: 'result', 'data-comet': c.id }, [
            h('span', { class: 'result-name' }, [c.name[lang]]),
            h('span', { class: 'result-id' }, [
              m === undefined
                ? ''
                : this.i18n.format('comet.magnitudeShort', { mag: this.i18n.number(m, 1) }),
            ]),
          ]);
          b.addEventListener('click', () => this.callbacks.onSelectComet(c));
          return h('li', {}, [b]);
        }),
    );
    this.asteroidsLabel.textContent = t('solar.asteroids');
    this.asteroidsList.replaceChildren(
      ...[...this.asteroids]
        .sort((a, b) => b.diameterKm - a.diameterKm)
        .map((a) => {
          const b = h('button', { type: 'button', class: 'result', 'data-asteroid': a.id }, [
            h('span', { class: 'result-name' }, [a.name[lang]]),
            h('span', { class: 'result-id' }, [
              this.i18n.format('asteroid.diameterShort', {
                d: this.i18n.number(a.diameterKm, a.diameterKm < 10 ? 1 : 0),
              }),
            ]),
          ]);
          b.addEventListener('click', () => this.callbacks.onSelectAsteroid(a));
          return h('li', {}, [b]);
        }),
    );
    this.planetsTitle.textContent = t('solar.planets');
    this.missionsTitle.textContent = t('solar.probes');
    this.inactiveTitle.textContent = t('solar.inactiveProbes');
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
    const spacecraft = this.missions.filter((m) => m.objectType !== 'natural');
    const row = (m: Mission): HTMLLIElement => {
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
    };
    this.missionsList.replaceChildren(...spacecraft.filter((m) => !isInactiveMission(m)).map(row));
    const inactive = spacecraft.filter(isInactiveMission);
    this.inactiveList.replaceChildren(...inactive.map(row));
    this.inactiveTitle.hidden =
      this.toggles.inactiveToolbar.hidden =
      this.inactiveList.hidden =
        inactive.length === 0;
    this.applyExpanded();
    this.applySelected(false);
  }
}
