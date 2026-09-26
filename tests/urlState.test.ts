import { describe, expect, it } from 'vitest';
import { DEFAULT_URL_STATE, parseUrlState, serializeUrlState } from '../src/app/urlState';

describe('URL state', () => {
  it('defaults to a live Earth-fixed view', () => {
    expect(parseUrlState('')).toEqual(DEFAULT_URL_STATE);
    expect(serializeUrlState(DEFAULT_URL_STATE)).toBe('');
  });

  it('round-trips non-default values', () => {
    const search = '?lang=fr&frame=inertial&t=2026-09-26T12%3A00%3A00Z&rate=100';
    const state = parseUrlState(search);
    expect(state.lang).toBe('fr');
    expect(state.frame).toBe('inertial');
    expect(state.time?.toISOString()).toBe('2026-09-26T12:00:00.000Z');
    expect(state.rate).toBe(100);
    expect(serializeUrlState(state)).toBe(search);
  });

  it('ignores invalid values', () => {
    const state = parseUrlState('?lang=de&frame=x&t=garbage&rate=1e9');
    expect(state).toEqual(DEFAULT_URL_STATE);
  });
});
