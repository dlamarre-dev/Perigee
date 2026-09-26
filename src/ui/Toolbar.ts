import type { FrameMode } from '../app/urlState';
import { LANGS, type I18n, type Lang } from '../i18n';
import { h } from './dom';

export interface ToolbarCallbacks {
  readonly onRecenter: () => void;
  readonly onFrameChange: (mode: FrameMode) => void;
  readonly onLangChange: (lang: Lang) => void;
  readonly onAbout: () => void;
}

/** Top bar: title, recenter, frame toggle, language switch, about. */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly title = h('h1', { class: 'brand' }, ['Périgée']);
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

  constructor(
    private readonly i18n: I18n,
    initialFrame: FrameMode,
    callbacks: ToolbarCallbacks,
  ) {
    this.frame = initialFrame;
    this.recenter.addEventListener('click', callbacks.onRecenter);
    this.about.addEventListener('click', callbacks.onAbout);
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
      this.recenter,
      h('div', { class: 'toolbar-group' }, [this.frameLabel, this.frameGroup]),
      this.langGroup,
      this.about,
    ]);

    i18n.onChange(() => this.renderLabels());
    this.renderLabels();
  }

  private renderLabels(): void {
    const t = this.i18n.t.bind(this.i18n);
    this.recenter.textContent = t('toolbar.recenter');
    this.recenter.title = t('toolbar.recenter.hint');
    this.frameLabel.textContent = t('toolbar.frame');
    this.frameGroup.setAttribute('aria-label', t('toolbar.frame'));
    this.frameGroup.title = t('toolbar.frame.hint');
    this.frameButtons.fixed.textContent = t('toolbar.frame.fixed');
    this.frameButtons.inertial.textContent = t('toolbar.frame.inertial');
    this.langGroup.setAttribute('aria-label', t('toolbar.language'));
    this.about.textContent = t('toolbar.about');
    this.renderState();
  }

  private renderState(): void {
    for (const mode of ['fixed', 'inertial'] as const) {
      this.frameButtons[mode].setAttribute('aria-pressed', String(this.frame === mode));
    }
    this.langButtons.forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset['lang'] === this.i18n.lang)),
    );
  }
}
