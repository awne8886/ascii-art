/**
 * Image → character grid.
 *
 * Like the pizza renderer, the picture is rasterised at a few samples per
 * character cell and each cell keeps its alpha-weighted average colour and
 * coverage. On top of that every cell gets an edge estimate: a structure
 * tensor over the samples' Sobel gradients gives the dominant orientation
 * and how coherent it is, so strong straight edges can be drawn with line
 * glyphs (- \ | /) instead of density glyphs.
 */

export interface CellSample {
  cols: number;
  rows: number;
  /** Average colour per cell (sRGB 0–255, composited over black), 3 per cell. */
  rgb: Float32Array;
  /** Alpha coverage per cell, 0–1 (1 for opaque photos). */
  alpha: Float32Array;
  /** Edge orientation bin per cell: 0 `-`, 1 `\`, 2 `|`, 3 `/`. */
  edgeDir: Uint8Array;
  /** Edge strength per cell, ~0–1 (1 ≈ the image's strong edges). */
  edgeStrength: Float32Array;
  /** Edge coherence per cell, 0 (texture / corner) – 1 (one clean straight edge). */
  edgeCoherence: Float32Array;
  /** The picture has meaningful transparency (e.g. a cut-out PNG). */
  hasAlpha: boolean;
}

/** Samples per cell along each axis: enough for edges and a clean average, capped so huge grids stay cheap. */
export function subsamples(cols: number, rows: number): [number, number] {
  const budget = 3_000_000;
  let sx = 4;
  let sy = 5;
  while (sx > 1 && cols * rows * sx * sy > budget) {
    sx--;
    sy = Math.max(1, sy - 1);
  }
  return [sx, sy];
}

/** Draw `image` into a cols·sx × rows·sy canvas and read it back. */
export function rasterize(
  image: CanvasImageSource,
  cols: number,
  rows: number,
): { data: Uint8ClampedArray; sx: number; sy: number } | null {
  const [sx, sy] = subsamples(cols, rows);
  const canvas = document.createElement('canvas');
  canvas.width = cols * sx;
  canvas.height = rows * sy;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, sx, sy };
}

/** Analyse RGBA pixels laid out as a cols·sx × rows·sy image. Pure: testable without a DOM. */
export function analyzePixels(data: Uint8ClampedArray, cols: number, rows: number, sx: number, sy: number): CellSample {
  const W = cols * sx;
  const H = rows * sy;
  const n = cols * rows;
  const rgb = new Float32Array(n * 3);
  const alpha = new Float32Array(n);
  const lum = new Float32Array(W * H);
  let transparent = 0;

  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const a = data[p + 3]! / 255;
    if (a < 0.98) transparent++;
    lum[i] = ((0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!) / 255) * a;
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < sy; y++) {
        let p = ((row * sy + y) * W + col * sx) * 4;
        for (let x = 0; x < sx; x++, p += 4) {
          const al = data[p + 3]!;
          a += al;
          r += data[p]! * al;
          g += data[p + 1]! * al;
          b += data[p + 2]! * al;
        }
      }
      const k = row * cols + col;
      alpha[k] = a / (sx * sy * 255);
      // Average colour of what's there (not darkened by partial coverage), like the original's `avg`.
      const inv = a > 0 ? 1 / a : 0;
      rgb[k * 3] = r * inv;
      rgb[k * 3 + 1] = g * inv;
      rgb[k * 3 + 2] = b * inv;
    }
  }

  const { edgeDir, edgeStrength, edgeCoherence } = edges(lum, W, H, cols, rows, sx, sy);
  return { cols, rows, rgb, alpha, edgeDir, edgeStrength, edgeCoherence, hasAlpha: transparent > W * H * 0.01 };
}

function edges(lum: Float32Array, W: number, H: number, cols: number, rows: number, sx: number, sy: number) {
  const n = cols * rows;
  const jxx = new Float32Array(n);
  const jyy = new Float32Array(n);
  const jxy = new Float32Array(n);
  const colOf = new Int32Array(W);
  for (let x = 0; x < W; x++) colOf[x] = Math.floor(x / sx);
  for (let y = 0; y < H; y++) {
    const up = Math.max(0, y - 1) * W;
    const mid = y * W;
    const down = Math.min(H - 1, y + 1) * W;
    const base = Math.floor(y / sy) * cols;
    for (let x = 0; x < W; x++) {
      const l = x > 0 ? x - 1 : 0;
      const r = x < W - 1 ? x + 1 : W - 1;
      const a = lum[up + l]!;
      const b = lum[up + x]!;
      const c = lum[up + r]!;
      const d = lum[mid + l]!;
      const f = lum[mid + r]!;
      const g = lum[down + l]!;
      const h = lum[down + x]!;
      const i = lum[down + r]!;
      const gx = c + 2 * f + i - (a + 2 * d + g);
      const gy = g + 2 * h + i - (a + 2 * b + c);
      const k = base + colOf[x]!;
      jxx[k]! += gx * gx;
      jyy[k]! += gy * gy;
      jxy[k]! += gx * gy;
    }
  }

  const per = 1 / (sx * sy);
  const mag = new Float32Array(n);
  const edgeDir = new Uint8Array(n);
  const edgeCoherence = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const xx = jxx[k]! * per;
    const yy = jyy[k]! * per;
    const xy = jxy[k]! * per;
    const trace = xx + yy;
    mag[k] = Math.sqrt(trace);
    edgeCoherence[k] = trace > 1e-9 ? Math.sqrt((xx - yy) ** 2 + 4 * xy * xy) / trace : 0;
    // Dominant gradient angle (y down); the edge line runs perpendicular to it.
    const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
    let phi = ((theta + Math.PI / 2) * 180) / Math.PI;
    phi = ((phi % 180) + 180) % 180;
    edgeDir[k] = Math.round(phi / 45) % 4;
  }

  // Normalise strength by the image's own strong edges (90th percentile), so it works for soft and punchy photos alike.
  const sorted = Float32Array.from(mag).sort();
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const scale = p90 > 1e-6 ? 1 / p90 : 0;
  const edgeStrength = new Float32Array(n);
  for (let k = 0; k < n; k++) edgeStrength[k] = mag[k]! * scale;
  return { edgeDir, edgeStrength, edgeCoherence };
}
