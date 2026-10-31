/**
 * Live content of a landing page: the answer sentence, the cards, the ground-track map, the visitor's passes, the
 * tables and the provenance block, all from the headless engine (src/engine/) over the published data, recomputed
 * in the browser (every second for positions, less often for searches). One `Widget` per topic kind.
 */
import { cometMagnitude } from '../astro/comets';
import { loadManifest, loadOptionalDataset } from '../data/loader';
import { SunRegionsSchema } from '../data/schemas';
import type { Engine, Provenance } from '../engine';
import { compassLabel } from '../engine/notes';
import type { I18n } from '../i18n';
import { systemZone } from '../i18n/timeZone';
import { au, countdown, distance, kmh, kms, lightTime, span } from './format';
import { GroundTrackMap } from './GroundTrackMap';
import type { Place } from './observer';
import type { Topic } from './topics';

export interface LiveContext {
  readonly engine: Engine;
  readonly i18n: I18n;
  readonly topic: Topic;
  readonly baseUrl: string;
  /** The visitor's place, when given. */
  place(): Place | undefined;
}

export interface Widget {
  /** Every second. */
  tick(now: Date): Promise<void>;
  /** Called when the visitor's place changes. */
  placeChanged?(place: Place | undefined): void;
  provenance(): readonly Provenance[];
}

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

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

/** The cards of #lp-cards, created once and updated in place. */
class Cards {
  private readonly root = $('lp-cards');
  private readonly cards = new Map<string, { value: HTMLElement; sub: HTMLElement }>();

  set(key: string, label: string, value: string, sub = ''): void {
    if (!this.root) return;
    let card = this.cards.get(key);
    if (!card) {
      const box = make('div', 'lp-card');
      const l = make('span', 'lp-card-label', label);
      const v = make('strong', 'lp-card-value');
      const s = make('span', 'lp-card-sub');
      box.append(l, v, s);
      this.root.append(box);
      card = { value: v, sub: s };
      this.cards.set(key, card);
    }
    if (card.value.textContent !== value) card.value.textContent = value;
    if (card.sub.textContent !== sub) card.sub.textContent = sub;
  }
}

function setAnswer(text: string): void {
  const el = $('lp-answer-text');
  if (el && el.textContent !== text) el.textContent = text;
}

const localTime = (i18n: I18n, iso: string): string => i18n.dateTime(new Date(iso));

/** A local time: the hour alone today, the weekday and hour within a week, else the date and time. */
function when(i18n: I18n, iso: string, now: Date): string {
  const d = new Date(iso);
  const zone = i18n.timeZone;
  const day = (x: Date): string => x.toLocaleDateString('en-CA', { timeZone: zone });
  const hour: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: zone };
  if (day(d) === day(now)) return d.toLocaleTimeString(i18n.locale, hour);
  if (Math.abs(d.getTime() - now.getTime()) < 6 * 86_400_000)
    return d.toLocaleString(i18n.locale, { ...hour, weekday: 'short' });
  return i18n.dateTime(d);
}

/** The short name in parentheses ("ISS", "CSS", "HST"), for the map label. */
const shortName = (name: string): string => /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? name;

/** Satellites: position, ground track, passes over the visitor. */
function satelliteWidget(ctx: LiveContext): Widget {
  const { engine, i18n, topic } = ctx;
  const id = topic.target ?? '';
  const cards = new Cards();
  let name = '';
  let prov: readonly Provenance[] = [];
  let map: GroundTrackMap | undefined;
  let trackAt = 0;
  let periodMin = 90;
  let passes: { atMs: number; list: PassRow[] } | undefined;
  let passesBusy = false;
  const mapBox = $('lp-map-svg');
  const out = $('lp-place-out');

  interface PassRow {
    readonly riseMs: number;
    readonly setMs: number;
    readonly html: HTMLElement;
    readonly visibleFromMs?: number;
  }

  void engine.describe(id, i18n.lang).then((d) => {
    name = typeof d['name'] === 'string' ? d['name'] : id;
    map?.setLabel(shortName(name));
  });

  async function refreshTrack(now: Date): Promise<void> {
    if (!mapBox) return;
    const start = new Date(now.getTime() - (periodMin / 2) * 60_000);
    const g = await engine.groundTrack(id, { start, orbits: 1.5, points: 270 });
    periodMin = typeof g['periodMin'] === 'number' ? g['periodMin'] : periodMin;
    const pts = (g['points'] as readonly { time: string; latDeg: number; lonDeg: number }[]) ?? [];
    const t = now.getTime();
    const past = pts.filter((p) => Date.parse(p.time) <= t);
    const future = pts.filter((p) => Date.parse(p.time) >= t);
    if (!map) {
      map = new GroundTrackMap(shortName(name || id), i18n.t('earth.observer'));
      mapBox.replaceChildren(map.element);
      void fetch(`${ctx.baseUrl}landing/world.json`)
        .then((r) => r.json() as Promise<{ d: string }>)
        .then((w) => map?.setLand(w.d))
        .catch(() => undefined);
      const place = ctx.place();
      map.setObserver(place);
    }
    map.setTrack(past, future);
    map.setSun(now);
  }

  async function refreshPasses(now: Date): Promise<void> {
    const place = ctx.place();
    if (!place || !out || passesBusy) return;
    passesBusy = true;
    try {
      const zone = systemZone();
      const r = await engine.passes(id, {
        latDeg: place.latDeg,
        lonDeg: place.lonDeg,
        days: 3,
        start: new Date(now.getTime() - 15 * 60_000),
        timeZone: zone,
        lang: i18n.lang,
      });
      const list = (r['passes'] as readonly PassJson[]).map((p) => passRow(p, now));
      passes = { atMs: now.getTime(), list };
      const title = make('h3', '', i18n.t('landing.passes.title'));
      const status = make('p', 'lp-pass-status');
      status.id = 'lp-pass-status';
      const ol = make('ol', 'lp-passes');
      for (const row of list.slice(0, 6)) ol.append(row.html);
      const note = make(
        'p',
        'lp-note',
        i18n.format('landing.passes.note', { zone: i18n.zoneAbbreviation(now) }),
      );
      out.replaceChildren(
        title,
        status,
        list.length ? ol : make('p', '', i18n.t('landing.passes.none')),
        note,
      );
      prov = (r['provenance'] as readonly Provenance[]) ?? prov;
    } catch (err) {
      console.warn(err);
      out.replaceChildren(make('p', '', i18n.t('landing.unavailable')));
    } finally {
      passesBusy = false;
    }
  }

  interface PassPointJson {
    readonly time: string;
    readonly elevationDeg: number;
    readonly direction: string;
  }
  interface PassJson {
    readonly rise: PassPointJson;
    readonly culmination: PassPointJson;
    readonly set: PassPointJson;
    readonly visibleToNakedEye: boolean;
    readonly visible?: { readonly from: string; readonly to: string };
    readonly sunElevationDeg: number;
    readonly sunlitShare: number;
  }

  function passRow(p: PassJson, now: Date): PassRow {
    const li = make('li', p.visibleToNakedEye ? 'lp-pass visible' : 'lp-pass');
    const point = (label: string, pt: PassPointJson): HTMLElement => {
      const span = make('span', 'lp-pass-point');
      span.append(make('b', '', label), ` ${when(i18n, pt.time, now)} · `);
      span.append(
        i18n.format('landing.passes.where', {
          direction: compassLabel(pt.direction, i18n.lang),
          elevation: Math.max(0, Math.round(pt.elevationDeg)),
        }),
      );
      return span;
    };
    li.append(
      point(i18n.t('landing.passes.rise'), p.rise),
      point(i18n.t('landing.passes.peak'), p.culmination),
      point(i18n.t('landing.passes.set'), p.set),
    );
    const why = p.visible
      ? i18n.format('landing.passes.visible', {
          from: when(i18n, p.visible.from, now),
          to: when(i18n, p.visible.to, now),
        })
      : p.sunElevationDeg > -6
        ? i18n.t('landing.passes.daylight')
        : i18n.t('landing.passes.shadow');
    li.append(make('span', 'lp-pass-why', why));
    return {
      riseMs: Date.parse(p.rise.time),
      setMs: Date.parse(p.set.time),
      html: li,
      ...(p.visible ? { visibleFromMs: Date.parse(p.visible.from) } : {}),
    };
  }

  function passStatus(now: Date): void {
    const el = $('lp-pass-status');
    if (!el || !passes) return;
    const t = now.getTime();
    const current = passes.list.find((p) => p.riseMs <= t && t <= p.setMs);
    const next = passes.list.find((p) => p.riseMs > t);
    const nextVisible = passes.list.find((p) => p.visibleFromMs !== undefined && p.visibleFromMs > t);
    const parts: string[] = [];
    if (current) parts.push(i18n.t('landing.passes.now'));
    else if (next)
      parts.push(i18n.format('landing.passes.next', { countdown: countdown(i18n, next.riseMs - t) }));
    if (nextVisible?.visibleFromMs !== undefined)
      parts.push(
        i18n.format('landing.passes.nextVisible', {
          countdown: countdown(i18n, nextVisible.visibleFromMs - t),
        }),
      );
    else parts.push(i18n.t('landing.passes.noVisible'));
    const text = parts.join(' · ');
    if (el.textContent !== text) el.textContent = text;
    // A pass over: drop it and search again from now.
    if (passes.list[0] && passes.list[0].setMs < t - 60_000) void refreshPasses(now);
  }

  return {
    async tick(now) {
      const s = await engine.state(id, now);
      prov = s.provenance;
      const g = s.groundPoint;
      if (g && s.altitudeKm !== undefined && s.speedKmS !== undefined) {
        const over = g.over?.name[i18n.lang] ?? '';
        const lit =
          s.sunlitFraction === undefined
            ? ''
            : ` ${i18n.t(s.sunlitFraction > 0.5 ? 'landing.answer.satelliteLit' : 'landing.answer.satelliteDark')}`;
        setAnswer(
          `${i18n.format('landing.answer.satellite', {
            name: name || id,
            over,
            altitude: distance(i18n, s.altitudeKm),
            speed: kmh(i18n, s.speedKmS),
          })}${lit}`,
        );
        cards.set('alt', i18n.t('landing.card.altitude'), distance(i18n, s.altitudeKm));
        cards.set('speed', i18n.t('landing.card.speed'), kmh(i18n, s.speedKmS), kms(i18n, s.speedKmS));
        cards.set('over', i18n.t('landing.card.over'), over, i18n.latLon(g.latDeg, g.lonDeg));
        if (s.sunlitFraction !== undefined)
          cards.set(
            'light',
            i18n.t('landing.card.light'),
            i18n.t(
              s.sunlitFraction >= 0.99
                ? 'landing.lit'
                : s.sunlitFraction <= 0.01
                  ? 'landing.dark'
                  : 'landing.penumbra',
            ),
          );
        map?.setPosition(g);
      } else setAnswer(i18n.t('landing.unavailable'));
      if (now.getTime() - trackAt > 30_000) {
        trackAt = now.getTime();
        await refreshTrack(now);
        if (g) map?.setPosition(g);
      }
      if (ctx.place() && (!passes || now.getTime() - passes.atMs > 10 * 60_000)) await refreshPasses(now);
      passStatus(now);
    },
    placeChanged(place) {
      map?.setObserver(place);
      passes = undefined;
      if (!place) out?.replaceChildren();
    },
    provenance: () => prov,
  };
}

/** Probes, telescopes and planets: distances from the Earth and the Sun, light time, speed. */
function distanceWidget(ctx: LiveContext): Widget {
  const { engine, i18n, topic } = ctx;
  const id = topic.target ?? '';
  const cards = new Cards();
  let name = id;
  let prov: readonly Provenance[] = [];
  void engine.describe(id, i18n.lang).then((d) => {
    name = typeof d['name'] === 'string' ? d['name'] : id;
  });
  return {
    async tick(now) {
      const [fromEarth, state] = await Promise.all([
        engine.distance('earth', id, now),
        engine.state(id, now),
      ]);
      prov = [
        ...state.provenance,
        ...fromEarth.provenance.filter((p) => !state.provenance.some((q) => q.model === p.model)),
      ];
      if (fromEarth.distanceKm === undefined || fromEarth.lightTimeS === undefined) {
        setAnswer(i18n.t('landing.unavailable'));
        return;
      }
      const dEarth = distance(i18n, fromEarth.distanceKm);
      const sunKm = state.centre === 'sun' ? state.distanceKm : undefined;
      setAnswer(
        topic.kind === 'planet' && sunKm !== undefined
          ? i18n.format('landing.answer.planet', { name, distance: dEarth, sun: distance(i18n, sunKm) })
          : i18n.format('landing.answer.distance', {
              name,
              distance: dEarth,
              light: lightTime(i18n, fromEarth.lightTimeS),
            }),
      );
      cards.set('earth', i18n.t('landing.card.distanceEarth'), dEarth, au(i18n, fromEarth.distanceKm) ?? '');
      cards.set('light', i18n.t('landing.card.lightTime'), lightTime(i18n, fromEarth.lightTimeS));
      if (sunKm !== undefined)
        cards.set('sun', i18n.t('landing.card.distanceSun'), distance(i18n, sunKm), au(i18n, sunKm) ?? '');
      if (state.speedKmS !== undefined && state.centre === 'sun')
        cards.set(
          'speed',
          i18n.t('landing.card.speedSun'),
          kmh(i18n, state.speedKmS),
          kms(i18n, state.speedKmS),
        );
    },
    provenance: () => prov,
  };
}

/** The Moon: phase, illumination, distance, next phases (the same from everywhere: no place asked). */
function moonWidget(ctx: LiveContext): Widget {
  const { engine, i18n, topic } = ctx;
  const cards = new Cards();
  let prov: readonly Provenance[] = [];
  let eventsAt = 0;
  return {
    async tick(now) {
      const sky = engine.sky({
        latDeg: 0,
        lonDeg: 0,
        date: now,
        lang: i18n.lang,
        timeZone: systemZone(),
      });
      const moon = sky['moon'] as { phase: string; illuminatedPercent: number };
      const d = await engine.distance('earth', 'moon:moon', now);
      prov = [...(sky['provenance'] as readonly Provenance[])];
      const km = d.distanceKm ?? 0;
      setAnswer(
        i18n.format('landing.answer.moon', {
          phase: moon.phase,
          lit: moon.illuminatedPercent,
          distance: distance(i18n, km),
        }),
      );
      const distanceCard = (): void =>
        cards.set(
          'dist',
          i18n.t('landing.card.distanceEarth'),
          distance(i18n, km),
          lightTime(i18n, d.lightTimeS ?? 0),
        );
      if (topic.focus === 'distance') distanceCard();
      cards.set('phase', i18n.t('landing.card.phase'), moon.phase);
      cards.set('lit', i18n.t('landing.card.lit'), `${moon.illuminatedPercent} %`);
      if (topic.focus !== 'distance') distanceCard();
      if (now.getTime() - eventsAt > 10 * 60_000) {
        eventsAt = now.getTime();
        const ev = engine.events({ start: now, days: 35, kinds: ['moon'], lang: i18n.lang });
        renderEvents(i18n, (ev['events'] as readonly EventJson[]).slice(0, 6), now);
      }
    },
    provenance: () => prov,
  };
}

interface EventJson {
  readonly time: string;
  readonly kind: string;
  readonly title: string;
  readonly details?: Record<string, unknown>;
}

/** Table of upcoming events under the cards (#lp-events, created once). */
function renderEvents(i18n: I18n, events: readonly EventJson[], now: Date): void {
  let box = $('lp-events');
  if (!box) {
    box = make('section', 'lp-list panel');
    box.id = 'lp-events';
    $('lp-cards')?.after(box);
  }
  const title = make('h2', '', i18n.t('landing.events.title'));
  if (!events.length) {
    box.replaceChildren(title, make('p', '', i18n.t('landing.events.none')));
    return;
  }
  const table = make('table');
  const head = make('tr');
  head.append(make('th', '', i18n.t('landing.table.time')), make('th', '', i18n.t('landing.table.event')));
  const tbody = make('tbody');
  for (const e of events) {
    const tr = make('tr');
    const dist =
      typeof e.details?.['distanceKm'] === 'number' ? ` (${distance(i18n, e.details['distanceKm'])})` : '';
    tr.append(make('td', '', localTime(i18n, e.time)), make('td', '', `${e.title}${dist}`));
    tbody.append(tr);
  }
  const thead = make('thead');
  thead.append(head);
  table.append(thead, tbody);
  box.replaceChildren(title, table);
  void now;
}

/** Eclipses or Moon phases to come. */
function eventsWidget(ctx: LiveContext): Widget {
  const { engine, i18n, topic } = ctx;
  let at = 0;
  let next: EventJson | undefined;
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
  return {
    async tick(now) {
      if (now.getTime() - at > 10 * 60_000 || (next && Date.parse(next.time) < now.getTime())) {
        at = now.getTime();
        const place = ctx.place();
        const eclipses = topic.focus === 'eclipses';
        const r = engine.events({
          start: now,
          days: eclipses ? 366 : 120,
          kinds: [eclipses ? 'eclipse' : 'moon'],
          lang: i18n.lang,
          ...(place ? { place: { latDeg: place.latDeg, lonDeg: place.lonDeg, timeZone: systemZone() } } : {}),
        });
        let list = r['events'] as readonly EventJson[];
        if (!eclipses) list = list.filter((e) => !/apog|périg|perig/i.test(e.title));
        next = eclipses ? list[0] : (list.find((e) => /full|pleine/i.test(e.title)) ?? list[0]);
        renderEvents(i18n, list.slice(0, 12), now);
      }
      setAnswer(
        next
          ? i18n.format('landing.answer.event', { title: next.title, when: localTime(i18n, next.time) })
          : i18n.t('landing.events.none'),
      );
    },
    placeChanged() {
      at = 0;
    },
    provenance: () => prov,
  };
}

/** Counts of active satellites (all, a group or a regime). */
function constellationWidget(ctx: LiveContext): Widget {
  const { engine, i18n, topic } = ctx;
  const cards = new Cards();
  let at = 0;
  let prov: readonly Provenance[] = [];
  interface Row {
    readonly id: string;
    readonly name: string;
    readonly total: number;
    readonly regimes: Record<string, number>;
  }
  return {
    async tick(now) {
      if (now.getTime() - at < 10 * 60_000) return;
      at = now.getTime();
      const group = topic.stats?.group;
      const regime = topic.stats?.regime;
      const s = await engine.stats({ lang: i18n.lang, limit: 10, ...(group ? { group } : {}) });
      prov = s['provenance'] as readonly Provenance[];
      const total = s['total'] as number;
      const regimes = s['regimes'] as Record<string, number>;
      const owners = (s['owners'] as { rows: Row[] }).rows;
      const share = (n: number): string =>
        i18n.number((100 * n) / Math.max(1, total), n / total < 0.1 ? 1 : 0);
      let shown = regimes;
      if (group) {
        const row = (s['groups'] as { rows: Row[] }).rows.find((r) => r.id === group);
        if (!row) return;
        shown = row.regimes;
        setAnswer(
          i18n.format('landing.answer.groupCount', {
            count: row.total,
            name: row.name,
            share: share(row.total),
          }),
        );
        cards.set('group', i18n.t('landing.card.inGroup'), i18n.number(row.total), row.name);
        cards.set('total', i18n.t('landing.card.total'), i18n.number(total));
      } else if (regime) {
        const n = regimes[regime] ?? 0;
        setAnswer(i18n.format('landing.answer.regimeCount', { count: n, share: share(n) }));
        cards.set('group', i18n.t(`landing.regime.${regime}`), i18n.number(n));
        cards.set('total', i18n.t('landing.card.total'), i18n.number(total));
      } else {
        setAnswer(i18n.format('landing.answer.count', { count: total }));
        cards.set('total', i18n.t('landing.card.total'), i18n.number(total));
        cards.set('30', i18n.t('landing.card.launched30'), i18n.number(s['launchedLast30Days'] as number));
      }
      for (const r of ['LEO', 'MEO', 'GEO', 'HEO'] as const) {
        if (!regime && (shown[r] ?? 0) > 0)
          cards.set(r, i18n.t(`landing.regime.${r}`), i18n.number(shown[r] ?? 0));
      }
      // Who owns them: the largest owners overall, or of the regime.
      if (!group) {
        const rows = regime
          ? [...owners].sort((a, b) => (b.regimes[regime] ?? 0) - (a.regimes[regime] ?? 0)).slice(0, 10)
          : owners.slice(0, 10);
        renderRows(
          i18n.t('landing.card.byOwner'),
          rows.map((r) => [r.name, i18n.number(regime ? (r.regimes[regime] ?? 0) : r.total)]),
        );
      }
    },
    provenance: () => prov,
  };
}

function renderRows(title: string, rows: readonly (readonly [string, string])[]): void {
  let box = $('lp-rows');
  if (!box) {
    box = make('section', 'lp-list panel');
    box.id = 'lp-rows';
    $('lp-cards')?.after(box);
  }
  const table = make('table');
  const tbody = make('tbody');
  for (const [a, b] of rows) {
    const tr = make('tr');
    tr.append(make('th', '', a), make('td', 'num', b));
    tbody.append(tr);
  }
  table.append(tbody);
  box.replaceChildren(make('h2', '', title), table);
}

/** The pre-rendered table rows (#lp-list): live distances, altitude or magnitude by row. */
function tableWidget(ctx: LiveContext): Widget {
  const { engine, i18n, topic } = ctx;
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('.lp-list tr[data-id]')];
  let at = 0;
  let prov: readonly Provenance[] = [];
  const laws = new Map<string, { m1: number; k1: number } | null>();
  return {
    async tick(now) {
      if (now.getTime() - at < (topic.kind === 'around' ? 2000 : 10_000)) return;
      at = now.getTime();
      let drawn = 0;
      const provs: Provenance[] = [];
      await Promise.all(
        rows.map(async (tr) => {
          const id = tr.dataset['id'] ?? '';
          const cell = (k: string): HTMLElement | null => tr.querySelector<HTMLElement>(`[data-live="${k}"]`);
          try {
            if (topic.kind === 'around') {
              const c = cell('altitude');
              if (!c) return;
              const s = await engine.state(id, now);
              if (s.altitudeKm !== undefined && s.provenance.every((p) => p.state !== 'hidden')) {
                drawn++;
                c.textContent = distance(i18n, s.altitudeKm);
                provs.push(...s.provenance);
              }
              return;
            }
            const s = await engine.state(id, now);
            const d = await engine.distance('earth', id, now);
            const sun = cell('sun');
            const earth = cell('earth');
            if (sun && s.distanceKm !== undefined)
              sun.textContent = au(i18n, s.distanceKm) ?? distance(i18n, s.distanceKm);
            if (earth && d.distanceKm !== undefined)
              earth.textContent =
                id === 'earth' ? '–' : (au(i18n, d.distanceKm) ?? distance(i18n, d.distanceKm));
            provs.push(...s.provenance);
            const mag = cell('mag');
            if (mag && s.distanceKm !== undefined && d.distanceKm !== undefined) {
              if (!laws.has(id)) {
                const info = await engine.describe(id, i18n.lang);
                const law = info['magnitudeLaw'] as { m1: number; k1: number } | undefined;
                laws.set(id, law ?? null);
              }
              const law = laws.get(id);
              if (law)
                mag.textContent = `≈ ${i18n.number(cometMagnitude(law.m1, law.k1, s.distanceKm / 149_597_870.7, d.distanceKm / 149_597_870.7), 1)}`;
            }
          } catch {
            // No published position (yet): the cell keeps its dash.
          }
        }),
      );
      const seen = new Set<string>();
      prov = provs.filter((p) => !seen.has(p.model) && seen.add(p.model));
      if (topic.kind === 'around')
        setAnswer(
          i18n.format('landing.answer.around', {
            count: rows.length,
            body: topic.around === 'mars' ? 'Mars' : i18n.lang === 'fr' ? 'la Lune' : 'the Moon',
            drawn,
          }),
        );
      else if (topic.kind === 'sites') setAnswer(i18n.format('landing.answer.sites', { count: rows.length }));
      else setAnswer(i18n.format('landing.answer.bodies', { count: rows.length }));
    },
    provenance: () => prov,
  };
}

/** One landing site or rover: coordinates and date (rovers: the latest published position). */
function siteWidget(ctx: LiveContext): Widget {
  const { engine, i18n, topic } = ctx;
  const cards = new Cards();
  let done = false;
  return {
    async tick() {
      if (done) return;
      done = true;
      const d = await engine.describe(topic.target ?? '', i18n.lang);
      const lat = d['latDeg'] as number;
      const lon = d['lonDeg'] as number;
      const date = String(d['date'] ?? '');
      setAnswer(
        i18n.format('landing.answer.site', { name: String(d['name']), coords: i18n.latLon(lat, lon), date }),
      );
      cards.set('coords', i18n.t('landing.table.coords'), i18n.latLon(lat, lon));
      cards.set('date', i18n.t('landing.table.date'), date);
      if (typeof d['agency'] === 'string') cards.set('agency', i18n.t('landing.table.agency'), d['agency']);
    },
    provenance: () => [],
  };
}

/** Sunspot groups of the latest NOAA report. */
function sunWidget(ctx: LiveContext): Widget {
  const { i18n } = ctx;
  const cards = new Cards();
  let at = 0;
  const prov: Provenance[] = [];
  return {
    async tick(now) {
      if (now.getTime() - at < 10 * 60_000) return;
      at = now.getTime();
      const manifest = await loadManifest(ctx.baseUrl);
      const regions = await loadOptionalDataset(ctx.baseUrl, manifest, 'sun.regions', SunRegionsSchema);
      if (!regions) {
        setAnswer(i18n.t('landing.unavailable'));
        return;
      }
      const last = regions.data.reduce((m, r) => (r.date > m ? r.date : m), '');
      const today = regions.data
        .filter((r) => r.date === last)
        .sort((a, b) => (b.areaMh ?? 0) - (a.areaMh ?? 0));
      prov.length = 0;
      prov.push({
        model: 'catalogue-counts',
        method: 'NOAA SWPC solar region reports',
        state: 'fresh',
        sources: [{ name: 'NOAA Space Weather Prediction Center', url: 'https://www.swpc.noaa.gov' }],
        dataFetchedAt: regions.entry.fetchedAt,
        accuracy: { note: '' },
      });
      setAnswer(i18n.format('landing.answer.sun', { count: today.length, date: last }));
      cards.set('count', i18n.t('landing.sun.regions'), i18n.number(today.length), last);
      renderRows(
        i18n.t('landing.sun.regions'),
        today.map((r) => [
          i18n.format('landing.sun.region', { region: r.region }),
          r.spots
            ? i18n.format('landing.sun.spots', { spots: r.spots, area: r.areaMh ?? 0 })
            : i18n.t('landing.sun.noSpots'),
        ]),
      );
    },
    provenance: () => prov,
  };
}

/** Tonight from the visitor's place. */
function skyWidget(ctx: LiveContext): Widget {
  const { engine, i18n, topic } = ctx;
  let at = 0;
  let prov: readonly Provenance[] = [];
  return {
    async tick(now) {
      const place = ctx.place();
      const out = $('lp-place-out');
      if (!place) {
        setAnswer(i18n.t('landing.answer.sky'));
        return;
      }
      if (now.getTime() - at < 10 * 60_000 || !out) return;
      at = now.getTime();
      const r = await engine.tonight({
        latDeg: place.latDeg,
        lonDeg: place.lonDeg,
        timeZone: systemZone(),
        lang: i18n.lang,
        date: now,
      });
      prov = (r['provenance'] as readonly Provenance[]) ?? [];
      const night = r['night'] as { from?: { time: string } } | undefined;
      const planets =
        (r['planets'] as readonly {
          name: string;
          direction: string;
          altitudeDeg: number;
          magnitude: number;
          nakedEyeNow: boolean;
          aboveHorizon: boolean;
          rise?: { time: string };
          set?: { time: string };
        }[]) ?? [];
      const visible = planets.filter((p) => p.nakedEyeNow);
      const planetNames = visible.length ? visible.map((p) => p.name).join(', ') : '0';
      setAnswer(
        night?.from
          ? i18n.format('landing.answer.skyHere', {
              dusk: when(i18n, night.from.time, now),
              planets: planetNames,
            })
          : i18n.format('landing.answer.skyNoDark', { planets: planetNames }),
      );
      const blocks: HTMLElement[] = [];
      const table = (
        title: string,
        head: readonly string[],
        rows: readonly (readonly string[])[],
      ): HTMLElement => {
        const sec = make('section', 'lp-list');
        const tb = make('table');
        const thead = make('thead');
        const hr = make('tr');
        for (const h of head) hr.append(make('th', '', h));
        thead.append(hr);
        const tbody = make('tbody');
        for (const row of rows) {
          const tr = make('tr');
          row.forEach((c, i) => tr.append(make(i === 0 ? 'th' : 'td', '', c)));
          tbody.append(tr);
        }
        tb.append(thead, tbody);
        sec.append(make('h3', '', title), tb);
        return sec;
      };
      blocks.push(
        table(
          i18n.t('landing.sky.planets'),
          [
            i18n.t('landing.table.name'),
            i18n.t('landing.table.direction'),
            i18n.t('landing.table.magnitude'),
            i18n.t('landing.table.rises'),
            i18n.t('landing.table.sets'),
          ],
          planets.map((p) => [
            `${p.name} (${i18n.t(p.nakedEyeNow ? 'landing.sky.nakedEye' : p.aboveHorizon ? 'landing.sky.notNakedEye' : 'landing.sky.belowHorizon')})`,
            p.aboveHorizon ? `${compassLabel(p.direction, i18n.lang)}, ${Math.round(p.altitudeDeg)}°` : '–',
            i18n.number(p.magnitude, 1),
            // The engine gives the next rise: for a planet already up, that is after it sets.
            p.aboveHorizon ? i18n.t('landing.sky.alreadyUp') : p.rise ? when(i18n, p.rise.time, now) : '–',
            p.set ? when(i18n, p.set.time, now) : '–',
          ]),
        ),
      );
      if (topic.focus !== 'planets') {
        const passes =
          (r['passes'] as readonly {
            name: string;
            from: { time: string };
            to: { time: string };
            maxElevationDeg: number;
            rise: string;
            set: string;
          }[]) ?? [];
        blocks.push(
          passes.length
            ? table(
                i18n.t('landing.sky.passes'),
                [
                  i18n.t('landing.table.name'),
                  i18n.t('landing.table.time'),
                  i18n.t('landing.table.direction'),
                ],
                passes.map((p) => [
                  p.name,
                  `${when(i18n, p.from.time, now)} – ${when(i18n, p.to.time, now)}`,
                  `${compassLabel(p.rise, i18n.lang)} → ${compassLabel(p.set, i18n.lang)}, ${Math.round(p.maxElevationDeg)}°`,
                ]),
              )
            : make('p', '', i18n.t('landing.sky.noPasses')),
        );
        const events = (r['events'] as readonly EventJson[] | undefined) ?? [];
        if (events.length)
          blocks.push(
            table(
              i18n.t('landing.sky.events'),
              [i18n.t('landing.table.time'), i18n.t('landing.table.event')],
              events.slice(0, 8).map((e) => [localTime(i18n, e.time), e.title]),
            ),
          );
      }
      out.replaceChildren(...blocks);
    },
    placeChanged() {
      at = 0;
      if (!ctx.place()) $('lp-place-out')?.replaceChildren();
    },
    provenance: () => prov,
  };
}

export function createWidget(ctx: LiveContext): Widget {
  switch (ctx.topic.kind) {
    case 'satellite':
      return satelliteWidget(ctx);
    case 'spacecraft':
    case 'planet':
      return distanceWidget(ctx);
    case 'moon':
      return moonWidget(ctx);
    case 'events':
      return eventsWidget(ctx);
    case 'constellation':
      return constellationWidget(ctx);
    case 'around':
    case 'sites':
    case 'bodies':
      return tableWidget(ctx);
    case 'site':
      return siteWidget(ctx);
    case 'sun':
      return sunWidget(ctx);
    case 'sky':
      return skyWidget(ctx);
  }
}

/** The provenance block: sources, data state and age, validity, typical accuracy. */
export function renderProvenance(i18n: I18n, list: readonly Provenance[], now: Date): void {
  const box = $('lp-provenance');
  if (!box) return;
  const seen = new Set<string>();
  const items = list.filter((p) => {
    const key = `${p.model}|${p.dataFetchedAt ?? ''}`;
    return !seen.has(key) && seen.add(key);
  });
  const ul = make('ul', 'lp-prov');
  for (const p of items) {
    const li = make('li');
    p.sources.forEach((s, i) => {
      if (i) li.append(', ');
      const a = make('a', '', s.name);
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener';
      li.append(a);
    });
    const parts: string[] = [];
    const state = i18n.maybe(`landing.state.${p.state}`);
    if (state) parts.push(state);
    if (p.dataFetchedAt)
      parts.push(
        i18n.format('landing.sources.fetched', {
          date: i18n.dateTime(new Date(p.dataFetchedAt)),
          age: span(i18n, now.getTime() - Date.parse(p.dataFetchedAt)),
        }),
      );
    if (p.elementEpoch)
      parts.push(
        i18n.format('landing.sources.elements', {
          date: i18n.dateTime(new Date(p.elementEpoch)),
          age: span(i18n, now.getTime() - Date.parse(p.elementEpoch)),
        }),
      );
    if (p.validFrom && p.validTo)
      parts.push(
        i18n.format('landing.sources.window', {
          from: p.validFrom.slice(0, 10),
          to: p.validTo.slice(0, 10),
        }),
      );
    if (p.accuracy.typicalKm !== undefined)
      parts.push(
        i18n.format('landing.sources.accuracy', {
          accuracy: `≈ ${distance(i18n, p.accuracy.typicalKm).replace(/^0 km$/, '< 1 km')}`,
        }),
      );
    li.append(make('span', `lp-prov-state state-${p.state}`), ` ${parts.join(' · ')}`);
    if (i18n.lang === 'en' && p.accuracy.note) li.append(make('span', 'lp-prov-note', ` ${p.accuracy.note}`));
    ul.append(li);
  }
  const text = ul.textContent ?? '';
  if (box.dataset['text'] === text) return;
  box.dataset['text'] = text;
  box.replaceChildren(make('p', '', i18n.t('landing.sources.computed')), ul);
}
