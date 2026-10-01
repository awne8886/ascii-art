import { segment, type SegmentProgress, type SegmentResult } from '../../segment/client';
import { type SegmentMethod } from '../../settings';
import { openFrames, type DecodedFrame } from '../decode';
import { type MediaStore } from '../media';
import { defaultSubject, trackAt, type Layer } from '../model';
import { SAMPLE_DURATION, SAMPLE_SIZE } from '../sources';
import {
  analysisTimes,
  analysisWindow,
  fadeBorder,
  maskBytes,
  maskDims,
  maskPlan,
  wantedMeta,
  type MaskSequence,
  type RawMask,
  type Rect,
} from './masks';
import { type SubjectJob } from './types';

/**
 * Separates a layer's subject ahead of time: one mask every 1/rate s over
 * the part of the clip that shows on the canvas (one for a picture), each
 * frame run through the segmentation worker (which refines the model's
 * coarse mask with a colour-guided filter). With the tracked area, only a
 * window around the layer's tracked object is segmented, so the subject is
 * that object.
 */

/** Model input (long side) for a whole frame: U²-Net works at 320 px; BiRefNet at 1024, fed a fair 768. */
const INPUT_FAST = 320;
const INPUT_HQ = 768;
/** Frames are read this big when windows are cut out of them, and the windows fed to the model this big. */
const TRACKED_READ = 1280;
const WINDOW_INPUT = 384;
/** Requests kept in flight, so reading the next frame overlaps inference on this one. */
const IN_FLIGHT = 2;
/** Share of the progress bar a model download takes, when there is one. */
const DOWNLOAD_SHARE = 0.25;

let jobSeq = 0;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A model failure, as a sentence, with the way out ("Failed to fetch" has no full stop of its own). */
function withHint(msg: string, method: SegmentMethod): string {
  const end = /[.!?…]$/.test(msg) ? '' : '.';
  return method === 'ai-hq'
    ? `${msg}${end} Try “AI · fast” (any browser) or “Classic” (no download).`
    : `${msg}${end} Try “Classic”, which needs no download.`;
}

/**
 * Analyse the layer's subject with its current settings, over the part of
 * its clip that shows on a canvas `canvasDuration` long. Rejects with an
 * AbortError when `signal` aborts, and with a readable Error otherwise.
 */
export async function analyzeSubject(
  layer: Layer,
  canvasDuration: number,
  media: MediaStore,
  onProgress: (job: SubjectJob) => void,
  signal: AbortSignal,
): Promise<MaskSequence> {
  const started = performance.now();
  const s = layer.subject ?? defaultSubject();
  const cancelled = () => new DOMException('Separation cancelled.', 'AbortError');
  if (layer.kind === 'webcam') throw new Error('The webcam is separated live, as it plays.');
  if (layer.kind !== 'video' && layer.kind !== 'sample' && layer.kind !== 'image') {
    throw new Error('Only videos, pictures and the sample clip can be separated.');
  }
  const tracked = s.area === 'tracked';
  const track = layer.track;
  if (tracked && layer.kind === 'image') {
    throw new Error('Only videos and the sample clip can follow a tracked object.');
  }
  if (tracked && (!track || track.data.length < 5)) {
    throw new Error('Track the object first (in the Track tab), then separate it.');
  }

  const m = layer.kind === 'sample' ? null : media.get(layer.mediaId);
  if (layer.kind !== 'sample' && !m) throw new Error('This layer’s file is missing.');
  const [pw, ph] = m ? [m.width, m.height] : SAMPLE_SIZE;
  const still = layer.kind === 'image';
  const duration = layer.kind === 'sample' ? SAMPLE_DURATION : still ? 0 : m!.duration;
  const meta = wantedMeta(layer, duration, canvasDuration);
  const times = still ? [0] : analysisTimes(meta.from, meta.to, s.rate, duration);
  const count = times.length;
  const plan = maskPlan(count, pw, ph, tracked);
  const hq = s.method === 'ai-hq';
  const readSide = tracked ? TRACKED_READ : Math.max(plan.long, hq ? INPUT_HQ : INPUT_FAST);
  const windowInput = hq ? INPUT_HQ : WINDOW_INPUT;

  // Progress: a model download (if any) fills the first part of the bar, then the masks.
  let downloaded = false;
  let done = 0;
  const analysing = (): SubjectJob => {
    const base = downloaded ? DOWNLOAD_SHARE : 0;
    return { phase: 'analyse', progress: base + (1 - base) * (done / count), done, count };
  };
  const onSegment = (p: SegmentProgress) => {
    // Download and start-up progress is this job's model's (the client passes each model's to its own requests).
    if (done > 0 || signal.aborted) return;
    if (p.phase === 'download') {
      downloaded = true;
      const f = p.total ? Math.min(1, (p.loaded ?? 0) / p.total) : 0;
      onProgress({ phase: 'download', progress: DOWNLOAD_SHARE * f, loaded: p.loaded, total: p.total });
    } else if (p.phase === 'init') {
      onProgress({ phase: 'init', progress: downloaded ? DOWNLOAD_SHARE : 0 });
    }
  };
  onProgress(analysing());

  if (signal.aborted) throw cancelled();
  const reader = await openFrames(layer, media, readSide);
  const crop = document.createElement('canvas');
  const cropCtx = crop.getContext('2d', { willReadFrequently: true })!;

  /** What goes to the model for one frame, and where its mask lands. */
  const prepare = (f: DecodedFrame, t: number) => {
    if (!tracked) {
      const image = f.pixels();
      return { image, rect: [0, 0, 1, 1] as Rect, dims: maskDims(plan.long, pw, ph) };
    }
    // The window around where the tracked object is at this moment (the track is keyed by media time).
    const rect = analysisWindow(trackAt(track!, t), pw, ph);
    const [x, y, w, h] = rect;
    const [cw, ch] = maskDims(windowInput, w * pw, h * ph);
    crop.width = cw;
    crop.height = ch;
    cropCtx.imageSmoothingQuality = 'high';
    const { width: rw, height: rh } = reader;
    cropCtx.drawImage(f.canvas, x * rw, y * rh, w * rw, h * rh, 0, 0, cw, ch);
    return { image: cropCtx.getImageData(0, 0, cw, ch), rect, dims: maskDims(plan.long, w * pw, h * ph) };
  };

  const toMask = (r: SegmentResult, rect: Rect, [mw, mh]: [number, number]): RawMask => {
    const data = maskBytes(r.mask.data, r.mask.width, r.mask.height, mw, mh);
    if (tracked) fadeBorder(data, mw, mh, rect);
    return { width: mw, height: mh, data, rect };
  };

  const frames: Array<RawMask | null> = new Array<RawMask | null>(count).fill(null);
  const job = `subject:${layer.id}:${++jobSeq}`;
  let failure: Error | null = null;
  let backend = '';
  const inflight: Array<Promise<void>> = [];
  try {
    let i = 0;
    for await (const f of reader.frames(times)) {
      if (signal.aborted) throw cancelled();
      if (failure) throw failure;
      const idx = i++;
      if (!f) continue;
      const { image, rect, dims } = prepare(f, times[idx]!);
      const rgba = { rgba: image.data, width: image.width, height: image.height };
      // Lane null: every frame's request runs, none is dropped for a newer one (until the job is stopped).
      const p = segment(`${job}:${idx}`, rgba, s.method, onSegment, null, signal).then(
        (r) => {
          frames[idx] = toMask(r, rect, dims);
          backend = r.backend;
          done++;
          if (!signal.aborted) onProgress(analysing());
        },
        (e: unknown) => {
          if (signal.aborted) return;
          failure ??= new Error(s.method === 'classic' ? message(e) : withHint(message(e), s.method));
        },
      );
      inflight.push(p);
      while (inflight.length >= IN_FLIGHT) await inflight.shift();
    }
    await Promise.all(inflight);
  } finally {
    reader.close();
  }
  if (signal.aborted) throw cancelled();
  if (failure) throw failure;

  // A frame the decoder couldn't give takes the mask before it (the first one it could, at the start).
  let fill: RawMask | null = frames.find((f) => f) ?? null;
  if (!fill) throw new Error('Couldn’t read any frames of this clip.');
  for (let k = 0; k < count; k++) {
    if (frames[k]) fill = frames[k]!;
    else frames[k] = fill;
  }

  return {
    from: still ? 0 : times[0]!,
    fps: still ? 0 : s.rate,
    frames: frames as RawMask[],
    meta,
    backend,
    ms: Math.round(performance.now() - started),
  };
}
