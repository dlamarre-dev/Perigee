/**
 * Landing and impact sites on a body of the solar view (Venus, Titan): screen-sized markers on its surface, a
 * selection ring, CPU occlusion by the body itself, and their scene positions for picking and labels. The markers
 * live in the body mesh (body-fixed frame, km), so they turn with it.
 */
import { Group } from 'three';
import { latLonToUnit } from '../astro/frames';
import { quatRotate, type Quat } from '../astro/quat';
import { add, normalize, sub, type Vec3 } from '../astro/vec3';
import type { LandingSite, LandingSites } from '../data/schemas';
import type { BodyMesh } from '../render/BodyMesh';
import { occludedBySphereAt } from '../render/Labels';
import { MarkerPoints } from '../render/MarkerPoints';
import { SelectionMarker } from '../render/OrbitLine';
import { SITE_COLORS } from '../render/siteColors';

const DEG_TO_RAD = Math.PI / 180;
/** Markers float 1 m above the drawn surface (not depth-tested: occlusion is on the CPU). */
const MARKER_LIFT_KM = 0.001;

export class SurfaceSites {
  readonly sites: readonly LandingSite[];
  readonly verified: string;
  private readonly markers: MarkerPoints;
  private readonly ring = new SelectionMarker({ surface: true });
  private readonly group = new Group();
  /** Body-frame marker positions (km). */
  private readonly bodyKm: readonly Vec3[];
  /** Scene positions (km, true scale), from the last `update`. */
  private sceneKm: readonly Vec3[] = [];

  constructor(
    readonly bodyId: string,
    file: LandingSites,
    private readonly mesh: BodyMesh,
    private readonly radiusKm: number,
  ) {
    this.sites = file.sites;
    this.verified = file.verified;
    this.markers = new MarkerPoints(Math.max(1, this.sites.length), 8, { depthTest: false });
    this.sites.forEach((s, i) => this.markers.setColor(i, SITE_COLORS[s.type]));
    this.bodyKm = this.sites.map((s) => {
      const up = latLonToUnit(s.latDeg * DEG_TO_RAD, s.lonDeg * DEG_TO_RAD);
      const r = mesh.surfaceDistanceKm(up) + MARKER_LIFT_KM;
      return [up[0] * r, up[1] * r, up[2] * r];
    });
    this.group.add(this.markers.points, this.ring.points);
    this.group.visible = false;
    mesh.mesh.add(this.group);
  }

  /** Scene positions for a body at `bodyScene` turned by `orientation` (scene ← body frame). */
  update(bodyScene: Vec3, orientation: Quat): void {
    this.sceneKm = this.bodyKm.map((p) => add(bodyScene, quatRotate(orientation, p)));
  }

  /** Scene direction from the body centre to a site (unit), once positioned. */
  directionOf(site: LandingSite, bodyScene: Vec3): Vec3 | undefined {
    const p = this.sceneKm[this.sites.indexOf(site)];
    return p && normalize(sub(p, bodyScene));
  }

  /** Scene position of a site, or undefined when its marker is not drawn or the body hides it. */
  sceneOf(site: LandingSite, cameraKm: Vec3, bodyScene: Vec3): Vec3 | undefined {
    const i = this.sites.indexOf(site);
    const p = this.sceneKm[i];
    if (!this.group.visible || !p || occludedBySphereAt(cameraKm, p, bodyScene, this.radiusKm))
      return undefined;
    return p;
  }

  /**
   * Draws the markers (all of them when `all`, else only the selected one), hiding those on the far side as seen
   * from the camera; `shown` false hides everything (body not drawn, log scale).
   */
  place(
    shown: boolean,
    all: boolean,
    selected: LandingSite | undefined,
    cameraKm: Vec3,
    bodyScene: Vec3,
  ): void {
    this.group.visible = shown && (all || selected !== undefined);
    if (!this.group.visible) return;
    this.sites.forEach((site, i) => {
      const p = this.sceneKm[i];
      const b = this.bodyKm[i];
      const front = p && b && !occludedBySphereAt(cameraKm, p, bodyScene, this.radiusKm);
      if (front && (all || site === selected)) this.markers.setPosition(i, b[0], b[1], b[2]);
      else this.markers.hide(i);
      if (site === selected) this.ring.setOccluded(!front);
    });
    this.markers.commit();
    this.ring.set(selected ? this.bodyKm[this.sites.indexOf(selected)] : undefined);
  }

  /** Whether `site`'s marker is drawn (for labels and picking). */
  drawn(site: LandingSite, all: boolean, selected: LandingSite | undefined): boolean {
    return this.group.visible && (all || site === selected);
  }

  dispose(): void {
    this.mesh.mesh.remove(this.group);
    this.markers.points.geometry.dispose();
    this.markers.points.material.dispose();
  }
}
