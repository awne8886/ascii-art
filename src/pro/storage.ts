import { effectById } from './effects/registry';
import { type EffectDef } from './effects/types';
import { type MediaStore } from './media';
import {
  defaultCanvasFinish,
  defaultLayerFinish,
  newLayer,
  newProject,
  upgradeEffect,
  type EffectInstance,
  type Layer,
  type Project,
} from './model';

/**
 * Autosave: the project as JSON in localStorage, the files its layers use in
 * IndexedDB (they can be large). Everything stays on this device.
 */

const PROJECT_KEY = 'ascii-art:pro:project:v1';
const LOOKS_KEY = 'ascii-art:pro:looks:v1';
const DB = 'ascii-art-pro';
const STORE = 'media';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
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

export function saveProject(p: Project): void {
  try {
    // Webcams can't come back without asking again: leave them out.
    const saved: Project = { ...p, layers: p.layers.filter((l) => l.kind !== 'webcam') };
    localStorage.setItem(PROJECT_KEY, JSON.stringify(saved));
    void pruneMedia(new Set(saved.layers.map((l) => l.mediaId).filter((id): id is string => !!id)));
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
