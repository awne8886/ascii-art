import { type LayerFrame } from './gl/renderer';
import { envelopeAt, type MediaStore } from './media';
import { layerActive, mediaTime, type Layer, type Project } from './model';
import { drawSampleFrame, renderShape, renderText, SAMPLE_DURATION, SAMPLE_SIZE, type Drawn } from './sources';

/**
 * What each layer shows at a given time, for the live preview: stills as
 * they are, videos at their element's current frame (kept in step with the
 * timeline by `syncVideos`), and drawn layers (type, shapes, the sample
 * clip) rendered on demand and cached.
 */

export class DrawnCache {
  private cache = new Map<string, Drawn>();
  private sample = document.createElement('canvas');
  private sampleTime = -1;

  constructor(private scale = 1) {}

  drawn(layer: Layer, canvasH: number): Drawn | null {
    const props = layer.kind === 'text' ? layer.text : layer.kind === 'shape' ? layer.shape : null;
    if (!props) return null;
    const key = `${layer.id}:${canvasH}:${this.scale}:${JSON.stringify(props)}`;
    let d = this.cache.get(key);
    if (!d) {
      // One cached drawing per layer.
      for (const k of this.cache.keys()) if (k.startsWith(`${layer.id}:`)) this.cache.delete(k);
      d =
        layer.kind === 'text'
          ? renderText(layer.text!, canvasH, this.scale)
          : renderShape(layer.shape!, canvasH, this.scale);
      this.cache.set(key, d);
    }
    return d;
  }

  key(layer: Layer, canvasH: number): string {
    return `${layer.id}:${canvasH}:${this.scale}:${JSON.stringify(layer.kind === 'text' ? layer.text : layer.shape)}`;
  }

  sampleFrame(t: number): HTMLCanvasElement {
    if (t !== this.sampleTime) {
      drawSampleFrame(this.sample, t);
      this.sampleTime = t;
    }
    return this.sample;
  }
}

/** Seconds into a sample-clip layer at timeline time t. */
export function sampleTime(layer: Layer, t: number): number {
  return mediaTime(layer, t, SAMPLE_DURATION) ?? 0;
}

export function previewFrame(
  layer: Layer,
  project: Project,
  t: number,
  media: MediaStore,
  drawn: DrawnCache,
  playing: boolean,
): LayerFrame | null {
  const canvasH = project.canvas.height;
  switch (layer.kind) {
    case 'image': {
      const m = media.get(layer.mediaId);
      return m ? { source: m.el, width: m.width, height: m.height, version: m.id } : null;
    }
    case 'video': {
      const m = media.get(layer.mediaId);
      if (!m || !(m.el instanceof HTMLVideoElement)) return null;
      // Mid-seek there's no frame to upload: keep showing the last one.
      const ready = m.el.readyState >= 2 && !m.el.seeking;
      if (ready) m.shown = playing ? `play:${performance.now()}` : `${m.seq}:${m.el.currentTime}`;
      return m.shown ? { source: m.el, width: m.width, height: m.height, version: m.shown } : null;
    }
    case 'webcam': {
      const m = media.get(layer.mediaId);
      if (!m || !(m.el instanceof HTMLVideoElement) || m.el.readyState < 2) return null;
      return { source: m.el, width: m.width, height: m.height, version: performance.now() };
    }
    case 'sample': {
      const st = sampleTime(layer, t);
      return { source: drawn.sampleFrame(st), width: SAMPLE_SIZE[0], height: SAMPLE_SIZE[1], version: `s${st}` };
    }
    case 'text':
    case 'shape': {
      const d = drawn.drawn(layer, canvasH);
      return d ? { source: d.canvas, width: d.width, height: d.height, version: drawn.key(layer, canvasH) } : null;
    }
  }
}

/** Intrinsic size of a layer's picture in canvas px (for hit tests and handles), or null if unknown yet. */
export function layerSize(
  layer: Layer,
  project: Project,
  media: MediaStore,
  drawn: DrawnCache,
): [number, number] | null {
  if (layer.kind === 'sample') return SAMPLE_SIZE;
  if (layer.kind === 'text' || layer.kind === 'shape') {
    const d = drawn.drawn(layer, project.canvas.height);
    return d ? [d.width, d.height] : null;
  }
  const m = media.get(layer.mediaId);
  return m ? [m.width, m.height] : null;
}

/** Media length of a layer (seconds), for trimming and timeline bars. */
export function layerMediaDuration(layer: Layer, media: MediaStore): number | null {
  if (layer.kind === 'sample') return SAMPLE_DURATION;
  if (layer.kind === 'video') return media.get(layer.mediaId)?.duration ?? null;
  return null;
}

/**
 * Keep every video element on the timeline: playing and in step while the
 * timeline plays (re-seeking when it drifts), parked on the exact frame
 * while scrubbing, silent when muted or off screen.
 */
export function syncVideos(project: Project, t: number, playing: boolean, media: MediaStore, soundOn: boolean): void {
  for (const layer of project.layers) {
    if (layer.kind !== 'video') continue;
    const m = media.get(layer.mediaId);
    if (!m || !(m.el instanceof HTMLVideoElement)) continue;
    const el = m.el;
    const active = layerActive(layer, t);
    const mt = mediaTime(layer, t, m.duration);
    if (!active || mt === null) {
      if (!el.paused) el.pause();
      continue;
    }
    el.muted = !soundOn || layer.muted || !playing;
    el.volume = Math.max(0, Math.min(1, layer.volume));
    if (Math.abs(el.playbackRate - layer.speed) > 1e-3) el.playbackRate = Math.max(0.0625, Math.min(16, layer.speed));
    if (playing) {
      const drift = Math.abs(el.currentTime - mt);
      if (el.paused) {
        el.currentTime = mt;
        void el.play().catch(() => {
          // Autoplay with sound refused: play muted instead.
          el.muted = true;
          void el.play().catch(() => {});
        });
      } else if (drift > 0.3 && !el.seeking) {
        el.currentTime = mt;
      }
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - mt) > 0.004 && !el.seeking) el.currentTime = mt;
    }
  }
}

/**
 * While playing, a video that is actually running sets the pace: the
 * timeline follows its clock, so a slow machine drops frames instead of
 * drifting out of sync and re-seeking forever. Null when no video leads.
 */
export function videoClock(project: Project, t: number, media: MediaStore): number | null {
  for (const layer of project.layers) {
    if (layer.kind !== 'video' || !layerActive(layer, t)) continue;
    const m = media.get(layer.mediaId);
    const el = m?.el;
    if (!(el instanceof HTMLVideoElement) || el.paused || el.seeking || el.readyState < 2) continue;
    const vt = layer.start + (el.currentTime - layer.in) / layer.speed;
    // Only while it runs forward with the timeline (not across a loop back to its start).
    if (vt >= t - 0.05 && vt <= t + 0.5) return vt;
  }
  return null;
}

/** Loudness (0–1) of a layer's sound at time t, or the loudest active layer's for null. */
export function soundLevel(project: Project, layer: Layer | null, t: number, media: MediaStore): number {
  if (layer) {
    if (layer.kind !== 'video' || layer.muted) return 0;
    const m = media.get(layer.mediaId);
    if (!m?.envelope) return 0;
    const mt = mediaTime(layer, t, m.duration);
    return mt === null ? 0 : envelopeAt(m.envelope, mt) * Math.min(1, layer.volume);
  }
  let max = 0;
  for (const l of project.layers) if (layerActive(l, t)) max = Math.max(max, soundLevel(project, l, t, media));
  return max;
}
