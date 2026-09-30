import { pizzaSample } from '../../sample';
import { EFFECTS } from '../effects/registry';
import { ProRenderer } from '../gl/renderer';
import { newEffect, newLayer, newProject } from '../model';

/**
 * Development contact sheet (`#/pro-sheet`): every look (or `?only=a,b`),
 * optionally every preset (`&presets=1`), rendered on the pizza sample at
 * time `&t=` seconds, with shader errors listed. `window.__sheet` reports
 * `{ done, errors }` for scripted checks.
 */
export function mountSheet(root: HTMLElement): void {
  // React's StrictMode mounts effects twice in development.
  if (root.dataset.mounted) return;
  root.dataset.mounted = '1';
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const only = params.get('only')?.split(',').filter(Boolean);
  const withPresets = params.get('presets') === '1';
  const t = Number(params.get('t') ?? '1.5');
  const w = Number(params.get('w') ?? '420');
  const h = Number(params.get('h') ?? '300');
  const frames = Number(params.get('frames') ?? '6');
  document.body.style.overflow = 'auto';
  root.style.cssText = 'padding:16px;font:12px ui-monospace,monospace;color:#f5ecd7;background:#000';
  const status = document.createElement('div');
  status.style.cssText = 'margin-bottom:12px;font-size:14px';
  root.append(status);
  const gridEl = document.createElement('div');
  gridEl.style.cssText = `display:grid;grid-template-columns:repeat(auto-fill,minmax(${w}px,1fr));gap:12px`;
  root.append(gridEl);

  const glCanvas = document.createElement('canvas');
  const renderer = new ProRenderer(glCanvas, { preserveDrawingBuffer: true });
  const sample = pizzaSample();
  const errors: Record<string, string> = {};
  (window as unknown as { __sheet: unknown }).__sheet = { done: false, errors };

  const jobs: { effectId: string; preset?: string; label: string }[] = [];
  for (const def of EFFECTS) {
    if (only && !only.includes(def.id)) continue;
    const presets = withPresets ? (def.presets ?? []).map((p) => p.name) : [undefined];
    for (const preset of presets.length ? presets : [undefined]) {
      jobs.push({ effectId: def.id, preset, label: `${def.name}${preset ? ` · ${preset}` : ''} (${def.category})` });
    }
  }
  status.textContent = `${jobs.length} renders…`;

  let i = 0;
  const step = () => {
    const job = jobs[i++];
    if (!job) {
      const n = Object.keys(errors).length;
      status.textContent = `${jobs.length} renders, ${EFFECTS.length} looks, ${n} shader error${n === 1 ? '' : 's'}`;
      (window as unknown as { __sheet: { done: boolean } }).__sheet.done = true;
      return;
    }
    const project = newProject();
    project.canvas = { ...project.canvas, width: w, height: h, duration: 6 };
    const layer = newLayer('image', 'sample', { fit: 'fill', id: `sheet-${i}` });
    layer.effects = [newEffect(job.effectId, job.preset)];
    project.layers = [layer];
    for (let f = 0; f < frames; f++) {
      const time = t - (frames - 1 - f) / 30;
      renderer.renderFrame({
        project,
        time,
        frame: Math.round(time * 30),
        width: w,
        height: h,
        frameOf: () => ({ source: sample, width: sample.width, height: sample.height, version: 1 }),
      });
    }
    const img = renderer.readPixels();
    const card = document.createElement('figure');
    card.style.cssText = 'margin:0';
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.style.cssText = 'width:100%;display:block;background:#222';
    if (img) c.getContext('2d')!.putImageData(img, 0, 0);
    const cap = document.createElement('figcaption');
    cap.textContent = job.label;
    card.append(c, cap);
    const err = renderer.errors.get(job.effectId);
    if (err) {
      errors[job.effectId] = err;
      const pre = document.createElement('pre');
      pre.style.cssText = 'color:#ff6f5e;white-space:pre-wrap;margin:4px 0 0';
      pre.textContent = err;
      card.append(pre);
    }
    gridEl.append(card);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
