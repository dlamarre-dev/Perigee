import { VIEW_IDS, type FrameMode, type ViewId } from '../app/urlState';
import { LANGS, type I18n, type Lang, type MessageKey } from '../i18n';
import { QUALITY_CHOICES, type QualityChoice, type QualityTier } from '../render/quality';
import { h } from './dom';
import { fitLevels, onOneRow, watchFit } from './fit';

export interface ToolbarCallbacks {
  readonly onViewChange: (view: ViewId) => void;
  readonly onRecenter: () => void;
  readonly onFrameChange: (mode: FrameMode) => void;
  readonly onLangChange: (lang: Lang) => void;
  readonly onAbout: () => void;
  readonly onReport: () => void;
  readonly onPhoto: () => void;
  /** Quality setting chosen in the menu (the page reloads to apply it). */
  readonly onQualityChange: (choice: QualityChoice) => void;
  readonly onTogglePanel: () => void;
  /** Soundtrack player (menu entry on phones, where its floating button is hidden). */
  readonly onSoundtrack: () => void;
}

export const VIEW_LABELS: Record<ViewId, MessageKey> = {
  earth: 'view.earth',
  moon: 'view.moon',
  mars: 'view.mars',
  solar: 'view.solar',
};
const SHORT_VIEW_LABELS: Record<ViewId, MessageKey> = {
  earth: 'view.earth',
  moon: 'view.moon',
  mars: 'view.mars',
  solar: 'view.solar.short',
};
const FIXED_FRAME_LABELS: Record<ViewId, MessageKey> = {
  earth: 'toolbar.frame.fixed',
  moon: 'toolbar.frame.fixed.moon',
  mars: 'toolbar.frame.fixed.mars',
  solar: 'toolbar.frame.fixed.solar',
};

/**
 * Top bar: title, view switch, side-panel toggle, recenter, frame toggle, language switch, quality, about, report.
 * When room runs short it degrades step by step instead of wrapping (`data-fit`, src/ui/fit.ts): short labels
 * ("Solar", "?", "@"), then everything but the title and the view tabs folds into a "☰" menu, the tabs on the
 * title's row, or below it when even that does not fit. Phones start at the menu.
 */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly title = h('h1', { class: 'brand' });
  private readonly viewGroup = h('div', { class: 'segmented view-tabs', role: 'group' });
  private readonly viewButtons: Record<ViewId, HTMLButtonElement>;
  private readonly panel = h('button', {
    type: 'button',
    class: 'btn',
    'aria-controls': 'side-panel',
    'aria-expanded': 'false',
  });
  private readonly recenter = h('button', { type: 'button', class: 'btn' });
  private readonly frameLabel = h('span', { class: 'group-label' });
  private readonly frameGroup = h('div', { class: 'segmented', role: 'group' });
  private readonly frameButtons: Record<FrameMode, HTMLButtonElement> = {
    fixed: h('button', { type: 'button', class: 'btn', 'data-frame': 'fixed' }),
    inertial: h('button', { type: 'button', class: 'btn', 'data-frame': 'inertial' }),
  };
  private readonly langGroup = h('div', { class: 'segmented', role: 'group' });
  private readonly langButtons: HTMLButtonElement[];
  private readonly qualityLabel = h('label', { class: 'group-label quality-label', for: 'quality-select' });
  private readonly qualitySelect = h('select', { class: 'input quality-select', id: 'quality-select' });
  private readonly about = h('button', { type: 'button', class: 'btn' });
  private readonly report = h('button', { type: 'button', class: 'btn' });
  /** Camera icon on large screens, "Photo" in the phone menu. */
  private readonly photoText = h('span', { class: 'photo-text' });
  private readonly photo = h('button', { type: 'button', class: 'btn photo-button' }, [
    h('span', { class: 'photo-icon', 'aria-hidden': 'true' }),
    this.photoText,
  ]);
  private readonly soundtrack = h('button', { type: 'button', class: 'btn mobile-only' });
  private readonly menuButton = h('button', {
    type: 'button',
    class: 'btn menu-toggle',
    'aria-expanded': 'false',
    'aria-controls': 'toolbar-menu',
  });
  private readonly menu = h('div', { class: 'toolbar-menu', id: 'toolbar-menu' });
  /**
   * Long and short label spans of the view tabs, About and Report, created once: re-creating them on every
   * label refresh removed the node under the pointer, and Chrome then left the old button stuck in :hover
   * (seen when switching views quickly while one was loading).
   */
  private readonly labelSpans = new Map<HTMLElement, { long: HTMLElement; short: HTMLElement }>();
  private frame: FrameMode;
  private view: ViewId;
  private panelLabel: MessageKey | undefined;
  private readonly phone = matchMedia('(max-width: 640px)');
  private readonly refit: () => void;

  constructor(
    private readonly i18n: I18n,
    initialView: ViewId,
    initialFrame: FrameMode,
    callbacks: ToolbarCallbacks,
    qualityChoice: QualityChoice = 'auto',
    /** Tier detected for this device, shown next to "Auto". */
    private readonly detectedTier: QualityTier = 'high',
  ) {
    this.frame = initialFrame;
    this.view = initialView;
    this.viewButtons = Object.fromEntries(
      VIEW_IDS.map((id) => {
        const b = h('button', { type: 'button', class: 'btn', 'data-view': id });
        b.addEventListener('click', () => {
          if (this.view === id) return;
          callbacks.onViewChange(id);
        });
        return [id, b];
      }),
    ) as Record<ViewId, HTMLButtonElement>;
    this.viewGroup.append(...VIEW_IDS.map((id) => this.viewButtons[id]));

    this.recenter.addEventListener('click', callbacks.onRecenter);
    this.about.addEventListener('click', callbacks.onAbout);
    this.report.addEventListener('click', callbacks.onReport);
    this.photo.addEventListener('click', callbacks.onPhoto);
    this.panel.addEventListener('click', callbacks.onTogglePanel);
    for (const mode of ['fixed', 'inertial'] as const) {
      this.frameButtons[mode].addEventListener('click', () => {
        if (this.frame === mode) return;
        this.frame = mode;
        callbacks.onFrameChange(mode);
        this.renderState();
      });
    }
    this.frameGroup.append(this.frameButtons.fixed, this.frameButtons.inertial);

    this.langButtons = LANGS.map((lang) => {
      const b = h('button', { type: 'button', class: 'btn', lang, 'data-lang': lang }, [lang.toUpperCase()]);
      b.addEventListener('click', () => callbacks.onLangChange(lang));
      return b;
    });
    this.langGroup.append(...this.langButtons);

    this.qualitySelect.append(...QUALITY_CHOICES.map((c) => h('option', { value: c })));
    this.qualitySelect.value = qualityChoice;
    this.qualitySelect.addEventListener('change', () =>
      callbacks.onQualityChange(this.qualitySelect.value as QualityChoice),
    );

    this.soundtrack.addEventListener('click', callbacks.onSoundtrack);
    this.menu.append(
      this.panel,
      this.recenter,
      h('div', { class: 'toolbar-group' }, [this.frameLabel, this.frameGroup]),
      this.langGroup,
      h('div', { class: 'toolbar-group' }, [this.qualityLabel, this.qualitySelect]),
      this.photo,
      this.soundtrack,
      this.about,
      this.report,
    );
    this.element = h('header', { class: 'panel toolbar' }, [
      this.title,
      this.menuButton,
      this.viewGroup,
      this.menu,
    ]);
    this.menuButton.addEventListener('click', () => this.setMenuOpen(!this.menuOpen));
    // Any action in the menu closes it (phones); Escape and outside clicks too.
    this.menu.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.setMenuOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.menuOpen) {
        this.setMenuOpen(false);
        this.menuButton.focus();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.menuOpen && !this.element.contains(e.target as Node)) this.setMenuOpen(false);
    });

    i18n.onChange(() => this.renderLabels());
    this.renderLabels();
    this.refit = watchFit(() => this.fit());
    this.phone.addEventListener('change', this.refit);
  }

  private menuOpen = false;

  /** Fullest presentation that keeps the bar on one row (the menu's own dropdown row does not count). */
  private fit(): void {
    const levels = this.phone.matches ? ['menu', 'menu-stacked'] : ['full', 'short', 'menu', 'menu-stacked'];
    const el = this.element;
    // One row, and nothing pushed past the edge (the menu layout is a grid: it overflows instead of wrapping).
    const level = fitLevels(
      el,
      levels,
      () =>
        onOneRow(el, (item) => item.classList.contains('toolbar-menu')) &&
        el.scrollWidth <= el.clientWidth + 1,
    );
    if (!level.startsWith('menu') && this.menuOpen) this.setMenuOpen(false);
  }

  private setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.element.classList.toggle('menu-open', open);
    this.menuButton.setAttribute('aria-expanded', String(open));
  }

  setView(view: ViewId): void {
    this.view = view;
    this.renderLabels();
  }

  /** Side-panel button: label and pressed state; undefined label hides it. */
  setPanel(labelKey: MessageKey | undefined, open = false): void {
    this.panelLabel = labelKey;
    this.panel.hidden = labelKey === undefined;
    this.setPanelOpen(open);
    this.renderLabels();
  }

  setPanelOpen(open: boolean): void {
    this.panel.setAttribute('aria-expanded', String(open));
    this.panel.setAttribute('aria-pressed', String(open));
  }

  private renderLabels(): void {
    const t = this.i18n.t.bind(this.i18n);
    this.title.textContent = t('app.brand');
    this.qualityLabel.textContent = t('toolbar.quality');
    this.photoText.textContent = t('toolbar.photo');
    this.photo.title = t('toolbar.photo.hint');
    this.photo.setAttribute('aria-label', t('toolbar.photo.hint'));
    const detected = t(`quality.${this.detectedTier}`);
    this.qualitySelect.title = this.i18n.format('toolbar.quality.hint', { tier: detected });
    for (const option of this.qualitySelect.options) {
      const c = option.value as QualityChoice;
      option.textContent = t(`quality.${c}`);
    }
    this.viewGroup.setAttribute('aria-label', t('toolbar.view'));
    for (const id of VIEW_IDS) {
      // Short label on phones (CSS picks one), full one elsewhere and for assistive technologies.
      const b = this.viewButtons[id];
      b.setAttribute('aria-label', t(VIEW_LABELS[id]));
      this.setLabels(b, t(VIEW_LABELS[id]), t(SHORT_VIEW_LABELS[id]));
    }
    this.menuButton.textContent = '☰';
    this.menuButton.setAttribute('aria-label', t('toolbar.menu'));
    this.soundtrack.textContent = `♪ ${t('music.show')}`;
    if (this.panelLabel) this.panel.textContent = t(this.panelLabel);
    this.recenter.textContent = t('toolbar.recenter');
    this.recenter.title = t('toolbar.recenter.hint');
    this.frameLabel.textContent = t('toolbar.frame');
    this.frameGroup.setAttribute('aria-label', t('toolbar.frame'));
    this.frameGroup.title = t('toolbar.frame.hint');
    this.frameButtons.fixed.textContent = t(FIXED_FRAME_LABELS[this.view]);
    this.frameButtons.inertial.textContent = t('toolbar.frame.inertial');
    this.langGroup.setAttribute('aria-label', t('toolbar.language'));
    // Short forms ("?", "@") when room is short; the full name stays for assistive technologies and tooltips.
    for (const [button, key, short] of [
      [this.about, 'toolbar.about', '?'],
      [this.report, 'toolbar.report', '@'],
    ] as const) {
      button.setAttribute('aria-label', t(key));
      button.title = t(key);
      this.setLabels(button, t(key), short);
    }
    this.renderState();
    // Labels change width with the language, the view and the panel button.
    this.refit?.();
  }

  /** Long and short labels of a button, written into spans created once (see `labelSpans`). */
  private setLabels(button: HTMLElement, long: string, short: string): void {
    let spans = this.labelSpans.get(button);
    if (!spans) {
      spans = {
        long: h('span', { class: 'label-long' }),
        short: h('span', { class: 'label-short', 'aria-hidden': 'true' }),
      };
      button.replaceChildren(spans.long, spans.short);
      this.labelSpans.set(button, spans);
    }
    if (spans.long.textContent !== long) spans.long.textContent = long;
    if (spans.short.textContent !== short) spans.short.textContent = short;
  }

  private renderState(): void {
    for (const id of VIEW_IDS) this.viewButtons[id].setAttribute('aria-pressed', String(this.view === id));
    for (const mode of ['fixed', 'inertial'] as const) {
      this.frameButtons[mode].setAttribute('aria-pressed', String(this.frame === mode));
    }
    this.langButtons.forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset['lang'] === this.i18n.lang)),
    );
  }
}
