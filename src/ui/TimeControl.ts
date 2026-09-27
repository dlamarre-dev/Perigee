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

/** Time bar: UTC clock, live/paused status, pause, speed, back to now, jump to a date. */
export class TimeControl {
  readonly element: HTMLElement;
  private readonly timeText = h('output', { class: 'time-value', 'aria-live': 'off' });
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
  private resumeRate = 1;
  private maxRate: number = Math.max(...RATES);
  private maxRateHint = '';

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
      this.changed();
    };
    this.jumpButton.addEventListener('click', jump);
    this.jumpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') jump();
    });

    this.element = h('section', { class: 'panel time-control' }, [
      h('div', { class: 'time-readout' }, [this.timeText, this.statusBadge]),
      h('div', { class: 'time-buttons' }, [this.pauseButton, this.rateGroup, this.nowButton]),
      h('div', { class: 'time-jump' }, [this.jumpLabel, this.jumpInput, this.jumpButton]),
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
    this.timeText.value = formatUtc(this.clock.nowUtc());
    this.renderState();
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
    this.renderState();
  }

  private renderState(): void {
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
    const live = this.clock.isLive();
    this.statusBadge.textContent = paused
      ? t('time.paused')
      : live
        ? t('time.live')
        : formatRate(rate, this.i18n.lang);
    this.statusBadge.dataset['state'] = paused ? 'paused' : live ? 'live' : 'fast';
  }
}
