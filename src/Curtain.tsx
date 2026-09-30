import { useEffect, useRef } from 'react';

const GLYPHS = ' .:+*=#%@';
const COLORS = ['#ffc53d', '#ffd978', '#f5ecd7', '#ff5a3c', '#7fe08f'];

/**
 * The switch between the classic site and PRO: a sheet of colour ASCII that
 * closes over the page ("cover") or dissolves away from it ("reveal").
 */
export function Curtain({ mode, ms = 650, onDone }: { mode: 'cover' | 'reveal'; ms?: number; onDone?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const cell = 16;
    const cols = Math.ceil(w / (cell * 0.62));
    const rows = Math.ceil(h / cell);
    const cw = w / cols;
    const n = cols * rows;
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i % cols) / cols;
      const y = Math.floor(i / cols) / rows;
      // A diagonal sweep with a ragged edge.
      seed[i] = Math.min(0.999, Math.max(0, (x * 0.6 + y * 0.4) * 0.75 + Math.random() * 0.25));
    }
    ctx.font = `700 ${cell * 0.8}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const start = performance.now();
    const total = reduce ? 1 : ms;
    let raf = 0;
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / total);
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        const s = seed[i]!;
        const edge = mode === 'cover' ? p * 1.25 - s : s - (p * 1.25 - 0.25);
        if (edge <= 0) continue;
        const x = (i % cols) * cw;
        const y = Math.floor(i / cols) * cell;
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, cw + 0.5, cell + 0.5);
        if (edge < 0.25) {
          const g = GLYPHS[Math.min(GLYPHS.length - 1, Math.floor((1 - edge / 0.25) * GLYPHS.length))]!;
          ctx.fillStyle = COLORS[(i * 7 + Math.floor(now / 90)) % COLORS.length]!;
          ctx.fillText(g, x + cw / 2, y + cell / 2);
        }
      }
      if (p < 1) raf = requestAnimationFrame(frame);
      else done.current?.();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode, ms]);

  return <canvas ref={ref} className={`curtain curtain--${mode}`} aria-hidden="true" />;
}
