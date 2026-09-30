import { CRAFT_EFFECTS } from './craft';
import { EDGES_EFFECTS } from './edges';
import { EXPERIMENTAL_EFFECTS } from './experimental';
import { GLITCH_EFFECTS } from './glitch';
import { HALFTONE_EFFECTS } from './halftone';
import { PIXEL_EFFECTS } from './pixel';
import { EFFECT_MAIN, PRELUDE } from './prelude';
import { TYPE_EFFECTS } from './type';
import { CATEGORIES, type CategoryId, type EffectDef } from './types';

/** Every look, in library order (by category, then name). */
export const EFFECTS: readonly EffectDef[] = (() => {
  const all = [
    ...TYPE_EFFECTS,
    ...HALFTONE_EFFECTS,
    ...CRAFT_EFFECTS,
    ...PIXEL_EFFECTS,
    ...EDGES_EFFECTS,
    ...GLITCH_EFFECTS,
    ...EXPERIMENTAL_EFFECTS,
  ];
  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  return all.sort((a, b) => order.get(a.category)! - order.get(b.category)! || a.name.localeCompare(b.name));
})();

const BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));

export function effectById(id: string): EffectDef | undefined {
  return BY_ID.get(id);
}

/** "Our picks" first, in a fixed order where one is given. */
export const PICKS: readonly string[] = [
  'ascii',
  'dither-text',
  'stardust',
  'riso-glow',
  'pixel-poster',
  'dithering',
  'contour-map',
  'holo',
  'drift-lines',
  'retro-matrix',
  'number-field',
  'riso',
  'halftone',
  'thermal',
];

export function picks(): EffectDef[] {
  const listed = PICKS.map((id) => BY_ID.get(id)).filter((e): e is EffectDef => !!e);
  const extra = EFFECTS.filter((e) => e.pick && !PICKS.includes(e.id));
  return [...listed, ...extra];
}

export function byCategory(id: CategoryId): EffectDef[] {
  return EFFECTS.filter((e) => e.category === id);
}

/** Full fragment shader source for an effect. */
export function effectSource(def: EffectDef): string {
  const uniforms = def.params
    .filter((p) => p.type !== 'text')
    .map((p) => `uniform ${p.type === 'color' ? 'vec3' : 'float'} u_${p.key};`)
    .join('\n');
  return `${PRELUDE}\n${uniforms}\n#line 1\n${def.glsl}\n${EFFECT_MAIN}`;
}
