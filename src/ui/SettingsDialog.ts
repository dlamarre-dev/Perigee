/**
 * Settings window (gear button of the top bar), centred like About: the quality tier and the visual effects, then
 * the controls drawn like a video-game menu — a mouse and a keyboard with the keys in use lit and labelled, adapted
 * to the platform (⌥ option on a Mac, Alt elsewhere), or the touch gestures only on a touch-only device. Nothing is
 * configurable: the controls are those of src/camera/QuaternionOrbitControls.ts and src/app/main.ts.
 */
import type { I18n, MessageKey } from '../i18n';
import { EFFECT_NAMES, effectPrefs, setEffectEnabled, type EffectName } from '../render/effects';
import { QUALITY_CHOICES, quality, type QualityChoice, type QualityTier } from '../render/quality';
import { h, scrollingDialog } from './dom';

/** Action groups of the controls: each has its colour on the keyboard and in the legends. */
type Action = 'rotate' | 'pan' | 'roll' | 'zoom' | 'select' | 'follow' | 'reset' | 'close';

interface Platform {
  readonly mac: boolean;
  /** No mouse or trackpad: only the touch gestures are shown. */
  readonly touchOnly: boolean;
}

function detectPlatform(): Platform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const name = nav.userAgentData?.platform ?? nav.platform ?? '';
  const coarse = matchMedia('(pointer: coarse)').matches;
  const fine = matchMedia('(any-pointer: fine)').matches;
  return { mac: /mac|iphone|ipad|ipod/i.test(name), touchOnly: coarse && !fine };
}

/** A key of the drawn keyboard: its cap, its width (in key units) and the action it triggers, if any. */
interface Key {
  readonly cap: string;
  readonly width?: number;
  readonly action?: Action;
  /** Accessible name when the cap is a symbol. */
  readonly name?: string;
}

function keyboardRows(mac: boolean): Key[][] {
  const letters = (s: string, actions: Record<string, Action> = {}): Key[] =>
    [...s].map((c) => ({ cap: c, ...(actions[c] ? { action: actions[c] } : {}) }));
  const alt: Key = mac
    ? { cap: '⌥ option', width: 1.5, action: 'pan', name: 'Option' }
    : { cap: 'Alt', width: 1.5, action: 'pan' };
  return [
    [
      { cap: 'Esc', width: 1.25, action: 'close' },
      ...letters('1234567890'),
      { cap: '−', action: 'zoom', name: 'minus' },
      { cap: '+ =', action: 'zoom', name: 'plus' },
    ],
    [{ cap: 'Tab', width: 1.5 }, ...letters('QWERTYUIOP', { Q: 'roll', E: 'roll', R: 'reset' })],
    [{ cap: '', width: 1.75 }, ...letters('ASDFGHJKL', { F: 'follow' })],
    [{ cap: '⇧', width: 2.25, name: 'Shift' }, ...letters('ZXCVBNM')],
    mac
      ? [
          { cap: 'control', width: 1.5 },
          alt,
          { cap: '⌘', width: 1.5, name: 'Command' },
          { cap: '', width: 6 },
        ]
      : [{ cap: 'Ctrl', width: 1.5 }, { cap: 'Win', width: 1.25 }, alt, { cap: '', width: 6 }],
  ];
}

/** Inline SVG (static markup, no user data). */
function svg(markup: string, className: string): HTMLElement {
  const box = h('div', { class: className, 'aria-hidden': 'true' });
  box.innerHTML = markup;
  return box;
}

const MOUSE_SVG = `<svg viewBox="0 0 120 180" fill="none" stroke-width="2">
  <path d="M60 6 C30 6 14 26 14 58 V118 C14 152 34 174 60 174 C86 174 106 152 106 118 V58 C106 26 90 6 60 6 Z"
    stroke="var(--line-strong)" fill="rgb(255 255 255 / 3%)"/>
  <path d="M60 6 C30 6 14 26 14 58 V74 H60 Z" class="part rotate"/>
  <path d="M60 6 C90 6 106 26 106 58 V74 H60 Z" class="part roll"/>
  <rect x="53" y="24" width="14" height="30" rx="7" class="part zoom"/>
  <path d="M60 6 V74 M14 74 H106" stroke="var(--line-strong)"/>
</svg>`;

/** Fingers (filled circles) and their motion (arrows) for each touch gesture. */
const GESTURE_SVG: Readonly<Record<string, string>> = {
  rotate: `<circle cx="32" cy="40" r="9"/><path d="M45 40 H70 M62 33 L70 40 L62 47"/>`,
  select: `<circle cx="40" cy="40" r="9"/><circle cx="40" cy="40" r="17" class="ring"/>`,
  follow: `<circle cx="40" cy="40" r="9"/><circle cx="40" cy="40" r="17" class="ring"/><circle cx="40" cy="40" r="25" class="ring"/>`,
  zoom: `<circle cx="28" cy="52" r="8"/><circle cx="52" cy="28" r="8"/><path d="M20 60 L10 70 M10 62 V70 H18 M60 20 L70 10 M62 10 H70 V18"/>`,
  roll: `<circle cx="24" cy="40" r="8"/><circle cx="56" cy="40" r="8"/><path d="M24 26 A18 18 0 0 1 56 26 M50 20 L56 26 L48 28 M56 54 A18 18 0 0 1 24 54 M30 60 L24 54 L32 52"/>`,
  pan: `<circle cx="22" cy="30" r="7"/><circle cx="40" cy="24" r="7"/><circle cx="58" cy="30" r="7"/><path d="M40 44 V70 M33 63 L40 70 L47 63"/>`,
};

export interface SettingsOptions {
  readonly qualityChoice: QualityChoice;
  /** Tier detected for this device, named in the quality hint. */
  readonly detectedTier: QualityTier;
  /** Quality chosen (the page reloads to apply it). */
  readonly onQualityChange: (choice: QualityChoice) => void;
}

export class SettingsDialog {
  readonly element: HTMLDialogElement;
  private readonly title = h('h2', { id: 'settings-title', tabindex: -1 });
  private readonly qualityLabel = h('label', { class: 'group-label', for: 'quality-select' });
  private readonly qualitySelect = h('select', { class: 'input quality-select', id: 'quality-select' });
  private readonly effectLabels = new Map<EffectName, HTMLElement>();
  private readonly effectsNote = h('p', { class: 'muted small effects-note' });
  private readonly controlsTitle = h('h3');
  private readonly controls = h('div', { class: 'controls' });
  private readonly close = h('button', { type: 'button', class: 'btn' });
  private platform = detectPlatform();

  constructor(
    private readonly i18n: I18n,
    private readonly options: SettingsOptions,
  ) {
    this.qualitySelect.append(...QUALITY_CHOICES.map((c) => h('option', { value: c })));
    this.qualitySelect.value = options.qualityChoice;
    this.qualitySelect.addEventListener('change', () =>
      options.onQualityChange(this.qualitySelect.value as QualityChoice),
    );
    const effectsOn = quality().immersiveEffects;
    const prefs = effectPrefs();
    const effectRows = EFFECT_NAMES.map((name) => {
      const id = `effect-${name}`;
      const box = h('input', { type: 'checkbox', id, checked: prefs[name], disabled: !effectsOn });
      box.addEventListener('change', () => setEffectEnabled(name, box.checked));
      const label = h('label', { for: id });
      this.effectLabels.set(name, label);
      return h('div', { class: 'effect-row' }, [box, label]);
    });
    this.effectsNote.hidden = effectsOn;
    this.close.addEventListener('click', () => this.element.close());
    this.element = h('dialog', { class: 'panel about settings', 'aria-labelledby': 'settings-title' }, [
      this.title,
      h('div', { class: 'quality-row' }, [this.qualityLabel, this.qualitySelect]),
      ...effectRows,
      this.effectsNote,
      this.controlsTitle,
      this.controls,
      h('div', { class: 'dialog-actions' }, [this.close]),
    ]);
    scrollingDialog(this.element);
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
    i18n.onChange(() => this.render());
    this.render();
  }

  open(): void {
    // A keyboard or a mouse may have been plugged in since the page loaded.
    this.platform = detectPlatform();
    this.renderControls();
    this.element.showModal();
    this.title.focus({ preventScroll: true });
    const body = this.element.querySelector('.dialog-body');
    if (body) body.scrollTop = 0;
  }

  private render(): void {
    const t = this.i18n.t.bind(this.i18n);
    this.title.textContent = t('toolbar.settings');
    this.qualityLabel.textContent = t('toolbar.quality');
    this.qualitySelect.title = this.i18n.format('toolbar.quality.hint', {
      tier: t(`quality.${this.options.detectedTier}`),
    });
    for (const option of this.qualitySelect.options)
      option.textContent = t(`quality.${option.value as QualityChoice}`);
    for (const [name, label] of this.effectLabels) label.textContent = t(`effects.${name}`);
    this.effectsNote.textContent = t('effects.highOnly');
    this.controlsTitle.textContent = t('controls.title');
    this.close.textContent = t('about.close');
    this.renderControls();
  }

  private renderControls(): void {
    this.controls.replaceChildren(
      ...(this.platform.touchOnly ? [this.touchSection()] : [this.mouseSection(), this.keyboardSection()]),
    );
  }

  /** "⌥ option" on a Mac, "Alt" elsewhere. */
  private get altCap(): string {
    return this.platform.mac ? '⌥ option' : 'Alt';
  }

  /** Mouse drawing with its callouts: left button on the left, right button and wheel on the right. */
  private mouseSection(): HTMLElement {
    const t = (k: MessageKey): string => this.i18n.t(k);
    const callout = (part: string, side: 'left' | 'right', lines: [string, Action, string][]): HTMLElement =>
      h('div', { class: `callout ${side}` }, [
        h('p', { class: 'callout-part' }, [part]),
        h(
          'ul',
          {},
          lines.map(([input, action, label]) =>
            h('li', { 'data-action': action }, [h('span', { class: 'binding' }, [input]), ' ', label]),
          ),
        ),
      ]);
    return h('section', { class: 'controls-block' }, [
      h('h4', {}, [t('controls.mouse')]),
      h('div', { class: 'mouse-map' }, [
        callout(t('controls.leftButton'), 'left', [
          [t('controls.drag'), 'rotate', t('controls.rotate')],
          [`${this.altCap} + ${t('controls.drag')}`, 'pan', t('controls.pan')],
          [t('controls.click'), 'select', t('controls.select')],
          [t('controls.doubleClick'), 'follow', t('controls.follow')],
        ]),
        svg(MOUSE_SVG, 'mouse-figure'),
        h('div', { class: 'callout-stack' }, [
          callout(t('controls.wheel'), 'right', [[t('controls.scroll'), 'zoom', t('controls.zoom')]]),
          callout(t('controls.rightButton'), 'right', [[t('controls.drag'), 'roll', t('controls.roll')]]),
        ]),
      ]),
    ]);
  }

  /** Keyboard with the keys in use lit in their action's colour, then the legend. */
  private keyboardSection(): HTMLElement {
    const t = (k: MessageKey): string => this.i18n.t(k);
    const keyEl = (k: Key): HTMLElement =>
      h(
        'span',
        {
          class: `key${k.action ? ' on' : ''}`,
          style: `flex-grow: ${k.width ?? 1}`,
          ...(k.action ? { 'data-action': k.action } : {}),
        },
        [k.cap],
      );
    const rows = keyboardRows(this.platform.mac).map((row) => h('div', { class: 'key-row' }, row.map(keyEl)));
    const arrows = h('div', { class: 'arrow-keys' }, [
      h('div', { class: 'key-row' }, [
        h('span', { class: 'key spacer' }),
        keyEl({ cap: '↑', action: 'rotate' }),
        h('span', { class: 'key spacer' }),
      ]),
      h(
        'div',
        { class: 'key-row' },
        ['←', '↓', '→'].map((cap) => keyEl({ cap, action: 'rotate' })),
      ),
    ]);
    const kbd = (cap: string): HTMLElement => h('kbd', {}, [cap]);
    const legend: [(HTMLElement | string)[], Action, MessageKey][] = [
      [[kbd('←'), kbd('↑'), kbd('↓'), kbd('→')], 'rotate', 'controls.rotate'],
      [[kbd(this.altCap), '+', kbd('←↑↓→')], 'pan', 'controls.pan'],
      [[kbd('Q'), kbd('E')], 'roll', 'controls.roll'],
      [[kbd('+'), kbd('−')], 'zoom', 'controls.zoom'],
      [[kbd('F')], 'follow', 'controls.followKey'],
      [[kbd('R')], 'reset', 'controls.reset'],
      [[kbd('Esc')], 'close', 'controls.close'],
    ];
    return h('section', { class: 'controls-block' }, [
      h('h4', {}, [t('controls.keyboard')]),
      h('div', { class: 'keyboard-map', role: 'img', 'aria-label': t('controls.keyboard') }, [
        h('div', { class: 'main-keys' }, rows),
        arrows,
      ]),
      h(
        'ul',
        { class: 'key-legend' },
        legend.map(([caps, action, label]) =>
          h('li', { 'data-action': action }, [h('span', { class: 'caps' }, caps), h('span', {}, [t(label)])]),
        ),
      ),
    ]);
  }

  /** Touch gestures only (no mouse or keyboard on this device). */
  private touchSection(): HTMLElement {
    const t = (k: MessageKey): string => this.i18n.t(k);
    const cards: [string, Action, MessageKey, MessageKey][] = [
      ['rotate', 'rotate', 'controls.touchDrag', 'controls.rotate'],
      ['select', 'select', 'controls.tap', 'controls.select'],
      ['follow', 'follow', 'controls.doubleTap', 'controls.follow'],
      ['zoom', 'zoom', 'controls.pinch', 'controls.zoom'],
      ['roll', 'roll', 'controls.twist', 'controls.roll'],
      ['pan', 'pan', 'controls.threeFingerDrag', 'controls.pan'],
    ];
    return h('section', { class: 'controls-block' }, [
      h('h4', {}, [t('controls.touch')]),
      h(
        'ul',
        { class: 'gestures' },
        cards.map(([icon, action, gesture, label]) =>
          h('li', { 'data-action': action }, [
            svg(`<svg viewBox="0 0 80 80">${GESTURE_SVG[icon] ?? ''}</svg>`, 'gesture-figure'),
            h('span', { class: 'binding' }, [t(gesture)]),
            h('span', {}, [t(label)]),
          ]),
        ),
      ),
    ]);
  }
}
