import { drawWholePizza, WHOLE_RADIUS } from '../ascii/pizzaArt';
import { mulberry32 } from '../ascii/color';
import { FONTS } from './gl/atlas';
import { type ShapeProps, type TextProps } from './model';

/**
 * Layers drawn rather than loaded: type, shapes, and the animated sample
 * clip. Each renders to a 2D canvas; sizes are in canvas pixels times
 * `scale` (the export can ask for sharper type than the preview).
 */

export interface Drawn {
  canvas: HTMLCanvasElement;
  /** Size in canvas px (independent of `scale`). */
  width: number;
  height: number;
}

function fontFor(p: TextProps, px: number): string {
  return `${p.italic ? 'italic ' : ''}${p.weight} ${px}px ${FONTS[p.font]}`;
}

export function renderText(p: TextProps, canvasH: number, scale: number): Drawn {
  const fontPx = Math.max(4, p.size * canvasH);
  const lines = (p.text || ' ').split('\n');
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = fontFor(p, fontPx);
  const spacing = p.letterSpacing * fontPx;
  const widths = lines.map((l) => probe.measureText(l).width + spacing * Math.max(0, Array.from(l).length - 1));
  const lineH = fontPx * p.lineHeight;
  const pad = fontPx * (p.backgroundOn ? 0.35 : 0.12);
  const w = Math.ceil(Math.max(...widths, 1) + pad * 2);
  const h = Math.ceil(lineH * lines.length + pad * 2);
  const k = Math.min(scale, 8192 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(k, k);
  if (p.backgroundOn) {
    ctx.fillStyle = p.background;
    const r = fontPx * 0.18;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.fill();
  }
  ctx.font = fontFor(p, fontPx);
  ctx.fillStyle = p.color;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
  lines.forEach((line, i) => {
    const lw = widths[i]!;
    const x = p.align === 'left' ? pad : p.align === 'right' ? w - pad - lw : (w - lw) / 2;
    ctx.fillText(line, x, pad + lineH * (i + 0.5));
  });
  return { canvas, width: w, height: h };
}

export function renderShape(p: ShapeProps, canvasH: number, scale: number): Drawn {
  const h = Math.max(4, p.size * canvasH);
  const w = h * p.aspect;
  const k = Math.min(scale, 8192 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(k, k);
  const paint = (): string | CanvasGradient => {
    if (p.shape === 'sphere') {
      const g = ctx.createRadialGradient(w * 0.36, h * 0.32, h * 0.04, w * 0.5, h * 0.5, h * 0.55);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.18, p.color);
      g.addColorStop(0.75, p.color2);
      g.addColorStop(1, '#000000');
      return g;
    }
    if (!p.gradient) return p.color;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, p.color);
    g.addColorStop(1, p.color2);
    return g;
  };
  const sw = p.stroke * Math.min(w, h) * 0.2;
  const inset = sw / 2;
  ctx.beginPath();
  switch (p.shape) {
    case 'circle':
    case 'sphere':
      ctx.ellipse(w / 2, h / 2, w / 2 - inset, h / 2 - inset, 0, 0, Math.PI * 2);
      break;
    case 'ring':
      ctx.ellipse(w / 2, h / 2, w / 2 - inset, h / 2 - inset, 0, 0, Math.PI * 2);
      ctx.ellipse(w / 2, h / 2, w * 0.3, h * 0.3, 0, 0, Math.PI * 2, true);
      break;
    case 'square':
      ctx.roundRect(inset, inset, w - sw, h - sw, p.corner * Math.min(w, h));
      break;
    case 'triangle':
      ctx.moveTo(w / 2, inset);
      ctx.lineTo(w - inset, h - inset);
      ctx.lineTo(inset, h - inset);
      ctx.closePath();
      break;
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const r = (i % 2 ? 0.2 : 0.5) * Math.min(w, h) - inset;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(
          w / 2 + Math.cos(a) * r * (w / Math.min(w, h)),
          h / 2 + Math.sin(a) * r * (h / Math.min(w, h)) * 1.05,
        );
      }
      ctx.closePath();
      break;
    }
    case 'heart': {
      ctx.moveTo(w / 2, h * 0.92);
      ctx.bezierCurveTo(w * -0.1, h * 0.55, w * 0.12, h * -0.05, w / 2, h * 0.28);
      ctx.bezierCurveTo(w * 0.88, h * -0.05, w * 1.1, h * 0.55, w / 2, h * 0.92);
      break;
    }
    case 'blob': {
      const rand = mulberry32(7);
      const pts = 9;
      const radii = Array.from({ length: pts }, () => 0.36 + rand() * 0.14);
      for (let i = 0; i <= pts; i++) {
        const a0 = (i / pts) * Math.PI * 2;
        const a1 = ((i + 0.5) / pts) * Math.PI * 2;
        const r0 = radii[i % pts]!;
        const r1 = (radii[i % pts]! + radii[(i + 1) % pts]!) / 2;
        const x0 = w / 2 + Math.cos(a0) * r0 * w;
        const y0 = h / 2 + Math.sin(a0) * r0 * h;
        if (i === 0) ctx.moveTo(x0, y0);
        else ctx.quadraticCurveTo(x0, y0, w / 2 + Math.cos(a1) * r1 * w, h / 2 + Math.sin(a1) * r1 * h);
      }
      ctx.closePath();
      break;
    }
  }
  if (sw > 0 && p.shape !== 'sphere') {
    ctx.lineWidth = sw;
    ctx.strokeStyle = paint();
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else {
    ctx.fillStyle = paint();
    ctx.fill('evenodd');
  }
  return { canvas, width: w, height: h };
}

// ─── Sample clip ─────────────────────────────────────────────────────────────

/** The sample clip's length: one full turn of the pizza, so it loops seamlessly. */
export const SAMPLE_DURATION = 12;
const SAMPLE_W = 1280;
const SAMPLE_H = 720;

let table: HTMLCanvasElement | null = null;
let pizza: HTMLCanvasElement | null = null;

function sampleParts(): { table: HTMLCanvasElement; pizza: HTMLCanvasElement } {
  if (!table) {
    table = document.createElement('canvas');
    table.width = SAMPLE_W;
    table.height = SAMPLE_H;
    const ctx = table.getContext('2d')!;
    const rand = mulberry32(42);
    const planks = 7;
    const pw = SAMPLE_W / planks;
    const tones = ['#5a3a22', '#6b4428', '#4e321d', '#63402a', '#573820', '#6f4a2c', '#51341f'];
    for (let i = 0; i < planks; i++) {
      ctx.fillStyle = tones[i % tones.length]!;
      ctx.fillRect(i * pw, 0, pw + 1, SAMPLE_H);
      for (let g = 0; g < 22; g++) {
        const x0 = i * pw + rand() * pw;
        ctx.strokeStyle = `rgba(${rand() < 0.5 ? '30, 18, 10' : '140, 98, 62'}, ${0.12 + rand() * 0.18})`;
        ctx.lineWidth = 0.8 + rand() * 2;
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        for (let y = 0; y <= SAMPLE_H; y += 40) ctx.lineTo(x0 + Math.sin(y / (90 + rand() * 60) + g) * 6, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(15, 8, 4, 0.7)';
      ctx.fillRect(i * pw - 2, 0, 4, SAMPLE_H);
    }
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(245, 236, 215, ${0.1 + rand() * 0.25})`;
      ctx.beginPath();
      ctx.arc(rand() * SAMPLE_W, rand() * SAMPLE_H, 0.6 + rand() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!pizza) {
    const r = SAMPLE_H * 0.4;
    pizza = document.createElement('canvas');
    pizza.width = pizza.height = Math.ceil(r * 2.2);
    const ctx = pizza.getContext('2d')!;
    ctx.translate(pizza.width / 2, pizza.height / 2);
    const k = r / WHOLE_RADIUS;
    ctx.scale(k, k);
    drawWholePizza(ctx);
  }
  return { table, pizza };
}

/** One frame of the sample clip: the classic site's pizza, turning on its table under a moving light. */
export function drawSampleFrame(target: HTMLCanvasElement, t: number): void {
  const { table: bg, pizza: pz } = sampleParts();
  if (target.width !== SAMPLE_W || target.height !== SAMPLE_H) {
    target.width = SAMPLE_W;
    target.height = SAMPLE_H;
  }
  const ctx = target.getContext('2d')!;
  const phase = ((t % SAMPLE_DURATION) / SAMPLE_DURATION) * Math.PI * 2;
  ctx.drawImage(bg, 0, 0);
  const cx = SAMPLE_W / 2;
  const cy = SAMPLE_H / 2 + Math.sin(phase * 2) * 6;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy, SAMPLE_H * 0.395, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(phase - 0.3);
  ctx.drawImage(pz, -pz.width / 2, -pz.height / 2);
  ctx.restore();
  // A warm light circling the table.
  const lx = cx + Math.cos(phase) * SAMPLE_W * 0.3;
  const ly = cy + Math.sin(phase) * SAMPLE_H * 0.25;
  const light = ctx.createRadialGradient(lx, ly, 40, cx, cy, SAMPLE_W * 0.75);
  light.addColorStop(0, 'rgba(255, 214, 150, 0.28)');
  light.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  light.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, SAMPLE_W, SAMPLE_H);
}

export const SAMPLE_SIZE: [number, number] = [SAMPLE_W, SAMPLE_H];
