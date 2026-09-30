import { type GlyphSetId } from './ascii/glyphs';

/**
 * What is drawn where once the subject has been separated from the background.
 *
 * - `subject`: ASCII subject on black (optionally with the pizza renderer's dim stars).
 * - `subject-on-photo`: ASCII subject, the untouched photo as background.
 * - `photo-on-ascii`: the photo's subject, ASCII background.
 */
export type Composition = 'subject' | 'subject-on-photo' | 'photo-on-ascii';

/** `photo`: every glyph keeps its own colour. `palette`: an adaptive palette of "materials", like the pizza. `mono`: one tint. */
export type ColorMode = 'photo' | 'palette' | 'mono';

export type SegmentMethod = 'ai-fast' | 'ai-hq' | 'classic';

export interface Settings {
  // Characters
  /** Cell height in CSS px: smaller is more detailed. */
  charSize: number;
  glyphSet: GlyphSetId;
  customGlyphs: string;
  /** Sparser (−) or denser (+) glyphs than the lightness alone picks. */
  density: number;
  /** Draw strong edges with line glyphs (- | / \). */
  edges: boolean;

  // Colour & tone
  colorMode: ColorMode;
  paletteSize: number;
  monoColor: string;
  /** Stretch levels and balance mid-tones automatically. */
  autoTone: boolean;
  brightness: number;
  contrast: number;
  saturation: number;

  // Animation
  animate: boolean;
  wave: boolean;
  waveAmplitude: number;
  waveSpeed: number;
  waveScale: number;
  /** Diagonal light bands sweeping across the glyphs. */
  bands: number;
  /** Sparse random flicker. */
  sparkle: boolean;

  // Bloom
  bloom: boolean;
  bloomIntensity: number;
  bloomRadius: number;
  bloomThreshold: number;
  /** Glow baked into the brightest glyphs (the original renderer's). */
  glyphGlow: number;

  // Subject
  separate: boolean;
  segmentMethod: SegmentMethod;
  composition: Composition;
  maskThreshold: number;
  maskSoftness: number;
  /** Grow (+) or shrink (−) the subject, in % of the image's longer side. */
  maskExpand: number;
  invertMask: boolean;
  /** Photo showing through behind the glyphs, 0–1. */
  photoUnder: number;
  /** Brightness of the photo background, 0–1. */
  bgDim: number;
  /** Blur of the photo background, 0–1. */
  bgBlur: number;
  stars: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  charSize: 10,
  glyphSet: 'classic',
  customGlyphs: 'ASCII',
  density: 0.1,
  edges: false,

  colorMode: 'photo',
  paletteSize: 12,
  monoColor: '#7fe08f',
  autoTone: true,
  brightness: 0,
  contrast: 1,
  saturation: 1.15,

  animate: true,
  wave: true,
  waveAmplitude: 1,
  waveSpeed: 1,
  waveScale: 1,
  bands: 0.8,
  sparkle: true,

  bloom: true,
  bloomIntensity: 0.8,
  bloomRadius: 0.55,
  bloomThreshold: 0.45,
  glyphGlow: 1,

  separate: false,
  segmentMethod: 'ai-fast',
  composition: 'subject',
  maskThreshold: 0.5,
  maskSoftness: 0.2,
  maskExpand: 0,
  invertMask: false,
  photoUnder: 0,
  bgDim: 1,
  bgBlur: 0,
  stars: true,
};

const STORAGE_KEY = 'ascii-art:settings:v1';

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Saved settings merged over the defaults; anything unreadable is ignored. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, animate: !prefersReducedMotion() };
    const saved = JSON.parse(raw) as Partial<Settings>;
    const out = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (key in saved && typeof saved[key] === typeof DEFAULT_SETTINGS[key]) {
        (out as Record<string, unknown>)[key] = saved[key];
      }
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: settings just don't persist.
  }
}
