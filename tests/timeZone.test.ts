import { describe, expect, it } from 'vitest';
import {
  formatOffset,
  formatWallClock,
  instantFromWallClock,
  parseDatetimeLocal,
  datetimeLocalValue,
  zoneAbbreviation,
  zoneOffsetMs,
  zoneOptions,
} from '../src/i18n/timeZone';

const summer = new Date('2026-10-07T13:35:12Z');
const winter = new Date('2026-01-07T13:35:12Z');

describe('time zone display', () => {
  it('shows the wall clock of the zone, daylight saving included', () => {
    expect(formatWallClock(summer, 'America/Toronto')).toBe('2026-10-07 09:35');
    expect(formatWallClock(winter, 'America/Toronto', true)).toBe('2026-01-07 08:35:12');
    expect(formatWallClock(summer, 'UTC', true)).toBe('2026-10-07 13:35:12');
    expect(zoneOffsetMs(summer, 'America/Toronto')).toBe(-4 * 3_600_000);
    expect(zoneOffsetMs(winter, 'America/Toronto')).toBe(-5 * 3_600_000);
  });

  it('names the zone in each language, or gives its offset', () => {
    expect(zoneAbbreviation(summer, 'America/Toronto', 'en-CA')).toBe('EDT');
    expect(zoneAbbreviation(summer, 'America/Toronto', 'fr-CA')).toBe('HAE');
    expect(zoneAbbreviation(winter, 'America/Toronto', 'fr-CA')).toBe('HNE');
    expect(zoneAbbreviation(summer, 'UTC', 'fr-CA')).toBe('UTC');
    // Other zones get the usual English abbreviation, or their offset when there is none.
    expect(zoneAbbreviation(summer, 'Europe/Paris', 'fr-CA')).toBe('CEST');
    expect(zoneAbbreviation(winter, 'Europe/Paris', 'fr-CA')).toBe('CET');
    expect(zoneAbbreviation(summer, 'Asia/Tokyo', 'fr-CA')).toBe('JST');
    expect(zoneAbbreviation(summer, 'Europe/Moscow', 'en-CA')).toBe('MSK');
    expect(zoneAbbreviation(summer, 'Asia/Tbilisi', 'fr-CA')).toBe('UTC+4');
    expect(formatOffset(-4 * 3_600_000)).toBe('UTC−04:00');
  });

  it('reads a wall clock back as an instant, across daylight-saving changes', () => {
    const w = { year: 2026, month: 10, day: 7, hour: 9, minute: 35, second: 12 };
    expect(instantFromWallClock(w, 'America/Toronto').toISOString()).toBe('2026-10-07T13:35:12.000Z');
    expect(instantFromWallClock({ ...w, month: 1 }, 'America/Toronto').toISOString()).toBe(
      '2026-01-07T14:35:12.000Z',
    );
    // 02:30 does not exist on 2026-03-08 in Toronto (spring forward): still a valid instant nearby.
    const gap = instantFromWallClock(
      { ...w, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
      'America/Toronto',
    );
    expect(Math.abs(gap.getTime() - Date.parse('2026-03-08T07:30:00Z'))).toBeLessThanOrEqual(3_600_000);
  });

  it('round-trips the date field value in the display zone', () => {
    const v = datetimeLocalValue(summer, 'Europe/Paris');
    expect(v).toBe('2026-10-07T15:35:12');
    expect(parseDatetimeLocal(v, 'Europe/Paris')?.toISOString()).toBe(summer.toISOString());
    expect(parseDatetimeLocal('2026-10-07T09:35', 'America/Toronto')?.toISOString()).toBe(
      '2026-10-07T13:35:00.000Z',
    );
    expect(parseDatetimeLocal('nonsense', 'UTC')).toBeUndefined();
  });

  it('lists zones by city with a translated name and the offset', () => {
    const fr = zoneOptions('fr-CA', summer);
    const toronto = fr.find((o) => o.id === 'America/Toronto');
    expect(toronto?.label).toBe('Toronto — heure de l’Est (UTC−04:00)');
    expect(toronto?.region).toBe('America');
    expect(zoneOptions('en-CA', summer).find((o) => o.id === 'America/Toronto')?.label).toBe(
      'Toronto — Eastern Time (UTC−04:00)',
    );
    expect(fr.length).toBeGreaterThan(100);
    // Montréal has its own entry (same rules as Toronto).
    expect(fr.find((o) => o.id === 'America/Montreal')?.label).toBe('Montréal — heure de l’Est (UTC−04:00)');
    expect(zoneAbbreviation(summer, 'America/Montreal', 'fr-CA')).toBe('HAE');
  });
});
