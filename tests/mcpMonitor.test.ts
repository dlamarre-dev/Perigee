import { describe, expect, it } from 'vitest';
import { assess, DAILY_QUOTA } from '../workers/mcp/monitor';

const at = new Date('2026-10-19T15:30:00Z');

describe('hosted endpoint monitor', () => {
  it('stays quiet under normal use', () => {
    const r = assess(
      [{ status: 'success', requests: 1200, errors: 0 }],
      [{ status: 'success', requests: 80, errors: 0 }],
      at,
    );
    expect(r.alerts).toEqual([]);
    expect(r.report).toMatch(/1\.2 % of the daily quota/);
    expect(r.report).toMatch(/No alert/);
  });

  it('warns before the daily quota runs out', () => {
    const r = assess([{ status: 'success', requests: DAILY_QUOTA * 0.72, errors: 0 }], [], at);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatch(/Daily quota: 72000 requests today, 72 %/);
  });

  it('flags requests stopped by the CPU limit and error spikes', () => {
    const hour = [
      { status: 'success', requests: 300, errors: 0 },
      { status: 'exceededCpu', requests: 25, errors: 25 },
      { status: 'scriptThrewException', requests: 20, errors: 20 },
    ];
    const r = assess(hour, hour, at);
    expect(r.alerts.some((a) => a.startsWith('CPU or memory limit: 25 of 345'))).toBe(true);
    expect(r.alerts.some((a) => a.startsWith('Errors: 45 of 345'))).toBe(true);
    expect(r.report).toMatch(/exceededCpu 25/);
  });
});
