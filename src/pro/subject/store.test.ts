import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type MediaStore } from '../media';
import { defaultSubject, newLayer, newProject, type Layer, type Project } from '../model';
import { SAMPLE_DURATION } from '../sources';
import { analysisTimes, toRecord, wantedMeta, type MaskSequence } from './masks';
import { SubjectStore } from './store';
import { type SubjectJob } from './types';

/** Analyses the test holds open, and finishes or fails by hand. */
const runs: Array<{
  layer: Layer;
  onProgress: (job: SubjectJob) => void;
  signal: AbortSignal;
  finish: (seq: MaskSequence) => void;
  fail: (e: Error) => void;
}> = [];

vi.mock('./analyze', () => ({
  analyzeSubject: (layer: Layer, _d: number, _m: unknown, onProgress: (job: SubjectJob) => void, signal: AbortSignal) =>
    new Promise<MaskSequence>((finish, fail) => {
      signal.addEventListener('abort', () => fail(new DOMException('Separation cancelled.', 'AbortError')));
      runs.push({ layer, onProgress, signal, finish, fail });
    }),
}));

/** What IndexedDB holds, by layer id. */
const saved = new Map<string, unknown>();
let loads: Array<() => void> = [];

vi.mock('../storage', () => ({
  saveMasks: (id: string, record: unknown) => {
    saved.set(id, record);
    return Promise.resolve();
  },
  // Held until the test lets it through, like a slow read.
  loadMasks: (id: string) => new Promise((resolve) => loads.push(() => resolve(saved.get(id)))),
  deleteMasks: (id: string) => {
    saved.delete(id);
    return Promise.resolve();
  },
  onMasksPruned: () => () => {},
}));

const settle = () => new Promise((r) => setTimeout(r, 0));

const clip = (patch: Partial<Layer['subject'] & object> = {}): Layer => ({
  ...newLayer('sample', 'Sample clip', { id: 'L1', length: SAMPLE_DURATION }),
  subject: { ...defaultSubject(), on: true, method: 'classic', ...patch },
});

function projectOf(layers: Layer[], duration = SAMPLE_DURATION): Project {
  const p = newProject();
  return { ...p, canvas: { ...p.canvas, duration }, layers };
}

/** Masks for the layer as wantedMeta would have them on a canvas that long. */
function masksFor(layer: Layer, canvasDuration = Infinity): MaskSequence {
  const meta = wantedMeta(layer, SAMPLE_DURATION, canvasDuration);
  const times = analysisTimes(meta.from, meta.to, meta.rate, SAMPLE_DURATION);
  return {
    from: meta.from,
    fps: meta.rate,
    frames: times.map(() => ({ width: 2, height: 1, data: new Uint8Array([0, 255]), rect: [0, 0, 1, 1] })),
    meta,
    backend: 'js',
    ms: 5,
  };
}

let store: SubjectStore;

beforeEach(() => {
  runs.length = 0;
  saved.clear();
  loads = [];
  store = new SubjectStore({ get: () => undefined } as unknown as MediaStore);
});

describe('versions', () => {
  it('bumps the mask version only when the masks change, the revision with every change', async () => {
    const l = clip();
    const v0 = store.version;
    const r0 = store.revision;
    const done = store.analyze(l);
    runs[0]!.onProgress({ phase: 'analyse', progress: 0.5, done: 1, count: 2 });
    await new Promise((r) => setTimeout(r, 150));
    expect(store.version).toBe(v0);
    expect(store.revision).toBeGreaterThan(r0 + 1);
    runs[0]!.finish(masksFor(l));
    expect(await done).toBe('done');
    expect(store.version).toBe(v0 + 1);
    store.clear();
    expect(store.version).toBe(v0 + 2);
  });
});

describe('analyze', () => {
  it('says how it ended', async () => {
    const l = clip();
    let run = store.analyze(l);
    runs[0]!.finish(masksFor(l));
    expect(await run).toBe('done');
    expect(store.info(l).status).toBe('ready');
    expect(saved.has('L1')).toBe(true);

    // Analysing again over masks that fit, then stopping it: cancelled, and the masks stay ready.
    run = store.analyze(l);
    store.cancel(l.id);
    expect(await run).toBe('cancelled');
    expect(store.info(l).status).toBe('ready');

    run = store.analyze(l);
    runs[2]!.fail(new Error('Nope.'));
    expect(await run).toBe('failed');
    expect(store.info(l)).toMatchObject({ status: 'error', error: 'Nope.' });
  });

  it('uses masks on their way back from IndexedDB when they fit, instead of analysing', async () => {
    const l = clip();
    saved.set(l.id, toRecord(masksFor(l)));
    // Switching on looks the masks up (info), then starts an analysis while the lookup is under way.
    expect(store.info(l).status).toBe('none');
    const run = store.analyze(l);
    await settle();
    expect(runs).toHaveLength(0);
    loads.forEach((go) => go());
    expect(await run).toBe('done');
    expect(runs).toHaveLength(0);
    expect(store.info(l)).toMatchObject({ status: 'ready', frames: 121 });
  });

  it('still analyses when the saved masks were made with other settings', async () => {
    const l = clip();
    saved.set(l.id, toRecord(masksFor(clip({ rate: 5 }))));
    store.info(l);
    const run = store.analyze(l);
    loads.forEach((go) => go());
    await settle();
    await settle();
    expect(runs).toHaveLength(1);
    runs[0]!.finish(masksFor(l));
    expect(await run).toBe('done');
    expect(store.info(l).status).toBe('ready');
  });
});

describe('sync', () => {
  it('stops analyses the project no longer wants (undo, redo, removal)', async () => {
    const l = clip();
    const running = () => store.info(l).status === 'running';

    // Its own commit leaves it running.
    let run = store.analyze(l);
    store.sync(projectOf([l]));
    expect(running()).toBe(true);
    // Undo to other settings: stopped.
    store.sync(projectOf([clip({ rate: 5 })]));
    expect(await run).toBe('cancelled');

    run = store.analyze(l);
    store.sync(projectOf([clip({ on: false })]));
    expect(await run).toBe('cancelled');

    run = store.analyze(l);
    store.sync(projectOf([]));
    expect(await run).toBe('cancelled');
    expect(saved.has(l.id)).toBe(false);
  });

  it('only wants the part of a clip on the canvas', async () => {
    const l = clip();
    store.sync(projectOf([l], 6));
    const run = store.analyze(l);
    runs[0]!.finish(masksFor(l, 6));
    await run;
    expect(store.info(l)).toMatchObject({ status: 'ready', frames: 61, to: 6 });
    // A longer canvas wants more of the clip.
    store.sync(projectOf([l], 8));
    expect(store.info(l).status).toBe('stale');
  });
});
