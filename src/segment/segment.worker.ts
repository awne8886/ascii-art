/// <reference lib="webworker" />
/**
 * Subject segmentation off the main thread, so the ASCII keeps animating.
 *
 * In: the working-size RGBA image. Out: a soft subject mask at the same
 * size. AI methods run an ONNX model (onnxruntime-web, WebGPU when the
 * browser has it, WebAssembly otherwise) and refine its low-resolution
 * output with a colour-guided filter; `classic` needs no download at all.
 */
import type * as Ort from 'onnxruntime-web/webgpu';
import { classicSaliency } from './classic';
import { Lanes } from './lanes';
import { MODELS, modelUrl, type ModelId } from './models';
import { guidedFilter, resizeBilinear } from './refine';
import { SUPERSEDED, type SegmentMessage, type SegmentRequest, type SegmentResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const CACHE = 'ascii-art-models-v1';

let ortPromise: Promise<typeof Ort> | null = null;

interface ModelFile {
  bytes: ArrayBuffer;
  gpu: boolean;
}

/** A model file on its way, and the requests waiting on it. */
interface Download {
  file: Promise<ModelFile>;
  /** Ids of the requests waiting on it; the last one to give up (cancelled) stops the download. */
  waiting: Set<number>;
  ctrl: AbortController;
}

/** Model files downloading (or downloaded, until their session starts or nothing waits on them), per model. */
const files = new Map<ModelId, Download>();
/** Sessions started (or starting), per model. */
const sessions = new Map<ModelId, Promise<{ s: Ort.InferenceSession; backend: 'webgpu' | 'wasm' }>>();

function post(msg: SegmentResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

async function loadOrt(): Promise<typeof Ort> {
  ortPromise ??= import('onnxruntime-web/webgpu').then((ort) => {
    ort.env.logLevel = 'error';
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    return ort;
  });
  return ortPromise;
}

type Gpu = 'none' | 'fp32' | 'fp16';

async function webGpu(): Promise<Gpu> {
  try {
    const gpu = (
      navigator as Navigator & {
        gpu?: { requestAdapter(): Promise<{ features: { has(f: string): boolean } } | null> };
      }
    ).gpu;
    const adapter = await gpu?.requestAdapter();
    if (!adapter) return 'none';
    return adapter.features.has('shader-f16') ? 'fp16' : 'fp32';
  } catch {
    return 'none';
  }
}

/** Fetch a model with progress, from the Cache API when we've downloaded it before. */
async function fetchModel(
  url: string,
  mb: number,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE).catch(() => null);
  try {
    const hit = await cache?.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    // Unreadable cache entry: download again.
  }
  // Say it's downloading before the first byte (a slow server can take a while to answer).
  progress(0, mb * 1e6);
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Model download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || mb * 1e6;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const now = performance.now();
    if (now - lastPost > 100) {
      lastPost = now;
      progress(loaded, total);
    }
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.byteLength;
  }
  try {
    await cache?.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    // Quota or private mode: it just downloads again next time.
  }
  return buf.buffer;
}

/**
 * The model's file for this browser (fp16 or fp32 on the GPU, else WebAssembly), downloaded once for every
 * request that waits on it. A failed download fails those; the next request to arrive tries again.
 * Progress goes out under a request still waiting (the client passes it to every request for the model),
 * else under `id`, the one that asked.
 */
function download(model: ModelId, id: number): Download {
  const had = files.get(model);
  if (had) return had;
  const ctrl = new AbortController();
  const waiting = new Set<number>();
  const file = (async () => {
    const spec = MODELS[model];
    const support = spec.webgpu ? await webGpu() : 'none';
    const variant =
      support === 'fp16' ? spec.webgpu : support === 'fp32' ? (spec.webgpuFp32 ?? spec.webgpu) : spec.wasm;
    if (!variant) {
      throw new Error(`${spec.label} needs WebGPU, which this browser or its graphics card doesn’t offer.`);
    }
    const bytes = await fetchModel(modelUrl(spec, variant.file), variant.mb, ctrl.signal, (loaded, total) => {
      const [to = id] = waiting;
      post({ type: 'progress', id: to, phase: 'download', loaded, total });
    });
    return { bytes, gpu: variant !== spec.wasm };
  })();
  const dl: Download = { file, waiting, ctrl };
  files.set(model, dl);
  file.catch(() => release(model, dl));
  return dl;
}

/** Let go of a model file's bytes (a later request downloads it again, from the cache, if it must). */
function release(model: ModelId, dl: Download): void {
  if (files.get(model) === dl) files.delete(model);
}

/** The model's session, started from `dl` (the file the request waited for) the first time. */
async function session(
  model: ModelId,
  id: number,
  dl: Download | null,
): Promise<{ s: Ort.InferenceSession; backend: 'webgpu' | 'wasm' }> {
  let p = sessions.get(model);
  if (!p) {
    const from = dl ?? download(model, id);
    const q = (async () => {
      const { bytes, gpu } = await from.file;
      post({ type: 'progress', id, phase: 'init' });
      const ort = await loadOrt();
      const s = await ort.InferenceSession.create(new Uint8Array(bytes), {
        executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'],
        graphOptimizationLevel: 'all',
      });
      return { s, backend: gpu ? ('webgpu' as const) : ('wasm' as const) };
    })();
    sessions.set(model, q);
    // Started or not, the file's bytes aren't needed any more; a session that failed to start is tried again
    // by the next request.
    q.then(
      () => release(model, from),
      () => {
        release(model, from);
        if (sessions.get(model) === q) sessions.delete(model);
      },
    );
    p = q;
  }
  return p;
}

/** Bilinear resize to size×size (stretching, as both models were trained) and ImageNet normalisation, planar. */
function preprocess(rgba: Uint8ClampedArray, w: number, h: number, size: number): Float32Array {
  const plane = size * size;
  const out = new Float32Array(plane * 3);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) ch[i] = rgba[i * 4 + c]! / 255;
    const r = resizeBilinear(ch, w, h, size, size);
    for (let i = 0; i < plane; i++) out[c * plane + i] = (r[i]! - MEAN[c]!) / STD[c]!;
  }
  return out;
}

async function runModel(
  model: ModelId,
  req: SegmentRequest,
  dl: Download | null,
): Promise<{ mask: Float32Array; backend: string }> {
  const ort = await loadOrt();
  const spec = MODELS[model];
  const { s, backend } = await session(model, req.id, dl);
  post({ type: 'progress', id: req.id, phase: 'infer' });

  const input = preprocess(req.rgba, req.width, req.height, spec.size);
  // Both models take and return float32, even the fp16 variant.
  const results = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, spec.size, spec.size]) });
  const out = results[s.outputNames[0]!]!;
  const plane = spec.size * spec.size;
  const vals = Float32Array.from((out.data as Float32Array).subarray(0, plane));
  for (const t of Object.values(results)) t.dispose?.();

  if (spec.output === 'sigmoid') {
    for (let i = 0; i < plane; i++) vals[i] = 1 / (1 + Math.exp(-vals[i]!));
  } else {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of vals) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const k = hi - lo > 1e-6 ? 1 / (hi - lo) : 0;
    for (let i = 0; i < plane; i++) vals[i] = (vals[i]! - lo) * k;
  }
  return { mask: resizeBilinear(vals, spec.size, spec.size, req.width, req.height), backend };
}

async function handle(req: SegmentRequest, dl: Download | null = null): Promise<void> {
  const started = performance.now();
  try {
    let coarse: Float32Array;
    let backend = 'js';
    if (req.method === 'classic') {
      coarse = classicSaliency(req.rgba, req.width, req.height);
    } else {
      ({ mask: coarse, backend } = await runModel(req.method, req, dl));
    }
    post({ type: 'progress', id: req.id, phase: 'refine' });
    const r = Math.max(2, Math.round(Math.max(req.width, req.height) / 128));
    const mask = guidedFilter(req.rgba, coarse, req.width, req.height, r, 2e-3);
    post(
      {
        type: 'result',
        id: req.id,
        width: req.width,
        height: req.height,
        mask,
        backend,
        ms: Math.round(performance.now() - started),
      },
      [mask.buffer],
    );
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
}

// Model requests one at a time: onnxruntime can't run two inferences on a session at once. Within a lane
// only the newest request matters, so older ones still waiting in the queue are dropped; requests without
// a lane (a clip analysed frame by frame) all run, in order, unless their caller cancels them.
let queue = Promise.resolve();
const lanes = new Lanes();
/** Model requests not run yet (waiting on their download, or queued), and those of them cancelled. */
const waitingIds = new Set<number>();
const cancelled = new Set<number>();

/**
 * Requests given up on: they won't run, and a download only they waited on stops (the next request for
 * that model starts afresh, from the cache if it got that far).
 */
function cancel(ids: number[]): void {
  for (const id of ids) {
    if (!waitingIds.has(id)) continue;
    cancelled.add(id);
    for (const [model, dl] of files) {
      if (!dl.waiting.delete(id) || dl.waiting.size) continue;
      release(model, dl);
      dl.ctrl.abort();
    }
  }
}

self.onmessage = (e: MessageEvent<SegmentMessage>) => {
  const msg = e.data;
  if ('ids' in msg) {
    cancel(msg.ids);
    return;
  }
  const req = msg;
  lanes.arrive(req.lane, req.id);
  // Classic needs no model: it never waits behind a download, a session start or an inference
  // (its path in handle() is synchronous, so it runs to completion right here).
  if (req.method === 'classic') {
    void handle(req);
    return;
  }
  // A request queues once its model is downloaded, so one for another model (or Classic) never waits
  // behind a download it doesn't need; requests for the same model wait on the same one, in order.
  const model = req.method;
  const dl = sessions.has(model) ? null : download(model, req.id);
  dl?.waiting.add(req.id);
  waitingIds.add(req.id);
  const enqueue = () => {
    queue = queue
      .then(() => {
        waitingIds.delete(req.id);
        // Cancelled: its caller has already moved on (no answer).
        if (cancelled.delete(req.id)) return;
        return lanes.superseded(req.lane, req.id)
          ? post({ type: 'error', id: req.id, message: SUPERSEDED })
          : handle(req, dl);
      })
      .finally(() => {
        // The last request waiting on a file that never started a session (all overtaken) lets it go.
        if (dl && dl.waiting.delete(req.id) && !dl.waiting.size) release(model, dl);
      });
  };
  if (dl) void dl.file.then(enqueue, enqueue);
  else enqueue();
};
