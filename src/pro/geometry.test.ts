import { describe, expect, it } from 'vitest';
import { apply3, fittedSize, hitUv, invert3, layerQuad, motionAt, squareToQuad, type Point } from './geometry';
import { newLayer, newMotion } from './model';

const canvas = { width: 1920, height: 1080, duration: 6 };

describe('fittedSize', () => {
  it('fits, fills, stretches and keeps the original size', () => {
    const base = { stretchX: 1, stretchY: 1 };
    expect(fittedSize({ ...base, fit: 'fit' }, 1000, 1000, canvas)).toEqual([1080, 1080]);
    expect(fittedSize({ ...base, fit: 'fill' }, 1000, 1000, canvas)).toEqual([1920, 1920]);
    expect(fittedSize({ ...base, fit: 'stretch' }, 1000, 1000, canvas)).toEqual([1920, 1080]);
    expect(fittedSize({ ...base, fit: 'original' }, 640, 360, canvas)).toEqual([640, 360]);
    expect(fittedSize({ fit: 'original', stretchX: 2, stretchY: 0.5 }, 640, 360, canvas)).toEqual([1280, 180]);
  });
});

describe('homography', () => {
  it('maps the unit square onto a quad and back', () => {
    const quad: Point[] = [
      [100, 50],
      [900, 80],
      [860, 700],
      [120, 640],
    ];
    const h = squareToQuad(quad);
    const corners: Point[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    corners.forEach(([u, v], i) => {
      const p = apply3(h, u, v)!;
      expect(p[0]).toBeCloseTo(quad[i]![0], 6);
      expect(p[1]).toBeCloseTo(quad[i]![1], 6);
    });
    const inv = invert3(h)!;
    const uv = apply3(inv, ...apply3(h, 0.3, 0.7)!)!;
    expect(uv[0]).toBeCloseTo(0.3, 6);
    expect(uv[1]).toBeCloseTo(0.7, 6);
  });

  it('hit-tests points inside and outside', () => {
    const quad: Point[] = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ];
    expect(hitUv(quad, 50, 25)).toEqual([0.5, 0.5]);
    expect(hitUv(quad, 150, 25)).toBeNull();
  });
});

describe('layerQuad', () => {
  it('centres a fitted layer and applies position, scale and flips', () => {
    const layer = newLayer('image', 'x', { fit: 'fit' });
    const { quad } = layerQuad(layer, 1920, 1080, canvas, 0);
    expect(quad[0]).toEqual([0, 0]);
    expect(quad[2]).toEqual([1920, 1080]);
    const moved = layerQuad({ ...layer, x: 0.25, scale: 0.5, flipX: true }, 1920, 1080, canvas, 0).quad;
    // Flipped: the picture's top-left corner is now on the right.
    expect(moved[0][0]).toBeCloseTo(960 + 480 + 480, 6);
    expect(moved[1][0]).toBeCloseTo(960 + 480 - 480, 6);
  });
});

describe('motionAt', () => {
  it('loops seamlessly: whole cycles end where they started', () => {
    for (const type of [
      'drift',
      'float',
      'sway',
      'pulse',
      'orbit',
      'bounce',
      'zoom',
      'shake',
      'swing',
      'tumble',
      'breathe',
    ] as const) {
      const m = [{ ...newMotion(type), cycles: 3, amount: 1.2 }];
      const a = motionAt(m, 0, 6);
      const b = motionAt(m, 6, 6);
      for (const k of ['x', 'y', 'scale', 'rotation', 'tiltX', 'tiltY', 'opacity'] as const) {
        expect(b[k]).toBeCloseTo(a[k], 6);
      }
    }
  });

  it('spins whole turns per loop', () => {
    const m = [{ ...newMotion('spin'), cycles: 2 }];
    expect(motionAt(m, 3, 6).rotation).toBeCloseTo(360, 6);
    expect(motionAt(m, 6, 6).rotation % 360).toBeCloseTo(0, 6);
  });

  it('ignores switched-off motions', () => {
    expect(motionAt([{ ...newMotion('orbit'), enabled: false }], 1, 6)).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      tiltX: 0,
      tiltY: 0,
      opacity: 1,
    });
  });
});
