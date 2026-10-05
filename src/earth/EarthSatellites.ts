/**
 * View A satellite layer: owns the worker pool, the sample timeline, the GPU points, the selection
 * (marker + orbit line) and the filter-derived display state.
 */
import { Color, Group } from 'three';
import { rotZ } from '../astro/frames';
import type { Vec3 } from '../astro/vec3';
import { trajectoryTimes } from '../astro/trajectory';
import { GpuPicker } from '../render/GpuPicker';
import { OrbitLine, SelectionMarker } from '../render/OrbitLine';
import { SatState, SatellitePoints } from '../render/SatellitePoints';
import type { SatRec } from 'satellite.js';
import { isStale, type SatCatalog, type SatObject } from './catalog';
import { EMPTY_FILTERS, matchesFilters, type FilterState } from './filters';
import { PropagatorPool, type Sample } from './PropagatorPool';
import { SampleTimeline } from './SampleTimeline';
import { makeSatrec, propagateTeme, type TemeState } from './sgp4';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const REGIME_COLORS: Record<SatObject['regime'], string> = {
  LEO: '#8fb3e8',
  MEO: '#c9a0dc',
  GEO: '#f5d76e',
  HEO: '#f28b82',
};
const ORBIT_SAMPLES = 360;
/** Re-evaluate staleness (depends on simulated time) at most this often. */
/** The selected orbit's trace is rebuilt after the object covers this fraction of its period (0.5°). */
const ORBIT_REBUILD_FRACTION = 1 / 720;
const STATE_REFRESH_MS = 1000;

export interface SatStats {
  readonly total: number;
  readonly shown: number;
  readonly invalid: number;
  readonly stale: number;
}

export interface Selection {
  readonly object: SatObject;
  readonly state: TemeState | undefined;
}

export class EarthSatellites {
  /** TEME objects; rotated by −GMST (Earth-fixed view) or 0 (inertial view) every frame. */
  readonly group = new Group();
  readonly points: SatellitePoints;
  private readonly pool: PropagatorPool;
  private readonly timeline = new SampleTimeline<Sample>();
  private readonly picker: GpuPicker;
  private readonly orbit = new OrbitLine();
  private readonly marker: SelectionMarker;
  private readonly states: Float32Array;
  private filters: FilterState = EMPTY_FILTERS;
  private filterMatch: Uint8Array;
  private statesDirty = true;
  private frameAngleRad = 0;
  /** The selected object's 3D model is drawn: hide its point and ring (they would jitter around it). */
  private selectedPointHidden = false;
  private lastStateRefreshWallMs = 0;
  private selected: { object: SatObject; satrec: SatRec | undefined } | undefined;
  private selectedState: TemeState | undefined;
  private lastOk: Uint8Array | undefined;
  /** Selection and simulated time the marker state was last computed for. */
  private selectedFor: unknown;
  private selectedMs = Number.NaN;
  /** Selection and simulated time the orbit trace was last built for. */
  private orbitBuiltFor: unknown;
  private orbitBuiltMs = Number.NaN;
  private statsValue: SatStats;
  private disposed = false;

  constructor(
    readonly catalog: SatCatalog,
    renderer: WebGLRenderer,
  ) {
    const n = catalog.objects.length;
    const pixelRatio = renderer.getPixelRatio();
    this.points = new SatellitePoints(n, pixelRatio);
    this.marker = new SelectionMarker(pixelRatio);
    this.picker = new GpuPicker(renderer);
    this.pool = new PropagatorPool(catalog.objects.map((o) => o.omm));
    this.states = new Float32Array(n);
    this.filterMatch = new Uint8Array(n).fill(1);
    this.statsValue = { total: n, shown: 0, invalid: 0, stale: 0 };
    this.group.name = 'inertial';
    this.group.add(this.points.points, this.points.pickPoints, this.orbit.line, this.marker.points);
    this.points.setColors(this.buildColors());
  }

  get ready(): Promise<{ initFailed: number }> {
    return this.pool.ready;
  }

  get stats(): SatStats {
    return this.statsValue;
  }

  get selection(): Selection | undefined {
    if (!this.selected) return undefined;
    return { object: this.selected.object, state: this.selectedState };
  }

  setFilters(filters: FilterState): void {
    this.filters = filters;
    const objects = this.catalog.objects;
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      this.filterMatch[i] = obj && matchesFilters(obj, filters) ? 1 : 0;
    }
    this.statesDirty = true;
  }

  get currentFilters(): FilterState {
    return this.filters;
  }

  /** Indices of objects passing the filters (for the accessible list). */
  filteredObjects(): SatObject[] {
    return this.catalog.objects.filter((o) => this.filterMatch[o.index] === 1);
  }

  select(object: SatObject | undefined): void {
    this.selected = object ? { object, satrec: makeSatrec(object.omm) } : undefined;
    if (!object) {
      this.orbit.set(undefined);
      this.marker.set(undefined);
      this.selectedState = undefined;
    }
  }

  /** World-frame position of the selected object (for camera follow). */
  selectedWorldPositionKm(frameAngleRad: number): Vec3 | undefined {
    const s = this.selectedState;
    return s ? rotZ(s.posKm, frameAngleRad) : undefined;
  }

  /** Direction of motion of the selected object in the scene (TEME velocity, frame rotation only). */
  selectedWorldVelocityKmS(frameAngleRad: number): Vec3 | undefined {
    const s = this.selectedState;
    return s ? rotZ(s.velKmS, frameAngleRad) : undefined;
  }

  /** Hides the selected object's point and selection ring while its 3D model replaces them. */
  setSelectedPointHidden(hidden: boolean): void {
    if (hidden !== this.selectedPointHidden) {
      this.selectedPointHidden = hidden;
      this.statesDirty = true;
    }
    this.marker.points.visible = !hidden && this.selectedState !== undefined;
  }

  pick(scene: Scene, camera: PerspectiveCamera, xCss: number, yCss: number): SatObject | undefined {
    const index = this.picker.pick(scene, camera, xCss, yCss);
    return index === undefined ? undefined : this.catalog.objects[index];
  }

  /** Group matrix = T(−origin) · Rz(angle): the floating origin is applied after the TEME rotation. */
  placeOrigin(originKm: Vec3): void {
    this.group.position.set(-originKm[0], -originKm[1], -originKm[2]);
    // The points subtract the camera in TEME themselves (high/low split, see SatellitePoints).
    this.points.setCamera(rotZ(originKm, -this.frameAngleRad));
  }

  /** Per-frame update. `frameAngleRad` rotates TEME into the scene frame. */
  update(simNowMs: number, rate: number, clockEpoch: number, frameAngleRad: number): void {
    this.group.rotation.set(0, 0, frameAngleRad);
    this.frameAngleRad = frameAngleRad;

    this.schedule(simNowMs, rate, clockEpoch);
    const interp = this.timeline.interpolation(simNowMs);
    if (interp) this.points.setInterpolation(interp);

    const wallMs = performance.now();
    if (this.statesDirty || wallMs - this.lastStateRefreshWallMs > STATE_REFRESH_MS) {
      this.refreshStates(simNowMs);
      this.lastStateRefreshWallMs = wallMs;
    }
    this.updateSelection(simNowMs);
  }

  dispose(): void {
    this.disposed = true;
    this.pool.dispose();
    this.points.dispose();
    this.orbit.dispose();
    this.picker.dispose();
  }

  private schedule(simNowMs: number, rate: number, clockEpoch: number): void {
    const t = this.timeline.nextRequest(simNowMs, rate, clockEpoch);
    if (t === undefined) return;
    const epoch = this.timeline.begin();
    const started = performance.now();
    this.pool
      .propagate(t)
      .then((sample) => {
        if (this.disposed) return;
        if (this.timeline.accept(sample, epoch, performance.now() - started)) {
          const { a, b } = this.timeline;
          if (a && b) this.points.setSamples(a, b);
          // Statuses only change when an object starts or stops propagating (decay, bad elements).
          if (!sameBytes(this.lastOk, sample.ok)) this.statesDirty = true;
          this.lastOk = sample.ok;
        }
      })
      .catch((err: unknown) => {
        this.timeline.cancel();
        console.error(err);
      });
  }

  private refreshStates(simNowMs: number): void {
    const objects = this.catalog.objects;
    let shown = 0;
    let invalid = 0;
    let stale = 0;
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (!obj) continue;
      const ok = this.lastOk ? this.lastOk[i] === 1 : true;
      if (!ok) invalid++;
      const isOld = isStale(obj, simNowMs);
      if (isOld) stale++;
      const visible = ok && this.filterMatch[i] === 1;
      if (visible) shown++;
      const replaced = this.selectedPointHidden && this.selected?.object.index === i;
      this.states[i] = visible && !replaced ? (isOld ? SatState.Stale : SatState.Normal) : SatState.Hidden;
    }
    this.points.setStates(this.states);
    this.statsValue = { total: objects.length, shown, invalid, stale };
    this.statesDirty = false;
  }

  private updateSelection(simNowMs: number): void {
    const sel = this.selected;
    if (!sel) return;
    // Paused: same time, same object, nothing to recompute.
    if (sel === this.selectedFor && simNowMs === this.selectedMs) return;
    this.selectedFor = sel;
    this.selectedMs = simNowMs;
    this.selectedState = sel.satrec ? propagateTeme(sel.satrec, new Date(simNowMs)) : undefined;
    this.marker.set(this.selectedState?.posKm);

    // The trace (≈ 400 SGP4 calls) is rebuilt around the object, densified near it, each time it has moved
    // ORBIT_REBUILD_FRACTION of its period (every frame at high rates): its vertices are relative to where it
    // was then, so it stays free of Float32 jitter when the camera follows it closely, and the object stays in
    // the densely sampled stretch, a few metres at most from the line.
    const periodMs = sel.object.periodMin * 60_000;
    const centre = this.selectedState?.posKm;
    if (!sel.satrec || !centre) {
      this.orbit.set(undefined);
      this.orbitBuiltFor = undefined;
      return;
    }
    if (
      sel === this.orbitBuiltFor &&
      Math.abs(simNowMs - this.orbitBuiltMs) < periodMs * ORBIT_REBUILD_FRACTION
    ) {
      return;
    }
    this.orbitBuiltFor = sel;
    this.orbitBuiltMs = simNowMs;
    this.orbit.set(orbitTrace(sel.satrec, simNowMs, periodMs, centre));
    this.orbit.line.position.set(centre[0], centre[1], centre[2]);
  }

  private buildColors(): Float32Array {
    const colors = new Float32Array(this.catalog.objects.length * 3);
    const c = new Color();
    for (const obj of this.catalog.objects) {
      const op = obj.operatorId ? this.catalog.operators.operators[obj.operatorId] : undefined;
      c.set(op?.color ?? REGIME_COLORS[obj.regime]);
      colors.set([c.r, c.g, c.b], obj.index * 3);
    }
    return colors;
  }
}

/**
 * One revolution centred on `simNowMs`, densified around it (trajectoryTimes), TEME km relative to `centreKm`
 * (the object's current position), packed xyz; undefined if propagation fails.
 */
export function orbitTrace(
  satrec: SatRec,
  simNowMs: number,
  periodMs: number,
  centreKm: Vec3 = [0, 0, 0],
): Float32Array | undefined {
  const times = trajectoryTimes(simNowMs - periodMs / 2, simNowMs + periodMs / 2, simNowMs, ORBIT_SAMPLES);
  const out = new Float32Array(times.length * 3);
  let written = 0;
  for (const t of times) {
    const s = propagateTeme(satrec, new Date(t));
    if (!s) continue;
    out[written * 3] = s.posKm[0] - centreKm[0];
    out[written * 3 + 1] = s.posKm[1] - centreKm[1];
    out[written * 3 + 2] = s.posKm[2] - centreKm[2];
    written++;
  }
  return written > 1 ? out.subarray(0, written * 3) : undefined;
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
