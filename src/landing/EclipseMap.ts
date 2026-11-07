/**
 * Eclipse map of the guide page "When is the next eclipse?": an equirectangular SVG world (Natural Earth land
 * outline, public/landing/world.json) centred on the eclipse's longitude, so its zone never straddles the map's
 * edge. A solar eclipse shows the partial zone shaded by the fraction of the Sun covered, its outer limit, the path
 * of totality or annularity and the greatest eclipse, framed on the zone (or the whole world); a lunar eclipse shows
 * where the Moon is below the horizon at the start and at the end of the eclipse. The visitor's place and a point
 * picked on the map are marked. SVG units are degrees: x = longitude − centre + 180, y = 90 − latitude.
 */
import type { CoverageGrid, LatLon, SolarEclipseMap } from '../astro/eclipseMap';
import { wrapLon } from '../astro/eclipseMap';
import { isoline } from './contours';
import { nightPath } from './GroundTrackMap';

const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WORLD: Box = { x: 0, y: 0, w: 360, h: 180 };
/** Widest ratio of the framed zone (wide zones keep it, tall ones are widened to it). */
const MIN_ASPECT = 1.6;

/** Grid of the partial zone as an image: transparent outside, more opaque where more of the Sun is covered. */
function coverageImage(g: CoverageGrid): string | undefined {
  if (!g.cols || !g.rows || typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = g.cols;
  canvas.height = g.rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const img = ctx.createImageData(g.cols, g.rows);
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const v = Math.min(1, g.values[r * g.cols + c] ?? 0);
      // Image rows run from the north.
      const i = ((g.rows - 1 - r) * g.cols + c) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 196;
      img.data[i + 2] = 92;
      img.data[i + 3] = v > 0 ? Math.round(255 * (0.12 + 0.5 * v)) : 0;
    }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export class EclipseMap {
  readonly element: SVGSVGElement;
  private centreLonDeg = 0;
  private focus: Box | undefined;
  private world = true;
  private readonly lands: SVGPathElement[] = [];
  private readonly coverage = el('image', { class: 'ec-coverage', preserveAspectRatio: 'none' });
  private readonly limit = el('path', { class: 'ec-limit' });
  private readonly half = el('path', { class: 'ec-half' });
  private readonly central = el('g', { class: 'ec-central' });
  private readonly centreLine = el('path', { class: 'ec-centre-line' });
  private readonly moonDownStart = el('path', { class: 'ec-moon-down' });
  private readonly moonDownEnd = el('path', { class: 'ec-moon-down' });
  private readonly greatest = el('g', { class: 'ec-greatest' });
  private readonly you = el('g', { class: 'gt-you' });
  private readonly probe = el('g', { class: 'ec-probe' });
  private readonly markers = new Map<SVGGElement, LatLon | undefined>();

  constructor(labels: { you: string; probe: string; greatest: string }) {
    this.element = el('svg', { viewBox: '0 0 360 180', class: 'gt-map ec-map' });
    // Three copies of the land and the graticule, so a recentred map is covered from edge to edge.
    const world = el('g', { class: 'ec-world' });
    for (const dx of [-360, 0, 360]) {
      const g = el('g', { 'data-dx': dx });
      const land = el('path', { class: 'gt-land' });
      this.lands.push(land);
      const grid = el('g', { class: 'gt-grid' });
      for (let lon = -180; lon < 180; lon += 30)
        grid.append(el('line', { x1: lon + 180, y1: 0, x2: lon + 180, y2: 180 }));
      for (let lat = -60; lat <= 60; lat += 30)
        grid.append(el('line', { x1: 0, y1: 90 - lat, x2: 360, y2: 90 - lat }));
      g.append(land, grid);
      world.append(g);
    }
    const marker = (g: SVGGElement, shape: SVGElement, label: string, dy: number): void => {
      const text = el('text', { x: 4, y: dy });
      text.textContent = label;
      g.append(shape, text);
      g.style.display = 'none';
      this.markers.set(g, undefined);
    };
    marker(this.you, el('path', { d: 'M0 -3.4L2.6 1.6L-2.6 1.6Z' }), labels.you, 4);
    marker(this.probe, el('circle', { r: 1.8 }), labels.probe, 4);
    marker(this.greatest, el('path', { d: 'M0 -2.6L2.6 0L0 2.6L-2.6 0Z' }), labels.greatest, -3);
    this.element.append(
      el('rect', { x: -360, width: 1080, height: 180, class: 'gt-sea' }),
      world,
      this.moonDownStart,
      this.moonDownEnd,
      this.coverage,
      this.half,
      this.limit,
      this.central,
      this.centreLine,
      this.greatest,
      this.you,
      this.probe,
    );
    this.setCentre(0);
  }

  setLand(d: string): void {
    for (const l of this.lands) l.setAttribute('d', d);
  }

  private x(lonDeg: number): number {
    return wrapLon(lonDeg - this.centreLonDeg) + 180;
  }

  private setCentre(lonDeg: number): void {
    this.centreLonDeg = lonDeg;
    for (const g of this.element.querySelectorAll<SVGGElement>('.ec-world > g'))
      g.setAttribute('transform', `translate(${Number(g.dataset['dx']) - lonDeg} 0)`);
    for (const [g, p] of this.markers) this.place(g, p);
  }

  private clear(): void {
    for (const p of [this.limit, this.half, this.centreLine, this.moonDownStart, this.moonDownEnd])
      p.removeAttribute('d');
    this.coverage.removeAttribute('href');
    this.central.replaceChildren();
    this.setMarker(this.greatest, undefined);
  }

  /** A solar eclipse; `greatest` when it is central. */
  showSolar(map: SolarEclipseMap, greatest: LatLon | undefined): void {
    this.clear();
    this.setCentre(map.centreLonDeg);
    const g = map.grid;
    const toXY = (c: number, r: number): readonly [number, number] => [
      g.lonMinDeg + c * g.stepDeg + 180,
      90 - (g.latMinDeg + r * g.stepDeg),
    ];
    const href = coverageImage(g);
    if (href) {
      this.coverage.setAttribute('href', href);
      this.coverage.setAttribute('x', String(g.lonMinDeg + 180 - g.stepDeg / 2));
      this.coverage.setAttribute('y', String(90 - (g.latMinDeg + (g.rows - 1) * g.stepDeg) - g.stepDeg / 2));
      this.coverage.setAttribute('width', String(g.cols * g.stepDeg));
      this.coverage.setAttribute('height', String(g.rows * g.stepDeg));
    }
    this.limit.setAttribute('d', isoline(g.limitField, g.cols, g.rows, 0, toXY, -1));
    this.half.setAttribute('d', isoline(g.halfField, g.cols, g.rows, 0, toXY, -1));
    if (map.path) {
      this.central.setAttribute('data-kind', map.path.kind);
      // Each polygon drawn with continuous longitudes, and again a turn away when it crosses the map's edge.
      let d = '';
      for (const poly of map.path.polygons) {
        const first = poly[0];
        if (!first) continue;
        const x0 = this.x(first.lonDeg);
        const xs = poly.map((p) => x0 + wrapLon(p.lonDeg - first.lonDeg));
        const shifts = [0];
        if (Math.min(...xs) < 0) shifts.push(360);
        if (Math.max(...xs) > 360) shifts.push(-360);
        for (const dx of shifts)
          d += `M${poly.map((p, i) => `${((xs[i] ?? 0) + dx).toFixed(2)} ${(90 - p.latDeg).toFixed(2)}`).join('L')}Z`;
      }
      this.central.append(el('path', { d }));
      let line = '';
      let prev: number | undefined;
      for (const p of map.path.centreLine) {
        const x = this.x(p.lonDeg);
        line += `${prev === undefined || Math.abs(x - prev) > 180 ? 'M' : 'L'}${x.toFixed(2)} ${(90 - p.latDeg).toFixed(2)}`;
        prev = x;
      }
      this.centreLine.setAttribute('d', line);
    }
    this.setMarker(this.greatest, greatest);
    const f = map.focus;
    this.focus = f
      ? { x: f.west + 180, y: 90 - f.north, w: f.east - f.west, h: f.north - f.south }
      : undefined;
    this.world = !this.focus;
    this.frame();
  }

  /** A lunar eclipse: where the Moon is below the horizon at the start and at the end of the eclipse. */
  showLunar(below: { start: LatLon; end: LatLon; peak: LatLon }): void {
    this.clear();
    this.setCentre(below.peak.lonDeg);
    const rel = (p: LatLon): LatLon => ({ latDeg: p.latDeg, lonDeg: wrapLon(p.lonDeg - this.centreLonDeg) });
    // nightPath draws the side of the Earth away from a point overhead.
    this.moonDownStart.setAttribute('d', nightPath(rel(below.start)));
    this.moonDownEnd.setAttribute('d', nightPath(rel(below.end)));
    this.focus = undefined;
    this.world = true;
    this.frame();
  }

  /** Whether a framed view exists (solar eclipses), for the zoom button. */
  get canZoom(): boolean {
    return this.focus !== undefined;
  }

  get showsWorld(): boolean {
    return this.world;
  }

  setWorld(on: boolean): void {
    this.world = on || !this.focus;
    this.frame();
  }

  setObserver(p: LatLon | undefined): void {
    this.setMarker(this.you, p);
    this.frame();
  }

  setProbe(p: LatLon | undefined): void {
    this.setMarker(this.probe, p);
  }

  /** Map coordinates of a click, as a place. */
  pick(event: MouseEvent): LatLon | undefined {
    const ctm = this.element.getScreenCTM();
    if (!ctm) return undefined;
    const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    if (pt.y < 0 || pt.y > 180) return undefined;
    return { latDeg: 90 - pt.y, lonDeg: wrapLon(pt.x - 180 + this.centreLonDeg) };
  }

  private setMarker(g: SVGGElement, p: LatLon | undefined): void {
    this.markers.set(g, p);
    this.place(g, p);
  }

  /** Markers keep their size on screen: scaled with the framed width. */
  private place(g: SVGGElement, p: LatLon | undefined): void {
    g.style.display = p ? '' : 'none';
    if (!p) return;
    const k = this.box().w / 360;
    g.setAttribute(
      'transform',
      `translate(${this.x(p.lonDeg).toFixed(2)} ${(90 - p.latDeg).toFixed(2)}) scale(${k.toFixed(3)})`,
    );
  }

  private box(): Box {
    if (this.world || !this.focus) return WORLD;
    const b = { ...this.focus };
    // The visitor's place joins the frame when it is near the zone.
    const you = this.markers.get(this.you);
    if (you) {
      const x = this.x(you.lonDeg);
      const y = 90 - you.latDeg;
      if (x > b.x - 40 && x < b.x + b.w + 40 && y > b.y - 30 && y < b.y + b.h + 30) {
        const x0 = Math.min(b.x, x - 4);
        const y0 = Math.min(b.y, y - 4);
        b.w = Math.max(b.x + b.w, x + 4) - x0;
        b.h = Math.max(b.y + b.h, y + 4) - y0;
        b.x = x0;
        b.y = y0;
      }
    }
    if (b.w < MIN_ASPECT * b.h) {
      b.x -= (MIN_ASPECT * b.h - b.w) / 2;
      b.w = MIN_ASPECT * b.h;
    } else {
      b.y -= (b.w / MIN_ASPECT - b.h) / 2;
      b.h = b.w / MIN_ASPECT;
    }
    // Within the world, as large as it allows.
    b.w = Math.min(b.w, 360);
    b.h = Math.min(b.h, 180);
    b.x = Math.max(0, Math.min(360 - b.w, b.x));
    b.y = Math.max(0, Math.min(180 - b.h, b.y));
    return b;
  }

  private frame(): void {
    const b = this.box();
    this.element.setAttribute(
      'viewBox',
      `${b.x.toFixed(2)} ${b.y.toFixed(2)} ${b.w.toFixed(2)} ${b.h.toFixed(2)}`,
    );
    for (const [g, p] of this.markers) this.place(g, p);
  }
}
