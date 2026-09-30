/**
 * Glyph ramps (sparse → dense) and the sprite atlas the renderer blits from.
 *
 * `classic` is the ramp of the original pizza renderer, in its hand-picked
 * order. Every other set, and any custom string, is sorted by how much ink
 * each glyph actually puts on screen in the chosen font, so the ramp is
 * monotonic whatever characters the user types.
 */

export type GlyphSetId = 'classic' | 'standard' | 'dense' | 'blocks' | 'binary' | 'katakana' | 'custom';

export interface GlyphSet {
  id: GlyphSetId;
  label: string;
  glyphs: string;
  /** Keep the given order instead of sorting by measured ink. */
  fixedOrder?: boolean;
}

export const GLYPH_SETS: readonly GlyphSet[] = [
  { id: 'classic', label: 'Classic  . : + * = # % @', glyphs: '.:+*=#%@', fixedOrder: true },
  { id: 'standard', label: 'Standard  .:-=+*#%@', glyphs: ' .:-=+*#%@', fixedOrder: true },
  {
    id: 'dense',
    label: 'Dense (70 glyphs)',
    glyphs: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  },
  { id: 'blocks', label: 'Blocks  ░▒▓█', glyphs: ' ·░▒▓█', fixedOrder: true },
  { id: 'binary', label: 'Binary  0 1', glyphs: '·01' },
  { id: 'katakana', label: 'Matrix  ｱｲｳ', glyphs: '·ｰｼﾂｿﾝｱｲｳｴｵｶｷｸｹｺｻｽｾﾀﾁﾃﾄﾅﾆﾇﾈﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ' },
  { id: 'custom', label: 'Custom…', glyphs: '' },
];

/** Line glyphs for strong edges, by edge orientation: horizontal, falling (\), vertical, rising (/). */
export const EDGE_GLYPHS = ['-', '\\', '|', '/'] as const;
/** The pizza renderer's background stars. */
export const STAR_GLYPHS = ['.', '*', '+', "'", ':'] as const;

export const FONT_STACK =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';

/** Cell geometry for a given cell height (CSS px), exactly as the pizza renderer derives it. */
export function cellMetrics(cellH: number): { cellW: number; cellH: number; fontPx: number } {
  const fontPx = cellH / 1.2;
  return { cellW: fontPx * 0.72, cellH, fontPx };
}

/** Unique characters of `text` in order, as code points (so surrogate pairs stay whole). */
export function uniqueGlyphs(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t' || seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}

/** Ink coverage (0–1) of each glyph, measured by drawing it. */
export function measureInk(glyphs: readonly string[]): number[] {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return glyphs.map((_, i) => i);
  ctx.font = `700 ${size * 0.8}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  return glyphs.map((g) => {
    ctx.clearRect(0, 0, size, size);
    ctx.fillText(g, size / 2, size / 2);
    const px = ctx.getImageData(0, 0, size, size).data;
    let ink = 0;
    for (let i = 3; i < px.length; i += 4) ink += px[i]!;
    return ink / (size * size * 255);
  });
}

/** Sort glyphs sparse → dense by measured ink; stable for ties. */
export function sortByInk(glyphs: readonly string[], ink: readonly number[]): string[] {
  return glyphs
    .map((g, i) => ({ g, i, ink: ink[i] ?? 0 }))
    .sort((a, b) => a.ink - b.ink || a.i - b.i)
    .map((e) => e.g);
}

/** The ramp for a set (custom text for `custom`), at least two glyphs long. */
export function resolveRamp(id: GlyphSetId, custom: string): string[] {
  const set = GLYPH_SETS.find((s) => s.id === id) ?? GLYPH_SETS[0]!;
  let glyphs = uniqueGlyphs(id === 'custom' ? custom : set.glyphs);
  if (glyphs.length < 2) glyphs = uniqueGlyphs(GLYPH_SETS[0]!.glyphs);
  if (set.fixedOrder && id !== 'custom') return glyphs;
  return sortByInk(glyphs, measureInk(glyphs));
}

export interface GlyphAtlas {
  /** Glyph core, white on transparent. */
  core: HTMLCanvasElement;
  /** Only the soft halo around each glyph (the bright levels' glow). */
  glow: HTMLCanvasElement;
  /** Sprite size in device pixels, padding included. */
  spriteW: number;
  spriteH: number;
  /** Sprites per atlas row. */
  columns: number;
  /** Index of the first edge glyph and of the first star glyph. */
  edgeBase: number;
  starBase: number;
  /** Ramp length. */
  rampLength: number;
  /** The ramp starts with a blank (space): cells that land on it are skipped. */
  blankFirst: boolean;
}

/**
 * Pre-render every glyph once at the device-pixel size it is blitted at.
 * The core and the halo live in separate canvases so the shader can tint
 * both and scale the halo by brightness level, like the original baked
 * `shadowBlur` glow on its brightest levels.
 */
export function buildAtlas(ramp: readonly string[], cellW: number, cellH: number, dpr: number): GlyphAtlas | null {
  const fontPx = cellH / 1.2;
  const pad = Math.ceil(fontPx * dpr * 0.45);
  const spriteW = Math.ceil(cellW * dpr) + pad * 2;
  const spriteH = Math.ceil(cellH * dpr) + pad * 2;
  const all = [...ramp, ...EDGE_GLYPHS, ...STAR_GLYPHS];
  const columns = Math.max(1, Math.min(all.length, Math.floor(4096 / spriteW)));
  const rows = Math.ceil(all.length / columns);

  const make = (glow: boolean): HTMLCanvasElement | null => {
    const canvas = document.createElement('canvas');
    canvas.width = spriteW * columns;
    canvas.height = spriteH * rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.font = `700 ${fontPx * dpr}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    // Draw the halo alone: the glyph itself far off-canvas, its shadow shifted back into place.
    const away = canvas.width + spriteW * 4;
    if (glow) {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = fontPx * dpr * 0.45;
      ctx.shadowOffsetX = away;
    }
    all.forEach((g, i) => {
      const x = (i % columns) * spriteW + spriteW / 2;
      const y = Math.floor(i / columns) * spriteH + spriteH / 2;
      ctx.fillText(g, glow ? x - away : x, y);
    });
    return canvas;
  };

  const core = make(false);
  const glow = make(true);
  if (!core || !glow) return null;
  return {
    core,
    glow,
    spriteW,
    spriteH,
    columns,
    edgeBase: ramp.length,
    starBase: ramp.length + EDGE_GLYPHS.length,
    rampLength: ramp.length,
    blankFirst: ramp[0] === ' ',
  };
}
