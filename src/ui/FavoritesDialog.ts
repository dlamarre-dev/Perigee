/**
 * Favorites window (star button of the top bar, "Favorites" in the phone menu), in About's frame: the fixed
 * examples, then a button saving the current view, then the views the visitor saved (src/app/favorites.ts), each
 * deletable after a confirmation (or all at once, "Clear all" at the bottom). At most MAX_FAVORITES are kept; the
 * body scrolls when they do not fit. The list is rebuilt each time the window opens. Picking a favorite closes the
 * window and the shell moves to it (view, date, selection, follow); each entry is also a real link, so it can be
 * opened in a new tab or copied.
 */
import {
  EXAMPLE_FAVORITES,
  MAX_FAVORITES,
  addFavorite,
  clearFavorites,
  favoriteView,
  favoritesStorage,
  loadFavorites,
  removeFavorite,
  type Favorite,
} from '../app/favorites';
import type { ViewId } from '../app/urlState';
import type { I18n, Lang, MessageKey } from '../i18n';
import { h, scrollingDialog, setText } from './dom';
import { VIEW_LABELS } from './Toolbar';

export interface FavoritesCallbacks {
  /** The app's own address (origin and path), the base of every favorite. */
  readonly appUrl: () => string;
  /** The link of the view on screen (with `follow=1` while following). */
  readonly currentLink: () => string;
  /** Moves the app to a favorite (query string of its link). */
  readonly onOpen: (query: string) => void;
  /** The selected object's name, from the engine (undefined when unknown). */
  readonly nameOf: (view: ViewId, sel: string, lang: Lang) => Promise<string | undefined>;
}

export class FavoritesDialog {
  readonly element: HTMLDialogElement;
  private readonly title = h('h2', { id: 'favorites-title', tabindex: -1 });
  private readonly intro = h('p', { class: 'muted small' });
  private readonly list = h('ul', { class: 'favorites-list' });
  private readonly save = h('button', { type: 'button', class: 'btn favorites-save' });
  private readonly status = h('p', { class: 'small favorites-status', role: 'status' });
  private readonly close = h('button', { type: 'button', class: 'btn' });
  private readonly clearAll = h('button', { type: 'button', class: 'btn favorites-clear' });
  /** Confirmation before saved favorites are deleted (one, or all of them). */
  private readonly confirm: HTMLDialogElement;
  private readonly confirmTitle = h('h2', { id: 'favorites-confirm-title' });
  private readonly confirmText = h('p', {});
  private readonly confirmDelete = h('button', { type: 'button', class: 'btn' });
  private readonly confirmCancel = h('button', { type: 'button', class: 'btn' });
  /** What the confirmation's button deletes; false when storage refused it. */
  private pendingDelete: (() => boolean) | undefined;
  private readonly names = new Map<string, Promise<string | undefined>>();
  /** Rows of the last rendering, so a late name only fills its own row. */
  private renderId = 0;

  constructor(
    private readonly i18n: I18n,
    private readonly callbacks: FavoritesCallbacks,
  ) {
    this.save.addEventListener('click', () => this.saveCurrent());
    this.close.addEventListener('click', () => this.element.close());
    this.clearAll.addEventListener('click', () => {
      const count = loadFavorites(favoritesStorage(), this.callbacks.appUrl()).length;
      this.askToDelete(
        this.i18n.t('favorites.clearConfirm.title'),
        this.i18n.format('favorites.clearConfirm.text', { count: String(count) }),
        this.i18n.t('favorites.clearAll'),
        () => clearFavorites(favoritesStorage(), this.callbacks.appUrl()),
      );
    });
    this.element = h('dialog', { class: 'panel about favorites', 'aria-labelledby': 'favorites-title' }, [
      this.title,
      this.intro,
      this.list,
      this.status,
      h('div', { class: 'dialog-actions' }, [this.clearAll, this.close]),
    ]);
    scrollingDialog(this.element);
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
    this.confirmDelete.addEventListener('click', () => {
      const run = this.pendingDelete;
      this.confirm.close();
      if (!run) return;
      setText(this.status, run() ? '' : this.i18n.t('favorites.storageError'));
      this.render();
    });
    this.confirmCancel.addEventListener('click', () => this.confirm.close());
    this.confirm = h(
      'dialog',
      { class: 'panel about favorites-confirm', 'aria-labelledby': 'favorites-confirm-title' },
      [
        this.confirmTitle,
        this.confirmText,
        h('div', { class: 'dialog-actions' }, [this.confirmCancel, this.confirmDelete]),
      ],
    );
    this.confirm.addEventListener('close', () => (this.pendingDelete = undefined));
    this.element.append(this.confirm);
    i18n.onChange(() => {
      this.renderStatic();
      if (this.element.open) this.render();
    });
    this.renderStatic();
  }

  open(): void {
    setText(this.status, '');
    this.render();
    this.element.showModal();
    this.title.focus({ preventScroll: true });
    const body = this.element.querySelector('.dialog-body');
    if (body) body.scrollTop = 0;
  }

  private renderStatic(): void {
    const t = this.i18n.t.bind(this.i18n);
    setText(this.title, t('favorites.title'));
    setText(this.intro, t('favorites.intro'));
    setText(this.save, `☆ ${t('favorites.save')}`);
    setText(this.close, t('about.close'));
    setText(this.clearAll, t('favorites.clearAll'));
    setText(this.confirmCancel, t('favorites.confirm.cancel'));
  }

  /** Examples, the save button (fifth line), then the saved favorites, read from storage again. */
  private render(): void {
    const id = ++this.renderId;
    const saved = loadFavorites(favoritesStorage(), this.callbacks.appUrl());
    const rows = [
      ...EXAMPLE_FAVORITES.map((f) => this.row(f, id)),
      h('li', { class: 'favorites-save-row' }, [this.save]),
      ...saved.map((f) => this.row(f, id)),
    ];
    if (!saved.length)
      rows.push(h('li', { class: 'muted small favorites-empty' }, [this.i18n.t('favorites.empty')]));
    this.list.replaceChildren(...rows);
    this.clearAll.hidden = !saved.length;
  }

  private row(favorite: Favorite, renderId: number): HTMLElement {
    const t = this.i18n.t.bind(this.i18n);
    const v = favoriteView(favorite.query);
    const name = h('span', { class: 'favorite-name' });
    const detail = h('span', { class: 'muted small favorite-detail' });
    const viewName = t(VIEW_LABELS[v.view]);
    setText(name, v.sel ? '…' : viewName);
    const parts = [
      viewName,
      v.time ? this.i18n.dateTime(v.time) : t('favorites.live'),
      ...(v.rate !== 1 ? [`×${this.i18n.number(v.rate)}`] : []),
      ...(v.follow ? [t('favorites.following')] : []),
    ];
    setText(detail, parts.join(' · '));
    const link = h(
      'a',
      { class: 'favorite-link', href: new URL(favorite.query, this.callbacks.appUrl()).href },
      [name, detail],
    );
    link.addEventListener('click', (e) => {
      // A modified click (new tab, new window) keeps the browser's behaviour.
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      this.element.close();
      this.callbacks.onOpen(favorite.query);
    });
    if (v.sel) {
      const sel = v.sel;
      void this.nameFor(v.view, sel).then((n) => {
        if (renderId === this.renderId) setText(name, n ?? sel);
      });
    }
    const children: HTMLElement[] = [link];
    if (favorite.saved) {
      const del = h('button', { type: 'button', class: 'btn favorite-delete' }, ['✕']);
      const label = t('favorites.delete');
      del.title = label;
      del.setAttribute('aria-label', label);
      del.addEventListener('click', () => {
        this.askToDelete(
          t('favorites.confirm.title'),
          `${name.textContent ?? ''} — ${detail.textContent ?? ''}`,
          t('favorites.confirm.delete'),
          () => removeFavorite(favoritesStorage(), favorite.query, this.callbacks.appUrl()),
        );
      });
      children.push(del);
    }
    return h('li', { class: favorite.saved ? 'favorite saved' : 'favorite' }, children);
  }

  /** The confirmation popup; Cancel has the focus, so Enter does not delete by mistake. */
  private askToDelete(title: string, text: string, confirmLabel: string, run: () => boolean): void {
    this.pendingDelete = run;
    setText(this.confirmTitle, title);
    setText(this.confirmText, text);
    setText(this.confirmDelete, confirmLabel);
    this.confirm.showModal();
    this.confirmCancel.focus();
  }

  private nameFor(view: ViewId, sel: string): Promise<string | undefined> {
    const lang = this.i18n.lang;
    const key = `${lang}|${view}|${sel}`;
    let name = this.names.get(key);
    if (!name) {
      name = this.callbacks.nameOf(view, sel, lang).catch(() => undefined);
      this.names.set(key, name);
    }
    return name;
  }

  private saveCurrent(): void {
    const result = addFavorite(favoritesStorage(), this.callbacks.currentLink(), this.callbacks.appUrl());
    const key: MessageKey = result.full
      ? 'favorites.full'
      : result.existed
        ? 'favorites.already'
        : !result.added
          ? 'favorites.storageError'
          : 'favorites.saved';
    this.render();
    setText(this.status, this.i18n.format(key, { max: String(MAX_FAVORITES) }));
  }
}
