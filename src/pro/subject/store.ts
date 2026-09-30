import { sampleTime } from '../frames';
import { type MediaStore } from '../media';
import { mediaTime, SEPARABLE_KINDS, type Layer, type Project, type SubjectSettings } from '../model';
import { SAMPLE_DURATION, SAMPLE_SIZE } from '../sources';
import { deleteMasks, loadMasks, onMasksPruned, saveMasks } from '../storage';
import { analyzeSubject } from './analyze';
import { LiveSubject } from './live';
import {
  analysisRange,
  covers,
  finalizeFrame,
  finishKey,
  maskIndex,
  parseSequence,
  readRecord,
  sequenceFit,
  staleReason,
  toRecord,
  wantedMeta,
  type MaskSequence,
} from './masks';
import { type LayerMask, type MaskFrame, type MaskSource, type SubjectInfo, type SubjectJob } from './types';

/**
 * Every layer's subject masks, outside the project (they can be tens of MB):
 * analysed on request, kept in memory (also for layers that were removed,
 * since undo may bring them back), saved to IndexedDB and brought back after
 * a reload. The webcam is separated live while something draws it. The
 * renderer asks for a layer's masks at a time (maskAt); the panels ask how
 * the analysis stands (info) and start it (analyze).
 */

/** Finalized masks kept (a paused preview, or scrubbing back and forth, costs nothing). */
const FINISHED_CAP = 48;
/** A webcam's live separation stops once nothing has drawn it for this long. */
const LIVE_IDLE_MS = 1000;
/** Progress reaches subscribers at most this often. */
const EMIT_MS = 100;

interface Held {
  /** Unique across the store's life, so mask versions never repeat. */
  id: number;
  seq: MaskSequence;
}

interface Job {
  ctrl: AbortController;
  job: SubjectJob;
  /** analysisKey() of the layer as it was analysed. */
  key: string;
  /** Media seconds it analyses (null when the media's length isn't known: it fails). */
  range: { from: number; to: number } | null;
}

/** How an analysis ended. */
export type AnalysisOutcome = 'done' | 'failed' | 'cancelled';

interface Live {
  id: number;
  sub: LiveSubject;
  mediaId: string;
  wanted: number;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError';
}

export class SubjectStore implements MaskSource {
  private held = new Map<string, Held>();
  private jobs = new Map<string, Job>();
  /** The last analysis failure per layer, and which analysis settings it was for. */
  private errors = new Map<string, { message: string; key: string }>();
  /** Layers whose analysis was stopped (Stop), and what they wanted then (wantKey): not restarted for that. */
  private stopped = new Map<string, string>();
  private live = new Map<string, Live>();
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  /** Finalized frames by MaskFrame.version, least recently used first. */
  private finished = new Map<string, MaskFrame>();
  /** The last LayerMask handed out per layer, and what it was for. */
  private last = new Map<string, { key: string; mask: LayerMask }>();
  /** Layers whose current masks are in IndexedDB. */
  private saved = new Set<string>();
  /** Layers already looked up in IndexedDB. */
  private tried = new Set<string>();
  /** IndexedDB lookups under way, per layer (an analysis waits for one: it may bring back masks that fit). */
  private loading = new Map<string, Promise<void>>();
  /** The canvas's length: only the part of a clip on it is analysed. */
  private canvasDuration = Infinity;
  private listeners = new Set<() => void>();
  /** Bumped when anything maskAt can return changes (MaskSource.version). */
  private maskVer = 0;
  /** Bumped on every change subscribers hear of (masks, analysis progress, errors…). */
  private rev = 0;
  private ids = 0;
  /** Bumped by clear(), so loads and analyses started before it are dropped. */
  private gen = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEmit = 0;
  private unprune: (() => void) | null = null;

  constructor(private readonly media: MediaStore) {
    this.watchPrunes();
  }

  /** Changes only with the masks (the paused preview redraws), not with analysis progress. */
  get version(): number {
    return this.maskVer;
  }

  /** Changes with everything subscribers are told about: the panels' snapshot. */
  get revision(): number {
    return this.rev;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Tell subscribers; `masks` when what maskAt returns changed too. */
  private emit(masks = false): void {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.lastEmit = performance.now();
    if (masks) this.maskVer++;
    this.rev++;
    this.listeners.forEach((fn) => fn());
  }

  /** Emit, at most every EMIT_MS (job progress). */
  private emitSoon(): void {
    if (this.emitTimer) return;
    const wait = Math.max(0, EMIT_MS - (performance.now() - this.lastEmit));
    this.emitTimer = setTimeout(() => this.emit(), wait);
  }

  // ─── Analysis ──────────────────────────────────────────────────────────────

  info(layer: Layer): SubjectInfo {
    const none: SubjectInfo = { status: 'none', frames: 0, from: 0, to: 0 };
    if (!SEPARABLE_KINDS.includes(layer.kind)) return none;
    if (layer.kind === 'webcam') {
      const l = this.live.get(layer.id)?.sub;
      // Only this method's own masks count (another's last one shows until its first), and its model's download.
      const own = !!l?.seq;
      const job = !own && l?.job ? l.job : null;
      return {
        ...none,
        status: l?.error ? 'error' : 'live',
        frames: own ? 1 : 0,
        backend: own ? l?.backend || undefined : undefined,
        error: l?.error ?? undefined,
        ...(job && {
          job: {
            phase: job.phase === 'download' ? 'download' : 'init',
            progress: 0,
            loaded: job.loaded,
            total: job.total,
          },
        }),
      };
    }
    if (layer.subject?.on) this.lazyLoad(layer);
    this.resave(layer.id);
    const held = this.held.get(layer.id);
    const duration = this.durationOf(layer);
    const want = duration !== null ? wantedMeta(layer, duration, this.canvasDuration) : null;
    let out = none;
    if (held && want) {
      const fit = sequenceFit(held.seq.meta, want);
      if (fit !== 'other-media') {
        const { seq } = held;
        out = {
          status: fit === 'current' ? 'ready' : 'stale',
          frames: seq.frames.length,
          from: seq.meta.from,
          to: seq.meta.to,
          backend: seq.backend,
          ms: seq.ms,
          ...(fit === 'stale' && { reason: staleReason(seq.meta, want) }),
        };
      }
    }
    const job = this.jobs.get(layer.id);
    if (job) {
      const short = !!job.range && !!want && !covers(job.range, want);
      return { ...out, status: 'running', job: job.job, reason: short ? 'range' : undefined };
    }
    // A failure stands until the settings it was about change (another method, the object tracked…).
    const error = this.errors.get(layer.id);
    return error && error.key === this.analysisKey(layer) ? { ...out, status: 'error', error: error.message } : out;
  }

  async analyze(layer: Layer): Promise<AnalysisOutcome> {
    this.cancel(layer.id);
    if (layer.kind === 'webcam' || !SEPARABLE_KINDS.includes(layer.kind)) return 'cancelled';
    const gen = this.gen;
    const entry: Job = {
      ctrl: new AbortController(),
      job: { phase: 'analyse', progress: 0 },
      key: this.analysisKey(layer),
      range: null,
    };
    this.jobs.set(layer.id, entry);
    this.errors.delete(layer.id);
    // Any analysis that starts ends a Stop's hold.
    this.stopped.delete(layer.id);
    this.emit();
    const current = () => this.jobs.get(layer.id) === entry && gen === this.gen;
    try {
      // Saved masks on their way back from IndexedDB may already fit: then there's nothing to do.
      const pending = this.loading.get(layer.id);
      if (pending) {
        await pending;
        if (!current()) return 'cancelled';
        const held = this.held.get(layer.id);
        const d = this.durationOf(layer);
        if (held && d !== null && sequenceFit(held.seq.meta, wantedMeta(layer, d, this.canvasDuration)) === 'current')
          return 'done';
      }
      const duration = this.durationOf(layer);
      entry.range = duration !== null ? analysisRange(layer, duration, this.canvasDuration) : null;
      const seq = await analyzeSubject(
        layer,
        this.canvasDuration,
        this.media,
        (job) => {
          if (!current()) return;
          entry.job = job;
          this.emitSoon();
        },
        entry.ctrl.signal,
      );
      if (!current()) return 'cancelled';
      this.install(layer.id, seq, true);
      return 'done';
    } catch (e) {
      if (!current() || isAbort(e) || entry.ctrl.signal.aborted) return 'cancelled';
      this.errors.set(layer.id, { message: message(e), key: this.analysisKey(layer) });
      return 'failed';
    } finally {
      if (this.jobs.get(layer.id) === entry) {
        this.jobs.delete(layer.id);
        this.emit();
      }
    }
  }

  cancel(layerId: string): void {
    const job = this.jobs.get(layerId);
    if (!job) return;
    job.ctrl.abort();
    this.jobs.delete(layerId);
    this.emit();
  }

  /**
   * The user's Stop: cancel, and hold (stoppedHere) while the layer wants
   * what it wanted then, so nothing restarts the analysis by itself for that.
   */
  stop(layer: Layer): void {
    this.stopped.set(layer.id, this.wantKey(layer));
    this.cancel(layer.id);
  }

  /** Whether the analysis was stopped (Stop) for what the layer wants now. */
  stoppedHere(layer: Layer): boolean {
    return this.stopped.get(layer.id) === this.wantKey(layer);
  }

  /**
   * Keep up with the project after every change: analyses it no longer wants
   * stop (undo / redo can remove a layer, switch its subject off or restore
   * other settings), and what's wanted follows the canvas's length.
   */
  sync(project: Project): void {
    for (const [id, j] of this.jobs) {
      const l = project.layers.find((x) => x.id === id);
      if (!l?.subject?.on || this.analysisKey(l) !== j.key) this.cancel(id);
    }
    // Webcams whose separation is off, or that are gone: stop, dropping the request in flight (and a model
    // download only it waited on). One only not drawn for now stops by itself (watchLive) and lets it finish.
    for (const [id, l] of this.live) {
      const layer = project.layers.find((x) => x.id === id);
      if (layer?.kind === 'webcam' && layer.subject?.on) continue;
      l.sub.stop();
      this.live.delete(id);
    }
    if (project.canvas.duration !== this.canvasDuration) {
      this.canvasDuration = project.canvas.duration;
      this.emit();
    }
  }

  copy(fromLayerId: string, to: Layer): void {
    const held = this.held.get(fromLayerId);
    if (!held || held.seq.meta.kind !== to.kind) return;
    const media = to.kind === 'sample' ? 'sample' : (to.mediaId ?? held.seq.meta.media);
    this.install(to.id, { ...held.seq, meta: { ...held.seq.meta, media } }, true);
  }

  async restore(project: Project): Promise<void> {
    const gen = this.gen;
    const layers = project.layers.filter(
      (l) => l.subject?.on && l.kind !== 'webcam' && SEPARABLE_KINDS.includes(l.kind),
    );
    await Promise.all(layers.map((l) => this.load(l, gen)));
  }

  clear(): void {
    this.reset();
    this.emit(true);
  }

  /** Stops everything; the store still works if used again (StrictMode disposes it once and carries on in development). */
  dispose(): void {
    this.reset();
    this.unprune?.();
    this.unprune = null;
    this.listeners.clear();
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
  }

  private reset(): void {
    this.gen++;
    this.jobs.forEach((j) => j.ctrl.abort());
    this.jobs.clear();
    this.live.forEach((l) => l.sub.stop());
    this.live.clear();
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = null;
    this.held.clear();
    this.errors.clear();
    this.stopped.clear();
    this.finished.clear();
    this.last.clear();
    this.saved.clear();
    this.tried.clear();
    this.loading.clear();
  }

  /** Hear which saved masks get pruned (so they're saved again if their layer comes back). */
  private watchPrunes(): void {
    this.unprune ??= onMasksPruned((layerIds) => layerIds.forEach((id) => this.saved.delete(id)));
  }

  private install(layerId: string, seq: MaskSequence, persist: boolean): void {
    this.watchPrunes();
    this.held.set(layerId, { id: ++this.ids, seq });
    this.last.delete(layerId);
    this.tried.add(layerId);
    this.saved.add(layerId);
    if (persist) void saveMasks(layerId, toRecord(seq));
    this.emit(true);
  }

  /** Bring back a layer's saved masks (see loadNow), noting the lookup while it's under way. */
  private load(layer: Layer, gen: number): Promise<void> {
    const p: Promise<void> = this.loadNow(layer, gen).finally(() => {
      if (this.loading.get(layer.id) === p) this.loading.delete(layer.id);
    });
    this.loading.set(layer.id, p);
    return p;
  }

  /** Bring back a layer's saved masks, if they were made for its media and nothing newer is held. Never rejects. */
  private async loadNow(layer: Layer, gen: number): Promise<void> {
    this.tried.add(layer.id);
    const raw = await loadMasks(layer.id);
    if (raw === undefined || gen !== this.gen || this.held.has(layer.id)) return;
    const rec = await readRecord(raw).catch(() => null);
    if (gen !== this.gen || this.held.has(layer.id)) return;
    const seq = parseSequence(rec);
    if (!seq) {
      void deleteMasks(layer.id);
      return;
    }
    if (seq.meta.media !== this.mediaKey(layer) || seq.meta.kind !== layer.kind) return;
    this.install(layer.id, seq, false);
  }

  /** Saved masks of a removed layer get pruned; when undo brings the layer back, save them again. */
  private resave(layerId: string): void {
    const held = this.held.get(layerId);
    if (!held || this.saved.has(layerId)) return;
    this.saved.add(layerId);
    void saveMasks(layerId, toRecord(held.seq));
  }

  private lazyLoad(layer: Layer): void {
    if (this.tried.has(layer.id) || this.held.has(layer.id) || this.jobs.has(layer.id)) return;
    void this.load(layer, this.gen);
  }

  // ─── Masks for the renderer ────────────────────────────────────────────────

  maskAt(layer: Layer, _project: Project, t: number): LayerMask | null {
    return this.maskIn(this.held, layer, t);
  }

  /**
   * The masks as they are now, for an export: an analysis that lands while
   * it renders doesn't switch the file to new masks partway through (the
   * webcam stays live).
   */
  snapshot(): MaskSource {
    const held = new Map(this.held);
    return { version: this.maskVer, maskAt: (l, _p, t) => this.maskIn(held, l, t) };
  }

  /** The layer's mask at t, from these held masks (the store's own, or a snapshot's). */
  private maskIn(from: Map<string, Held>, layer: Layer, t: number): LayerMask | null {
    const held = from.get(layer.id);
    this.resave(layer.id);
    const s = layer.subject;
    if (!s?.on || !SEPARABLE_KINDS.includes(layer.kind)) return null;
    if (layer.kind === 'webcam') return this.liveMask(layer, s);
    if (!held) {
      if (from === this.held) this.lazyLoad(layer);
      return null;
    }
    if (held.seq.meta.media !== this.mediaKey(layer) || held.seq.meta.kind !== layer.kind) return null;
    const picture = this.pictureOf(layer);
    if (!picture) return null;

    let mt = 0;
    if (layer.kind === 'sample') mt = sampleTime(layer, t);
    else if (layer.kind === 'video') {
      const d = this.media.get(layer.mediaId)?.duration ?? held.seq.meta.to;
      mt = mediaTime(layer, t, d) ?? d;
    }
    const { i, j, k } = maskIndex(held.seq, mt);
    const fk = finishKey(s, picture);
    const key = `${held.id}:${i}:${j}:${k}:${fk}`;
    const last = this.last.get(layer.id);
    if (last?.key === key) return last.mask;
    const a = this.frame(held, i, s, picture, fk);
    const mask: LayerMask = {
      a,
      b: j === i ? a : this.frame(held, j, s, picture, fk),
      mix: k,
      outside: s.invert ? 1 : 0,
    };
    this.last.set(layer.id, { key, mask });
    return mask;
  }

  /** Mask i of a sequence, finalized with the layer's settings (cached). */
  private frame(held: Held, i: number, s: SubjectSettings, picture: [number, number], fk: string): MaskFrame {
    const version = `m${held.id}:${i}:${fk}`;
    const hit = this.finished.get(version);
    if (hit) {
      this.finished.delete(version);
      this.finished.set(version, hit);
      return hit;
    }
    const frames = held.seq.frames;
    const raw = frames[i]!;
    const data = finalizeFrame(raw, s.steady ? [frames[i - 1], frames[i + 1]] : [], s, picture);
    const frame: MaskFrame = { width: raw.width, height: raw.height, data, rect: raw.rect, version };
    this.finished.set(version, frame);
    while (this.finished.size > FINISHED_CAP) this.finished.delete(this.finished.keys().next().value!);
    return frame;
  }

  private liveMask(layer: Layer, s: SubjectSettings): LayerMask | null {
    const m = this.media.get(layer.mediaId);
    if (!m || !(m.el instanceof HTMLVideoElement)) return null;
    let live = this.live.get(layer.id);
    /** The same webcam's separation by another method, whose last mask shows until the new one's first. */
    let before: LiveSubject | null = null;
    // Another webcam, or another method: start afresh (a request of the old method may still be waiting on a
    // model download, which the new one mustn't wait behind).
    if (live && (live.mediaId !== m.id || live.sub.method !== s.method)) {
      live.sub.stop();
      this.live.delete(layer.id);
      if (live.mediaId === m.id) before = live.sub;
      live = undefined;
    }
    if (!live) {
      let said = '';
      const sub = new LiveSubject(layer.id, m.el, s.method, (what) => {
        // The model downloading or starting: the panel says so (until the first mask).
        if (what === 'progress') return this.emitSoon();
        // A new mask changes what maskAt returns (the Viewport polls the version); the first mask,
        // a new backend or an error changes what the panel says, so tell subscribers then.
        if (what === 'mask') this.maskVer++;
        const now = `${sub.latest ? 1 : 0}|${sub.backend}|${sub.error ?? ''}`;
        if (what === 'error' || now !== said) {
          said = now;
          this.emit();
        }
      });
      sub.latest = before?.latest ?? null;
      sub.previous = before?.previous ?? null;
      live = { id: ++this.ids, sub, mediaId: m.id, wanted: 0 };
      this.live.set(layer.id, live);
      sub.start();
      this.watchLive();
      // The panel says what this one is doing (deferred: this runs while drawing).
      this.emitSoon();
    }
    live.wanted = performance.now();
    const raw = live.sub.latest;
    if (!raw) return null;
    const picture: [number, number] = [m.width, m.height];
    const version = `l${live.id}:${live.sub.seq}:${finishKey(s, picture)}`;
    const last = this.last.get(layer.id);
    if (last?.key === version) return last.mask;
    const data = finalizeFrame(raw, s.steady ? [live.sub.previous] : [], s, picture);
    const frame: MaskFrame = { width: raw.width, height: raw.height, data, rect: raw.rect, version };
    const mask: LayerMask = { a: frame, b: frame, mix: 0, outside: s.invert ? 1 : 0 };
    this.last.set(layer.id, { key: version, mask });
    return mask;
  }

  /** Stop live separation nothing draws any more. */
  private watchLive(): void {
    if (this.liveTimer) return;
    this.liveTimer = setInterval(() => {
      const now = performance.now();
      for (const [id, l] of this.live) {
        // A background tab draws nothing but still has the webcam: keep it (and a model download under way).
        if (document.hidden) l.wanted = now;
        if (now - l.wanted < LIVE_IDLE_MS) continue;
        // Hidden or out of its time for now: its model download (if any) carries on for when it shows again.
        l.sub.stop(false);
        this.live.delete(id);
      }
      if (!this.live.size && this.liveTimer) {
        clearInterval(this.liveTimer);
        this.liveTimer = null;
      }
    }, LIVE_IDLE_MS / 2);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** The settings an analysis of the layer depends on (not the range: trimming doesn't undo a failure). */
  analysisKey(layer: Layer): string {
    const m = wantedMeta(layer, this.durationOf(layer) ?? 0);
    return `${m.media}|${m.kind}|${m.method}|${m.area}|${m.rate}|${m.track}`;
  }

  /** Those settings and the media seconds that show (analysisRange): everything the layer's masks must fit. */
  private wantKey(layer: Layer): string {
    const d = this.durationOf(layer);
    const r = d === null ? null : analysisRange(layer, d, this.canvasDuration);
    return `${this.analysisKey(layer)}|${r ? `${r.from}|${r.to}` : '?'}`;
  }

  /** What a sequence's meta.media must be for the layer's current media. */
  private mediaKey(layer: Layer): string {
    return layer.kind === 'sample' ? 'sample' : (layer.mediaId ?? '');
  }

  private durationOf(layer: Layer): number | null {
    if (layer.kind === 'sample') return SAMPLE_DURATION;
    if (layer.kind === 'image') return 0;
    return this.media.get(layer.mediaId)?.duration ?? null;
  }

  private pictureOf(layer: Layer): [number, number] | null {
    if (layer.kind === 'sample') return SAMPLE_SIZE;
    const m = this.media.get(layer.mediaId);
    return m ? [m.width, m.height] : null;
  }
}
