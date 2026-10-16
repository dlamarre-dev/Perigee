import type { ImageEntry } from '../data/schemas';
import type { I18n } from '../i18n';
import { imageUrl, LICENCES } from '../render/images';
import { h, scrollingDialog } from './dom';

/** "Illustration (artist's impression) · image: ESA, CC BY-SA 3.0 IGO", credit and licence linked. */
export function imageCaption(i18n: I18n, entry: ImageEntry): (Node | string)[] {
  const licence = LICENCES[entry.licence];
  const link = (href: string, text: string): HTMLAnchorElement =>
    h('a', { href, target: '_blank', rel: 'noopener' }, [text]);
  const [before = '', between = '', after = ''] = i18n.t('image.credit').split(/\{credit\}|\{licence\}/);
  return [
    `${i18n.t(`image.kind.${entry.kind}`)} · ${before}`,
    link(entry.sources[0] ?? entry.file, entry.credit),
    between,
    licence.url
      ? link(licence.url, licence.name)
      : entry.licence === 'public-domain'
        ? i18n.t('image.publicDomain')
        : licence.name,
    after,
  ];
}

/** Centred dialog showing a panel image larger, like About (full width on phones). */
class ImageViewerDialog {
  readonly element: HTMLDialogElement;
  private readonly title = h('h2', { id: 'image-viewer-title', tabindex: -1 });
  private readonly image = h('img', { class: 'image-viewer-img', decoding: 'async' });
  private readonly caption = h('p', { class: 'muted small' });
  private readonly close = h('button', { type: 'button', class: 'btn' });
  private current: { entry: ImageEntry; title: string } | undefined;

  constructor(
    private readonly i18n: I18n,
    private readonly baseUrl: string,
  ) {
    this.close.addEventListener('click', () => this.element.close());
    this.element = h(
      'dialog',
      { class: 'panel about image-viewer', 'aria-labelledby': 'image-viewer-title' },
      [
        this.title,
        h('figure', {}, [this.image, h('figcaption', {}, [this.caption])]),
        h('div', { class: 'dialog-actions' }, [this.close]),
      ],
    );
    scrollingDialog(this.element);
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
    // The panel image already loaded is shown until the larger one arrives.
    this.element.addEventListener('close', () => this.image.removeAttribute('src'));
    i18n.onChange(() => this.render());
  }

  open(entry: ImageEntry, title: string, placeholderSrc: string | undefined): void {
    this.current = { entry, title };
    if (placeholderSrc) this.image.src = placeholderSrc;
    this.render();
    const large = imageUrl(this.baseUrl, entry, true);
    const preload = new Image();
    preload.onload = () => {
      if (this.current?.entry === entry && this.element.open) this.image.src = large;
    };
    preload.src = large;
    if (!this.element.open) this.element.showModal();
    this.title.focus({ preventScroll: true });
  }

  private render(): void {
    this.close.textContent = this.i18n.t('about.close');
    if (!this.current) return;
    const { entry, title } = this.current;
    this.title.textContent = title;
    this.image.alt = `${title} — ${this.i18n.t(`image.kind.${entry.kind}`)}`;
    this.caption.replaceChildren(...imageCaption(this.i18n, entry));
  }
}

let viewer: ImageViewerDialog | undefined;

/** Opens the enlarged image (the dialog is created on first use, beside the other dialogs). */
export function openImage(
  i18n: I18n,
  baseUrl: string,
  entry: ImageEntry,
  title: string,
  placeholderSrc?: string,
): void {
  if (!viewer) {
    viewer = new ImageViewerDialog(i18n, baseUrl);
    (document.getElementById('app') ?? document.body).append(viewer.element);
  }
  viewer.open(entry, title, placeholderSrc);
}
