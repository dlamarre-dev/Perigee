import { eciToGeodetic } from 'satellite.js';
import { RAD_TO_DEG } from '../astro/constants';
import { gmstRad } from '../astro/time';
import { elementAgeDays, isStale, type SatObject } from '../earth/catalog';
import type { OperatorsCatalog } from '../data/schemas';
import type { TemeState } from '../earth/sgp4';
import type { I18n, MessageKey } from '../i18n';
import { h } from './dom';
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
  private readonly follow = h('button', { type: 'button', class: 'btn' });
  private readonly close = h('button', { type: 'button', class: 'btn' });
  private object: SatObject | undefined;
  private state: TemeState | undefined;
  private simNowMs = Date.now();
  private followingValue = false;

  constructor(
    private readonly i18n: I18n,
    private readonly operators: OperatorsCatalog,
    callbacks: InfoPanelCallbacks,
  ) {
    this.close.addEventListener('click', callbacks.onClose);
    this.follow.addEventListener('click', callbacks.onToggleFollow);
    this.element = h(
      'aside',
      { class: 'panel side-panel info', 'aria-labelledby': 'info-title', hidden: true },
      [
        h('div', { class: 'panel-header' }, [this.title, this.close]),
        this.freshness,
        this.fields,
        h('div', { class: 'dialog-actions' }, [this.follow]),
      ],
    );
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') callbacks.onClose();
    });
    i18n.onChange(() => this.render());
  }

  show(object: SatObject | undefined, focus = false): void {
    this.object = object;
    this.element.hidden = !object;
    this.render();
    if (object && focus) this.title.focus();
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

    this.title.textContent = obj.name;
    const freshness: Freshness = !this.state ? 'invalid' : isStale(obj, this.simNowMs) ? 'stale' : 'fresh';
    this.freshness.textContent = t(`info.${freshness}`);
    this.freshness.dataset['state'] = freshness;

    const num = (v: number, digits = 0): string => this.i18n.number(v, digits);
    const rows: [MessageKey, string][] = [
      ['info.norad', String(obj.noradId)],
      ['info.cospar', obj.cosparId || '—'],
    ];
    if (obj.operatorId)
      rows.push(['info.operator', facetLabel(this.i18n, this.operators, 'operators', obj.operatorId)]);
    if (obj.ownerCode)
      rows.push(['info.owner', facetLabel(this.i18n, this.operators, 'owners', obj.ownerCode)]);
    const sc = obj.satcat;
    if (sc?.LAUNCH_DATE)
      rows.push(['info.launch', sc.LAUNCH_SITE ? `${sc.LAUNCH_DATE} (${sc.LAUNCH_SITE})` : sc.LAUNCH_DATE]);
    if (sc?.OPS_STATUS_CODE) {
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
    rows.push([
      'info.epoch',
      `${formatUtcDate(new Date(obj.epochMs))} · ${this.i18n.format('info.ageDays', { n: num(ageDays, 1) })}`,
    ]);
    if (obj.groups.length) {
      rows.push([
        'info.groups',
        obj.groups.map((g) => facetLabel(this.i18n, this.operators, 'groups', g)).join(', '),
      ]);
    }

    this.fields.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, [t(k)]), h('dd', {}, [v])]));
    if (!sc) this.fields.append(h('p', { class: 'muted small' }, [t('info.noMetadata')]));
  }
}
