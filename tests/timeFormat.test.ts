import { describe, expect, it } from 'vitest';
import { localTime } from '../src/engine/timeFormat';

describe('local times of the machine interfaces', () => {
  it('match Intl around half-hour and quarter-hour offset changes', () => {
    // Newfoundland (UTC−2:30 → −3:30) on 1 November 2026 at 04:30 UTC; Lord Howe (+11 → +10:30) on 5 April 2026
    // at 15:00 UTC; Chatham Islands (+13:45 → +12:45) on 5 April 2026 at 14:00 UTC; Kathmandu (+5:45, none).
    for (const [zone, around] of [
      ['America/St_Johns', '2026-11-01T04:30:00Z'],
      ['Australia/Lord_Howe', '2026-04-04T15:00:00Z'],
      ['Pacific/Chatham', '2026-04-04T14:00:00Z'],
      ['Asia/Kathmandu', '2026-04-04T14:00:00Z'],
    ] as const) {
      const local = localTime(zone);
      const intl = new Intl.DateTimeFormat('sv-SE', {
        timeZone: zone,
        dateStyle: 'short',
        timeStyle: 'medium',
      });
      const t0 = Date.parse(around) - 2 * 3_600_000;
      for (let ms = t0; ms <= t0 + 4 * 3_600_000; ms += 7 * 60_000 + 13_000) {
        expect(local(ms), `${zone} ${new Date(ms).toISOString()}`).toBe(intl.format(new Date(ms)));
      }
    }
  });
});
