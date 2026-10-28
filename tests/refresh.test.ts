import { describe, expect, it } from 'vitest';
import { SLOW_BODY_REFRESH_DAYS, slowBodyDue } from '../pipeline/refresh';
import { utcToTdbJd } from '../src/astro/time';

describe('slow body refresh (asteroids, dwarf planets)', () => {
  const now = new Date('2026-10-28T06:30:00Z');
  const daysAgo = (d: number): string => new Date(now.getTime() - d * 86_400_000).toISOString();
  const farEnd = utcToTdbJd(now) + 365;

  it('fetches a new body, then once a week', () => {
    expect(SLOW_BODY_REFRESH_DAYS).toBe(7);
    expect(slowBodyDue(undefined, now)).toBe(true);
    expect(slowBodyDue({ fetchedAt: daysAgo(1), endTdbJd: farEnd }, now)).toBe(false);
    expect(slowBodyDue({ fetchedAt: daysAgo(6.9), endTdbJd: farEnd }, now)).toBe(false);
    expect(slowBodyDue({ fetchedAt: daysAgo(7), endTdbJd: farEnd }, now)).toBe(true);
  });

  it('fetches again early when the window ends within 300 days', () => {
    expect(slowBodyDue({ fetchedAt: daysAgo(1), endTdbJd: utcToTdbJd(now) + 299 }, now)).toBe(true);
  });
});
