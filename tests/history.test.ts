import { describe, expect, it } from 'vitest';
import { snapshotFor } from '../src/data/history';

const snap = (date: string, hour = 22) => ({
  date,
  path: `earth/history/${date}.json.gz`,
  fetchedAt: `${date}T${hour}:00:00.000Z`,
  count: 1,
  bytes: 1,
  sha256: 'a'.repeat(64),
});
const history = { days: 30, snapshots: [snap('2026-10-03'), snap('2026-10-01'), snap('2026-10-02')] };
const current = '2026-10-05T12:00:00.000Z';
const at = (iso: string): number => Date.parse(iso);

describe('element set for a date', () => {
  it('keeps the current set down to a day before it was fetched', () => {
    expect(snapshotFor(history, current, at('2026-10-05T00:00:00Z'))).toBeUndefined();
    expect(snapshotFor(history, current, at('2026-10-04T12:00:00Z'))).toBeUndefined();
    expect(snapshotFor(undefined, current, at('2026-09-01T00:00:00Z'))).toBeUndefined();
  });

  it('uses the first copy fetched after the date (epochs just past it)', () => {
    expect(snapshotFor(history, current, at('2026-10-02T05:00:00Z'))?.date).toBe('2026-10-02');
    expect(snapshotFor(history, current, at('2026-10-02T23:00:00Z'))?.date).toBe('2026-10-03');
    // Before every copy: the oldest.
    expect(snapshotFor(history, current, at('2026-09-10T00:00:00Z'))?.date).toBe('2026-10-01');
    // Between the last copy and the current set's reach: the current set.
    expect(snapshotFor(history, current, at('2026-10-04T03:00:00Z'))).toBeUndefined();
  });
});
