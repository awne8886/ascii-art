import { useCallback, useMemo, useReducer } from 'react';
import { looksKeyFor, type EffectInstance, type Layer, type Project } from './model';

/**
 * Studio state: the project plus undo/redo history. Every edit is a pure
 * `Project → Project` recipe; rapid edits that share a `coalesce` key (a
 * slider being dragged, a layer being moved) fold into one undo step.
 */

export interface StudioState {
  project: Project;
  /** Selected layer id; null = the canvas itself. */
  selected: string | null;
  past: Project[];
  future: Project[];
  lastKey: string | null;
  lastAt: number;
}

type Action =
  | { type: 'commit'; recipe: (p: Project) => Project; coalesce?: string; select?: string | null }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; project: Project; select?: string | null };

const LIMIT = 120;
const COALESCE_MS = 700;

function reducer(s: StudioState, a: Action): StudioState {
  switch (a.type) {
    case 'commit': {
      const next = a.recipe(s.project);
      if (next === s.project) return a.select !== undefined ? { ...s, selected: a.select } : s;
      const now = performance.now();
      const merge = !!a.coalesce && a.coalesce === s.lastKey && now - s.lastAt < COALESCE_MS;
      const past = merge ? s.past : [...s.past, s.project].slice(-LIMIT);
      const selected = a.select !== undefined ? a.select : s.selected;
      return { ...s, project: next, past, future: [], lastKey: a.coalesce ?? null, lastAt: now, selected };
    }
    case 'select':
      return { ...s, selected: a.id, lastKey: null };
    case 'undo': {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return {
        ...s,
        project: prev,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future].slice(0, LIMIT),
        lastKey: null,
        selected: validSelection(prev, s.selected),
      };
    }
    case 'redo': {
      const next = s.future[0];
      if (!next) return s;
      return {
        ...s,
        project: next,
        past: [...s.past, s.project].slice(-LIMIT),
        future: s.future.slice(1),
        lastKey: null,
        selected: validSelection(next, s.selected),
      };
    }
    case 'load':
      return {
        project: a.project,
        selected: a.select !== undefined ? a.select : (a.project.layers.at(-1)?.id ?? null),
        past: [],
        future: [],
        lastKey: null,
        lastAt: 0,
      };
  }
}

function validSelection(p: Project, id: string | null): string | null {
  return id && p.layers.some((l) => l.id === id) ? id : null;
}

export interface Studio {
  state: StudioState;
  project: Project;
  selectedLayer: Layer | null;
  commit: (recipe: (p: Project) => Project, coalesce?: string, select?: string | null) => void;
  select: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
  load: (p: Project, select?: string | null) => void;
}

export function useStudio(init: () => Project): Studio {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const project = init();
    return {
      project,
      selected: project.layers.at(-1)?.id ?? null,
      past: [],
      future: [],
      lastKey: null,
      lastAt: 0,
    } satisfies StudioState;
  });
  const commit = useCallback(
    (recipe: (p: Project) => Project, coalesce?: string, select?: string | null) =>
      dispatch({ type: 'commit', recipe, coalesce, select }),
    [],
  );
  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const load = useCallback(
    (project: Project, sel?: string | null) => dispatch({ type: 'load', project, select: sel }),
    [],
  );
  const selectedLayer = useMemo(
    () => state.project.layers.find((l) => l.id === state.selected) ?? null,
    [state.project.layers, state.selected],
  );
  return { state, project: state.project, selectedLayer, commit, select, undo, redo, load };
}

// ─── Edit recipes ──────────────────────────────────────────────────────────

export function updateLayer(id: string, patch: Partial<Layer> | ((l: Layer) => Layer)) {
  return (p: Project): Project => ({
    ...p,
    layers: p.layers.map((l) => (l.id === id ? (typeof patch === 'function' ? patch(l) : { ...l, ...patch }) : l)),
  });
}

/** The effect stack of a layer, or of the canvas (owner null). */
export function effectsOf(p: Project, owner: string | null): EffectInstance[] {
  if (owner === null) return p.effects;
  return p.layers.find((l) => l.id === owner)?.effects ?? [];
}

export function setEffects(owner: string | null, fn: (fx: EffectInstance[]) => EffectInstance[]) {
  return (p: Project): Project =>
    owner === null ? { ...p, effects: fn(p.effects) } : updateLayer(owner, (l) => withLooks(l, fn(l.effects)))(p);
}

/**
 * A layer with other looks. A subject key that drops the looks' own
 * background follows them (dark paper to light and back) while it suits the
 * looks it was set for (those that show in its composition); one set
 * against them stays as it is.
 */
function withLooks(l: Layer, effects: EffectInstance[]): Layer {
  const s = l.subject;
  if (!s || s.looksKey === 'off' || s.looksKey !== looksKeyFor(l.effects, s)) return { ...l, effects };
  const looksKey = looksKeyFor(effects, s);
  return { ...l, effects, subject: looksKey === s.looksKey ? s : { ...s, looksKey } };
}

export function updateEffect(owner: string | null, uid: string, patch: Partial<EffectInstance>) {
  return setEffects(owner, (list) => list.map((e) => (e.uid === uid ? { ...e, ...patch } : e)));
}

export function addLayer(layer: Layer) {
  return (p: Project): Project => ({ ...p, layers: [...p.layers, layer] });
}

export function removeLayer(id: string) {
  return (p: Project): Project => ({ ...p, layers: p.layers.filter((l) => l.id !== id) });
}

/** Move a layer up (towards the top, +1) or down (−1) the stack, or to an index. */
export function moveLayer(id: string, by: number) {
  return (p: Project): Project => {
    const i = p.layers.findIndex((l) => l.id === id);
    const j = Math.max(0, Math.min(p.layers.length - 1, i + by));
    if (i < 0 || i === j) return p;
    const layers = [...p.layers];
    const [l] = layers.splice(i, 1);
    layers.splice(j, 0, l!);
    return { ...p, layers };
  };
}
