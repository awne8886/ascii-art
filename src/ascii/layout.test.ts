import { describe, expect, it } from 'vitest';
import { cellMetrics } from './glyphs';
import { computeLayout, MAX_CELLS } from './layout';

describe('computeLayout', () => {
  it('fits whole cells inside the padded stage, centred', () => {
    const l = computeLayout(1000, 800, 1600, 900, 10, 20);
    const { cellW, cellH } = cellMetrics(10);
    expect(l.cellH).toBe(cellH);
    expect(l.cols).toBe(Math.floor(960 / cellW));
    expect(l.cols * l.cellW).toBeLessThanOrEqual(960);
    expect(l.rows * l.cellH).toBeLessThanOrEqual(760);
    expect(Math.abs(l.x - (1000 - l.cols * l.cellW) / 2)).toBeLessThanOrEqual(0.5);
  });

  it('caps the number of cells', () => {
    const l = computeLayout(3840, 2160, 3840, 2160, 4, 0);
    expect(l.cols * l.rows).toBeLessThanOrEqual(MAX_CELLS * 1.01);
  });
});
