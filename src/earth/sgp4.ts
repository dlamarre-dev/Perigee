/**
 * Thin wrapper over satellite.js: OMM → satrec (json2satrec, never twoline2satrec) and TEME propagation.
 * Shared by the propagation workers and the main thread (selected object, orbit line).
 */
import { json2satrec, propagate, type OMMJsonObject, type SatRec } from 'satellite.js';
import type { Vec3 } from '../astro/vec3';
import type { Omm } from '../data/schemas';

export function toOmmJson(omm: Omm): OMMJsonObject {
  return {
    OBJECT_NAME: omm.OBJECT_NAME,
    OBJECT_ID: omm.OBJECT_ID,
    EPOCH: omm.EPOCH,
    MEAN_MOTION: omm.MEAN_MOTION,
    ECCENTRICITY: omm.ECCENTRICITY,
    INCLINATION: omm.INCLINATION,
    RA_OF_ASC_NODE: omm.RA_OF_ASC_NODE,
    ARG_OF_PERICENTER: omm.ARG_OF_PERICENTER,
    MEAN_ANOMALY: omm.MEAN_ANOMALY,
    NORAD_CAT_ID: omm.NORAD_CAT_ID,
    ELEMENT_SET_NO: omm.ELEMENT_SET_NO,
    BSTAR: omm.BSTAR,
    MEAN_MOTION_DOT: omm.MEAN_MOTION_DOT,
    MEAN_MOTION_DDOT: omm.MEAN_MOTION_DDOT,
    ...(omm.REV_AT_EPOCH === undefined ? {} : { REV_AT_EPOCH: omm.REV_AT_EPOCH }),
    ...(omm.CLASSIFICATION_TYPE === undefined ? {} : { CLASSIFICATION_TYPE: omm.CLASSIFICATION_TYPE }),
  };
}

/** Returns undefined when the elements cannot be initialised (bad eccentricity, etc.). */
export function makeSatrec(omm: Omm): SatRec | undefined {
  try {
    const satrec = json2satrec(toOmmJson(omm));
    return satrec.error === 0 ? satrec : undefined;
  } catch {
    return undefined;
  }
}

export interface TemeState {
  readonly posKm: Vec3;
  readonly velKmS: Vec3;
}

/** SGP4 state in TEME, or undefined on propagation error (decay, eccentricity out of range…). */
export function propagateTeme(satrec: SatRec, date: Date): TemeState | undefined {
  const pv = propagate(satrec, date);
  if (!pv || satrec.error !== 0) return undefined;
  const { position: p, velocity: v } = pv;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return undefined;
  return { posKm: [p.x, p.y, p.z], velKmS: [v.x, v.y, v.z] };
}
