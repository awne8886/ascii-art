import { mulberry32 } from './ascii/color';
import { drawWholePizza, WHOLE_RADIUS } from './ascii/pizzaArt';

/**
 * The demo picture shown before anything is uploaded: the original
 * renderer's pizza illustration, served on a wooden table, so there's a
 * clear subject and background to play with.
 */
export function pizzaSample(): HTMLCanvasElement {
  const w = 1400;
  const h = 1000;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(42);

  // Planks.
  const planks = 7;
  const pw = w / planks;
  const tones = ['#5a3a22', '#6b4428', '#4e321d', '#63402a', '#573820', '#6f4a2c', '#51341f'];
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = tones[i % tones.length]!;
    ctx.fillRect(i * pw, 0, pw + 1, h);
    // Grain.
    for (let g = 0; g < 26; g++) {
      const x0 = i * pw + rand() * pw;
      ctx.strokeStyle = `rgba(${rand() < 0.5 ? '30, 18, 10' : '140, 98, 62'}, ${0.12 + rand() * 0.18})`;
      ctx.lineWidth = 0.8 + rand() * 2.2;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      for (let y = 0; y <= h; y += 40) ctx.lineTo(x0 + Math.sin(y / (90 + rand() * 60) + g) * 6, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(15, 8, 4, 0.7)';
    ctx.fillRect(i * pw - 2, 0, 4, h);
  }

  // Warm light from the top left, dark corners.
  const light = ctx.createRadialGradient(w * 0.35, h * 0.3, 50, w * 0.5, h * 0.5, w * 0.75);
  light.addColorStop(0, 'rgba(255, 214, 150, 0.22)');
  light.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
  light.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, w, h);

  // Flour dust.
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(245, 236, 215, ${0.1 + rand() * 0.25})`;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, 0.6 + rand() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // The pizza, with a soft shadow.
  const radius = h * 0.4;
  const k = radius / WHOLE_RADIUS;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, radius * 0.99, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.3);
  ctx.scale(k, k);
  drawWholePizza(ctx);
  ctx.restore();

  return canvas;
}
