import { type AtlasSpec } from '../effects/types';

export const FONTS = {
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "DejaVu Serif", serif',
  display: '"Arial Black", "Helvetica Neue", Impact, system-ui, sans-serif',
} as const;

export interface Atlas {
  canvas: HTMLCanvasElement;
  cols: number;
  rows: number;
  count: number;
  /** Cell height in texels. */
  cellH: number;
}

const CELL_H = 64;
const MAX_W = 2048;

function measure(glyphs: readonly string[], font: string): number[] {
  const size = 48;
  const c = document.createElement('canvas');
  c.width = size * 2;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return glyphs.map((_, i) => i);
  ctx.font = font.replace(/\d+px/, `${size * 0.8}px`);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  return glyphs.map((g) => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillText(g, c.width / 2, size / 2);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < px.length; i += 4) ink += px[i]!;
    return ink;
  });
}

/** Draws the glyphs white on transparent, one per cell, in rows. */
export function buildAtlas(spec: AtlasSpec): Atlas {
  const aspect = Math.max(0.25, Math.min(8, spec.cellAspect ?? 1));
  const cellH = CELL_H;
  const cellW = Math.round(cellH * aspect);
  let glyphs = spec.glyphs.length ? [...spec.glyphs] : [' '];
  const family = FONTS[spec.font ?? 'mono'];
  const fontPx = cellH * (spec.fill ?? 0.8);
  const font = `${spec.weight ?? 700} ${fontPx}px ${family}`;
  if (spec.sortByInk) {
    const ink = measure(glyphs, font);
    glyphs = glyphs
      .map((g, i) => ({ g, i, ink: ink[i]! }))
      .sort((a, b) => a.ink - b.ink || a.i - b.i)
      .map((e) => e.g);
  }
  const cols = Math.max(1, Math.min(glyphs.length, Math.floor(MAX_W / cellW)));
  const rows = Math.ceil(glyphs.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  glyphs.forEach((g, i) => {
    const x = (i % cols) * cellW + cellW / 2;
    const y = Math.floor(i / cols) * cellH + cellH / 2;
    // Words shrink to fit their cell.
    const w = ctx.measureText(g).width;
    const maxW = cellW * 0.92;
    if (w > maxW) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(maxW / w, 1);
      ctx.fillText(g, 0, cellH * 0.04);
      ctx.restore();
    } else {
      ctx.fillText(g, x, y + cellH * 0.04);
    }
  });
  return { canvas, cols, rows, count: glyphs.length, cellH };
}
