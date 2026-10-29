/**
 * Favorite views (src/ui/FavoritesDialog.ts): a few fixed examples, then the views the visitor saved. A web page
 * cannot read or write the browser's own bookmarks (only extensions can), so saved favorites live in this
 * browser's storage (`localStorage`, key `perigee-favorites`): a list of Perigee links, nothing else. Only links
 * into this app are kept or shown (same origin and path), whatever the stored value holds.
 */
import { parseUrlState, type ViewId } from './urlState';

export const FAVORITES_KEY = 'perigee-favorites';
/** Saved favorites at most: the window tells the visitor when there is no room left. */
export const MAX_FAVORITES = 50;

/** Parameters that describe the browser or a test, not the view: never saved in a favorite. */
const DROPPED_PARAMS = ['lang', 'embed', 'ui', 'e2e', 'quality', 'debug'] as const;

export interface Favorite {
  /** Query string of the link (`?view=…`), the app's own path implied. */
  readonly query: string;
  /** Saved by the visitor (deletable), or one of the fixed examples. */
  readonly saved: boolean;
}

/** The fixed examples, in real time: the ISS followed, Apollo 11's site, MRO followed, Voyager 1 followed. */
export const EXAMPLE_FAVORITES: readonly Favorite[] = [
  '?sel=25544&follow=1',
  '?view=moon&sel=site%3Aapollo-11',
  '?view=mars&sel=mro&follow=1',
  '?view=solar&sel=voyager-1&follow=1',
].map((query) => ({ query, saved: false }));

/**
 * The query string of a Perigee link (`appUrl`: the app's own address), cleaned of the parameters that do not
 * describe the view and sorted, so two links to the same view compare equal; undefined for any other link.
 */
export function favoriteQuery(link: string, appUrl: string): string | undefined {
  let url: URL;
  let app: URL;
  try {
    app = new URL(appUrl);
    url = new URL(link, app);
  } catch {
    return undefined;
  }
  const path = (u: URL): string => u.pathname.replace(/index\.html$/, '');
  if (url.origin !== app.origin || path(url) !== path(app)) return undefined;
  const p = new URLSearchParams(url.search);
  for (const key of DROPPED_PARAMS) p.delete(key);
  p.sort();
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The saved favorites (newest first), only valid Perigee links; empty when storage is unavailable. */
export function loadFavorites(storage: Storage | undefined, appUrl: string): Favorite[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(FAVORITES_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Favorite[] = [];
  for (const item of raw) {
    const link = typeof item === 'object' && item !== null ? (item as { url?: unknown }).url : undefined;
    if (typeof link !== 'string') continue;
    const query = favoriteQuery(link, appUrl);
    if (query === undefined || seen.has(query)) continue;
    seen.add(query);
    out.push({ query, saved: true });
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

function store(storage: Storage | undefined, list: readonly Favorite[], appUrl: string): boolean {
  try {
    const items = list.map((f) => ({ url: new URL(f.query, appUrl).href }));
    storage?.setItem(FAVORITES_KEY, JSON.stringify(items));
    return storage !== undefined;
  } catch {
    return false;
  }
}

/**
 * Saves a view first in the list (moved there when already saved). `added` is false when the link is not a Perigee
 * link, is one of the examples (`existed`: already in the window), the list is full (`full`: MAX_FAVORITES, a new
 * view only) or storage refused it.
 */
export function addFavorite(
  storage: Storage | undefined,
  link: string,
  appUrl: string,
): { readonly added: boolean; readonly existed: boolean; readonly full: boolean } {
  const query = favoriteQuery(link, appUrl);
  if (query === undefined) return { added: false, existed: false, full: false };
  if (EXAMPLE_FAVORITES.some((f) => favoriteQuery(f.query, appUrl) === query))
    return { added: false, existed: true, full: false };
  const list = loadFavorites(storage, appUrl);
  const existed = list.some((f) => f.query === query);
  if (!existed && list.length >= MAX_FAVORITES) return { added: false, existed, full: true };
  const next = [{ query, saved: true }, ...list.filter((f) => f.query !== query)];
  return { added: store(storage, next, appUrl), existed, full: false };
}

/** Deletes a saved favorite at once (the dialog asked for confirmation). */
export function removeFavorite(storage: Storage | undefined, query: string, appUrl: string): boolean {
  const list = loadFavorites(storage, appUrl);
  return store(
    storage,
    list.filter((f) => f.query !== query),
    appUrl,
  );
}

/** Deletes every saved favorite at once (the dialog asked for confirmation). */
export function clearFavorites(storage: Storage | undefined, appUrl: string): boolean {
  return store(storage, [], appUrl);
}

/** What a favorite shows, read from its link (the description is written from this). */
export interface FavoriteView {
  readonly view: ViewId;
  readonly sel: string | undefined;
  readonly follow: boolean;
  /** Undefined: real time. */
  readonly time: Date | undefined;
  readonly rate: number;
}

export function favoriteView(query: string): FavoriteView {
  const p = new URLSearchParams(query);
  const url = parseUrlState(query);
  const sel = p.get('sel') ?? undefined;
  return {
    view: url.view,
    sel,
    follow: p.get('follow') === '1' && sel !== undefined,
    time: url.time,
    rate: url.rate,
  };
}

/** `localStorage` when the browser allows it (private windows and blocked site data may throw). */
export function favoritesStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
