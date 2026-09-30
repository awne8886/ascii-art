import { describe, expect, it } from 'vitest';
import { crc32, ZipWriter } from './zip';

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('ZipWriter', () => {
  it('writes local headers, a central directory and the end record', async () => {
    const zip = new ZipWriter();
    zip.add('a/frame_00001.png', new Uint8Array([1, 2, 3]));
    zip.add('a/frame_00002.png', new Uint8Array([4, 5]));
    const bytes = new Uint8Array(await zip.finish().arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const cdOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(cdOffset, true)).toBe(0x02014b50);
    // Stored data follows the first header and its name.
    const nameLen = view.getUint16(26, true);
    expect(Array.from(bytes.subarray(30 + nameLen, 33 + nameLen))).toEqual([1, 2, 3]);
  });
});
