import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Curtain } from '../Curtain';
import { takeHandoff } from '../handoff';
import { Clock } from './clock';
import { DrawnCache, layerMediaDuration, layerSize } from './frames';
import { placedQuad, quadPoint } from './geometry';
import { MediaStore, type MediaItem } from './media';
import {
  defaultShape,
  defaultText,
  mediaTime,
  newLayer,
  timelineTime,
  newProject,
  uid,
  type Layer,
  type Project,
  type ShapeType,
} from './model';
import { SAMPLE_DURATION } from './sources';
import { addLayer, removeLayer, updateLayer, useStudio } from './store';
import { clearSavedProject, loadProject, saveMediaFile, saveProject } from './storage';
import { SubjectStore } from './subject/store';
import { TEMPLATES, type Template } from './templates';
import { PanelTitle } from './ui/controls';
import { ExportDialog } from './ui/ExportDialog';
import { Icon, type IconName } from './ui/icons';
import { LookPanel } from './ui/LookPanel';
import { TrackPanel } from './ui/TrackPanel';
import { HelpModal, TemplatesModal, WelcomeModal } from './ui/modals';
import {
  CanvasPanel,
  FinishControls,
  LayerPanel,
  MovePanel,
  ScenePanel,
  SoundPanel,
  TiltPanel,
  type SceneOptions,
} from './ui/panels';
import { AddPanel, LayersPanel } from './ui/rail';
import { autoAnalyses, refreshSubject, startAnalysis, SubjectPanel } from './ui/SubjectPanel';
import { Timeline } from './ui/Timeline';
import { Viewport, type Zoom } from './ui/Viewport';
import './pro.css';

type Tab = 'look' | 'move' | 'sound' | '3d' | 'track' | 'subject' | 'layer' | 'canvas' | 'finish' | 'scene';
type Modal = 'export' | 'templates' | 'welcome' | 'help' | null;

const WELCOMED_KEY = 'ascii-art:pro:welcomed';
const MAX_CANVAS = 3840;

const TAB_TITLE: Record<Tab, string> = {
  look: 'Look',
  move: 'Move',
  sound: 'Sound',
  '3d': '3D',
  layer: 'Layer',
  canvas: 'Canvas',
  finish: 'Finish',
  scene: 'Scene',
  track: 'Track',
  subject: 'Subject',
};

function starter(): Project {
  const p = TEMPLATES[0]!.build();
  return { ...p, name: 'Untitled' };
}

function fitCanvas(w: number, h: number): [number, number] {
  const k = Math.min(1, MAX_CANVAS / Math.max(w, h));
  return [Math.max(16, Math.round((w * k) / 2) * 2), Math.max(16, Math.round((h * k) / 2) * 2)];
}

function welcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === '1';
  } catch {
    return true;
  }
}

export function ProApp() {
  const media = useMemo(() => new MediaStore(), []);
  const clock = useMemo(() => new Clock(), []);
  const drawn = useMemo(() => new DrawnCache(1), []);
  // Separated subjects' masks: outside the project (they can be tens of MB), kept per layer.
  const subjects = useMemo(() => new SubjectStore(media), [media]);
  const studio = useStudio(starter);
  const { project, selectedLayer: layer } = studio;
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('look');
  const [inspector, setInspector] = useState(true);
  const [pop, setPop] = useState<'add' | 'layers' | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [soundOn, setSoundOn] = useState(true);
  const [scene, setScene] = useState<SceneOptions>({ handles: true, guides: false, quality: 'auto' });
  const [picking, setPicking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState(true);
  const [, bumpMedia] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => media.subscribe(() => bumpMedia((n) => n + 1)), [media]);
  // Scripted checks in development poke at the studio through this.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __pro: unknown }).__pro = { studio, media, clock, subjects };
  });
  useEffect(() => () => media.dispose(), [media]);
  useEffect(() => () => subjects.dispose(), [subjects]);
  // Undo / redo can remove a layer, switch its subject off or restore other settings: analyses that no
  // longer fit stop (layers that analyse by themselves analyse again for the settings undo / redo lands on,
  // below). Also keeps the store up with the canvas's length.
  useEffect(() => subjects.sync(project), [project, subjects]);
  // A longer canvas or a trim can show more of a clip than was analysed, and undo / redo can switch a
  // subject on or land on other analysis settings (method, area, rate, track): layers that analyse by
  // themselves (AI · fast, Classic) analyse again once the edit settles, as the same edit in the panel does
  // (panel edits have started already). A Stop holds while the layer wants what it did when it was pressed.
  const autoKeys = useRef<Map<string, string> | null>(null);
  // Just loaded (no history): nothing was edited, so only note the settings.
  const loaded = studio.state.past.length === 0 && studio.state.future.length === 0;
  // Masks saved before a reload land a while after the project: check again then.
  const [restored, setRestored] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      const { keys, start } = autoAnalyses(subjects, project.layers, loaded ? null : autoKeys.current);
      autoKeys.current = keys;
      start.forEach((l) => startAnalysis(subjects, l, setToast));
    }, 600);
    return () => clearTimeout(t);
  }, [project, subjects, loaded, restored]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  // ─── Adding things ───────────────────────────────────────────────────────

  const place = useCallback(
    (l: Layer, item?: MediaItem) => {
      studio.commit(
        (p) => {
          let next = p;
          // The first picture or video sets the canvas: exports come out the size (and length) of what you dropped.
          if (item && p.layers.length === 0) {
            const [w, h] = fitCanvas(item.width, item.height);
            const duration = item.kind === 'video' ? Math.min(600, Math.max(0.5, item.duration)) : p.canvas.duration;
            next = { ...p, canvas: { ...p.canvas, width: w, height: h, duration } };
          }
          const length = item?.kind === 'video' ? item.duration / l.speed : Math.max(l.length, next.canvas.duration);
          return addLayer({ ...l, length })(next);
        },
        undefined,
        l.id,
      );
      setTab('look');
      setInspector(true);
    },
    [studio],
  );

  const addFiles = useCallback(
    async (files: File[] | Blob[], names?: string[]) => {
      let added = 0;
      for (const [i, f] of files.entries()) {
        const name = names?.[i] ?? (f as File).name ?? 'picture';
        const type = f.type || '';
        if (type && !type.startsWith('image/') && !type.startsWith('video/')) {
          setToast(`“${name}” isn’t a picture or a video.`);
          continue;
        }
        try {
          const item = await media.addFile(f, name);
          void saveMediaFile(item.id, name, f);
          place(
            newLayer(item.kind === 'video' ? 'video' : 'image', name.replace(/\.[^.]+$/, ''), { mediaId: item.id }),
            item,
          );
          added++;
        } catch (e) {
          setToast(e instanceof Error ? e.message : String(e));
        }
      }
      if (added) {
        clock.seek(0);
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) clock.play();
      }
    },
    [media, place, clock],
  );

  const addWebcam = useCallback(async () => {
    try {
      const item = await media.addWebcam();
      place(newLayer('webcam', 'Webcam', { mediaId: item.id, muted: true }));
      clock.play();
    } catch (e) {
      setToast(e instanceof Error ? `Webcam: ${e.message}` : 'The webcam could not be opened.');
    }
  }, [media, place, clock]);

  const addSample = useCallback(() => {
    place(newLayer('sample', 'Sample clip', { fit: 'fill', length: SAMPLE_DURATION }));
    clock.play();
  }, [place, clock]);

  const addText = useCallback(() => place(newLayer('text', 'Type', { text: defaultText() })), [place]);
  const addShape = useCallback(
    (s: ShapeType) => place(newLayer('shape', s[0]!.toUpperCase() + s.slice(1), { shape: defaultShape(s) })),
    [place],
  );

  const applyTemplate = useCallback(
    (t: Template) => {
      const p = t.build();
      subjects.clear();
      studio.load({ ...p, name: project.name === 'Untitled' ? t.name : project.name }, p.layers.at(-1)?.id ?? null);
      setModal(null);
      setTab('look');
      setInspector(true);
      clock.seek(0);
      clock.play();
    },
    [studio, project.name, clock, subjects],
  );

  // ─── Start-up: restore the autosave, take over the classic site's picture ──

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await loadProject(media);
      if (!alive) return;
      if (saved && saved.layers.length) {
        studio.load(saved);
        // Masks analysed before the reload come back from IndexedDB.
        void subjects.restore(saved).then(() => {
          if (alive) setRestored((n) => n + 1);
        });
      }
      const handed = takeHandoff();
      if (handed && handed.name !== 'pizza-sample.png') {
        const blob = await new Promise<Blob | null>((r) => handed.canvas.toBlob(r, 'image/png'));
        if (blob && alive) {
          const name = handed.name.replace(/\.[^.]+$/, '') + '.png';
          const item = await media.addFile(blob, name);
          void saveMediaFile(item.id, name, blob);
          const l = newLayer('image', handed.name.replace(/\.[^.]+$/, ''), { mediaId: item.id });
          if (!saved?.layers.length) {
            // Start from the classic site's picture instead of the sample.
            const base = newProject();
            const [w, h] = fitCanvas(item.width, item.height);
            base.canvas = { ...base.canvas, width: w, height: h };
            l.effects = starter().layers[0]!.effects.map((e) => ({ ...e, uid: uid('fx') }));
            base.layers = [{ ...l, length: base.canvas.duration }];
            base.finish = starter().finish;
            studio.load(base, l.id);
          } else {
            place(l, item);
          }
        }
      }
      if (!alive) return;
      setReady(true);
      if (!welcomed()) setModal('welcome');
      else if (!matchMedia('(prefers-reduced-motion: reduce)').matches) clock.play();
    })();
    return () => {
      alive = false;
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => saveProject(project), 600);
    return () => clearTimeout(t);
  }, [project, ready]);

  // ─── Layer actions ───────────────────────────────────────────────────────

  const duplicate = useCallback(async () => {
    if (!layer) return;
    let mediaId = layer.mediaId;
    if (layer.kind === 'video' && mediaId) {
      const copy = await media.clone(mediaId);
      if (copy) {
        mediaId = copy.id;
        if (copy.blob) void saveMediaFile(copy.id, copy.name, copy.blob);
      }
    }
    const copy: Layer = {
      ...structuredClone(layer),
      id: uid('layer'),
      name: `${layer.name} copy`,
      mediaId,
      x: layer.x + 0.03,
      y: layer.y + 0.03,
    };
    copy.effects = copy.effects.map((e) => ({ ...e, uid: uid('fx') }));
    copy.motion = copy.motion.map((m) => ({ ...m, uid: uid('mo') }));
    // The copy starts with the original's masks when it has any. When those don't fit (the original was still
    // being analysed, or its masks are out of date), the copy analyses by itself, like any layer switched on.
    subjects.copy(layer.id, copy);
    studio.commit(addLayer(copy), undefined, copy.id);
    refreshSubject(subjects, copy, setToast);
  }, [layer, media, studio, subjects]);

  // ─── Tracking ────────────────────────────────────────────────────────────

  const onPicked = useCallback(
    (box: [number, number, number, number] | null) => {
      setPicking(false);
      if (!box || !layer) return;
      const duration = layerMediaDuration(layer, media) ?? 0;
      const at = mediaTime(layer, clock.time, duration) ?? layer.in;
      studio.commit(updateLayer(layer.id, { track: { box, at, duration, from: at, fps: 30, data: [] } }));
    },
    [layer, media, clock, studio],
  );

  /** A text label that follows the selected layer's tracked object, placed just above it. */
  const addFollowLabel = useCallback(() => {
    if (!layer?.track) return;
    const p = studio.project;
    const t = timelineTime(layer, layer.track.at);
    const q = placedQuad(p, layer, t, (l) => layerSize(l, p, media, drawn));
    const [x, y, w] = layer.track.box;
    const [px, py] = q ? quadPoint(q.quad, x + w / 2, y) : [p.canvas.width / 2, p.canvas.height / 2];
    const label = newLayer('text', 'Label', {
      text: {
        ...defaultText(),
        text: 'THIS ONE',
        size: 0.06,
        font: 'mono',
        weight: 700,
        backgroundOn: true,
        background: '#ff5a3c',
      },
      x: px / p.canvas.width - 0.5,
      y: py / p.canvas.height - 0.5 - 0.06,
      follow: { layerId: layer.id, scale: false },
      length: p.canvas.duration,
    });
    studio.commit(addLayer(label), undefined, label.id);
    setTab('layer');
  }, [layer, studio, media, drawn]);

  const remove = useCallback(() => {
    if (!layer) return;
    // Its masks stay (undo may bring the layer back), but an analysis under way stops.
    subjects.cancel(layer.id);
    studio.commit(removeLayer(layer.id), undefined, null);
    setTab('look');
  }, [layer, studio, subjects]);

  const newProjectAction = () => {
    if (!window.confirm('Start a new, empty project? This clears the current one (autosaved on this device).')) return;
    clearSavedProject();
    media.prune(new Set());
    subjects.clear();
    studio.load(newProject());
    clock.pause();
    clock.seek(0);
    setTab('canvas');
    setInspector(true);
  };

  const goClassic = () => {
    clock.pause();
    setLeaving(true);
  };

  // ─── Keyboard, drop, paste ───────────────────────────────────────────────

  const openTab = useCallback((t: Tab) => {
    setTab(t);
    setInspector(true);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable]');
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) studio.redo();
        else studio.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (typing) return;
        e.preventDefault();
        studio.redo();
        return;
      }
      if (typing || modal === 'export') return;
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        void duplicate();
        return;
      }
      if (mod || e.altKey) {
        if (e.altKey && layer && e.key.startsWith('Arrow')) {
          e.preventDefault();
          const d = e.shiftKey ? 0.02 : 0.002;
          const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
          const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
          studio.commit(updateLayer(layer.id, { x: layer.x + dx, y: layer.y + dy }), `nudge:${layer.id}`);
        }
        return;
      }
      const fps = project.canvas.fps;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          clock.toggle();
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          clock.pause();
          const step = (e.shiftKey ? 1 : 1 / fps) * (e.key === 'ArrowLeft' ? -1 : 1);
          clock.seek(Math.max(0, Math.min(project.canvas.duration - 1e-4, clock.time + step)));
          break;
        }
        case 'Home':
          clock.seek(0);
          break;
        case 'End':
          clock.seek(project.canvas.duration - 1 / fps);
          break;
        case 'Delete':
        case 'Backspace':
          if (layer) {
            e.preventDefault();
            remove();
          }
          break;
        case 'Escape':
          if (pop) setPop(null);
          else if (modal) setModal(null);
          else studio.select(null);
          break;
        case '?':
          setModal('help');
          break;
        case 'a':
        case 'A':
          setPop('add');
          break;
        case 'e':
        case 'E':
          setModal('export');
          break;
        case 'l':
        case 'L':
          openTab('look');
          break;
        case 'm':
        case 'M':
          if (layer) openTab('move');
          break;
        case 'c':
        case 'C':
          studio.select(null);
          openTab('canvas');
          break;
        case '0':
          setZoom('fit');
          break;
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [studio, layer, project.canvas, clock, modal, pop, duplicate, remove, openTab]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void addFiles(files);
    };
    const paste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea')) return;
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.type.startsWith('image/') || i.type.startsWith('video/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) {
        e.preventDefault();
        void addFiles(
          files,
          files.map((f) => f.name || 'pasted.png'),
        );
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [addFiles]);

  // A tab that doesn't apply to the current target falls back to Look.
  const layerTabs: Tab[] = ['look', 'move', 'sound', '3d', 'track', 'subject', 'layer', 'canvas'];
  const canvasTabs: Tab[] = ['look', 'finish', 'scene', 'canvas'];
  const activeTab: Tab = (layer ? layerTabs : canvasTabs).includes(tab) ? tab : 'look';

  const pictureSize = useMemo(() => {
    const l = project.layers.find((x) => x.kind === 'image' || x.kind === 'video' || x.kind === 'sample');
    return l ? layerSize(l, project, media, drawn) : null;
  }, [project, media, drawn]);

  const dockItems: { tab: Tab; label: string; icon: IconName; live: boolean }[] = layer
    ? [
        { tab: 'look', label: 'Look', icon: 'look', live: layer.effects.some((e) => e.enabled) },
        { tab: 'move', label: 'Move', icon: 'move', live: layer.motion.some((m) => m.enabled) },
        { tab: 'sound', label: 'Sound', icon: 'wave', live: layer.kind === 'video' && !layer.muted },
        { tab: '3d', label: '3D', icon: 'cube', live: layer.tiltX !== 0 || layer.tiltY !== 0 },
        { tab: 'track', label: 'Track', icon: 'target', live: !!layer.track?.data.length || !!layer.follow },
        { tab: 'subject', label: 'Subject', icon: 'subject', live: !!layer.subject?.on },
        {
          tab: 'layer',
          label: 'Layer',
          icon: 'sliders',
          live: layer.finish.bloom.on || layer.finish.streaks.on || layer.finish.trails.on,
        },
      ]
    : [
        { tab: 'look', label: 'Look', icon: 'look', live: project.effects.some((e) => e.enabled) },
        {
          tab: 'finish',
          label: 'Finish',
          icon: 'sun',
          live: Object.values(project.finish).some((f) => (f as { on: boolean }).on),
        },
        { tab: 'scene', label: 'Scene', icon: 'scene', live: scene.guides },
      ];

  const dock = (
    <div className="dock">
      <span className="dock__grip" aria-hidden="true">
        <Icon name="grip" size={14} />
      </span>
      <button
        type="button"
        className="dock__target"
        onClick={() => (layer ? openTab('layer') : openTab('canvas'))}
        title={layer ? layer.name : 'Canvas'}
      >
        <span className="dock__thumb">
          <Icon
            name={
              !layer
                ? 'canvas'
                : layer.kind === 'video' || layer.kind === 'sample'
                  ? 'film'
                  : layer.kind === 'text'
                    ? 'text'
                    : layer.kind === 'shape'
                      ? 'shapes'
                      : layer.kind === 'webcam'
                        ? 'webcam'
                        : 'image'
            }
            size={16}
          />
        </span>
        <span className="dock__name">{layer ? layer.name : 'Canvas'}</span>
        {!layer && (
          <span className="dock__sub">
            {project.canvas.width} × {project.canvas.height}
          </span>
        )}
      </button>
      <span className="dock__sep" />
      {dockItems.map((d) => (
        <DockButton
          key={d.tab}
          icon={d.icon}
          label={d.label}
          live={d.live}
          on={inspector && activeTab === d.tab}
          onClick={() => (inspector && activeTab === d.tab ? setInspector(false) : openTab(d.tab))}
        />
      ))}
      <span className="dock__sep" />
      <DockButton
        icon="canvas"
        label="Canvas"
        live={false}
        on={inspector && activeTab === 'canvas'}
        onClick={() => {
          if (inspector && activeTab === 'canvas') setInspector(false);
          else {
            studio.select(null);
            openTab('canvas');
          }
        }}
      />
    </div>
  );

  const empty = (
    <div className="empty">
      <span className="dots empty__title">Drop a picture or a video</span>
      <p className="muted small">Every frame goes through your looks. Nothing leaves your device.</p>
      <div className="btnrow">
        <button type="button" className="pbtn pbtn--primary" onClick={() => fileRef.current?.click()}>
          <Icon name="image" size={15} /> Choose files
        </button>
        <button type="button" className="pbtn" onClick={addSample}>
          <Icon name="film" size={15} /> Sample clip
        </button>
        <button type="button" className="pbtn" onClick={() => void addWebcam()}>
          <Icon name="webcam" size={15} /> Webcam
        </button>
        <button type="button" className="pbtn" onClick={() => setModal('templates')}>
          <Icon name="templates" size={15} /> Templates
        </button>
      </div>
    </div>
  );

  const target = layer ? layer.name : 'Canvas';

  return (
    <div className={`pro${inspector ? ' pro--inspector' : ''}${entering ? ' pro--enter' : ''}`}>
      <header className="topbar-pro">
        <button type="button" className="logo" onClick={goClassic} title="Back to the classic site">
          <span className="logo__glyph">@</span>
          <span className="logo__dot" />
        </button>
        <div className="topbar-pro__group">
          <button
            type="button"
            className="pbtn pbtn--icon"
            onClick={studio.undo}
            disabled={!studio.state.past.length}
            aria-label="Undo"
            title="Undo (⌘Z)"
          >
            <Icon name="undo" size={16} />
          </button>
          <button
            type="button"
            className="pbtn pbtn--icon"
            onClick={studio.redo}
            disabled={!studio.state.future.length}
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
          >
            <Icon name="redo" size={16} />
          </button>
        </div>
        <div className="projbar">
          <span className="led led--basil" title="Autosaved on this device" />
          <input
            className="projbar__name dots-input"
            value={project.name}
            onChange={(e) => {
              const name = e.currentTarget.value;
              studio.commit((p) => ({ ...p, name }), 'name');
            }}
            aria-label="Project name"
            spellCheck={false}
          />
          <span className="projbar__sep" />
          <button
            type="button"
            className={`projbar__tab${studio.state.selected === null ? ' projbar__tab--on' : ''}`}
            onClick={() => {
              studio.select(null);
              openTab('canvas');
            }}
          >
            <span className="projbar__home">
              <Icon name="canvas" size={13} />
            </span>
            Main
          </button>
          <span className="projbar__fill" />
          <span className="pro-badge">pro</span>
        </div>
        <div className="topbar-pro__group">
          <button
            type="button"
            className="pbtn pbtn--icon"
            onClick={() => setModal('help')}
            aria-label="Help and shortcuts"
            title="Shortcuts (?)"
          >
            <Icon name="help" size={16} />
          </button>
          <button type="button" className="pbtn" onClick={newProjectAction}>
            <Icon name="file" size={15} /> <span className="hide-sm">New</span>
          </button>
          <button type="button" className="pbtn pbtn--primary" onClick={() => setModal('export')}>
            <Icon name="export" size={15} /> Export
          </button>
          <button type="button" className="pbtn hide-sm" onClick={goClassic} title="Back to the classic site">
            Classic
          </button>
        </div>
      </header>

      <nav className="rail" aria-label="Studio">
        <RailButton icon="plus" label="Add" on={pop === 'add'} onClick={() => setPop(pop === 'add' ? null : 'add')} />
        <RailButton
          icon="layers"
          label="Layers"
          badge={project.layers.length}
          on={pop === 'layers'}
          onClick={() => setPop(pop === 'layers' ? null : 'layers')}
        />
        <RailButton
          icon="templates"
          label="Templates"
          on={modal === 'templates'}
          onClick={() => setModal('templates')}
        />
        <span className="rail__sep" />
        <button type="button" className="rail__classic" onClick={goClassic} title="Back to the classic site">
          Classic
        </button>
      </nav>
      {pop === 'add' && (
        <AddPanel
          onClose={() => setPop(null)}
          add={{
            file: () => fileRef.current?.click(),
            webcam: () => void addWebcam(),
            sample: addSample,
            text: addText,
            shape: addShape,
            templates: () => setModal('templates'),
          }}
        />
      )}
      {pop === 'layers' && (
        <LayersPanel
          studio={studio}
          onClose={() => setPop(null)}
          onRemove={(id) => {
            // Its masks stay (undo may bring the layer back), but an analysis under way stops.
            subjects.cancel(id);
            studio.commit(removeLayer(id));
          }}
        />
      )}

      <main className="stage-pro">
        <Viewport
          studio={studio}
          media={media}
          subjects={subjects}
          clock={clock}
          drawn={drawn}
          zoom={zoom}
          setZoom={setZoom}
          soundOn={soundOn}
          scene={scene}
          dock={dock}
          empty={empty}
          onError={setToast}
          picking={picking && !!layer}
          onPicked={onPicked}
        />
      </main>

      <Timeline studio={studio} clock={clock} media={media} soundOn={soundOn} setSoundOn={setSoundOn} />

      {inspector && (
        <aside className="inspector" aria-label={`${TAB_TITLE[activeTab]} settings`}>
          <PanelTitle
            title={TAB_TITLE[activeTab]}
            sub={activeTab === 'canvas' || activeTab === 'finish' || activeTab === 'scene' ? 'Canvas' : target}
            onClose={() => setInspector(false)}
          />
          <div className="inspector__scroll">
            {activeTab === 'look' && (
              <LookPanel
                studio={studio}
                owner={layer?.id ?? null}
                toast={setToast}
                onOpenSubject={() => openTab('subject')}
                key={layer?.id ?? 'canvas'}
              />
            )}
            {activeTab === 'move' && layer && <MovePanel studio={studio} layer={layer} />}
            {activeTab === 'sound' && layer && (
              <SoundPanel studio={studio} layer={layer} media={media} soundOn={soundOn} setSoundOn={setSoundOn} />
            )}
            {activeTab === '3d' && layer && <TiltPanel studio={studio} layer={layer} />}
            {activeTab === 'track' && layer && (
              <TrackPanel
                studio={studio}
                layer={layer}
                media={media}
                picking={picking}
                onPick={() => {
                  clock.pause();
                  setPicking(true);
                }}
                onAddLabel={addFollowLabel}
                toast={setToast}
                subjects={subjects}
                onOpenSubject={() => openTab('subject')}
                key={layer.id}
              />
            )}
            {activeTab === 'subject' && layer && (
              <SubjectPanel
                studio={studio}
                layer={layer}
                media={media}
                subjects={subjects}
                toast={setToast}
                onOpenTrack={() => openTab('track')}
                key={layer.id}
              />
            )}
            {activeTab === 'layer' && layer && (
              <LayerPanel
                studio={studio}
                layer={layer}
                media={media}
                onDuplicate={() => void duplicate()}
                onDelete={remove}
              />
            )}
            {activeTab === 'canvas' && (
              <CanvasPanel studio={studio} onTemplates={() => setModal('templates')} pictureSize={pictureSize} />
            )}
            {activeTab === 'finish' && (
              <div className="panel-body">
                <FinishControls
                  surface
                  finish={project.finish}
                  onChange={(f, k) => studio.commit((p) => ({ ...p, finish: f as Project['finish'] }), k && `cf:${k}`)}
                />
              </div>
            )}
            {activeTab === 'scene' && <ScenePanel scene={scene} setScene={setScene} />}
          </div>
        </aside>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          if (files.length) void addFiles(files);
          e.currentTarget.value = '';
        }}
      />

      {modal === 'export' && (
        <ExportDialog
          project={project}
          media={media}
          subjects={subjects}
          time={clock.time}
          onClose={() => setModal(null)}
          onDone={setToast}
        />
      )}
      {modal === 'templates' && <TemplatesModal onPick={applyTemplate} onClose={() => setModal(null)} />}
      {modal === 'help' && <HelpModal onClose={() => setModal(null)} />}
      {modal === 'welcome' && (
        <WelcomeModal
          onStart={() => {
            try {
              localStorage.setItem(WELCOMED_KEY, '1');
            } catch {
              // Shows again next time; fine.
            }
            setModal(null);
            if (!matchMedia('(prefers-reduced-motion: reduce)').matches) clock.play();
          }}
          onTemplates={() => {
            try {
              localStorage.setItem(WELCOMED_KEY, '1');
            } catch {
              // Fine.
            }
            setModal('templates');
          }}
        />
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay__box">drop to add a layer</div>
        </div>
      )}
      {toast && (
        <div className="toast toast--pro" role="status">
          {toast}
        </div>
      )}
      {entering && <Curtain mode="reveal" onDone={() => setEntering(false)} />}
      {leaving && (
        <Curtain
          mode="cover"
          ms={450}
          onDone={() => {
            try {
              sessionStorage.setItem('ascii-art:from-pro', '1');
            } catch {
              // No reveal on the way back; fine.
            }
            history.pushState(null, '', location.pathname + location.search);
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }}
        />
      )}
    </div>
  );
}

function RailButton({
  icon,
  label,
  on,
  onClick,
  badge,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button type="button" className={`railbtn${on ? ' railbtn--on' : ''}`} onClick={onClick}>
      <span className="railbtn__box">
        <Icon name={icon} size={20} />
        <span className="railbtn__led" />
        {badge !== undefined && <span className="railbtn__badge">{badge}</span>}
      </span>
      <span className="railbtn__label">{label}</span>
    </button>
  );
}

function DockButton({
  icon,
  label,
  on,
  live,
  onClick,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  live: boolean;
  onClick: () => void;
}) {
  return (
    // Labelled for when a narrow stage hides the captions.
    <button
      type="button"
      className={`dockbtn${on ? ' dockbtn--on' : ''}`}
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
    >
      <span className="dockbtn__box">
        <Icon name={icon} size={18} />
        <span className={`dockbtn__led${live ? ' dockbtn__led--live' : ''}`} />
      </span>
      <span className="dockbtn__label">{label}</span>
    </button>
  );
}
