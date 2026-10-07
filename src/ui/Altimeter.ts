/**
 * HUD altimeter on the right edge, between the bars: a logarithmic tape of the distance from the camera to the
 * surface of the central body (or to the followed object), a caret on its left marking the current value, and the
 * reading in a fixed box below it (a moving readout distracted from the view). Dragging along the tape, clicking
 * it, the wheel over the altimeter and the arrow keys zoom: on a basic trackpad, one drag replaces many pinches.
 *
 * Ticks are rebuilt only when the range or the height changes; the per-frame update moves the caret and rewrites
 * the readout only when its text changes.
 */
import type { I18n } from '../i18n';
import { h } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const AU_KM = 149_597_870.7;
/** Readout in astronomical units from this distance on. */
const AU_FROM_KM = 1e7;
/** Smallest gap between two labelled decades (px); closer decades keep only every other label. */
const LABEL_MIN_GAP_PX = 22;
/** Minor ticks (2…9 × 10ⁿ) only when a decade spans at least this much (px). */
const MINOR_MIN_DECADE_PX = 48;
const WHEEL_K = 0.0015;
/** Width of the scale (px); must match `.altimeter` in styles.css. */
const SCALE_WIDTH_PX = 58;
const KEY_STEP = 0.15;

export interface AltimeterReading {
  /** Distance shown (km): above the surface, or to the followed object. */
  readonly valueKm: number;
  /** Range of `valueKm` the zoom limits allow. */
  readonly minKm: number;
  readonly maxKm: number;
  /** "altitude" above a surface, or "distance" to an object. */
  readonly kind: 'altitude' | 'distance';
  /** False when the scene is not to scale (solar view's logarithmic mode): the scale still zooms, without numbers. */
  readonly toScale: boolean;
}

/** Short tick label of a power of ten (km). */
function decadeLabel(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 1e3) return `${Math.round(km)}`;
  if (km < 1e6) return `${Math.round(km / 1e3)}k`;
  if (km < 1e9) return `${Math.round(km / 1e6)}M`;
  return `${Math.round(km / 1e9)}G`;
}

export class Altimeter {
  readonly element: HTMLElement;
  private readonly svg = document.createElementNS(SVG_NS, 'svg');
  private readonly caret = h('div', { class: 'altimeter-caret' });
  private readonly kindLabel = h('span', { class: 'altimeter-kind' });
  private readonly value = h('span', { class: 'altimeter-value' });
  private reading: AltimeterReading | undefined;
  private heightPx = 0;
  /** Range and height the ticks were drawn for. */
  private drawn = '';
  private shownText = '';
  private shownKind = '';
  private dragging: number | undefined;
  /** Last value requested by the wheel or keys, so quick steps add up before the camera catches up. */
  private requestedKm: number | undefined;

  constructor(
    private readonly i18n: I18n,
    /** Requests a new reading value (km, same meaning as `valueKm`), eased by the camera. */
    private readonly onZoom: (valueKm: number) => void,
  ) {
    const scale = h('div', { class: 'altimeter-scale' }, [this.svg, this.caret]);
    this.element = h(
      'div',
      { class: 'altimeter', role: 'slider', tabindex: 0, 'aria-orientation': 'vertical', hidden: true },
      [
        h('div', { class: 'altimeter-head' }, [
          this.kindLabel,
          h('span', { class: 'altimeter-unit' }, ['km']),
        ]),
        scale,
        this.value,
      ],
    );
    this.svg.setAttribute('aria-hidden', 'true');
    const el = this.element;
    // Dragging works on the tape only: a click on the readout below it must not jump to the bottom of the scale.
    scale.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      scale.setPointerCapture(e.pointerId);
      this.dragging = e.pointerId;
      this.zoomToY(e.clientY);
      e.preventDefault();
      el.focus({ preventScroll: true });
    });
    scale.addEventListener('pointermove', (e) => {
      if (this.dragging === e.pointerId) this.zoomToY(e.clientY);
    });
    const end = (e: PointerEvent): void => {
      if (this.dragging === e.pointerId) this.dragging = undefined;
    };
    scale.addEventListener('pointerup', end);
    scale.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const scaleByMode = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        this.zoomBy(e.deltaY * scaleByMode * WHEEL_K);
      },
      { passive: false },
    );
    el.addEventListener('keydown', (e) => {
      const step =
        e.key === 'ArrowUp' || e.key === 'PageUp'
          ? KEY_STEP
          : e.key === 'ArrowDown' || e.key === 'PageDown'
            ? -KEY_STEP
            : 0;
      if (!step) return;
      // The camera's own arrow-key rotation must not run too.
      e.preventDefault();
      e.stopPropagation();
      this.zoomBy(e.key.startsWith('Page') ? step * 5 : step);
    });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        this.heightPx = this.svg.parentElement?.clientHeight ?? 0;
        this.render();
      }).observe(el);
    }
    i18n.onChange(() => {
      this.shownText = '';
      this.shownKind = '';
      this.render();
    });
  }

  /** Per frame; undefined hides the altimeter. */
  update(reading: AltimeterReading | undefined): void {
    this.reading = reading;
    this.render();
  }

  private render(): void {
    const r = this.reading;
    this.element.hidden = !r;
    if (!r || this.heightPx <= 0) return;
    const minKm = Math.max(1e-4, r.minKm);
    const maxKm = Math.max(minKm * 10, r.maxKm);
    const key = `${minKm.toPrecision(4)}|${maxKm.toPrecision(4)}|${this.heightPx}`;
    if (key !== this.drawn) {
      this.drawn = key;
      this.drawTicks(minKm, maxKm);
    }
    const y = this.yOf(Math.min(maxKm, Math.max(minKm, r.valueKm)), minKm, maxKm);
    this.caret.style.transform = `translateY(${y.toFixed(1)}px)`;
    const t = this.i18n.t.bind(this.i18n);
    const kind = t(r.kind === 'altitude' ? 'altimeter.altitude' : 'altimeter.distance');
    const text = r.toScale ? this.format(r.valueKm) : '—';
    if (kind !== this.shownKind) {
      this.shownKind = kind;
      this.kindLabel.textContent = kind;
      this.element.setAttribute('aria-label', t('altimeter.aria'));
    }
    if (text !== this.shownText) {
      this.shownText = text;
      this.value.textContent = text;
      this.element.setAttribute('aria-valuetext', text);
    }
  }

  /** Distance with its unit: metres, kilometres, then astronomical units. */
  private format(km: number): string {
    const t = this.i18n.t.bind(this.i18n);
    if (km < 1) return `${this.i18n.number(km * 1000)} m`;
    if (km < AU_FROM_KM) return `${this.i18n.number(km, km < 10 ? 1 : 0)} km`;
    const au = km / AU_KM;
    return `${this.i18n.number(au, au < 10 ? 2 : 1)} ${t('altimeter.au')}`;
  }

  /** Top of the scale = farthest. */
  private yOf(km: number, minKm: number, maxKm: number): number {
    const f = Math.log(km / minKm) / Math.log(maxKm / minKm);
    return (1 - f) * this.heightPx;
  }

  private drawTicks(minKm: number, maxKm: number): void {
    const H = this.heightPx;
    const decadePx = H / Math.log10(maxKm / minKm);
    const labelEvery = Math.max(1, Math.ceil(LABEL_MIN_GAP_PX / decadePx));
    const parts: string[] = [];
    for (let e = Math.floor(Math.log10(minKm)); e <= Math.ceil(Math.log10(maxKm)); e++) {
      const decade = 10 ** e;
      for (let m = 1; m <= 9; m++) {
        const km = m * decade;
        if (km < minKm * 0.999 || km > maxKm * 1.001) continue;
        if (m > 1 && decadePx < MINOR_MIN_DECADE_PX) continue;
        const y = this.yOf(km, minKm, maxKm).toFixed(1);
        const major = m === 1;
        parts.push(
          `<line class="${major ? 'major' : 'minor'}" x1="1" x2="${major ? 10 : 5}" y1="${y}" y2="${y}"/>`,
        );
        if (major && e % labelEvery === 0) parts.push(`<text x="14" y="${y}">${decadeLabel(km)}</text>`);
      }
    }
    this.svg.setAttribute('viewBox', `0 0 ${SCALE_WIDTH_PX} ${H}`);
    this.svg.setAttribute('width', String(SCALE_WIDTH_PX));
    this.svg.setAttribute('height', String(H));
    // Static markup built from numbers only.
    this.svg.innerHTML = `<line class="spine" x1="1" x2="1" y1="0" y2="${H}"/>${parts.join('')}`;
  }

  private valueAtY(clientY: number): number | undefined {
    const r = this.reading;
    if (!r || this.heightPx <= 0) return undefined;
    const minKm = Math.max(1e-4, r.minKm);
    const maxKm = Math.max(minKm * 10, r.maxKm);
    const top = this.svg.getBoundingClientRect().top;
    const f = 1 - Math.min(1, Math.max(0, (clientY - top) / this.heightPx));
    return minKm * (maxKm / minKm) ** f;
  }

  private zoomToY(clientY: number): void {
    const km = this.valueAtY(clientY);
    this.requestedKm = undefined;
    if (km !== undefined) this.onZoom(km);
  }

  private zoomBy(k: number): void {
    const r = this.reading;
    if (!r) return;
    const from =
      this.requestedKm !== undefined && Math.abs(Math.log(this.requestedKm / r.valueKm)) > 1e-3
        ? this.requestedKm
        : r.valueKm;
    this.requestedKm = Math.min(r.maxKm, Math.max(r.minKm, from * Math.exp(k)));
    this.onZoom(this.requestedKm);
  }
}
