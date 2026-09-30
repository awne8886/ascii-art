import { describe, expect, it } from 'vitest';
import { EFFECTS, PICKS, effectById, effectSource } from './registry';
import { CATEGORIES } from './types';

describe('the look library', () => {
  it('has unique ids and known categories', () => {
    const ids = EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const e of EFFECTS) expect(cats.has(e.category), e.id).toBe(true);
  });

  it('lists only existing looks as picks', () => {
    for (const id of PICKS) expect(effectById(id), id).toBeDefined();
  });

  it('has params that make valid uniforms, and presets that only set known params', () => {
    for (const e of EFFECTS) {
      const keys = new Set<string>();
      for (const p of e.params) {
        expect(p.key, e.id).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
        expect(keys.has(p.key), `${e.id}.${p.key} twice`).toBe(false);
        keys.add(p.key);
        if (p.type === 'range') {
          expect(p.min, `${e.id}.${p.key}`).toBeLessThan(p.max);
          expect(p.default, `${e.id}.${p.key}`).toBeGreaterThanOrEqual(p.min);
          expect(p.default, `${e.id}.${p.key}`).toBeLessThanOrEqual(p.max);
        }
        if (p.type === 'select')
          expect(
            p.options.some((o) => o.value === p.default),
            `${e.id}.${p.key}`,
          ).toBe(true);
      }
      for (const preset of e.presets ?? []) {
        for (const k of Object.keys(preset.values))
          expect(keys.has(k), `${e.id} preset ${preset.name}: ${k}`).toBe(true);
      }
    }
  });

  it('builds a shader with one uniform per param', () => {
    for (const e of EFFECTS) {
      const src = effectSource(e);
      expect(src, e.id).toContain('vec4 effect(vec2 uv)');
      for (const p of e.params) {
        if (p.type !== 'text') expect(src, `${e.id}.${p.key}`).toContain(`u_${p.key};`);
      }
    }
  });
});
