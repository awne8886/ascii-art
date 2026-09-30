import { effectById } from './effects/registry';
import { defaultParams, presetParams, type ParamValues } from './effects/types';

/**
 * The PRO studio's project: a canvas with a timeline, a stack of layers
 * (pictures, videos, webcam, type, shapes), each with its own looks, motion
 * and finish, plus looks and finish for the whole canvas.
 *
 * Plain JSON (media live in the media store, by id), so it can be saved,
 * undone and redone wholesale.
 */

/** Index into BLEND_MODES. */
export type BlendMode = number;

/** Where an effect shows: 0 everywhere, 1 brights, 2 darks, 3 centre, 4 edges. */
export type Appears = 0 | 1 | 2 | 3 | 4;

/** Drives a numeric param over time: a seamless loop between its value and `to`, or the layer's sound. */
export interface Modulation {
  source: 'loop' | 'sound';
  to: number;
  /** Loop cycles per timeline length (whole numbers loop seamlessly). */
  cycles: number;
}

export interface EffectInstance {
  uid: string;
  effectId: string;
  enabled: boolean;
  strength: number;
  blend: BlendMode;
  appears: Appears;
  appearsSoft: number;
  appearsInvert: boolean;
  params: ParamValues;
  mods: Record<string, Modulation>;
  /** Preset last applied, for the inspector. */
  preset?: string;
  seed: number;
}

export interface BloomSettings {
  on: boolean;
  intensity: number;
  radius: number;
  threshold: number;
}

export interface StreakSettings {
  on: boolean;
  intensity: number;
  length: number;
  threshold: number;
  tint: string;
}

export interface TrailSettings {
  on: boolean;
  /** How long trails last, 0–0.98 of the previous frame kept. */
  amount: number;
}

export interface PaperSettings {
  on: boolean;
  grain: number;
  fibres: number;
  tint: string;
  tintAmount: number;
}

export interface GradeSettings {
  on: boolean;
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  fade: number;
  vignette: number;
  hue: number;
}

export interface LayerFinish {
  bloom: BloomSettings;
  streaks: StreakSettings;
  trails: TrailSettings;
}

export interface CanvasFinish extends LayerFinish {
  paper: PaperSettings;
  grade: GradeSettings;
}

export type MotionType =
  | 'drift'
  | 'float'
  | 'sway'
  | 'spin'
  | 'pulse'
  | 'orbit'
  | 'bounce'
  | 'zoom'
  | 'shake'
  | 'swing'
  | 'tumble'
  | 'breathe';

export interface MotionInstance {
  uid: string;
  type: MotionType;
  enabled: boolean;
  /** 0–2: how far. */
  amount: number;
  /** Cycles per timeline length (whole numbers loop seamlessly). */
  cycles: number;
  /** 0–1 offset within the cycle. */
  phase: number;
}

export type LayerKind = 'image' | 'video' | 'webcam' | 'text' | 'shape' | 'sample';
export type Fit = 'fit' | 'fill' | 'stretch' | 'original';
export type ShapeType = 'circle' | 'square' | 'triangle' | 'star' | 'ring' | 'sphere' | 'blob' | 'heart';

export interface TextProps {
  text: string;
  font: 'mono' | 'sans' | 'serif' | 'display';
  weight: number;
  /** Font size as a fraction of the canvas height. */
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineHeight: number;
  italic: boolean;
  background: string;
  backgroundOn: boolean;
}

export interface ShapeProps {
  shape: ShapeType;
  /** Size as a fraction of the canvas height. */
  size: number;
  aspect: number;
  color: string;
  color2: string;
  gradient: boolean;
  stroke: number;
  corner: number;
}

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  mediaId?: string;
  text?: TextProps;
  shape?: ShapeProps;
  visible: boolean;
  locked: boolean;

  // Placement: offsets are fractions of the canvas size, from its centre.
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  fit: Fit;
  stretchX: number;
  stretchY: number;
  // 3D
  tiltX: number;
  tiltY: number;
  perspective: number;

  // Compositing
  opacity: number;
  blend: BlendMode;

  // Time (seconds): where the layer starts on the timeline, and how much of the media it plays.
  start: number;
  /** Seconds on the timeline; for media, trimmed by `in` too. */
  length: number;
  /** Seconds into the media where playback starts. */
  in: number;
  speed: number;
  loopMedia: boolean;

  // Sound
  muted: boolean;
  volume: number;

  effects: EffectInstance[];
  motion: MotionInstance[];
  finish: LayerFinish;
}

export type Background = 'transparent' | 'light' | 'dark' | 'color';

export interface CanvasSettings {
  width: number;
  height: number;
  background: Background;
  color: string;
  fps: number;
  duration: number;
  loop: boolean;
}

export interface Project {
  version: 1;
  name: string;
  canvas: CanvasSettings;
  layers: Layer[];
  effects: EffectInstance[];
  finish: CanvasFinish;
}

// ─── Factories ───────────────────────────────────────────────────────────────

let uidSeq = 0;
export function uid(prefix = 'id'): string {
  uidSeq = (uidSeq + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${uidSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const ASPECTS: ReadonlyArray<{ label: string; w: number; h: number }> = [
  { label: '16:9', w: 1920, h: 1080 },
  { label: '9:16', w: 1080, h: 1920 },
  { label: '1:1', w: 1080, h: 1080 },
  { label: '4:5', w: 1080, h: 1350 },
  { label: '4:3', w: 1440, h: 1080 },
  { label: '21:9', w: 2520, h: 1080 },
];

export const FRAME_RATES = [8, 10, 12, 15, 24, 25, 30, 50, 60] as const;

export function defaultLayerFinish(): LayerFinish {
  return {
    bloom: { on: false, intensity: 0.8, radius: 0.6, threshold: 0.55 },
    streaks: { on: false, intensity: 0.7, length: 0.6, threshold: 0.6, tint: '#ffd978' },
    trails: { on: false, amount: 0.8 },
  };
}

export function defaultCanvasFinish(): CanvasFinish {
  return {
    ...defaultLayerFinish(),
    paper: { on: false, grain: 0.35, fibres: 0.4, tint: '#f5ecd7', tintAmount: 0.15 },
    grade: {
      on: false,
      exposure: 0,
      contrast: 1,
      saturation: 1,
      temperature: 0,
      tint: 0,
      fade: 0,
      vignette: 0.3,
      hue: 0,
    },
  };
}

export function newProject(name = 'Untitled'): Project {
  return {
    version: 1,
    name,
    canvas: { width: 1920, height: 1080, background: 'dark', color: '#101010', fps: 30, duration: 6, loop: true },
    layers: [],
    effects: [],
    finish: defaultCanvasFinish(),
  };
}

export function newEffect(effectId: string, presetName?: string): EffectInstance {
  const def = effectById(effectId);
  const preset = def?.presets?.find((p) => p.name === presetName);
  return {
    uid: uid('fx'),
    effectId,
    enabled: true,
    strength: 1,
    blend: 0,
    appears: 0,
    appearsSoft: 0.2,
    appearsInvert: false,
    params: def ? presetParams(def, preset) : {},
    mods: {},
    preset: preset?.name ?? def?.presets?.[0]?.name,
    seed: Math.random(),
  };
}

export function defaultText(): TextProps {
  return {
    text: 'PIZZA',
    font: 'display',
    weight: 800,
    size: 0.22,
    color: '#f5ecd7',
    align: 'center',
    letterSpacing: 0.02,
    lineHeight: 1.05,
    italic: false,
    background: '#ff5a3c',
    backgroundOn: false,
  };
}

export function defaultShape(shape: ShapeType): ShapeProps {
  return {
    shape,
    size: 0.5,
    aspect: 1,
    color: shape === 'sphere' ? '#ffc53d' : '#f5ecd7',
    color2: '#ff5a3c',
    gradient: shape === 'blob',
    stroke: 0,
    corner: shape === 'square' ? 0.08 : 0,
  };
}

export function newLayer(kind: LayerKind, name: string, extra: Partial<Layer> = {}): Layer {
  return {
    id: uid('layer'),
    name,
    kind,
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
    fit: kind === 'text' || kind === 'shape' ? 'original' : 'fit',
    stretchX: 1,
    stretchY: 1,
    tiltX: 0,
    tiltY: 0,
    perspective: 0.6,
    opacity: 1,
    blend: 0,
    start: 0,
    length: 6,
    in: 0,
    speed: 1,
    loopMedia: true,
    muted: false,
    volume: 1,
    effects: [],
    motion: [],
    finish: defaultLayerFinish(),
    ...extra,
  };
}

export function newMotion(type: MotionType): MotionInstance {
  return { uid: uid('mo'), type, enabled: true, amount: 0.5, cycles: 1, phase: 0 };
}

/** Params with their modulations applied at time t (seconds). */
export function resolveParams(fx: EffectInstance, t: number, duration: number, sound: number): ParamValues {
  const keys = Object.keys(fx.mods);
  if (keys.length === 0) return fx.params;
  const out = { ...fx.params };
  for (const key of keys) {
    const m = fx.mods[key]!;
    const from = fx.params[key];
    if (typeof from !== 'number') continue;
    const k =
      m.source === 'sound'
        ? Math.max(0, Math.min(1, sound))
        : 0.5 - 0.5 * Math.cos((t / Math.max(duration, 1e-3)) * Math.PI * 2 * Math.max(1, Math.round(m.cycles)));
    out[key] = from + (m.to - from) * k;
  }
  return out;
}

/** Whether the layer is on screen at time t. */
export function layerActive(layer: Layer, t: number): boolean {
  return layer.visible && t >= layer.start - 1e-6 && t < layer.start + layer.length - 1e-6;
}

/** Seconds into the layer's media at timeline time t, or null past its end (when it doesn't loop). */
export function mediaTime(layer: Layer, t: number, mediaDuration: number): number | null {
  const local = Math.max(0, t - layer.start) * layer.speed;
  const span = Math.max(0.001, mediaDuration - layer.in);
  if (local >= span) {
    if (!layer.loopMedia) return Math.max(0, mediaDuration - 0.001);
    return layer.in + (local % span);
  }
  return layer.in + local;
}

/** Fresh defaults for params the effect gained since a project was saved. */
export function upgradeEffect(fx: EffectInstance): EffectInstance {
  const def = effectById(fx.effectId);
  if (!def) return fx;
  return { ...fx, params: { ...defaultParams(def), ...fx.params } };
}
