/// <reference lib="webworker" />
/** SGP4 propagation worker: owns the satrecs of one contiguous slice of the catalogue. */
import type { SatRec } from 'satellite.js';
import type { WorkerRequest, WorkerResponse } from './propagation.protocol';
import { makeSatrec, propagateTeme } from './sgp4';

declare const self: DedicatedWorkerGlobalScope;

let satrecs: (SatRec | undefined)[] = [];

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    satrecs = msg.omms.map(makeSatrec);
    post({ type: 'ready', initFailed: satrecs.filter((s) => s === undefined).length });
    return;
  }

  const n = satrecs.length;
  const pos = new Float32Array(n * 3);
  const posLow = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const ok = new Uint8Array(n);
  const date = new Date(msg.timeMs);
  for (let i = 0; i < n; i++) {
    const satrec = satrecs[i];
    if (!satrec) continue;
    const s = propagateTeme(satrec, date);
    if (!s) continue;
    for (let k = 0; k < 3; k++) {
      const x = s.posKm[k] ?? 0;
      const high = Math.fround(x);
      pos[i * 3 + k] = high;
      posLow[i * 3 + k] = x - high;
    }
    vel.set(s.velKmS, i * 3);
    ok[i] = 1;
  }
  post({ type: 'sample', id: msg.id, timeMs: msg.timeMs, pos, posLow, vel, ok }, [
    pos.buffer,
    posLow.buffer,
    vel.buffer,
    ok.buffer,
  ]);
};
