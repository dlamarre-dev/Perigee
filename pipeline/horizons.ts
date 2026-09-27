/**
 * JPL Horizons fetcher: state vectors for each mission of catalog/missions.json with ephemeris "horizons".
 * Fetch, validate and reformat only — no interpolation or frame changes here.
 *
 * Request: EPHEM_TYPE=VECTORS, ICRF, REF_PLANE=FRAME (J2000 equator), km & km/s, CSV, VEC_TABLE=2,
 * output times in TDB (JD).
 */
import type { CentralBody, Mission } from '../src/data/schemas';
import { ProviderError, politeGet } from './http';

export const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

export const CENTER_CODES: Record<CentralBody, string> = {
  moon: '500@301',
  mars: '500@499',
  sun: '500@0',
};

/** Horizons accepts "YYYY-MM-DD HH:MM" (UT). */
function horizonsTime(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

export function vectorsUrl(
  horizonsId: string,
  center: string,
  start: Date,
  stop: Date,
  stepMin: number,
): string {
  const params: Record<string, string> = {
    format: 'json',
    COMMAND: `'${horizonsId}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'${center}'`,
    START_TIME: `'${horizonsTime(start)}'`,
    STOP_TIME: `'${horizonsTime(stop)}'`,
    STEP_SIZE: `'${stepMin} min'`,
    REF_SYSTEM: 'ICRF',
    REF_PLANE: 'FRAME',
    OUT_UNITS: 'KM-S',
    CSV_FORMAT: 'YES',
    VEC_TABLE: '2',
    VEC_LABELS: 'NO',
    TIME_TYPE: 'TDB',
  };
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${HORIZONS_API}?${qs}`;
}

/** Parses the $$SOE…$$EOE block into rows of [t_TDB JD, x, y, z, vx, vy, vz]. */
export function parseVectors(result: string): Float64Array {
  const soe = result.indexOf('$$SOE');
  const eoe = result.indexOf('$$EOE');
  if (soe < 0 || eoe < soe) return new Float64Array(0);
  const rows: number[] = [];
  for (const line of result.slice(soe + 5, eoe).split(/\r?\n/)) {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length < 8) continue;
    // JDTDB, Calendar Date (TDB), X, Y, Z, VX, VY, VZ
    const values = [cells[0], ...cells.slice(2, 8)].map(Number);
    if (values.some((v) => !Number.isFinite(v))) throw new Error(`Malformed Horizons row: ${line}`);
    rows.push(...values);
  }
  return Float64Array.from(rows);
}

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

export interface CoverageLimit {
  readonly kind: 'after' | 'prior';
  readonly date: Date;
}

/** Recognises "No ephemeris for target … after|prior to A.D. 2026-AUG-14 11:58:59.9999 TDB". */
export function parseCoverageLimit(result: string): CoverageLimit | undefined {
  const m =
    /No ephemeris for target .*? (after|prior to) A\.D\. (\d{4})-([A-Z]{3})-(\d{2}) (\d{2}):(\d{2})/.exec(
      result,
    );
  if (!m) return undefined;
  const [, kind, y, mon, d, hh, mm] = m;
  const month = MONTHS[mon ?? ''];
  if (!month) return undefined;
  return { kind: kind === 'after' ? 'after' : 'prior', date: new Date(`${y}-${month}-${d}T${hh}:${mm}:00Z`) };
}

export interface MissionVectors {
  readonly data: Float64Array;
  readonly url: string;
  readonly clamped: CoverageLimit | undefined;
}

async function query(url: string): Promise<string> {
  // Horizons: one retry after 10 min on network errors only (CLAUDE.md §8).
  const body = await politeGet(url, { accept: 'application/json', retryAfterNetworkErrorMs: 10 * 60_000 });
  const json = JSON.parse(body) as { result?: unknown; error?: unknown };
  if (typeof json.error === 'string') {
    // Coverage limits come back as an "error"; the caller moves the window instead of failing.
    if (parseCoverageLimit(json.error)) return json.error;
    throw new ProviderError(`Horizons error: ${json.error}`, url, 200);
  }
  if (typeof json.result !== 'string') throw new ProviderError('Horizons response has no result', url, 200);
  return json.result;
}

/**
 * Fetches the mission's window around `now`. If Horizons reports that coverage ends (or starts) inside the
 * window, the window is moved once to the covered side — e.g. a mission whose public ephemeris stopped.
 */
export async function fetchMissionVectors(mission: Mission, now: Date): Promise<MissionVectors> {
  const { horizonsId, sampling } = mission;
  if (!horizonsId || !sampling) throw new Error(`${mission.id}: missing horizonsId or sampling`);
  const center = CENTER_CODES[mission.centralBody];
  const spanMs = (sampling.pastDays + sampling.futureDays) * 86_400_000;
  let start = new Date(now.getTime() - sampling.pastDays * 86_400_000);
  let stop = new Date(now.getTime() + sampling.futureDays * 86_400_000);

  let url = vectorsUrl(horizonsId, center, start, stop, sampling.stepMin);
  let result = await query(url);
  let data = parseVectors(result);
  let clamped: CoverageLimit | undefined;
  if (data.length === 0) {
    clamped = parseCoverageLimit(result);
    if (!clamped) throw new ProviderError(`${mission.id}: no vectors in Horizons result`, url, 200);
    const marginMs = sampling.stepMin * 60_000;
    if (clamped.kind === 'after') {
      stop = new Date(clamped.date.getTime() - marginMs);
      start = new Date(stop.getTime() - spanMs);
    } else {
      start = new Date(clamped.date.getTime() + marginMs);
      stop = new Date(start.getTime() + spanMs);
    }
    url = vectorsUrl(horizonsId, center, start, stop, sampling.stepMin);
    result = await query(url);
    data = parseVectors(result);
    if (data.length === 0) throw new ProviderError(`${mission.id}: no vectors after clamping`, url, 200);
  }
  return { data, url, clamped };
}

/** Little-endian Float64 bytes (explicit, whatever the host endianness). */
export function float64LittleEndian(data: Float64Array): Buffer {
  const buf = Buffer.alloc(data.length * 8);
  for (let i = 0; i < data.length; i++) buf.writeDoubleLE(data[i] ?? 0, i * 8);
  return buf;
}
