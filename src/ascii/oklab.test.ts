import { describe, expect, it } from 'vitest';
import { hexToRgb } from './color';
import { chromaHue, oklabToRgb, rgbToOklab } from './oklab';

describe('oklab', () => {
  it('round-trips sRGB colours', () => {
    for (const hex of ['#000000', '#ffffff', '#ffc53d', '#c8281f', '#3f9f50', '#1e40af', '#808080']) {
      const rgb = hexToRgb(hex);
      const back = oklabToRgb(rgbToOklab(rgb));
      back.forEach((c, i) => expect(c).toBeCloseTo(rgb[i]!, 0));
    }
  });

  it('puts black at L 0, white at L 1 and greys on the neutral axis', () => {
    expect(rgbToOklab([0, 0, 0])[0]).toBeCloseTo(0, 5);
    expect(rgbToOklab([255, 255, 255])[0]).toBeCloseTo(1, 3);
    const [C] = chromaHue(rgbToOklab([128, 128, 128]));
    expect(C).toBeLessThan(1e-3);
  });
});
