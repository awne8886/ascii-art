import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type AsciiEngine, type EngineStats, type FinalMask } from './ascii/engine';
import { Sidebar, type SegmentStatus } from './components/Sidebar';
import { Stage } from './components/Stage';
import { Curtain } from './Curtain';
import { handOff } from './handoff';
import { alphaMask, fromSource, loadImageFile, type SourceImage } from './image';
import { pizzaSample } from './sample';
import { segment, type SegmentProgress } from './segment/client';
import { finalizeMask, type SoftMask } from './segment/refine';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

const MOBILE = '(max-width: 760px)';

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function baseName(name: string): string {
  return (name.replace(/\.[^.]+$/, '') || 'image').replace(/[^\w.-]+/g, '-').slice(0, 60);
}

function progressText(p: SegmentProgress): { text: string; progress?: number } {
  switch (p.phase) {
    case 'download': {
      const mb = (n?: number) => ((n ?? 0) / 1e6).toFixed(1);
      return {
        text: `Downloading model ${mb(p.loaded)} / ${mb(p.total)} MB`,
        progress: (p.loaded ?? 0) / (p.total || 1),
      };
    }
    case 'init':
      return { text: 'Starting the model…' };
    case 'infer':
      return { text: 'Finding the subject…' };
    case 'refine':
      return { text: 'Refining the edges…' };
  }
}

function sampleImage(): SourceImage {
  const c = pizzaSample();
  return fromSource(c, c.width, c.height, 'pizza-sample.png');
}

let imageSeq = 0;
const imageIds = new WeakMap<SourceImage, number>();
function imageId(img: SourceImage): number {
  let id = imageIds.get(img);
  if (id === undefined) imageIds.set(img, (id = ++imageSeq));
  return id;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [image, setImage] = useState<SourceImage | null>(sampleImage);
  const [soft, setSoft] = useState<{ key: string; mask: SoftMask } | null>(null);
  const [segStatus, setSegStatus] = useState<SegmentStatus & { key: string }>({ key: '', state: 'idle', text: '' });
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [open, setOpen] = useState(() => !window.matchMedia(MOBILE).matches);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Coming back from PRO: let the ASCII sheet dissolve off the page.
  const [arriving, setArriving] = useState(() => {
    try {
      return sessionStorage.getItem('ascii-art:from-pro') === '1';
    } catch {
      return false;
    }
  });
  const engineRef = useRef<AsciiEngine | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wantedKey = useRef('');

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);

  useEffect(() => {
    const t = setTimeout(() => saveSettings(settings), 300);
    return () => clearTimeout(t);
  }, [settings]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const loadSample = useCallback(() => setImage(sampleImage()), []);

  const goPro = useCallback(() => {
    if (image) handOff(image.canvas, image.name);
    setLeaving(true);
  }, [image]);

  useEffect(() => {
    try {
      if (arriving) sessionStorage.removeItem('ascii-art:from-pro');
    } catch {
      // Fine.
    }
  }, [arriving]);

  const openFile = useCallback(async (file: File | Blob, name = (file as File).name || 'pasted-image') => {
    if (file.type && !file.type.startsWith('image/')) {
      setToast('That doesn’t look like an image.');
      return;
    }
    try {
      setImage(await loadImageFile(file, name));
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ─── Drag & drop, paste, keyboard ────────────────────────────────────────

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file =
        Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/')) ?? e.dataTransfer?.files[0];
      if (file) void openFile(file);
    };
    const paste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void openFile(file, file.name || 'pasted-image.png');
      }
    };
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest('input, textarea, select')) return;
      if (e.key === 'h' || e.key === 'H') setOpen((o) => !o);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
      window.removeEventListener('keydown', key);
    };
  }, [openFile]);

  // ─── Segmentation ────────────────────────────────────────────────────────

  const segKey =
    image && settings.separate ? `${imageId(image)}:${image.hasAlpha ? 'alpha' : settings.segmentMethod}` : '';

  // A cut-out PNG brings its own mask; anything else goes to the segmentation worker.
  const alphaSoft = useMemo(() => (image?.hasAlpha ? alphaMask(image) : null), [image]);
  const needsModel = !!segKey && !image?.hasAlpha && soft?.key !== segKey;

  useEffect(() => {
    wantedKey.current = segKey;
    if (!needsModel || !image) return;
    const key = segKey;
    segment(key, image.work, settings.segmentMethod, (p) => {
      if (wantedKey.current === key) setSegStatus({ key, state: 'running', ...progressText(p) });
    }).then(
      (r) => {
        if (wantedKey.current !== key) return;
        setSoft({ key, mask: r.mask });
        const where = r.backend === 'webgpu' ? 'GPU' : r.backend === 'wasm' ? 'CPU' : 'no model';
        setSegStatus({ key, state: 'done', text: `Subject found in ${(r.ms / 1000).toFixed(1)} s (${where})` });
      },
      (e: unknown) => {
        if (wantedKey.current !== key) return;
        const msg = e instanceof Error ? e.message : String(e);
        setSegStatus({ key, state: 'error', text: `${msg} Try “Classic”, which needs no download.` });
      },
    );
  }, [segKey, needsModel, image, settings.segmentMethod]);

  const status: SegmentStatus = !segKey
    ? { state: 'idle', text: '' }
    : image?.hasAlpha
      ? { state: 'done', text: 'Subject from transparency' }
      : segStatus.key === segKey
        ? segStatus
        : { state: 'running', text: 'Preparing…' };

  const activeSoft = image?.hasAlpha ? alphaSoft : soft?.key === segKey ? soft.mask : null;
  const mask: FinalMask | null = useMemo(() => {
    if (!settings.separate || !activeSoft) return null;
    const data = finalizeMask(activeSoft, {
      threshold: settings.maskThreshold,
      softness: settings.maskSoftness,
      expand: settings.maskExpand,
      invert: settings.invertMask,
    });
    return { data, width: activeSoft.width, height: activeSoft.height };
  }, [
    activeSoft,
    settings.separate,
    settings.maskThreshold,
    settings.maskSoftness,
    settings.maskExpand,
    settings.invertMask,
  ]);

  // ─── Export ──────────────────────────────────────────────────────────────

  const name = image ? baseName(image.name) : 'ascii';
  const exportPng = async (scale: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    setExportBusy('Rendering PNG…');
    try {
      download(await engine.snapshot(scale), `${name}-ascii.png`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(null);
    }
  };
  const exportVideo = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setExportBusy('Recording… 0%');
    try {
      const { blob, ext } = await engine.record(6, (f) => setExportBusy(`Recording… ${Math.round(f * 100)}%`));
      download(blob, `${name}-ascii.${ext}`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(null);
    }
  };
  const copyText = async () => {
    const text = engineRef.current?.text() ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setToast(`Copied ${text.split('\n').length} lines of ASCII.`);
    } catch {
      download(new Blob([text], { type: 'text/plain' }), `${name}-ascii.txt`);
    }
  };

  return (
    <div className={`app${open ? ' app--panel' : ''}`}>
      <header className="topbar">
        <span className="brand">
          ascii<span className="brand__accent">art</span>
        </span>
        <span className="topbar__tag">photo → colour ascii</span>
      </header>

      <Stage
        image={image}
        mask={mask}
        settings={settings}
        energy={dragging ? 1 : 0}
        onEngine={(e) => (engineRef.current = e)}
        onStats={setStats}
      />

      {!open && (
        <button
          type="button"
          className="panel-toggle"
          onClick={() => setOpen(true)}
          aria-label="Show controls"
          title="Show controls (H)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span>controls</span>
        </button>
      )}
      {!open && (
        <button type="button" className="panel-toggle panel-toggle--pro" onClick={goPro} title="Open the PRO studio">
          <span className="pro-pill">pro</span>
          <span>studio</span>
        </button>
      )}

      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        settings={settings}
        update={update}
        onReset={() => setSettings({ ...DEFAULT_SETTINGS })}
        imageName={image?.name ?? null}
        imageSize={image ? [image.width, image.height] : null}
        grid={stats ? [stats.cols, stats.rows] : null}
        hasAlpha={!!image?.hasAlpha}
        segment={status}
        onPick={() => fileRef.current?.click()}
        onSample={loadSample}
        exportBusy={exportBusy}
        onExportPng={(k) => void exportPng(k)}
        onExportVideo={() => void exportVideo()}
        onCopyText={() => void copyText()}
        onPro={goPro}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void openFile(f);
          e.currentTarget.value = '';
        }}
      />

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay__box">drop to convert</div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {leaving && <Curtain mode="cover" onDone={() => (location.hash = '#/pro')} />}
      {arriving && <Curtain mode="reveal" onDone={() => setArriving(false)} />}
    </div>
  );
}
