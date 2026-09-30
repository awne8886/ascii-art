import { SAMPLE_DURATION } from './sources';
import {
  defaultShape,
  defaultText,
  newEffect,
  newLayer,
  newMotion,
  newProject,
  type EffectInstance,
  type Layer,
  type Project,
} from './model';

/**
 * Complete projects to start from. They use only drawn layers (the sample
 * clip, type, shapes), so they need no files; replace the sample with your
 * own picture or video and keep going.
 */

export type TemplateFormat = 'landscape' | 'portrait' | 'square';

export interface Template {
  id: string;
  name: string;
  format: TemplateFormat;
  description: string;
  build: () => Project;
}

function fx(id: string, preset?: string, patch: Partial<EffectInstance> = {}): EffectInstance {
  return { ...newEffect(id, preset), ...patch };
}

function sample(extra: Partial<Layer> = {}): Layer {
  return newLayer('sample', 'Sample clip', { fit: 'fill', length: SAMPLE_DURATION, ...extra });
}

function project(
  name: string,
  w: number,
  h: number,
  duration: number,
  layers: Layer[],
  extra: Partial<Project> = {},
): Project {
  const p = newProject(name);
  p.canvas = { ...p.canvas, width: w, height: h, duration };
  p.layers = layers.map((l) => ({ ...l, length: Math.max(l.length, duration) }));
  return { ...p, ...extra };
}

function text(t: string, extra: Partial<Layer> = {}, props: Partial<ReturnType<typeof defaultText>> = {}): Layer {
  return newLayer('text', t.split('\n')[0]!.slice(0, 24), { text: { ...defaultText(), text: t, ...props }, ...extra });
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'pizza-wave',
    name: 'Pizza wave',
    format: 'landscape',
    description: 'The classic site’s rippling colour ASCII, with bloom.',
    build: () => {
      const p = project('Pizza wave', 1920, 1080, 6, [sample({ effects: [fx('ascii')] })]);
      p.finish.bloom = { ...p.finish.bloom, on: true, intensity: 0.9 };
      return p;
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    format: 'landscape',
    description: 'Green phosphor ASCII behind a CRT.',
    build: () => project('Terminal', 1920, 1080, 6, [sample({ effects: [fx('ascii', 'Terminal'), fx('crt-screen')] })]),
  },
  {
    id: 'riso-poster',
    name: 'Riso poster',
    format: 'portrait',
    description: 'Two-ink risograph with a bold headline.',
    build: () =>
      project('Riso poster', 1080, 1350, 6, [
        sample({ effects: [fx('riso')], scale: 1.1 }),
        text(
          'PIZZA\nNIGHT',
          { y: -0.3, motion: [newMotion('float')] },
          { color: '#ff48b0', size: 0.14, font: 'display' },
        ),
      ]),
  },
  {
    id: 'matrix-title',
    name: 'Matrix title',
    format: 'landscape',
    description: 'A title that rains katakana.',
    build: () => {
      const p = project('Matrix title', 1920, 1080, 6, [
        text('HELLO, WORLD', {}, { size: 0.16, font: 'mono', color: '#7fe08f' }),
      ]);
      p.effects = [fx('matrix-rain')];
      p.finish.bloom = { ...p.finish.bloom, on: true };
      return p;
    },
  },
  {
    id: 'thermal-cam',
    name: 'Thermal cam',
    format: 'landscape',
    description: 'Heat camera with a tracking HUD.',
    build: () => project('Thermal cam', 1920, 1080, 6, [sample({ effects: [fx('thermal'), fx('brand-generator')] })]),
  },
  {
    id: 'halftone-story',
    name: 'Halftone story',
    format: 'portrait',
    description: 'CMYK dots, vertical, for stories.',
    build: () =>
      project('Halftone story', 1080, 1920, 6, [
        sample({ effects: [fx('halftone', 'CMYK print')], scale: 1 }),
        text(
          'FRESH\nOUT OF\nTHE OVEN',
          { y: 0.32 },
          { size: 0.07, color: '#15120e', backgroundOn: true, background: '#ffc53d' },
        ),
      ]),
  },
  {
    id: 'neon-orb',
    name: 'Neon orb',
    format: 'square',
    description: 'An orbiting sphere in glowing dither.',
    build: () => {
      const orb = newLayer('shape', 'Sphere', { shape: { ...defaultShape('sphere'), size: 0.45 } });
      orb.motion = [{ ...newMotion('orbit'), amount: 0.8 }, newMotion('pulse')];
      orb.effects = [fx('pixel-dither-glow')];
      const p = project('Neon orb', 1080, 1080, 6, [orb]);
      p.finish.bloom = { ...p.finish.bloom, on: true, intensity: 1.2 };
      p.finish.trails = { on: true, amount: 0.85 };
      return p;
    },
  },
  {
    id: 'contour',
    name: 'Contour map',
    format: 'square',
    description: 'Your picture as a topographic map.',
    build: () => project('Contour map', 1080, 1080, 6, [sample({ effects: [fx('contour-map')] })]),
  },
  {
    id: 'vhs',
    name: 'VHS memories',
    format: 'landscape',
    description: 'Tape wobble and film light leaks.',
    build: () => {
      const p = project('VHS memories', 1920, 1080, 6, [sample({ effects: [fx('vhs'), fx('film-prism')] })]);
      p.finish.grade = { ...p.finish.grade, on: true, fade: 0.2, temperature: 0.3, vignette: 0.4 };
      return p;
    },
  },
  {
    id: 'stardust',
    name: 'Stardust',
    format: 'landscape',
    description: 'A night sky of twinkling points.',
    build: () => {
      const p = project('Stardust', 1920, 1080, 6, [sample({ effects: [fx('stardust')] })]);
      p.finish.bloom = { ...p.finish.bloom, on: true, intensity: 1.1, threshold: 0.4 };
      return p;
    },
  },
  {
    id: 'bricks',
    name: 'Toy bricks',
    format: 'square',
    description: 'Built from plastic bricks, gently spinning.',
    build: () =>
      project('Toy bricks', 1080, 1080, 6, [
        sample({ effects: [fx('3d-toy-bricks')], motion: [{ ...newMotion('swing'), amount: 0.4 }] }),
      ]),
  },
  {
    id: 'type-poster',
    name: 'Type poster',
    format: 'portrait',
    description: 'Dither text over a moving picture.',
    build: () =>
      project('Type poster', 1080, 1350, 6, [
        sample({ effects: [fx('dither-text')], motion: [newMotion('zoom')] }),
        text(
          'ascii art',
          { y: 0.38 },
          { font: 'mono', size: 0.06, color: '#f5ecd7', backgroundOn: true, background: '#000000' },
        ),
      ]),
  },
];
