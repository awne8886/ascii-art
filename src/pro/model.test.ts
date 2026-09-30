import { describe, expect, it } from 'vitest';
import { layerActive, mediaTime, newEffect, newLayer, resolveParams } from './model';

describe('resolveParams', () => {
  const fx = { ...newEffect('ascii'), params: { columns: 100 } };

  it('passes params through without modulations', () => {
    expect(resolveParams(fx, 1, 6, 0)).toBe(fx.params);
  });

  it('loops from the value to its target and back', () => {
    const m = { ...fx, mods: { columns: { source: 'loop' as const, to: 200, cycles: 1 } } };
    expect(resolveParams(m, 0, 6, 0).columns).toBeCloseTo(100);
    expect(resolveParams(m, 3, 6, 0).columns).toBeCloseTo(200);
    expect(resolveParams(m, 6, 6, 0).columns).toBeCloseTo(100);
  });

  it('follows the sound level', () => {
    const m = { ...fx, mods: { columns: { source: 'sound' as const, to: 300, cycles: 1 } } };
    expect(resolveParams(m, 1, 6, 0).columns).toBe(100);
    expect(resolveParams(m, 1, 6, 0.5).columns).toBe(200);
    expect(resolveParams(m, 1, 6, 2).columns).toBe(300);
  });
});

describe('timing', () => {
  const layer = newLayer('video', 'v', { start: 1, length: 4, in: 0.5, speed: 2, loopMedia: true });

  it('knows when a layer is on screen', () => {
    expect(layerActive(layer, 0.5)).toBe(false);
    expect(layerActive(layer, 1)).toBe(true);
    expect(layerActive(layer, 4.99)).toBe(true);
    expect(layerActive(layer, 5)).toBe(false);
    expect(layerActive({ ...layer, visible: false }, 2)).toBe(false);
  });

  it('maps timeline time to media time, with trim, speed and looping', () => {
    expect(mediaTime(layer, 1, 3)).toBeCloseTo(0.5);
    expect(mediaTime(layer, 1.5, 3)).toBeCloseTo(1.5);
    // 2.5 s of media after the trim, played at 2×: loops after 1.25 s.
    expect(mediaTime(layer, 2.5, 3)).toBeCloseTo(0.5 + (3 % 2.5));
    expect(mediaTime({ ...layer, loopMedia: false }, 3, 3)).toBeCloseTo(2.999);
  });
});
