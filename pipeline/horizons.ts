/**
 * JPL Horizons fetcher: state vectors for each mission of catalog/missions.json with ephemeris "horizons".
 * Fetch, validate and reformat only — no interpolation or frame changes here.
 *
 * Request: EPHEM_TYPE=VECTORS, ICRF, REF_PLANE=FRAME (J2000 equator), km & km/s, CSV, VEC_TABLE=2,
 * output times in TDB (JD).
 */
import type { CentralBody, Mission, Moon, MoonPlanet } from '../src/data/schemas';
import { ProviderError, politeGet } from './http';

export const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

export const CENTER_CODES: Record<CentralBody, string> = {
  moon: '500@301',
  mars: '500@499',
  // Heliocentric (Sun centre), consistent with astronomy-engine HelioVector and two-body Kepler around the Sun.
  sun: '500@10',
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
  objData = false,
): string {
  const params: Record<string, string> = {
    format: 'json',
    COMMAND: `'${horizonsId}'`,
    // Object data (a comet's magnitude law, radius) only when asked: the same request, a longer header.
    OBJ_DATA: objData ? 'YES' : 'NO',
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
  /** Horizons' text answer (its header carries the object data when asked). */
  readonly result: string;
}

/**
 * A small body's object data from a Horizons header: a comet's total-magnitude law ("M1=  5.5 … k1=  8."), an
 * asteroid's H and G ("H= 3.25  G= .32"), the radius ("RAD= 5.5").
 */
export function parseSmallBodyPhysical(result: string): {
  m1?: number;
  k1?: number;
  h?: number;
  g?: number;
  radiusKm?: number;
} {
  const num = (re: RegExp): number | undefined => {
    const v = Number(re.exec(result)?.[1]);
    return Number.isFinite(v) ? v : undefined;
  };
  const m1 = num(/\bM1=\s*(-?\d+(?:\.\d*)?|-?\.\d+)/);
  const k1 = num(/\bk1=\s*(-?\d+(?:\.\d*)?|-?\.\d+)/);
  const radiusKm = num(/\bRAD=\s*(\d+(?:\.\d*)?|\.\d+)/);
  const h = num(/\bH=\s*(-?\d+(?:\.\d*)?|-?\.\d+)/);
  const g = num(/\bG=\s*(-?\d+(?:\.\d*)?|-?\.\d+)/);
  return {
    ...(m1 !== undefined ? { m1 } : {}),
    ...(k1 !== undefined ? { k1 } : {}),
    ...(h !== undefined ? { h } : {}),
    ...(g !== undefined ? { g } : {}),
    ...(radiusKm !== undefined && radiusKm > 0 ? { radiusKm } : {}),
  };
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
 * Adapts a request window to a coverage limit. A limit inside the window truncates it (so "now" stays covered,
 * e.g. an ephemeris that ends in two months); a limit before the window start (after-limit) or after its end
 * (prior-limit) moves the whole window to the covered side (e.g. a mission whose public ephemeris stopped).
 */
export function clampWindow(
  start: Date,
  stop: Date,
  limit: CoverageLimit,
  marginMs: number,
  spanMs: number,
): { start: Date; stop: Date } {
  const t = limit.date.getTime();
  if (limit.kind === 'after') {
    const newStop = t - marginMs;
    return newStop > start.getTime()
      ? { start, stop: new Date(newStop) }
      : { start: new Date(newStop - spanMs), stop: new Date(newStop) };
  }
  const newStart = t + marginMs;
  return newStart < stop.getTime()
    ? { start: new Date(newStart), stop }
    : { start: new Date(newStart), stop: new Date(newStart + spanMs) };
}

/**
 * Fetches the mission's window around `now`. If Horizons reports that coverage ends (or starts) inside the
 * window, the window is moved once to the covered side — e.g. a mission whose public ephemeris stopped.
 */
/** What a vectors request needs: a mission, or a comet (heliocentric). */
export type VectorsTarget = Pick<Mission, 'id' | 'horizonsId' | 'sampling' | 'centralBody'>;

export async function fetchMissionVectors(
  mission: VectorsTarget,
  now: Date,
  objData = false,
): Promise<MissionVectors> {
  const { horizonsId, sampling } = mission;
  if (!horizonsId || !sampling) throw new Error(`${mission.id}: missing horizonsId or sampling`);
  const center = CENTER_CODES[mission.centralBody];
  const spanMs = (sampling.pastDays + sampling.futureDays) * 86_400_000;
  let start = new Date(now.getTime() - sampling.pastDays * 86_400_000);
  let stop = new Date(now.getTime() + sampling.futureDays * 86_400_000);

  let url = vectorsUrl(horizonsId, center, start, stop, sampling.stepMin, objData);
  let result = await query(url);
  let data = parseVectors(result);
  let clamped: CoverageLimit | undefined;
  if (data.length === 0) {
    clamped = parseCoverageLimit(result);
    if (!clamped) throw new ProviderError(`${mission.id}: no vectors in Horizons result`, url, 200);
    const marginMs = sampling.stepMin * 60_000;
    ({ start, stop } = clampWindow(start, stop, clamped, marginMs, spanMs));
    if (stop <= start) throw new ProviderError(`${mission.id}: empty window after clamping`, url, 200);
    url = vectorsUrl(horizonsId, center, start, stop, sampling.stepMin, objData);
    result = await query(url);
    data = parseVectors(result);
    // Coverage shorter than the window on both sides (a new mission: launch to a few weeks ahead): the second
    // answer names the other limit, which truncates the window once more.
    const other = data.length === 0 ? parseCoverageLimit(result) : undefined;
    if (other && other.kind !== clamped.kind) {
      ({ start, stop } = clampWindow(start, stop, other, marginMs, spanMs));
      if (stop <= start) throw new ProviderError(`${mission.id}: empty window after clamping`, url, 200);
      if (other.kind === 'after') clamped = other;
      url = vectorsUrl(horizonsId, center, start, stop, sampling.stepMin, objData);
      result = await query(url);
      data = parseVectors(result);
    }
    if (data.length === 0) throw new ProviderError(`${mission.id}: no vectors after clamping`, url, 200);
  }
  return { data, url, clamped, result };
}

/**
 * One-time fill of a mission's archive (`run.ts horizons --bootstrap-past`, manual): its states from `days` ago to
 * its window start, at its own step. One extra request per mission, only when asked: the daily runs then extend
 * the archive with no request of their own.
 */
export async function fetchMissionPast(mission: Mission, now: Date, days: number): Promise<Float64Array> {
  const { horizonsId, sampling } = mission;
  if (!horizonsId || !sampling || sampling.pastDays >= days) return new Float64Array(0);
  const start = new Date(now.getTime() - days * 86_400_000);
  const stop = new Date(now.getTime() - sampling.pastDays * 86_400_000);
  const url = vectorsUrl(horizonsId, CENTER_CODES[mission.centralBody], start, stop, sampling.stepMin);
  return parseVectors(await query(url));
}

/** Little-endian Float64 bytes (explicit, whatever the host endianness). */
export function float64LittleEndian(data: Float64Array): Buffer {
  const buf = Buffer.alloc(data.length * 8);
  for (let i = 0; i < data.length; i++) buf.writeDoubleLE(data[i] ?? 0, i * 8);
  return buf;
}

/** Horizons CENTER codes of the planets (body centre), for moon vectors relative to their planet. */
export const PLANET_CENTERS: Readonly<Record<MoonPlanet, string>> = {
  earth: '500@399',
  mars: '500@499',
  jupiter: '500@599',
  saturn: '500@699',
  uranus: '500@799',
  neptune: '500@899',
  pluto: '500@999',
};

/** Moon window around the run: a month ahead, refreshed daily (beyond it the client falls back to mean elements). */
export const MOON_WINDOW = { pastDays: 2, futureDays: 30 } as const;

/**
 * Step for a moon: about 64 samples per orbit (cubic Hermite then stays well under a kilometre), between 10 min
 * (Phobos, Amalthea) and one day (Phoebe, Nereid).
 */
export function moonStepMin(periodDays: number): number {
  return Math.min(1440, Math.max(10, Math.round((periodDays * 1440) / 64)));
}

export interface MoonVectors {
  readonly data: Float64Array;
  readonly url: string;
  readonly center: string;
  readonly stepMin: number;
}

/** One request: the moon's planet-relative state vectors over MOON_WINDOW around `now`. */
export async function fetchMoonVectors(moon: Moon, now: Date): Promise<MoonVectors> {
  const periodDays = moon.elements?.periodDays;
  if (!periodDays) throw new Error(`${moon.id}: no orbital period to choose a step`);
  const stepMin = moonStepMin(periodDays);
  const center = PLANET_CENTERS[moon.planet];
  const start = new Date(now.getTime() - MOON_WINDOW.pastDays * 86_400_000);
  const stop = new Date(now.getTime() + MOON_WINDOW.futureDays * 86_400_000);
  const url = vectorsUrl(String(moon.spkid), center, start, stop, stepMin);
  const data = parseVectors(await query(url));
  if (data.length === 0) throw new ProviderError(`${moon.id}: no vectors in Horizons result`, url, 200);
  return { data, url, center, stepMin };
}
