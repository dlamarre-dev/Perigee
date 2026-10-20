/** Local times for the engine's answers (IANA time zones), without Intl on every instant. */

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
const QUARTER_HOUR_MS = 900_000;

/**
 * Formats instants in an IANA time zone ("2026-10-19 21:04:33"); throws on an unknown zone. The zone's offset is
 * read once per quarter of an hour of time (Intl is slow; every zone changes its offset on a quarter hour in UTC,
 * e.g. Newfoundland at 05:30, Chatham Islands at 14:00 or 13:45) and applied by hand.
 */
export function localTime(zone: string): (ms: number) => string {
  let format = zoneFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    zoneFormats.set(zone, format);
  }
  const fmt = format;
  const offsets = new Map<number, number>();
  const offsetMs = (ms: number): number => {
    const quarter = Math.floor(ms / QUARTER_HOUR_MS);
    let offset = offsets.get(quarter);
    if (offset === undefined) {
      const t = quarter * QUARTER_HOUR_MS;
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
      offset =
        Date.UTC(p['year'] ?? 0, (p['month'] ?? 1) - 1, p['day'], p['hour'], p['minute'], p['second']) - t;
      offsets.set(quarter, offset);
    }
    return offset;
  };
  const two = (n: number): string => String(n).padStart(2, '0');
  return (ms) => {
    const d = new Date(ms + offsetMs(ms));
    return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  };
}
