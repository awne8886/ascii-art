import { mulberry32 } from '../ascii/color';
import { boxBlur, resizeBilinear } from './refine';

/**
 * No-download subject detection, for when the AI model can't be fetched or
 * the user prefers not to. It assumes what touches the frame is background:
 *
 * 1. Cluster the colours along the border (k-means in a Lab-like space).
 * 2. Score every pixel by its distance to the nearest border colour, with a
 *    mild centre prior.
 * 3. Otsu-threshold, keep the connected regions that matter, fill holes.
 *
 * Works well on product shots, portraits against a wall, a pet on a lawn;
 * cluttered scenes need the AI model.
 */
export function classicSaliency(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  // Work small: this is about regions, the guided filter restores the edges afterwards.
  const scale = Math.min(1, 200 / Math.max(width, height));
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  const lab = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) / w) * width));
      const sy = Math.min(height - 1, Math.floor(((y + 0.5) / h) * height));
      const p = (sy * width + sx) * 4;
      const [L, a, b] = roughLab(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!);
      const i = (y * w + x) * 3;
      lab[i] = L;
      lab[i + 1] = a;
      lab[i + 2] = b;
    }
  }

  // Border samples.
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const border: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < band || y < band || x >= w - band || y >= h - band) border.push(y * w + x);
    }
  }
  const centres = borderClusters(lab, border, 6);

  // Distance to the background model, normalised by its 95th percentile, times a centre prior.
  const score = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let best = Infinity;
      for (const c of centres) {
        const dL = lab[i * 3]! - c[0]!;
        const da = lab[i * 3 + 1]! - c[1]!;
        const db = lab[i * 3 + 2]! - c[2]!;
        best = Math.min(best, dL * dL * 0.6 + da * da + db * db);
      }
      const nx = (x + 0.5) / w - 0.5;
      const ny = (y + 0.5) / h - 0.5;
      score[i] = Math.sqrt(best) * (0.6 + 0.4 * Math.exp(-(nx * nx + ny * ny) / 0.12));
    }
  }
  const sorted = Float32Array.from(score).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)]! || 1;
  for (let i = 0; i < score.length; i++) score[i] = Math.min(1, score[i]! / p95);
  const smooth = boxBlur(score, w, h, 1);

  const t = otsu(smooth);
  let bin: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = smooth[i]! > t ? 1 : 0;
  bin = keepMainRegions(bin, w, h);
  fillHoles(bin, w, h);

  const soft = new Float32Array(w * h);
  for (let i = 0; i < soft.length; i++) soft[i] = bin[i]!;
  return resizeBilinear(boxBlur(soft, w, h, 1), w, h, width, height);
}

function roughLab(r: number, g: number, b: number): [number, number, number] {
  // Opponent colour space, close enough to Lab for clustering and cheap.
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return [L, (r - g) / 255, (0.5 * (r + g) - b) / 255];
}

function borderClusters(lab: Float32Array, idx: number[], k: number): number[][] {
  const rand = mulberry32(99);
  const centres: number[][] = [];
  for (let c = 0; c < k; c++) {
    const i = idx[Math.floor(rand() * idx.length)]!;
    centres.push([lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!]);
  }
  for (let it = 0; it < 8; it++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const i of idx) {
      let best = 0;
      let bestD = Infinity;
      centres.forEach((c, j) => {
        const d = (lab[i * 3]! - c[0]!) ** 2 + (lab[i * 3 + 1]! - c[1]!) ** 2 + (lab[i * 3 + 2]! - c[2]!) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      const s = sums[best]!;
      s[0]! += lab[i * 3]!;
      s[1]! += lab[i * 3 + 1]!;
      s[2]! += lab[i * 3 + 2]!;
      s[3]! += 1;
    }
    sums.forEach((s, j) => {
      if (s[3]! > 0) centres[j] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    });
  }
  return centres;
}

/** Otsu's threshold for values in 0–1. */
export function otsu(values: Float32Array): number {
  const BINS = 128;
  const hist = new Float64Array(BINS);
  for (const v of values) hist[Math.min(BINS - 1, Math.floor(v * BINS))]!++;
  let sumAll = 0;
  for (let i = 0; i < BINS; i++) sumAll += i * hist[i]!;
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let bestT = 0.5;
  for (let i = 0; i < BINS; i++) {
    wB += hist[i]!;
    if (wB === 0) continue;
    const wF = values.length - wB;
    if (wF === 0) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      bestT = (i + 1) / BINS;
    }
  }
  return bestT;
}

/** Keep the largest region and any region at least 15% of its size. */
function keepMainRegions(bin: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < bin.length; s++) {
    if (!bin[s] || label[s]! >= 0) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of next) {
        if (j >= 0 && bin[j] && label[j]! < 0) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  if (sizes.length === 0) return bin;
  const largest = Math.max(...sizes);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const l = label[i]!;
    if (l >= 0 && sizes[l]! >= largest * 0.15) out[i] = 1;
  }
  return out;
}

/** Background regions not connected to the frame's edge are holes in the subject. */
function fillHoles(bin: Uint8Array, w: number, h: number): void {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!bin[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  for (let i = 0; i < bin.length; i++) if (!outside[i]) bin[i] = 1;
}
