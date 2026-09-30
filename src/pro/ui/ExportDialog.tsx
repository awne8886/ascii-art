import { useEffect, useMemo, useRef, useState } from 'react';
import {
  exportProject,
  hasWebCodecs,
  type ExportFormat,
  type ExportOptions,
  type ExportProgress,
} from '../export/exporter';
import { type MediaStore } from '../media';
import { type Project } from '../model';
import { ColorRow } from './controls';
import { Icon, type IconName } from './icons';

interface Props {
  project: Project;
  media: MediaStore;
  time: number;
  onClose: () => void;
  onDone: (msg: string) => void;
}

const FORMATS: ReadonlyArray<{ id: ExportFormat; label: string; sub: string; icon: IconName }> = [
  { id: 'mp4', label: 'MP4 video', sub: 'Sound + motion', icon: 'video' },
  { id: 'webm', label: 'WebM video', sub: 'Sound + motion', icon: 'film' },
  { id: 'png', label: 'PNG image', sub: 'Single frame', icon: 'image' },
  { id: 'png-seq', label: 'PNG sequence', sub: 'Every frame, zipped', icon: 'layers' },
];

type SizeId = 'small' | 'canvas' | '720' | '1080' | '1440' | '2160';

function sizeFor(id: SizeId, w: number, h: number): [number, number] {
  const k = id === 'canvas' ? 1 : id === 'small' ? 720 / Math.max(w, h) : Number(id) / Math.min(w, h);
  return [Math.round(w * k), Math.round(h * k)];
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function mb(bytes: number): string {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(bytes / 1e3)} KB`;
}

export function ExportDialog({ project, media, time, onClose, onDone }: Props) {
  const c = project.canvas;
  const hasSound = project.layers.some((l) => l.kind === 'video' && !l.muted);
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [size, setSize] = useState<SizeId>('canvas');
  const [duration, setDuration] = useState(Math.round(c.duration * 100) / 100);
  const [durationDraft, setDurationDraft] = useState<string | null>(null);
  const [fps, setFps] = useState(c.fps);
  const [blur, setBlur] = useState<0 | 1 | 2>(0);
  const [bg, setBg] = useState<ExportOptions['background']>(c.background === 'transparent' ? 'transparent' : 'canvas');
  const [custom, setCustom] = useState('#000000');
  const [sound, setSound] = useState(true);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const video = format === 'mp4' || format === 'webm';
  const [w, h] = sizeFor(size, c.width, c.height);
  const frames = format === 'png' ? 1 : Math.max(1, Math.round(duration * fps));
  const opts: ExportOptions = useMemo(
    () => ({
      format,
      width: w,
      height: h,
      duration,
      fps,
      motionBlur: blur,
      background: bg === 'transparent' && video ? 'canvas' : bg,
      customColor: custom,
      frameTime: time,
      sound,
    }),
    [format, w, h, duration, fps, blur, bg, custom, time, sound, video],
  );

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !progress) onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, progress]);

  const run = async () => {
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ phase: 'prepare', done: 0, total: frames });
    try {
      const r = await exportProject(project, media, opts, setProgress, ctrl.signal);
      download(r.blob, r.name);
      onDone(`Exported ${r.name} (${mb(r.blob.size)}).`);
      onClose();
    } catch (e) {
      if ((e as Error).name === 'AbortError') setError('Export cancelled.');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const previewFrame = async () => {
    setError(null);
    try {
      const small = {
        ...opts,
        format: 'png' as const,
        width: Math.round(w * Math.min(1, 640 / w)),
        height: Math.round(h * Math.min(1, 640 / w)),
      };
      const r = await exportProject(project, media, small, () => {}, new AbortController().signal);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(r.blob);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const sizes: ReadonlyArray<{ id: SizeId; label: string }> = [
    { id: 'small', label: '720 px' },
    { id: 'canvas', label: 'Canvas' },
    { id: '720', label: '720p' },
    { id: '1080', label: '1080p' },
    { id: '1440', label: '1440p' },
    { id: '2160', label: '4K' },
  ];

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Export">
      <div className="modal__scrim" onClick={() => !progress && onClose()} />
      <div className="modal__box modal__box--export">
        <div className="ptitle">
          <div className="ptitle__box">
            <span className="dots ptitle__main">Export</span>
            <span className="ptitle__sub">{project.name || 'Untitled'} / main canvas</span>
          </div>
          <button type="button" className="pbtn pbtn--icon" onClick={onClose} disabled={!!progress} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="export__note">
          Unlimited exports · rendered on this device, frame by frame
          {hasWebCodecs() ? '' : ' (real-time fallback: this browser has no WebCodecs)'}
        </p>

        <span className="plabel">Format</span>
        <div className="export__formats">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`fmtcard${format === f.id ? ' fmtcard--on' : ''}`}
              onClick={() => setFormat(f.id)}
              disabled={!!progress}
            >
              <Icon name={f.icon} size={18} />
              <span className="fmtcard__label">{f.label}</span>
              <span className="fmtcard__sub">{f.sub}</span>
            </button>
          ))}
        </div>

        <span className="plabel">Size</span>
        <div className="export__sizes">
          {sizes.map((s) => {
            const [sw, sh] = sizeFor(s.id, c.width, c.height);
            return (
              <button
                key={s.id}
                type="button"
                className={`sizechip${size === s.id ? ' sizechip--on' : ''}`}
                onClick={() => setSize(s.id)}
                disabled={!!progress}
              >
                <span>{s.label}</span>
                <span className="sizechip__px">
                  {sw} × {sh}
                </span>
              </button>
            );
          })}
        </div>

        {format !== 'png' && (
          <div className="export__row">
            <label className="export__field">
              <span className="plabel">Duration</span>
              <span className="export__input">
                <input
                  inputMode="decimal"
                  value={durationDraft ?? String(duration)}
                  aria-label="Duration in seconds"
                  onFocus={(e) => {
                    setDurationDraft(String(duration));
                    e.currentTarget.select();
                  }}
                  onChange={(e) => setDurationDraft(e.currentTarget.value)}
                  onBlur={() => {
                    const n = Number((durationDraft ?? '').replace(',', '.'));
                    if (Number.isFinite(n) && n > 0) setDuration(Math.max(0.1, Math.min(600, n)));
                    setDurationDraft(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                s
              </span>
            </label>
            <label className="export__field">
              <span className="plabel">Frame rate</span>
              <select value={fps} onChange={(e) => setFps(Number(e.currentTarget.value))}>
                {Array.from(new Set([c.fps, 12, 15, 24, 25, 30, 50, 60]))
                  .sort((a, b) => a - b)
                  .map((f) => (
                    <option key={f} value={f}>
                      {f} fps{f === c.fps ? ' · canvas' : ''}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}

        <span className="plabel">Motion blur</span>
        <div className="pseg export__seg">
          {(['Off', 'Natural', 'Longer'] as const).map((label, i) => (
            <button
              key={label}
              type="button"
              className={`pseg__opt${blur === i ? ' pseg__opt--on' : ''}`}
              onClick={() => setBlur(i as 0 | 1 | 2)}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="plabel">Background</span>
        <div className="pseg export__seg">
          <button
            type="button"
            className={`pseg__opt${bg === 'canvas' ? ' pseg__opt--on' : ''}`}
            onClick={() => setBg('canvas')}
          >
            Canvas colour
          </button>
          <button
            type="button"
            className={`pseg__opt${bg === 'custom' ? ' pseg__opt--on' : ''}`}
            onClick={() => setBg('custom')}
          >
            Custom colour
          </button>
          <button
            type="button"
            className={`pseg__opt${bg === 'transparent' ? ' pseg__opt--on' : ''}`}
            onClick={() => setBg('transparent')}
            disabled={video}
            title={video ? 'Videos have no transparency: use PNG' : undefined}
          >
            See-through
          </button>
        </div>
        {bg === 'custom' && <ColorRow label="Colour" value={custom} onChange={setCustom} />}

        {video && (
          <label className="export__check">
            <input
              type="checkbox"
              checked={sound && hasSound}
              disabled={!hasSound}
              onChange={(e) => setSound(e.currentTarget.checked)}
            />
            <span>{hasSound ? 'Include sound from the video layers' : 'No sound to include'}</span>
          </label>
        )}

        <div className="export__preview">
          <button type="button" className="pbtn" onClick={() => void previewFrame()} disabled={!!progress}>
            <Icon name="eye" size={15} /> Preview frame
          </button>
          <span className="muted small">
            {format === 'png'
              ? `The frame at ${time.toFixed(2)} s`
              : bg === 'custom'
                ? 'Custom background'
                : 'Solid background'}
          </span>
        </div>
        {preview && <img className="export__img" src={preview} alt="Preview of the exported frame" />}
        {error && (
          <p className="export__error" role="alert">
            {error}
          </p>
        )}

        <div className="export__foot">
          <div className="export__summary">
            <span className="dots-num">
              {w} × {h}
            </span>
            <span>
              {frames} frame{frames === 1 ? '' : 's'}
              {format !== 'png' ? ` · ${fps} fps` : ''}
              {progress?.eta !== undefined ? ` · ~${Math.ceil(progress.eta)} s left` : ''}
            </span>
            {progress && (
              <span className="bar" aria-label={`${pct}%`}>
                <span className="bar__fill" style={{ width: `${pct}%` }} />
              </span>
            )}
            {progress?.note && <span className="muted small">{progress.note}</span>}
          </div>
          {progress ? (
            <button type="button" className="pbtn pbtn--danger export__go" onClick={() => abort.current?.abort()}>
              Cancel {pct}%
            </button>
          ) : (
            <button type="button" className="pbtn pbtn--primary export__go" onClick={() => void run()}>
              Export {FORMATS.find((f) => f.id === format)!.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
