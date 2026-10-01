import { openFrames } from '../decode';
import { type MediaStore } from '../media';
import { type Layer, type Track } from '../model';
import { NccTracker, toGray, type Gray } from './tracker';

/** Frames are analysed at most this big (long side): plenty for following an object, and fast. */
const WORK = 360;
const FPS = 30;

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
  if (layer.kind !== 'video' && layer.kind !== 'sample')
    throw new Error('Only videos (and the sample clip) can be tracked.');
  const src = await openFrames(layer, media, WORK);
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
      for await (const f of src.frames(times)) {
        if (signal.aborted) throw new DOMException('Tracking cancelled.', 'AbortError');
        const i = indices[k++]!;
        const g: Gray | null = f ? toGray(f.pixels().data, W, H) : null;
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
