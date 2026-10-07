/**
 * Time zone of the displayed dates and times. Internally everything stays UTC (Date, Unix ms, the URL's `t=`);
 * only the display converts, with the zone's own daylight-saving rules (Intl, IANA database of the browser).
 * The default is the computer's zone; the visitor can pick another one in the time bar (remembered).
 */

/** "auto" (the computer's zone, followed if it changes), "UTC", or an IANA zone id. */
export type TimeZoneSetting = string;

export const AUTO_ZONE = 'auto';
const STORAGE_KEY = 'perigee.timeZone';

/** The browser's own zone (UTC when it cannot tell). */
export function systemZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** True when the browser knows `zone`. */
export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function resolveZone(setting: TimeZoneSetting): string {
  if (setting === AUTO_ZONE) return systemZone();
  return isValidZone(setting) ? setting : systemZone();
}

export function loadZoneSetting(): TimeZoneSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && (v === AUTO_ZONE || isValidZone(v)) ? v : AUTO_ZONE;
  } catch {
    return AUTO_ZONE;
  }
}

export function saveZoneSetting(setting: TimeZoneSetting): void {
  try {
    if (setting === AUTO_ZONE) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    // Storage blocked (private mode): the choice lasts for this page only.
  }
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatters.set(zone, f);
  }
  return f;
}

export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Calendar date and time of an instant in `zone`. */
export function wallClock(date: Date, zone: string): WallClock {
  const v: Record<string, number> = {};
  for (const p of partsFormatter(zone).formatToParts(date)) {
    if (p.type !== 'literal') v[p.type] = Number(p.value);
  }
  return {
    year: v['year'] ?? 1970,
    month: v['month'] ?? 1,
    day: v['day'] ?? 1,
    // Some engines write midnight as 24 even with h23.
    hour: (v['hour'] ?? 0) % 24,
    minute: v['minute'] ?? 0,
    second: v['second'] ?? 0,
  };
}

/** Offset of `zone` from UTC at that instant (ms, positive east of Greenwich). */
export function zoneOffsetMs(date: Date, zone: string): number {
  const w = wallClock(date, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant whose wall clock in `zone` reads `w` (the later one in a DST overlap, shifted in a gap). */
export function instantFromWallClock(w: WallClock, zone: string): Date {
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  let t = asUtc - zoneOffsetMs(new Date(asUtc), zone);
  t = asUtc - zoneOffsetMs(new Date(t), zone);
  return new Date(t);
}

const pad = (n: number, size = 2): string => String(n).padStart(size, '0');

/** "YYYY-MM-DD HH:MM" (or with ":SS"), in `zone`. */
export function formatWallClock(date: Date, zone: string, seconds = false): string {
  const w = wallClock(date, zone);
  const time = `${pad(w.hour)}:${pad(w.minute)}${seconds ? `:${pad(w.second)}` : ''}`;
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)} ${time}`;
}

/** Value for an `<input type="datetime-local">`: "YYYY-MM-DDTHH:MM:SS" in `zone`. */
export function datetimeLocalValue(date: Date, zone: string): string {
  return formatWallClock(date, zone, true).replace(' ', 'T');
}

/** Parses an `<input type="datetime-local">` value as a wall clock in `zone`; undefined if malformed. */
export function parseDatetimeLocal(value: string, zone: string): Date | undefined {
  const m = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value);
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1).map((s) => Number(s ?? 0));
  const d = instantFromWallClock(
    {
      year: year ?? 0,
      month: month ?? 1,
      day: day ?? 1,
      hour: hour ?? 0,
      minute: minute ?? 0,
      second: second ?? 0,
    },
    zone,
  );
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** "UTC−04:00" (true minus sign), or "UTC−4" / "UTC+5:30" when `compact`. */
export function formatOffset(offsetMs: number, compact = false): string {
  const minutes = Math.round(offsetMs / 60_000);
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (compact) return `UTC${sign}${h}${m ? `:${pad(m)}` : ''}`;
  return `UTC${sign}${pad(h)}:${pad(m)}`;
}

/**
 * Short name of `zone` at that instant, daylight saving included: "EDT"/"HAE" for Toronto in summer, "UTC";
 * zones without a common abbreviation in that language get their offset ("UTC+2", "UTC+5:30").
 */
export function zoneAbbreviation(date: Date, zone: string, locale: string): string {
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  try {
    const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (name && !/^(GMT|UTC)/.test(name)) return name;
  } catch {
    // Fall through to the offset.
  }
  return formatOffset(zoneOffsetMs(date, zone), true);
}

/** "Buenos Aires" from "America/Argentina/Buenos_Aires". */
export function zoneCity(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/** Region of the IANA id, used to group the list: "America", "Europe"… */
export function zoneRegion(zone: string): string {
  return zone.split('/')[0] ?? '';
}

/** Zone regions offered, in list order (their names are translated: `tz.region.<name>`). */
export const ZONE_REGIONS = [
  'America',
  'Europe',
  'Africa',
  'Asia',
  'Australia',
  'Pacific',
  'Atlantic',
  'Indian',
  'Antarctica',
  'Arctic',
] as const;
export type ZoneRegion = (typeof ZONE_REGIONS)[number];

/** Every zone the browser knows, grouped by region (fallback: a few common ones). */
export function knownZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
    'timeZone',
  );
  const list = supported?.length
    ? supported
    : [
        'America/Vancouver',
        'America/Edmonton',
        'America/Winnipeg',
        'America/Toronto',
        'America/Halifax',
        'America/St_Johns',
        'Europe/London',
        'Europe/Paris',
        'Asia/Tokyo',
        'Australia/Sydney',
      ];
  return list.filter((z) => (ZONE_REGIONS as readonly string[]).includes(zoneRegion(z)));
}

export interface ZoneOption {
  readonly id: string;
  readonly region: ZoneRegion;
  /** "Toronto — heure de l’Est (UTC−04:00)". */
  readonly label: string;
}

/** Options of the zone list for `locale`, offsets at `date`, sorted by city within each region. */
export function zoneOptions(locale: string, date: Date): ZoneOption[] {
  const options = knownZones().map((id) => {
    let generic = '';
    try {
      generic =
        new Intl.DateTimeFormat(locale, { timeZone: id, timeZoneName: 'longGeneric' })
          .formatToParts(date)
          .find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      // Older engines: no generic name.
    }
    const offset = formatOffset(zoneOffsetMs(date, id));
    const named = generic && !/^(GMT|UTC)/.test(generic) ? ` — ${generic}` : '';
    return { id, region: zoneRegion(id) as ZoneRegion, label: `${zoneCity(id)}${named} (${offset})` };
  });
  const collator = new Intl.Collator(locale);
  return options.sort((a, b) => collator.compare(a.label, b.label));
}
