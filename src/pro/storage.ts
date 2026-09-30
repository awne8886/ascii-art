import { effectById } from './effects/registry';
import { type EffectDef } from './effects/types';
import { type MediaStore } from './media';
import {
  defaultCanvasFinish,
  defaultLayerFinish,
  defaultSubject,
  newLayer,
  newProject,
  upgradeEffect,
  type EffectInstance,
  type Layer,
  type Project,
} from './model';

/**
 * Autosave: the project as JSON in localStorage, the files its layers use and
 * their analysed subject masks in IndexedDB (they can be large). Everything
 * stays on this device.
 */

const PROJECT_KEY = 'ascii-art:pro:project:v1';
const LOOKS_KEY = 'ascii-art:pro:looks:v1';
const DB = 'ascii-art-pro';
/** Files by media id. */
const MEDIA = 'media';
/** Analysed subject masks by layer id (version 2 of the database added them). */
const MASKS = 'masks';
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB, DB_VERSION);
    // Create whichever stores are missing, so upgrading keeps the files already saved.
    req.onupgradeneeded = () => {
      for (const name of [MEDIA, MASKS]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'));
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
  store: typeof MEDIA | typeof MASKS = MEDIA,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

interface StoredMedia {
  name: string;
  blob: Blob;
}

export async function saveMediaFile(id: string, name: string, blob: Blob): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put({ name, blob } satisfies StoredMedia, id));
  } catch {
    // Storage full or blocked: the project still works, it just won't come back after a reload.
  }
}

async function pruneMedia(keep: Set<string>): Promise<void> {
  try {
    const keys = (await tx('readonly', (s) => s.getAllKeys())) as string[];
    for (const k of keys) if (!keep.has(k)) await tx('readwrite', (s) => s.delete(k));
  } catch {
    // Nothing to prune.
  }
}

// ─── Subject masks ───────────────────────────────────────────────────────────

/** A layer's analysed masks (the record is subject/masks.ts's to write and to validate). */
export async function saveMasks(layerId: string, record: unknown): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(record, layerId), MASKS);
  } catch {
    // Storage full or blocked: the masks just need analysing again after a reload.
  }
}

/** A layer's saved masks record, or undefined (none, or storage unavailable). */
export async function loadMasks(layerId: string): Promise<unknown> {
  try {
    return await tx<unknown>('readonly', (s) => s.get(layerId), MASKS);
  } catch {
    return undefined;
  }
}

export async function deleteMasks(layerId: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(layerId), MASKS);
  } catch {
    // Already gone, or storage unavailable.
  }
}

const pruneListeners = new Set<(layerIds: string[]) => void>();

/**
 * Hear which layers' saved masks were pruned (their layers had left the
 * project), so masks still held in memory for them can be saved again if
 * undo brings the layer back.
 */
export function onMasksPruned(fn: (layerIds: string[]) => void): () => void {
  pruneListeners.add(fn);
  return () => pruneListeners.delete(fn);
}

async function pruneMasks(keep: Set<string>): Promise<void> {
  try {
    const keys = (await tx('readonly', (s) => s.getAllKeys(), MASKS)) as string[];
    const gone = keys.filter((k) => !keep.has(k));
    for (const k of gone) await tx('readwrite', (s) => s.delete(k), MASKS);
    if (gone.length) pruneListeners.forEach((fn) => fn(gone));
  } catch {
    // Nothing to prune.
  }
}

export function saveProject(p: Project): void {
  try {
    // Webcams can't come back without asking again: leave them out.
    const saved: Project = { ...p, layers: p.layers.filter((l) => l.kind !== 'webcam') };
    localStorage.setItem(PROJECT_KEY, JSON.stringify(saved));
    void pruneMedia(new Set(saved.layers.map((l) => l.mediaId).filter((id): id is string => !!id)));
    void pruneMasks(new Set(saved.layers.map((l) => l.id)));
  } catch {
    // Private mode or full storage.
  }
}

export function clearSavedProject(): void {
  try {
    localStorage.removeItem(PROJECT_KEY);
  } catch {
    // Fine.
  }
  void pruneMedia(new Set());
  void pruneMasks(new Set());
}

function sanitizeEffects(list: unknown): EffectInstance[] {
  if (!Array.isArray(list)) return [];
  return (list as EffectInstance[]).filter((e) => e && effectById(e.effectId)).map((e) => upgradeEffect(e));
}

/** A saved project, with its files reloaded into `media`; null if there is none (or it can't be read). */
export async function loadProject(media: MediaStore): Promise<Project | null> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Project;
    if (saved.version !== 1 || !Array.isArray(saved.layers)) return null;
    const base = newProject();
    const layers: Layer[] = [];
    for (const l of saved.layers) {
      if (l.mediaId) {
        const stored = await tx<StoredMedia | undefined>('readonly', (s) => s.get(l.mediaId!)).catch(() => undefined);
        if (!stored) continue;
        try {
          await media.addFile(stored.blob, stored.name, l.mediaId);
        } catch {
          continue;
        }
      }
      const fresh = newLayer(l.kind, l.name);
      layers.push({
        ...fresh,
        ...l,
        effects: sanitizeEffects(l.effects),
        finish: { ...defaultLayerFinish(), ...l.finish },
        motion: Array.isArray(l.motion) ? l.motion : [],
        // Settings added since the project was saved get their defaults.
        ...(l.subject ? { subject: { ...defaultSubject(), ...l.subject } } : {}),
      });
    }
    return {
      ...base,
      ...saved,
      canvas: { ...base.canvas, ...saved.canvas },
      layers,
      effects: sanitizeEffects(saved.effects),
      finish: { ...defaultCanvasFinish(), ...saved.finish },
    };
  } catch {
    return null;
  }
}

// ─── Saved looks ─────────────────────────────────────────────────────────────

export interface SavedLook {
  id: string;
  name: string;
  effects: EffectInstance[];
}

export function loadLooks(): SavedLook[] {
  try {
    const raw = localStorage.getItem(LOOKS_KEY);
    const list = raw ? (JSON.parse(raw) as SavedLook[]) : [];
    return list.map((l) => ({ ...l, effects: sanitizeEffects(l.effects) })).filter((l) => l.effects.length > 0);
  } catch {
    return [];
  }
}

export function saveLooks(looks: SavedLook[]): void {
  try {
    localStorage.setItem(LOOKS_KEY, JSON.stringify(looks));
  } catch {
    // Not persisted.
  }
}

export function lookName(effects: EffectInstance[]): string {
  return effects
    .map((e) => effectById(e.effectId))
    .filter((d): d is EffectDef => !!d)
    .map((d) => d.name)
    .join(' + ');
}
