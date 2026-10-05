import { eciToGeodetic } from 'satellite.js';
import { RAD_TO_DEG } from '../astro/constants';
import { gmstRad } from '../astro/time';
import { displayName, elementAgeDays, isStale, type SatObject } from '../earth/catalog';
import type { OperatorsCatalog } from '../data/schemas';
import type { TemeState } from '../earth/sgp4';
import type { I18n, MessageKey } from '../i18n';
import { h, setText, sidePanel, syncRows } from './dom';
import { modelFor } from '../render/models';
import { ModelPreview } from './ModelPreview';
import { countryName } from './countries';
import { facetLabel, formatUtcDate } from './labels';

export interface InfoPanelCallbacks {
  readonly onClose: () => void;
  readonly onToggleFollow: () => void;
}

type Freshness = 'fresh' | 'stale' | 'invalid';

/** Details of the selected object. Keyboard accessible; Escape closes it. */
export class InfoPanel {
  readonly element: HTMLElement;
  private readonly title = h('h2', { class: 'panel-title', id: 'info-title', tabindex: -1 });
  private readonly freshness = h('p', { class: 'freshness' });
  private readonly fields = h('dl', { class: 'fields' });
  // Curated science satellites: notes, sources and the verification date (like the missions of other views).
  private readonly notes = h('p', { class: 'small' });
  private readonly sourcesTitle = h('h3', { class: 'results-title' });
  private readonly sources = h('ul', { class: 'sources small' });
  private readonly footnote = h('p', { class: 'muted small' });
  private lastSourcesKey = '';
  private readonly follow = h('button', { type: 'button', class: 'btn' });
  private readonly close = h('button', { type: 'button', class: 'btn' });
  private object: SatObject | undefined;
  private state: TemeState | undefined;
  private simNowMs = Date.now();
  private followingValue = false;
  private launchSiteName: (code: string) => string | undefined = () => undefined;

  private readonly preview: ModelPreview;

  constructor(
    private readonly i18n: I18n,
    private readonly operators: OperatorsCatalog,
    callbacks: InfoPanelCallbacks,
  ) {
    this.close.addEventListener('click', callbacks.onClose);
    this.follow.addEventListener('click', callbacks.onToggleFollow);
    this.preview = new ModelPreview(i18n, import.meta.env.BASE_URL);
    this.element = sidePanel(
      { class: 'panel side-panel info', 'aria-labelledby': 'info-title', hidden: true },
      [
        h('div', { class: 'panel-header' }, [this.title, this.close]),
        this.preview.element,
        this.freshness,
        this.fields,
        this.notes,
        this.sourcesTitle,
        this.sources,
        this.footnote,
        h('div', { class: 'dialog-actions' }, [this.follow]),
      ],
    );
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') callbacks.onClose();
    });
    i18n.onChange(() => this.render());
  }

  show(object: SatObject | undefined, focus = false): void {
    // A newly selected object opens the sheet fully (phones).
    if (object !== this.object) this.element.classList.remove('collapsed');
    this.object = object;
    this.element.hidden = !object;
    this.preview.show(object ? modelFor(`norad:${object.noradId}`) : undefined);
    this.render();
    if (object && focus) this.title.focus();
  }

  /** Resolves SATCAT LAUNCH_SITE codes to curated site names. */
  setLaunchSiteNames(lookup: (code: string) => string | undefined): void {
    this.launchSiteName = lookup;
  }

  set following(v: boolean) {
    this.followingValue = v;
    this.follow.textContent = this.i18n.t(v ? 'info.unfollow' : 'info.follow');
    this.follow.setAttribute('aria-pressed', String(v));
  }

  /** Live values (altitude, speed, freshness); call a few times per second. */
  update(state: TemeState | undefined, simNowMs: number): void {
    this.state = state;
    this.simNowMs = simNowMs;
    if (this.object) this.render();
  }

  private render(): void {
    const obj = this.object;
    const t = this.i18n.t.bind(this.i18n);
    this.element.setAttribute('aria-label', t('info.label'));
    this.close.textContent = t('info.close');
    this.following = this.followingValue;
    if (!obj) return;

    const curated = obj.curated;
    const lang = this.i18n.lang;
    this.title.textContent = displayName(obj, lang);
    const freshness: Freshness = !this.state ? 'invalid' : isStale(obj, this.simNowMs) ? 'stale' : 'fresh';
    this.freshness.textContent = t(`info.${freshness}`);
    this.freshness.dataset['state'] = freshness;

    const num = (v: number, digits = 0): string => this.i18n.number(v, digits);
    const rows: [MessageKey, string][] = [];
    if (curated) {
      rows.push(['info.purpose', curated.purpose[lang]]);
      rows.push(['info.agency', curated.agency]);
      rows.push(['info.country', countryName(this.i18n, curated.country)]);
      rows.push(['info.status', this.i18n.maybe(`mission.status.${curated.status}`) ?? curated.status]);
    }
    rows.push(['info.norad', String(obj.noradId)], ['info.cospar', obj.cosparId || '—']);
    // The CelesTrak name, when the title shows a curated one.
    if (curated) rows.push(['info.catalogName', obj.name]);
    if (obj.operatorId)
      rows.push(['info.operator', facetLabel(this.i18n, this.operators, 'operators', obj.operatorId)]);
    for (const p of obj.hostedPayloads) {
      rows.push([
        'info.hostedPayload',
        `${p.name} · ${facetLabel(this.i18n, this.operators, 'operators', p.operatorId)}`,
      ]);
    }
    if (obj.ownerCode)
      rows.push(['info.owner', facetLabel(this.i18n, this.operators, 'owners', obj.ownerCode)]);
    const sc = obj.satcat;
    if (sc?.LAUNCH_DATE) {
      const site = sc.LAUNCH_SITE ? (this.launchSiteName(sc.LAUNCH_SITE) ?? sc.LAUNCH_SITE) : undefined;
      rows.push(['info.launch', site ? `${sc.LAUNCH_DATE} · ${site}` : sc.LAUNCH_DATE]);
    }
    if (sc?.OPS_STATUS_CODE && !curated) {
      rows.push(['info.status', this.i18n.maybe(`status.${sc.OPS_STATUS_CODE}`) ?? sc.OPS_STATUS_CODE]);
    }
    rows.push(['info.type', facetLabel(this.i18n, this.operators, 'types', obj.objectType)]);

    if (this.state) {
      const geo = eciToGeodetic(
        { x: this.state.posKm[0], y: this.state.posKm[1], z: this.state.posKm[2] },
        gmstRad(new Date(this.simNowMs)),
      );
      const [vx, vy, vz] = this.state.velKmS;
      rows.push(['info.altitude', `${num(geo.height)} km`]);
      rows.push(['info.speed', `${num(Math.hypot(vx, vy, vz), 2)} km/s`]);
    }
    rows.push(['info.apsides', `${num(obj.perigeeAltKm)} / ${num(obj.apogeeAltKm)} km`]);
    rows.push(['info.period', `${num(obj.periodMin, 1)} min`]);
    rows.push(['info.inclination', `${num(obj.inclinationRad * RAD_TO_DEG, 2)}°`]);
    const ageDays = elementAgeDays(obj, this.simNowMs);
    // Operator fits (SupGP) may be dated a few days ahead: they fit the operator's predictions.
    const age =
      ageDays < 0
        ? this.i18n.format('info.inDays', { n: num(-ageDays, 1) })
        : this.i18n.format('info.ageDays', { n: num(ageDays, 1) });
    rows.push(['info.epoch', `${formatUtcDate(new Date(obj.epochMs))} · ${age}`]);
    // Where the elements come from: the Space Force catalogue (GP) or a CelesTrak fit to the operator's own
    // ephemerides (supplemental GP), usually far more accurate.
    const supSet = obj.omm.SOURCE;
    rows.push([
      'info.elementsSource',
      supSet
        ? this.i18n.format('info.source.supgp', {
            set: this.operators.supplemental[supSet]?.[this.i18n.lang] ?? supSet,
          })
        : t('info.source.gp'),
    ]);
    if (obj.groups.length) {
      rows.push([
        'info.groups',
        obj.groups.map((g) => facetLabel(this.i18n, this.operators, 'groups', g)).join(', '),
      ]);
    }

    syncRows(
      this.fields,
      rows.map(([k, v]) => [t(k), v]),
    );
    if (!sc && !curated) this.fields.append(h('p', { class: 'muted small' }, [t('info.noMetadata')]));

    const notes = curated?.notes?.[lang];
    this.notes.hidden = !notes;
    setText(this.notes, notes ?? '');
    const urls = curated?.sources ?? [];
    this.sourcesTitle.hidden = urls.length === 0;
    setText(this.sourcesTitle, t('info.sources'));
    // Rebuild the links only when they change, so keyboard focus survives live updates.
    const key = urls.join('|');
    if (key !== this.lastSourcesKey) {
      this.lastSourcesKey = key;
      this.sources.replaceChildren(
        ...urls.map((url) =>
          h('li', {}, [h('a', { href: url, target: '_blank', rel: 'noopener' }, [new URL(url).hostname])]),
        ),
      );
    }
    setText(this.footnote, curated ? this.i18n.format('info.verified', { date: curated.verified }) : '');
  }
}
