import type { I18n } from '../i18n';
import { h } from './dom';

export type BadgeState = 'fresh' | 'stale' | 'invalid';

export interface DetailContent {
  readonly title: string;
  readonly badge?: { readonly text: string; readonly state: BadgeState };
  readonly rows: readonly (readonly [label: string, value: string])[];
  readonly notes?: string;
  readonly sources?: readonly string[];
  readonly footnote?: string;
  /** Show the Follow button. */
  readonly followable: boolean;
}

export interface DetailPanelCallbacks {
  readonly onClose: () => void;
  readonly onToggleFollow: () => void;
}

/** Right-hand panel describing the selected object of a view. Escape closes it. */
export class DetailPanel {
  readonly element: HTMLElement;
  private readonly title = h('h2', { class: 'panel-title', id: 'detail-title', tabindex: -1 });
  private readonly badge = h('p', { class: 'freshness' });
  private readonly fields = h('dl', { class: 'fields' });
  private readonly notes = h('p', { class: 'small' });
  private readonly sourcesTitle = h('h3', { class: 'results-title' });
  private readonly sources = h('ul', { class: 'sources small' });
  private readonly footnote = h('p', { class: 'muted small' });
  private readonly follow = h('button', { type: 'button', class: 'btn' });
  private readonly close = h('button', { type: 'button', class: 'btn' });
  private followingValue = false;
  private lastSourcesKey = '';

  constructor(
    private readonly i18n: I18n,
    callbacks: DetailPanelCallbacks,
  ) {
    this.close.addEventListener('click', callbacks.onClose);
    this.follow.addEventListener('click', callbacks.onToggleFollow);
    this.element = h(
      'aside',
      { class: 'panel side-panel info', 'aria-labelledby': 'detail-title', hidden: true },
      [
        h('div', { class: 'panel-header' }, [this.title, this.close]),
        this.badge,
        this.fields,
        this.notes,
        this.sourcesTitle,
        this.sources,
        this.footnote,
        h('div', { class: 'dialog-actions' }, [this.follow]),
      ],
    );
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') callbacks.onClose();
    });
    i18n.onChange(() => this.renderStatic());
    this.renderStatic();
  }

  set following(v: boolean) {
    this.followingValue = v;
    this.follow.textContent = this.i18n.t(v ? 'info.unfollow' : 'info.follow');
    this.follow.setAttribute('aria-pressed', String(v));
  }

  hide(): void {
    this.element.hidden = true;
  }

  show(content: DetailContent, focus = false): void {
    const wasHidden = this.element.hidden;
    this.element.hidden = false;
    this.title.textContent = content.title;
    this.badge.hidden = !content.badge;
    if (content.badge) {
      this.badge.textContent = content.badge.text;
      this.badge.dataset['state'] = content.badge.state;
    }
    this.fields.replaceChildren(...content.rows.flatMap(([k, v]) => [h('dt', {}, [k]), h('dd', {}, [v])]));
    this.notes.hidden = !content.notes;
    this.notes.textContent = content.notes ?? '';
    // Rebuild the links only when they change, so keyboard focus survives live updates.
    const key = (content.sources ?? []).join('|');
    if (key !== this.lastSourcesKey) {
      this.lastSourcesKey = key;
      this.sources.replaceChildren(
        ...(content.sources ?? []).map((url) =>
          h('li', {}, [h('a', { href: url, target: '_blank', rel: 'noopener' }, [new URL(url).hostname])]),
        ),
      );
    }
    this.sourcesTitle.hidden = !content.sources?.length;
    this.footnote.textContent = content.footnote ?? '';
    this.follow.hidden = !content.followable;
    if (focus && wasHidden) this.title.focus();
  }

  private renderStatic(): void {
    this.close.textContent = this.i18n.t('info.close');
    this.sourcesTitle.textContent = this.i18n.t('info.sources');
    this.following = this.followingValue;
  }
}
