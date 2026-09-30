import { describe, expect, it } from 'vitest';
import { GLYPH_SETS, sortByInk, uniqueGlyphs } from './glyphs';

describe('glyphs', () => {
  it('keeps the original ramp as the classic set', () => {
    expect(GLYPH_SETS.find((s) => s.id === 'classic')?.glyphs).toBe('.:+*=#%@');
  });

  it('dedupes custom text and keeps surrogate pairs whole', () => {
    expect(uniqueGlyphs('aab\nb🍕🍕')).toEqual(['a', 'b', '🍕']);
  });

  it('sorts by ink, stable for ties', () => {
    expect(sortByInk(['@', '.', '#', ':'], [0.5, 0.05, 0.4, 0.05])).toEqual(['.', ':', '#', '@']);
  });
});
