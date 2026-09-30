import { describe, expect, it } from 'vitest';
import { Lanes } from './lanes';

describe('Lanes', () => {
  it('drops a waiting request once a newer one arrives in the same lane', () => {
    const lanes = new Lanes();
    lanes.arrive('default', 1);
    lanes.arrive('default', 2);
    expect(lanes.superseded('default', 1)).toBe(true);
    expect(lanes.superseded('default', 2)).toBe(false);
  });

  it('keeps lanes apart', () => {
    const lanes = new Lanes();
    lanes.arrive('default', 1);
    lanes.arrive('live:a', 2);
    lanes.arrive('live:b', 3);
    expect(lanes.superseded('default', 1)).toBe(false);
    expect(lanes.superseded('live:a', 2)).toBe(false);
    lanes.arrive('live:a', 4);
    expect(lanes.superseded('live:a', 2)).toBe(true);
    expect(lanes.superseded('live:b', 3)).toBe(false);
  });

  it('never drops requests without a lane', () => {
    const lanes = new Lanes();
    lanes.arrive(null, 1);
    lanes.arrive(null, 2);
    lanes.arrive('default', 3);
    expect(lanes.superseded(null, 1)).toBe(false);
    expect(lanes.superseded(null, 2)).toBe(false);
  });

  it('is not fooled by an older id arriving late', () => {
    const lanes = new Lanes();
    lanes.arrive('default', 5);
    lanes.arrive('default', 3);
    expect(lanes.superseded('default', 5)).toBe(false);
    expect(lanes.superseded('default', 3)).toBe(true);
  });
});
