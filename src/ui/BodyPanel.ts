/**
 * Side panel of the Moon/Mars views: missions (status, ephemeris availability) and landing sites grouped
 * by type. Everything is a native button, so the whole list is keyboard accessible.
 */
import type { LandingSite, LandingSiteType, Mission } from '../data/schemas';
import type { I18n, MessageKey } from '../i18n';
import { h, markCurrent, sidePanel } from './dom';
import { MissionToggles } from './missionToggles';

export interface BodyPanelCallbacks {
  readonly onSelectMission: (m: Mission) => void;
  readonly onSelectSite: (s: LandingSite) => void;
  readonly onToggleSites: (visible: boolean) => void;
  /** Missions whose markers, trajectories and labels are not drawn. */
  readonly onMissionVisibility: (hidden: ReadonlySet<string>) => void;
}

const SITE_TYPES: readonly LandingSiteType[] = ['crewed', 'soft', 'rover-last-known', 'hard', 'impact'];

export class BodyPanel {
  readonly element: HTMLElement;
  private readonly title = h('h2', { class: 'panel-title', id: 'body-panel-title' });
  private readonly fetched = h('p', { class: 'muted small' });
  private readonly sitesToggle = h('input', { type: 'checkbox', id: 'toggle-sites', checked: true });
  private readonly sitesToggleLabel = h('label', { for: 'toggle-sites' });
  private readonly missionsTitle = h('h3', { class: 'results-title' });
  private readonly missionsList = h('ul', { class: 'results' });
  private readonly sitesTitle = h('h3', { class: 'results-title' });
  private readonly sitesBox = h('div', { class: 'facets' });
  private fetchedAt: Date | undefined;
  private readonly toggles: MissionToggles;

  constructor(
    private readonly i18n: I18n,
    private readonly keys: { panel: MessageKey; sites: MessageKey; showSites: MessageKey },
    private readonly missions: readonly Mission[],
    private readonly sites: readonly LandingSite[],
    private readonly colors: ReadonlyMap<string, string>,
    private readonly hasEphemeris: (m: Mission) => boolean,
    private readonly callbacks: BodyPanelCallbacks,
    hiddenMissions: ReadonlySet<string> = new Set(),
  ) {
    this.toggles = new MissionToggles(i18n, () => missions, hiddenMissions, callbacks.onMissionVisibility);
    this.sitesToggle.addEventListener('change', () => callbacks.onToggleSites(this.sitesToggle.checked));
    this.element = sidePanel(
      { class: 'panel side-panel filters', id: 'side-panel', 'aria-labelledby': 'body-panel-title' },
      [
        this.title,
        this.fetched,
        this.missionsTitle,
        this.toggles.toolbar,
        this.missionsList,
        this.sitesTitle,
        h('p', { class: 'search-row' }, [this.sitesToggle, this.sitesToggleLabel]),
        this.sitesBox,
      ],
    );
    i18n.onChange(() => this.render());
    this.render();
  }

  private selectedKey: string | undefined;

  /** Highlights the selection: "mission:<id>", "site:<id>" or "planet:<id>" (scrolls when it changes). */
  setSelected(key: string | undefined): void {
    const changed = key !== this.selectedKey;
    this.selectedKey = key;
    this.applySelected(changed);
  }

  private applySelected(scroll: boolean): void {
    const key = this.selectedKey;
    markCurrent(
      this.element,
      (el) =>
        key !== undefined &&
        ((el.dataset['mission'] !== undefined && `mission:${el.dataset['mission']}` === key) ||
          (el.dataset['site'] !== undefined && `site:${el.dataset['site']}` === key) ||
          (el.dataset['planet'] !== undefined && `planet:${el.dataset['planet']}` === key)),
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

  /** Re-render after ephemerides load (availability badges). */
  render(): void {
    const t = this.i18n.t.bind(this.i18n);
    this.title.textContent = t(this.keys.panel);
    this.fetched.textContent = this.fetchedAt
      ? this.i18n.format('moon.fetched', { date: this.i18n.dateTime(this.fetchedAt) })
      : '';
    this.missionsTitle.textContent = t('moon.missions');
    this.toggles.renderLabels();
    this.sitesTitle.textContent = t(this.keys.sites);
    this.sitesToggleLabel.textContent = t(this.keys.showSites);

    this.missionsList.replaceChildren(
      ...this.missions.map((m) => {
        const status =
          m.objectType === 'natural'
            ? t('mission.natural')
            : (this.i18n.maybe(`mission.status.${m.status}`) ?? m.status);
        const extra = this.hasEphemeris(m) ? '' : ` · ${t('moon.noEphemeris')}`;
        const b = h('button', { type: 'button', class: 'result', 'data-mission': m.id }, [
          h('span', { class: 'result-name' }, [
            h('span', { class: 'dot', style: `background:${this.colors.get(m.id) ?? '#888'}` }),
            m.name[this.i18n.lang],
          ]),
          h('span', { class: 'result-id' }, [`${status}${extra}`]),
        ]);
        b.addEventListener('click', () => this.callbacks.onSelectMission(m));
        return this.toggles.row(m, b);
      }),
    );

    const open = new Set(
      [...this.sitesBox.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset['type']),
    );
    this.sitesBox.replaceChildren(
      ...SITE_TYPES.filter((type) => this.sites.some((s) => s.type === type)).map((type) => {
        const list = this.sites.filter((s) => s.type === type).sort((a, b) => a.date.localeCompare(b.date));
        const items = list.map((s) => {
          const b = h('button', { type: 'button', class: 'result', 'data-site': s.id }, [
            h('span', { class: 'result-name' }, [s.name[this.i18n.lang]]),
            h('span', { class: 'result-id' }, [s.date.slice(0, 4)]),
          ]);
          b.addEventListener('click', () => this.callbacks.onSelectSite(s));
          return h('li', {}, [b]);
        });
        return h('details', { 'data-type': type, open: open.has(type) }, [
          h('summary', {}, [`${this.i18n.maybe(`site.${type}`) ?? type} (${list.length})`]),
          h('ul', { class: 'results' }, items),
        ]);
      }),
    );
    this.applySelected(false);
  }
}
