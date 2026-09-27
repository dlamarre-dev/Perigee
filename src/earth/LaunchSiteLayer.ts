/**
 * Orbital launch sites on the Earth: markers in the Earth-fixed frame (child of the Earth mesh), CPU
 * occlusion by the globe (screen-sized sprites would otherwise sink into the curved surface), labels when
 * the camera is close, and screen-space picking.
 */
import { Group, Vector3, type PerspectiveCamera } from 'three';
import { DEG_TO_RAD, EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { latLonToUnit } from '../astro/frames';
import { quatRotate, type Quat } from '../astro/quat';
import { length, scale, sub, type Vec3 } from '../astro/vec3';
import type { LaunchSite } from '../data/schemas';
import type { Lang } from '../i18n';
import { LabelLayer, occludedBySphere } from '../render/Labels';
import { MarkerPoints } from '../render/MarkerPoints';
import { SelectionMarker } from '../render/OrbitLine';

const R = EARTH_EQUATORIAL_RADIUS_KM;
const ACTIVE_COLOR = '#ffb020';
const INACTIVE_COLOR = '#8a8f98';
const LABEL_DISTANCE_KM = 12_000;
const PICK_RADIUS_PX = 12;

export class LaunchSiteLayer {
  readonly group = new Group();
  readonly labels = new LabelLayer();
  private readonly markers: MarkerPoints;
  private readonly ring: SelectionMarker;
  /** Earth-fixed positions (km), on the rendering sphere (flattening ignored like the Earth mesh). */
  private readonly bodyKm: Vec3[];
  private sceneKm: Vec3[] = [];
  private originKm: Vec3 = [0, 0, 0];
  private selectedId: string | undefined;
  private visibleValue = true;
  private readonly v = new Vector3();

  constructor(
    readonly sites: readonly LaunchSite[],
    pixelRatio: number,
  ) {
    this.bodyKm = sites.map((s) => scale(latLonToUnit(s.latDeg * DEG_TO_RAD, s.lonDeg * DEG_TO_RAD), R + 2));
    this.markers = new MarkerPoints(Math.max(1, sites.length), 9 * pixelRatio, { depthTest: false });
    sites.forEach((s, i) => this.markers.setColor(i, s.active ? ACTIVE_COLOR : INACTIVE_COLOR));
    this.ring = new SelectionMarker(pixelRatio);
    this.group.add(this.markers.points, this.ring.points);
    this.group.name = 'launch-sites';
  }

  get visible(): boolean {
    return this.visibleValue;
  }

  set visible(v: boolean) {
    this.visibleValue = v;
    this.group.visible = v;
    this.labels.element.hidden = !v;
  }

  setLanguage(lang: Lang): void {
    this.labels.setItems(
      this.sites.map((s) => ({ id: s.id, text: s.name[lang], className: 'label-launch' })),
    );
  }

  select(id: string | undefined): void {
    this.selectedId = id;
    const i = this.sites.findIndex((s) => s.id === id);
    this.ring.set(i >= 0 ? this.bodyKm[i] : undefined);
  }

  /** `sceneFromBody`: Earth-fixed → scene rotation for this frame. */
  update(sceneFromBody: Quat): void {
    this.sceneKm = this.bodyKm.map((p) => quatRotate(sceneFromBody, p));
  }

  scenePosition(id: string): Vec3 | undefined {
    return this.sceneKm[this.sites.findIndex((s) => s.id === id)];
  }

  placeOrigin(originKm: Vec3, camera: PerspectiveCamera, widthCss: number, heightCss: number): void {
    this.originKm = originKm;
    this.sites.forEach((site, i) => {
      const scene = this.sceneKm[i];
      const body = this.bodyKm[i];
      const shown = this.visibleValue && scene && body && !occludedBySphere(originKm, scene, R);
      if (shown) this.markers.setPosition(i, body[0], body[1], body[2]);
      else this.markers.hide(i);
      const near = scene && length(sub(scene, originKm)) < LABEL_DISTANCE_KM;
      const label = shown && (near || site.id === this.selectedId);
      this.labels.place(
        site.id,
        label ? sub(scene, originKm) : undefined,
        label ? scene : undefined,
        camera,
        originKm,
        R,
        widthCss,
        heightCss,
      );
    });
    this.markers.commit();
  }

  /** Nearest visible site within a few pixels of the pointer, with its distance in pixels. */
  pick(
    xCss: number,
    yCss: number,
    camera: PerspectiveCamera,
    widthCss: number,
    heightCss: number,
  ): { site: LaunchSite; distancePx: number } | undefined {
    if (!this.visibleValue) return undefined;
    let best: { site: LaunchSite; distancePx: number } | undefined;
    this.sites.forEach((site, i) => {
      const scene = this.sceneKm[i];
      if (!scene || occludedBySphere(this.originKm, scene, R)) return;
      const r = sub(scene, this.originKm);
      this.v.set(r[0], r[1], r[2]).project(camera);
      if (this.v.z > 1) return;
      const x = ((this.v.x + 1) / 2) * widthCss;
      const y = ((1 - this.v.y) / 2) * heightCss;
      const d = Math.hypot(x - xCss, y - yCss);
      if (d <= PICK_RADIUS_PX && (!best || d < best.distancePx)) best = { site, distancePx: d };
    });
    return best;
  }

  dispose(): void {
    this.markers.dispose();
    this.labels.dispose();
  }
}
