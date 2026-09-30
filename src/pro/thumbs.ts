import { useEffect, useState } from 'react';
import { pizzaSample } from '../sample';
import { DrawnCache } from './frames';
import { ProRenderer, type LayerFrame } from './gl/renderer';
import { newEffect, newLayer, newProject, type EffectInstance, type Layer, type Project } from './model';

/**
 * Small previews for the look library, presets, saved looks and templates.
 * One hidden renderer draws them a few per animation frame, newest request
 * first, and caches them as data URLs.
 */

export const THUMB_W = 240;
export const THUMB_H = 150;

type Job = { key: string; build: () => { project: Project; frameOf: (l: Layer) => LayerFrame | null } };

const cache = new Map<string, string>();
const waiting = new Map<string, Set<(url: string) => void>>();
const queue: Job[] = [];
let renderer: ProRenderer | null = null;
let failed = false;
let scheduled = false;
let sample: HTMLCanvasElement | null = null;
let drawn: DrawnCache | null = null;
let out: HTMLCanvasElement | null = null;

function sampleFrame(): LayerFrame {
  sample ??= pizzaSample();
  return { source: sample, width: sample.width, height: sample.height, version: 'pizza' };
}

function pump(): void {
  scheduled = false;
  if (failed) return;
  try {
    renderer ??= new ProRenderer(document.createElement('canvas'), { preserveDrawingBuffer: true });
  } catch {
    failed = true;
    return;
  }
  const start = performance.now();
  while (queue.length && performance.now() - start < 24) {
    const job = queue.pop()!;
    if (cache.has(job.key)) continue;
    const { project, frameOf } = job.build();
    const w = project.canvas.width;
    const h = project.canvas.height;
    for (let f = 0; f < 3; f++) {
      const time = 1.5 + f / 30;
      renderer.renderFrame({ project, time, frame: 45 + f, width: w, height: h, frameOf, still: false });
    }
    const img = renderer.readPixels();
    out ??= document.createElement('canvas');
    out.width = w;
    out.height = h;
    let url = '';
    if (img) {
      out.getContext('2d')!.putImageData(img, 0, 0);
      url = out.toDataURL('image/jpeg', 0.82);
    }
    cache.set(job.key, url);
    waiting.get(job.key)?.forEach((fn) => fn(url));
    waiting.delete(job.key);
  }
  if (queue.length) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(pump);
}

function request(job: Job, cb: (url: string) => void): () => void {
  const hit = cache.get(job.key);
  if (hit !== undefined) {
    cb(hit);
    return () => {};
  }
  let set = waiting.get(job.key);
  if (!set) waiting.set(job.key, (set = new Set()));
  set.add(cb);
  if (!queue.some((j) => j.key === job.key)) queue.push(job);
  schedule();
  return () => {
    set!.delete(cb);
    if (set!.size === 0) {
      waiting.delete(job.key);
      const i = queue.findIndex((j) => j.key === job.key);
      if (i >= 0) queue.splice(i, 1);
    }
  };
}

function stackProject(effects: EffectInstance[]): Project {
  const project = newProject();
  project.canvas = { ...project.canvas, width: THUMB_W, height: THUMB_H };
  project.layers = [{ ...newLayer('image', 'sample', { id: 'thumb', fit: 'fill' }), effects }];
  return project;
}

/** Thumbnail of a look (optionally one preset) on the pizza sample. */
export function useEffectThumb(effectId: string, preset?: string): string | null {
  return useThumb(`fx:${effectId}:${preset ?? ''}`, () => ({
    project: stackProject([{ ...newEffect(effectId, preset), seed: 0.37 }]),
    frameOf: sampleFrame,
  }));
}

/** Thumbnail of a whole stack of looks. */
export function useStackThumb(effects: EffectInstance[]): string | null {
  const key = `stack:${JSON.stringify(effects.map((e) => [e.effectId, e.params, e.strength, e.blend, e.enabled]))}`;
  return useThumb(key, () => ({ project: stackProject(effects), frameOf: sampleFrame }));
}

/** Thumbnail of a project that only uses drawn layers (templates). */
export function useProjectThumb(key: string, build: () => Project): string | null {
  return useThumb(`proj:${key}`, () => {
    const full = build();
    const k = THUMB_W / full.canvas.width;
    const h = Math.round(full.canvas.height * k);
    const project = { ...full, canvas: { ...full.canvas, width: THUMB_W, height: h } };
    // Layers are sized for the full canvas; scale drawn ones down with it.
    drawn ??= new DrawnCache(1);
    const scaled: Project = {
      ...project,
      layers: project.layers.map((l) => ({
        ...l,
        text: l.text ? { ...l.text } : undefined,
        shape: l.shape ? { ...l.shape } : undefined,
      })),
    };
    return {
      project: scaled,
      frameOf: (l) => {
        if (l.kind === 'sample') {
          const c = drawn!.sampleFrame(1.5);
          return { source: c, width: c.width, height: c.height, version: 'sample1.5' };
        }
        if (l.kind === 'image') return sampleFrame();
        const d = drawn!.drawn(l, h);
        return d ? { source: d.canvas, width: d.width, height: d.height, version: drawn!.key(l, h) } : null;
      },
    };
  });
}

function useThumb(key: string, build: Job['build']): string | null {
  const [state, setState] = useState<{ key: string; url: string | null }>(() => ({
    key,
    url: cache.get(key) ?? null,
  }));
  useEffect(() => request({ key, build }, (url) => setState({ key, url })), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? state.url : (cache.get(key) ?? null);
}
