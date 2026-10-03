import type { Omm } from '../data/schemas';

/** Main → worker. */
export type WorkerRequest =
  | { readonly type: 'init'; readonly omms: readonly Omm[] }
  | { readonly type: 'propagate'; readonly id: number; readonly timeMs: number };

/** Worker → main. Buffers are transferred, not copied. */
export type WorkerResponse =
  | { readonly type: 'ready'; readonly initFailed: number }
  | {
      readonly type: 'sample';
      readonly id: number;
      readonly timeMs: number;
      /** TEME positions, km, xyz packed (Float32 rounding of the Float64 value). */
      readonly pos: Float32Array;
      /** Remainder x − fround(x): with `pos`, the position to ~1 mm for camera-relative rendering. */
      readonly posLow: Float32Array;
      /** TEME velocities, km/s, xyz packed. */
      readonly vel: Float32Array;
      /** 1 = valid state, 0 = SGP4 error (hidden and counted as invalid). */
      readonly ok: Uint8Array;
    };
