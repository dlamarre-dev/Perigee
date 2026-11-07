/**
 * The guide page "When is the next eclipse?": the coming solar and lunar eclipses (engine `events`), one of them on
 * a map (./EclipseMap.ts; a solar eclipse's zone and path computed in a worker by src/astro/eclipseMap.ts), and its
 * times as seen from the visitor's place or from a point clicked on the map (engine `localSolarEclipse` /
 * `localLunarEclipse`). Everything is computed in the browser.
 */
import * as Astronomy from 'astronomy-engine';
import {
  bearingRad,
  groundDistanceKm,
  pointBelow,
  solarEclipseMap,
  sunMoonEcef,
  type LatLon,
  type SolarEclipseMap,
} from '../astro/eclipseMap';
import type { Provenance } from '../engine';
import { localLunarEclipse, localSolarEclipse } from '../engine/events';
import { compassPoint } from '../engine/ground';
import { compassLabel } from '../engine/notes';
import type { I18n, MessageKey } from '../i18n';
import { EclipseMap } from './EclipseMap';
import { distance, lightTime } from './format';
import type { LiveContext, Widget } from './live';

interface EclipseJson {
  readonly time: string;
  readonly title: string;
  readonly details?: {
    readonly kind?: string;
    readonly greatestEclipse?: LatLon;
    readonly contacts?: Readonly<Record<string, string>>;
  };
}

const isLunar = (e: EclipseJson): boolean => e.details?.contacts !== undefined;

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A solar eclipse's map, from the worker (or here when module workers are unavailable). */
class MapComputer {
  private worker: Worker | null | undefined;
  private seq = 0;
  private readonly pending = new Map<number, { peak: string; resolve: (m: SolarEclipseMap) => void }>();

  compute(peak: string): Promise<SolarEclipseMap> {
    const worker = this.ensure();
    if (!worker) return Promise.resolve(solarEclipseMap(new Date(peak)));
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, { peak, resolve });
      worker.postMessage({ id, peak });
    });
  }

  private ensure(): Worker | undefined {
    if (this.worker !== undefined) return this.worker ?? undefined;
    try {
      const w = new Worker(new URL('./eclipse.worker.ts', import.meta.url), {
        type: 'module',
        name: 'eclipse',
      });
      w.onmessage = (e: MessageEvent<{ id: number; map: SolarEclipseMap }>) => {
        this.pending.get(e.data.id)?.resolve(e.data.map);
        this.pending.delete(e.data.id);
      };
      // A worker that cannot load: the waiting maps are computed here, and later ones too.
      w.onerror = () => {
        this.worker = null;
        for (const p of this.pending.values()) p.resolve(solarEclipseMap(new Date(p.peak)));
        this.pending.clear();
      };
      this.worker = w;
      return w;
    } catch {
      this.worker = null;
      return undefined;
    }
  }
}

/** "3 min 12 s" for a duration in seconds. */
const duration = (i18n: I18n, s: number): string => lightTime(i18n, Math.round(s));

const pct = (i18n: I18n, magnitude: number): string => i18n.number(Math.min(100, magnitude * 100), 0);

interface LocalSolar {
  readonly visible: boolean;
  readonly kind?: 'total' | 'annular' | 'partial';
  readonly magnitude?: number;
  readonly greatest?: string;
  readonly begins?: string;
  readonly ends?: string;
  readonly centralBegins?: string;
  readonly centralEnds?: string;
  readonly centralSeconds?: number;
  readonly sunAltitudeDeg?: number;
  readonly sunAltitudeAtBeginDeg?: number;
  readonly sunAltitudeAtEndDeg?: number;
  readonly sunAltitudeAtCentralBeginsDeg?: number;
  readonly sunAltitudeAtCentralEndsDeg?: number;
  /** Totality or annularity happens here, but with the Sun below the horizon. */
  readonly centralBelowHorizon?: 'total' | 'annular';
}

function solarHere(e: EclipseJson, p: LatLon): LocalSolar | undefined {
  return localSolarEclipse(
    Astronomy.MakeTime(new Date(e.time)),
    new Astronomy.Observer(p.latDeg, p.lonDeg, 0),
  ) as LocalSolar | undefined;
}

function lunarHere(e: EclipseJson, p: LatLon): ReturnType<typeof localLunarEclipse> {
  return localLunarEclipse(e.details?.contacts ?? {}, new Astronomy.Observer(p.latDeg, p.lonDeg, 0));
}

/** One cell of the list: what the eclipse looks like from a place. */
function shortHere(i18n: I18n, e: EclipseJson, p: LatLon): string {
  if (isLunar(e)) {
    const v = lunarHere(e, p).visibility;
    return i18n.t(
      v === 'whole'
        ? 'landing.eclipse.short.whole'
        : v === 'part'
          ? 'landing.eclipse.short.part'
          : 'landing.eclipse.short.none',
    );
  }
  const s = solarHere(e, p);
  if (!s?.visible || s.magnitude === undefined) return i18n.t('landing.eclipse.short.none');
  if (s.kind === 'total' || s.kind === 'annular')
    return i18n.format(`landing.eclipse.short.${s.kind}`, {
      duration: duration(i18n, s.centralSeconds ?? 0),
    });
  return i18n.format('landing.eclipse.short.partial', { pct: pct(i18n, s.magnitude) });
}

export function eclipseWidget(ctx: LiveContext): Widget {
  const { engine, i18n } = ctx;
  const mapBox = $('lp-eclipse-map');
  const legend = $('lp-eclipse-legend');
  const zoom = $('lp-eclipse-zoom') as HTMLButtonElement | null;
  const here = $('lp-eclipse-here');
  const status = $('lp-eclipse-status');
  const computer = new MapComputer();
  let listAt = 0;
  let list: readonly EclipseJson[] = [];
  let selected: EclipseJson | undefined;
  let solar: SolarEclipseMap | undefined;
  let probe: LatLon | undefined;
  let map: EclipseMap | undefined;
  let showSeq = 0;
  const prov: readonly Provenance[] = [
    {
      model: 'vsop87',
      method: 'astronomy-engine',
      state: 'fresh',
      sources: [
        { name: 'astronomy-engine (Don Cross, MIT)', url: 'https://github.com/cosinekitty/astronomy' },
      ],
      accuracy: { note: '' },
    },
  ];

  function ensureMap(): EclipseMap | undefined {
    if (map || !mapBox) return map;
    const m = new EclipseMap({
      you: i18n.t('earth.observer'),
      probe: i18n.t('landing.eclipse.legend.probe'),
      greatest: i18n.t('landing.eclipse.legend.greatest'),
    });
    map = m;
    mapBox.replaceChildren(m.element);
    void fetch(`${ctx.baseUrl}landing/world.json`)
      .then((r) => r.json() as Promise<{ d: string }>)
      .then((w) => m.setLand(w.d))
      .catch(() => undefined);
    m.setObserver(ctx.place());
    m.element.addEventListener('click', (ev) => {
      const p = m.pick(ev);
      if (!p) return;
      probe = p;
      m.setProbe(p);
      renderHere();
    });
    zoom?.addEventListener('click', () => {
      m.setWorld(!m.showsWorld);
      zoom.textContent = i18n.t(m.showsWorld ? 'landing.eclipse.zoom' : 'landing.eclipse.world');
    });
    return m;
  }

  function renderLegend(e: EclipseJson): void {
    if (!legend) return;
    const item = (cls: string, key: MessageKey): HTMLElement => {
      const li = make('li');
      li.append(make('span', `lp-swatch ${cls}`), document.createTextNode(i18n.t(key)));
      return li;
    };
    const items = isLunar(e)
      ? [
          item('sw-moon-whole', 'landing.eclipse.legend.moonWhole'),
          item('sw-moon-part', 'landing.eclipse.legend.moonPart'),
          item('sw-moon-none', 'landing.eclipse.legend.moonNone'),
        ]
      : [
          item('sw-partial', 'landing.eclipse.legend.partial'),
          item('sw-limit', 'landing.eclipse.legend.limit'),
          item('sw-half', 'landing.eclipse.legend.half'),
          ...(solar?.path
            ? [
                item(`sw-central sw-${solar.path.kind}`, `landing.eclipse.legend.${solar.path.kind}`),
                item('sw-greatest', 'landing.eclipse.legend.greatest'),
              ]
            : []),
        ];
    legend.replaceChildren(...items);
  }

  /** The answer line: the eclipse on the map (the next one until another is picked). */
  function renderAnswer(): void {
    const e = selected ?? list[0];
    const answer = e
      ? i18n.format('landing.answer.event', { title: e.title, when: i18n.dateTime(new Date(e.time)) })
      : i18n.t('landing.events.none');
    const el = $('lp-answer-text');
    if (el && el.textContent !== answer) el.textContent = answer;
  }

  async function show(e: EclipseJson): Promise<void> {
    selected = e;
    const seq = ++showSeq;
    renderList();
    renderAnswer();
    const m = ensureMap();
    if (!m) return;
    mapBox?.setAttribute(
      'aria-label',
      i18n.format('landing.eclipse.label', { title: e.title, date: i18n.dateTime(new Date(e.time)) }),
    );
    if (isLunar(e)) {
      solar = undefined;
      const c = e.details?.contacts ?? {};
      const below = (iso: string | undefined): LatLon =>
        pointBelow(sunMoonEcef(new Date(iso ?? e.time)).moon);
      m.showLunar({
        start: below(c['partialBegins'] ?? c['penumbralBegins']),
        end: below(c['partialEnds'] ?? c['penumbralEnds']),
        peak: below(e.time),
      });
    } else {
      if (status) status.textContent = i18n.t('landing.eclipse.computing');
      const computed = await computer.compute(e.time);
      if (seq !== showSeq) return;
      solar = computed;
      m.showSolar(computed, e.details?.greatestEclipse);
      if (status) status.textContent = '';
    }
    if (zoom) {
      zoom.hidden = !m.canZoom;
      zoom.textContent = i18n.t(m.showsWorld ? 'landing.eclipse.zoom' : 'landing.eclipse.world');
    }
    renderLegend(e);
    renderHere();
  }

  /** The list of coming eclipses: each one selectable, with what it looks like from the visitor's place. */
  function renderList(): void {
    let box = $('lp-events');
    if (!box) {
      box = make('section', 'lp-list panel');
      box.id = 'lp-events';
      $('lp-cards')?.after(box);
    }
    const title = make('h2', '', i18n.t('landing.events.title'));
    if (!list.length) {
      box.replaceChildren(title, make('p', '', i18n.t('landing.events.none')));
      return;
    }
    const place = ctx.place();
    const table = make('table', 'lp-eclipse-list');
    const head = make('tr');
    head.append(make('th', '', i18n.t('landing.table.time')), make('th', '', i18n.t('landing.table.event')));
    if (place) head.append(make('th', '', i18n.t('landing.eclipse.fromYou')));
    const tbody = make('tbody');
    for (const e of list) {
      const tr = make('tr');
      const on = e.time === selected?.time;
      if (on) tr.className = 'lp-selected';
      const button = make('button', 'lp-pick', e.title);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(on));
      button.addEventListener('click', () => void show(e));
      const cell = make('td');
      cell.append(button);
      tr.append(make('td', '', i18n.dateTime(new Date(e.time))), cell);
      if (place) tr.append(make('td', '', shortHere(i18n, e, place)));
      tbody.append(tr);
    }
    const thead = make('thead');
    thead.append(head);
    table.append(thead, tbody);
    box.replaceChildren(title, table);
  }

  /** The times of the selected eclipse at the chosen point or the visitor's place. */
  function renderHere(): void {
    if (!here || !selected) return;
    const e = selected;
    const place = ctx.place();
    const point = probe ?? place;
    const out: HTMLElement[] = [];
    if (!point) {
      here.replaceChildren(make('p', 'lp-note', i18n.t('landing.eclipse.hint')));
      return;
    }
    const head = make(
      'h3',
      '',
      probe
        ? i18n.format('landing.eclipse.fromProbe', { coords: i18n.latLon(probe.latDeg, probe.lonDeg) })
        : i18n.t('landing.eclipse.fromYou'),
    );
    out.push(head);
    const rows: [string, string, string][] = [];
    const at = (iso: string, seconds = false): string => i18n.dateTime(new Date(iso), seconds);
    if (isLunar(e)) {
      const l = lunarHere(e, point);
      out.push(make('p', 'lp-pass-status', i18n.t(`landing.eclipse.lunar.${l.visibility}`)));
      for (const [k, iso] of Object.entries(e.details?.contacts ?? {})) {
        const alt = l.moonAltitudeDeg[k] ?? 0;
        rows.push([
          i18n.t(`landing.eclipse.lunar.${k}` as MessageKey),
          at(iso),
          alt > 0
            ? i18n.format('landing.eclipse.moonAlt', { alt: i18n.number(alt, 0) })
            : i18n.t('landing.eclipse.moonDown'),
        ]);
      }
    } else {
      const s = solarHere(e, point);
      const sun = (alt: number | undefined): string =>
        alt !== undefined && alt > 0
          ? i18n.format('landing.eclipse.sunAlt', { alt: i18n.number(alt, 0) })
          : i18n.t('landing.eclipse.sunDown');
      let summary: string;
      if (!s) summary = i18n.t('landing.eclipse.solar.none');
      else if (!s.visible) summary = i18n.t('landing.eclipse.solar.down');
      else if (s.kind === 'total' || s.kind === 'annular')
        summary = i18n.format(`landing.eclipse.solar.${s.kind}`, {
          duration: duration(i18n, s.centralSeconds ?? 0),
        });
      else summary = i18n.format('landing.eclipse.solar.partial', { pct: pct(i18n, s.magnitude ?? 0) });
      out.push(make('p', 'lp-pass-status', summary));
      if (s?.visible && s.centralBelowHorizon)
        out.push(make('p', '', i18n.t(`landing.eclipse.solar.centralDown.${s.centralBelowHorizon}`)));
      if (s?.visible && s.begins && s.ends && s.greatest) {
        const central = s.kind === 'total' ? 'total' : 'annular';
        rows.push([i18n.t('landing.eclipse.row.begins'), at(s.begins), sun(s.sunAltitudeAtBeginDeg)]);
        if (s.centralBegins)
          rows.push([
            i18n.t(`landing.eclipse.row.${central}Begins`),
            at(s.centralBegins, true),
            sun(s.sunAltitudeAtCentralBeginsDeg),
          ]);
        rows.push([
          i18n.t('landing.eclipse.row.greatest'),
          at(s.greatest),
          `${pct(i18n, s.magnitude ?? 0)} % · ${sun(s.sunAltitudeDeg)}`,
        ]);
        if (s.centralEnds)
          rows.push([
            i18n.t(`landing.eclipse.row.${central}Ends`),
            at(s.centralEnds, true),
            sun(s.sunAltitudeAtCentralEndsDeg),
          ]);
        rows.push([i18n.t('landing.eclipse.row.ends'), at(s.ends), sun(s.sunAltitudeAtEndDeg)]);
        if (Math.min(s.sunAltitudeAtBeginDeg ?? 1, s.sunAltitudeDeg ?? 1, s.sunAltitudeAtEndDeg ?? 1) <= 0)
          out.push(make('p', '', i18n.t('landing.eclipse.solar.horizon')));
      }
      // Outside the central path: how far it passes.
      const path = solar?.path;
      if (path && s?.kind !== 'total' && s?.kind !== 'annular') {
        let best: LatLon | undefined;
        let bestKm = Infinity;
        for (const poly of path.polygons)
          for (const q of poly) {
            const km = groundDistanceKm(point, q);
            if (km < bestKm) {
              bestKm = km;
              best = q;
            }
          }
        if (best && bestKm < 5000)
          out.push(
            make(
              'p',
              '',
              i18n.format(`landing.eclipse.path.${path.kind}`, {
                distance: distance(i18n, Math.max(10, Math.round(bestKm / 10) * 10)),
                dir: compassLabel(compassPoint(bearingRad(point, best)), i18n.lang),
              }),
            ),
          );
      }
    }
    if (rows.length) {
      const table = make('table', 'lp-eclipse-times');
      const tbody = make('tbody');
      for (const [a, b, c] of rows) {
        const tr = make('tr');
        tr.append(make('th', '', a), make('td', '', b), make('td', 'lp-note', c));
        tbody.append(tr);
      }
      table.append(tbody);
      out.push(table);
    }
    if (probe) {
      const clear = make('button', 'btn', i18n.t('landing.eclipse.clearProbe'));
      clear.type = 'button';
      clear.addEventListener('click', () => {
        probe = undefined;
        map?.setProbe(undefined);
        renderHere();
      });
      out.push(clear);
    }
    here.replaceChildren(...out);
  }

  return {
    async tick(now) {
      const next = list[0];
      if (now.getTime() - listAt > 10 * 60_000 || (next && Date.parse(next.time) < now.getTime())) {
        listAt = now.getTime();
        const r = engine.events({ start: now, days: 366, kinds: ['eclipse'], lang: i18n.lang });
        list = (r['events'] as readonly EclipseJson[]).slice(0, 12);
        const keep = selected && list.find((e) => e.time === selected?.time);
        if (keep) renderList();
        else if (list[0]) void show(list[0]);
        else renderList();
      }
      renderAnswer();
    },
    placeChanged(place) {
      map?.setObserver(place);
      renderList();
      renderHere();
    },
    provenance: () => prov,
  };
}
