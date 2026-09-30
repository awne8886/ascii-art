import { GLYPH_SETS, type GlyphSetId } from '../ascii/glyphs';
import { MODELS } from '../segment/models';
import { type Composition, type ColorMode, type SegmentMethod, type Settings } from '../settings';
import { Section, Segmented, Select, Slider, Toggle } from './controls';

export interface SegmentStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  text: string;
  /** 0–1 while downloading. */
  progress?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onReset: () => void;
  imageName: string | null;
  imageSize: [number, number] | null;
  grid: [number, number] | null;
  hasAlpha: boolean;
  segment: SegmentStatus;
  onPick: () => void;
  onSample: () => void;
  exportBusy: string | null;
  onExportPng: (scale: number) => void;
  onExportVideo: () => void;
  onCopyText: () => void;
  /** Switch to the PRO studio. */
  onPro: () => void;
}

const HAS_WEBGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(2)}×`;

export function Sidebar(p: Props) {
  const { settings: s, update } = p;
  const separate = s.separate;
  const method = s.segmentMethod === 'classic' || p.hasAlpha ? undefined : MODELS[s.segmentMethod];

  return (
    <aside className={`sidebar${p.open ? ' sidebar--open' : ''}`} aria-label="Controls" aria-hidden={!p.open}>
      <div className="sidebar__head">
        <span className="sidebar__title">controls</span>
        <button type="button" className="icon-btn" onClick={p.onClose} aria-label="Hide controls" title="Hide (H)">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="sidebar__scroll">
        <button type="button" className="pro-card" onClick={p.onPro}>
          <span className="pro-card__top">
            <span className="pro-card__badge">pro</span>
            <span className="pro-card__title">Open the studio</span>
            <span className="pro-card__arrow" aria-hidden="true">
              →
            </span>
          </span>
          <span className="pro-card__text">
            Videos, 59 looks, layers, motion and a timeline. Every frame goes through the effect; export MP4.
          </span>
        </button>

        <Section id="image" title="Image">
          <button type="button" className="btn btn--primary btn--block" onClick={p.onPick}>
            Upload image
          </button>
          <p className="muted small">
            {p.imageName ? (
              <>
                <span className="filename">{p.imageName}</span>
                {p.imageSize && ` · ${p.imageSize[0]}×${p.imageSize[1]}`}
              </>
            ) : (
              'No image yet.'
            )}
          </p>
          <p className="muted small">
            Or drop / paste one anywhere.{' '}
            <button type="button" className="link" onClick={p.onSample}>
              Pizza sample
            </button>
          </p>
        </Section>

        <Section id="chars" title="Characters">
          <Slider
            label="Character size"
            value={s.charSize}
            min={4}
            max={32}
            step={1}
            onChange={(v) => update({ charSize: v })}
            format={(v) => `${v}px${p.grid ? ` · ${p.grid[0]}×${p.grid[1]}` : ''}`}
            hint="Smaller characters = more detail."
          />
          <Select<GlyphSetId>
            label="Character set"
            value={s.glyphSet}
            options={GLYPH_SETS.map((g) => ({ value: g.id, label: g.label }))}
            onChange={(v) => update({ glyphSet: v })}
          />
          {s.glyphSet === 'custom' && (
            <div className="control">
              <label className="control__label" htmlFor="custom-glyphs">
                Your characters
              </label>
              <input
                id="custom-glyphs"
                className="text-input"
                value={s.customGlyphs}
                maxLength={120}
                spellCheck={false}
                onChange={(e) => update({ customGlyphs: e.currentTarget.value })}
              />
              <p className="control__hint">Sorted automatically from lightest to densest.</p>
            </div>
          )}
          <Slider
            label="Glyph density"
            value={s.density}
            min={-0.5}
            max={0.5}
            onChange={(v) => update({ density: v })}
            format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)}
          />
          <Toggle label="Edge lines  - | / \" checked={s.edges} onChange={(v) => update({ edges: v })} />
        </Section>

        <Section id="colour" title="Colour & tone">
          <Segmented<ColorMode>
            label="Colours"
            value={s.colorMode}
            options={[
              { value: 'photo', label: 'Photo', title: 'Every character keeps its own colour' },
              { value: 'palette', label: 'Palette', title: 'An adaptive palette of materials, like the pizza' },
              { value: 'mono', label: 'Mono', title: 'One tint' },
            ]}
            onChange={(v) => update({ colorMode: v })}
          />
          {s.colorMode === 'palette' && (
            <Slider
              label="Palette colours"
              value={s.paletteSize}
              min={3}
              max={32}
              step={1}
              onChange={(v) => update({ paletteSize: v })}
              format={(v) => String(v)}
            />
          )}
          {s.colorMode === 'mono' && (
            <div className="control control--inline">
              <label className="control__label" htmlFor="mono-color">
                Tint
              </label>
              <input
                id="mono-color"
                type="color"
                className="color-input"
                value={s.monoColor}
                onChange={(e) => update({ monoColor: e.currentTarget.value })}
              />
            </div>
          )}
          <Toggle label="Auto tone" checked={s.autoTone} onChange={(v) => update({ autoTone: v })} />
          <Slider
            label="Brightness"
            value={s.brightness}
            min={-0.6}
            max={0.6}
            onChange={(v) => update({ brightness: v })}
            format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)}
          />
          <Slider
            label="Contrast"
            value={s.contrast}
            min={0.4}
            max={2.2}
            onChange={(v) => update({ contrast: v })}
            format={times}
          />
          <Slider
            label="Saturation"
            value={s.saturation}
            min={0}
            max={2}
            onChange={(v) => update({ saturation: v })}
            format={times}
          />
          <Slider
            label="Photo behind glyphs"
            value={s.photoUnder}
            min={0}
            max={1}
            onChange={(v) => update({ photoUnder: v })}
            format={pct}
          />
        </Section>

        <Section
          id="anim"
          title="Wave animation"
          aside={<Toggle compact label="Animate" checked={s.animate} onChange={(v) => update({ animate: v })} />}
        >
          <Toggle label="Wave" checked={s.wave} onChange={(v) => update({ wave: v })} />
          <Slider
            label="Wave height"
            value={s.waveAmplitude}
            min={0}
            max={3}
            disabled={!s.wave}
            onChange={(v) => update({ waveAmplitude: v })}
            format={times}
          />
          <Slider
            label="Wavelength"
            value={s.waveScale}
            min={0.3}
            max={3}
            onChange={(v) => update({ waveScale: v })}
            format={times}
          />
          <Slider
            label="Speed"
            value={s.waveSpeed}
            min={0.1}
            max={3}
            disabled={!s.animate}
            onChange={(v) => update({ waveSpeed: v })}
            format={times}
          />
          <Slider
            label="Light bands"
            value={s.bands}
            min={0}
            max={1.5}
            onChange={(v) => update({ bands: v })}
            format={pct}
          />
          <Toggle label="Sparkle" checked={s.sparkle} onChange={(v) => update({ sparkle: v })} disabled={!s.animate} />
        </Section>

        <Section
          id="bloom"
          title="Bloom"
          aside={<Toggle compact label="Bloom" checked={s.bloom} onChange={(v) => update({ bloom: v })} />}
        >
          <Slider
            label="Intensity"
            value={s.bloomIntensity}
            min={0}
            max={3}
            disabled={!s.bloom}
            onChange={(v) => update({ bloomIntensity: v })}
            format={times}
          />
          <Slider
            label="Radius"
            value={s.bloomRadius}
            min={0}
            max={1}
            disabled={!s.bloom}
            onChange={(v) => update({ bloomRadius: v })}
            format={pct}
          />
          <Slider
            label="Threshold"
            value={s.bloomThreshold}
            min={0}
            max={1}
            disabled={!s.bloom}
            onChange={(v) => update({ bloomThreshold: v })}
            format={pct}
            hint="Lower = more of the picture glows."
          />
          <Slider
            label="Glyph glow"
            value={s.glyphGlow}
            min={0}
            max={2}
            onChange={(v) => update({ glyphGlow: v })}
            format={times}
          />
        </Section>

        <Section
          id="subject"
          title="Subject & background"
          aside={
            <Toggle compact label="Separate subject" checked={separate} onChange={(v) => update({ separate: v })} />
          }
        >
          {!separate && (
            <p className="muted small">
              Turn on to find the subject automatically, then show it alone or over the original photo.
            </p>
          )}
          {separate && (
            <>
              {p.hasAlpha ? (
                <p className="muted small">Using the picture’s own transparency as the subject.</p>
              ) : (
                <Select<SegmentMethod>
                  label="Detection"
                  value={s.segmentMethod}
                  options={[
                    { value: 'ai-fast', label: `AI · fast (${MODELS['ai-fast'].wasm!.mb} MB, once)` },
                    {
                      value: 'ai-hq',
                      label: HAS_WEBGPU
                        ? `AI · high quality (${MODELS['ai-hq'].webgpu!.mb}+ MB, GPU)`
                        : 'AI · high quality (needs WebGPU)',
                    },
                    { value: 'classic', label: 'Classic (no download)' },
                  ]}
                  onChange={(v) => update({ segmentMethod: v })}
                />
              )}
              <SegmentLine status={p.segment} modelNote={method ? `${method.label}, ${method.license}` : undefined} />
              <Segmented<Composition>
                label="Show"
                value={s.composition}
                options={[
                  { value: 'subject', label: 'Subject only', title: 'ASCII subject on black' },
                  { value: 'subject-on-photo', label: 'On photo', title: 'ASCII subject over the original background' },
                  { value: 'photo-on-ascii', label: 'Inverse', title: 'Photo subject, ASCII background' },
                ]}
                onChange={(v) => update({ composition: v })}
              />
              <Toggle
                label="Swap subject & background"
                checked={s.invertMask}
                onChange={(v) => update({ invertMask: v })}
              />
              {s.composition === 'subject' && (
                <Toggle label="Stars" checked={s.stars} onChange={(v) => update({ stars: v })} />
              )}
              {s.composition === 'subject-on-photo' && (
                <>
                  <Slider
                    label="Background brightness"
                    value={s.bgDim}
                    min={0}
                    max={1}
                    onChange={(v) => update({ bgDim: v })}
                    format={pct}
                  />
                  <Slider
                    label="Background blur"
                    value={s.bgBlur}
                    min={0}
                    max={1}
                    onChange={(v) => update({ bgBlur: v })}
                    format={pct}
                  />
                </>
              )}
              <details className="fine-tune">
                <summary>Fine-tune the cut-out</summary>
                <Slider
                  label="Threshold"
                  value={s.maskThreshold}
                  min={0.05}
                  max={0.95}
                  onChange={(v) => update({ maskThreshold: v })}
                  format={pct}
                />
                <Slider
                  label="Edge softness"
                  value={s.maskSoftness}
                  min={0}
                  max={0.6}
                  onChange={(v) => update({ maskSoftness: v })}
                  format={pct}
                />
                <Slider
                  label="Grow / shrink"
                  value={s.maskExpand}
                  min={-4}
                  max={4}
                  step={0.1}
                  onChange={(v) => update({ maskExpand: v })}
                  format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                />
              </details>
            </>
          )}
        </Section>

        <Section id="export" title="Export">
          <div className="btn-row">
            <button type="button" className="btn" disabled={!!p.exportBusy} onClick={() => p.onExportPng(2)}>
              PNG
            </button>
            <button type="button" className="btn" disabled={!!p.exportBusy} onClick={() => p.onExportPng(4)}>
              PNG 4×
            </button>
            <button type="button" className="btn" disabled={!!p.exportBusy} onClick={p.onExportVideo}>
              Video 6 s
            </button>
            <button type="button" className="btn" disabled={!!p.exportBusy} onClick={p.onCopyText}>
              Copy text
            </button>
          </div>
          {p.exportBusy && <p className="muted small">{p.exportBusy}</p>}
        </Section>

        <div className="sidebar__foot">
          <button type="button" className="link" onClick={p.onReset}>
            Reset all settings
          </button>
        </div>
      </div>
    </aside>
  );
}

function SegmentLine({ status, modelNote }: { status: SegmentStatus; modelNote?: string }) {
  if (status.state === 'idle') return null;
  return (
    <div className={`seg-status seg-status--${status.state}`} role="status">
      {status.state === 'running' && <span className="spinner" aria-hidden="true" />}
      <span>{status.text}</span>
      {status.progress !== undefined && status.state === 'running' && (
        <span className="bar" aria-hidden="true">
          <span className="bar__fill" style={{ width: `${Math.round(status.progress * 100)}%` }} />
        </span>
      )}
      {status.state === 'done' && modelNote && <span className="seg-status__note">{modelNote}</span>}
    </div>
  );
}
