import { type CanvasSettings, type Layer, type MotionInstance } from './model';

/**
 * Where a layer lands on the canvas: its fitted size, then position, scale,
 * rotation, flips, a 3D tilt with perspective, plus whatever its motions add
 * at time t. Everything in canvas pixels, y down.
 */

export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Point = [number, number];

export interface Placement {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  tiltX: number;
  tiltY: number;
  opacity: number;
}

/** Size a layer takes on the canvas before scaling, in canvas px. */
export function fittedSize(
  layer: Pick<Layer, 'fit' | 'stretchX' | 'stretchY'>,
  intrinsicW: number,
  intrinsicH: number,
  canvas: Pick<CanvasSettings, 'width' | 'height'>,
): [number, number] {
  const iw = Math.max(1, intrinsicW);
  const ih = Math.max(1, intrinsicH);
  let w: number;
  let h: number;
  if (layer.fit === 'stretch') {
    w = canvas.width;
    h = canvas.height;
  } else if (layer.fit === 'original') {
    w = iw;
    h = ih;
  } else {
    const k =
      layer.fit === 'fill'
        ? Math.max(canvas.width / iw, canvas.height / ih)
        : Math.min(canvas.width / iw, canvas.height / ih);
    w = iw * k;
    h = ih * k;
  }
  return [w * layer.stretchX, h * layer.stretchY];
}

const TAU = Math.PI * 2;

/** What the layer's motions add at time t. Whole-number cycles loop seamlessly over the timeline. */
export function motionAt(motions: readonly MotionInstance[], t: number, duration: number): Placement {
  const out: Placement = { x: 0, y: 0, scale: 1, rotation: 0, tiltX: 0, tiltY: 0, opacity: 1 };
  const d = Math.max(duration, 1e-3);
  for (const m of motions) {
    if (!m.enabled) continue;
    const cycles = Math.max(1, Math.round(m.cycles));
    const th = TAU * (cycles * (t / d) + m.phase);
    const a = m.amount;
    switch (m.type) {
      case 'drift':
        out.x += a * 0.12 * Math.sin(th);
        out.y += a * 0.05 * Math.sin(2 * th);
        break;
      case 'float':
        out.y += a * 0.05 * Math.sin(th);
        out.rotation += a * 2.5 * Math.sin(th + 1.1);
        break;
      case 'sway':
        out.rotation += a * 14 * Math.sin(th);
        break;
      case 'spin':
        out.rotation += (360 * cycles * (t / d) + m.phase * 360) * (a >= 0 ? 1 : -1);
        break;
      case 'pulse':
        out.scale *= 1 + a * 0.14 * Math.sin(th);
        break;
      case 'orbit':
        out.x += a * 0.12 * Math.cos(th);
        out.y += a * 0.12 * Math.sin(th);
        break;
      case 'bounce':
        out.y -= a * 0.16 * Math.abs(Math.sin(th / 2));
        break;
      case 'zoom':
        out.scale *= 1 + a * 0.3 * (0.5 - 0.5 * Math.cos(th));
        out.x += a * 0.03 * Math.sin(th);
        break;
      case 'shake':
        out.x += a * 0.008 * (Math.sin(13 * th) + Math.sin(29 * th + 1.3));
        out.y += a * 0.008 * (Math.sin(17 * th + 0.7) + Math.sin(23 * th + 2.1));
        out.rotation += a * 1.2 * Math.sin(19 * th);
        break;
      case 'swing':
        out.tiltY += a * 40 * Math.sin(th);
        break;
      case 'tumble':
        out.tiltX += a * 30 * Math.sin(th);
        out.tiltY += a * 30 * Math.cos(th);
        break;
      case 'breathe':
        out.scale *= 1 + a * 0.05 * Math.sin(th);
        out.opacity *= 1 - a * 0.25 * (0.5 - 0.5 * Math.cos(th));
        break;
    }
  }
  return out;
}

/**
 * The layer's four corners on the canvas (canvas px): top-left, top-right,
 * bottom-right, bottom-left of the picture.
 */
export function layerQuad(
  layer: Layer,
  intrinsicW: number,
  intrinsicH: number,
  canvas: Pick<CanvasSettings, 'width' | 'height' | 'duration'>,
  t: number,
): { quad: [Point, Point, Point, Point]; opacity: number; size: [number, number] } {
  const [w, h] = fittedSize(layer, intrinsicW, intrinsicH, canvas);
  const mo = motionAt(layer.motion, t, canvas.duration);
  const scale = layer.scale * mo.scale;
  const rot = ((layer.rotation + mo.rotation) * Math.PI) / 180;
  const tx = ((layer.tiltX + mo.tiltX) * Math.PI) / 180;
  const ty = ((layer.tiltY + mo.tiltY) * Math.PI) / 180;
  const cx = canvas.width / 2 + (layer.x + mo.x) * canvas.width;
  const cy = canvas.height / 2 + (layer.y + mo.y) * canvas.height;
  // Focal length: stronger perspective = shorter lens.
  const focal = Math.max(canvas.width, canvas.height) * (0.6 + 3.4 * (1 - Math.max(0, Math.min(1, layer.perspective))));
  const fx = layer.flipX ? -1 : 1;
  const fy = layer.flipY ? -1 : 1;
  const corners: Point[] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const quad = corners.map(([u, v]) => {
    let x = u * w * scale * fx;
    let y = v * h * scale * fy;
    // In-plane rotation.
    const rx = x * Math.cos(rot) - y * Math.sin(rot);
    const ry = x * Math.sin(rot) + y * Math.cos(rot);
    x = rx;
    y = ry;
    let z = 0;
    // Tilt around the horizontal axis, then the vertical one.
    const y1 = y * Math.cos(tx) - z * Math.sin(tx);
    const z1 = y * Math.sin(tx) + z * Math.cos(tx);
    y = y1;
    z = z1;
    const x2 = x * Math.cos(ty) + z * Math.sin(ty);
    const z2 = -x * Math.sin(ty) + z * Math.cos(ty);
    x = x2;
    z = z2;
    const k = focal / Math.max(1, focal + z);
    return [cx + x * k, cy + y * k] as Point;
  }) as [Point, Point, Point, Point];
  return { quad, opacity: layer.opacity * mo.opacity, size: [w, h] };
}

/** Homography mapping the unit square (u right, v down) onto quad (TL, TR, BR, BL). */
export function squareToQuad(q: readonly Point[]): Mat3 {
  const [x0, y0] = q[0]!;
  const [x1, y1] = q[1]!;
  const [x2, y2] = q[2]!;
  const [x3, y3] = q[3]!;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  // Row-major: [a b c; d e f; g h 1].
  return [a, b, x0, d, e, y0, g, h, 1];
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

export function apply3(m: Mat3, x: number, y: number): Point | null {
  const w = m[6] * x + m[7] * y + m[8];
  if (w <= 1e-9) return null;
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/** Layer uv (0–1, y down) under canvas point (x, y), or null if it's outside the layer. */
export function hitUv(quad: readonly Point[], x: number, y: number): Point | null {
  const inv = invert3(squareToQuad(quad));
  if (!inv) return null;
  const uv = apply3(inv, x, y);
  if (!uv || uv[0] < 0 || uv[1] < 0 || uv[0] > 1 || uv[1] > 1) return null;
  return uv;
}
