import { describe, expect, it } from 'vitest';
import { hexToRgb } from './color';
import { rgbToOklab } from './oklab';
import { deriveMaterial, kmeans } from './palette';

const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('deriveMaterial', () => {
  it('ramps shadow < base < highlight in lightness, like the pizza materials', () => {
    for (const hex of ['#ffc53d', '#c8281f', '#3f9f50', '#4060d0', '#9e5a24']) {
      const m = deriveMaterial(rgbToOklab(hexToRgb(hex)));
      expect(lum(m.shadow)).toBeLessThan(lum(m.base));
      expect(lum(m.base)).toBeLessThan(lum(m.highlight));
    }
  });

  it('biases dark, saturated colours towards denser glyphs', () => {
    const cheese = deriveMaterial(rgbToOklab(hexToRgb('#ffc53d')));
    const pepperoni = deriveMaterial(rgbToOklab(hexToRgb('#8a1712')));
    expect(pepperoni.density).toBeGreaterThan(cheese.density);
  });
});

describe('kmeans', () => {
  it('finds well-separated colour groups and assigns every entry', () => {
    const colours = ['#ff0000', '#00ff00', '#0000ff'];
    const n = 300;
    const lab = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) lab.set(rgbToOklab(hexToRgb(colours[i % 3]!)), i * 3);
    const weights = new Float32Array(n).fill(1);
    const pal = kmeans(lab, weights, 3);
    expect(pal.centroids).toHaveLength(3);
    // Entries of the same colour share a cluster, different colours don't.
    expect(pal.assignment[0]).toBe(pal.assignment[3]);
    expect(new Set([pal.assignment[0], pal.assignment[1], pal.assignment[2]]).size).toBe(3);
  });

  it('is deterministic', () => {
    const lab = new Float32Array(600).map((_, i) => ((i * 7919) % 1000) / 1000 - (i % 3 ? 0.5 : 0));
    const w = new Float32Array(200).fill(1);
    expect(Array.from(kmeans(lab, w, 5).assignment)).toEqual(Array.from(kmeans(lab, w, 5).assignment));
  });
});
