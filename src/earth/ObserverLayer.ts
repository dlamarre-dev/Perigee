/**
 * The visitor's place on the Earth, sent by an embedding page (embed API `set { observer }`, the landing pages): one
 * marker in the Earth-fixed frame (child of the Earth mesh) with its label, hidden behind the globe like the launch
 * sites (CPU occlusion). Not selectable, never written to the URL.
 */
import { Group, type PerspectiveCamera } from 'three';
import { DEG_TO_RAD, EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { latLonToUnit } from '../astro/frames';
import { quatRotate, type Quat } from '../astro/quat';
import { scale, sub, type Vec3 } from '../astro/vec3';
import type { ObserverPlace } from '../app/embedApi';
import { LabelLayer, LabelPriority, occludedBySphere } from '../render/Labels';
import { MarkerPoints } from '../render/MarkerPoints';

const R = EARTH_EQUATORIAL_RADIUS_KM;
const COLOR = '#7dff9a';
const ID = 'observer';

export class ObserverLayer {
  readonly group = new Group();
  readonly labels = new LabelLayer();
  private readonly marker = new MarkerPoints(1, 11, { depthTest: false });
  private bodyKm: Vec3 | undefined;
  private sceneKm: Vec3 | undefined;

  constructor(label: string) {
    this.marker.setColor(0, COLOR);
    this.marker.hide(0);
    this.marker.commit();
    this.group.add(this.marker.points);
    this.group.name = 'observer';
    this.setLabel(label);
  }

  setLabel(text: string): void {
    this.labels.setItems([{ id: ID, text, className: 'label-observer' }]);
  }

  set(place: ObserverPlace | undefined): void {
    this.bodyKm = place
      ? scale(latLonToUnit(place.latDeg * DEG_TO_RAD, place.lonDeg * DEG_TO_RAD), R + 2)
      : undefined;
  }

  /** `sceneFromBody`: Earth-fixed → scene rotation for this frame. */
  update(sceneFromBody: Quat): void {
    this.sceneKm = this.bodyKm && quatRotate(sceneFromBody, this.bodyKm);
  }

  placeOrigin(originKm: Vec3, camera: PerspectiveCamera, widthCss: number, heightCss: number): void {
    const body = this.bodyKm;
    const scene = this.sceneKm;
    const shown = body !== undefined && scene !== undefined && !occludedBySphere(originKm, scene, R);
    if (shown) this.marker.setPosition(0, body[0], body[1], body[2]);
    else this.marker.hide(0);
    this.marker.commit();
    this.labels.begin();
    this.labels.place(
      ID,
      shown ? sub(scene, originKm) : undefined,
      shown ? scene : undefined,
      camera,
      originKm,
      R,
      widthCss,
      heightCss,
      LabelPriority.Selected,
    );
    this.labels.layout(widthCss, heightCss);
  }

  dispose(): void {
    this.marker.dispose();
    this.labels.dispose();
  }
}
