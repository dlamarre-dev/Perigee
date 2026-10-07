import type { SimClock } from '../astro/time';
import type { I18n } from '../i18n';
import {
  AUTO_ZONE,
  ZONE_REGIONS,
  datetimeLocalValue,
  formatWallClock,
  parseDatetimeLocal,
  saveZoneSetting,
  systemZone,
  zoneCity,
  zoneOptions,
} from '../i18n/timeZone';
import { h } from './dom';
import { fitLevels, onOneRow, watchFit } from './fit';

export const RATES = [1, 10, 100, 1_000, 10_000, 100_000] as const;

function formatRate(rate: number, lang: string): string {
  return `×${rate.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')}`;
}

/**
 * Time bar: clock in the display time zone (its name opens the zone list), live/paused status, pause, speed,
 * back to now, jump to a date (entered in the display zone).
 * When room runs short it degrades step by step to stay on one row (`data-fit`, src/ui/fit.ts): the date form
 * moves behind a calendar button, then the speed buttons give way to a list, then the phone layout (two rows).
 * Phones start at the phone layout.
 */
export class TimeControl {
  readonly element: HTMLElement;
  /**
   * Date and time, then the zone's short name pinned to the right of a fixed box (Rajdhani's digits are
   * proportional). The name sits on a transparent native list of zones: a click opens it.
   */
  private readonly timeDigits = h('span', { class: 'time-digits' });
  private readonly zoneName = h('span', { class: 'time-zone-name', 'aria-hidden': 'true' });
  private readonly zoneSelect = h('select', { class: 'time-zone-select' });
  /** Language and zone the list was built for ('' = not built yet: it is built on first use). */
  private zoneListKey = '';
  private readonly timeText = h('output', { class: 'time-value', 'aria-live': 'off' }, [
    this.timeDigits,
    h('span', { class: 'time-zone' }, [this.zoneName, this.zoneSelect]),
  ]);
  private readonly statusBadge = h('span', { class: 'badge' });
  private readonly pauseButton = h('button', {
    type: 'button',
    class: 'btn pause-toggle',
    'data-testid': 'pause',
  });
  private readonly nowButton = h('button', { type: 'button', class: 'btn' });
  private readonly rateGroup = h('div', { class: 'segmented', role: 'group' });
  private readonly rateButtons: HTMLButtonElement[];
  private readonly jumpLabel = h('label', { class: 'visually-hidden', for: 'time-jump' });
  private readonly jumpInput = h('input', {
    id: 'time-jump',
    type: 'datetime-local',
    step: 1,
    class: 'input',
  });
  private readonly jumpButton = h('button', { type: 'button', class: 'btn' });
  private readonly rateSelect = h('select', { class: 'input rate-select' });
  private readonly jumpToggle = h('button', {
    type: 'button',
    class: 'btn jump-toggle icon-calendar',
    'aria-expanded': 'false',
    'aria-controls': 'time-jump-form',
  });
  private readonly jumpForm = h('div', { class: 'time-jump', id: 'time-jump-form' });
  private resumeRate = 1;
  private maxRate: number = Math.max(...RATES);
  private maxRateHint = '';
  /** Clock state the buttons were last rendered for. */
  private stateKey = '';

  constructor(
    private readonly clock: SimClock,
    private readonly i18n: I18n,
    private readonly onChange: () => void,
  ) {
    this.rateButtons = RATES.map((rate) => {
      const b = h('button', { type: 'button', class: 'btn', 'data-rate': rate });
      b.addEventListener('click', () => {
        this.clock.setRate(rate);
        this.changed();
      });
      return b;
    });
    this.rateGroup.append(...this.rateButtons);
    this.rateSelect.append(...RATES.map((rate) => h('option', { value: String(rate) })));
    this.rateSelect.addEventListener('change', () => {
      this.clock.setRate(Number(this.rateSelect.value));
      this.changed();
    });
    this.jumpToggle.addEventListener('click', () => {
      const open = !this.element.classList.contains('jump-open');
      this.element.classList.toggle('jump-open', open);
      this.jumpToggle.setAttribute('aria-expanded', String(open));
      if (open) this.jumpInput.focus();
    });

    this.pauseButton.addEventListener('click', () => {
      if (this.clock.paused) {
        this.clock.setRate(this.resumeRate);
      } else {
        this.resumeRate = this.clock.rate;
        this.clock.setRate(0);
      }
      this.changed();
    });
    this.nowButton.addEventListener('click', () => {
      this.clock.goLive();
      this.changed();
    });
    // The list of ~400 zones is built when first opened (pointer or keyboard), then on language changes.
    for (const type of ['pointerdown', 'focus'] as const)
      this.zoneSelect.addEventListener(type, () => this.buildZoneList());
    this.zoneSelect.addEventListener('change', () => {
      const setting = this.zoneSelect.value;
      saveZoneSetting(setting);
      this.i18n.setTimeZone(setting);
      this.update();
    });
    // The date field starts at the displayed date, in the display zone.
    this.jumpInput.addEventListener('focus', () => {
      if (!this.jumpInput.value)
        this.jumpInput.value = datetimeLocalValue(this.clock.nowUtc(), this.i18n.timeZone);
    });
    const jump = (): void => {
      const d = parseDatetimeLocal(this.jumpInput.value, this.i18n.timeZone);
      if (!d) return;
      this.clock.jumpTo(d);
      this.element.classList.remove('jump-open');
      this.jumpToggle.setAttribute('aria-expanded', 'false');
      this.changed();
    };
    this.jumpButton.addEventListener('click', jump);
    this.jumpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') jump();
    });

    this.jumpForm.append(this.jumpLabel, this.jumpInput, this.jumpButton);
    this.element = h('section', { class: 'panel time-control' }, [
      h('div', { class: 'time-readout' }, [this.timeText, this.statusBadge, this.jumpToggle]),
      h('div', { class: 'time-buttons' }, [
        this.pauseButton,
        this.rateGroup,
        this.rateSelect,
        this.nowButton,
      ]),
      this.jumpForm,
    ]);

    i18n.onChange(() => this.renderLabels());
    this.renderLabels();
    this.update();
    this.refit = watchFit(() => this.fit());
    this.phone.addEventListener('change', this.refit);
  }

  private readonly phone = matchMedia('(max-width: 640px)');
  private readonly refit: () => void;

  /** Fullest presentation on one row; the date form, once behind its button, opens on a row of its own. */
  private fit(): void {
    const el = this.element;
    const levels = this.phone.matches ? ['phone'] : ['full', 'calendar', 'select', 'phone'];
    const level = fitLevels(
      el,
      levels,
      (l) =>
        l === 'phone' ||
        (onOneRow(el, (item) => l !== 'full' && item === this.jumpForm) &&
          el.scrollWidth <= el.clientWidth + 1),
    );
    if (level === 'full' && el.classList.contains('jump-open')) {
      el.classList.remove('jump-open');
      this.jumpToggle.setAttribute('aria-expanded', 'false');
    }
  }

  /**
   * Highest speed the current view supports (faster buttons are disabled, with `hint` as tooltip); a faster
   * running clock is slowed down to it.
   */
  setMaxRate(maxRate: number, hint: string): void {
    this.maxRate = maxRate;
    this.maxRateHint = hint;
    if (Math.abs(this.clock.rate) > maxRate) this.clock.setRate(Math.sign(this.clock.rate) * maxRate);
    if (this.resumeRate > maxRate) this.resumeRate = maxRate;
    this.changed();
  }

  /** Refreshes the clock readout; call a few times per second. */
  update(): void {
    const now = this.clock.nowUtc();
    const text = formatWallClock(now, this.i18n.timeZone, true);
    if (this.timeDigits.textContent !== text) this.timeDigits.textContent = text;
    // Daylight saving follows the displayed date (a jump to January shows standard time).
    const zone = this.i18n.zoneAbbreviation(now);
    if (this.zoneName.textContent !== zone) this.zoneName.textContent = zone;
    // The buttons only change with the clock's state (an action, a view's speed limit, the language).
    if (this.signature() !== this.stateKey) this.renderState();
  }

  private changed(): void {
    this.renderState();
    this.update();
    this.onChange();
  }

  /** Fills the zone list (computer's zone, UTC, then every zone by region), unless already up to date. */
  private buildZoneList(): void {
    const i18n = this.i18n;
    const key = `${i18n.lang}|${i18n.timeZoneSetting}`;
    if (key === this.zoneListKey) return;
    this.zoneListKey = key;
    const t = (k: Parameters<I18n['t']>[0]): string => i18n.t(k);
    const options = zoneOptions(i18n.locale, new Date());
    const groups = ZONE_REGIONS.map((region) =>
      h(
        'optgroup',
        { label: t(`tz.region.${region}`) },
        options.filter((o) => o.region === region).map((o) => h('option', { value: o.id }, [o.label])),
      ),
    ).filter((g) => g.children.length > 0);
    this.zoneSelect.replaceChildren(
      h('option', { value: AUTO_ZONE }, [`${t('tz.auto')} (${zoneCity(systemZone())})`]),
      h('option', { value: 'UTC' }, [t('tz.utc')]),
      ...groups,
    );
    this.zoneSelect.value = i18n.timeZoneSetting;
  }

  private renderLabels(): void {
    const t = (k: Parameters<I18n['t']>[0]): string => this.i18n.t(k);
    // Labels change width with the language.
    this.refit?.();
    this.element.setAttribute('aria-label', t('time.label'));
    this.rateGroup.setAttribute('aria-label', t('time.rate'));
    this.nowButton.textContent = t('time.now');
    this.nowButton.title = t('time.now.hint');
    const jumpText = this.i18n.format('time.jump', {
      zone: this.i18n.zoneAbbreviation(this.clock.nowUtc()),
    });
    this.jumpLabel.textContent = jumpText;
    this.jumpInput.title = jumpText;
    // Refilled in the (possibly new) zone on next focus.
    this.jumpInput.value = '';
    this.zoneSelect.setAttribute('aria-label', t('time.zone'));
    this.zoneSelect.title = t('time.zone');
    if (this.zoneListKey) this.buildZoneList();
    else
      this.zoneSelect.replaceChildren(
        h('option', { value: this.i18n.timeZoneSetting }, [this.i18n.timeZone]),
      );
    this.jumpButton.textContent = t('time.jump.apply');
    this.rateButtons.forEach((b, i) => (b.textContent = formatRate(RATES[i] ?? 1, this.i18n.lang)));
    this.rateSelect.setAttribute('aria-label', t('time.rate'));
    [...this.rateSelect.options].forEach(
      (o) => (o.textContent = formatRate(Number(o.value), this.i18n.lang)),
    );
    this.jumpToggle.setAttribute('aria-label', t('time.jump.toggle'));
    this.jumpToggle.title = t('time.jump.toggle');
    this.renderState();
  }

  private signature(): string {
    const c = this.clock;
    return `${c.paused}|${c.rate}|${c.isLive()}|${this.maxRate}|${this.maxRateHint}|${this.i18n.lang}`;
  }

  private renderState(): void {
    this.stateKey = this.signature();
    const t = (k: Parameters<I18n['t']>[0]): string => this.i18n.t(k);
    const paused = this.clock.paused;
    this.pauseButton.textContent = paused ? `▶ ${t('time.play')}` : `❚❚ ${t('time.pause')}`;
    this.pauseButton.setAttribute('aria-pressed', String(paused));
    const rate = this.clock.rate;
    this.rateButtons.forEach((b, i) => {
      const r = RATES[i] ?? 1;
      b.setAttribute('aria-pressed', String(!paused && r === rate));
      b.disabled = r > this.maxRate;
      b.title = b.disabled ? this.maxRateHint : '';
    });
    [...this.rateSelect.options].forEach((o) => (o.disabled = Number(o.value) > this.maxRate));
    // Paused: the select shows the speed play will resume at.
    this.rateSelect.value = String(paused ? this.resumeRate : rate);
    const live = this.clock.isLive();
    this.statusBadge.textContent = paused
      ? t('time.paused')
      : live
        ? t('time.live')
        : formatRate(rate, this.i18n.lang);
    this.statusBadge.dataset['state'] = paused ? 'paused' : live ? 'live' : 'fast';
  }
}
