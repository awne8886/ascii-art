import { hexToRgb, mulberry32, type RGB } from './color';
import { type CellSample } from './analyze';
import { chromaHue, fromLch, rgbToOklab, type Lab } from './oklab';
import { deriveMaterial, kmeans } from './palette';
import { type ColorMode } from '../settings';

/** Bytes per cell in the instance buffer the renderer draws from. */
export const CELL_STRIDE = 16;

export interface ToneOptions {
  autoTone: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface ColorOptions extends ToneOptions {
  colorMode: ColorMode;
  paletteSize: number;
  monoColor: string;
}

/** Quantiles of weighted values in [0, 1], via a 1024-bin histogram (fast for hundreds of thousands of cells). */
export function weightedQuantiles(values: Float32Array, weights: Float32Array, qs: readonly number[]): number[] {
  const BINS = 1024;
  const hist = new Float64Array(BINS);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const w = weights[i]!;
    if (w <= 0) continue;
    hist[Math.min(BINS - 1, Math.max(0, Math.floor(values[i]! * BINS)))]! += w;
    total += w;
  }
  if (total <= 0) {
    for (let i = 0; i < values.length; i++) hist[Math.min(BINS - 1, Math.max(0, Math.floor(values[i]! * BINS)))]! += 1;
    total = values.length;
  }
  return qs.map((q) => {
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b]!;
      if (acc >= total * q) return (b + 0.5) / BINS;
    }
    return 1;
  });
}

/**
 * Per-cell Oklab colour after tone adjustments. Auto tone stretches the
 * visible cells' lightness between their 1st and 99th percentiles (at most
 * 3×, so a foggy photo stays foggy) and lifts a dark median half-way to
 * 0.45, so dark and washed-out photos still use the whole glyph ramp.
 */
export function toneMap(sample: CellSample, weights: Float32Array, opts: ToneOptions): Float32Array {
  const n = sample.cols * sample.rows;
  const lab = new Float32Array(n * 3);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = rgbToOklab([sample.rgb[i * 3]!, sample.rgb[i * 3 + 1]!, sample.rgb[i * 3 + 2]!]);
    L[i] = c[0];
    lab[i * 3 + 1] = c[1] * opts.saturation;
    lab[i * 3 + 2] = c[2] * opts.saturation;
  }

  // L' = (L - centre) * stretch + target
  let centre = 0.5;
  let stretch = 1;
  let target = 0.5;
  let gamma = 1;
  if (opts.autoTone) {
    const [p1, p50, p99] = weightedQuantiles(L, weights, [0.01, 0.5, 0.99]) as [number, number, number];
    const span = p99 - p1;
    centre = (p1 + p99) / 2;
    target = centre;
    if (span > 0.02) {
      stretch = Math.min(3, 0.94 / span);
      // A capped stretch expands around the range's middle, kept inside 0.03–0.97.
      const half = (span * stretch) / 2;
      target = Math.min(0.97 - half, Math.max(0.03 + half, centre));
    }
    // Lift dark pictures (median below 0.45) half-way towards it; never darken bright ones.
    const median = Math.min(0.97, Math.max(0.03, (p50 - centre) * stretch + target));
    if (median < 0.45) gamma = Math.max(0.5, Math.log(median + (0.45 - median) * 0.5) / Math.log(median));
  }

  for (let i = 0; i < n; i++) {
    let l = opts.autoTone ? Math.min(1, Math.max(0, (L[i]! - centre) * stretch + target)) ** gamma : L[i]!;
    l = (l - 0.5) * opts.contrast + 0.5 + opts.brightness * 0.5;
    lab[i * 3] = Math.min(1, Math.max(0, l));
  }
  return lab;
}

/**
 * Pack everything the vertex shader needs per cell into 16 bytes:
 *
 *   0–2 shadow RGB    3 tone (lightness 0–1)
 *   4–6 base RGB      7 coverage (0 = not drawn)
 *   8–10 highlight    11 random (flicker phase)
 *   12 lightness relative to the material (signed)   13 density bias + 8
 *   14 ramp floor     15 edge: 0 none, 1–4 orientation + 1
 */
export function buildCells(sample: CellSample, coverage: Float32Array, opts: ColorOptions, seed = 1): Uint8Array {
  const n = sample.cols * sample.rows;
  // Tone is measured on the whole picture, so the subject looks the same whichever part is shown.
  const lab = toneMap(sample, sample.alpha, opts);
  const out = new Uint8Array(n * CELL_STRIDE);
  const rand = mulberry32(seed ^ 0x5eed);

  const put = (o: number, c: RGB) => {
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
  };

  let assign: Uint8Array | null = null;
  let materials: ReturnType<typeof deriveMaterial>[] = [];
  let centroidL: number[] = [];
  if (opts.colorMode === 'palette') {
    const pal = kmeans(lab, coverage, opts.paletteSize);
    assign = pal.assignment;
    materials = pal.materials;
    centroidL = pal.centroids.map((c) => c[0]);
  }
  const tint = rgbToOklab(hexToRgb(opts.monoColor));
  const [tintC, tintH] = chromaHue(tint);

  for (let i = 0; i < n; i++) {
    const o = i * CELL_STRIDE;
    const cell: Lab = [lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!];
    const tone = cell[0];
    let rel = 0;
    let mat;
    if (assign) {
      const m = assign[i]!;
      mat = materials[m]!;
      rel = tone - centroidL[m]!;
    } else if (opts.colorMode === 'mono') {
      // Chroma fades towards black and white, like a real tinted monochrome.
      const c = tintC * Math.min(1, 4 * tone * (1 - tone) + 0.15);
      mat = deriveMaterial(fromLch(Math.max(0.12, tone), c, tintH));
    } else {
      mat = deriveMaterial(cell);
    }
    put(o, mat.shadow);
    out[o + 3] = Math.round(tone * 255);
    put(o + 4, mat.base);
    out[o + 7] = Math.round(Math.min(1, Math.max(0, coverage[i]!)) * 255);
    put(o + 8, mat.highlight);
    out[o + 11] = Math.floor(rand() * 256);
    out[o + 12] = Math.round(Math.min(1, Math.max(-1, rel * 2)) * 127.5 + 127.5);
    out[o + 13] = (assign ? mat.density - 1 : 0) + 8;
    out[o + 14] = Math.round(mat.floor * 255);
    const strong = sample.edgeStrength[i]! > 0.75 && sample.edgeCoherence[i]! > 0.6;
    out[o + 15] = strong ? sample.edgeDir[i]! + 1 : 0;
  }
  return out;
}

/** Plain-text version of the grid (for copying): one glyph per cell by lightness, blanks where nothing is drawn. */
export function toText(sample: CellSample, coverage: Float32Array, lab: Float32Array, ramp: readonly string[]): string {
  const lines: string[] = [];
  for (let row = 0; row < sample.rows; row++) {
    let line = '';
    for (let col = 0; col < sample.cols; col++) {
      const i = row * sample.cols + col;
      if (coverage[i]! < 0.12) {
        line += ' ';
        continue;
      }
      const g = Math.round(lab[i * 3]! * (ramp.length - 1));
      line += ramp[Math.max(0, Math.min(ramp.length - 1, g))] ?? ' ';
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}
