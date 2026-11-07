/**
 * Eclipses on the map of the Earth, from astronomy-engine's apparent geocentric Sun and Moon turned into the
 * Earth-fixed frame (apparent sidereal time; polar motion neglected):
 * - solar eclipses: on a latitude/longitude grid, the greatest fraction of the Sun's diameter the Moon covers while
 *   the Sun is up (the partial zone and its limit), and the footprints of the umbra (total) or antumbra (annular) on
 *   the WGS 84 ellipsoid every 20 s, whose union is the path of the central eclipse;
 * - lunar eclipses: the point below the Moon, around which it is above the horizon.
 * The Sun and the Moon are spheres (no lunar limb profile): the limits are good to a few kilometres, more along the
 * sunrise and sunset edges. Pure functions, no DOM: the landing page runs them in a worker.
 */
import * as Astronomy from 'astronomy-engine';

export type Vec3 = readonly [number, number, number];

export interface LatLon {
  readonly latDeg: number;
  readonly lonDeg: number;
}

const AU_KM = 149_597_870.7;
export const SUN_RADIUS_KM = 695_700;
/** astronomy-engine's mean lunar radius, as in its eclipse searches and src/engine/events.ts. */
export const MOON_RADIUS_KM = 1737.4;
const A_KM = 6378.137;
const FLATTENING = 1 / 298.257223563;
const E2 = FLATTENING * (2 - FLATTENING);
const RAD = Math.PI / 180;
/** The Sun's centre at the horizon with the usual refraction (34′): geometric altitude −0.57°. */
const SUN_UP_SIN = Math.sin(-0.57 * RAD);
/**
 * Scale of the Sun's height (sine of its altitude) in the contour fields: about 0.035 per degree of ground, like the
 * magnitude across the penumbra (0 to 1 over some 30°), so the field is about as steep on both sides of the horizon.
 */
const HORIZON_SCALE = 2;

/** Apparent geocentric Sun and Moon in the Earth-fixed frame (km). */
export function sunMoonEcef(date: Date): { sun: Vec3; moon: Vec3 } {
  const time = Astronomy.MakeTime(date);
  const rot = Astronomy.Rotation_EQJ_EQD(time);
  const theta = Astronomy.SiderealTime(time) * 15 * RAD;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const toEcef = (v: Astronomy.Vector): Vec3 => {
    const d = Astronomy.RotateVector(rot, v);
    return [(d.x * c + d.y * s) * AU_KM, (-d.x * s + d.y * c) * AU_KM, d.z * AU_KM];
  };
  return {
    sun: toEcef(Astronomy.GeoVector(Astronomy.Body.Sun, time, true)),
    moon: toEcef(Astronomy.GeoVector(Astronomy.Body.Moon, time, true)),
  };
}

/** A point of the WGS 84 ellipsoid (km) and its local vertical. */
export function surfacePoint(latDeg: number, lonDeg: number): { p: Vec3; up: Vec3 } {
  const phi = latDeg * RAD;
  const lam = lonDeg * RAD;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const n = A_KM / Math.sqrt(1 - E2 * sp * sp);
  const up: Vec3 = [cp * Math.cos(lam), cp * Math.sin(lam), sp];
  return { p: [n * up[0], n * up[1], n * (1 - E2) * sp], up };
}

/** Geodetic latitude and longitude of a point on the ellipsoid. */
function geodetic(p: Vec3): LatLon {
  return {
    latDeg: Math.atan2(p[2], (1 - E2) * Math.hypot(p[0], p[1])) / RAD,
    lonDeg: Math.atan2(p[1], p[0]) / RAD,
  };
}

/** The point of the Earth below a body (geocentric latitude, close enough for a horizon on a world map). */
export function pointBelow(v: Vec3): LatLon {
  return { latDeg: Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD, lonDeg: Math.atan2(v[1], v[0]) / RAD };
}

/** Longitude in −180…180. */
export const wrapLon = (lonDeg: number): number => ((((lonDeg + 180) % 360) + 360) % 360) - 180;

/**
 * Fraction of the Sun's diameter covered by the Moon seen from a point of the surface (the eclipse magnitude; above
 * 1 in a total eclipse), 0 when they do not overlap or the Sun is down. Small-angle forms: the discs are under a
 * degree apart whenever they overlap.
 */
export function coverage(p: Vec3, up: Vec3, sun: Vec3, moon: Vec3): number {
  const sx = sun[0] - p[0];
  const sy = sun[1] - p[1];
  const sz = sun[2] - p[2];
  const ds = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (up[0] * sx + up[1] * sy + up[2] * sz < SUN_UP_SIN * ds) return 0;
  const mx = moon[0] - p[0];
  const my = moon[1] - p[1];
  const mz = moon[2] - p[2];
  const dm = Math.sqrt(mx * mx + my * my + mz * mz);
  const cx = sy * mz - sz * my;
  const cy = sz * mx - sx * mz;
  const cz = sx * my - sy * mx;
  const sep = Math.sqrt(cx * cx + cy * cy + cz * cz) / (ds * dm);
  const rs = SUN_RADIUS_KM / ds;
  const rm = MOON_RADIUS_KM / dm;
  return eclipseMagnitude(sep, rs, rm);
}

/**
 * Eclipse magnitude from the discs' separation and radii (any angular unit): the fraction of the Sun's diameter
 * covered, and the ratio of the diameters once one disc lies inside the other (annular or total, the usual
 * convention).
 */
export function eclipseMagnitude(sep: number, rs: number, rm: number): number {
  if (sep >= rs + rm) return 0;
  if (sep <= Math.abs(rs - rm)) return rm / rs;
  return (rs + rm - sep) / (2 * rs);
}

/** The greatest coverage at grid nodes: lat = latMinDeg + row × step, lon = centre + lonMinDeg + col × step. */
export interface CoverageGrid {
  /** West edge, relative to the map's centre longitude. */
  readonly lonMinDeg: number;
  readonly latMinDeg: number;
  readonly stepDeg: number;
  readonly cols: number;
  readonly rows: number;
  /** Row-major, south row first. */
  readonly values: Float32Array;
  /**
   * Signed fields whose zero is the outer limit and the 50 % line: like the coverage less the level, but negative
   * beyond the limit (discs apart) and below the horizon, and continuous across both, so the contours interpolate
   * smoothly between nodes instead of following the grid.
   */
  readonly limitField: Float32Array;
  readonly halfField: Float32Array;
}

export type CentralKind = 'total' | 'annular' | 'hybrid';

export interface SolarEclipseMap {
  /** Longitude the map is centred on: where the shadow's axis meets (or passes nearest) the Earth at the greatest eclipse. */
  readonly centreLonDeg: number;
  readonly grid: CoverageGrid;
  /**
   * Where to frame the map (degrees, longitudes relative to the centre): the partial zone, its longitudes taken below
   * 70° of latitude (near a pole the zone spans every longitude).
   */
  readonly focus?: {
    readonly west: number;
    readonly east: number;
    readonly south: number;
    readonly north: number;
  };
  /** The central eclipse's path: convex hulls of consecutive shadow footprints (absolute longitudes). */
  readonly path?: {
    readonly kind: CentralKind;
    readonly polygons: readonly (readonly LatLon[])[];
    /** Where the shadow's axis meets the ground. */
    readonly centreLine: readonly LatLon[];
  };
}

interface Sample {
  readonly tMs: number;
  readonly sun: Vec3;
  readonly moon: Vec3;
}

/** Shadow axis from the Sun through the Moon: unit direction, Sun–Moon distance, the foot nearest the Earth's centre. */
function shadowAxis(
  sun: Vec3,
  moon: Vec3,
): { d: Vec3; distKm: number; zKm: number; missKm: number; foot: Vec3 } {
  const v: Vec3 = [moon[0] - sun[0], moon[1] - sun[1], moon[2] - sun[2]];
  const distKm = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / distKm, v[1] / distKm, v[2] / distKm];
  const zKm = -(moon[0] * d[0] + moon[1] * d[1] + moon[2] * d[2]);
  const foot: Vec3 = [moon[0] + zKm * d[0], moon[1] + zKm * d[1], moon[2] + zKm * d[2]];
  return { d, distKm, zKm, missKm: Math.hypot(foot[0], foot[1], foot[2]), foot };
}

/**
 * Where the shadow's axis enters the Earth (a sphere is enough to centre a map), or, when it passes beside it, the
 * axis's point nearest the Earth's centre (towards the limb under the shadow).
 */
function shadowCentre(sun: Vec3, moon: Vec3): Vec3 {
  const { d, missKm, foot } = shadowAxis(sun, moon);
  if (missKm >= A_KM) return foot;
  const back = Math.sqrt(A_KM * A_KM - missKm * missKm);
  return [foot[0] - back * d[0], foot[1] - back * d[1], foot[2] - back * d[2]];
}

/** Whether the penumbra reaches the Earth at all. */
function penumbraTouches(sun: Vec3, moon: Vec3): boolean {
  const a = shadowAxis(sun, moon);
  const radiusKm = MOON_RADIUS_KM + (a.zKm * (SUN_RADIUS_KM + MOON_RADIUS_KM)) / a.distKm;
  return a.missKm < radiusKm + A_KM * 1.01;
}

/** First intersection of a ray with the ellipsoid (distance along the unit direction), if any. */
function rayEllipsoid(o: Vec3, d: Vec3): number | undefined {
  const k = 1 / (1 - FLATTENING);
  const oz = o[2] * k;
  const dz = d[2] * k;
  const a = d[0] * d[0] + d[1] * d[1] + dz * dz;
  const b = 2 * (o[0] * d[0] + o[1] * d[1] + oz * dz);
  const c = o[0] * o[0] + o[1] * o[1] + oz * oz - A_KM * A_KM;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return undefined;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 ? t : undefined;
}

const FOOTPRINT_POINTS = 36;
/** Fractions of the cone's radius tried, along a direction whose edge misses the Earth, to find the limb. */
const LIMB_STEPS = 16;
/** Bisection steps to a limb point (about 1/16000 of the cone's radius). */
const BISECTIONS = 14;

/**
 * The umbra's (or antumbra's) footprint on the ground: rays parallel to the axis at the cone's radius, the radius
 * corrected where each ray meets the ground (the cone narrows by about 5 km per 1000 km). Where a ray passes beside
 * the Earth, the footprint ends at the limb (found by bisection along that direction), so the ends of the path,
 * where the cone touches the Earth before or after its axis does, are mapped too. `axisHits` is false there and
 * `centre` is then the middle of the touching part. Undefined when the cone misses the Earth.
 */
export function shadowFootprint(
  sun: Vec3,
  moon: Vec3,
): { centre: LatLon; ring: LatLon[]; umbraKm: number; axisHits: boolean } | undefined {
  const { d, distKm, zKm } = shadowAxis(sun, moon);
  const hit = rayEllipsoid(moon, d);
  const narrowing = (SUN_RADIUS_KM - MOON_RADIUS_KM) / distKm;
  const umbraKm = MOON_RADIUS_KM - (hit ?? zKm) * narrowing;
  // Two unit vectors across the axis.
  const ref: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1n: Vec3 = [
    d[1] * ref[2] - d[2] * ref[1],
    d[2] * ref[0] - d[0] * ref[2],
    d[0] * ref[1] - d[1] * ref[0],
  ];
  const l = Math.hypot(e1n[0], e1n[1], e1n[2]);
  const e1: Vec3 = [e1n[0] / l, e1n[1] / l, e1n[2] / l];
  const e2: Vec3 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
  /** Where the ray at a fraction of the cone's radius, in direction u across the axis, meets the ground. */
  const ground = (u: Vec3, fraction: number): Vec3 | undefined => {
    let r = fraction * Math.abs(umbraKm);
    let point: Vec3 | undefined;
    for (let k = 0; k < 3; k++) {
      const o: Vec3 = [moon[0] + r * u[0], moon[1] + r * u[1], moon[2] + r * u[2]];
      const t = rayEllipsoid(o, d);
      if (t === undefined) return undefined;
      point = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
      r = fraction * Math.abs(MOON_RADIUS_KM - t * narrowing);
    }
    return point;
  };
  const across = (phi: number): Vec3 => [
    Math.cos(phi) * e1[0] + Math.sin(phi) * e2[0],
    Math.cos(phi) * e1[1] + Math.sin(phi) * e2[1],
    Math.cos(phi) * e1[2] + Math.sin(phi) * e2[2],
  ];
  /** The ground point at the limb between a fraction that meets the Earth and one that misses it. */
  const limb = (u: Vec3, inside: number, outside: number): Vec3 | undefined => {
    let point = ground(u, inside);
    for (let k = 0; k < BISECTIONS; k++) {
      const mid = (inside + outside) / 2;
      const q = ground(u, mid);
      if (q) {
        inside = mid;
        point = q;
      } else outside = mid;
    }
    return point;
  };
  const points: Vec3[] = [];
  const rimHits: boolean[] = [];
  for (let i = 0; i < FOOTPRINT_POINTS; i++) {
    const u = across((2 * Math.PI * i) / FOOTPRINT_POINTS);
    const rim = ground(u, 1);
    rimHits.push(rim !== undefined);
    if (rim) points.push(rim);
    // Most of the path: the whole cross-section meets the Earth.
    if (rim && hit !== undefined) continue;
    // Part of the cone passes beside the Earth: along this radius, the footprint ends at the limb (outside the
    // rim, inside the axis when the axis misses).
    const hits: boolean[] = [];
    for (let k = 0; k <= LIMB_STEPS; k++)
      hits.push(k === LIMB_STEPS ? !!rim : ground(u, k / LIMB_STEPS) !== undefined);
    const first = hits.indexOf(true);
    const last = hits.lastIndexOf(true);
    if (first < 0) continue;
    if (last < LIMB_STEPS) {
      const q = limb(u, last / LIMB_STEPS, (last + 1) / LIMB_STEPS);
      if (q) points.push(q);
    }
    if (first > 0) {
      const q = limb(u, first / LIMB_STEPS, (first - 1) / LIMB_STEPS);
      if (q) points.push(q);
    }
  }
  // Where the rim itself crosses the limb, between two radii, one meeting the Earth and the other not.
  for (let i = 0; i < FOOTPRINT_POINTS; i++) {
    const j = (i + 1) % FOOTPRINT_POINTS;
    if (rimHits[i] === rimHits[j]) continue;
    let inside = (2 * Math.PI * (rimHits[i] ? i : i + 1)) / FOOTPRINT_POINTS;
    let outside = (2 * Math.PI * (rimHits[i] ? i + 1 : i)) / FOOTPRINT_POINTS;
    let point: Vec3 | undefined;
    for (let k = 0; k < BISECTIONS; k++) {
      const mid = (inside + outside) / 2;
      const q = ground(across(mid), 1);
      if (q) {
        inside = mid;
        point = q;
      } else outside = mid;
    }
    if (point) points.push(point);
  }
  if (!points.length) return undefined;
  let centreKm: Vec3 = [0, 0, 0];
  if (hit !== undefined) centreKm = [moon[0] + hit * d[0], moon[1] + hit * d[1], moon[2] + hit * d[2]];
  else for (const q of points) centreKm = [centreKm[0] + q[0], centreKm[1] + q[1], centreKm[2] + q[2]];
  return { centre: geodetic(centreKm), ring: points.map(geodetic), umbraKm, axisHits: hit !== undefined };
}

type Pt = readonly [number, number];

/** Convex hull (monotone chain) of points in the plane, counter-clockwise. */
function hull(points: readonly Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Pt, a: Pt, b: Pt): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (list: readonly Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const q of list) {
      for (;;) {
        const a = out[out.length - 2];
        const b = out[out.length - 1];
        if (!a || !b || cross(a, b, q) > 0) break;
        out.pop();
      }
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...chain(sorted), ...chain([...sorted].reverse())];
}

/** Greatest coverage over the samples at every node of a grid. */
function coverageGrid(
  samples: readonly Sample[],
  centreLonDeg: number,
  lonMinDeg: number,
  latMinDeg: number,
  stepDeg: number,
  cols: number,
  rows: number,
): CoverageGrid {
  const values = new Float32Array(cols * rows);
  const limitField = new Float32Array(cols * rows);
  const halfField = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = Math.min(90, latMinDeg + r * stepDeg);
    for (let c = 0; c < cols; c++) {
      const { p, up } = surfacePoint(lat, centreLonDeg + lonMinDeg + c * stepDeg);
      let best = 0;
      let limit = -Infinity;
      let half = -Infinity;
      for (const s of samples) {
        const sx = s.sun[0] - p[0];
        const sy = s.sun[1] - p[1];
        const sz = s.sun[2] - p[2];
        const ds = Math.sqrt(sx * sx + sy * sy + sz * sz);
        const sunTerm = HORIZON_SCALE * ((up[0] * sx + up[1] * sy + up[2] * sz) / ds - SUN_UP_SIN);
        const mx = s.moon[0] - p[0];
        const my = s.moon[1] - p[1];
        const mz = s.moon[2] - p[2];
        const dm = Math.sqrt(mx * mx + my * my + mz * mz);
        const cx = sy * mz - sz * my;
        const cy = sz * mx - sx * mz;
        const cz = sx * my - sy * mx;
        const sep = Math.sqrt(cx * cx + cy * cy + cz * cz) / (ds * dm);
        const rs = SUN_RADIUS_KM / ds;
        const rm = MOON_RADIUS_KM / dm;
        // The magnitude, continued below 0 while the discs are apart.
        const signed = sep <= Math.abs(rs - rm) ? rm / rs : (rs + rm - sep) / (2 * rs);
        if (sunTerm >= 0 && signed > best) best = signed;
        limit = Math.max(limit, Math.min(signed, sunTerm));
        half = Math.max(half, Math.min(signed - 0.5, sunTerm));
      }
      values[r * cols + c] = best;
      limitField[r * cols + c] = limit;
      halfField[r * cols + c] = half;
    }
  }
  return { lonMinDeg, latMinDeg, stepDeg, cols, rows, values, limitField, halfField };
}

/** Bounding box of the nodes with some coverage, in grid degrees (relative longitudes). */
function coveredBox(
  g: CoverageGrid,
  maxLatForLonDeg = 90,
): { west: number; east: number; south: number; north: number } | undefined {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      if (!((g.values[r * g.cols + c] ?? 0) > 0)) continue;
      const lon = g.lonMinDeg + c * g.stepDeg;
      const lat = g.latMinDeg + r * g.stepDeg;
      if (Math.abs(lat) <= maxLatForLonDeg) {
        west = Math.min(west, lon);
        east = Math.max(east, lon);
      }
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  return west <= east ? { west, east, south, north } : undefined;
}

const HOUR_MS = 3_600_000;
const SAMPLE_MS = 2 * 60_000;
const PATH_STEP_MS = 20_000;
/** Above this many nodes, the fine grid takes 1° steps instead of 0.5°. */
const MAX_FINE_NODES = 50_000;

/**
 * The map of a solar eclipse around its greatest eclipse (astronomy-engine's `peak`): the coverage grid over the
 * partial zone and, for a central eclipse, its path.
 */
export function solarEclipseMap(peak: Date): SolarEclipseMap {
  const samples: Sample[] = [];
  for (let t = peak.getTime() - 4 * HOUR_MS; t <= peak.getTime() + 4 * HOUR_MS; t += SAMPLE_MS) {
    const s = sunMoonEcef(new Date(t));
    if (penumbraTouches(s.sun, s.moon)) samples.push({ tMs: t, ...s });
  }
  const atPeak = sunMoonEcef(peak);
  const centreLonDeg = pointBelow(shadowCentre(atPeak.sun, atPeak.moon)).lonDeg;

  // A coarse world grid (2°, every third sample) finds the partial zone, then a fine one covers it.
  const coarse = coverageGrid(
    samples.filter((_, i) => i % 3 === 0),
    centreLonDeg,
    -180,
    -90,
    2,
    180,
    91,
  );
  const box = coveredBox(coarse);
  let grid: CoverageGrid;
  if (!box)
    grid = {
      lonMinDeg: 0,
      latMinDeg: 0,
      stepDeg: 1,
      cols: 0,
      rows: 0,
      values: new Float32Array(0),
      limitField: new Float32Array(0),
      halfField: new Float32Array(0),
    };
  else {
    const pad = 4;
    const west = Math.max(-180, box.west - pad);
    const east = Math.min(180, box.east + pad);
    const south = Math.max(-90, box.south - pad);
    const north = Math.min(90, box.north + pad);
    let step = 0.5;
    if (((east - west) / step + 1) * ((north - south) / step + 1) > MAX_FINE_NODES) step = 1;
    const cols = Math.floor((east - west) / step) + 1;
    const rows = Math.floor((north - south) / step) + 1;
    grid = coverageGrid(samples, centreLonDeg, west, south, step, cols, rows);
  }

  // The central path: footprints every 20 s while the umbra or antumbra touches the Earth.
  const central = samples.filter((s) => shadowFootprint(s.sun, s.moon) !== undefined).map((s) => s.tMs);
  const firstMs = central[0];
  const lastMs = central[central.length - 1];
  let path: SolarEclipseMap['path'];
  if (firstMs !== undefined && lastMs !== undefined) {
    const rel = (p: LatLon): Pt => [wrapLon(p.lonDeg - centreLonDeg), p.latDeg];
    const polygons: LatLon[][] = [];
    const centreLine: LatLon[] = [];
    let total = false;
    let annular = false;
    let previous: Pt[] | undefined;
    for (let t = firstMs - SAMPLE_MS; t <= lastMs + SAMPLE_MS; t += PATH_STEP_MS) {
      const s = sunMoonEcef(new Date(t));
      const f = shadowFootprint(s.sun, s.moon);
      if (!f || f.ring.length < 3) {
        previous = undefined;
        continue;
      }
      if (f.umbraKm > 0) total = true;
      else annular = true;
      if (f.axisHits) centreLine.push(f.centre);
      // Continuous longitudes around the footprint's centre, even where it crosses the map's edge.
      const [cx] = rel(f.centre);
      const ring = f.ring.map((p): Pt => [cx + wrapLon(p.lonDeg - f.centre.lonDeg), p.latDeg]);
      polygons.push(
        hull(previous ? [...previous, ...ring] : ring).map(([x, y]) => ({
          latDeg: y,
          lonDeg: wrapLon(x + centreLonDeg),
        })),
      );
      previous = ring;
    }
    if (polygons.length)
      path = { kind: total && annular ? 'hybrid' : total ? 'total' : 'annular', polygons, centreLine };
  }
  const focus = coveredBox(grid, 70) ?? coveredBox(grid);
  return { centreLonDeg, grid, ...(focus ? { focus } : {}), ...(path ? { path } : {}) };
}

/** Great-circle distance between two points (km, mean Earth radius). */
export function groundDistanceKm(a: LatLon, b: LatLon): number {
  const p1 = a.latDeg * RAD;
  const p2 = b.latDeg * RAD;
  const dp = p2 - p1;
  const dl = (b.lonDeg - a.lonDeg) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a towards b (radians from north, clockwise). */
export function bearingRad(a: LatLon, b: LatLon): number {
  const p1 = a.latDeg * RAD;
  const p2 = b.latDeg * RAD;
  const dl = (b.lonDeg - a.lonDeg) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
}
