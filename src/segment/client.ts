import { type SegmentMethod } from '../settings';
import { SUPERSEDED, type SegmentPhase, type SegmentRequest, type SegmentResponse } from './protocol';
import { type SoftMask } from './refine';

export interface SegmentProgress {
  phase: SegmentPhase;
  loaded?: number;
  total?: number;
}

export interface SegmentResult {
  mask: SoftMask;
  backend: string;
  ms: number;
}

interface Pending {
  resolve: (r: SegmentResult) => void;
  reject: (e: Error) => void;
  listeners: Set<(p: SegmentProgress) => void>;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
/** Requests in flight by caller key, so asking twice for the same thing waits for one run. */
const inflight = new Map<string, { promise: Promise<SegmentResult>; listeners: Set<(p: SegmentProgress) => void> }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<SegmentResponse>) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      // The worker runs one request at a time, and whoever waits behind it waits on the same download:
      // everyone hears the progress.
      const progress = { phase: msg.phase, loaded: msg.loaded, total: msg.total };
      pending.forEach((p) => p.listeners.forEach((l) => l(progress)));
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'result') {
      pending.delete(msg.id);
      p.resolve({ mask: { width: msg.width, height: msg.height, data: msg.mask }, backend: msg.backend, ms: msg.ms });
    } else {
      pending.delete(msg.id);
      p.reject(new Error(msg.message));
    }
  };
  w.onerror = (e) => {
    const err = new Error(e.message || 'The segmentation worker crashed.');
    pending.forEach((p) => p.reject(err));
    pending.clear();
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

/** The lane the classic site asks in: a new picture overtakes one still waiting. */
export const DEFAULT_LANE = 'default';

/** Whether a segment() failure only means a newer request in the same lane overtook it. */
export function isSuperseded(e: unknown): boolean {
  return e instanceof Error && e.message === SUPERSEDED;
}

/**
 * Separate subject from background. The image is copied to the worker, so
 * the caller keeps its pixels. Calls with the same `key` while one is running
 * share that run. A request still waiting when a newer one arrives in the
 * same `lane` fails (see isSuperseded); with lane null it always runs.
 */
export function segment(
  key: string,
  image: { rgba: Uint8ClampedArray; width: number; height: number },
  method: SegmentMethod,
  onProgress?: (p: SegmentProgress) => void,
  lane: string | null = DEFAULT_LANE,
): Promise<SegmentResult> {
  const running = inflight.get(key);
  if (running) {
    if (onProgress) running.listeners.add(onProgress);
    return running.promise;
  }
  const id = nextId++;
  const listeners = new Set<(p: SegmentProgress) => void>(onProgress ? [onProgress] : []);
  const req: SegmentRequest = { id, method, rgba: image.rgba, width: image.width, height: image.height, lane };
  const promise = new Promise<SegmentResult>((resolve, reject) => {
    pending.set(id, { resolve, reject, listeners });
    getWorker().postMessage(req);
  });
  inflight.set(key, { promise, listeners });
  const done = () => inflight.delete(key);
  promise.then(done, done);
  return promise;
}
