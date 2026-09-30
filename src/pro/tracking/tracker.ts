/**
 * A small template tracker: the object's appearance is sampled on a grid
 * inside its box, and each new frame is searched around the last position
 * (and at slightly smaller and larger sizes) for the patch that correlates
 * best (normalized cross-correlation, so lighting changes don't throw it).
 * The template slowly adapts while the match is good, and the box holds
 * still while the object is lost.
 */

export interface Gray {
  w: number;
  h: number;
  d: Float32Array;
}

export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface TrackResult extends Box {
  conf: number;
}

export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = rgba[i * 4]! * 0.299 + rgba[i * 4 + 1]! * 0.587 + rgba[i * 4 + 2]! * 0.114;
  return { w, h, d };
}

function sample(g: Gray, x: number, y: number): number {
  const xc = Math.max(0, Math.min(g.w - 1.001, x));
  const yc = Math.max(0, Math.min(g.h - 1.001, y));
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const fx = xc - x0;
  const fy = yc - y0;
  const i = y0 * g.w + x0;
  const a = g.d[i]!;
  const b = g.d[i + 1]!;
  const c = g.d[i + g.w]!;
  const e = g.d[i + g.w + 1]!;
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}

const GRID = 20;
const SCALES = [0.95, 1, 1.05];

export class NccTracker {
  private template: Float32Array;
  private gx: number;
  private gy: number;
  private box: Box;
  private patch: Float32Array;

  constructor(frame: Gray, box: Box) {
    this.box = { ...box };
    const aspect = box.w / Math.max(1e-6, box.h);
    this.gx = Math.max(6, Math.round(aspect >= 1 ? GRID : GRID * aspect));
    this.gy = Math.max(6, Math.round(aspect >= 1 ? GRID / aspect : GRID));
    this.patch = new Float32Array(this.gx * this.gy);
    this.template = new Float32Array(this.gx * this.gy);
    this.read(frame, box.cx, box.cy, box.w, box.h, this.template);
    normalize(this.template);
  }

  get current(): Box {
    return { ...this.box };
  }

  /** Grid samples of the frame over a box, into out (not normalized). */
  private read(frame: Gray, cx: number, cy: number, w: number, h: number, out: Float32Array): void {
    const { gx, gy } = this;
    for (let j = 0; j < gy; j++) {
      const y = cy + ((j + 0.5) / gy - 0.5) * h;
      for (let i = 0; i < gx; i++) out[j * gx + i] = sample(frame, cx + ((i + 0.5) / gx - 0.5) * w, y);
    }
  }

  private score(frame: Gray, cx: number, cy: number, w: number, h: number): number {
    this.read(frame, cx, cy, w, h, this.patch);
    if (!normalize(this.patch)) return -1;
    let s = 0;
    for (let k = 0; k < this.patch.length; k++) s += this.patch[k]! * this.template[k]!;
    return s;
  }

  update(frame: Gray): TrackResult {
    const b = this.box;
    const radius = Math.max(6, 0.5 * Math.max(b.w, b.h));
    // Coarse search on a step, then refine around the best at pixel steps.
    const coarse = Math.max(1, radius / 7);
    let best = { cx: b.cx, cy: b.cy, s: 1, score: -2 };
    for (const s of SCALES) {
      const w = b.w * s;
      const h = b.h * s;
      for (let dy = -radius; dy <= radius; dy += coarse) {
        for (let dx = -radius; dx <= radius; dx += coarse) {
          const sc = this.score(frame, b.cx + dx, b.cy + dy, w, h);
          if (sc > best.score) best = { cx: b.cx + dx, cy: b.cy + dy, s, score: sc };
        }
      }
    }
    for (let step = coarse / 2; step >= 0.5; step /= 2) {
      const c = best;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const x = c.cx + dx * step;
          const y = c.cy + dy * step;
          const sc = this.score(frame, x, y, b.w * c.s, b.h * c.s);
          if (sc > best.score) best = { cx: x, cy: y, s: c.s, score: sc };
        }
      }
    }
    const conf = Math.max(0, best.score);
    if (conf >= 0.35) {
      this.box = {
        cx: best.cx,
        cy: best.cy,
        w: Math.max(4, Math.min(frame.w, b.w * best.s)),
        h: Math.max(4, Math.min(frame.h, b.h * best.s)),
      };
      // Adapt slowly to how the object looks now, only while the match is trustworthy.
      if (conf >= 0.6) {
        this.read(frame, this.box.cx, this.box.cy, this.box.w, this.box.h, this.patch);
        if (normalize(this.patch)) {
          for (let k = 0; k < this.template.length; k++) {
            this.template[k] = this.template[k]! * 0.88 + this.patch[k]! * 0.12;
          }
          normalize(this.template);
        }
      }
    }
    return { ...this.box, conf };
  }
}

/** Zero mean, unit length. False for a flat patch. */
function normalize(v: Float32Array): boolean {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i]!;
  m /= v.length;
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    v[i] = v[i]! - m;
    n += v[i]! * v[i]!;
  }
  n = Math.sqrt(n);
  if (n < 1e-3) return false;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
  return true;
}
