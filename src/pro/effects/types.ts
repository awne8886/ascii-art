/**
 * What a "look" is: a named fragment shader plus the parameters the inspector
 * shows for it.
 *
 * Every effect is one full-screen pass over a layer (or the whole canvas). Its
 * GLSL defines `vec4 effect(vec2 uv)`; the wrapper in `program.ts` adds the
 * shared prelude (helpers + uniforms, see `prelude.ts`), one uniform per
 * parameter (`u_<key>`), and the strength / blend / "appears in" mix.
 */

export type CategoryId =
  'light' | 'type' | 'halftone' | 'craft' | 'pixel' | 'edges' | 'glitch' | 'analog' | 'experimental' | 'tracking';

export const CATEGORIES: ReadonlyArray<{ id: CategoryId; label: string }> = [
  { id: 'light', label: 'Light & glass' },
  { id: 'type', label: 'Type & code' },
  { id: 'halftone', label: 'Halftone & dither' },
  { id: 'craft', label: 'Textile & craft' },
  { id: 'pixel', label: 'Pixel & 3D' },
  { id: 'edges', label: 'Edges & outlines' },
  { id: 'glitch', label: 'Analog & glitch' },
  { id: 'analog', label: 'Analog' },
  { id: 'experimental', label: 'Experimental' },
  { id: 'tracking', label: 'Tracking & interface' },
];

export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

interface ParamBase {
  /** Uniform `u_<key>` in the shader. Letters, digits and underscores only. */
  key: string;
  label: string;
  hint?: string;
  /** Inspector group ("Shape", "Tone", "Ink", "Light"…). Ungrouped params show first, under "Pins". */
  group?: string;
}

/** `float u_<key>`. */
export interface RangeParam extends ParamBase {
  type: 'range';
  min: number;
  max: number;
  step?: number;
  default: number;
  /** Shown after the number: '%', '°', 'px', '×'. */
  unit?: string;
}

/** `vec3 u_<key>`, sRGB 0–1. The value is '#rrggbb'. */
export interface ColorParam extends ParamBase {
  type: 'color';
  default: string;
}

/** `float u_<key>`, 0 or 1. */
export interface ToggleParam extends ParamBase {
  type: 'toggle';
  default: boolean;
}

/** `float u_<key>`: the chosen option's value (use `int(u_key + 0.5)`). */
export interface SelectParam extends ParamBase {
  type: 'select';
  options: ReadonlyArray<{ value: number; label: string }>;
  default: number;
}

/** No uniform: text feeds the glyph atlas (see `EffectDef.atlas`). */
export interface TextParam extends ParamBase {
  type: 'text';
  default: string;
  maxLength?: number;
}

export type ParamDef = RangeParam | ColorParam | ToggleParam | SelectParam | TextParam;

/**
 * Glyphs an effect draws with. The renderer draws them white on transparent
 * into a texture atlas (square-ish cells, mipmapped) available to the shader
 * as `u_atlas`, read with `glyph(index, p, cellPx)`.
 */
export interface AtlasSpec {
  glyphs: readonly string[];
  /** Sort sparse → dense by measured ink (for tone ramps). Default false: keep the given order. */
  sortByInk?: boolean;
  font?: 'mono' | 'sans' | 'serif';
  /** CSS font weight. Default 700. */
  weight?: number;
  /** Cell width / height. Default 1 (square). Use > 1 for words. */
  cellAspect?: number;
  /** Glyph height as a fraction of the cell height. Default 0.8. */
  fill?: number;
}

export interface Preset {
  name: string;
  /** Only the params that differ from the defaults. */
  values: ParamValues;
}

export interface EffectDef {
  /** Stable id, kebab-case: saved projects refer to it. */
  id: string;
  name: string;
  category: CategoryId;
  /** One sentence for the library card's tooltip. */
  description: string;
  /** Listed under "Our picks". */
  pick?: boolean;
  params: readonly ParamDef[];
  presets?: readonly Preset[];
  /** Glyph atlas for the current params, or null for none. */
  atlas?: (p: ParamValues) => AtlasSpec | null;
  /** Reads `u_prev`, this effect's own output from the previous frame. */
  feedback?: boolean;
  /** GLSL defining `vec4 effect(vec2 uv)` (and any helpers it needs). */
  glsl: string;
}

export function defaultParams(def: EffectDef): ParamValues {
  const out: ParamValues = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

/** Params of a preset, over the defaults. */
export function presetParams(def: EffectDef, preset: Preset | undefined): ParamValues {
  return { ...defaultParams(def), ...(preset?.values ?? {}) };
}
