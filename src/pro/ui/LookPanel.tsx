import { useEffect, useMemo, useRef, useState } from 'react';
import { BLEND_MODES } from '../effects/prelude';
import { EFFECTS, byCategory, effectById, picks } from '../effects/registry';
import {
  CATEGORIES,
  defaultParams,
  presetParams,
  type EffectDef,
  type ParamDef,
  type ParamValue,
  type ParamValues,
} from '../effects/types';
import { newEffect, SEPARABLE_KINDS, uid, type Appears, type EffectInstance, type Modulation } from '../model';
import { effectsOf, setEffects, updateEffect, type Studio } from '../store';
import { loadLooks, lookName, saveLooks, type SavedLook } from '../storage';
import { useEffectThumb, useStackThumb } from '../thumbs';
import { ColorRow, Group, NumberBox, Segmented, Select, Slider, Switch } from './controls';
import { Icon } from './icons';

const CAT_LABEL = new Map(CATEGORIES.map((c) => [c.id, c.label]));

/** Where a look shows; `short` fits the Mask group's four columns. */
const APPEARS: ReadonlyArray<{ value: Appears; label: string; short?: string }> = [
  { value: 0, label: 'Whole layer', short: 'All' },
  { value: 1, label: 'Brights' },
  { value: 2, label: 'Darks' },
  { value: 3, label: 'Centre' },
  { value: 4, label: 'Edges' },
  { value: 5, label: 'Tracked object', short: 'Object' },
  { value: 6, label: 'Subject' },
  { value: 7, label: 'Background' },
];

const APPEARS_SEG = APPEARS.map((a) => ({ value: a.value, label: a.short ?? a.label, title: a.label }));

interface Props {
  studio: Studio;
  /** Layer id, or null for the whole canvas. */
  owner: string | null;
  toast: (msg: string) => void;
  /** Opens the layer's Subject tab (looks that appear on the subject or the background need it). */
  onOpenSubject?: () => void;
}

export function LookPanel({ studio, owner, toast, onOpenSubject }: Props) {
  const stack = effectsOf(studio.project, owner);
  // Looks on the subject or the background need a separated subject: the layer's own, or (canvas) any layer's.
  const ownerLayer = owner === null ? undefined : studio.project.layers.find((l) => l.id === owner);
  const separable = !ownerLayer || SEPARABLE_KINDS.includes(ownerLayer.kind);
  const separated = owner === null ? studio.project.layers.some((l) => l.subject?.on) : !!ownerLayer?.subject?.on;
  const [tab, setTab] = useState<'looks' | 'saved'>('looks');
  const [adding, setAdding] = useState(stack.length === 0);
  const [active, setActive] = useState<string | null>(stack.at(-1)?.uid ?? null);
  const [saved, setSaved] = useState<SavedLook[]>(loadLooks);

  // Follow the owner: a new layer starts in the library if it has no looks.
  const ownerRef = useRef(owner);
  useEffect(() => {
    if (ownerRef.current === owner) return;
    ownerRef.current = owner;
    const list = effectsOf(studio.project, owner);
    setAdding(list.length === 0);
    setActive(list.at(-1)?.uid ?? null);
  }, [owner, studio.project]);

  const current = stack.find((e) => e.uid === active) ?? stack.at(-1) ?? null;
  const showLibrary = tab === 'looks' && (adding || !current);

  const apply = (effectId: string, preset?: string) => {
    const fx = newEffect(effectId, preset);
    studio.commit(setEffects(owner, (list) => [...list, fx]));
    setActive(fx.uid);
    setAdding(false);
  };

  const saveCurrent = () => {
    if (!stack.length) return;
    const look: SavedLook = { id: uid('look'), name: lookName(stack), effects: stack.map((e) => ({ ...e })) };
    const next = [look, ...saved].slice(0, 60);
    setSaved(next);
    saveLooks(next);
    toast(`Saved “${look.name}” to your looks.`);
  };

  return (
    <div className="look">
      <div className="ptabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'looks'}
          className={`ptabs__tab${tab === 'looks' ? ' ptabs__tab--on' : ''}`}
          onClick={() => setTab('looks')}
        >
          Looks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'saved'}
          className={`ptabs__tab${tab === 'saved' ? ' ptabs__tab--on' : ''}`}
          onClick={() => setTab('saved')}
        >
          Saved looks <span className="ptabs__count">{saved.length}</span>
        </button>
      </div>

      {tab === 'saved' && (
        <SavedLooks
          looks={saved}
          onApply={(l) => {
            const fresh = l.effects.map((e) => ({ ...e, uid: uid('fx') }));
            studio.commit(setEffects(owner, (list) => [...list, ...fresh]));
            setActive(fresh.at(-1)?.uid ?? null);
            setAdding(false);
            setTab('looks');
          }}
          onDelete={(id) => {
            const next = saved.filter((l) => l.id !== id);
            setSaved(next);
            saveLooks(next);
          }}
        />
      )}

      {tab === 'looks' && stack.length > 0 && (
        <Stack
          stack={stack}
          active={showLibrary ? null : (current?.uid ?? null)}
          adding={showLibrary}
          onSelect={(id) => {
            setActive(id);
            setAdding(false);
          }}
          onAdd={() => setAdding(true)}
          onToggle={(fx) => studio.commit(updateEffect(owner, fx.uid, { enabled: !fx.enabled }))}
          onRemove={(fx) => {
            studio.commit(setEffects(owner, (list) => list.filter((e) => e.uid !== fx.uid)));
            if (stack.length === 1) setAdding(true);
          }}
          onReorder={(from, to) =>
            studio.commit(
              setEffects(owner, (list) => {
                const next = [...list];
                const [m] = next.splice(from, 1);
                next.splice(to, 0, m!);
                return next;
              }),
            )
          }
        />
      )}

      {showLibrary && <Library onApply={apply} onCancel={stack.length ? () => setAdding(false) : undefined} />}

      {tab === 'looks' && !showLibrary && current && (
        <Editor
          studio={studio}
          owner={owner}
          fx={current}
          onSave={saveCurrent}
          separated={separated}
          separable={separable}
          onOpenSubject={onOpenSubject}
          key={current.uid}
        />
      )}
    </div>
  );
}

// ─── Stack ───────────────────────────────────────────────────────────────────

function Stack({
  stack,
  active,
  adding,
  onSelect,
  onAdd,
  onToggle,
  onRemove,
  onReorder,
}: {
  stack: EffectInstance[];
  active: string | null;
  adding: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onToggle: (fx: EffectInstance) => void;
  onRemove: (fx: EffectInstance) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const drag = useRef<number | null>(null);
  return (
    <div className="stack">
      {stack.map((fx, i) => (
        <div
          key={fx.uid}
          className={`stack__item${fx.uid === active ? ' stack__item--on' : ''}${fx.enabled ? '' : ' stack__item--off'}`}
          draggable
          onDragStart={() => (drag.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (drag.current !== null && drag.current !== i) onReorder(drag.current, i);
            drag.current = null;
          }}
        >
          <button type="button" className="stack__thumb" onClick={() => onSelect(fx.uid)} title="Edit this look">
            <StackThumb fx={fx} />
            <span className="stack__num">{String(i + 1).padStart(2, '0')}</span>
          </button>
          <span className="stack__tools">
            <button
              type="button"
              className={`stack__tool${fx.enabled ? ' stack__tool--live' : ''}`}
              onClick={() => onToggle(fx)}
              title={fx.enabled ? 'Turn off' : 'Turn on'}
              aria-label={fx.enabled ? 'Turn look off' : 'Turn look on'}
            >
              <Icon name="power" size={12} />
            </button>
            <button
              type="button"
              className="stack__tool"
              onClick={() => onRemove(fx)}
              title="Remove"
              aria-label="Remove look"
            >
              <Icon name="trash" size={12} />
            </button>
          </span>
          <span className="stack__name">{effectById(fx.effectId)?.name ?? fx.effectId}</span>
        </div>
      ))}
      <div className={`stack__item stack__item--add${adding ? ' stack__item--on' : ''}`}>
        <button type="button" className="stack__thumb stack__thumb--add" onClick={onAdd} title="Add a look">
          <Icon name="plus" size={18} />
        </button>
        <span className="stack__name">Add</span>
      </div>
    </div>
  );
}

function StackThumb({ fx }: { fx: EffectInstance }) {
  const url = useEffectThumb(fx.effectId, fx.preset);
  return url ? <img src={url} alt="" /> : <span className="thumb-wait" />;
}

// ─── Library ─────────────────────────────────────────────────────────────────

function Library({ onApply, onCancel }: { onApply: (id: string, preset?: string) => void; onCancel?: () => void }) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string>('picks');
  const listRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    const match = (d: EffectDef) =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q) ||
      (CAT_LABEL.get(d.category) ?? '').toLowerCase().includes(q);
    const out: { id: string; label: string; items: EffectDef[] }[] = [];
    if (!q) out.push({ id: 'picks', label: 'Our picks', items: picks() });
    for (const c of CATEGORIES) {
      const items = byCategory(c.id).filter(match);
      if (items.length) out.push({ id: c.id, label: c.label, items });
    }
    return out;
  }, [q]);

  const jump = (id: string) => {
    setCat(id);
    listRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const scrollChips = (d: number) => chipsRef.current?.scrollBy({ left: d * 160, behavior: 'smooth' });

  return (
    <div className="library">
      <div className="library__search">
        <Icon name="search" size={15} />
        <input
          placeholder="Find an effect"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          aria-label="Find an effect"
        />
        <span className="library__count">{EFFECTS.length}</span>
        {onCancel && (
          <button
            type="button"
            className="pbtn pbtn--icon pbtn--small"
            onClick={onCancel}
            aria-label="Back to the stack"
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
      {!q && (
        <div className="chips">
          <button type="button" className="chips__arrow" onClick={() => scrollChips(-1)} aria-label="Scroll left">
            <Icon name="chevronLeft" size={14} />
          </button>
          <div className="chips__row" ref={chipsRef}>
            {[{ id: 'picks', label: 'Our picks' }, ...CATEGORIES].map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip${cat === c.id ? ' chip--on' : ''}`}
                onClick={() => jump(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <button type="button" className="chips__arrow" onClick={() => scrollChips(1)} aria-label="Scroll right">
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
      )}
      <div className="library__list" ref={listRef}>
        {sections.map((s) => (
          <section key={s.id} data-section={s.id} className="library__section">
            <h3 className="library__heading">
              {s.label} <span>{s.items.length}</span>
            </h3>
            <div className="library__grid">
              {s.items.map((d) => (
                <LookCard key={d.id} def={d} onApply={() => onApply(d.id)} />
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 && <p className="muted small pad">No look matches “{query}”.</p>}
      </div>
    </div>
  );
}

function LookCard({ def, onApply }: { def: EffectDef; onApply: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
      rootMargin: '200px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <button type="button" ref={ref} className="lookcard" onClick={onApply} title={def.description}>
      <span className="lookcard__img">
        {visible ? <CardThumb id={def.id} /> : <span className="thumb-wait" />}
        <span className="lookcard__apply">Apply</span>
      </span>
      <span className="lookcard__name">{def.name}</span>
      <span className="lookcard__cat">{CAT_LABEL.get(def.category)}</span>
    </button>
  );
}

function CardThumb({ id, preset }: { id: string; preset?: string }) {
  const url = useEffectThumb(id, preset);
  return url ? <img src={url} alt="" /> : <span className="thumb-wait" />;
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function Editor({
  studio,
  owner,
  fx,
  onSave,
  separated,
  separable,
  onOpenSubject,
}: {
  studio: Studio;
  owner: string | null;
  fx: EffectInstance;
  onSave: () => void;
  /** A subject is separated for this stack to go by (appears in subject / background). */
  separated: boolean;
  /** The owner can be separated at all (type and shapes can't; the canvas goes by its layers). */
  separable: boolean;
  onOpenSubject?: () => void;
}) {
  const def = effectById(fx.effectId);
  const set = (patch: Partial<EffectInstance>, coalesce?: string) =>
    studio.commit(updateEffect(owner, fx.uid, patch), coalesce);
  if (!def) return <p className="muted small pad">This look isn’t available any more.</p>;
  const index = EFFECTS.indexOf(def);
  const swap = (d: number) => {
    const next = EFFECTS[(index + d + EFFECTS.length) % EFFECTS.length]!;
    set({ effectId: next.id, params: defaultParams(next), mods: {}, preset: next.presets?.[0]?.name });
  };
  const setParam = (key: string, v: ParamValue) =>
    set({ params: { ...fx.params, [key]: v }, preset: undefined }, `param:${fx.uid}:${key}`);
  const surprise = () => set({ ...surpriseParams(def, fx.params), preset: undefined });

  const groups = new Map<string, ParamDef[]>();
  for (const p of def.params) {
    const g = p.group ?? 'Pins';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }

  return (
    <div className="editor">
      <div className="mixrow">
        <label className="mixrow__cell">
          <span>Blend</span>
          <select value={fx.blend} onChange={(e) => set({ blend: Number(e.currentTarget.value) })}>
            {BLEND_MODES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mixrow__cell">
          <span>Strength</span>
          <NumberBox
            value={Math.round(fx.strength * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            label="Strength"
            onChange={(v) => set({ strength: v / 100 }, `strength:${fx.uid}`)}
          />
        </label>
        <label className="mixrow__cell">
          <span>Appears in</span>
          <select value={fx.appears} onChange={(e) => set({ appears: Number(e.currentTarget.value) as Appears })}>
            {APPEARS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="fxhead">
        <div className="fxhead__top">
          <button type="button" className="fxhead__arrow" onClick={() => swap(-1)} aria-label="Previous look">
            <Icon name="chevronLeft" size={14} />
          </button>
          <span className="fxhead__thumb">
            <CardThumb id={def.id} />
          </span>
          <span className="fxhead__text">
            <span className="dots fxhead__name">{def.name}</span>
            <span className="fxhead__meta">
              Effect · {index + 1} of {EFFECTS.length}
            </span>
            <span className="fxhead__meta">{def.presets?.length ?? 0} presets</span>
          </span>
          <button
            type="button"
            className="fxhead__arrow fxhead__save"
            onClick={onSave}
            title="Save this stack to your looks"
            aria-label="Save look"
          >
            <Icon name="save" size={14} />
          </button>
          <button type="button" className="fxhead__arrow" onClick={() => swap(1)} aria-label="Next look">
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
        {def.presets && def.presets.length > 0 && (
          <div className="presets">
            {def.presets.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`preset${fx.preset === p.name ? ' preset--on' : ''}`}
                onClick={() => set({ params: presetParams(def, p), preset: p.name, mods: {} })}
              >
                <span className="preset__img">
                  <PresetThumb id={def.id} preset={p.name} />
                </span>
                <span className="preset__name">{p.name}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="pbtn pbtn--block" onClick={surprise}>
          <Icon name="dice" size={15} /> Surprise me
        </button>
      </div>

      <Group
        // Subject or background picked (up in "Appears in" too) with nothing separated: open, to say what it needs.
        key={fx.appears >= 6 && !separated ? 'mask-needs-subject' : 'mask'}
        title="Mask"
        icon="mask"
        defaultOpen={fx.appears !== 0}
        summary={APPEARS.find((a) => a.value === fx.appears)?.label}
      >
        <div className="maskseg">
          <Segmented value={fx.appears} cols={4} options={APPEARS_SEG} onChange={(v) => set({ appears: v })} />
        </div>
        {fx.appears >= 6 ? (
          separated ? (
            owner === null && (
              <p className="muted small">
                On the canvas, the subjects of every separated layer count; layers above (blended Normal) cover the ones
                below.
              </p>
            )
          ) : (
            <div className="subjnote">
              <p className="muted small">
                {owner === null
                  ? 'This needs a separated subject: switch it on in a layer’s Subject tab.'
                  : !separable
                    ? 'Type and shapes have no background to separate. Put this look on the canvas instead: there it can appear on just the subjects (or the background) of separated videos, pictures or the webcam.'
                    : 'This needs the layer’s subject separated from its background: switch it on in the Subject tab.'}
              </p>
              {owner !== null && separable && onOpenSubject && (
                <button type="button" className="pbtn pbtn--small" onClick={onOpenSubject}>
                  <Icon name="subject" size={13} /> Subject
                </button>
              )}
            </div>
          )
        ) : (
          <Slider
            label="Softness"
            value={fx.appearsSoft}
            min={0}
            max={0.5}
            onChange={(v) => set({ appearsSoft: v }, `soft:${fx.uid}`)}
          />
        )}
        <Switch label="Invert" checked={fx.appearsInvert} onChange={(v) => set({ appearsInvert: v })} />
      </Group>

      {[...groups.entries()].map(([name, params]) => (
        <Group key={name} title={name} icon={name === 'Pins' ? 'pin' : undefined} summary={params.length}>
          {params.map((p) => (
            <ParamRow
              key={p.key}
              def={p}
              value={fx.params[p.key] ?? p.default}
              mod={fx.mods[p.key]}
              onChange={(v) => setParam(p.key, v)}
              onMod={(m) => {
                const mods = { ...fx.mods };
                if (m) mods[p.key] = m;
                else delete mods[p.key];
                set({ mods }, m ? `mod:${fx.uid}:${p.key}` : undefined);
              }}
            />
          ))}
        </Group>
      ))}

      <button
        type="button"
        className="pbtn pbtn--block pbtn--ghost"
        onClick={() => set({ params: defaultParams(def), mods: {}, preset: def.presets?.[0]?.name })}
      >
        <Icon name="reset" size={14} /> Reset this look
      </button>
    </div>
  );
}

function PresetThumb({ id, preset }: { id: string; preset: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
      rootMargin: '100px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <span ref={ref}>{visible ? <CardThumb id={id} preset={preset} /> : <span className="thumb-wait" />}</span>;
}

/** "Surprise me": every setting somewhere random within its range (text stays). */
function surpriseParams(def: EffectDef, current: ParamValues): { params: ParamValues; seed: number } {
  const params = { ...current };
  for (const p of def.params) {
    if (p.type === 'range') {
      const r = p.min + Math.random() * (p.max - p.min);
      params[p.key] = p.step ? Math.round(r / p.step) * p.step : r;
    } else if (p.type === 'toggle') params[p.key] = Math.random() < 0.5;
    else if (p.type === 'select') params[p.key] = p.options[Math.floor(Math.random() * p.options.length)]!.value;
    else if (p.type === 'color') params[p.key] = randomColor();
  }
  return { params, seed: Math.random() };
}

function randomColor(): string {
  const h = Math.random();
  const s = 0.5 + Math.random() * 0.5;
  const l = 0.35 + Math.random() * 0.4;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function ParamRow({
  def,
  value,
  mod,
  onChange,
  onMod,
}: {
  def: ParamDef;
  value: ParamValue;
  mod: Modulation | undefined;
  onChange: (v: ParamValue) => void;
  onMod: (m: Modulation | null) => void;
}) {
  switch (def.type) {
    case 'range': {
      const v = Number(value);
      return (
        <>
          <Slider
            label={def.label}
            hint={def.hint}
            value={v}
            min={def.min}
            max={def.max}
            step={def.step ?? (def.max - def.min > 20 ? 1 : 0.01)}
            unit={def.unit}
            onChange={onChange}
            mod={{ loop: mod?.source === 'loop', sound: mod?.source === 'sound' }}
            onMod={(kind) =>
              onMod(
                mod?.source === kind
                  ? null
                  : {
                      source: kind,
                      to: mod?.to ?? (v > (def.min + def.max) / 2 ? def.min : def.max),
                      cycles: mod?.cycles ?? 1,
                    },
              )
            }
          />
          {mod && (
            <div className="modrow">
              <Slider
                label={mod.source === 'loop' ? '↳ loops to' : '↳ at loudest'}
                value={mod.to}
                min={def.min}
                max={def.max}
                step={def.step ?? 0.01}
                unit={def.unit}
                onChange={(to) => onMod({ ...mod, to })}
              />
              {mod.source === 'loop' && (
                <Segmented
                  value={mod.cycles}
                  options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: n, label: `${n}×` }))}
                  cols={6}
                  onChange={(cycles) => onMod({ ...mod, cycles })}
                />
              )}
            </div>
          )}
        </>
      );
    }
    case 'color':
      return <ColorRow label={def.label} value={String(value)} onChange={onChange} />;
    case 'toggle':
      return <Switch label={def.label} hint={def.hint} checked={!!value} onChange={onChange} />;
    case 'select':
      return def.options.length <= 4 ? (
        <Segmented label={def.label} value={Number(value)} options={def.options} onChange={onChange} />
      ) : (
        <Select label={def.label} value={Number(value)} options={def.options} onChange={onChange} />
      );
    case 'text':
      return <TextParam def={def} value={String(value)} onChange={onChange} />;
  }
}

const MARKS = ' .,:;\'`"^~-_=+*!?/\\|()[]{}<>#%@&$';

function TextParam({
  def,
  value,
  onChange,
}: {
  def: ParamDef & { type: 'text' };
  value: string;
  onChange: (v: string) => void;
}) {
  const glyphs = Array.from(value);
  const isRamp = /ramp|glyph|char|symbol/i.test(def.key);
  return (
    <div className="prow prow--stack">
      <span className="prow__label">
        {def.label} {isRamp && <span className="muted">{glyphs.length} glyphs</span>}
      </span>
      <input
        className="ptext"
        value={value}
        maxLength={def.maxLength ?? 200}
        spellCheck={false}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      {isRamp && (
        <>
          <div className="ramp" aria-hidden="true">
            {glyphs.map((g, i) => (
              <span key={i} className="ramp__g">
                {g === ' ' ? '␣' : g}
              </span>
            ))}
          </div>
          <div className="ramp__tools">
            <span className="muted small">Sparse → dense</span>
            <button type="button" className="pbtn pbtn--small" onClick={() => onChange(glyphs.reverse().join(''))}>
              Reverse
            </button>
            <button
              type="button"
              className="pbtn pbtn--small"
              onClick={() => {
                const pool = Array.from(new Set(MARKS));
                const n = 6 + Math.floor(Math.random() * 10);
                const pick = [' ', ...pool.sort(() => Math.random() - 0.5).slice(0, n)];
                onChange(Array.from(new Set(pick)).join(''));
              }}
            >
              Random
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SavedLooks({
  looks,
  onApply,
  onDelete,
}: {
  looks: SavedLook[];
  onApply: (l: SavedLook) => void;
  onDelete: (id: string) => void;
}) {
  if (!looks.length) {
    return (
      <p className="muted small pad">
        No saved looks yet. Build a stack of looks, then press <Icon name="save" size={12} /> to keep it here and use it
        on any layer.
      </p>
    );
  }
  return (
    <div className="library__grid pad">
      {looks.map((l) => (
        <div key={l.id} className="lookcard lookcard--saved">
          <button type="button" className="lookcard__img" onClick={() => onApply(l)} title="Apply this look">
            <SavedThumb effects={l.effects} />
            <span className="lookcard__apply">Apply</span>
          </button>
          <span className="lookcard__name">{l.name}</span>
          <button type="button" className="lookcard__del" onClick={() => onDelete(l.id)} aria-label="Delete saved look">
            <Icon name="trash" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SavedThumb({ effects }: { effects: EffectInstance[] }) {
  const url = useStackThumb(effects);
  return url ? <img src={url} alt="" /> : <span className="thumb-wait" />;
}
