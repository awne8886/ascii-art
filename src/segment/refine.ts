/**
 * Mask maths shared by the worker (turning a model's low-resolution guess
 * into an edge-aware mask) and the page (threshold, softness, grow/shrink,
 * invert, and per-cell coverage). Pure functions over typed arrays.
 */

export interface SoftMask {
  width: number;
  height: number;
  /** Subject probability per pixel, 0–1. */
  data: Float32Array;
}

export function resizeBilinear(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const kx = sw / dw;
  const ky = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.max(0, Math.min(sh - 1, (y + 0.5) * ky - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, Math.min(sw - 1, (x + 0.5) * kx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const top = src[y0 * sw + x0]! * (1 - tx) + src[y0 * sw + x1]! * tx;
      const bottom = src[y1 * sw + x0]! * (1 - tx) + src[y1 * sw + x1]! * tx;
      out[y * dw + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** Mean over a (2r+1)² window, clamped at the borders. O(1) per pixel whatever the radius. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const line = new Float64Array(Math.max(w, h) + 1);
  const pass = (from: Float32Array, to: Float32Array, len: number, lines: number, step: number, lineStep: number) => {
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      line[0] = 0;
      for (let i = 0; i < len; i++) line[i + 1] = line[i]! + from[base + i * step]!;
      for (let i = 0; i < len; i++) {
        const a = Math.max(0, i - r);
        const b = Math.min(len - 1, i + r);
        to[base + i * step] = (line[b + 1]! - line[a]!) / (b - a + 1);
      }
    }
  };
  pass(src, tmp, w, h, 1, w);
  pass(tmp, out, h, w, w, 1);
  return out;
}

/**
 * Colour-guided filter (He et al.): the output follows the mask `p` but its
 * edges snap to edges in the RGB guide, which turns a blurry 320 px model
 * mask into one that hugs the subject at full resolution.
 */
export function guidedFilter(
  rgba: Uint8ClampedArray,
  p: Float32Array,
  w: number,
  h: number,
  r: number,
  eps: number,
): Float32Array {
  const n = w * h;
  const I = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
  for (let i = 0; i < n; i++) {
    I[0][i] = rgba[i * 4]! / 255;
    I[1][i] = rgba[i * 4 + 1]! / 255;
    I[2][i] = rgba[i * 4 + 2]! / 255;
  }
  const mul = (a: Float32Array, b: Float32Array) => {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = a[i]! * b[i]!;
    return o;
  };
  const box = (a: Float32Array) => boxBlur(a, w, h, r);

  const mI = I.map(box);
  const mP = box(p);
  const mIp = I.map((c) => box(mul(c, p)));
  const pairs: Array<[number, number]> = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 1],
    [1, 2],
    [2, 2],
  ];
  const mII = pairs.map(([a, b]) => box(mul(I[a]!, I[b]!)));

  const A = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m0 = mI[0]![i]!;
    const m1 = mI[1]![i]!;
    const m2 = mI[2]![i]!;
    const mp = mP[i]!;
    // Covariance of the guide (3×3, symmetric) plus eps·I.
    const s00 = mII[0]![i]! - m0 * m0 + eps;
    const s01 = mII[1]![i]! - m0 * m1;
    const s02 = mII[2]![i]! - m0 * m2;
    const s11 = mII[3]![i]! - m1 * m1 + eps;
    const s12 = mII[4]![i]! - m1 * m2;
    const s22 = mII[5]![i]! - m2 * m2 + eps;
    const c0 = mIp[0]![i]! - m0 * mp;
    const c1 = mIp[1]![i]! - m1 * mp;
    const c2 = mIp[2]![i]! - m2 * mp;
    // Inverse via the adjugate.
    const i00 = s11 * s22 - s12 * s12;
    const i01 = s02 * s12 - s01 * s22;
    const i02 = s01 * s12 - s02 * s11;
    const i11 = s00 * s22 - s02 * s02;
    const i12 = s01 * s02 - s00 * s12;
    const i22 = s00 * s11 - s01 * s01;
    const det = s00 * i00 + s01 * i01 + s02 * i02;
    const inv = det !== 0 ? 1 / det : 0;
    const a0 = (c0 * i00 + c1 * i01 + c2 * i02) * inv;
    const a1 = (c0 * i01 + c1 * i11 + c2 * i12) * inv;
    const a2 = (c0 * i02 + c1 * i12 + c2 * i22) * inv;
    A[0][i] = a0;
    A[1][i] = a1;
    A[2][i] = a2;
    B[i] = mp - a0 * m0 - a1 * m1 - a2 * m2;
  }
  const mA = A.map(box);
  const mB = box(B);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mA[0]![i]! * I[0][i]! + mA[1]![i]! * I[1][i]! + mA[2]![i]! * I[2][i]! + mB[i]!;
    q[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return q;
}

export interface MaskOptions {
  threshold: number;
  softness: number;
  /** Grow (+) / shrink (−) in % of the longer side. */
  expand: number;
  invert: boolean;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Threshold, soften, grow/shrink and invert a soft mask into bytes. */
export function finalizeMask(mask: SoftMask, opts: MaskOptions): Uint8Array {
  const { width: w, height: h } = mask;
  const half = Math.max(0.01, opts.softness / 2);
  let m = new Float32Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = smoothstep(opts.threshold - half, opts.threshold + half, mask.data[i]!);

  if (Math.abs(opts.expand) > 0.01) {
    // Blur, then re-threshold low (grow) or high (shrink): a cheap, smooth stand-in for dilate / erode.
    const r = Math.max(1, Math.round((Math.abs(opts.expand) / 100) * Math.max(w, h) * 0.75));
    const b = boxBlur(boxBlur(m, w, h, r), w, h, r);
    const level = opts.expand > 0 ? 0.12 : 0.88;
    m = new Float32Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = smoothstep(level - 0.1, level + 0.1, b[i]!);
  }

  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const v = opts.invert ? 1 - m[i]! : m[i]!;
    out[i] = Math.round(v * 255);
  }
  return out;
}

/** Average mask value over each character cell (a 4×4 grid of samples per cell). */
export function cellCoverage(mask: Uint8Array, mw: number, mh: number, cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows);
  const S = 4;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0;
      for (let sy = 0; sy < S; sy++) {
        const y = Math.min(mh - 1, Math.floor(((row + (sy + 0.5) / S) / rows) * mh));
        for (let sx = 0; sx < S; sx++) {
          const x = Math.min(mw - 1, Math.floor(((col + (sx + 0.5) / S) / cols) * mw));
          sum += mask[y * mw + x]!;
        }
      }
      out[row * cols + col] = sum / (S * S * 255);
    }
  }
  return out;
}
