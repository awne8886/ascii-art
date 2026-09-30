import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSubject } from './live';

/** The requests the webcam sent, held open until aborted. */
const asked: Array<{ method: string; signal?: AbortSignal }> = [];

vi.mock('../../segment/client', () => ({
  isSuperseded: () => false,
  segment: (_key: string, _input: unknown, method: string, _p: unknown, _lane: string, signal?: AbortSignal) =>
    new Promise((_, reject) => {
      asked.push({ method, signal });
      signal?.addEventListener('abort', () => reject(new DOMException('Separation cancelled.', 'AbortError')));
    }),
}));

const doc = { hidden: false };

beforeEach(() => {
  asked.length = 0;
  doc.hidden = false;
  vi.stubGlobal('document', {
    get hidden() {
      return doc.hidden;
    },
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
      }),
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const camera = { readyState: 4, videoWidth: 64, videoHeight: 48 } as HTMLVideoElement;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('LiveSubject', () => {
  it('aborts its request in flight when it stops (the worker drops it, and a download only it waited on)', async () => {
    const live = new LiveSubject('L1', camera, 'ai-fast', () => {});
    live.start();
    await settle();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.method).toBe('ai-fast');
    expect(asked[0]!.signal?.aborted).toBe(false);
    live.stop();
    expect(asked[0]!.signal?.aborted).toBe(true);
    await settle();
    // Stopped: it asks for nothing more, and the abort is no error.
    expect(asked).toHaveLength(1);
    expect(live.error).toBeNull();
    // Started again: a new request, with its own signal.
    live.start();
    await settle();
    expect(asked).toHaveLength(2);
    expect(asked[1]!.signal?.aborted).toBe(false);
    live.stop();
  });

  it('leaves its request in flight when only nothing draws it for now (a model download carries on)', async () => {
    const live = new LiveSubject('L1', camera, 'ai-fast', () => {});
    live.start();
    await settle();
    live.stop(false);
    expect(asked[0]!.signal?.aborted).toBe(false);
    await settle();
    expect(asked).toHaveLength(1);
    // Drawn again: a new run asks afresh (its request joins the same download in the worker).
    live.start();
    await settle();
    expect(asked).toHaveLength(2);
    live.stop();
    expect(asked[1]!.signal?.aborted).toBe(true);
  });

  it('asks for nothing while the tab is in the background', async () => {
    vi.useFakeTimers();
    try {
      doc.hidden = true;
      const live = new LiveSubject('L1', camera, 'classic', () => {});
      live.start();
      await vi.advanceTimersByTimeAsync(2000);
      expect(asked).toHaveLength(0);
      doc.hidden = false;
      await vi.advanceTimersByTimeAsync(300);
      expect(asked).toHaveLength(1);
      live.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
