/**
 * Ground-track map of the landing pages: an equirectangular SVG world (Natural Earth land outline, public/landing/
 * world.json), the night side from the subsolar point, the satellite's last half orbit (faded) and next orbit from
 * the engine's ground track, its position now and the visitor's place. SVG units are degrees: x = longitude + 180,
 * y = 90 − latitude.
 */
import * as Astronomy from 'astronomy-engine';

const SVG = 'http://www.w3.org/2000/svg';
const RAD = Math.PI / 180;

export interface MapPoint {
  readonly latDeg: number;
  readonly lonDeg: number;
}

const x = (lonDeg: number): number => lonDeg + 180;
const y = (latDeg: number): number => 90 - latDeg;

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Polyline path of a track, cut where it crosses the antimeridian. */
export function trackPath(points: readonly MapPoint[]): string {
  let d = '';
  let prev: MapPoint | undefined;
  for (const p of points) {
    const jump = prev && Math.abs(p.lonDeg - prev.lonDeg) > 180;
    d += `${!prev || jump ? 'M' : 'L'}${x(p.lonDeg).toFixed(2)} ${y(p.latDeg).toFixed(2)}`;
    prev = p;
  }
  return d;
}

/** The point where the Sun is overhead (degrees). */
export function subsolarPoint(date: Date): MapPoint {
  const time = Astronomy.MakeTime(date);
  const eq = Astronomy.Equator(Astronomy.Body.Sun, time, new Astronomy.Observer(0, 0, 0), true, true);
  const gast = Astronomy.SiderealTime(time);
  let lon = (eq.ra - gast) * 15;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { latDeg: eq.dec, lonDeg: lon };
}

/** Closed path of the night side for a subsolar point. */
export function nightPath(sun: MapPoint): string {
  // Terminator latitude for each longitude: where the Sun is on the horizon.
  const dec = Math.max(Math.abs(sun.latDeg), 0.05) * Math.sign(sun.latDeg || 1) * RAD;
  let d = '';
  for (let lon = -180; lon <= 180; lon += 2) {
    const lat = Math.atan(-Math.cos((lon - sun.lonDeg) * RAD) / Math.tan(dec)) / RAD;
    d += `${lon === -180 ? 'M' : 'L'}${x(lon)} ${y(lat).toFixed(2)}`;
  }
  // The night side holds the pole away from the Sun's declination.
  const pole = sun.latDeg >= 0 ? 180 : 0;
  return `${d}L360 ${pole}L0 ${pole}Z`;
}

export class GroundTrackMap {
  readonly element: SVGSVGElement;
  private readonly land = el('path', { class: 'gt-land' });
  private readonly night = el('path', { class: 'gt-night' });
  private readonly past = el('path', { class: 'gt-past' });
  private readonly future = el('path', { class: 'gt-future' });
  private readonly marker = el('g', { class: 'gt-object' });
  private readonly you = el('g', { class: 'gt-you' });
  private readonly objectText = el('text', { x: 4, y: -3 });

  constructor(objectLabel: string, youLabel: string) {
    this.element = el('svg', { viewBox: '0 0 360 180', class: 'gt-map', 'aria-hidden': 'true' });
    const grid = el('g', { class: 'gt-grid' });
    for (let lon = -150; lon <= 150; lon += 30)
      grid.append(el('line', { x1: x(lon), y1: 0, x2: x(lon), y2: 180 }));
    for (let lat = -60; lat <= 60; lat += 30)
      grid.append(el('line', { x1: 0, y1: y(lat), x2: 360, y2: y(lat) }));
    this.marker.append(el('circle', { r: 3.2, class: 'gt-halo' }), el('circle', { r: 1.6 }));
    this.objectText.textContent = objectLabel;
    this.marker.append(this.objectText);
    this.you.append(el('path', { d: 'M0 -3.4L2.6 1.6L-2.6 1.6Z' }));
    const youText = el('text', { x: 4, y: 4 });
    youText.textContent = youLabel;
    this.you.append(youText);
    this.marker.style.display = 'none';
    this.you.style.display = 'none';
    this.element.append(
      el('rect', { width: 360, height: 180, class: 'gt-sea' }),
      this.land,
      grid,
      this.night,
      this.past,
      this.future,
      this.you,
      this.marker,
    );
  }

  setLabel(text: string): void {
    this.objectText.textContent = text;
  }

  setLand(d: string): void {
    this.land.setAttribute('d', d);
  }

  setSun(date: Date): void {
    this.night.setAttribute('d', nightPath(subsolarPoint(date)));
  }

  setTrack(past: readonly MapPoint[], future: readonly MapPoint[]): void {
    this.past.setAttribute('d', trackPath(past));
    this.future.setAttribute('d', trackPath(future));
  }

  setPosition(p: MapPoint | undefined): void {
    this.marker.style.display = p ? '' : 'none';
    if (p)
      this.marker.setAttribute('transform', `translate(${x(p.lonDeg).toFixed(2)} ${y(p.latDeg).toFixed(2)})`);
  }

  setObserver(p: MapPoint | undefined): void {
    this.you.style.display = p ? '' : 'none';
    if (p)
      this.you.setAttribute('transform', `translate(${x(p.lonDeg).toFixed(2)} ${y(p.latDeg).toFixed(2)})`);
  }
}
