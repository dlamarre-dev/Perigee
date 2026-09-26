/**
 * Pool of SGP4 workers (N = hardwareConcurrency − 1, clamped to [1, 4]). The catalogue is split into
 * contiguous slices; a propagation request fans out to every worker and resolves with full buffers.
 */
import type { Omm } from '../data/schemas';
import type { WorkerRequest, WorkerResponse } from './propagation.protocol';

export interface Sample {
  readonly timeMs: number;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly ok: Uint8Array;
}

export function defaultWorkerCount(hardwareConcurrency: number | undefined): number {
  return Math.min(4, Math.max(1, (hardwareConcurrency ?? 2) - 1));
}

interface Slice {
  readonly worker: Worker;
  readonly offset: number;
  readonly count: number;
}

export class PropagatorPool {
  readonly count: number;
  readonly ready: Promise<{ initFailed: number }>;
  private readonly slices: Slice[] = [];
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { sample: Sample; remaining: number; resolve: (s: Sample) => void }
  >();

  constructor(omms: readonly Omm[], workerCount = defaultWorkerCount(navigator.hardwareConcurrency)) {
    this.count = omms.length;
    const perWorker = Math.ceil(omms.length / workerCount);
    const readies: Promise<number>[] = [];
    for (let w = 0; w < workerCount; w++) {
      const offset = w * perWorker;
      const slice = omms.slice(offset, offset + perWorker);
      if (slice.length === 0) break;
      const worker = new Worker(new URL('./propagation.worker.ts', import.meta.url), {
        type: 'module',
        name: `sgp4-${w}`,
      });
      const entry: Slice = { worker, offset, count: slice.length };
      this.slices.push(entry);
      readies.push(
        new Promise<number>((resolve, reject) => {
          worker.onerror = (e) => reject(new Error(`SGP4 worker failed: ${e.message}`));
          worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
            if (e.data.type === 'ready') {
              worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(entry, ev.data);
              resolve(e.data.initFailed);
            }
          };
        }),
      );
      const init: WorkerRequest = { type: 'init', omms: slice };
      worker.postMessage(init);
    }
    this.ready = Promise.all(readies).then((fails) => ({ initFailed: fails.reduce((a, b) => a + b, 0) }));
  }

  /** Propagates the whole catalogue at `timeMs` (Unix ms, UTC). */
  propagate(timeMs: number): Promise<Sample> {
    const id = this.nextId++;
    const sample: Sample = {
      timeMs,
      pos: new Float32Array(this.count * 3),
      vel: new Float32Array(this.count * 3),
      ok: new Uint8Array(this.count),
    };
    return new Promise((resolve) => {
      this.pending.set(id, { sample, remaining: this.slices.length, resolve });
      const req: WorkerRequest = { type: 'propagate', id, timeMs };
      for (const s of this.slices) s.worker.postMessage(req);
    });
  }

  dispose(): void {
    for (const s of this.slices) s.worker.terminate();
    this.pending.clear();
  }

  private onMessage(slice: Slice, msg: WorkerResponse): void {
    if (msg.type !== 'sample') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    p.sample.pos.set(msg.pos, slice.offset * 3);
    p.sample.vel.set(msg.vel, slice.offset * 3);
    p.sample.ok.set(msg.ok, slice.offset);
    if (--p.remaining === 0) {
      this.pending.delete(msg.id);
      p.resolve(p.sample);
    }
  }
}
