import { boxBlur, resizeBilinear } from '../../segment/refine';
import { type SegmentMethod } from '../../settings';
import {
  defaultSubject,
  type Layer,
  type LayerKind,
  type SubjectSettings,
  type Track,
  type TrackSample,
} from '../model';

/**
 * Subject masks as analysed (soft, one every 1/rate s of a clip) and the
 * pure maths around them: which masks show at a media time, the window a
 * tracked object is segmented in, how big masks can be, and turning a raw
 * mask into what the renderer draws (steadiness, threshold, softness,
 * grow / shrink, invert). No DOM here, so it is all unit-tested.
 */

export type Rect = [number, number, number, number];

/** One analysed mask: the subject's probability over a rectangle of the layer's picture. */
export interface RawMask {
  width: number;
  height: number;
  /** width × height bytes, top row first: the model's soft probability, 0–255. */
  data: Uint8Array;
  /** Where it sits in the picture's uv (x, y, width, height; y down). The whole frame is [0, 0, 1, 1]. */
  rect: Rect;
}

/** What a sequence was analysed for, so it can tell when it no longer fits the layer. */
export interface MaskMeta {
  /** The layer's media id, or 'sample' for the sample clip. */
  media: string;
  kind: LayerKind;
  method: SegmentMethod;
  area: SubjectSettings['area'];
  rate: number;
  /** trackSignature() of the track the windows followed ('' for the whole frame). */
  track: string;
  /** Media seconds analysed (0–0 for a picture). */
  from: number;
  to: number;
}

export interface MaskSequence {
  /** Media time of the first mask. */
  from: number;
  /** Masks per media second; 0 for a still (one mask). */
  fps: number;
  frames: RawMask[];
  meta: MaskMeta;
  /** Where the model ran ('wasm', 'webgpu', or 'js' for classic). */
  backend: string;
  /** How long the analysis took. */
  ms: number;
}

// ─── Time ────────────────────────────────────────────────────────────────────

/**
 * The two masks around media time mt and how far between them (clamped to
 * the first and last). A time right on a mask gives that mask alone (j = i).
 */
export function maskIndex(
  seq: { from: number; fps: number; frames: { length: number } },
  mt: number,
): { i: number; j: number; k: number } {
  const n = seq.frames.length;
  if (n <= 1 || seq.fps <= 0 || !Number.isFinite(mt)) return { i: 0, j: 0, k: 0 };
  const f = Math.max(0, Math.min(n - 1, (mt - seq.from) * seq.fps));
  let i = Math.floor(f);
  let k = f - i;
  // Float noise: a time on a mask shouldn't blend in its neighbour by a hair.
  if (k > 1 - 1e-6) {
    i = Math.min(n - 1, i + 1);
    k = 0;
  } else if (k < 1e-6) k = 0;
  return { i, j: k === 0 ? i : Math.min(n - 1, i + 1), k };
}

/**
 * Media seconds of the layer's clip that show on a canvas `canvasDuration`
 * long (what it plays, cut where the canvas ends); 0–0 for a still.
 */
export function analysisRange(layer: Layer, duration: number, canvasDuration = Infinity): { from: number; to: number } {
  if (layer.kind === 'image' || !(duration > 0)) return { from: 0, to: 0 };
  // Only the part of the layer on the canvas is ever previewed or exported.
  const shown = Math.max(0, Math.min(layer.length, canvasDuration - layer.start));
  const from = Math.max(0, Math.min(layer.in, duration));
  const to = Math.max(from, Math.min(duration, layer.in + shown * layer.speed));
  return { from, to };
}

/** Media times to analyse: every 1/rate s from `from` to `to`, kept just inside the clip. */
export function analysisTimes(from: number, to: number, rate: number, duration: number): number[] {
  const n = Math.max(1, Math.floor((to - from) * rate + 1e-6) + 1);
  return Array.from({ length: n }, (_, i) => Math.max(0, Math.min(duration - 1e-3, from + i / rate)));
}

// ─── Tracked windows ─────────────────────────────────────────────────────────

/** How much bigger than the tracked box the window it's segmented in is, and its limits. */
export const WINDOW_PAD = 1.6;
/** Smallest window side, as a fraction of the picture's shorter side. */
export const WINDOW_MIN = 0.15;
/** Longest window side over its shortest, in pixels (the models stretch their input to a square). */
export const WINDOW_MAX_ASPECT = 2;

/**
 * The window (in uv) a tracked object is segmented in: the box padded, never
 * tiny, not too elongated, and kept inside the picture (moved, not cut, so
 * the object stays in view).
 */
export function analysisWindow(box: Pick<TrackSample, 'cx' | 'cy' | 'w' | 'h'>, pw: number, ph: number): Rect {
  const minSide = WINDOW_MIN * Math.min(pw, ph);
  let w = Math.max(minSide, Math.max(0, box.w) * pw * WINDOW_PAD);
  let h = Math.max(minSide, Math.max(0, box.h) * ph * WINDOW_PAD);
  if (w > h * WINDOW_MAX_ASPECT) h = w / WINDOW_MAX_ASPECT;
  else if (h > w * WINDOW_MAX_ASPECT) w = h / WINDOW_MAX_ASPECT;
  w = Math.min(w, pw);
  h = Math.min(h, ph);
  const cx = (Number.isFinite(box.cx) ? box.cx : 0.5) * pw;
  const cy = (Number.isFinite(box.cy) ? box.cy : 0.5) * ph;
  const x = Math.max(0, Math.min(pw - w, cx - w / 2));
  const y = Math.max(0, Math.min(ph - h, cy - h / 2));
  return [x / pw, y / ph, w / pw, h / ph];
}

/** Share of a window's width / height over which its mask fades out towards an edge inside the picture. */
export const WINDOW_FADE = 0.08;

/**
 * Fade a window's mask to 0 towards the edges that lie inside the picture,
 * so the subject doesn't end in a hard line where the window does (edges on
 * the picture's own border are left alone). In place.
 */
export function fadeBorder(data: Uint8Array, w: number, h: number, rect: Rect, frac = WINDOW_FADE): void {
  const eps = 1e-3;
  const left = rect[0] > eps;
  const top = rect[1] > eps;
  const right = rect[0] + rect[2] < 1 - eps;
  const bottom = rect[1] + rect[3] < 1 - eps;
  if (!left && !top && !right && !bottom) return;
  const ramp = (d: number, band: number) => {
    const t = Math.max(0, Math.min(1, d / band));
    return t * t * (3 - 2 * t);
  };
  const bx = Math.max(1, frac * w);
  const by = Math.max(1, frac * h);
  const fx = new Float32Array(w);
  for (let x = 0; x < w; x++) fx[x] = (left ? ramp(x, bx) : 1) * (right ? ramp(w - 1 - x, bx) : 1);
  for (let y = 0; y < h; y++) {
    const fy = (top ? ramp(y, by) : 1) * (bottom ? ramp(h - 1 - y, by) : 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      data[i] = Math.round(data[i]! * fy * fx[x]!);
    }
  }
}

// ─── Size ────────────────────────────────────────────────────────────────────

/** All of a layer's masks together stay within this many bytes, as far as MASK_LONG_MIN allows. */
export const MASK_BUDGET = 96 * 2 ** 20;
export const MASK_LONG_FRAME = 512;
export const MASK_LONG_WINDOW = 384;
export const MASK_LONG_MIN = 160;

export interface MaskPlan {
  /** Long side of each mask, px. */
  long: number;
  /** Bytes all the masks take at that size (for windows, as if square: an upper bound). */
  bytes: number;
  /** False when even the smallest size overshoots the budget (a very long clip at a high rate). */
  fits: boolean;
}

/**
 * How big each of `count` masks can be: the long side as large as allowed
 * (and no larger than the picture), shrunk until they all fit the budget,
 * but never below MASK_LONG_MIN.
 */
export function maskPlan(count: number, pw: number, ph: number, windowed: boolean): MaskPlan {
  const n = Math.max(1, Math.round(count));
  const aspect = windowed ? 1 : Math.min(pw, ph) / Math.max(pw, ph, 1);
  const top = windowed ? MASK_LONG_WINDOW : Math.min(MASK_LONG_FRAME, Math.max(1, Math.round(Math.max(pw, ph))));
  const fit = Math.floor(Math.sqrt(MASK_BUDGET / (n * aspect)));
  const long = Math.max(Math.min(MASK_LONG_MIN, top), Math.min(top, fit));
  const bytes = n * long * Math.max(1, Math.round(long * aspect));
  return { long, bytes, fits: bytes <= MASK_BUDGET };
}

/** A w×h picture scaled so its long side is `long`. */
export function maskDims(long: number, w: number, h: number): [number, number] {
  const k = long / Math.max(w, h, 1e-6);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Resize a 0–1 mask to dw×dh bytes, box-filtering first when shrinking a lot (so thin parts don't alias away). */
export function maskBytes(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  let s = src;
  if (sw !== dw || sh !== dh) {
    const r = Math.floor(Math.min(sw / dw, sh / dh) / 2);
    if (r >= 1) s = boxBlur(s, sw, sh, r);
    s = resizeBilinear(s, sw, sh, dw, dh);
  }
  const out = new Uint8Array(dw * dh);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, s[i]!)) * 255);
  return out;
}

// ─── Finishing ───────────────────────────────────────────────────────────────

export type FinishSettings = Pick<SubjectSettings, 'threshold' | 'softness' | 'expand' | 'invert' | 'steady'>;

/** Weight of the mask itself against each neighbour when steadying. */
const STEADY_SELF = 0.6;
const STEADY_NEIGHBOUR = 0.2;

/** Whether two masks cover the same pixels (so one can be blended into the other as is). */
export function sameGeometry(a: RawMask, b: RawMask): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.data.length === b.data.length &&
    a.rect.every((v, i) => Math.abs(v - b.rect[i]!) < 1e-4)
  );
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * A raw mask made ready to draw, as bytes (255 = subject): blended with its
 * neighbours in time when steady (only those covering the same pixels), then
 * threshold and softness, grow / shrink (in % of the picture's longer side,
 * `picture` being its size in px) and invert. Like finalizeMask in
 * segment/refine.ts, which the classic site uses.
 */
export function finalizeFrame(
  frame: RawMask,
  neighbours: ReadonlyArray<RawMask | null | undefined>,
  s: FinishSettings,
  picture: [number, number],
): Uint8Array {
  const { width: w, height: h, data } = frame;
  const n = w * h;
  const m = new Float32Array(n);
  const near = s.steady ? neighbours.filter((b): b is RawMask => !!b && sameGeometry(frame, b)) : [];
  const half = Math.max(0.01, s.softness / 2);
  const lo = s.threshold - half;
  const hi = s.threshold + half;
  if (near.length) {
    const k = 1 / (255 * (STEADY_SELF + STEADY_NEIGHBOUR * near.length));
    for (let i = 0; i < n; i++) {
      let v = data[i]! * STEADY_SELF;
      for (const b of near) v += b.data[i]! * STEADY_NEIGHBOUR;
      m[i] = smoothstep(lo, hi, v * k);
    }
  } else {
    for (let i = 0; i < n; i++) m[i] = smoothstep(lo, hi, data[i]! / 255);
  }

  let out = m;
  if (Math.abs(s.expand) > 0.01) {
    // Blur, then re-threshold low (grow) or high (shrink): a cheap, smooth stand-in for dilate / erode.
    // The radius is a share of the picture, turned into this mask's pixels through its rectangle.
    const [pw, ph] = picture;
    const perPx = (w / Math.max(1e-6, frame.rect[2] * pw) + h / Math.max(1e-6, frame.rect[3] * ph)) / 2;
    const r = Math.max(1, Math.round((Math.abs(s.expand) / 100) * Math.max(pw, ph) * 0.75 * perPx));
    const b = boxBlur(boxBlur(m, w, h, r), w, h, r);
    const level = s.expand > 0 ? 0.12 : 0.88;
    out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = smoothstep(level - 0.1, level + 0.1, b[i]!);
  }

  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.round((s.invert ? 1 - out[i]! : out[i]!) * 255);
  return bytes;
}

/** A key for everything finalizeFrame depends on besides the masks. */
export function finishKey(s: FinishSettings, picture: [number, number]): string {
  return `${s.threshold}|${s.softness}|${s.expand}|${s.invert ? 1 : 0}|${s.steady ? 1 : 0}|${picture[0]}x${picture[1]}`;
}

// ─── Staleness ───────────────────────────────────────────────────────────────

/** Changes whenever a track's box or path does ('' with nothing tracked). */
export function trackSignature(track: Track | undefined): string {
  if (!track || track.data.length < 5) return '';
  // FNV-1a over the numbers, rounded as they're stored.
  let hash = 0x811c9dc5;
  const mix = (v: number) => {
    let x = Math.round(v * 1e4) | 0;
    for (let b = 0; b < 4; b++) {
      hash ^= x & 0xff;
      hash = Math.imul(hash, 0x01000193);
      x >>>= 8;
    }
  };
  [...track.box, track.at, track.from, track.fps].forEach(mix);
  track.data.forEach(mix);
  return `${Math.floor(track.data.length / 5)}:${(hash >>> 0).toString(36)}`;
}

/** What masks for the layer, analysed now with its current settings (on a canvas that long), would be for. */
export function wantedMeta(layer: Layer, duration: number, canvasDuration = Infinity): MaskMeta {
  const s = layer.subject ?? defaultSubject();
  return {
    media: layer.kind === 'sample' ? 'sample' : (layer.mediaId ?? ''),
    kind: layer.kind,
    method: s.method,
    area: s.area,
    rate: s.rate,
    track: s.area === 'tracked' ? trackSignature(layer.track) : '',
    ...analysisRange(layer, duration, canvasDuration),
  };
}

/**
 * How a sequence stands against what the layer wants now: for other media
 * altogether, analysed with other settings (or not covering the part of the
 * clip the layer now plays: trimming shorter is fine), or current.
 */
export function sequenceFit(have: MaskMeta, want: MaskMeta): 'other-media' | 'stale' | 'current' {
  if (have.media !== want.media || have.kind !== want.kind) return 'other-media';
  if (have.method !== want.method || have.area !== want.area || have.track !== want.track) return 'stale';
  if (want.kind === 'image') return 'current';
  const eps = 1e-3;
  if (have.rate !== want.rate || have.from > want.from + eps || have.to < want.to - eps) return 'stale';
  return 'current';
}

// ─── Storage ─────────────────────────────────────────────────────────────────

/** Version of the IndexedDB record a sequence is saved as. */
export const MASK_RECORD_VERSION = 2;

/** A sequence as it's saved: each mask's size and rectangle, and all their bytes in one Blob. */
export function toRecord(seq: MaskSequence): Record<string, unknown> {
  const { frames, ...rest } = seq;
  return {
    v: MASK_RECORD_VERSION,
    ...rest,
    frames: frames.map(({ width, height, rect }) => ({ width, height, rect })),
    // One Blob: IndexedDB keeps it without structured-cloning hundreds of arrays on the main thread.
    bytes: new Blob(frames.map((f) => f.data as Uint8Array<ArrayBuffer>)),
  };
}

/**
 * A saved record with its masks' bytes read back into its frames (the Blob
 * is read off the main thread), ready for parseSequence; null if they don't
 * add up.
 */
export async function readRecord(raw: unknown): Promise<unknown> {
  const r = raw as { bytes?: unknown; frames?: unknown } | null;
  if (!r || typeof r !== 'object' || !(r.bytes instanceof Blob) || !Array.isArray(r.frames)) return null;
  const all = new Uint8Array(await r.bytes.arrayBuffer());
  let at = 0;
  const frames = (r.frames as Array<{ width?: unknown; height?: unknown } | null>).map((f) => {
    const n = Number(f?.width) * Number(f?.height);
    const size = Number.isInteger(n) && n > 0 ? n : 0;
    const data = all.subarray(at, at + size);
    at += size;
    return { ...f, data };
  });
  return at === all.length ? { ...r, frames } : null;
}

const METHODS: readonly string[] = ['ai-fast', 'ai-hq', 'classic'] satisfies SegmentMethod[];
const KINDS: readonly string[] = ['image', 'video', 'sample', 'webcam'] satisfies LayerKind[];

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function rawMask(v: unknown): RawMask | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Partial<RawMask>;
  const { width: w, height: h, data, rect } = f;
  if (!num(w) || !num(h) || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return null;
  if (!(data instanceof Uint8Array) || data.length !== w * h) return null;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(num)) return null;
  return { width: w, height: h, data, rect: [rect[0]!, rect[1]!, rect[2]!, rect[3]!] };
}

/** A sequence read back from storage, or null if the record isn't one this version can use. */
export function parseSequence(raw: unknown): MaskSequence | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== MASK_RECORD_VERSION || !num(r.from) || !num(r.fps) || r.fps < 0 || !Array.isArray(r.frames)) return null;
  const m = r.meta as Partial<MaskMeta> | undefined;
  if (
    !m ||
    typeof m.media !== 'string' ||
    !KINDS.includes(m.kind as string) ||
    !METHODS.includes(m.method as string) ||
    (m.area !== 'frame' && m.area !== 'tracked') ||
    !num(m.rate) ||
    typeof m.track !== 'string' ||
    !num(m.from) ||
    !num(m.to)
  ) {
    return null;
  }
  const frames: RawMask[] = [];
  for (const f of r.frames) {
    const mask = rawMask(f);
    if (!mask) return null;
    frames.push(mask);
  }
  if (!frames.length) return null;
  return {
    from: r.from,
    fps: r.fps,
    frames,
    meta: {
      media: m.media,
      kind: m.kind!,
      method: m.method!,
      area: m.area,
      rate: m.rate,
      track: m.track,
      from: m.from,
      to: m.to,
    },
    backend: typeof r.backend === 'string' ? r.backend : '',
    ms: num(r.ms) ? r.ms : 0,
  };
}
