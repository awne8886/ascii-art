import { type MediaStore } from './media';
import { type Layer } from './model';
import { drawSampleFrame, SAMPLE_DURATION, SAMPLE_SIZE } from './sources';

/**
 * Reads a layer's frames at chosen media times, off the preview's own
 * elements, for analysis (tracking, subject masks): videos frame-accurately
 * with WebCodecs (Mediabunny), or by seeking a private copy where WebCodecs
 * can't decode them; the sample clip by drawing it; a picture as its one frame.
 */

export interface DecodedFrame {
  /** The frame at the reader's size, on a canvas the reader reuses: read it before asking for the next one. */
  canvas: HTMLCanvasElement;
  /** Its RGBA pixels. */
  pixels: () => ImageData;
}

export interface FrameReader {
  /** Size frames are read at (the picture scaled down to the requested long side, never up). */
  width: number;
  height: number;
  /** The picture's own size. */
  sourceWidth: number;
  sourceHeight: number;
  /** Media seconds (0 for a picture). */
  duration: number;
  /**
   * Frames at the given media times, in order. A time the decoder has no
   * frame for repeats the last frame read; null only when there is none yet.
   */
  frames: (times: number[]) => AsyncGenerator<DecodedFrame | null>;
  close: () => void;
}

/** Size to read a w×h picture at so its long side is at most maxSide (never scaled up). */
export function readSize(w: number, h: number, maxSide: number): [number, number] {
  const k = Math.min(1, maxSide / Math.max(w, h));
  return [Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))];
}

function frameOn(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number): DecodedFrame {
  let image: ImageData | null = null;
  return { canvas, pixels: () => (image ??= ctx.getImageData(0, 0, w, h)) };
}

/** Open a reader for a video, sample-clip or picture layer, reading frames at most maxSide px on their long side. */
export async function openFrames(layer: Layer, media: MediaStore, maxSide: number): Promise<FrameReader> {
  const scratch = document.createElement('canvas');
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  const draw = (source: CanvasImageSource, w: number, h: number): DecodedFrame => {
    ctx.drawImage(source, 0, 0, w, h);
    return frameOn(scratch, ctx, w, h);
  };

  if (layer.kind === 'sample') {
    const [sw, sh] = SAMPLE_SIZE;
    const [w, h] = readSize(sw, sh, maxSide);
    scratch.width = w;
    scratch.height = h;
    const frame = document.createElement('canvas');
    return {
      width: w,
      height: h,
      sourceWidth: sw,
      sourceHeight: sh,
      duration: SAMPLE_DURATION,
      async *frames(times) {
        for (const t of times) {
          drawSampleFrame(frame, t);
          yield draw(frame, w, h);
        }
      },
      close: () => {},
    };
  }

  const m = media.get(layer.mediaId);
  if (layer.kind === 'image' && m) {
    const [w, h] = readSize(m.width, m.height, maxSide);
    scratch.width = w;
    scratch.height = h;
    return {
      width: w,
      height: h,
      sourceWidth: m.width,
      sourceHeight: m.height,
      duration: 0,
      async *frames(times) {
        for (let i = 0; i < times.length; i++) yield draw(m.el, w, h);
      },
      close: () => {},
    };
  }

  if (!m?.blob || layer.kind !== 'video') throw new Error('This layer has no video or picture to read.');
  const [w, h] = readSize(m.width, m.height, maxSide);
  scratch.width = w;
  scratch.height = h;
  const base = { width: w, height: h, sourceWidth: m.width, sourceHeight: m.height, duration: m.duration };

  if (typeof VideoDecoder !== 'undefined') {
    try {
      const mb = await import('mediabunny');
      const input = new mb.Input({ source: new mb.BlobSource(m.blob), formats: mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const first = await track.getFirstTimestamp();
        const sink = new mb.CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
        return {
          ...base,
          async *frames(times) {
            let last: DecodedFrame | null = null;
            for await (const c of sink.canvasesAtTimestamps(times.map((t) => first + t))) {
              if (c) last = draw(c.canvas, w, h);
              yield last;
            }
          },
          close: () => input.dispose(),
        };
      }
      input.dispose();
    } catch (e) {
      console.warn('[pro] decode: WebCodecs unavailable, seeking instead:', e);
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
    ...base,
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
        yield el.readyState >= 2 ? draw(el, w, h) : null;
      }
    },
    close: () => {
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
    },
  };
}
