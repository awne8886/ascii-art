import { cellMetrics } from './glyphs';

/** Where the character grid sits on the canvas (CSS px). */
export interface GridLayout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  fontPx: number;
  /** Top-left of the grid. */
  x: number;
  y: number;
}

/** Hard cap on cells so a tiny character size on a huge screen stays interactive. */
export const MAX_CELLS = 320_000;

/**
 * Fit an image of the given aspect ratio inside the stage (minus padding) and
 * cover it with as many whole cells of height `charSize` as fit, centred. The
 * image is mapped onto exactly that grid, so glyphs and photo line up.
 */
export function computeLayout(
  stageW: number,
  stageH: number,
  imageW: number,
  imageH: number,
  charSize: number,
  padding: number,
): GridLayout {
  const availW = Math.max(1, stageW - padding * 2);
  const availH = Math.max(1, stageH - padding * 2);
  const scale = Math.min(availW / imageW, availH / imageH);
  const fitW = imageW * scale;
  const fitH = imageH * scale;

  let m = cellMetrics(charSize);
  let cols = Math.max(1, Math.floor(fitW / m.cellW));
  let rows = Math.max(1, Math.floor(fitH / m.cellH));
  if (cols * rows > MAX_CELLS) {
    m = cellMetrics(charSize * Math.sqrt((cols * rows) / MAX_CELLS));
    cols = Math.max(1, Math.floor(fitW / m.cellW));
    rows = Math.max(1, Math.floor(fitH / m.cellH));
  }
  return {
    cols,
    rows,
    ...m,
    x: Math.round((stageW - cols * m.cellW) / 2),
    y: Math.round((stageH - rows * m.cellH) / 2),
  };
}
