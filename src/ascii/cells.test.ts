import { describe, expect, it } from 'vitest';
import { type CellSample } from './analyze';
import { buildCells, CELL_STRIDE, toneMap, toText, weightedQuantiles } from './cells';

function sample(values: number[], cols = values.length): CellSample {
  const n = values.length;
  const rgb = new Float32Array(n * 3);
  values.forEach((v, i) => rgb.set([v, v, v], i * 3));
  return {
    cols,
    rows: n / cols,
    rgb,
    alpha: new Float32Array(n).fill(1),
    edgeDir: new Uint8Array(n),
    edgeStrength: new Float32Array(n),
    edgeCoherence: new Float32Array(n),
    hasAlpha: false,
  };
}

const tone = { autoTone: false, brightness: 0, contrast: 1, saturation: 1 };

describe('weightedQuantiles', () => {
  it('ignores zero-weight entries', () => {
    const v = Float32Array.from([0.1, 0.2, 0.9, 0.95]);
    const [median] = weightedQuantiles(v, Float32Array.from([0, 0, 1, 1]), [0.5]);
    expect(median).toBeGreaterThan(0.85);
  });
});

describe('toneMap', () => {
  it('stretches a low-contrast picture across the ramp with auto tone', () => {
    const s = sample([100, 110, 120, 130, 140, 150]);
    const flat = toneMap(s, s.alpha, tone);
    const auto = toneMap(s, s.alpha, { ...tone, autoTone: true });
    const range = (lab: Float32Array) => lab[15]! - lab[0]!;
    expect(range(auto)).toBeGreaterThan(range(flat) * 2);
  });

  it('never darkens a bright picture', () => {
    const s = sample([200, 210, 220, 230, 240, 250]);
    const flat = toneMap(s, s.alpha, tone);
    const auto = toneMap(s, s.alpha, { ...tone, autoTone: true });
    expect(auto[15]!).toBeGreaterThanOrEqual(flat[15]! - 0.02);
  });
});

describe('buildCells', () => {
  it('packs 16 bytes per cell with tone, coverage and edges', () => {
    const s = sample([0, 128, 255, 60]);
    s.edgeStrength[1] = 2;
    s.edgeCoherence[1] = 1;
    s.edgeDir[1] = 3;
    const cov = Float32Array.from([1, 1, 0.5, 0]);
    const out = buildCells(s, cov, { ...tone, colorMode: 'photo', paletteSize: 8, monoColor: '#7fe08f' });
    expect(out.length).toBe(4 * CELL_STRIDE);
    expect(out[3]).toBe(0); // black: tone 0
    expect(out[2 * CELL_STRIDE + 3]).toBe(255); // white: tone 1
    expect(out[2 * CELL_STRIDE + 7]).toBe(128); // coverage 0.5
    expect(out[3 * CELL_STRIDE + 7]).toBe(0);
    expect(out[CELL_STRIDE + 15]).toBe(4); // edge bin 3, stored + 1
    expect(out[15]).toBe(0);
  });

  it('snaps colours to palette materials in palette mode', () => {
    const s = sample([10, 12, 240, 242]);
    const out = buildCells(s, s.alpha, { ...tone, colorMode: 'palette', paletteSize: 2, monoColor: '#fff' });
    const base = (i: number) => Array.from(out.slice(i * CELL_STRIDE + 4, i * CELL_STRIDE + 7));
    expect(base(0)).toEqual(base(1));
    expect(base(2)).toEqual(base(3));
    expect(base(0)).not.toEqual(base(2));
  });
});

describe('toText', () => {
  it('maps lightness onto the ramp and blanks hidden cells', () => {
    const s = sample([0, 255, 255, 0], 2);
    const lab = toneMap(s, s.alpha, tone);
    const text = toText(s, Float32Array.from([1, 1, 0, 1]), lab, ['.', '@']);
    expect(text).toBe('.@\n .');
  });
});
