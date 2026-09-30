import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { MODELS } from '../../segment/models';
import { type SegmentMethod } from '../../settings';
import { BLEND_MODES } from '../effects/prelude';
import { effectById } from '../effects/registry';
import { layerMediaDuration } from '../frames';
import { type MediaStore } from '../media';
import {
  allows,
  defaultSubject,
  lookPart,
  looksKeyFor,
  newEffect,
  SEPARABLE_KINDS,
  SUBJECT_RATES,
  type EffectInstance,
  type Layer,
  type SubjectKey,
  type SubjectPart,
  type SubjectSettings,
} from '../model';
import { setEffects, updateLayer, type Studio } from '../store';
import { analysisRange, analysisTimes } from '../subject/masks';
import { type SubjectStore } from '../subject/store';
import { type SubjectInfo, type SubjectJob } from '../subject/types';
import { Group, Segmented, Select, Slider, Switch } from './controls';
import { Icon } from './icons';

const HAS_WEBGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
const FAST_MB = MODELS['ai-fast'].wasm!.mb;
/** fp16 where the GPU has it; bigger (fp32) where it doesn't. */
const HQ_MB = `${MODELS['ai-hq'].webgpu!.mb}+`;

let gpuProbe: Promise<boolean> | null = null;
let gpuKnown: boolean | null = null;

/**
 * Whether WebGPU can run here: navigator.gpu alone isn't enough (a
 * blocklisted or missing graphics card has no adapter). Asked once, and
 * only while `ask` (AI · best is picked); until the answer, as navigator.gpu says.
 */
function useWebGpu(ask: boolean): boolean {
  const [ok, setOk] = useState(gpuKnown ?? HAS_WEBGPU);
  useEffect(() => {
    if (!ask || !HAS_WEBGPU) return;
    gpuProbe ??= (async () => {
      try {
        const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        gpuKnown = !!(await gpu?.requestAdapter());
      } catch {
        gpuKnown = false;
      }
      return gpuKnown;
    })();
    let alive = true;
    void gpuProbe.then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, [ask]);
  return ok;
}

// ─── Compositions ────────────────────────────────────────────────────────────

export type CompositionSettings = Pick<SubjectSettings, 'show' | 'looks' | 'looksBlend' | 'looksKey'>;

export interface Composition extends CompositionSettings {
  label: string;
  /** One line; `{what}` becomes "video" or "picture". */
  hint: string;
}

/** The usual ways to put a separated subject and its background together (show, looks, blend, key). */
export const COMPOSITIONS: readonly Composition[] = [
  {
    label: 'Look on subject',
    hint: 'The looks on the subject; the background stays the untouched {what}.',
    show: 'all',
    looks: 'subject',
    looksBlend: 0,
    looksKey: 'off',
  },
  {
    label: 'Characters over subject',
    hint: 'Just the looks’ characters over the subject, the {what} showing between them.',
    show: 'all',
    looks: 'subject',
    looksBlend: 0,
    looksKey: 'dark',
  },
  {
    label: 'Subject only',
    hint: 'Just the subject, with its looks; the background is see-through.',
    show: 'subject',
    looks: 'all',
    looksBlend: 0,
    looksKey: 'off',
  },
  {
    label: 'Look on background',
    hint: 'The looks on the background; the subject stays untouched.',
    show: 'all',
    looks: 'background',
    looksBlend: 0,
    looksKey: 'off',
  },
  {
    label: 'Background only',
    hint: 'The subject is cut away; the looks go on what is left.',
    show: 'background',
    looks: 'all',
    looksBlend: 0,
    looksKey: 'off',
  },
];

/** The parts of a preset, as the settings take them. */
export function compositionSettings(c: Composition): CompositionSettings {
  return { show: c.show, looks: c.looks, looksBlend: c.looksBlend, looksKey: c.looksKey };
}

/**
 * A preset's settings for a layer with these looks: a preset that drops
 * the looks' background drops the one they have (dark or light paper), going
 * by the looks that show in it.
 */
export function compositionFor(c: Composition, effects: readonly EffectInstance[]): CompositionSettings {
  return { ...compositionSettings(c), ...(c.looksKey !== 'off' && { looksKey: looksKeyFor(effects, c) }) };
}

/**
 * The preset a composition matches, if any. With only one part showing,
 * looks on that part are the same as looks everywhere; the key only counts
 * as on or off (which background it drops follows the looks).
 */
export function compositionOf(s: CompositionSettings): Composition | undefined {
  const looks = s.show !== 'all' && s.looks === s.show ? 'all' : s.looks;
  return COMPOSITIONS.find(
    (c) =>
      c.show === s.show &&
      c.looks === looks &&
      c.looksBlend === s.looksBlend &&
      (c.looksKey === 'off') === (s.looksKey === 'off'),
  );
}

export { allows, lookPart };

/** The looks that are on but kept (by their own Mask) to a part this composition leaves out: they don't show. */
export function lostLooks(
  effects: readonly EffectInstance[],
  s: Pick<SubjectSettings, 'show' | 'looks'>,
): EffectInstance[] {
  return effects.filter((e) => {
    const p = lookPart(e);
    return e.enabled && p !== null && !(allows(s.looks, p) && allows(s.show, p));
  });
}

/** Whether every look that's on is lost that way, so none of them shows anywhere. */
export function looksLost(effects: readonly EffectInstance[], s: Pick<SubjectSettings, 'show' | 'looks'>): boolean {
  const on = effects.filter((e) => e.enabled);
  return on.length > 0 && lostLooks(on, s).length === on.length;
}

/** Look names as a list: "Halftone", "Halftone and VHS", "Halftone, VHS and Glitch". */
function names(looks: readonly EffectInstance[]): string {
  const n = [...new Set(looks.map((e) => effectById(e.effectId)?.name ?? 'A look'))];
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : (n[0] ?? '');
}

// ─── Analysis helpers (the Track panel uses them too) ───────────────────────

export function withSubject(layer: Layer, patch: Partial<SubjectSettings>): Layer {
  return { ...layer, subject: { ...(layer.subject ?? defaultSubject()), ...patch } };
}

/** The layer has a tracked object to separate (a video or the sample clip, tracked). */
export function hasTrackedObject(layer: Layer): boolean {
  return (layer.kind === 'video' || layer.kind === 'sample') && (layer.track?.data.length ?? 0) >= 5;
}

/** The layer's subject can be analysed as it is set up (the webcam is separated live instead). */
export function canAnalyse(layer: Layer): boolean {
  if (layer.kind === 'webcam' || !SEPARABLE_KINDS.includes(layer.kind)) return false;
  return layer.subject?.area !== 'tracked' || hasTrackedObject(layer);
}

/** Edits start the analysis by themselves, except with BiRefNet: its 115+ MB download is asked for with a button. */
export function analysesItself(layer: Layer): boolean {
  return !!layer.subject?.on && layer.subject.method !== 'ai-hq' && canAnalyse(layer);
}

/** Analyse, then say how it went (the panel may be closed by then); a stopped analysis says nothing. */
export function startAnalysis(subjects: SubjectStore, layer: Layer, toast?: (msg: string) => void): void {
  void subjects.analyze(layer).then((outcome) => {
    if (!toast || outcome === 'cancelled') return;
    const info = subjects.info(layer);
    if (info.status === 'ready') {
      toast(`Separated “${layer.name}”: ${info.frames} ${info.frames === 1 ? 'mask' : 'masks'}.`);
    } else if (info.status === 'error' && info.error) toast(`“${layer.name}”: ${info.error}`);
  });
}

/**
 * After an edit that changes what the masks must be (switching on, method,
 * area, rate, a new track): drop the analysis under way and start again,
 * unless the masks already held fit.
 */
export function refreshSubject(subjects: SubjectStore, next: Layer, toast?: (msg: string) => void): void {
  if (!next.subject?.on || next.kind === 'webcam') return;
  subjects.cancel(next.id);
  if (analysesItself(next) && subjects.info(next).status !== 'ready') startAnalysis(subjects, next, toast);
}

/**
 * What analyses again by itself once an edit settles (ProApp): layers that
 * analyse by themselves whose clip now shows more than was analysed (a longer
 * canvas, a trim), or that undo / redo switched on or took to other analysis
 * settings (as the same edit in the panel would; those have started already).
 * Not after a Stop, while the layer wants what it did then. `prev` is each
 * layer's analysis settings (`keys`) at the last check, or null to only note
 * them (just loaded: nothing was edited).
 */
export function autoAnalyses(
  subjects: Pick<SubjectStore, 'analysisKey' | 'info' | 'stoppedHere'>,
  layers: readonly Layer[],
  prev: ReadonlyMap<string, string> | null,
): { keys: Map<string, string>; start: Layer[] } {
  const keys = new Map(layers.map((l) => [l.id, `${!!l.subject?.on}|${subjects.analysisKey(l)}`]));
  const start = layers.filter((l) => {
    if (!analysesItself(l) || subjects.stoppedHere(l)) return false;
    const info = subjects.info(l);
    // More of the clip shows than was analysed, or than the analysis under way will.
    if (info.reason === 'range' && (info.status === 'stale' || info.status === 'running')) return true;
    const moved = !!prev && prev.get(l.id) !== keys.get(l.id);
    return moved && (info.status === 'none' || (info.status === 'stale' && info.reason === 'settings'));
  });
  return { keys, start };
}

/** Re-render on every change in the store (masks, analysis progress, errors). */
export function useSubjectsVersion(subjects: SubjectStore): number {
  const subscribe = useCallback((fn: () => void) => subjects.subscribe(fn), [subjects]);
  const revision = useCallback(() => subjects.revision, [subjects]);
  return useSyncExternalStore(subscribe, revision);
}

// ─── Status text ─────────────────────────────────────────────────────────────

function mb(bytes: number): string {
  return (bytes / 1e6).toFixed(1);
}

/** What an analysis is doing, in a line. */
export function jobText(job: SubjectJob | undefined): string {
  if (!job) return 'Starting…';
  if (job.phase === 'download') {
    if (job.total) return `Downloading the model… ${mb(job.loaded ?? 0)} / ${mb(job.total)} MB`;
    return job.loaded ? `Downloading the model… ${mb(job.loaded)} MB` : 'Downloading the model…';
  }
  if (job.phase === 'init') return 'Starting the model…';
  return job.count ? `Separating ${job.done ?? 0} / ${job.count}` : 'Separating…';
}

/** The analysis in a word, for the group's summary. */
export function statusWord(on: boolean, info: SubjectInfo): string {
  if (!on) return 'Off';
  switch (info.status) {
    case 'none':
      return 'Not yet';
    case 'running':
      return `${Math.round((info.job?.progress ?? 0) * 100)}%`;
    case 'ready':
      return 'Ready';
    case 'stale':
      return 'Out of date';
    case 'live':
      return 'Live';
    case 'error':
      return 'Failed';
  }
}

/** Where the model ran: the value and its caption, for the stats. */
function ranOn(backend: string | undefined): [string, string] {
  if (backend === 'webgpu') return ['GPU', 'ran on'];
  if (backend === 'wasm') return ['CPU', 'ran on'];
  if (backend === 'js') return ['Classic', 'no model'];
  return ['—', 'ran on'];
}

/** A duration in seconds, to a tenth below ten. */
function secs(s: number): string {
  return s < 10 ? s.toFixed(1) : String(Math.round(s));
}

const METHODS: ReadonlyArray<{ value: SegmentMethod; label: string; title: string }> = [
  {
    value: 'ai-fast',
    label: 'AI · fast',
    title: `U²-Net small: a ${FAST_MB} MB download, once. Works in any browser.`,
  },
  {
    value: 'ai-hq',
    label: 'AI · best',
    title: `BiRefNet lite: the finest edges. A ${HQ_MB} MB download, once; needs WebGPU.`,
  },
  { value: 'classic', label: 'Classic', title: 'No download. Best on plain backgrounds.' },
];

function methodNote(m: SegmentMethod, gpu: boolean): string {
  switch (m) {
    case 'ai-fast':
      return `U²-Net small: a ${FAST_MB} MB download, once, then cached. Works in any browser.`;
    case 'ai-hq':
      return gpu
        ? `BiRefNet lite: the finest edges, on the GPU. A ${HQ_MB} MB download, once, then cached.`
        : 'BiRefNet lite needs WebGPU, which this browser or its graphics card doesn’t offer: use AI · fast or Classic.';
    case 'classic':
      return 'No download: finds what stands out from the colours at the edges of the frame. Best on plain backgrounds.';
  }
}

const PARTS = (all: string): ReadonlyArray<{ value: SubjectPart; label: string; title?: string }> => [
  { value: 'all', label: all },
  { value: 'subject', label: 'Subject' },
  { value: 'background', label: 'Background' },
];

const KEYS: ReadonlyArray<{ value: SubjectKey; label: string; title: string }> = [
  { value: 'off', label: 'Off', title: 'The looks cover their part, background and all' },
  { value: 'dark', label: 'Dark', title: 'Drop the looks’ dark background (most type looks)' },
  { value: 'light', label: 'Light', title: 'Drop the looks’ light background (paper-like looks)' },
];

// ─── Panel ───────────────────────────────────────────────────────────────────

interface Props {
  studio: Studio;
  layer: Layer;
  media: MediaStore;
  subjects: SubjectStore;
  toast: (msg: string) => void;
  /** Opens the Track tab (to track an object to cut out). */
  onOpenTrack: () => void;
}

/**
 * Subject: separate a layer's subject from its background (ahead of time
 * for videos and pictures, live for the webcam), then choose what shows and
 * where the looks go: on the subject over the untouched video, laid over it,
 * the subject alone, and so on.
 */
export function SubjectPanel({ studio, layer, media, subjects, toast, onOpenTrack }: Props) {
  useSubjectsVersion(subjects);
  const gpu = useWebGpu(layer.subject?.method === 'ai-hq');

  if (!SEPARABLE_KINDS.includes(layer.kind)) {
    return (
      <div className="panel-body">
        <p className="muted small">
          Type and shapes have no background to separate. Videos, pictures, the webcam and the sample clip can be
          separated in their own Subject tab; the canvas’s looks can then appear on just the subjects or just the
          background.
        </p>
      </div>
    );
  }

  const s = layer.subject ?? defaultSubject();
  const info = subjects.info(layer);
  const moving = layer.kind === 'video' || layer.kind === 'sample';
  const live = layer.kind === 'webcam';
  const what = layer.kind === 'image' ? 'picture' : 'video';
  const tracked = moving && s.area === 'tracked';
  const trackOk = hasTrackedObject(layer);

  const set = (patch: Partial<SubjectSettings>, key?: string) =>
    studio.commit(
      updateLayer(layer.id, (l) => withSubject(l, patch)),
      key && `subj:${key}:${layer.id}`,
    );
  /** An edit that changes what the masks must be. */
  const setAnalysis = (patch: Partial<SubjectSettings>) => {
    // Picking what's already picked changes nothing (and mustn't restart an analysis).
    if ((Object.keys(patch) as (keyof SubjectSettings)[]).every((k) => patch[k] === s[k])) return;
    set(patch);
    refreshSubject(subjects, withSubject(layer, patch), toast);
  };
  const lost = lostLooks(layer.effects, s);
  const toggle = (on: boolean) => {
    const patch: Partial<SubjectSettings> = { on };
    // Looks already kept to one part (Look › Mask) would vanish under "Look on subject": put the looks everywhere
    // (before separation they covered everything anyway).
    if (on && lost.length && s.show === 'all') patch.looks = 'all';
    set(patch);
    if (on) refreshSubject(subjects, withSubject(layer, patch), toast);
    else subjects.cancel(layer.id);
  };
  const analyse = () => startAnalysis(subjects, layer, toast);

  const duration = layerMediaDuration(layer, media);
  const range = moving && duration ? analysisRange(layer, duration, studio.project.canvas.duration) : null;
  const masks = range && duration ? analysisTimes(range.from, range.to, s.rate, duration).length : null;

  const preset = compositionOf(s);
  const looksOn = layer.effects.some((e) => e.enabled);
  const allLost = looksLost(layer.effects, s);
  // Which part the lost looks are kept to (null when they're kept to different ones), and how to show them.
  const lostParts = new Set(lost.map(lookPart));
  const lostPart = lostParts.size === 1 ? [...lostParts][0]! : null;
  const findLooks: Partial<SubjectSettings> = {
    looks: 'all',
    show: lostPart && allows(s.show, lostPart) ? s.show : 'all',
  };
  const neutralBg = s.bgBrightness === 1 && s.bgBlur === 0 && s.bgSaturation === 1;

  return (
    <div className="panel-body">
      <Group title="Separate" icon="subject" summary={statusWord(s.on, info)}>
        <Switch label="Separate subject & background" checked={s.on} onChange={toggle} />
        {!s.on && (
          <p className="muted small">
            Finds the subject in every frame, so the looks can go on just the subject (over the untouched {what}), on
            just the background, or either can be cut away.
          </p>
        )}
        <Segmented label="Method" value={s.method} options={METHODS} onChange={(m) => setAnalysis({ method: m })} />
        <p className="muted small">{methodNote(s.method, gpu)}</p>

        {moving && (
          <Segmented<SubjectSettings['area']>
            label="Area"
            value={s.area}
            options={[
              { value: 'frame', label: 'Whole frame', title: 'The main subject, anywhere in the frame' },
              {
                value: 'tracked',
                label: 'Tracked object',
                title: 'Only the tracked object: it is separated in a window that follows it',
              },
            ]}
            onChange={(a) => setAnalysis({ area: a })}
          />
        )}
        {tracked && !trackOk && (
          <div className="subjnote">
            <p className="muted small">
              Track an object first: draw a box around it in the Track tab. Then only that object is separated, in its
              real shape, wherever it goes.
            </p>
            <button type="button" className="pbtn pbtn--small" onClick={onOpenTrack}>
              <Icon name="target" size={13} /> Track
            </button>
          </div>
        )}
        {tracked && trackOk && (
          <p className="muted small">Only the tracked object is separated, in a window that follows it.</p>
        )}

        {moving && (
          <>
            <Select<number>
              label="Masks per second"
              value={s.rate}
              options={SUBJECT_RATES.map((r) => ({ value: r, label: String(r) }))}
              onChange={(r) => setAnalysis({ rate: r })}
            />
            {masks !== null && range && (
              <p className="muted small">
                {masks} {masks === 1 ? 'mask' : 'masks'} over the {secs(range.to - range.from)} s of the clip that shows
                on the canvas; in between, neighbouring masks blend.
              </p>
            )}
          </>
        )}
        {layer.kind === 'image' && <p className="muted small">A picture gets one mask.</p>}

        {s.on && (
          <SubjectStatus
            info={info}
            live={live}
            method={s.method}
            gpu={gpu}
            analysable={canAnalyse(layer)}
            onAnalyse={analyse}
            onStop={() => subjects.stop(layer)}
            onMethod={(m) => setAnalysis({ method: m })}
          />
        )}
      </Group>

      {s.on && (
        <>
          <Group title="Composition" icon="mask" summary={preset?.label ?? 'Custom'}>
            {!looksOn && (
              <div className="subjnote">
                <p className="muted small">
                  {layer.effects.length ? 'This layer’s looks are all off' : 'This layer has no looks yet'}, so the
                  separated parts show as they are.
                </p>
                <button
                  type="button"
                  className="pbtn pbtn--small pbtn--primary"
                  onClick={() => {
                    studio.commit(setEffects(layer.id, (list) => [...list, newEffect('ascii')]));
                    toast('Added the ASCII look: change it in the Look tab.');
                  }}
                >
                  <Icon name="plus" size={13} /> Add the ASCII look
                </button>
              </div>
            )}
            {lost.length > 0 && (
              <div className="subjnote">
                <p className="muted small">
                  {allLost ? 'Every look on this layer is' : `${names(lost)} ${lost.length === 1 ? 'is' : 'are'}`} set
                  to appear only on the {lostPart ?? 'subject or the background'} (Look › Mask), which this composition
                  leaves out, so {allLost ? 'none shows' : lost.length === 1 ? 'it doesn’t show' : 'they don’t show'}.
                </p>
                <button type="button" className="pbtn pbtn--small" onClick={() => set(findLooks)}>
                  {findLooks.show === s.show ? 'Looks on: Everything' : 'Show everything'}
                </button>
              </div>
            )}
            <div className="subjpresets" role="radiogroup" aria-label="Composition">
              {COMPOSITIONS.map((c) => {
                const on = c === preset;
                return (
                  <button
                    key={c.label}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`subjpreset${on ? ' subjpreset--on' : ''}`}
                    onClick={() => set(compositionFor(c, layer.effects))}
                  >
                    <CompGlyph show={c.show} looks={c.looks} overlay={c.looksBlend !== 0 || c.looksKey !== 'off'} />
                    <span className="subjpreset__text">
                      <span className="subjpreset__name">{c.label}</span>
                      <span className="subjpreset__desc">{c.hint.replace('{what}', what)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <Segmented label="Show" value={s.show} options={PARTS('Everything')} onChange={(v) => set({ show: v })} />
            <Segmented
              label="Looks on"
              value={s.looks}
              options={PARTS('Everything')}
              onChange={(v) => set({ looks: v })}
            />
            <Select<number>
              label="Blend"
              value={s.looksBlend}
              options={BLEND_MODES}
              onChange={(v) => set({ looksBlend: v })}
            />
            <Segmented
              label="Drop background"
              value={s.looksKey}
              options={KEYS}
              onChange={(v) => set({ looksKey: v })}
            />
            <p className="muted small">
              Drop the looks’ own dark (or light) background, so only their characters sit on the {what}.
            </p>
            <Slider
              label="Strength"
              hint="How much of the looks shows where they go"
              value={Math.round(s.looksMix * 100)}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(v) => set({ looksMix: v / 100 }, 'looksMix')}
            />
          </Group>

          <Group title="Edges" icon="fit" summary={s.invert ? 'Swapped' : undefined}>
            <Slider
              label="Threshold"
              hint="Where subject turns into background: higher keeps only what the model is surest of"
              value={s.threshold}
              min={0}
              max={1}
              onChange={(v) => set({ threshold: v }, 'threshold')}
            />
            <Slider
              label="Softness"
              value={s.softness}
              min={0}
              max={1}
              onChange={(v) => set({ softness: v }, 'softness')}
            />
            <Slider
              label="Grow / shrink"
              value={s.expand}
              min={-5}
              max={5}
              step={0.1}
              unit="%"
              onChange={(v) => set({ expand: v }, 'expand')}
            />
            <Switch label="Swap subject & background" checked={s.invert} onChange={(v) => set({ invert: v })} />
            {(moving || live) && (
              <Switch
                label="Steady edges"
                hint={
                  live
                    ? 'Blend each mask with the one before it: less flicker'
                    : 'Blend each mask with its neighbours in time: less flicker'
                }
                checked={s.steady}
                onChange={(v) => set({ steady: v })}
              />
            )}
          </Group>

          <Group title="Background" icon="image" summary={neutralBg ? 'As is' : 'Changed'} defaultOpen={!neutralBg}>
            <p className="muted small">
              {s.show === 'subject'
                ? 'Hidden while only the subject shows. '
                : 'Applied to the background before the looks. '}
              Dim or blur it to make the subject stand out.
            </p>
            <Slider
              label="Brightness"
              value={Math.round(s.bgBrightness * 100)}
              min={0}
              max={200}
              step={1}
              unit="%"
              onChange={(v) => set({ bgBrightness: v / 100 }, 'bgBrightness')}
            />
            <Slider
              label="Blur"
              value={Math.round(s.bgBlur * 100)}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(v) => set({ bgBlur: v / 100 }, 'bgBlur')}
            />
            <Slider
              label="Saturation"
              value={Math.round(s.bgSaturation * 100)}
              min={0}
              max={200}
              step={1}
              unit="%"
              onChange={(v) => set({ bgSaturation: v / 100 }, 'bgSaturation')}
            />
            {!neutralBg && (
              <button
                type="button"
                className="pbtn pbtn--block pbtn--ghost"
                onClick={() => set({ bgBrightness: 1, bgBlur: 0, bgSaturation: 1 })}
              >
                <Icon name="reset" size={14} /> Leave the background as it is
              </button>
            )}
          </Group>
        </>
      )}
    </div>
  );
}

// ─── Status ──────────────────────────────────────────────────────────────────

function SubjectStatus({
  info,
  live,
  method,
  gpu,
  analysable,
  onAnalyse,
  onStop,
  onMethod,
}: {
  info: SubjectInfo;
  live: boolean;
  method: SegmentMethod;
  /** WebGPU can run here (AI · best downloads only then). */
  gpu: boolean;
  /** It can be analysed as set up (a tracked area needs a track). */
  analysable: boolean;
  onAnalyse: () => void;
  onStop: () => void;
  /** Switch to another method (the way out of a failure). */
  onMethod: (m: SegmentMethod) => void;
}) {
  const hq = method === 'ai-hq';
  if (live) {
    return info.status === 'error' ? (
      <>
        <p className="subjerror" role="alert">
          {info.error ?? 'The webcam couldn’t be separated.'}
        </p>
        {hq && (
          <button type="button" className="pbtn pbtn--block pbtn--primary" onClick={() => onMethod('ai-fast')}>
            Try AI · fast: any browser
          </button>
        )}
        {method !== 'classic' && (
          <button type="button" className="pbtn pbtn--block" onClick={() => onMethod('classic')}>
            Try Classic: no download
          </button>
        )}
      </>
    ) : (
      <p className="subjline">
        {info.job ? <span className="spinner" /> : <span className={`led${info.frames ? ' led--basil' : ''}`} />}
        {info.job
          ? jobText(info.job)
          : info.frames
            ? `Separated live, frame by frame${info.backend ? ` (${ranOn(info.backend)[0]})` : ''}`
            : 'Separating live, as the webcam plays…'}
      </p>
    );
  }

  // The size only while the model may not be downloaded yet (masks made on the GPU were made by AI · best).
  const size = hq && gpu && info.backend !== 'webgpu' ? ` · ${HQ_MB} MB` : '';
  const analyseLabel = `Analyse${info.frames ? '' : size}`;
  switch (info.status) {
    case 'running': {
      const pct = Math.round((info.job?.progress ?? 0) * 100);
      return (
        <>
          <p className="subjline">
            <span className="spinner" />
            {jobText(info.job)}
          </p>
          <div className="trackprogress">
            <span className="bar">
              <span className="bar__fill" style={{ width: `${pct}%` }} />
            </span>
            <button type="button" className="pbtn pbtn--small" onClick={onStop}>
              Stop {pct}%
            </button>
          </div>
        </>
      );
    }
    case 'ready': {
      const [where, caption] = ranOn(info.backend);
      return (
        <>
          <div className="trackstats">
            <span>
              <b>{info.frames}</b> {info.frames === 1 ? 'mask' : 'masks'}
            </span>
            <span>
              <b>{info.ms !== undefined ? `${secs(info.ms / 1000)} s` : '—'}</b> to analyse
            </span>
            <span>
              <b>{where}</b> {caption}
            </span>
          </div>
          <button type="button" className="pbtn pbtn--block" onClick={onAnalyse}>
            <Icon name="reset" size={14} /> Analyse again
          </button>
        </>
      );
    }
    case 'stale':
      return (
        <>
          <p className="muted small">
            {info.reason === 'range'
              ? 'More of the clip shows on the canvas now (a longer canvas, or a trim) than was analysed: there, the nearest mask holds until it’s analysed again.'
              : 'Settings changed since the last analysis. The masks from before still show until it’s analysed again.'}
          </p>
          <button type="button" className="pbtn pbtn--block pbtn--primary" onClick={onAnalyse} disabled={!analysable}>
            <Icon name="play" size={12} /> Analyse again{size}
          </button>
        </>
      );
    case 'error':
      return (
        <>
          <p className="subjerror" role="alert">
            {info.error ?? 'The subject couldn’t be separated.'}
          </p>
          {hq ? (
            <>
              <div className="btnrow btnrow--split">
                <button type="button" className="pbtn pbtn--primary" onClick={() => onMethod('ai-fast')}>
                  Try AI · fast
                </button>
                <button type="button" className="pbtn" onClick={() => onMethod('classic')}>
                  Try Classic
                </button>
              </div>
              <button type="button" className="pbtn pbtn--block" onClick={onAnalyse} disabled={!analysable}>
                <Icon name="reset" size={14} /> Analyse again
              </button>
            </>
          ) : (
            <div className="btnrow btnrow--split">
              {method !== 'classic' ? (
                <button type="button" className="pbtn pbtn--primary" onClick={() => onMethod('classic')}>
                  Try Classic
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="pbtn" onClick={onAnalyse} disabled={!analysable}>
                <Icon name="reset" size={14} /> Analyse again
              </button>
            </div>
          )}
        </>
      );
    default:
      return (
        <>
          <p className="muted small">
            {hq && gpu
              ? `Not separated yet. BiRefNet downloads ${HQ_MB} MB the first time (then it’s cached): start it when you’re ready.`
              : 'Not separated yet.'}
          </p>
          <button type="button" className="pbtn pbtn--block pbtn--primary" onClick={onAnalyse} disabled={!analysable}>
            <Icon name="play" size={12} /> {analyseLabel}
          </button>
        </>
      );
  }
}

// ─── Composition glyph ───────────────────────────────────────────────────────

/** A figure (head and shoulders) on a 40 × 28 frame. */
const FIGURE = 'M24.6 9.6a4.6 4.6 0 1 1-9.2 0a4.6 4.6 0 1 1 9.2 0zM10 28c0-6.3 4.4-10.3 10-10.3S30 21.7 30 28z';

/**
 * A little picture of a composition: the untouched picture plain, the looks
 * as dots (over a dimmed picture when laid over it), see-through as a checker.
 */
function CompGlyph({ show, looks, overlay }: { show: SubjectPart; looks: SubjectPart; overlay: boolean }) {
  const id = useId().replace(/[^\w-]/g, '');
  const paint = (part: 'subject' | 'background') => {
    const shape = (fill?: string, className?: string) =>
      part === 'subject' ? (
        <path d={FIGURE} fill={fill} className={className} />
      ) : (
        <rect width="40" height="28" fill={fill} className={className} />
      );
    const plain = part === 'subject' ? 'subjglyph__fg' : 'subjglyph__bg';
    if (show !== 'all' && show !== part) return shape(`url(#${id}-clear)`);
    if (looks !== 'all' && looks !== part) return shape(undefined, plain);
    if (!overlay) return shape(`url(#${id}-fx)`);
    return (
      <>
        {shape(undefined, 'subjglyph__under')}
        {shape(`url(#${id}-dots)`)}
      </>
    );
  };
  return (
    <svg className="subjglyph" viewBox="0 0 40 28" aria-hidden="true">
      <defs>
        <pattern id={`${id}-clear`} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" className="subjglyph__clear-a" />
          <path d="M0 0h4v4H0zM4 4h4v4H4z" className="subjglyph__clear-b" />
        </pattern>
        <pattern id={`${id}-fx`} width="3.5" height="3.5" patternUnits="userSpaceOnUse">
          <rect width="3.5" height="3.5" className="subjglyph__ink" />
          <circle cx="1.75" cy="1.75" r="0.9" className="subjglyph__dot" />
        </pattern>
        <pattern id={`${id}-dots`} width="3.5" height="3.5" patternUnits="userSpaceOnUse">
          <circle cx="1.75" cy="1.75" r="0.9" className="subjglyph__dot" />
        </pattern>
      </defs>
      {paint('background')}
      {paint('subject')}
    </svg>
  );
}
