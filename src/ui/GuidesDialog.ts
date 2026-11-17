/**
 * Guides window (book button of the top bar, "Guides" in the phone menu), in About's frame: one tile per section of
 * the guides (src/landing/themes.ts) with its thumbnail, each a link to that section's page in the same tab, then a
 * link to the whole index. The pages are static (src/landing/render.ts); nothing here computes a position.
 */
import { THEMES, themePath } from '../landing/themes';
import type { I18n } from '../i18n';
import { assetUrl } from '../render/assetUrl';
import { h, scrollingDialog, setText } from './dom';

export class GuidesDialog {
  readonly element: HTMLDialogElement;
  private readonly title = h('h2', { id: 'guides-title', tabindex: -1 });
  private readonly intro = h('p', { class: 'muted small' });
  private readonly grid = h('ul', { class: 'guides-grid' });
  private readonly all = h('a', { class: 'guides-all' });
  private readonly close = h('button', { type: 'button', class: 'btn' });

  constructor(
    private readonly i18n: I18n,
    private readonly baseUrl: string,
  ) {
    this.close.addEventListener('click', () => this.element.close());
    this.element = h('dialog', { class: 'panel about guides', 'aria-labelledby': 'guides-title' }, [
      this.title,
      this.intro,
      this.grid,
      h('p', {}, [this.all]),
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
    this.element.showModal();
    this.title.focus({ preventScroll: true });
    const body = this.element.querySelector('.dialog-body');
    if (body) body.scrollTop = 0;
  }

  private render(): void {
    const lang = this.i18n.lang;
    setText(this.title, this.i18n.t('guides.title'));
    setText(this.intro, this.i18n.t('guides.intro'));
    setText(this.close, this.i18n.t('about.close'));
    setText(this.all, `${this.i18n.t('guides.all')} ›`);
    this.all.href = `${this.baseUrl}${lang}/`;
    this.grid.replaceChildren(
      ...THEMES.map((theme) =>
        h('li', {}, [
          h(
            'a',
            {
              class: 'guides-tile',
              href: `${this.baseUrl}${themePath(theme, lang)}`,
              'data-theme': theme.id,
            },
            [
              // Decorative: the section's name beside it names the link.
              h('img', {
                src: assetUrl(this.baseUrl, `landing/thumbs/${theme.thumb}.webp`),
                alt: '',
                width: 224,
                height: 168,
                loading: 'lazy',
                decoding: 'async',
              }),
              h('span', {}, [theme.name[lang]]),
            ],
          ),
        ]),
      ),
    );
  }
}
