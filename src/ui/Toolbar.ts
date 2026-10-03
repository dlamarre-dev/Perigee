import { VIEW_IDS, type FrameMode, type ViewId } from '../app/urlState';
import { LANGS, type I18n, type Lang, type MessageKey } from '../i18n';
import { h } from './dom';

export interface ToolbarCallbacks {
  readonly onViewChange: (view: ViewId) => void;
  readonly onRecenter: () => void;
  readonly onFrameChange: (mode: FrameMode) => void;
  readonly onLangChange: (lang: Lang) => void;
  readonly onAbout: () => void;
  readonly onReport: () => void;
  readonly onTogglePanel: () => void;
  /** Soundtrack player (menu entry on phones, where its floating button is hidden). */
  readonly onSoundtrack: () => void;
}

const VIEW_LABELS: Record<ViewId, MessageKey> = {
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
 * Top bar: title, view switch, side-panel toggle, recenter, frame toggle, language switch, about.
 * On phones (CSS, ≤ 640 px) everything but the title and the view tabs folds into a "☰" menu.
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
  private readonly about = h('button', { type: 'button', class: 'btn' });
  private readonly report = h('button', { type: 'button', class: 'btn' });
  private readonly soundtrack = h('button', { type: 'button', class: 'btn mobile-only' });
  private readonly menuButton = h('button', {
    type: 'button',
    class: 'btn menu-toggle',
    'aria-expanded': 'false',
    'aria-controls': 'toolbar-menu',
  });
  private readonly menu = h('div', { class: 'toolbar-menu', id: 'toolbar-menu' });
  private frame: FrameMode;
  private view: ViewId;
  private panelLabel: MessageKey | undefined;

  constructor(
    private readonly i18n: I18n,
    initialView: ViewId,
    initialFrame: FrameMode,
    callbacks: ToolbarCallbacks,
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

    this.soundtrack.addEventListener('click', callbacks.onSoundtrack);
    this.menu.append(
      this.panel,
      this.recenter,
      h('div', { class: 'toolbar-group' }, [this.frameLabel, this.frameGroup]),
      this.langGroup,
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
  }

  private menuOpen = false;

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
    this.viewGroup.setAttribute('aria-label', t('toolbar.view'));
    for (const id of VIEW_IDS) {
      // Short label on phones (CSS picks one), full one elsewhere and for assistive technologies.
      const b = this.viewButtons[id];
      b.setAttribute('aria-label', t(VIEW_LABELS[id]));
      b.replaceChildren(
        h('span', { class: 'label-long' }, [t(VIEW_LABELS[id])]),
        h('span', { class: 'label-short', 'aria-hidden': 'true' }, [t(SHORT_VIEW_LABELS[id])]),
      );
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
    this.about.textContent = t('toolbar.about');
    this.report.textContent = t('toolbar.report');
    this.renderState();
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
