import type * as MB from 'mediabunny';
import { effectById } from '../effects/registry';
import { DrawnCache, sampleTime, soundLevel } from '../frames';
import { ProRenderer, backgroundColor, hexToRgb01, type LayerFrame } from '../gl/renderer';
import { type MediaStore } from '../media';
import { layerActive, mediaTime, type Layer, type Project } from '../model';
import { SAMPLE_SIZE } from '../sources';
import { type MaskSource } from '../subject/types';
import { mixAudio } from './audio';
import { ZipWriter } from './zip';

/**
 * Renders the project frame by frame, off screen, at the export size, and
 * encodes it. Every video layer is decoded frame-accurately (WebCodecs via
 * Mediabunny, or by seeking a video element where that isn't available), so
 * each frame of the source goes through the looks exactly once per output
 * frame, however long rendering takes. Video goes to MP4/WebM with WebCodecs
 * (sound mixed from the video layers), falling back to a real-time
 * MediaRecorder capture in browsers without an encoder.
 */

export type ExportFormat = 'mp4' | 'webm' | 'png' | 'png-seq';

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  height: number;
  duration: number;
  fps: number;
  /** 0 off, 1 natural (half-frame shutter), 2 longer (full-frame shutter). */
  motionBlur: 0 | 1 | 2;
  background: 'canvas' | 'custom' | 'transparent';
  customColor: string;
  /** For single PNGs: the moment to capture. */
  frameTime: number;
  sound: boolean;
}

export interface ExportProgress {
  phase: 'prepare' | 'render' | 'finish';
  done: number;
  total: number;
  /** Seconds left, once known. */
  eta?: number;
  note?: string;
}

export interface ExportResult {
  blob: Blob;
  name: string;
}

interface FrameSource {
  get(index: number, t: number): Promise<LayerFrame | null>;
  close(): void;
}

type Mediabunny = typeof MB;

let mbPromise: Promise<Mediabunny> | null = null;
function mediabunny(): Promise<Mediabunny> {
  mbPromise ??= import('mediabunny');
  return mbPromise;
}

export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

function safeName(s: string): string {
  return (
    (s || 'untitled')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

/** Frames of a video layer at each output frame's time: WebCodecs first, seeking as a fallback. */
async function videoSource(layer: Layer, media: MediaStore, times: number[]): Promise<FrameSource> {
  const m = media.get(layer.mediaId);
  if (!m?.blob) return { get: async () => null, close: () => {} };
  const mediaTimes = times.map((t) => (layerActive(layer, t) ? mediaTime(layer, t, m.duration) : null));

  if (typeof VideoDecoder !== 'undefined') {
    try {
      const mb = await mediabunny();
      const input = new mb.Input({ source: new mb.BlobSource(m.blob), formats: mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const first = await track.getFirstTimestamp();
        const sink = new mb.CanvasSink(track, { poolSize: 3, alpha: true });
        const wanted = mediaTimes.filter((x): x is number => x !== null).map((x) => first + x);
        const gen = sink.canvasesAtTimestamps(wanted);
        let last: LayerFrame | null = null;
        return {
          async get(i) {
            if (mediaTimes[i] === null || mediaTimes[i] === undefined) return null;
            const r = await gen.next();
            if (!r.done && r.value) {
              last = { source: r.value.canvas, width: m.width, height: m.height, version: `v${layer.id}:${i}` };
            }
            return last;
          },
          close() {
            void gen.return(undefined);
            input.dispose();
          },
        };
      }
      input.dispose();
    } catch (e) {
      console.warn('[pro] WebCodecs decode unavailable, seeking instead:', e);
    }
  }

  // Seek a private copy of the video to each frame.
  const url = URL.createObjectURL(m.blob);
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.src = url;
  await new Promise<void>((resolve) => {
    if (el.readyState >= 2) return resolve();
    el.addEventListener('loadeddata', () => resolve(), { once: true });
    el.addEventListener('error', () => resolve(), { once: true });
  });
  return {
    async get(i) {
      const mt = mediaTimes[i];
      if (mt === null || mt === undefined || el.readyState < 1) return null;
      if (Math.abs(el.currentTime - mt) > 1e-4) {
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
          el.currentTime = mt;
        });
      }
      return { source: el, width: m.width, height: m.height, version: `s${layer.id}:${i}` };
    },
    close() {
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
    },
  };
}

function needsPreroll(project: Project): boolean {
  const fx = [...project.effects, ...project.layers.flatMap((l) => l.effects)];
  return (
    fx.some((e) => e.enabled && effectById(e.effectId)?.feedback) ||
    project.finish.trails.on ||
    project.layers.some((l) => l.finish.trails.on)
  );
}

export async function exportProject(
  project: Project,
  media: MediaStore,
  opts: ExportOptions,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  /** Separated subjects (masks are analysed ahead of time, so every frame gets its own). */
  subjects?: MaskSource,
): Promise<ExportResult> {
  const video = opts.format === 'mp4' || opts.format === 'webm';
  const W = video ? even(opts.width) : Math.max(1, Math.round(opts.width));
  const H = video ? even(opts.height) : Math.max(1, Math.round(opts.height));
  const fps = Math.max(1, opts.fps);
  const single = opts.format === 'png';
  const total = single ? 1 : Math.max(1, Math.round(opts.duration * fps));
  const times = single
    ? [Math.max(0, Math.min(opts.frameTime, project.canvas.duration))]
    : Array.from({ length: total }, (_, i) => i / fps);
  const base = `${safeName(project.name)}-${W}x${H}`;
  onProgress({ phase: 'prepare', done: 0, total });

  const bg: [number, number, number, number] =
    opts.background === 'transparent' && !video
      ? [0, 0, 0, 0]
      : opts.background === 'custom'
        ? [...hexToRgb01(opts.customColor), 1]
        : opts.background === 'transparent'
          ? [0, 0, 0, 1]
          : (() => {
              const c = backgroundColor(project);
              return c[3] === 0 && video ? ([0, 0, 0, 1] as [number, number, number, number]) : c;
            })();

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new ProRenderer(canvas, { preserveDrawingBuffer: true });
  let lost = false;
  canvas.addEventListener('webglcontextlost', () => (lost = true));
  const drawn = new DrawnCache(W / project.canvas.width);
  const sources = new Map<string, FrameSource>();
  const cleanup = () => {
    sources.forEach((s) => s.close());
    renderer.dispose(true);
  };

  try {
    for (const layer of project.layers) {
      if (layer.kind === 'video') sources.set(layer.id, await videoSource(layer, media, times));
    }
    aborted(signal);

    const frameOf = async (index: number, t: number): Promise<Map<string, LayerFrame | null>> => {
      const out = new Map<string, LayerFrame | null>();
      for (const layer of project.layers) {
        if (!layerActive(layer, t)) continue;
        let f: LayerFrame | null = null;
        if (layer.kind === 'video') f = (await sources.get(layer.id)?.get(index, t)) ?? null;
        else if (layer.kind === 'image' || layer.kind === 'webcam') {
          const m = media.get(layer.mediaId);
          if (m) f = { source: m.el, width: m.width, height: m.height, version: layer.kind === 'image' ? m.id : index };
        } else if (layer.kind === 'sample') {
          const st = sampleTime(layer, t);
          f = { source: drawn.sampleFrame(st), width: SAMPLE_SIZE[0], height: SAMPLE_SIZE[1], version: `s${st}` };
        } else {
          const d = drawn.drawn(layer, project.canvas.height);
          if (d)
            f = {
              source: d.canvas,
              width: d.width,
              height: d.height,
              version: drawn.key(layer, project.canvas.height),
            };
        }
        out.set(layer.id, f);
      }
      return out;
    };

    const subframes = opts.motionBlur === 0 ? 1 : opts.motionBlur === 1 ? 4 : 8;
    const shutter = opts.motionBlur === 2 ? 1 : 0.5;
    const renderAt = (frames: Map<string, LayerFrame | null>, t: number, index: number) => {
      for (let s = 0; s < subframes; s++) {
        const ts = t + (subframes > 1 ? (s / subframes) * (shutter / fps) : 0);
        renderer.renderFrame({
          project,
          time: ts,
          frame: index,
          width: W,
          height: H,
          frameOf: (l) => frames.get(l.id) ?? null,
          sound: (l) => soundLevel(project, l, ts, media),
          background: bg,
          // At t, like the pictures: the sub-frames move the layers, not what the frames show.
          maskOf: (l) => subjects?.maskAt(l, project, t) ?? null,
        });
        if (subframes > 1) renderer.accumulate(s);
      }
      renderer.present();
      // Never write black frames: a lost GPU context stops the export instead.
      if (lost || renderer.isLost)
        throw new Error('The graphics context was lost during the export. Close other heavy tabs and try again.');
    };

    const preroll = needsPreroll(project) ? Math.min(Math.round(fps), 45) : 0;
    const started = performance.now();
    const eta = (done: number) => ((performance.now() - started) / 1000 / Math.max(1, done)) * (total - done);

    if (single) {
      const t = times[0]!;
      const frames = await frameOf(0, t);
      for (let j = preroll; j > 0; j--) renderAt(frames, t - j / fps, -j);
      renderAt(frames, t, Math.round(t * fps));
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'),
      );
      onProgress({ phase: 'finish', done: 1, total: 1 });
      return { blob, name: `${base}.png` };
    }

    if (opts.format === 'png-seq') {
      const zip = new ZipWriter();
      const digits = String(total).length;
      for (let i = 0; i < total; i++) {
        aborted(signal);
        const t = times[i]!;
        const frames = await frameOf(i, t);
        if (i === 0) for (let j = preroll; j > 0; j--) renderAt(frames, t - j / fps, -j);
        renderAt(frames, t, i);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'),
        );
        zip.add(
          `${base}/frame_${String(i + 1).padStart(Math.max(5, digits), '0')}.png`,
          new Uint8Array(await blob.arrayBuffer()),
        );
        onProgress({ phase: 'render', done: i + 1, total, eta: eta(i + 1) });
      }
      onProgress({ phase: 'finish', done: total, total });
      return { blob: zip.finish(), name: `${base}-png.zip` };
    }

    if (!hasWebCodecs()) {
      return await recordRealtime(canvas, opts, total, times, frameOf, renderAt, onProgress, signal, base);
    }

    const mb = await mediabunny();
    const format =
      opts.format === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat();
    const codec = await mb.getFirstEncodableVideoCodec(
      opts.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'],
      { width: W, height: H, frameRate: fps },
    );
    if (!codec) {
      throw new Error(
        `This browser can't encode ${opts.format.toUpperCase()} at ${W}×${H}. Try ${opts.format === 'mp4' ? 'WebM' : 'MP4'} or a smaller size.`,
      );
    }
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format, target });
    const videoSrc = new mb.CanvasSource(canvas, { codec, bitrate: mb.QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(videoSrc, { frameRate: fps });

    let audio: AudioBuffer | null = null;
    if (opts.sound) {
      onProgress({ phase: 'prepare', done: 0, total, note: 'Mixing sound…' });
      audio = await mixAudio(project, media, total / fps).catch(() => null);
    }
    let audioSrc: InstanceType<Mediabunny['AudioBufferSource']> | null = null;
    if (audio) {
      const acodec = await mb.getFirstEncodableAudioCodec(
        opts.format === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'],
        {
          numberOfChannels: audio.numberOfChannels,
          sampleRate: audio.sampleRate,
        },
      );
      if (acodec) {
        audioSrc = new mb.AudioBufferSource({ codec: acodec, bitrate: mb.QUALITY_HIGH });
        output.addAudioTrack(audioSrc);
      }
    }

    await output.start();
    try {
      if (audioSrc && audio) await audioSrc.add(audio);
      for (let i = 0; i < total; i++) {
        aborted(signal);
        const t = times[i]!;
        const frames = await frameOf(i, t);
        if (i === 0) for (let j = preroll; j > 0; j--) renderAt(frames, t - j / fps, -j);
        renderAt(frames, t, i);
        await videoSrc.add(i / fps, 1 / fps);
        onProgress({ phase: 'render', done: i + 1, total, eta: eta(i + 1) });
      }
      onProgress({ phase: 'finish', done: total, total, note: 'Finishing the file…' });
      await output.finalize();
    } catch (e) {
      await output.cancel().catch(() => {});
      throw e;
    }
    const mime = await output.getMimeType().catch(() => (opts.format === 'mp4' ? 'video/mp4' : 'video/webm'));
    return { blob: new Blob([target.buffer!], { type: mime.split(';')[0] }), name: `${base}.${opts.format}` };
  } finally {
    cleanup();
  }
}

/** No WebCodecs: play the frames back in real time into a MediaRecorder. */
async function recordRealtime(
  canvas: HTMLCanvasElement,
  opts: ExportOptions,
  total: number,
  times: number[],
  frameOf: (i: number, t: number) => Promise<Map<string, LayerFrame | null>>,
  renderAt: (frames: Map<string, LayerFrame | null>, t: number, index: number) => void,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  base: string,
): Promise<ExportResult> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
  const types =
    opts.format === 'mp4'
      ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error('This browser cannot record video.');
  canvas.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
  document.body.append(canvas);
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start(250);
  const start = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      aborted(signal);
      const frames = await frameOf(i, times[i]!);
      renderAt(frames, times[i]!, i);
      track?.requestFrame();
      const due = start + ((i + 1) / opts.fps) * 1000;
      await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
      onProgress({ phase: 'render', done: i + 1, total, note: 'Recording in real time (no WebCodecs here)' });
    }
  } finally {
    recorder.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    canvas.remove();
  }
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), name: `${base}.${ext}` };
}
