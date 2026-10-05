import type { SimClock } from '../astro/time';
import type { I18n } from '../i18n';
import { h } from './dom';

export const RATES = [1, 10, 100, 1_000, 10_000, 100_000] as const;

/** Formats a date as "YYYY-MM-DD HH:MM:SS UTC". */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function formatRate(rate: number, lang: string): string {
  return `×${rate.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')}`;
}

/**
 * Time bar: UTC clock, live/paused status, pause, speed, back to now, jump to a date.
 * On phones (CSS) the speed buttons give way to a native select and the date form opens from a toggle.
 */
export class TimeControl {
  readonly element: HTMLElement;
  /** Date and time, then "UTC" pinned to the right of a fixed box (Rajdhani's digits are proportional). */
  private readonly timeDigits = h('span', { class: 'time-digits' });
  private readonly timeText = h('output', { class: 'time-value', 'aria-live': 'off' }, [
    this.timeDigits,
    h('span', { class: 'time-zone' }, ['UTC']),
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
    class: 'btn jump-toggle',
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
    this.jumpToggle.textContent = '📅';
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
    const jump = (): void => {
      const d = new Date(`${this.jumpInput.value}Z`);
      if (Number.isNaN(d.getTime())) return;
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
    const text = formatUtc(this.clock.nowUtc()).replace(/ UTC$/, '');
    if (this.timeDigits.textContent !== text) this.timeDigits.textContent = text;
    // The buttons only change with the clock's state (an action, a view's speed limit, the language).
    if (this.signature() !== this.stateKey) this.renderState();
  }

  private changed(): void {
    this.renderState();
    this.update();
    this.onChange();
  }

  private renderLabels(): void {
    const t = (k: Parameters<I18n['t']>[0]): string => this.i18n.t(k);
    this.element.setAttribute('aria-label', t('time.label'));
    this.rateGroup.setAttribute('aria-label', t('time.rate'));
    this.nowButton.textContent = t('time.now');
    this.nowButton.title = t('time.now.hint');
    this.jumpLabel.textContent = t('time.jump');
    this.jumpInput.title = t('time.jump');
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
