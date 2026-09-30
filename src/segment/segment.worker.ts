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
import { MODELS, modelUrl, type ModelId } from './models';
import { guidedFilter, resizeBilinear } from './refine';
import type { SegmentRequest, SegmentResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const CACHE = 'ascii-art-models-v1';

let ortPromise: Promise<typeof Ort> | null = null;
const sessions = new Map<string, Promise<Ort.InferenceSession>>();

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
async function fetchModel(url: string, id: number, mb: number): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE).catch(() => null);
  try {
    const hit = await cache?.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    // Unreadable cache entry: download again.
  }
  const res = await fetch(url);
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
      post({ type: 'progress', id, phase: 'download', loaded, total });
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

async function session(model: ModelId, id: number): Promise<{ s: Ort.InferenceSession; backend: 'webgpu' | 'wasm' }> {
  const ort = await loadOrt();
  const spec = MODELS[model];
  const support = spec.webgpu ? await webGpu() : 'none';
  const variant = support === 'fp16' ? spec.webgpu : support === 'fp32' ? (spec.webgpuFp32 ?? spec.webgpu) : spec.wasm;
  if (!variant) {
    throw new Error(
      'The high-quality model needs WebGPU (a recent Chrome, Edge or Safari), which isn’t available here.',
    );
  }
  const gpu = variant !== spec.wasm;
  const key = `${model}:${variant.file}`;
  let p = sessions.get(key);
  if (!p) {
    p = (async () => {
      const bytes = await fetchModel(modelUrl(spec, variant.file), id, variant.mb);
      post({ type: 'progress', id, phase: 'init' });
      return ort.InferenceSession.create(new Uint8Array(bytes), {
        executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'],
        graphOptimizationLevel: 'all',
      });
    })();
    sessions.set(key, p);
    p.catch(() => sessions.delete(key));
  }
  return { s: await p, backend: gpu ? 'webgpu' : 'wasm' };
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

async function runModel(model: ModelId, req: SegmentRequest): Promise<{ mask: Float32Array; backend: string }> {
  const ort = await loadOrt();
  const spec = MODELS[model];
  const { s, backend } = await session(model, req.id);
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

async function handle(req: SegmentRequest): Promise<void> {
  const started = performance.now();
  try {
    let coarse: Float32Array;
    let backend = 'js';
    if (req.method === 'classic') {
      coarse = classicSaliency(req.rgba, req.width, req.height);
    } else {
      ({ mask: coarse, backend } = await runModel(req.method, req));
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

// One request at a time: onnxruntime can't run two inferences on a session at once. Only the newest
// request matters to the page, so older ones still waiting in the queue are dropped.
let queue = Promise.resolve();
let newest = 0;
self.onmessage = (e: MessageEvent<SegmentRequest>) => {
  const req = e.data;
  newest = Math.max(newest, req.id);
  queue = queue.then(() =>
    req.id < newest ? post({ type: 'error', id: req.id, message: 'Superseded by a newer request.' }) : handle(req),
  );
};
