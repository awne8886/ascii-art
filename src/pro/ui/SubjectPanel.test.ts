import { describe, expect, it } from 'vitest';
import {
  defaultSubject,
  looksKeyFor,
  looksPaper,
  newEffect,
  newLayer,
  newProject,
  type EffectInstance,
  type Layer,
  type Project,
  type SubjectKey,
} from '../model';
import { setEffects, updateEffect } from '../store';
import { type AnalysisOutcome, type SubjectStore } from '../subject/store';
import { type SubjectInfo, type SubjectStatus } from '../subject/types';
import {
  analysesItself,
  autoAnalyses,
  canAnalyse,
  COMPOSITIONS,
  compositionFor,
  compositionOf,
  compositionSettings,
  jobText,
  lookPart,
  looksLost,
  lostLooks,
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

  it('tells presets apart by the key being on, whichever background it drops', () => {
    const on = { show: 'all', looks: 'subject', looksBlend: 0 } as const;
    expect(compositionOf({ ...on, looksKey: 'off' })?.label).toBe('Look on subject');
    expect(compositionOf({ ...on, looksKey: 'dark' })?.label).toBe('Characters over subject');
    expect(compositionOf({ ...on, looksKey: 'light' })?.label).toBe('Characters over subject');
  });

  it('drops the background the looks have: dark paper or light', () => {
    expect(looksKeyFor([newEffect('ascii')])).toBe('dark');
    expect(looksKeyFor([newEffect('halftone')])).toBe('light');
    expect(looksKeyFor([newEffect('dither-text')])).toBe('light');
    expect(looksKeyFor([newEffect('ascii', 'Ink on paper')])).toBe('light');
    expect(looksKeyFor([newEffect('halftone', 'Pop dots')])).toBe('dark');
    // No looks (or none on): dark, like most type looks.
    expect(looksKeyFor([])).toBe('dark');
    expect(looksKeyFor([{ ...newEffect('halftone'), enabled: false }])).toBe('dark');
    // The top look is what the key sees.
    expect(looksKeyFor([newEffect('halftone'), newEffect('ascii')])).toBe('dark');
    expect(looksKeyFor([newEffect('ascii'), newEffect('halftone')])).toBe('light');
    expect(looksKeyFor([look({ params: { ...look().params, paper: '#ffffff' } })])).toBe('light');
  });

  it('goes by the looks below a filter (VHS, CRT, Glitch…): their background shows through it', () => {
    expect(looksKeyFor([newEffect('halftone'), newEffect('vhs')])).toBe('light');
    expect(looksKeyFor([newEffect('dither-text'), newEffect('crt-screen')])).toBe('light');
    expect(looksKeyFor([newEffect('ascii', 'Ink on paper'), newEffect('glitch')])).toBe('light');
    expect(looksKeyFor([newEffect('ascii'), newEffect('glitch')])).toBe('dark');
    expect(looksKeyFor([newEffect('halftone'), newEffect('film-prism'), newEffect('vhs')])).toBe('light');
    // Only filters: no background known.
    expect(looksKeyFor([newEffect('vhs')])).toBe('dark');
    // A look that paints its own sky decides too.
    expect(looksKeyFor([newEffect('halftone'), newEffect('stardust')])).toBe('dark');
  });

  it('stops at a look that repaints the frame on its own black (Matrix Rain…): the looks below never show', () => {
    expect(looksKeyFor([newEffect('halftone'), newEffect('matrix-rain')])).toBe('dark');
    expect(looksKeyFor([newEffect('halftone'), newEffect('retro-matrix')])).toBe('dark');
    expect(looksKeyFor([newEffect('halftone'), newEffect('pixel-dither-glow')])).toBe('dark');
    expect(looksPaper([newEffect('pixel-poster'), newEffect('matrix-rain')])).toEqual([0, 0, 0]);
    // A filter over one still goes by it.
    expect(looksKeyFor([newEffect('halftone'), newEffect('matrix-rain'), newEffect('vhs')])).toBe('dark');
    // Off, it's out of the way.
    expect(looksKeyFor([newEffect('halftone'), { ...newEffect('matrix-rain'), enabled: false }])).toBe('light');
    // Blended so its black leaves the paper below as it is (Screen, Add, Lighten): the paper shows.
    for (const blend of [2, 4, 7])
      expect(looksKeyFor([newEffect('halftone'), { ...newEffect('pixel-dither-glow'), blend }])).toBe('light');
    // Multiply or Darken keep its black.
    for (const blend of [1, 8])
      expect(looksKeyFor([newEffect('halftone'), { ...newEffect('pixel-dither-glow'), blend }])).toBe('dark');
  });

  it('goes by the looks that show in the composition (a look kept to a part it leaves out never reaches the key)', () => {
    const onSubject = { show: 'all', looks: 'subject' } as const;
    const ascii = newEffect('ascii');
    const halftone = newEffect('halftone');
    expect(
      looksKeyFor(
        [
          { ...ascii, appears: 6 },
          { ...halftone, appears: 7 },
        ],
        onSubject,
      ),
    ).toBe('dark');
    expect(
      looksKeyFor(
        [
          { ...halftone, appears: 6 },
          { ...ascii, appears: 7 },
        ],
        onSubject,
      ),
    ).toBe('light');
    // Inverted: kept to the other part.
    expect(looksKeyFor([ascii, { ...halftone, appears: 6, appearsInvert: true }], onSubject)).toBe('dark');
    // With no composition given, or one that shows it, the top look counts.
    expect(
      looksKeyFor([
        { ...ascii, appears: 6 },
        { ...halftone, appears: 7 },
      ]),
    ).toBe('light');
    expect(
      looksKeyFor(
        [
          { ...ascii, appears: 6 },
          { ...halftone, appears: 7 },
        ],
        { show: 'all', looks: 'all' },
      ),
    ).toBe('light');
    const c = COMPOSITIONS.find((x) => x.label === 'Characters over subject')!;
    expect(
      compositionFor(c, [
        { ...ascii, appears: 6 },
        { ...halftone, appears: 7 },
      ]).looksKey,
    ).toBe('dark');
    expect(
      compositionFor(c, [
        { ...halftone, appears: 6 },
        { ...ascii, appears: 7 },
      ]).looksKey,
    ).toBe('light');
  });

  it('knows the looks’ background colour, for keying one neither dark nor light', () => {
    const [r, g, b] = looksPaper([newEffect('ascii', 'Blueprint')])!;
    expect([r * 255, g * 255, b * 255].map(Math.round)).toEqual([0x0b, 0x2a, 0x5b]);
    expect(looksPaper([newEffect('ascii')])).toEqual([0, 0, 0]);
    expect(looksPaper([newEffect('halftone'), newEffect('vhs')])).toEqual(looksPaper([newEffect('halftone')]));
    expect(looksPaper([])).toBeNull();
    expect(looksPaper([newEffect('vhs')])).toBeNull();
    expect(looksPaper([{ ...newEffect('ascii'), enabled: false }])).toBeNull();
  });

  it('the characters preset keys out the looks’ own paper', () => {
    const c = COMPOSITIONS.find((x) => x.label === 'Characters over subject')!;
    expect(compositionFor(c, [newEffect('ascii')]).looksKey).toBe('dark');
    expect(compositionFor(c, [newEffect('halftone')]).looksKey).toBe('light');
    const plain = COMPOSITIONS.find((x) => x.label === 'Look on subject')!;
    expect(compositionFor(plain, [newEffect('halftone')]).looksKey).toBe('off');
  });

  it('a key that suits the looks follows them; one set against them stays', () => {
    const layer = (looksKey: SubjectKey, effects: EffectInstance[]): Layer => ({
      ...withSubject(newLayer('sample', 'Sample clip', { id: 'L1' }), { on: true, looksKey }),
      effects,
    });
    const project = (l: Layer): Project => ({ ...newProject(), layers: [l] });
    const keyAfter = (l: Layer, fx: EffectInstance[]) =>
      setEffects('L1', () => fx)(project(l)).layers[0]!.subject!.looksKey;
    expect(keyAfter(layer('dark', [newEffect('ascii')]), [newEffect('halftone')])).toBe('light');
    expect(keyAfter(layer('light', [newEffect('halftone')]), [newEffect('ascii')])).toBe('dark');
    // Added to a layer with no looks yet.
    expect(keyAfter(layer('dark', []), [newEffect('halftone')])).toBe('light');
    // Set against the looks on purpose, or off: left alone.
    expect(keyAfter(layer('dark', [newEffect('halftone')]), [newEffect('dither-text')])).toBe('dark');
    expect(keyAfter(layer('off', [newEffect('ascii')]), [newEffect('halftone')])).toBe('off');
    // A filter added over the looks, or switched off and on again, keeps the key their background wants.
    const halftone = newEffect('halftone');
    const vhs = newEffect('vhs');
    expect(keyAfter(layer('light', [halftone]), [halftone, vhs])).toBe('light');
    let p = project(layer('light', [halftone, vhs]));
    p = updateEffect('L1', vhs.uid, { enabled: false })(p);
    expect(p.layers[0]!.subject!.looksKey).toBe('light');
    p = updateEffect('L1', vhs.uid, { enabled: true })(p);
    expect(p.layers[0]!.subject!.looksKey).toBe('light');
    // A look on its own black added over paper takes the key to dark, and back to light once screened over it.
    const rain = newEffect('matrix-rain');
    p = project(layer('light', [halftone]));
    p = setEffects('L1', () => [halftone, rain])(p);
    expect(p.layers[0]!.subject!.looksKey).toBe('dark');
    p = updateEffect('L1', rain.uid, { blend: 2 })(p);
    expect(p.layers[0]!.subject!.looksKey).toBe('light');
  });

  it('a key follows a look kept to a part its composition leaves out', () => {
    const ascii = newEffect('ascii');
    const halftone = newEffect('halftone');
    // "Characters over subject" on ASCII, then a Halftone meant for the background.
    let p: Project = {
      ...newProject(),
      layers: [
        {
          ...withSubject(newLayer('sample', 'Sample clip', { id: 'L1' }), {
            on: true,
            looks: 'subject',
            looksKey: 'dark',
          }),
          effects: [ascii],
        },
      ],
    };
    p = setEffects('L1', (fx) => [...fx, halftone])(p);
    expect(p.layers[0]!.subject!.looksKey).toBe('light');
    p = updateEffect('L1', halftone.uid, { appears: 7 })(p);
    expect(p.layers[0]!.subject!.looksKey).toBe('dark');
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

  it('lists each look kept out, even while others show', () => {
    const onSubject = { show: 'all', looks: 'subject' } as const;
    const kept = look({ appears: 7 });
    expect(lostLooks([look({ appears: 6 }), kept], onSubject)).toEqual([kept]);
    expect(lostLooks([look({ appears: 6 }), look({ appears: 7, enabled: false })], onSubject)).toEqual([]);
    expect(lostLooks([look({ appears: 6 }), kept], { show: 'all', looks: 'all' })).toEqual([]);
  });
});

describe('autoAnalyses', () => {
  const clip = withSubject(newLayer('sample', 'Sample clip', { id: 'L1' }), { on: true, method: 'classic' });

  /** A store that says `info` for every layer, keyed by method and rate, maybe stopped. */
  const store = (info: Partial<SubjectInfo>, stopped = false) =>
    ({
      analysisKey: (l: Layer) => `${l.subject?.method}|${l.subject?.rate}`,
      info: (): SubjectInfo => ({ status: 'none', frames: 0, from: 0, to: 0, ...info }),
      stoppedHere: () => stopped,
    }) as unknown as SubjectStore;
  const started = (s: SubjectStore, layers: Layer[], prev: Map<string, string> | null) =>
    autoAnalyses(s, layers, prev).start.map((l) => l.id);
  const keysOf = (l: Layer) => autoAnalyses(store({}), [l], null).keys;

  it('analyses again when more of the clip shows than was analysed, or than the analysis under way will', () => {
    expect(started(store({ status: 'stale', reason: 'range' }), [clip], keysOf(clip))).toEqual(['L1']);
    expect(started(store({ status: 'running', reason: 'range' }), [clip], keysOf(clip))).toEqual(['L1']);
    expect(started(store({ status: 'running' }), [clip], keysOf(clip))).toEqual([]);
    // Not after a Stop (for what the layer wants now), nor with the big model.
    expect(started(store({ status: 'stale', reason: 'range' }, true), [clip], keysOf(clip))).toEqual([]);
    const hq = withSubject(clip, { method: 'ai-hq' });
    expect(started(store({ status: 'stale', reason: 'range' }), [hq], keysOf(hq))).toEqual([]);
  });

  it('analyses what undo / redo switched on or took to other settings', () => {
    const off = withSubject(clip, { on: false });
    const rate5 = withSubject(clip, { rate: 5 });
    // Redo switched it on.
    expect(started(store({ status: 'none' }), [clip], keysOf(off))).toEqual(['L1']);
    // Undo took it back to masks from other settings.
    expect(started(store({ status: 'stale', reason: 'settings' }), [clip], keysOf(rate5))).toEqual(['L1']);
    // Undo brought a removed layer back without masks.
    expect(started(store({ status: 'none' }), [clip], new Map())).toEqual(['L1']);
    // Nothing moved, or masks that fit, or an edit that started its own analysis, or a failure for these settings.
    expect(started(store({ status: 'none' }), [clip], keysOf(clip))).toEqual([]);
    for (const status of ['ready', 'running', 'error'] as const)
      expect(started(store({ status }), [clip], keysOf(off))).toEqual([]);
    // Stopped for these settings.
    expect(started(store({ status: 'none' }, true), [clip], keysOf(off))).toEqual([]);
  });

  it('analyses what an edit since the last check stopped on the way, though it landed back (undo + redo, Delete + undo)', () => {
    const touched = new Set(['L1']);
    const run = (s: SubjectStore, prev: Map<string, string> | null) =>
      autoAnalyses(s, [clip], prev, touched).start.map((l) => l.id);
    expect(run(store({ status: 'none' }), keysOf(clip))).toEqual(['L1']);
    expect(run(store({ status: 'stale', reason: 'settings' }), keysOf(clip))).toEqual(['L1']);
    // Masks that fit, an analysis under way or a failure for these settings, a Stop, or just loaded: left alone.
    for (const status of ['ready', 'running', 'error'] as const)
      expect(run(store({ status }), keysOf(clip))).toEqual([]);
    expect(run(store({ status: 'none' }, true), keysOf(clip))).toEqual([]);
    expect(run(store({ status: 'none' }), null)).toEqual([]);
    // Another layer touched: not this one.
    expect(autoAnalyses(store({ status: 'none' }), [clip], keysOf(clip), new Set(['L2'])).start).toEqual([]);
  });

  it('only notes the settings when just loaded', () => {
    const r = autoAnalyses(store({ status: 'none' }), [clip], null);
    expect(r.start).toEqual([]);
    expect(r.keys.get('L1')).toBe('true|classic|10');
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
