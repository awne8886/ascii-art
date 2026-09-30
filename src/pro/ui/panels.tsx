import { BLEND_MODES } from '../effects/prelude';
import { layerMediaDuration } from '../frames';
import { type MediaStore } from '../media';
import {
  ASPECTS,
  FRAME_RATES,
  newMotion,
  type Background,
  type CanvasFinish,
  type Fit,
  type Layer,
  type LayerFinish,
  type MotionType,
  type ShapeType,
  type TextProps,
} from '../model';
import { updateLayer, type Studio } from '../store';
import { Card, ColorRow, Group, NumberBox, Segmented, Select, Slider, Switch } from './controls';
import { Icon } from './icons';

const MOTIONS: ReadonlyArray<{ type: MotionType; label: string; hint: string }> = [
  { type: 'drift', label: 'Drift', hint: 'A lazy figure of eight' },
  { type: 'float', label: 'Float', hint: 'Bobs up and down' },
  { type: 'sway', label: 'Sway', hint: 'Rocks side to side' },
  { type: 'spin', label: 'Spin', hint: 'Full turns' },
  { type: 'pulse', label: 'Pulse', hint: 'Grows and shrinks' },
  { type: 'orbit', label: 'Orbit', hint: 'Circles its spot' },
  { type: 'bounce', label: 'Bounce', hint: 'Hops' },
  { type: 'zoom', label: 'Zoom', hint: 'Slow push in and out (Ken Burns)' },
  { type: 'shake', label: 'Shake', hint: 'Camera shake' },
  { type: 'swing', label: 'Swing', hint: '3D: turns left and right' },
  { type: 'tumble', label: 'Tumble', hint: '3D: tips around' },
  { type: 'breathe', label: 'Breathe', hint: 'Gentle scale and fade' },
];

function MotionGlyph({ type }: { type: MotionType }) {
  const d: Record<MotionType, string> = {
    drift: 'M3 12c3-6 6 6 9 0s6 6 9 0',
    float: 'M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4',
    sway: 'M12 20V8M6 6c3 3 9 3 12 0',
    spin: 'M20 12a8 8 0 1 1-3-6.2M20 4v4h-4',
    pulse: 'M4 4h16v16H4zM8 8h8v8H8z',
    orbit: 'M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16M12 12h.01',
    bounce: 'M4 20h16M8 18c0-10 8-10 8 0',
    zoom: 'M4 9V4h5M20 15v5h-5M9 9l6 6',
    shake: 'M4 12l3-5 3 10 3-10 3 10 3-5h1',
    swing: 'M6 5v14l12-3V8z',
    tumble: 'M5 8l7-4 7 4-7 4zM5 8v8l7 4 7-4V8',
    breathe: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d={d[type]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MovePanel({ studio, layer }: { studio: Studio; layer: Layer }) {
  const set = (fn: (l: Layer) => Layer, coalesce?: string) => studio.commit(updateLayer(layer.id, fn), coalesce);
  const has = (t: MotionType) => layer.motion.find((m) => m.type === t);
  return (
    <div className="panel-body">
      <p className="muted small">
        One click sets the layer moving, in loops that never end: every motion repeats a whole number of times over the
        timeline, so the clip loops seamlessly.
      </p>
      <div className="cardgrid cardgrid--3">
        {MOTIONS.map((m) => (
          <Card
            key={m.type}
            label={m.label}
            on={!!has(m.type)?.enabled}
            icon={<MotionGlyph type={m.type} />}
            onClick={() =>
              set((l) => {
                const cur = l.motion.find((x) => x.type === m.type);
                return {
                  ...l,
                  motion: cur ? l.motion.filter((x) => x !== cur) : [...l.motion, newMotion(m.type)],
                };
              })
            }
          />
        ))}
      </div>
      {layer.motion.map((m) => {
        const info = MOTIONS.find((x) => x.type === m.type)!;
        const patch = (p: Partial<typeof m>, key?: string) =>
          set((l) => ({ ...l, motion: l.motion.map((x) => (x.uid === m.uid ? { ...x, ...p } : x)) }), key);
        return (
          <Group
            key={m.uid}
            title={info.label}
            summary={info.hint}
            aside={
              <button
                type="button"
                className="pbtn pbtn--icon pbtn--small"
                aria-label={`Remove ${info.label}`}
                onClick={() => set((l) => ({ ...l, motion: l.motion.filter((x) => x.uid !== m.uid) }))}
              >
                <Icon name="trash" size={13} />
              </button>
            }
          >
            <Switch label="On" checked={m.enabled} onChange={(v) => patch({ enabled: v })} />
            {m.type !== 'spin' && (
              <Slider
                label="Amount"
                value={m.amount}
                min={0}
                max={2}
                onChange={(v) => patch({ amount: v }, `mo:${m.uid}:a`)}
              />
            )}
            <Segmented
              label={m.type === 'spin' ? 'Turns per loop' : 'Cycles per loop'}
              value={m.cycles}
              options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: n, label: String(n) }))}
              cols={6}
              onChange={(v) => patch({ cycles: v })}
            />
            <Slider
              label="Offset"
              value={m.phase}
              min={0}
              max={1}
              onChange={(v) => patch({ phase: v }, `mo:${m.uid}:p`)}
            />
            {m.type === 'spin' && (
              <Segmented
                label="Direction"
                value={m.amount >= 0 ? 1 : -1}
                options={[
                  { value: 1, label: 'Clockwise' },
                  { value: -1, label: 'Anticlockwise' },
                ]}
                onChange={(v) => patch({ amount: v })}
              />
            )}
          </Group>
        );
      })}
    </div>
  );
}

export function SoundPanel({
  studio,
  layer,
  media,
  soundOn,
  setSoundOn,
}: {
  studio: Studio;
  layer: Layer;
  media: MediaStore;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
}) {
  const set = (patch: Partial<Layer>, key?: string) => studio.commit(updateLayer(layer.id, patch), key);
  const m = media.get(layer.mediaId);
  return (
    <div className="panel-body">
      <Switch label="Preview sound" checked={soundOn} onChange={setSoundOn} hint="Play sound while previewing" />
      {layer.kind === 'video' ? (
        <>
          <Switch label="This layer’s sound" checked={!layer.muted} onChange={(v) => set({ muted: !v })} />
          <Slider
            label="Volume"
            value={Math.round(layer.volume * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => set({ volume: v / 100 }, 'volume')}
          />
          <p className="muted small">
            {m?.envelope
              ? 'Sound found. Press ♪ next to any look setting to make it follow this layer’s loudness, live and in the export.'
              : m?.audio === null && m.envelope === null
                ? 'Listening for sound… (silent videos stay silent to ♪ settings)'
                : ''}
          </p>
          {m?.envelope && <Envelope data={m.envelope} />}
          <p className="muted small">Exported videos carry the sound of every video layer that isn’t muted.</p>
        </>
      ) : (
        <p className="muted small">
          This layer has no sound of its own. Looks on it can still follow the sound of the video layers: press ♪ next
          to a look setting.
        </p>
      )}
    </div>
  );
}

function Envelope({ data }: { data: Float32Array }) {
  const n = 120;
  const step = Math.max(1, Math.floor(data.length / n));
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    let mx = 0;
    for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) mx = Math.max(mx, data[j]!);
    pts.push(`${(i / (n - 1)) * 100},${30 - mx * 28}`);
  }
  return (
    <svg className="envelope" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="Loudness over time">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function TiltPanel({ studio, layer }: { studio: Studio; layer: Layer }) {
  const set = (patch: Partial<Layer>, key?: string) => studio.commit(updateLayer(layer.id, patch), key);
  const presets: ReadonlyArray<{ label: string; x: number; y: number; p: number }> = [
    { label: 'Flat', x: 0, y: 0, p: 0.6 },
    { label: 'Lean left', x: 0, y: 28, p: 0.7 },
    { label: 'Lean right', x: 0, y: -28, p: 0.7 },
    { label: 'Floor', x: 55, y: 0, p: 0.8 },
    { label: 'Billboard', x: -12, y: 18, p: 0.75 },
    { label: 'Card', x: 14, y: -22, p: 0.85 },
  ];
  return (
    <div className="panel-body">
      <p className="muted small">Tilt the layer in space; its looks stay painted on it.</p>
      <div className="cardgrid cardgrid--3">
        {presets.map((pr) => (
          <button
            key={pr.label}
            type="button"
            className={`pbtn${layer.tiltX === pr.x && layer.tiltY === pr.y ? ' pbtn--on' : ''}`}
            onClick={() => set({ tiltX: pr.x, tiltY: pr.y, perspective: pr.p })}
          >
            {pr.label}
          </button>
        ))}
      </div>
      <Slider
        label="Tilt X"
        value={layer.tiltX}
        min={-80}
        max={80}
        step={1}
        unit="°"
        onChange={(v) => set({ tiltX: v }, 'tiltX')}
      />
      <Slider
        label="Tilt Y"
        value={layer.tiltY}
        min={-80}
        max={80}
        step={1}
        unit="°"
        onChange={(v) => set({ tiltY: v }, 'tiltY')}
      />
      <Slider
        label="Perspective"
        value={layer.perspective}
        min={0}
        max={1}
        onChange={(v) => set({ perspective: v }, 'persp')}
        hint="Stronger = a wider lens"
      />
      <p className="muted small">For movement in 3D, add Swing or Tumble in Move.</p>
    </div>
  );
}

export function FinishControls({
  finish,
  onChange,
  surface,
}: {
  finish: LayerFinish | CanvasFinish;
  onChange: (f: LayerFinish | CanvasFinish, key?: string) => void;
  surface?: boolean;
}) {
  const f = finish;
  const c = finish as CanvasFinish;
  const any = f.bloom.on || f.streaks.on || f.trails.on || (surface && (c.paper.on || c.grade.on));
  return (
    <>
      <span className="plabel">Light</span>
      <div className="cardgrid cardgrid--3">
        <Card
          label="Bloom"
          on={f.bloom.on}
          icon={<span className="glyph-bloom" />}
          onClick={() => onChange({ ...f, bloom: { ...f.bloom, on: !f.bloom.on } })}
        />
        <Card
          label="Streaks"
          on={f.streaks.on}
          icon={<span className="glyph-streak" />}
          onClick={() => onChange({ ...f, streaks: { ...f.streaks, on: !f.streaks.on } })}
        />
        <Card
          label="Trails"
          on={f.trails.on}
          icon={<span className="glyph-trail" />}
          onClick={() => onChange({ ...f, trails: { ...f.trails, on: !f.trails.on } })}
        />
      </div>
      {surface && (
        <>
          <span className="plabel">Surface</span>
          <div className="cardgrid cardgrid--2">
            <Card
              label="Paper"
              on={c.paper.on}
              icon={<Icon name="file" size={22} />}
              onClick={() => onChange({ ...c, paper: { ...c.paper, on: !c.paper.on } })}
            />
            <Card
              label="Grade"
              on={c.grade.on}
              icon={<Icon name="sliders" size={22} />}
              onClick={() => onChange({ ...c, grade: { ...c.grade, on: !c.grade.on } })}
            />
          </div>
        </>
      )}
      {!any && <p className="muted small">Switch a card on to light this {surface ? 'picture' : 'layer'}.</p>}
      {f.bloom.on && (
        <Group title="Bloom" icon="sun">
          <Slider
            label="Intensity"
            value={f.bloom.intensity}
            min={0}
            max={3}
            onChange={(v) => onChange({ ...f, bloom: { ...f.bloom, intensity: v } }, 'bi')}
          />
          <Slider
            label="Radius"
            value={f.bloom.radius}
            min={0}
            max={1}
            onChange={(v) => onChange({ ...f, bloom: { ...f.bloom, radius: v } }, 'br')}
          />
          <Slider
            label="Threshold"
            value={f.bloom.threshold}
            min={0}
            max={1}
            onChange={(v) => onChange({ ...f, bloom: { ...f.bloom, threshold: v } }, 'bt')}
          />
        </Group>
      )}
      {f.streaks.on && (
        <Group title="Streaks" icon="minus">
          <Slider
            label="Intensity"
            value={f.streaks.intensity}
            min={0}
            max={3}
            onChange={(v) => onChange({ ...f, streaks: { ...f.streaks, intensity: v } }, 'si')}
          />
          <Slider
            label="Length"
            value={f.streaks.length}
            min={0}
            max={1}
            onChange={(v) => onChange({ ...f, streaks: { ...f.streaks, length: v } }, 'sl')}
          />
          <Slider
            label="Threshold"
            value={f.streaks.threshold}
            min={0}
            max={1}
            onChange={(v) => onChange({ ...f, streaks: { ...f.streaks, threshold: v } }, 'st')}
          />
          <ColorRow
            label="Tint"
            value={f.streaks.tint}
            onChange={(v) => onChange({ ...f, streaks: { ...f.streaks, tint: v } })}
          />
        </Group>
      )}
      {f.trails.on && (
        <Group title="Trails" icon="move">
          <Slider
            label="Length"
            value={f.trails.amount}
            min={0}
            max={0.98}
            onChange={(v) => onChange({ ...f, trails: { ...f.trails, amount: v } }, 'ta')}
          />
        </Group>
      )}
      {surface && c.paper.on && (
        <Group title="Paper" icon="file">
          <Slider
            label="Grain"
            value={c.paper.grain}
            min={0}
            max={1}
            onChange={(v) => onChange({ ...c, paper: { ...c.paper, grain: v } }, 'pg')}
          />
          <Slider
            label="Fibres"
            value={c.paper.fibres}
            min={0}
            max={1}
            onChange={(v) => onChange({ ...c, paper: { ...c.paper, fibres: v } }, 'pf')}
          />
          <ColorRow
            label="Tint"
            value={c.paper.tint}
            onChange={(v) => onChange({ ...c, paper: { ...c.paper, tint: v } })}
          />
          <Slider
            label="Tint amount"
            value={c.paper.tintAmount}
            min={0}
            max={1}
            onChange={(v) => onChange({ ...c, paper: { ...c.paper, tintAmount: v } }, 'pt')}
          />
        </Group>
      )}
      {surface && c.grade.on && (
        <Group title="Grade" icon="sliders">
          <Slider
            label="Exposure"
            value={c.grade.exposure}
            min={-2}
            max={2}
            onChange={(v) => onChange({ ...c, grade: { ...c.grade, exposure: v } }, 'ge')}
          />
          <Slider
            label="Contrast"
            value={c.grade.contrast}
            min={0.3}
            max={2.5}
            unit="×"
            onChange={(v) => onChange({ ...c, grade: { ...c.grade, contrast: v } }, 'gc')}
          />
          <Slider
            label="Saturation"
            value={c.grade.saturation}
            min={0}
            max={2.5}
            unit="×"
            onChange={(v) => onChange({ ...c, grade: { ...c.grade, saturation: v } }, 'gs')}
          />
          <Slider
            label="Temperature"
            value={c.grade.temperature}
            min={-1}
            max={1}
            onChange={(v) => onChange({ ...c, grade: { ...c.grade, temperature: v } }, 'gt')}
          />
          <Slider
            label="Tint"
            value={c.grade.tint}
            min={-1}
            max={1}
            onChange={(v) => onChange({ ...c, grade: { ...c.grade, tint: v } }, 'gn')}
          />
          <Slider
            label="Hue"
            value={c.grade.hue}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(v) => onChange({ ...c, grade: { ...c.grade, hue: v } }, 'gh')}
          />
          <Slider
            label="Fade"
            value={c.grade.fade}
            min={0}
            max={1}
            onChange={(v) => onChange({ ...c, grade: { ...c.grade, fade: v } }, 'gf')}
          />
          <Slider
            label="Vignette"
            value={c.grade.vignette}
            min={0}
            max={1}
            onChange={(v) => onChange({ ...c, grade: { ...c.grade, vignette: v } }, 'gv')}
          />
        </Group>
      )}
    </>
  );
}

const FITS: ReadonlyArray<{ value: Fit; label: string }> = [
  { value: 'fit', label: 'Fit' },
  { value: 'fill', label: 'Fill' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'original', label: 'Original' },
];

const FONTS_LIST: ReadonlyArray<{ value: TextProps['font']; label: string }> = [
  { value: 'display', label: 'Display' },
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
];

const SHAPES: ReadonlyArray<{ value: ShapeType; label: string }> = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'star', label: 'Star' },
  { value: 'ring', label: 'Ring' },
  { value: 'heart', label: 'Heart' },
  { value: 'blob', label: 'Blob' },
  { value: 'sphere', label: 'Sphere' },
];

export function LayerPanel({
  studio,
  layer,
  media,
  onDuplicate,
  onDelete,
}: {
  studio: Studio;
  layer: Layer;
  media: MediaStore;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const set = (patch: Partial<Layer>, key?: string) => studio.commit(updateLayer(layer.id, patch), key);
  const canvas = studio.project.canvas;
  const m = media.get(layer.mediaId);
  const mediaDur = layerMediaDuration(layer, media);
  const kindLabel =
    layer.kind === 'video'
      ? 'Video'
      : layer.kind === 'image'
        ? 'Picture'
        : layer.kind === 'webcam'
          ? 'Webcam'
          : layer.kind === 'text'
            ? 'Type'
            : layer.kind === 'shape'
              ? 'Shape'
              : 'Sample clip';
  return (
    <div className="panel-body">
      <Group
        title="Finish"
        icon="sun"
        defaultOpen={layer.finish.bloom.on || layer.finish.streaks.on || layer.finish.trails.on}
      >
        <FinishControls finish={layer.finish} onChange={(f, k) => set({ finish: f as LayerFinish }, k && `lf:${k}`)} />
      </Group>

      <div className="mediacard">
        <Icon
          name={
            layer.kind === 'video' || layer.kind === 'sample'
              ? 'film'
              : layer.kind === 'text'
                ? 'text'
                : layer.kind === 'shape'
                  ? 'shapes'
                  : 'image'
          }
          size={16}
        />
        <input
          className="mediacard__name"
          value={layer.name}
          aria-label="Layer name"
          onChange={(e) => set({ name: e.currentTarget.value }, 'rename')}
        />
        <span className="mediacard__meta">{mediaDur ? fmtDur(mediaDur) : kindLabel}</span>
      </div>
      {m && (
        <div className="prow prow--inline">
          <span className="prow__label">Match canvas</span>
          <span className="btnrow">
            <button
              type="button"
              className="pbtn pbtn--small"
              onClick={() =>
                studio.commit((p) => ({
                  ...p,
                  canvas: { ...p.canvas, width: evenSize(m.width), height: evenSize(m.height) },
                }))
              }
            >
              Size
            </button>
            {mediaDur && (
              <button
                type="button"
                className="pbtn pbtn--small"
                onClick={() =>
                  studio.commit((p) => ({
                    ...updateLayer(layer.id, { start: 0, length: (mediaDur - layer.in) / layer.speed })(p),
                    canvas: { ...p.canvas, duration: Math.min(600, (mediaDur - layer.in) / layer.speed) },
                  }))
                }
              >
                Length
              </button>
            )}
          </span>
        </div>
      )}

      {layer.kind === 'text' && layer.text && <TextControls layer={layer} set={set} />}
      {layer.kind === 'shape' && layer.shape && (
        <Group title="Shape" icon="shapes">
          <Select
            label="Shape"
            value={layer.shape.shape}
            options={SHAPES}
            onChange={(v) => set({ shape: { ...layer.shape!, shape: v } })}
          />
          <Slider
            label="Size"
            value={layer.shape.size}
            min={0.05}
            max={1.5}
            onChange={(v) => set({ shape: { ...layer.shape!, size: v } }, 'ss')}
          />
          <Slider
            label="Width"
            value={layer.shape.aspect}
            min={0.2}
            max={4}
            unit="×"
            onChange={(v) => set({ shape: { ...layer.shape!, aspect: v } }, 'sa')}
          />
          <ColorRow
            label="Colour"
            value={layer.shape.color}
            onChange={(v) => set({ shape: { ...layer.shape!, color: v } })}
          />
          <Switch
            label="Gradient"
            checked={layer.shape.gradient}
            onChange={(v) => set({ shape: { ...layer.shape!, gradient: v } })}
          />
          {(layer.shape.gradient || layer.shape.shape === 'sphere') && (
            <ColorRow
              label="Second colour"
              value={layer.shape.color2}
              onChange={(v) => set({ shape: { ...layer.shape!, color2: v } })}
            />
          )}
          <Slider
            label="Outline only"
            value={layer.shape.stroke}
            min={0}
            max={1}
            onChange={(v) => set({ shape: { ...layer.shape!, stroke: v } }, 'sk')}
          />
          {layer.shape.shape === 'square' && (
            <Slider
              label="Corners"
              value={layer.shape.corner}
              min={0}
              max={0.5}
              onChange={(v) => set({ shape: { ...layer.shape!, corner: v } }, 'sc')}
            />
          )}
        </Group>
      )}

      <Group title="Placement" icon="move">
        <Slider label="Position X" value={layer.x} min={-1} max={1} onChange={(v) => set({ x: v }, 'px')} />
        <Slider label="Position Y" value={layer.y} min={-1} max={1} onChange={(v) => set({ y: v }, 'py')} />
        <Slider
          label="Scale"
          value={layer.scale}
          min={0.05}
          max={4}
          unit="×"
          onChange={(v) => set({ scale: v }, 'sc')}
        />
        <Slider
          label="Rotation"
          value={layer.rotation}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(v) => set({ rotation: v }, 'rot')}
        />
        <div className="prow prow--inline">
          <span className="prow__label">Flip</span>
          <span className="btnrow">
            <button
              type="button"
              className={`pbtn pbtn--icon${layer.flipX ? ' pbtn--on' : ''}`}
              onClick={() => set({ flipX: !layer.flipX })}
              aria-label="Flip horizontally"
            >
              <Icon name="flipH" size={16} />
            </button>
            <button
              type="button"
              className={`pbtn pbtn--icon${layer.flipY ? ' pbtn--on' : ''}`}
              onClick={() => set({ flipY: !layer.flipY })}
              aria-label="Flip vertically"
            >
              <Icon name="flipV" size={16} />
            </button>
          </span>
        </div>
        <Segmented label="Fit" value={layer.fit} options={FITS} onChange={(v) => set({ fit: v })} />
        <Slider
          label="Stretch X"
          value={layer.stretchX}
          min={0.2}
          max={3}
          unit="×"
          onChange={(v) => set({ stretchX: v }, 'sx')}
        />
        <Slider
          label="Stretch Y"
          value={layer.stretchY}
          min={0.2}
          max={3}
          unit="×"
          onChange={(v) => set({ stretchY: v }, 'sy')}
        />
        <button
          type="button"
          className="pbtn pbtn--block pbtn--ghost"
          onClick={() =>
            set({
              x: 0,
              y: 0,
              scale: 1,
              rotation: 0,
              flipX: false,
              flipY: false,
              stretchX: 1,
              stretchY: 1,
              tiltX: 0,
              tiltY: 0,
            })
          }
        >
          <Icon name="reset" size={14} /> Reset placement
        </button>
      </Group>

      <Group title="Compositing" icon="layers">
        <Slider
          label="Opacity"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(v) => set({ opacity: v / 100 }, 'op')}
        />
        <Select label="Blend" value={layer.blend} options={BLEND_MODES} onChange={(v) => set({ blend: v })} />
      </Group>

      <Group title="Time" icon="loop">
        <div className="prow">
          <span className="prow__label">Starts at</span>
          <NumberBox
            value={layer.start}
            min={0}
            max={canvas.duration}
            step={0.01}
            unit="s"
            onChange={(v) => set({ start: v })}
          />
        </div>
        <div className="prow">
          <span className="prow__label">Length</span>
          <NumberBox
            value={layer.length}
            min={0.05}
            max={3600}
            step={0.01}
            unit="s"
            onChange={(v) => set({ length: v })}
          />
        </div>
        {mediaDur !== null && (
          <>
            <Slider
              label="Trim start"
              value={layer.in}
              min={0}
              max={Math.max(0, mediaDur - 0.05)}
              step={0.01}
              unit="s"
              onChange={(v) => set({ in: v }, 'in')}
            />
            <Slider
              label="Speed"
              value={layer.speed}
              min={0.25}
              max={4}
              step={0.05}
              unit="×"
              onChange={(v) => set({ speed: v }, 'speed')}
            />
            <Switch label="Loop the clip" checked={layer.loopMedia} onChange={(v) => set({ loopMedia: v })} />
          </>
        )}
      </Group>

      <div className="btnrow btnrow--split">
        <button type="button" className="pbtn" onClick={onDuplicate}>
          <Icon name="copy" size={14} /> Duplicate
        </button>
        <button type="button" className="pbtn pbtn--danger" onClick={onDelete}>
          <Icon name="trash" size={14} /> Delete
        </button>
      </div>
    </div>
  );
}

function TextControls({ layer, set }: { layer: Layer; set: (p: Partial<Layer>, key?: string) => void }) {
  const t = layer.text!;
  const patch = (p: Partial<TextProps>, key?: string) => set({ text: { ...t, ...p } }, key && `t:${key}`);
  return (
    <Group title="Type" icon="text">
      <textarea
        className="ptext ptext--area"
        value={t.text}
        rows={Math.min(5, t.text.split('\n').length + 1)}
        aria-label="Text"
        onChange={(e) => patch({ text: e.currentTarget.value }, 'text')}
      />
      <Segmented label="Font" value={t.font} options={FONTS_LIST} onChange={(v) => patch({ font: v })} />
      <Slider label="Size" value={t.size} min={0.02} max={0.8} onChange={(v) => patch({ size: v }, 'size')} />
      <Slider
        label="Weight"
        value={t.weight}
        min={100}
        max={900}
        step={100}
        onChange={(v) => patch({ weight: v }, 'w')}
      />
      <ColorRow label="Colour" value={t.color} onChange={(v) => patch({ color: v })} />
      <Segmented
        label="Align"
        value={t.align}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centre' },
          { value: 'right', label: 'Right' },
        ]}
        onChange={(v) => patch({ align: v })}
      />
      <Slider
        label="Letter spacing"
        value={t.letterSpacing}
        min={-0.1}
        max={0.6}
        onChange={(v) => patch({ letterSpacing: v }, 'ls')}
      />
      <Slider
        label="Line height"
        value={t.lineHeight}
        min={0.7}
        max={2}
        onChange={(v) => patch({ lineHeight: v }, 'lh')}
      />
      <Switch label="Italic" checked={t.italic} onChange={(v) => patch({ italic: v })} />
      <Switch label="Background box" checked={t.backgroundOn} onChange={(v) => patch({ backgroundOn: v })} />
      {t.backgroundOn && (
        <ColorRow label="Box colour" value={t.background} onChange={(v) => patch({ background: v })} />
      )}
    </Group>
  );
}

function evenSize(n: number): number {
  return Math.max(16, Math.min(8192, Math.round(n / 2) * 2));
}

export function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m ? `${m}:${sec.toFixed(1).padStart(4, '0')}` : `${sec.toFixed(1)} s`;
}

const BACKGROUNDS: ReadonlyArray<{ value: Background; label: string }> = [
  { value: 'transparent', label: 'See-through' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'color', label: 'Colour' },
];

export function CanvasPanel({
  studio,
  onTemplates,
  pictureSize,
}: {
  studio: Studio;
  onTemplates: () => void;
  pictureSize: [number, number] | null;
}) {
  const c = studio.project.canvas;
  const set = (patch: Partial<typeof c>, key?: string) =>
    studio.commit((p) => ({ ...p, canvas: { ...p.canvas, ...patch } }), key);
  const aspect = ASPECTS.find((a) => Math.abs(a.w / a.h - c.width / c.height) < 0.01);
  return (
    <div className="panel-body">
      <button type="button" className="rowbtn" onClick={onTemplates}>
        <Icon name="templates" size={16} />
        <span className="rowbtn__title">Start from</span>
        <span className="rowbtn__value">Templates</span>
        <Icon name="chevronRight" size={14} />
      </button>

      <Group title="Background" icon="canvas" summary={BACKGROUNDS.find((b) => b.value === c.background)?.label}>
        <Segmented value={c.background} options={BACKGROUNDS} cols={2} onChange={(v) => set({ background: v })} />
        {c.background === 'color' && <ColorRow label="Colour" value={c.color} onChange={(v) => set({ color: v })} />}
      </Group>

      <Group title="Size" icon="fit" summary={`${c.width} × ${c.height}`}>
        <Segmented
          label="Aspect"
          value={aspect?.label ?? ''}
          cols={3}
          options={ASPECTS.map((a) => ({ value: a.label, label: a.label }))}
          onChange={(v) => {
            const a = ASPECTS.find((x) => x.label === v)!;
            set({ width: a.w, height: a.h });
          }}
        />
        <div className="prow">
          <span className="prow__label">Size</span>
          <span className="btnrow">
            <span className="wh">W</span>
            <NumberBox
              value={c.width}
              min={16}
              max={8192}
              step={1}
              onChange={(v) => set({ width: Math.round(v) })}
              label="Width"
            />
            <span className="wh">H</span>
            <NumberBox
              value={c.height}
              min={16}
              max={8192}
              step={1}
              onChange={(v) => set({ height: Math.round(v) })}
              label="Height"
            />
          </span>
        </div>
        <button
          type="button"
          className="pbtn pbtn--block pbtn--ghost"
          disabled={!pictureSize}
          onClick={() => pictureSize && set({ width: evenSize(pictureSize[0]), height: evenSize(pictureSize[1]) })}
        >
          Match the picture’s size
        </button>
      </Group>

      <Group title="Time" icon="loop" summary={`${c.duration.toFixed(1)} s · ${c.fps} fps`}>
        <div className="prow">
          <span className="prow__label">Length</span>
          <NumberBox
            value={c.duration}
            min={0.1}
            max={600}
            step={0.1}
            unit="s"
            onChange={(v) => set({ duration: v })}
          />
        </div>
        <Segmented
          label="Frame rate"
          value={c.fps}
          cols={5}
          options={FRAME_RATES.map((f) => ({ value: f, label: String(f) }))}
          onChange={(v) => set({ fps: v })}
        />
        <div className="prow">
          <span className="prow__label">Custom rate</span>
          <NumberBox
            value={c.fps}
            min={1}
            max={120}
            step={1}
            unit="fps"
            onChange={(v) => set({ fps: Math.round(v) })}
          />
        </div>
        <Switch label="Loop" checked={c.loop} onChange={(v) => set({ loop: v })} />
      </Group>
    </div>
  );
}

export interface SceneOptions {
  handles: boolean;
  guides: boolean;
  quality: 'auto' | 'full' | 'draft';
}

export function ScenePanel({ scene, setScene }: { scene: SceneOptions; setScene: (s: SceneOptions) => void }) {
  return (
    <div className="panel-body">
      <Group title="On the stage" icon="scene">
        <Switch
          label="Handles"
          hint="Frame and handles around the selected layer"
          checked={scene.handles}
          onChange={(v) => setScene({ ...scene, handles: v })}
        />
        <Switch
          label="Guides"
          hint="Thirds and centre lines over the canvas"
          checked={scene.guides}
          onChange={(v) => setScene({ ...scene, guides: v })}
        />
      </Group>
      <Group title="Preview" icon="eye">
        <Segmented
          label="Quality"
          value={scene.quality}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'full', label: 'Full' },
            { value: 'draft', label: 'Draft' },
          ]}
          onChange={(v) => setScene({ ...scene, quality: v })}
        />
        <p className="muted small">
          Draft renders the preview at half size, for slow machines. Exports are always full quality.
        </p>
      </Group>
    </div>
  );
}
