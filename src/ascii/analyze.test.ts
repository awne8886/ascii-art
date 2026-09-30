import { describe, expect, it } from 'vitest';
import { analyzePixels, subsamples } from './analyze';

/** RGBA image of cols·sx × rows·sy pixels filled by `f(x, y)`. */
function image(W: number, H: number, f: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(f(x, y), (y * W + x) * 4);
  return data;
}

describe('analyzePixels', () => {
  it('averages each cell and reports coverage', () => {
    const data = image(8, 8, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 0]));
    const s = analyzePixels(data, 2, 2, 4, 4);
    expect(Array.from(s.rgb.slice(0, 3))).toEqual([255, 0, 0]);
    expect(s.alpha[0]).toBe(1);
    expect(s.alpha[1]).toBe(0);
    expect(s.hasAlpha).toBe(true);
  });

  it('finds the orientation of straight edges', () => {
    const cols = 6;
    const rows = 6;
    const [sx, sy] = [4, 4];
    // Vertical edge down the middle → "|" (bin 2); horizontal edge → "-" (bin 0).
    const vertical = analyzePixels(
      image(cols * sx, rows * sy, (x) => (x < 12 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
      cols,
      rows,
      sx,
      sy,
    );
    const horizontal = analyzePixels(
      image(cols * sx, rows * sy, (_, y) => (y < 12 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
      cols,
      rows,
      sx,
      sy,
    );
    const edgeCell = 2 * cols + 2;
    expect(vertical.edgeDir[edgeCell]).toBe(2);
    expect(horizontal.edgeDir[2 * cols + 2]).toBe(0);
    expect(vertical.edgeCoherence[edgeCell]).toBeGreaterThan(0.9);
    expect(vertical.edgeStrength[edgeCell]).toBeGreaterThan(0.75);
  });

  it('keeps sampling within budget for huge grids', () => {
    const [sx, sy] = subsamples(1000, 400);
    expect(1000 * 400 * sx * sy).toBeLessThanOrEqual(3_000_000);
    expect(subsamples(100, 50)).toEqual([4, 5]);
  });
});
