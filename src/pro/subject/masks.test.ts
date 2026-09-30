import { describe, expect, it } from 'vitest';
import { defaultSubject, newLayer, type Layer, type Track } from '../model';
import {
  analysisRange,
  analysisTimes,
  analysisWindow,
  fadeBorder,
  finalizeFrame,
  finishKey,
  MASK_BUDGET,
  MASK_LONG_FRAME,
  MASK_LONG_MIN,
  MASK_LONG_WINDOW,
  maskBytes,
  maskDims,
  maskIndex,
  maskPlan,
  parseSequence,
  readRecord,
  sequenceFit,
  toRecord,
  trackSignature,
  wantedMeta,
  WINDOW_MIN,
  type FinishSettings,
  type MaskSequence,
  type RawMask,
} from './masks';

const settings = (s: Partial<FinishSettings> = {}): FinishSettings => ({
  threshold: 0.5,
  softness: 0.02,
  expand: 0,
  invert: false,
  steady: false,
  ...s,
});

function mask(w: number, h: number, fill: (x: number, y: number) => number, rect: RawMask['rect'] = [0, 0, 1, 1]) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fill(x, y);
  return { width: w, height: h, data, rect } satisfies RawMask;
}

const count = (d: Uint8Array, over = 127) => d.reduce((n, v) => n + (v > over ? 1 : 0), 0);

describe('maskIndex', () => {
  const seq = { from: 2, fps: 10, frames: { length: 11 } };

  it('finds the two masks around a time and how far between', () => {
    const r = maskIndex(seq, 2.25);
    expect(r.i).toBe(2);
    expect(r.j).toBe(3);
    expect(r.k).toBeCloseTo(0.5, 6);
  });

  it('gives one mask on an analysed time, despite float noise', () => {
    expect(maskIndex(seq, 2.3)).toEqual({ i: 3, j: 3, k: 0 });
    expect(maskIndex(seq, 2 + 0.7)).toEqual({ i: 7, j: 7, k: 0 });
  });

  it('clamps before the first and after the last', () => {
    expect(maskIndex(seq, 0)).toEqual({ i: 0, j: 0, k: 0 });
    expect(maskIndex(seq, 99)).toEqual({ i: 10, j: 10, k: 0 });
  });

  it('always shows the one mask of a still', () => {
    expect(maskIndex({ from: 0, fps: 0, frames: { length: 1 } }, 5)).toEqual({ i: 0, j: 0, k: 0 });
    expect(maskIndex({ from: 0, fps: 10, frames: { length: 1 } }, 5)).toEqual({ i: 0, j: 0, k: 0 });
    expect(maskIndex(seq, NaN)).toEqual({ i: 0, j: 0, k: 0 });
  });
});

describe('analysisRange / analysisTimes', () => {
  it('covers what the layer plays, like tracking', () => {
    const l = newLayer('video', 'v', { in: 1, length: 3, speed: 2 });
    expect(analysisRange(l, 10)).toEqual({ from: 1, to: 7 });
    expect(analysisRange(l, 5)).toEqual({ from: 1, to: 5 });
    expect(analysisRange(newLayer('image', 'i'), 0)).toEqual({ from: 0, to: 0 });
  });

  it('stops where the canvas ends', () => {
    // The starter: a 12 s sample layer on a 6 s canvas.
    const sample = newLayer('sample', 's', { length: 12 });
    expect(analysisRange(sample, 12, 6)).toEqual({ from: 0, to: 6 });
    expect(analysisTimes(0, 6, 10, 12)).toHaveLength(61);
    // Starting later leaves less of it on the canvas; at twice the speed that's twice the media.
    expect(analysisRange(newLayer('video', 'v', { start: 2, length: 10, in: 1, speed: 2 }), 30, 6)).toEqual({
      from: 1,
      to: 9,
    });
    // Starting after the canvas ends: one mask's worth.
    expect(analysisRange(newLayer('video', 'v', { start: 8, length: 4 }), 30, 6)).toEqual({ from: 0, to: 0 });
  });

  it('samples every 1/rate s, kept inside the clip', () => {
    expect(analysisTimes(1, 2, 5, 10)).toEqual([1, 1.2, 1.4, 1.6, 1.8, 2]);
    const t = analysisTimes(0, 1, 2, 1);
    expect(t).toEqual([0, 0.5, 1 - 1e-3]);
    expect(analysisTimes(3, 3, 10, 5)).toEqual([3]);
  });
});

describe('analysisWindow', () => {
  it('pads the box around its centre', () => {
    const [x, y, w, h] = analysisWindow({ cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 }, 1000, 1000);
    expect(w).toBeCloseTo(0.32, 6);
    expect(h).toBeCloseTo(0.32, 6);
    expect(x + w / 2).toBeCloseTo(0.5, 6);
    expect(y + h / 2).toBeCloseTo(0.5, 6);
  });

  it('is never smaller than a share of the shorter side', () => {
    const [, , w, h] = analysisWindow({ cx: 0.5, cy: 0.5, w: 0.001, h: 0.001 }, 1600, 900);
    expect(w * 1600).toBeCloseTo(WINDOW_MIN * 900, 3);
    expect(h * 900).toBeCloseTo(WINDOW_MIN * 900, 3);
  });

  it('stays inside the picture, moving rather than cutting', () => {
    const [x, y, w, h] = analysisWindow({ cx: 0.98, cy: 0.02, w: 0.2, h: 0.2 }, 1000, 1000);
    expect(w).toBeCloseTo(0.32, 6);
    expect(x + w).toBeCloseTo(1, 6);
    expect(y).toBe(0);
    expect(h).toBeCloseTo(0.32, 6);
    const big = analysisWindow({ cx: 0.5, cy: 0.5, w: 0.9, h: 0.9 }, 1000, 500);
    expect(big).toEqual([0, 0, 1, 1]);
  });

  it('keeps the pixel aspect sensible', () => {
    const [, , w, h] = analysisWindow({ cx: 0.5, cy: 0.5, w: 0.5, h: 0.05 }, 1000, 1000);
    expect((w * 1000) / (h * 1000)).toBeCloseTo(2, 6);
    const [, , w2, h2] = analysisWindow({ cx: 0.5, cy: 0.5, w: 0.05, h: 0.5 }, 1000, 1000);
    expect((h2 * 1000) / (w2 * 1000)).toBeCloseTo(2, 6);
  });
});

describe('maskPlan', () => {
  it('uses the largest size while the clip is short', () => {
    expect(maskPlan(100, 1920, 1080, false)).toMatchObject({ long: MASK_LONG_FRAME, fits: true });
    expect(maskPlan(100, 1920, 1080, true)).toMatchObject({ long: MASK_LONG_WINDOW, fits: true });
  });

  it('never upscales a small picture', () => {
    expect(maskPlan(1, 300, 200, false).long).toBe(300);
  });

  it('shrinks masks to fit the budget', () => {
    const p = maskPlan(3000, 1920, 1080, false);
    expect(p.long).toBeLessThan(MASK_LONG_FRAME);
    expect(p.long).toBeGreaterThanOrEqual(MASK_LONG_MIN);
    expect(p.fits).toBe(true);
    expect(p.bytes).toBeLessThanOrEqual(MASK_BUDGET);
    // As large as fits: one pixel more would overshoot.
    const [w, h] = maskDims(p.long + 1, 1920, 1080);
    expect(3000 * w * h).toBeGreaterThan(MASK_BUDGET * 0.98);
  });

  it('says so when even the smallest size overshoots', () => {
    const p = maskPlan(20000, 1920, 1080, false);
    expect(p.long).toBe(MASK_LONG_MIN);
    expect(p.fits).toBe(false);
    expect(p.bytes).toBeGreaterThan(MASK_BUDGET);
  });

  it('scales dims to a long side', () => {
    expect(maskDims(512, 1920, 1080)).toEqual([512, 288]);
    expect(maskDims(384, 90, 160)).toEqual([216, 384]);
  });
});

describe('maskBytes', () => {
  it('quantises and resizes', () => {
    const src = Float32Array.from({ length: 16 }, () => 0.5);
    const out = maskBytes(src, 4, 4, 2, 2);
    expect([...out]).toEqual([128, 128, 128, 128]);
    expect([...maskBytes(Float32Array.of(-1, 2), 2, 1, 2, 1)]).toEqual([0, 255]);
  });

  it('keeps a thin line when shrinking a lot', () => {
    const w = 64;
    const src = new Float32Array(w * w);
    for (let y = 0; y < w; y++) src[y * w + 33] = 1;
    const out = maskBytes(src, w, w, 8, 8);
    expect(Math.max(...out)).toBeGreaterThan(10);
  });
});

describe('fadeBorder', () => {
  it('fades edges inside the picture to 0, leaving the picture border alone', () => {
    const m = mask(50, 50, () => 255, [0, 0.2, 0.5, 0.5]);
    fadeBorder(m.data, 50, 50, m.rect);
    const at = (x: number, y: number) => m.data[y * 50 + x]!;
    // Left edge sits on the picture's border: untouched.
    expect(at(0, 25)).toBe(255);
    // Top and right edges are inside: faded to 0 there.
    expect(at(25, 0)).toBe(0);
    expect(at(49, 25)).toBe(0);
    // Bottom edge (0.2 + 0.5 < 1) is inside too.
    expect(at(25, 49)).toBe(0);
    // The middle is untouched, and the fade is gradual.
    expect(at(25, 25)).toBe(255);
    expect(at(25, 2)).toBeGreaterThan(0);
    expect(at(25, 2)).toBeLessThan(255);
  });

  it('leaves a whole-frame mask alone', () => {
    const m = mask(10, 10, () => 200);
    fadeBorder(m.data, 10, 10, m.rect);
    expect(m.data.every((v) => v === 200)).toBe(true);
  });
});

describe('finalizeFrame', () => {
  const picture: [number, number] = [100, 100];
  // A soft left-to-right ramp, 0 to 255.
  const ramp = mask(100, 1, (x) => Math.round((x / 99) * 255));

  it('thresholds with a soft edge', () => {
    const out = finalizeFrame(ramp, [], settings({ threshold: 0.5, softness: 0.2 }), picture);
    expect(out[0]).toBe(0);
    expect(out[99]).toBe(255);
    expect(out[50]).toBeGreaterThan(100);
    expect(out[50]).toBeLessThan(155);
    // Softness widens the transition.
    const hard = finalizeFrame(ramp, [], settings({ threshold: 0.5, softness: 0 }), picture);
    const between = (d: Uint8Array) => d.reduce((n, v) => n + (v > 5 && v < 250 ? 1 : 0), 0);
    expect(between(out)).toBeGreaterThan(between(hard));
  });

  it('moves the cut with the threshold', () => {
    const lo = finalizeFrame(ramp, [], settings({ threshold: 0.3 }), picture);
    const hi = finalizeFrame(ramp, [], settings({ threshold: 0.7 }), picture);
    expect(count(lo)).toBeGreaterThan(count(hi));
    expect(count(lo)).toBeCloseTo(70, -1);
  });

  it('inverts', () => {
    const out = finalizeFrame(ramp, [], settings({ invert: true }), picture);
    expect(out[0]).toBe(255);
    expect(out[99]).toBe(0);
  });

  it('grows and shrinks by a share of the picture', () => {
    const disc = mask(100, 100, (x, y) => ((x - 50) ** 2 + (y - 50) ** 2 < 20 ** 2 ? 255 : 0));
    const base = count(finalizeFrame(disc, [], settings(), picture));
    const grown = count(finalizeFrame(disc, [], settings({ expand: 4 }), picture));
    const shrunk = count(finalizeFrame(disc, [], settings({ expand: -4 }), picture));
    expect(grown).toBeGreaterThan(base * 1.15);
    expect(shrunk).toBeLessThan(base * 0.85);
  });

  it('converts the grow radius through the rectangle into mask pixels', () => {
    // The same disc, analysed in a window a quarter of the picture wide at 4× the resolution: the growth in
    // picture px must match, so the grown area (in mask px) is 16× the whole-frame one's.
    const whole = mask(100, 100, (x, y) => ((x - 50) ** 2 + (y - 50) ** 2 < 10 ** 2 ? 255 : 0));
    const win = mask(
      100,
      100,
      (x, y) => ((x - 50) ** 2 + (y - 50) ** 2 < 40 ** 2 ? 255 : 0),
      [0.375, 0.375, 0.25, 0.25],
    );
    const pic: [number, number] = [400, 400];
    const g1 =
      count(finalizeFrame(whole, [], settings({ expand: 2 }), pic)) - count(finalizeFrame(whole, [], settings(), pic));
    const g2 =
      count(finalizeFrame(win, [], settings({ expand: 2 }), pic)) - count(finalizeFrame(win, [], settings(), pic));
    expect(g2 / g1).toBeGreaterThan(8);
    expect(g2 / g1).toBeLessThan(32);
  });

  it('steadies with neighbours that cover the same pixels', () => {
    const self = mask(10, 1, () => 150);
    const dark = mask(10, 1, () => 0);
    const on = finalizeFrame(self, [dark, dark], settings({ steady: true }), picture);
    const off = finalizeFrame(self, [dark, dark], settings({ steady: false }), picture);
    expect(off[0]).toBe(255);
    // (0.6·150 + 0.2·0 + 0.2·0) / 255 ≈ 0.35: under the threshold.
    expect(on[0]).toBe(0);
    // A lone flicker in one neighbour doesn't win against the mask itself.
    const bright = mask(10, 1, () => 255);
    const lone = finalizeFrame(dark, [bright, null], settings({ steady: true }), picture);
    expect(lone[0]).toBe(0);
  });

  it('ignores neighbours of another size or rectangle', () => {
    const self = mask(10, 1, () => 150);
    const otherSize = mask(12, 1, () => 0);
    const otherRect = mask(10, 1, () => 0, [0.1, 0, 0.5, 1]);
    const out = finalizeFrame(self, [otherSize, otherRect], settings({ steady: true }), picture);
    expect(out[0]).toBe(255);
  });

  it('keys everything it depends on', () => {
    const a = finishKey(settings(), [100, 100]);
    expect(finishKey(settings(), [100, 100])).toBe(a);
    expect(finishKey(settings({ threshold: 0.6 }), [100, 100])).not.toBe(a);
    expect(finishKey(settings({ steady: true }), [100, 100])).not.toBe(a);
    expect(finishKey(settings(), [100, 101])).not.toBe(a);
  });
});

describe('staleness', () => {
  const track: Track = {
    box: [0.1, 0.1, 0.2, 0.2],
    at: 0,
    duration: 10,
    from: 0,
    fps: 30,
    data: [0.2, 0.2, 0.2, 0.2, 1],
  };
  const video = (extra: Partial<Layer> = {}): Layer =>
    newLayer('video', 'v', { mediaId: 'm1', in: 1, length: 4, subject: { ...defaultSubject(), on: true }, ...extra });

  it('is current for what it was analysed for', () => {
    const l = video();
    expect(sequenceFit(wantedMeta(l, 10), wantedMeta(l, 10))).toBe('current');
  });

  it('turns stale when an analysis setting changes', () => {
    const have = wantedMeta(video(), 10);
    const sub = video().subject!;
    expect(sequenceFit(have, wantedMeta(video({ subject: { ...sub, method: 'classic' } }), 10))).toBe('stale');
    expect(sequenceFit(have, wantedMeta(video({ subject: { ...sub, rate: 30 } }), 10))).toBe('stale');
    expect(sequenceFit(have, wantedMeta(video({ subject: { ...sub, area: 'tracked' }, track }), 10))).toBe('stale');
    // Drawing settings don't need a new analysis.
    expect(sequenceFit(have, wantedMeta(video({ subject: { ...sub, threshold: 0.9, show: 'subject' } }), 10))).toBe(
      'current',
    );
  });

  it('follows the track when separating the tracked object', () => {
    const sub = { ...defaultSubject(), on: true, area: 'tracked' as const };
    const have = wantedMeta(video({ subject: sub, track }), 10);
    expect(have.track).not.toBe('');
    const moved = { ...track, data: [0.3, 0.2, 0.2, 0.2, 1] };
    expect(sequenceFit(have, wantedMeta(video({ subject: sub, track: moved }), 10))).toBe('stale');
    expect(sequenceFit(have, wantedMeta(video({ subject: sub, track: { ...track } }), 10))).toBe('current');
    // The frame area doesn't care about the track.
    expect(wantedMeta(video({ track }), 10).track).toBe('');
  });

  it('stays current when trimmed shorter, not when longer', () => {
    const have = wantedMeta(video(), 10);
    expect(sequenceFit(have, wantedMeta(video({ in: 2, length: 1 }), 10))).toBe('current');
    expect(sequenceFit(have, wantedMeta(video({ length: 6 }), 10))).toBe('stale');
    expect(sequenceFit(have, wantedMeta(video({ in: 0.5 }), 10))).toBe('stale');
  });

  it('only wants the part on the canvas', () => {
    const onCanvas = wantedMeta(video(), 10, 2);
    expect(sequenceFit(onCanvas, wantedMeta(video(), 10, 2))).toBe('current');
    expect(sequenceFit(onCanvas, wantedMeta(video(), 10, 1))).toBe('current');
    expect(sequenceFit(onCanvas, wantedMeta(video(), 10))).toBe('stale');
  });

  it('tells other media apart', () => {
    const have = wantedMeta(video(), 10);
    expect(sequenceFit(have, wantedMeta(video({ mediaId: 'm2' }), 10))).toBe('other-media');
    expect(wantedMeta(newLayer('sample', 's'), 12).media).toBe('sample');
  });

  it("ignores the rate and range of a picture's single mask", () => {
    const pic = (extra: Partial<Layer>) => newLayer('image', 'p', { mediaId: 'img', ...extra });
    const have = wantedMeta(pic({}), 0);
    expect(sequenceFit(have, wantedMeta(pic({ subject: { ...defaultSubject(), rate: 30 }, length: 20 }), 0))).toBe(
      'current',
    );
  });

  it('signs tracks by their content', () => {
    expect(trackSignature(undefined)).toBe('');
    expect(trackSignature({ ...track, data: [] })).toBe('');
    expect(trackSignature(track)).toBe(trackSignature(structuredClone(track)));
    expect(trackSignature(track)).not.toBe(trackSignature({ ...track, box: [0.1, 0.1, 0.2, 0.3] }));
  });
});

describe('parseSequence', () => {
  const seq: MaskSequence = {
    from: 1,
    fps: 10,
    frames: [mask(4, 2, () => 9), mask(4, 2, () => 7, [0.1, 0.2, 0.3, 0.4])],
    meta: { media: 'm1', kind: 'video', method: 'ai-fast', area: 'frame', rate: 10, track: '', from: 1, to: 1.1 },
    backend: 'wasm',
    ms: 1234,
  };

  it('round-trips a record, its bytes in one Blob', async () => {
    const rec = toRecord(seq);
    expect(rec.bytes).toBeInstanceOf(Blob);
    expect((rec.bytes as Blob).size).toBe(16);
    expect((rec.frames as object[])[0]).toEqual({ width: 4, height: 2, rect: [0, 0, 1, 1] });
    expect(parseSequence(await readRecord(structuredClone(rec)))).toEqual(seq);
  });

  it('rejects what it cannot use', async () => {
    const rec = (await readRecord(toRecord(seq))) as Record<string, unknown>;
    expect(parseSequence(null)).toBeNull();
    expect(parseSequence({ ...rec, v: 99 })).toBeNull();
    expect(parseSequence({ ...rec, v: 1 })).toBeNull();
    expect(parseSequence({ ...rec, frames: [] })).toBeNull();
    expect(parseSequence({ ...rec, meta: { ...seq.meta, method: 'magic' } })).toBeNull();
    const short = { ...seq.frames[0]!, data: new Uint8Array(3) };
    expect(parseSequence({ ...rec, frames: [short] })).toBeNull();
    expect(parseSequence({ ...rec, frames: [{ ...seq.frames[0]!, rect: [0, 0, 1] }] })).toBeNull();
  });

  it("won't read back bytes that don't add up, or an older record", async () => {
    const rec = toRecord(seq);
    expect(await readRecord({ ...rec, bytes: new Blob([new Uint8Array(15)]) })).toBeNull();
    expect(await readRecord({ ...rec, bytes: new Blob([new Uint8Array(17)]) })).toBeNull();
    expect(await readRecord({ ...seq, v: 1 })).toBeNull();
    expect(await readRecord(null)).toBeNull();
  });
});
