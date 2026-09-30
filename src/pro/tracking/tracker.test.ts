import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../ascii/color';
import { NccTracker, type Gray } from './tracker';

/** A 200×120 noisy background with a textured 24×24 square whose centre is at (cx, cy). */
function frame(cx: number, cy: number, seed: number, brightness = 1): Gray {
  const w = 200;
  const h = 120;
  const d = new Float32Array(w * h);
  const rand = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 60 + rand() * 20 + 15 * Math.sin(x / 9) * Math.cos(y / 11);
      const u = x - cx + 12;
      const t = y - cy + 12;
      if (u >= 0 && u < 24 && t >= 0 && t < 24) v = ((u >> 2) + (t >> 2)) % 2 ? 230 : 120 + u * 2;
      d[y * w + x] = v * brightness;
    }
  }
  return { w, h, d };
}

describe('NccTracker', () => {
  it('follows a moving, brightening object', () => {
    const tracker = new NccTracker(frame(40, 50, 1), { cx: 40, cy: 50, w: 26, h: 26 });
    let cx = 40;
    let cy = 50;
    for (let i = 1; i <= 30; i++) {
      cx += 3.5;
      cy += Math.sin(i / 3) * 2;
      const r = tracker.update(frame(cx, cy, i + 1, 1 + i * 0.01));
      expect(Math.abs(r.cx - cx), `frame ${i} x`).toBeLessThan(2);
      expect(Math.abs(r.cy - cy), `frame ${i} y`).toBeLessThan(2);
      expect(r.conf).toBeGreaterThan(0.6);
    }
  });

  it('holds still and reports low confidence when the object vanishes', () => {
    const tracker = new NccTracker(frame(100, 60, 1), { cx: 100, cy: 60, w: 26, h: 26 });
    const empty = frame(-100, -100, 5);
    const r = tracker.update(empty);
    expect(r.conf).toBeLessThan(0.5);
  });
});
