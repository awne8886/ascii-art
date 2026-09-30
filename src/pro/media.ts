import { uid } from './model';

/**
 * Pictures, videos and webcams the project's layers point at (by id). The
 * project itself stays plain JSON; this holds the decoded elements, the
 * original files (for export decoding and autosave) and each video's
 * loudness envelope (for sound-driven params).
 */

export type MediaKind = 'image' | 'video' | 'webcam';

export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  /** The original file (not for webcams). */
  blob?: Blob;
  el: HTMLCanvasElement | HTMLVideoElement;
  width: number;
  height: number;
  /** Seconds (Infinity for a webcam, 0 for stills). */
  duration: number;
  /** Bumped whenever a paused video lands on a new frame (so it re-uploads). */
  seq: number;
  /** Version of the frame the preview last showed (videos). */
  shown?: string;
  stream?: MediaStream;
  /** Loudness per 1/ENVELOPE_RATE s, 0–1; null until decoded or when silent. */
  envelope: Float32Array | null;
  /** Decoded sound (kept for export mixing), when there is any. */
  audio: AudioBuffer | null;
  url?: string;
}

export const ENVELOPE_RATE = 60;

/**
 * Videos live in the page, invisibly: browsers stop decoding frames for a
 * playing video that isn't in the document (or looks off screen), and WebGL
 * would keep getting the same stale frame.
 */
function host(): HTMLElement {
  let el = document.getElementById('pro-media-host');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pro-media-host';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.append(el);
  }
  return el;
}

function park(el: HTMLVideoElement): void {
  el.style.cssText = 'width:2px;height:2px';
  host().append(el);
}
const MAX_IMAGE_SIDE = 4096;

type Listener = () => void;

export class MediaStore {
  private items = new Map<string, MediaItem>();
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  get(id: string | undefined): MediaItem | undefined {
    return id ? this.items.get(id) : undefined;
  }

  all(): MediaItem[] {
    return [...this.items.values()];
  }

  async addFile(file: Blob, name: string, id = uid('media')): Promise<MediaItem> {
    const type = file.type || guessType(name);
    const item = type.startsWith('video/') ? await loadVideo(file, name, id) : await loadImage(file, name, id);
    this.items.set(item.id, item);
    this.emit();
    if (item.kind === 'video') void this.decodeSound(item);
    return item;
  }

  addCanvas(canvas: HTMLCanvasElement, name: string): MediaItem {
    const item: MediaItem = {
      id: uid('media'),
      kind: 'image',
      name,
      el: canvas,
      width: canvas.width,
      height: canvas.height,
      duration: 0,
      seq: 0,
      envelope: null,
      audio: null,
    };
    this.items.set(item.id, item);
    this.emit();
    return item;
  }

  async addWebcam(): Promise<MediaItem> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.srcObject = stream;
    park(el);
    await el.play();
    await waitFor(el, 'loadeddata', () => el.readyState >= 2);
    const item: MediaItem = {
      id: uid('media'),
      kind: 'webcam',
      name: 'Webcam',
      el,
      width: el.videoWidth || 1280,
      height: el.videoHeight || 720,
      duration: Infinity,
      seq: 0,
      stream,
      envelope: null,
      audio: null,
    };
    this.items.set(item.id, item);
    this.emit();
    return item;
  }

  /** A second, independent copy (a duplicated video layer needs its own playhead). */
  async clone(id: string): Promise<MediaItem | undefined> {
    const src = this.items.get(id);
    if (!src) return undefined;
    if (src.kind === 'image' || !src.blob) return src;
    const copy = await this.addFile(src.blob, src.name);
    copy.envelope = src.envelope;
    copy.audio = src.audio;
    return copy;
  }

  remove(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    release(item);
    this.emit();
  }

  /** Drop everything no layer uses any more. */
  prune(used: Set<string>): void {
    for (const id of [...this.items.keys()]) if (!used.has(id)) this.remove(id);
  }

  dispose(): void {
    this.items.forEach(release);
    this.items.clear();
  }

  private async decodeSound(item: MediaItem): Promise<void> {
    if (!item.blob || item.blob.size > 6e8) return;
    try {
      const data = await item.blob.arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buffer = await ctx.decodeAudioData(data);
      item.audio = buffer.duration < 20 * 60 ? buffer : null;
      item.envelope = envelopeOf(buffer);
      this.emit();
    } catch {
      // No sound track, or a codec WebAudio can't decode: the video just stays silent to sound-driven params.
    }
  }
}

function release(item: MediaItem): void {
  if (item.el instanceof HTMLVideoElement) {
    item.el.pause();
    item.el.removeAttribute('src');
    item.el.srcObject = null;
    item.el.load();
    item.el.remove();
  }
  item.stream?.getTracks().forEach((t) => t.stop());
  if (item.url) URL.revokeObjectURL(item.url);
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'avi'].includes(ext))
    return `video/${ext === 'mov' ? 'quicktime' : ext}`;
  return `image/${ext}`;
}

function waitFor(el: HTMLMediaElement, event: string, ready: () => boolean, ms = 20000): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      el.removeEventListener(event, done);
      el.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      clearTimeout(timer);
      el.removeEventListener(event, done);
      el.removeEventListener('error', fail);
      reject(new Error('This browser can’t play that video. Try an MP4 (H.264) or WebM.'));
    };
    const timer = setTimeout(fail, ms);
    el.addEventListener(event, done);
    el.addEventListener('error', fail);
  });
}

async function loadVideo(file: Blob, name: string, id: string): Promise<MediaItem> {
  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.loop = false;
  el.src = url;
  park(el);
  try {
    await waitFor(el, 'loadeddata', () => el.readyState >= 2);
  } catch (e) {
    el.remove();
    URL.revokeObjectURL(url);
    throw e;
  }
  const duration = await knownDuration(el);
  const item: MediaItem = {
    id,
    kind: 'video',
    name,
    blob: file,
    el,
    width: el.videoWidth || 1280,
    height: el.videoHeight || 720,
    duration,
    seq: 0,
    envelope: null,
    audio: null,
    url,
  };
  const bump = () => item.seq++;
  el.addEventListener('seeked', bump);
  el.addEventListener('loadeddata', bump);
  return item;
}

/**
 * Recordings made with MediaRecorder (screen captures, many web tools) carry
 * no duration: the element says Infinity until it has been to the end once.
 */
async function knownDuration(el: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, 4000);
    function done() {
      clearTimeout(timer);
      el.removeEventListener('durationchange', check);
      resolve();
    }
    function check() {
      if (Number.isFinite(el.duration)) done();
    }
    el.addEventListener('durationchange', check);
    el.currentTime = 1e7;
  });
  const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2000);
    el.addEventListener(
      'seeked',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    el.currentTime = 0;
  });
  return d;
}

async function loadImage(file: Blob, name: string, id: string): Promise<MediaItem> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  let close = () => {};
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bmp;
    w = bmp.width;
    h = bmp.height;
    close = () => bmp.close();
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      source = img;
      w = img.naturalWidth || 1024;
      h = img.naturalHeight || 1024;
    } catch {
      throw new Error(`Couldn't read “${name}”. Try a JPEG, PNG, WebP, GIF or a video.`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  close();
  return {
    id,
    kind: 'image',
    name,
    blob: file,
    el: canvas,
    width: canvas.width,
    height: canvas.height,
    duration: 0,
    seq: 0,
    envelope: null,
    audio: null,
  };
}

/** RMS loudness per 1/ENVELOPE_RATE s, normalised to the loudest moment (0–1). */
export function envelopeOf(buffer: AudioBuffer): Float32Array | null {
  const step = Math.max(1, Math.round(buffer.sampleRate / ENVELOPE_RATE));
  const n = Math.ceil(buffer.length / step);
  const out = new Float32Array(n);
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const end = Math.min(buffer.length, (i + 1) * step);
    for (let s = i * step; s < end; s++) {
      let v = 0;
      for (const ch of chans) v += ch[s]!;
      v /= chans.length || 1;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - i * step));
    out[i] = rms;
    peak = Math.max(peak, rms);
  }
  if (peak < 1e-4) return null;
  for (let i = 0; i < n; i++) out[i] = Math.min(1, out[i]! / peak);
  return out;
}

export function envelopeAt(env: Float32Array | null, seconds: number): number {
  if (!env || !Number.isFinite(seconds)) return 0;
  const i = Math.max(0, Math.min(env.length - 1, Math.floor(seconds * ENVELOPE_RATE)));
  return env[i]!;
}
