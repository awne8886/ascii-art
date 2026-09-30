import { describe, expect, it } from 'vitest';
import { defaultSubject, newEffect, newLayer, type EffectInstance, type Layer } from '../model';
import { type AnalysisOutcome, type SubjectStore } from '../subject/store';
import { type SubjectInfo, type SubjectStatus } from '../subject/types';
import {
  analysesItself,
  canAnalyse,
  COMPOSITIONS,
  compositionOf,
  compositionSettings,
  jobText,
  lookPart,
  looksLost,
  refreshSubject,
  startAnalysis,
  statusWord,
  withSubject,
} from './SubjectPanel';

const tracked = (l: Layer): Layer => ({
  ...l,
  track: { box: [0.4, 0.4, 0.2, 0.2], at: 0, duration: 12, from: 0, fps: 30, data: [0.5, 0.5, 0.2, 0.2, 1] },
});

/** Just enough of a SubjectStore to see what the panel asks of it. */
function fakeStore(status: SubjectStatus, outcome: AnalysisOutcome = 'done') {
  const calls: string[] = [];
  const store = {
    cancel: (id: string) => void calls.push(`cancel ${id}`),
    info: (): SubjectInfo => ({ status, frames: 12, from: 0, to: 0 }),
    analyze: (l: Layer) => {
      calls.push(`analyze ${l.id} ${l.subject?.method} ${l.subject?.area}`);
      return Promise.resolve(outcome);
    },
  };
  return { store: store as unknown as SubjectStore, calls };
}

const look = (e: Partial<EffectInstance> = {}): EffectInstance => ({ ...newEffect('ascii'), ...e });

describe('compositions', () => {
  it('each preset is recognised as itself', () => {
    for (const c of COMPOSITIONS) expect(compositionOf(c)).toBe(c);
    for (const c of COMPOSITIONS) expect(compositionOf({ ...defaultSubject(), ...compositionSettings(c) })).toBe(c);
  });

  it('switching on starts with the looks on the subject over the untouched picture', () => {
    expect(compositionOf(defaultSubject())?.label).toBe('Look on subject');
  });

  it('with one part showing, looks on that part are looks everywhere', () => {
    expect(compositionOf({ show: 'subject', looks: 'subject', looksBlend: 0, looksKey: 'off' })?.label).toBe(
      'Subject only',
    );
    expect(compositionOf({ show: 'background', looks: 'background', looksBlend: 0, looksKey: 'off' })?.label).toBe(
      'Background only',
    );
  });

  it('anything else is custom', () => {
    expect(compositionOf({ show: 'subject', looks: 'background', looksBlend: 0, looksKey: 'off' })).toBeUndefined();
    expect(compositionOf({ show: 'all', looks: 'subject', looksBlend: 5, looksKey: 'off' })).toBeUndefined();
    // The old Screen overlay is custom now.
    expect(compositionOf({ show: 'all', looks: 'subject', looksBlend: 2, looksKey: 'off' })).toBeUndefined();
  });

  it('lays just the characters over the subject: Normal blend, their dark background dropped', () => {
    const c = COMPOSITIONS.find((x) => x.label === 'Characters over subject')!;
    expect(compositionSettings(c)).toEqual({ show: 'all', looks: 'subject', looksBlend: 0, looksKey: 'dark' });
    expect(COMPOSITIONS.filter((x) => x !== c).every((x) => x.looksKey === 'off')).toBe(true);
  });

  it('tells presets apart by the key', () => {
    const on = { show: 'all', looks: 'subject', looksBlend: 0 } as const;
    expect(compositionOf({ ...on, looksKey: 'off' })?.label).toBe('Look on subject');
    expect(compositionOf({ ...on, looksKey: 'dark' })?.label).toBe('Characters over subject');
    expect(compositionOf({ ...on, looksKey: 'light' })).toBeUndefined();
  });

  it('an older saved subject (no key) reads as keyed off', () => {
    const { looksKey: _, ...old } = { ...defaultSubject(), show: 'all', looks: 'subject' } as const;
    expect(compositionOf({ ...defaultSubject(), ...old })?.label).toBe('Look on subject');
  });
});

describe('status text', () => {
  it('says what each phase is doing', () => {
    expect(jobText({ phase: 'download', progress: 0.1, loaded: 2.1e6, total: 4.6e6 })).toBe(
      'Downloading the model… 2.1 / 4.6 MB',
    );
    expect(jobText({ phase: 'init', progress: 0.3 })).toBe('Starting the model…');
    expect(jobText({ phase: 'analyse', progress: 0.5, done: 12, count: 60 })).toBe('Separating 12 / 60');
  });

  it('sums the state up in a word', () => {
    const info = (status: SubjectStatus, progress = 0): SubjectInfo => ({
      status,
      frames: 0,
      from: 0,
      to: 0,
      job: { phase: 'analyse', progress },
    });
    expect(statusWord(false, info('ready'))).toBe('Off');
    expect(statusWord(true, info('running', 0.42))).toBe('42%');
    expect(statusWord(true, info('stale'))).toBe('Out of date');
  });
});

describe('when analysis starts by itself', () => {
  const clip = withSubject(newLayer('sample', 'Sample clip'), { on: true });

  it('for videos, pictures and the sample, with the fast model or classic', () => {
    expect(analysesItself(clip)).toBe(true);
    expect(analysesItself(withSubject(clip, { method: 'classic' }))).toBe(true);
    expect(analysesItself(withSubject(newLayer('image', 'Photo'), { on: true }))).toBe(true);
  });

  it('not when off, not for the big model, not for the webcam, text or shapes', () => {
    expect(analysesItself(withSubject(clip, { on: false }))).toBe(false);
    expect(analysesItself(withSubject(clip, { method: 'ai-hq' }))).toBe(false);
    expect(analysesItself(withSubject(newLayer('webcam', 'Webcam'), { on: true }))).toBe(false);
    expect(canAnalyse(withSubject(newLayer('text', 'Type'), { on: true }))).toBe(false);
  });

  it('a tracked area needs a tracked object', () => {
    const area = withSubject(clip, { area: 'tracked' });
    expect(canAnalyse(area)).toBe(false);
    expect(canAnalyse(tracked(area))).toBe(true);
  });
});

describe('refreshSubject', () => {
  const clip = withSubject(newLayer('sample', 'Sample clip'), { on: true, method: 'classic' });

  it('restarts the analysis unless the masks held already fit', () => {
    for (const status of ['none', 'stale', 'error'] as const) {
      const { store, calls } = fakeStore(status);
      refreshSubject(store, clip);
      expect(calls).toEqual([`cancel ${clip.id}`, `analyze ${clip.id} classic frame`]);
    }
    const { store, calls } = fakeStore('ready');
    refreshSubject(store, clip);
    expect(calls).toEqual([`cancel ${clip.id}`]);
  });

  it('leaves the big model to its button, and does nothing while off', () => {
    const hq = fakeStore('none');
    refreshSubject(hq.store, withSubject(clip, { method: 'ai-hq' }));
    expect(hq.calls).toEqual([`cancel ${clip.id}`]);
    const off = fakeStore('none');
    refreshSubject(off.store, withSubject(clip, { on: false }));
    expect(off.calls).toEqual([]);
  });

  it('cuts out a tracked object once there is one', () => {
    const { store, calls } = fakeStore('stale');
    refreshSubject(store, tracked(withSubject(clip, { area: 'tracked' })));
    expect(calls.at(-1)).toBe(`analyze ${clip.id} classic tracked`);
  });
});

describe('looks kept to a part the composition leaves out', () => {
  it('reads which part a look keeps to', () => {
    expect(lookPart(look({ appears: 6 }))).toBe('subject');
    expect(lookPart(look({ appears: 7 }))).toBe('background');
    expect(lookPart(look({ appears: 6, appearsInvert: true }))).toBe('background');
    expect(lookPart(look({ appears: 0 }))).toBeNull();
  });

  it('are lost when every look that is on is kept out', () => {
    const onSubject = { show: 'all', looks: 'subject' } as const;
    expect(looksLost([look({ appears: 7 })], onSubject)).toBe(true);
    expect(looksLost([look({ appears: 7 }), look({ appears: 7, enabled: false })], onSubject)).toBe(true);
    expect(looksLost([look({ appears: 7 }), look({ appears: 0 })], onSubject)).toBe(false);
    expect(looksLost([look({ appears: 6 })], onSubject)).toBe(false);
    expect(looksLost([look({ appears: 6 })], { show: 'all', looks: 'background' })).toBe(true);
    expect(looksLost([look({ appears: 7 })], { show: 'subject', looks: 'all' })).toBe(true);
    expect(looksLost([look({ appears: 7 })], { show: 'all', looks: 'all' })).toBe(false);
    expect(looksLost([], onSubject)).toBe(false);
  });
});

describe('startAnalysis', () => {
  const clip = withSubject(newLayer('sample', 'Sample clip'), { on: true, method: 'classic' });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('says how it went', async () => {
    const said: string[] = [];
    startAnalysis(fakeStore('ready').store, clip, (m) => said.push(m));
    await settle();
    expect(said).toEqual(['Separated “Sample clip”: 12 masks.']);
  });

  it('says nothing when it was stopped, even over masks that still fit', async () => {
    const said: string[] = [];
    startAnalysis(fakeStore('ready', 'cancelled').store, clip, (m) => said.push(m));
    await settle();
    expect(said).toEqual([]);
  });
});
