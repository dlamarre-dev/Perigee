import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_FAVORITES,
  FAVORITES_KEY,
  MAX_FAVORITES,
  addFavorite,
  clearFavorites,
  favoriteQuery,
  favoriteView,
  loadFavorites,
  removeFavorite,
} from '../src/app/favorites';

const APP = 'https://perigee.info/';

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('favorites', () => {
  it('keeps only links into the app, without browser or test parameters', () => {
    expect(favoriteQuery('https://perigee.info/?view=mars&sel=mro&lang=fr&e2e=', APP)).toBe(
      '?sel=mro&view=mars',
    );
    expect(favoriteQuery('https://perigee.info/index.html?view=moon', APP)).toBe('?view=moon');
    expect(favoriteQuery('https://perigee.info/', APP)).toBe('');
    expect(favoriteQuery('https://example.com/?view=mars', APP)).toBeUndefined();
    expect(favoriteQuery('https://perigee.info/privacy.html', APP)).toBeUndefined();
    expect(favoriteQuery('javascript:alert(1)', APP)).toBeUndefined();
    // A local build under a sub-path.
    expect(favoriteQuery('http://localhost:5199/Perigee/?view=solar', 'http://localhost:5199/Perigee/')).toBe(
      '?view=solar',
    );
  });

  it('adds, moves an existing one first, and deletes', () => {
    const s = new MemoryStorage();
    expect(addFavorite(s, `${APP}?view=mars&sel=mro`, APP)).toEqual({
      added: true,
      existed: false,
      full: false,
    });
    expect(addFavorite(s, `${APP}?view=moon`, APP)).toEqual({ added: true, existed: false, full: false });
    expect(loadFavorites(s, APP).map((f) => f.query)).toEqual(['?view=moon', '?sel=mro&view=mars']);
    // The same view, parameters in another order and a language: one entry, now first.
    expect(addFavorite(s, `${APP}?sel=mro&lang=en&view=mars`, APP)).toEqual({
      added: true,
      existed: true,
      full: false,
    });
    expect(loadFavorites(s, APP).map((f) => f.query)).toEqual(['?sel=mro&view=mars', '?view=moon']);
    expect(removeFavorite(s, '?view=moon', APP)).toBe(true);
    expect(loadFavorites(s, APP)).toEqual([{ query: '?sel=mro&view=mars', saved: true }]);
    expect(addFavorite(s, 'https://example.com/', APP).added).toBe(false);
  });

  it('does not save one of the examples again', () => {
    const s = new MemoryStorage();
    expect(addFavorite(s, `${APP}?sel=site%3Aapollo-11&view=moon`, APP)).toEqual({
      added: false,
      existed: true,
      full: false,
    });
    expect(loadFavorites(s, APP)).toEqual([]);
  });

  it('ignores foreign or malformed stored entries', () => {
    const s = new MemoryStorage();
    s.setItem(
      FAVORITES_KEY,
      JSON.stringify([
        { url: 'https://example.com/?view=mars' },
        { url: `${APP}?view=solar` },
        'plain string',
        { url: 42 },
        { url: `${APP}?view=solar` },
      ]),
    );
    expect(loadFavorites(s, APP)).toEqual([{ query: '?view=solar', saved: true }]);
    s.setItem(FAVORITES_KEY, '{not json');
    expect(loadFavorites(s, APP)).toEqual([]);
    expect(loadFavorites(undefined, APP)).toEqual([]);
  });

  it('refuses a new view once full, still moves an existing one, and clears all', () => {
    const s = new MemoryStorage();
    expect(MAX_FAVORITES).toBe(50);
    for (let i = 1; i <= MAX_FAVORITES; i++)
      expect(addFavorite(s, `${APP}?view=earth&sel=${i}`, APP).added).toBe(true);
    expect(addFavorite(s, `${APP}?view=moon`, APP)).toEqual({ added: false, existed: false, full: true });
    expect(addFavorite(s, `${APP}?view=earth&sel=1`, APP)).toEqual({
      added: true,
      existed: true,
      full: false,
    });
    const list = loadFavorites(s, APP);
    expect(list).toHaveLength(MAX_FAVORITES);
    expect(list[0]?.query).toBe('?sel=1&view=earth');
    expect(clearFavorites(s, APP)).toBe(true);
    expect(loadFavorites(s, APP)).toEqual([]);
  });

  it('reads what a favorite shows', () => {
    expect(EXAMPLE_FAVORITES.map((f) => favoriteView(f.query))).toEqual([
      { view: 'earth', sel: '25544', follow: true, time: undefined, rate: 1 },
      { view: 'moon', sel: 'site:apollo-11', follow: false, time: undefined, rate: 1 },
      { view: 'mars', sel: 'mro', follow: true, time: undefined, rate: 1 },
      { view: 'solar', sel: 'voyager-1', follow: true, time: undefined, rate: 1 },
    ]);
    expect(favoriteView('?view=solar&t=2026-10-27T12:00:00Z&rate=100&follow=1')).toEqual({
      view: 'solar',
      sel: undefined,
      follow: false,
      time: new Date('2026-10-27T12:00:00Z'),
      rate: 100,
    });
  });
});
