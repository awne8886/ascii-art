import { type MediaStore } from '../media';
import { type Layer, type Track } from '../model';
import { drawSampleFrame, SAMPLE_DURATION } from '../sources';
import { NccTracker, toGray, type Gray } from './tracker';

/** Frames are analysed at most this big (long side): plenty for following an object, and fast. */
const WORK = 360;
const FPS = 30;

type Frames = {
  width: number;
  height: number;
  duration: number;
  /** Grayscale frames at the given media times, in order. */
  frames: (times: number[]) => AsyncGenerator<Gray | null>;
  close: () => void;
};

function workSize(w: number, h: number): [number, number] {
  const k = Math.min(1, WORK / Math.max(w, h));
  return [Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))];
}

function grayOf(source: CanvasImageSource, ctx: CanvasRenderingContext2D, w: number, h: number): Gray {
  ctx.drawImage(source, 0, 0, w, h);
  return toGray(ctx.getImageData(0, 0, w, h).data, w, h);
}

async function framesOf(layer: Layer, media: MediaStore): Promise<Frames> {
  const scratch = document.createElement('canvas');
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;

  if (layer.kind === 'sample') {
    const [w, h] = workSize(1280, 720);
    scratch.width = w;
    scratch.height = h;
    const frame = document.createElement('canvas');
    return {
      width: w,
      height: h,
      duration: SAMPLE_DURATION,
      async *frames(times) {
        for (const t of times) {
          drawSampleFrame(frame, t);
          yield grayOf(frame, ctx, w, h);
        }
      },
      close: () => {},
    };
  }

  const m = media.get(layer.mediaId);
  if (!m?.blob || layer.kind !== 'video') throw new Error('Only videos (and the sample clip) can be tracked.');
  const [w, h] = workSize(m.width, m.height);
  scratch.width = w;
  scratch.height = h;

  if (typeof VideoDecoder !== 'undefined') {
    try {
      const mb = await import('mediabunny');
      const input = new mb.Input({ source: new mb.BlobSource(m.blob), formats: mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const first = await track.getFirstTimestamp();
        const sink = new mb.CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
        return {
          width: w,
          height: h,
          duration: m.duration,
          async *frames(times) {
            let last: Gray | null = null;
            for await (const c of sink.canvasesAtTimestamps(times.map((t) => first + t))) {
              if (c) last = grayOf(c.canvas, ctx, w, h);
              yield last;
            }
          },
          close: () => input.dispose(),
        };
      }
      input.dispose();
    } catch (e) {
      console.warn('[pro] tracking: WebCodecs decode unavailable, seeking instead:', e);
    }
  }

  // Seek a private copy of the video to each time.
  const url = URL.createObjectURL(m.blob);
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.src = url;
  await new Promise<void>((resolve) => {
    el.addEventListener('loadeddata', () => resolve(), { once: true });
    el.addEventListener('error', () => resolve(), { once: true });
  });
  return {
    width: w,
    height: h,
    duration: m.duration,
    async *frames(times) {
      for (const t of times) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 3000);
          el.addEventListener(
            'seeked',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          el.currentTime = t;
        });
        yield el.readyState >= 2 ? grayOf(el, ctx, w, h) : null;
      }
    },
    close: () => {
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * Follow the object in `track.box` (drawn at media time `track.at`) through
 * the part of the clip the layer plays: forwards to the end, then backwards
 * to the start, from the frame where it was drawn.
 */
export async function analyzeTrack(
  layer: Layer,
  track: Track,
  media: MediaStore,
  onProgress: (f: number) => void,
  signal: AbortSignal,
): Promise<Track> {
  const src = await framesOf(layer, media);
  try {
    const end = Math.min(src.duration, layer.in + layer.length * layer.speed);
    const from = Math.max(0, Math.min(layer.in, track.at));
    const to = Math.max(track.at, end);
    const n = Math.max(1, Math.floor((to - from) * FPS) + 1);
    const startIndex = Math.max(0, Math.min(n - 1, Math.round((track.at - from) * FPS)));
    const data = new Float64Array(n * 5);
    const { width: W, height: H } = src;
    const [bx, by, bw, bh] = track.box;
    const initial = { cx: (bx + bw / 2) * W, cy: (by + bh / 2) * H, w: bw * W, h: bh * H };
    let done = 0;

    const pass = async (indices: number[]) => {
      let tracker: NccTracker | null = null;
      const times = indices.map((i) => Math.min(src.duration - 1e-3, from + i / FPS));
      let k = 0;
      for await (const g of src.frames(times)) {
        if (signal.aborted) throw new DOMException('Tracking cancelled.', 'AbortError');
        const i = indices[k++]!;
        // No frame (a decode gap): hold the last position and call it lost.
        let r = { ...(tracker?.current ?? initial), conf: 0 };
        if (g) {
          if (!tracker) {
            tracker = new NccTracker(g, initial);
            r = { ...initial, conf: 1 };
          } else r = tracker.update(g);
        }
        data.set([r.cx / W, r.cy / H, r.w / W, r.h / H, Math.round(r.conf * 1000) / 1000], i * 5);
        onProgress(++done / (n + 1));
      }
    };

    await pass(Array.from({ length: n - startIndex }, (_, j) => startIndex + j));
    if (startIndex > 0) await pass(Array.from({ length: startIndex + 1 }, (_, j) => startIndex - j));
    return {
      ...track,
      duration: src.duration,
      from,
      fps: FPS,
      data: Array.from(data, (v) => Math.round(v * 1e4) / 1e4),
    };
  } finally {
    src.close();
  }
}
