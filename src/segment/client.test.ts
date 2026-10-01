import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type SegmentMessage, type SegmentResponse } from './protocol';

/** What the page sent the (stand-in) worker, and a way to answer. */
const sent: SegmentMessage[] = [];
let answer: (msg: SegmentResponse) => void = () => {};

beforeAll(() => {
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((e: { data: SegmentResponse }) => void) | null = null;
      onerror: unknown = null;
      constructor() {
        answer = (data) => this.onmessage?.({ data });
      }
      postMessage(msg: SegmentMessage) {
        sent.push(msg);
      }
      terminate() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

const image = { rgba: new Uint8ClampedArray(4), width: 1, height: 1 };

describe('segment', () => {
  it('drops a request whose caller gives up: it fails at once, and the worker hears which', async () => {
    const { segment } = await import('./client');
    const ctrl = new AbortController();
    const p = segment('job:0', image, 'ai-hq', undefined, null, ctrl.signal);
    const req = sent.at(-1)!;
    expect('ids' in req).toBe(false);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent.at(-1)).toEqual({ type: 'cancel', ids: [(req as { id: number }).id] });
    // Its answer, if one still comes, goes nowhere.
    answer({ type: 'error', id: (req as { id: number }).id, message: 'late' });
  });

  it('says nothing more once a request has its answer, and never sends one already given up on', async () => {
    const { segment } = await import('./client');
    const ctrl = new AbortController();
    const p = segment('job:1', image, 'classic', undefined, null, ctrl.signal);
    const { id } = sent.at(-1) as { id: number };
    answer({ type: 'result', id, width: 1, height: 1, mask: new Float32Array(1), backend: 'js', ms: 1 });
    await expect(p).resolves.toMatchObject({ backend: 'js' });
    const count = sent.length;
    ctrl.abort();
    expect(sent.length).toBe(count);

    const gone = new AbortController();
    gone.abort();
    await expect(segment('job:2', image, 'ai-fast', undefined, null, gone.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(sent.length).toBe(count);
  });
});
