import { analyzePixels, rasterize, type CellSample } from './analyze';
import { buildCells, toneMap, toText } from './cells';
import { mulberry32 } from './color';
import { buildAtlas, resolveRamp, STAR_GLYPHS } from './glyphs';
import { computeLayout, type GridLayout } from './layout';
import { AsciiRenderer, type CompositeMode, type RenderParams, type Star } from './renderer';
import { cellCoverage } from '../segment/refine';
import { type SourceImage } from '../image';
import { type Settings } from '../settings';

export interface EngineStats {
  cols: number;
  rows: number;
}

export interface FinalMask {
  data: Uint8Array;
  width: number;
  height: number;
}

const MAX_STARS = 15;
const TAU = Math.PI * 2;

/**
 * Glue between the page and the renderer: works out the grid for the
 * current stage size and settings, re-analyses the picture only when the grid
 * changes, rebuilds cell data only when colour settings or the mask change,
 * and runs the animation loop (paused while the tab is hidden).
 */
export class AsciiEngine {
  private readonly renderer: AsciiRenderer;
  private settings: Settings;
  private image: SourceImage | null = null;
  private mask: FinalMask | null = null;
  private stageW = 0;
  private stageH = 0;
  private dpr = 1;

  private layout: GridLayout | null = null;
  private sample: CellSample | null = null;
  private ramp: string[] = [];
  private rampKey = '';
  private atlasKey = '';
  private coverage: Float32Array | null = null;
  private cellsKey = '';
  private sampleVersion = 0;
  private maskVersion = 0;
  private stars: Star[] = [];
  private cellMask: Float32Array | null = null;

  private dirty = true;
  private needsDraw = true;
  private running = false;
  private rafId = 0;
  private lastFrame = 0;
  private animTime = 0;
  private energy = 0;
  private targetEnergy = 0;
  private seed = Math.floor(Math.random() * 2 ** 31);

  onStats?: (s: EngineStats) => void;

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.renderer = new AsciiRenderer(canvas);
    this.settings = settings;
  }

  setImage(image: SourceImage | null): void {
    if (image === this.image) return;
    this.image = image;
    this.renderer.setPhoto(image?.canvas ?? null, image?.width, image?.height);
    this.layout = null;
    this.sample = null;
    this.invalidate();
  }

  setMask(mask: FinalMask | null): void {
    this.mask = mask;
    this.renderer.setMask(mask?.data ?? null, mask?.width ?? 0, mask?.height ?? 0);
    this.cellMask = null;
    this.maskVersion++;
    this.invalidate();
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.invalidate();
  }

  resize(width: number, height: number, dpr: number): void {
    if (width <= 0 || height <= 0) return;
    if (width === this.stageW && height === this.stageH && dpr === this.dpr) return;
    this.stageW = width;
    this.stageH = height;
    this.dpr = dpr;
    this.renderer.resize(width, height, dpr);
    this.invalidate();
  }

  /** 0 = calm, 1 = excited (a file is dragged over the page). Eased over ~½ s. */
  setEnergy(energy: number): void {
    this.targetEnergy = Math.max(0, Math.min(1, energy));
    this.needsDraw = true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
  }

  get stats(): EngineStats | null {
    return this.layout ? { cols: this.layout.cols, rows: this.layout.rows } : null;
  }

  private invalidate(): void {
    this.dirty = true;
    this.needsDraw = true;
  }

  // ─── State → renderer ────────────────────────────────────────────────────

  private mode(): CompositeMode {
    const s = this.settings;
    if (!s.separate || !this.mask) return 0;
    return s.composition === 'subject' ? 1 : s.composition === 'subject-on-photo' ? 2 : 3;
  }

  private params(): RenderParams {
    const s = this.settings;
    return {
      waveAmp: s.wave ? s.waveAmplitude : 0,
      waveScale: s.waveScale,
      bands: s.bands,
      sparkle: s.sparkle,
      glyphGlow: s.glyphGlow,
      density: s.density,
      edges: s.edges,
      bloom: s.bloom,
      bloomIntensity: s.bloomIntensity,
      bloomRadius: s.bloomRadius,
      bloomThreshold: s.bloomThreshold,
      mode: this.mode(),
      photoUnder: s.photoUnder,
      bgDim: s.bgDim,
      bgBlur: s.bgBlur,
    };
  }

  private flush(): void {
    this.dirty = false;
    const { image, settings: s } = this;
    if (!image || this.stageW <= 0) return;

    const padding = Math.min(this.stageW, this.stageH) < 600 ? 12 : 32;
    const layout = computeLayout(this.stageW, this.stageH, image.width, image.height, s.charSize, padding);
    const prev = this.layout;
    const gridChanged = !prev || prev.cols !== layout.cols || prev.rows !== layout.rows || prev.cellH !== layout.cellH;
    this.layout = layout;
    this.renderer.setLayout(layout);

    const rampKey = `${s.glyphSet}:${s.glyphSet === 'custom' ? s.customGlyphs : ''}`;
    if (rampKey !== this.rampKey) {
      this.ramp = resolveRamp(s.glyphSet, s.customGlyphs);
      this.rampKey = rampKey;
    }
    const atlasKey = `${rampKey}:${layout.cellH}:${this.dpr}`;
    if (atlasKey !== this.atlasKey) {
      const atlas = buildAtlas(this.ramp, layout.cellW, layout.cellH, this.dpr);
      if (atlas) this.renderer.setAtlas(atlas);
      this.atlasKey = atlasKey;
    }

    if (gridChanged || !this.sample) {
      const px = rasterize(image.canvas, layout.cols, layout.rows);
      if (!px) return;
      this.sample = analyzePixels(px.data, layout.cols, layout.rows, px.sx, px.sy);
      this.sampleVersion++;
      this.cellMask = null;
    }
    const sample = this.sample;

    // Which cells get glyphs.
    const mode = this.mode();
    if (mode !== 0 && this.mask && !this.cellMask) {
      this.cellMask = cellCoverage(this.mask.data, this.mask.width, this.mask.height, layout.cols, layout.rows);
    }
    const coverage = Float32Array.from(sample.alpha);
    if (mode !== 0 && this.cellMask) {
      for (let i = 0; i < coverage.length; i++) {
        coverage[i]! *= mode === 3 ? 1 - this.cellMask[i]! : this.cellMask[i]!;
      }
    }
    this.coverage = coverage;

    const cellsKey = JSON.stringify([
      this.sampleVersion,
      this.maskVersion,
      mode,
      s.colorMode,
      s.paletteSize,
      s.monoColor,
      s.autoTone,
      s.brightness,
      s.contrast,
      s.saturation,
    ]);
    if (cellsKey !== this.cellsKey) {
      this.renderer.setCells(buildCells(sample, coverage, s, this.seed));
      this.cellsKey = cellsKey;
    }

    this.stars = mode === 1 && s.stars ? this.placeStars(layout, coverage) : [];
    this.renderer.setStars(this.stars);
    this.renderer.setParams(this.params());
    this.onStats?.({ cols: layout.cols, rows: layout.rows });
  }

  /** The original's 9–15 dim stars, kept away from the subject. */
  private placeStars(layout: GridLayout, coverage: Float32Array): Star[] {
    const rand = mulberry32(this.seed);
    const w = this.stageW;
    const h = this.stageH;
    const target = 9 + Math.floor(rand() * (MAX_STARS - 9 + 1));
    const minDist = Math.max(90, 0.24 * Math.sqrt(w * h));
    const edge = 20;
    const near = (x: number, y: number) => {
      const col = Math.floor((x - layout.x) / layout.cellW);
      const row = Math.floor((y - layout.y) / layout.cellH);
      for (let r = row - 3; r <= row + 3; r++) {
        if (r < 0 || r >= layout.rows) continue;
        for (let c = col - 3; c <= col + 3; c++) {
          if (c < 0 || c >= layout.cols) continue;
          if (coverage[r * layout.cols + c]! > 0.01) return true;
        }
      }
      return false;
    };
    const stars: Star[] = [];
    for (let attempt = 0; attempt < 800 && stars.length < target; attempt++) {
      const x = edge + rand() * (w - edge * 2);
      const y = edge + rand() * (h - edge * 2);
      if (near(x, y)) continue;
      if (stars.some((st) => (st.x - x) ** 2 + (st.y - y) ** 2 < minDist * minDist)) continue;
      stars.push({
        x,
        y,
        glyph: Math.floor(rand() * STAR_GLYPHS.length),
        base: 0.24 + rand() * 0.04,
        amp: 0.04 + rand() * 0.05,
        period: 3 + rand() * 6,
        phase: rand() * TAU,
      });
    }
    return stars;
  }

  // ─── Loop ────────────────────────────────────────────────────────────────

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    if (this.dirty) this.flush();
    const animate = this.settings.animate;
    const easing = Math.abs(this.targetEnergy - this.energy) > 0.001;
    if (easing) this.energy += (this.targetEnergy - this.energy) * Math.min(1, dt * 3);
    if (animate) this.animTime += dt * this.settings.waveSpeed * (1 + this.energy * 1.4);
    if (animate || easing || this.needsDraw) {
      this.needsDraw = false;
      this.renderer.render(this.animTime, now / 1000, animate, this.energy);
    }
  };

  // ─── Export ──────────────────────────────────────────────────────────────

  /** Render the picture area alone into a fresh canvas at `scale` device px per CSS px. */
  private offscreen(scale: number, preserve: boolean): { canvas: HTMLCanvasElement; renderer: AsciiRenderer } | null {
    if (this.dirty) this.flush();
    const { layout, image, sample, coverage } = this;
    if (!layout || !image || !sample || !coverage) return null;
    const w = layout.cols * layout.cellW;
    const h = layout.rows * layout.cellH;
    // Stay within what every GPU can allocate.
    const k = Math.min(scale, 8192 / Math.max(w, h), Math.sqrt(40e6 / (w * h)));
    const canvas = document.createElement('canvas');
    const renderer = new AsciiRenderer(canvas, { preserveDrawingBuffer: preserve });
    renderer.resize(w, h, k);
    const local = { ...layout, x: 0, y: 0 };
    renderer.setLayout(local);
    const atlas = buildAtlas(this.ramp, layout.cellW, layout.cellH, k);
    if (atlas) renderer.setAtlas(atlas);
    renderer.setCells(buildCells(sample, coverage, this.settings, this.seed));
    renderer.setPhoto(image.canvas, image.width, image.height);
    if (this.mask) renderer.setMask(this.mask.data, this.mask.width, this.mask.height);
    renderer.setStars(
      this.stars
        .map((st) => ({ ...st, x: st.x - layout.x, y: st.y - layout.y }))
        .filter((st) => st.x > 0 && st.y > 0 && st.x < w && st.y < h),
    );
    renderer.setParams(this.params());
    return { canvas, renderer };
  }

  async snapshot(scale: number): Promise<Blob> {
    const off = this.offscreen(scale, true);
    if (!off) throw new Error('Nothing to export yet.');
    try {
      off.renderer.render(this.animTime, performance.now() / 1000, this.settings.animate, 0);
      return await new Promise<Blob>((resolve, reject) =>
        off.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'),
      );
    } finally {
      off.renderer.dispose(true);
    }
  }

  /** Record `seconds` of animation as a video (WebM, or MP4 where that's all the browser records). */
  async record(seconds: number, onProgress: (f: number) => void): Promise<{ blob: Blob; ext: string }> {
    if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('This browser cannot record video.');
    const off = this.offscreen(Math.min(2, this.dpr), false);
    if (!off) throw new Error('Nothing to export yet.');
    const { canvas, renderer } = off;
    // Some browsers only capture canvases that are in the document.
    canvas.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
    document.body.append(canvas);
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

    const animate = this.settings.animate;
    let t = this.animTime;
    const start = performance.now();
    recorder.start(250);
    await new Promise<void>((resolve) => {
      let last = start;
      const tick = (now: number) => {
        const elapsed = (now - start) / 1000;
        if (animate) t += ((now - last) / 1000) * this.settings.waveSpeed;
        last = now;
        renderer.render(t, now / 1000, animate, 0);
        onProgress(Math.min(1, elapsed / seconds));
        if (elapsed >= seconds) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    recorder.stop();
    await done;
    stream.getTracks().forEach((tr) => tr.stop());
    renderer.dispose(true);
    canvas.remove();
    return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), ext: mimeType.includes('mp4') ? 'mp4' : 'webm' };
  }

  /** The grid as plain text. */
  text(): string {
    if (this.dirty) this.flush();
    const { sample, coverage } = this;
    if (!sample || !coverage) return '';
    return toText(sample, coverage, toneMap(sample, sample.alpha, this.settings), this.ramp);
  }
}
