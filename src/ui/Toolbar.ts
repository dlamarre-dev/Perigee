import { VIEW_IDS, type FrameMode, type ViewId } from '../app/urlState';
import { LANGS, type I18n, type Lang, type MessageKey } from '../i18n';
import { h } from './dom';

export interface ToolbarCallbacks {
  readonly onViewChange: (view: ViewId) => void;
  readonly onRecenter: () => void;
  readonly onFrameChange: (mode: FrameMode) => void;
  readonly onLangChange: (lang: Lang) => void;
  readonly onAbout: () => void;
  readonly onTogglePanel: () => void;
}

const VIEW_LABELS: Record<ViewId, MessageKey> = { earth: 'view.earth', moon: 'view.moon' };
const FIXED_FRAME_LABELS: Record<ViewId, MessageKey> = {
  earth: 'toolbar.frame.fixed',
  moon: 'toolbar.frame.fixed.moon',
};

/** Top bar: title, view switch, side-panel toggle, recenter, frame toggle, language switch, about. */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly title = h('h1', { class: 'brand' }, ['Périgée']);
  private readonly viewGroup = h('div', { class: 'segmented', role: 'group' });
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

    this.element = h('header', { class: 'panel toolbar' }, [
      this.title,
      this.viewGroup,
      this.panel,
      this.recenter,
      h('div', { class: 'toolbar-group' }, [this.frameLabel, this.frameGroup]),
      this.langGroup,
      this.about,
    ]);

    i18n.onChange(() => this.renderLabels());
    this.renderLabels();
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
    this.viewGroup.setAttribute('aria-label', t('toolbar.view'));
    for (const id of VIEW_IDS) this.viewButtons[id].textContent = t(VIEW_LABELS[id]);
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
