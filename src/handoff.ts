/**
 * The picture open in the classic site, handed to the PRO studio when you
 * switch over (same page, so a module variable is enough).
 */
let pending: { canvas: HTMLCanvasElement; name: string } | null = null;

export function handOff(canvas: HTMLCanvasElement, name: string): void {
  pending = { canvas, name };
}

export function takeHandoff(): { canvas: HTMLCanvasElement; name: string } | null {
  const p = pending;
  pending = null;
  return p;
}
