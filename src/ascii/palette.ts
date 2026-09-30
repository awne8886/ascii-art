import { mulberry32, type RGB } from './color';
import { chromaHue, fromLch, oklabToRgb, type Lab } from './oklab';

/**
 * "Materials", generalised from the pizza.
 *
 * The pizza renderer paints every glyph from a hand-made material (cheese,
 * pepperoni, crust…) with a shadow → base → highlight ramp, a density bias
 * (darker, more saturated materials get denser glyphs) and a brightness floor
 * (small important shapes never sink into a dark band). Here the same ramp is
 * derived for any colour, with constants fitted to those hand-made ramps in
 * Oklab: shadows lose lightness and chroma and warm towards red, highlights
 * gain lightness and warm towards yellow.
 */
export interface Material {
  shadow: RGB;
  base: RGB;
  highlight: RGB;
  /** Glyph density bias, like the original's (−1 … 3). */
  density: number;
  /** Minimum ramp position, 0–1. */
  floor: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Shadow / base / highlight for a base colour in Oklab. */
export function deriveMaterial(lab: Lab, floor = 0): Material {
  const [L] = lab;
  const [C, h] = chromaHue(lab);
  const warmShadow = h >= 30 && h <= 110 ? -clamp((h - 30) * 0.28, 0, 22) : 0;
  const warmHighlight = h >= 20 && h <= 110 ? clamp((h - 20) * 0.12, 0, 12) : 0;
  const shadow = fromLch(L * (0.38 + 0.26 * L), C * clamp(0.3 + 0.6 * L, 0.45, 0.95), h + warmShadow);
  const highlight = fromLch(L + (1 - L) * 0.4, C * 0.95, h + warmHighlight);
  return {
    shadow: oklabToRgb(shadow),
    base: oklabToRgb(lab),
    highlight: oklabToRgb(highlight),
    density: clamp(Math.round((0.85 - L) * 5.5 + (C - 0.13) * 5), -1, 3),
    floor,
  };
}

export interface Palette {
  centroids: Lab[];
  materials: Material[];
  /** Nearest centroid per input colour. */
  assignment: Uint8Array;
}

function dist(lab: Float32Array, i: number, c: Lab): number {
  const dL = lab[i * 3]! - c[0];
  const da = lab[i * 3 + 1]! - c[1];
  const db = lab[i * 3 + 2]! - c[2];
  return dL * dL + da * da + db * db;
}

/**
 * Weighted k-means (k-means++ seeding, deterministic) over Oklab colours,
 * 3 floats per entry. Entries with weight 0 are still assigned but don't
 * pull the centroids.
 */
export function kmeans(lab: Float32Array, weights: Float32Array, k: number, seed = 7, iterations = 10): Palette {
  const n = weights.length;
  const rand = mulberry32(seed);
  // Work on a subsample for speed; assign everything at the end.
  const stride = Math.max(1, Math.floor(n / 24000));
  const idx: number[] = [];
  for (let i = 0; i < n; i += stride) if (weights[i]! > 0.05) idx.push(i);
  if (idx.length === 0) for (let i = 0; i < n; i += stride) idx.push(i);
  k = Math.max(1, Math.min(k, idx.length));

  const centroids: Lab[] = [];
  const first = idx[Math.floor(rand() * idx.length)]!;
  centroids.push([lab[first * 3]!, lab[first * 3 + 1]!, lab[first * 3 + 2]!]);
  const d2 = new Float32Array(idx.length).fill(Infinity);
  while (centroids.length < k) {
    const c = centroids[centroids.length - 1]!;
    let total = 0;
    for (let j = 0; j < idx.length; j++) {
      d2[j] = Math.min(d2[j]!, dist(lab, idx[j]!, c));
      total += d2[j]! * weights[idx[j]!]!;
    }
    if (total <= 0) break;
    let pick = rand() * total;
    let chosen = idx[idx.length - 1]!;
    for (let j = 0; j < idx.length; j++) {
      pick -= d2[j]! * weights[idx[j]!]!;
      if (pick <= 0) {
        chosen = idx[j]!;
        break;
      }
    }
    centroids.push([lab[chosen * 3]!, lab[chosen * 3 + 1]!, lab[chosen * 3 + 2]!]);
  }

  const nearest = (i: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const d = dist(lab, i, centroids[c]!);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  for (let it = 0; it < iterations; it++) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (const i of idx) {
      const s = sums[nearest(i)]!;
      const w = Math.max(weights[i]!, 1e-3);
      s[0]! += lab[i * 3]! * w;
      s[1]! += lab[i * 3 + 1]! * w;
      s[2]! += lab[i * 3 + 2]! * w;
      s[3]! += w;
    }
    let moved = 0;
    sums.forEach((s, c) => {
      if (s[3]! <= 0) return;
      const next: Lab = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
      const old = centroids[c]!;
      moved += Math.abs(next[0] - old[0]) + Math.abs(next[1] - old[1]) + Math.abs(next[2] - old[2]);
      centroids[c] = next;
    });
    if (moved < 1e-4) break;
  }

  const assignment = new Uint8Array(n);
  const share = new Float32Array(centroids.length);
  let totalW = 0;
  for (let i = 0; i < n; i++) {
    const c = nearest(i);
    assignment[i] = c;
    share[c]! += weights[i]!;
    totalW += weights[i]!;
  }

  // Small, colourful clusters are the pepperoni and basil of a photo: give them a floor so they stay lit.
  const materials = centroids.map((c, i) => {
    const [C] = chromaHue(c);
    const small = totalW > 0 && share[i]! / totalW < 0.05;
    return deriveMaterial(c, small && C > 0.08 ? 0.5 : 0);
  });
  return { centroids, materials, assignment };
}
