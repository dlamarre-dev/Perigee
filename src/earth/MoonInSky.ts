/**
 * The Moon seen from the Earth view: textured BodyMesh at its true geocentric position (astronomy-engine,
 * rotated from J2000 to the equator of date so it matches the TEME satellites to ~35 km), IAU orientation,
 * lit by the Sun, with a label hidden behind the Earth. Its pick-pass occluder (BodyMesh) keeps satellites
 * behind it from being picked.
 */
import type { PerspectiveCamera, Scene } from 'three';
import { Astronomy } from '../astro/astronomy';
import { bodyOrientationEqj, geoMoonKm, MOON_RADIUS_KM } from '../astro/bodies';
import { quatFromBasis, quatMultiply, quatRotate, type Quat } from '../astro/quat';
import { length, sub, type Vec3 } from '../astro/vec3';
import { BodyMesh } from '../render/BodyMesh';
import { LabelLayer, LabelPriority } from '../render/Labels';
import type { Renderer } from '../render/Renderer';
import { placeholderTexture, progressiveTexture } from '../render/textures';

/** EQD (true equator and equinox of date) ← EQJ. */
export function eqdFromEqj(date: Date): Quat {
  const rot = Astronomy.Rotation_EQJ_EQD(date);
  const axis = (x: number, y: number, z: number): Vec3 => {
    const v = Astronomy.RotateVector(rot, new Astronomy.Vector(x, y, z, new Astronomy.AstroTime(date)));
    return [v.x, v.y, v.z];
  };
  return quatFromBasis(axis(1, 0, 0), axis(0, 1, 0), axis(0, 0, 1));
}

export class MoonInSky {
  readonly mesh: BodyMesh;
  readonly labels = new LabelLayer();
  /** Moon centre in the scene frame (km). */
  sceneKm: Vec3 = [384_400, 0, 0];

  constructor(
    private readonly scene: Scene,
    renderer: Renderer,
    baseUrl: string,
    label: string,
  ) {
    const texture = progressiveTexture({
      baseUrl,
      body: 'moon',
      name: 'color',
      maxTextureSize: renderer.maxTextureSize,
      anisotropy: renderer.renderer.capabilities.getMaxAnisotropy(),
      placeholderRgb: [110, 110, 110],
      onUpdate: (tex) => this.mesh.setDayMap(tex),
    });
    this.mesh = new BodyMesh({
      name: 'moon',
      radiusKm: MOON_RADIUS_KM,
      dayMap: texture.initial,
      nightMap: placeholderTexture([0, 0, 0]),
      ambient: 0.015,
    });
    this.mesh.onDetailRequest(() => texture.requestDetail());
    scene.add(this.mesh.mesh);
    this.setLabel(label);
  }

  setLabel(text: string): void {
    this.labels.setItems([{ id: 'moon', text, className: 'label-natural' }]);
  }

  /** `sceneFromInertial`: the view's TEME → scene rotation; `sunScene`: unit Sun direction in the scene. */
  update(date: Date, sceneFromInertial: Quat, sunScene: Vec3): void {
    const toDate = eqdFromEqj(date);
    this.sceneKm = quatRotate(sceneFromInertial, quatRotate(toDate, geoMoonKm(date)));
    const orientation = quatMultiply(toDate, bodyOrientationEqj(Astronomy.Body.Moon, date));
    this.mesh.setOrientation(quatMultiply(sceneFromInertial, orientation));
    this.mesh.setSunDirection(sunScene);
  }

  place(
    originKm: Vec3,
    camera: PerspectiveCamera,
    earthRadiusKm: number,
    widthCss: number,
    heightCss: number,
  ): void {
    const r = sub(this.sceneKm, originKm);
    this.mesh.mesh.position.set(r[0], r[1], r[2]);
    if (length(r) < 3 * MOON_RADIUS_KM) this.mesh.requestDetail();
    this.labels.begin();
    this.labels.place(
      'moon',
      r,
      this.sceneKm,
      camera,
      originKm,
      earthRadiusKm,
      widthCss,
      heightCss,
      LabelPriority.Orbiting,
    );
    this.labels.layout(widthCss, heightCss);
  }

  /** Distance from the camera to the Moon's surface (km), for the near clipping plane. */
  surfaceDistanceKm(originKm: Vec3): number {
    return length(sub(this.sceneKm, originKm)) - MOON_RADIUS_KM;
  }

  dispose(): void {
    this.scene.remove(this.mesh.mesh);
    this.mesh.dispose();
    this.labels.dispose();
  }
}
