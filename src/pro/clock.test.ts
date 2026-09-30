import { describe, expect, it } from 'vitest';
import { timecode } from './clock';

describe('timecode', () => {
  it('formats minutes, seconds and frames', () => {
    expect(timecode(0, 30)).toBe('0:00:00');
    expect(timecode(6, 30)).toBe('0:06:00');
    expect(timecode(1.5, 30)).toBe('0:01:15');
    expect(timecode(75.5, 24)).toBe('1:15:12');
  });
});
