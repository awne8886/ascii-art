import { isSuperseded, segment, type SegmentProgress } from '../../segment/client';
import { type SegmentMethod } from '../../settings';
import { maskBytes, maskDims, type RawMask } from './masks';

/** Webcam frames are separated this big (long side): quick enough to keep up, fine for a live cut-out. */
const LIVE_SIDE = 384;
/** Pause before trying again after the model failed. */
const RETRY_MS = 2000;
/** In a background tab it asks only while something drew it this recently (an export goes on there; the preview doesn't). */
const HIDDEN_IDLE_MS = 1000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let runs = 0;

/**
 * Separates a webcam live: grabs the newest frame, segments it, keeps the
 * mask, and asks again as soon as it's back. Its requests share one lane,
 * so a frame still waiting for the worker gives way to a newer one.
 */
export class LiveSubject {
  /** The newest mask, and the one before it (for steadiness). */
  latest: RawMask | null = null;
  previous: RawMask | null = null;
  /** Bumped with every new mask. */
  seq = 0;
  error: string | null = null;
  backend = '';
  /** Its model downloading or starting, until the first mask. */
  job: SegmentProgress | null = null;
  /** When something last drew its mask (performance.now(); the store notes it). */
  drawn = -Infinity;

  private run = 0;
  /** Aborts the run's request in flight when it stops: the worker drops it (and a download only it waited on). */
  private ctrl: AbortController | null = null;
  private asked = 0;
  private canvas: HTMLCanvasElement | null = null;

  constructor(
    private readonly layerId: string,
    private readonly el: HTMLVideoElement,
    /** Another method takes another LiveSubject (the store starts one). */
    readonly method: SegmentMethod,
    /** Called with every new mask, when an error appears or clears, and as its model downloads or starts. */
    private readonly onChange: (what: 'mask' | 'error' | 'progress') => void,
  ) {}

  get running(): boolean {
    return this.run > 0;
  }

  start(): void {
    if (this.run) return;
    this.run = ++runs;
    this.ctrl = new AbortController();
    void this.loop(this.run, this.ctrl.signal);
  }

  /**
   * Stop asking. `cancel` (separation off, the layer gone, another method):
   * also drop the request in flight. Without it (nothing draws the layer for
   * now) that request stays, so a model download under way carries on.
   */
  stop(cancel = true): void {
    this.run = 0;
    if (cancel) this.ctrl?.abort();
    this.ctrl = null;
  }

  private grab(): ImageData | null {
    const vw = this.el.videoWidth;
    const vh = this.el.videoHeight;
    if (this.el.readyState < 2 || !vw || !vh) return null;
    const [w, h] = maskDims(Math.min(LIVE_SIDE, Math.max(vw, vh)), vw, vh);
    this.canvas ??= document.createElement('canvas');
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(this.el, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  private async loop(run: number, signal: AbortSignal): Promise<void> {
    const alive = () => this.run === run;
    while (alive()) {
      // A background tab shows none of it, unless an export still draws it there.
      if (document.hidden && performance.now() - this.drawn >= HIDDEN_IDLE_MS) {
        await wait(250);
        continue;
      }
      const image = this.grab();
      if (!image) {
        await wait(100);
        continue;
      }
      try {
        const lane = `live:${this.layerId}`;
        const input = { rgba: image.data, width: image.width, height: image.height };
        const onProgress = (p: SegmentProgress) => {
          if (!alive() || (p.phase !== 'download' && p.phase !== 'init')) return;
          this.job = p;
          this.onChange('progress');
        };
        // Keys unique to this run: a stopped one's request still in flight is never shared.
        const r = await segment(`${lane}:${run}:${++this.asked}`, input, this.method, onProgress, lane, signal);
        if (!alive()) return;
        this.job = null;
        this.previous = this.latest;
        this.latest = {
          width: image.width,
          height: image.height,
          data: maskBytes(r.mask.data, r.mask.width, r.mask.height, image.width, image.height),
          rect: [0, 0, 1, 1],
        };
        this.seq++;
        this.backend = r.backend;
        if (this.error) {
          this.error = null;
          this.onChange('error');
        }
        this.onChange('mask');
      } catch (e) {
        if (!alive()) return;
        if (isSuperseded(e)) continue;
        this.job = null;
        this.error = e instanceof Error ? e.message : String(e);
        this.onChange('error');
        await wait(RETRY_MS);
      }
    }
  }
}
