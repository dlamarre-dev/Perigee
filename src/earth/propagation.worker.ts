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
  const vel = new Float32Array(n * 3);
  const ok = new Uint8Array(n);
  const date = new Date(msg.timeMs);
  for (let i = 0; i < n; i++) {
    const satrec = satrecs[i];
    if (!satrec) continue;
    const s = propagateTeme(satrec, date);
    if (!s) continue;
    pos.set(s.posKm, i * 3);
    vel.set(s.velKmS, i * 3);
    ok[i] = 1;
  }
  post({ type: 'sample', id: msg.id, timeMs: msg.timeMs, pos, vel, ok }, [pos.buffer, vel.buffer, ok.buffer]);
};
