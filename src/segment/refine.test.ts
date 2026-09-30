import { describe, expect, it } from 'vitest';
import { otsu } from './classic';
import { boxBlur, cellCoverage, finalizeMask, guidedFilter, resizeBilinear } from './refine';

describe('boxBlur', () => {
  it('matches a brute-force mean', () => {
    const w = 7;
    const h = 5;
    const src = Float32Array.from({ length: w * h }, (_, i) => (i * 37) % 11);
    const out = boxBlur(src, w, h, 2);
    // Brute force, clamped window (same as the separable version).
    const x = 3;
    const y = 2;
    let sum = 0;
    let n = 0;
    for (let yy = 0; yy <= 4; yy++) {
      let rowSum = 0;
      let rn = 0;
      for (let xx = 1; xx <= 5; xx++) {
        rowSum += src[yy * w + xx]!;
        rn++;
      }
      sum += rowSum / rn;
      n++;
    }
    expect(out[y * w + x]).toBeCloseTo(sum / n, 5);
  });
});

describe('resizeBilinear', () => {
  it('preserves constants and scales', () => {
    const out = resizeBilinear(new Float32Array(16).fill(0.7), 4, 4, 9, 3);
    expect(out.length).toBe(27);
    out.forEach((v) => expect(v).toBeCloseTo(0.7, 5));
  });
});

describe('guidedFilter', () => {
  it('snaps a blurry mask to the edge in the guide', () => {
    const w = 40;
    const h = 10;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const coarse = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = x < 20 ? 255 : 0;
        rgba.set([v, v, v, 255], (y * w + x) * 4);
        coarse[y * w + x] = Math.min(1, Math.max(0, (25 - x) / 10)); // soft ramp from x=15 to 25
      }
    }
    const q = guidedFilter(rgba, coarse, w, h, 4, 1e-4);
    expect(q[5 * w + 17]!).toBeGreaterThan(coarse[5 * w + 17]!);
    expect(q[5 * w + 22]!).toBeLessThan(coarse[5 * w + 22]!);
  });
});

describe('finalizeMask', () => {
  const soft = { width: 4, height: 1, data: Float32Array.from([0.1, 0.45, 0.55, 0.9]) };

  it('thresholds, and inverts', () => {
    const m = finalizeMask(soft, { threshold: 0.5, softness: 0, expand: 0, invert: false });
    expect(Array.from(m)).toEqual([0, 0, 255, 255]);
    const inv = finalizeMask(soft, { threshold: 0.5, softness: 0, expand: 0, invert: true });
    expect(Array.from(inv)).toEqual([255, 255, 0, 0]);
  });

  it('grows and shrinks the subject', () => {
    const w = 60;
    const data = Float32Array.from({ length: w }, (_, x) => (x >= 20 && x < 40 ? 1 : 0));
    const area = (m: Uint8Array) => m.reduce((a, v) => a + v / 255, 0);
    const base = area(
      finalizeMask({ width: w, height: 1, data }, { threshold: 0.5, softness: 0.1, expand: 0, invert: false }),
    );
    const grown = area(
      finalizeMask({ width: w, height: 1, data }, { threshold: 0.5, softness: 0.1, expand: 8, invert: false }),
    );
    const shrunk = area(
      finalizeMask({ width: w, height: 1, data }, { threshold: 0.5, softness: 0.1, expand: -8, invert: false }),
    );
    expect(grown).toBeGreaterThan(base);
    expect(shrunk).toBeLessThan(base);
  });
});

describe('cellCoverage', () => {
  it('averages the mask per cell', () => {
    const mask = Uint8Array.from([255, 255, 0, 0, 255, 255, 0, 0]);
    expect(Array.from(cellCoverage(mask, 4, 2, 2, 1))).toEqual([1, 0]);
  });
});

describe('otsu', () => {
  it('splits a bimodal histogram between its modes', () => {
    const v = Float32Array.from([...Array(50).fill(0.1), ...Array(50).fill(0.8)]);
    const t = otsu(v);
    expect(t).toBeGreaterThan(0.1);
    expect(t).toBeLessThanOrEqual(0.8);
  });
});
