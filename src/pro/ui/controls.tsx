import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/** Inspector building blocks, PRO style. */

export function fmt(v: number, step = 0.01, unit = ''): string {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return `${v.toFixed(digits)}${unit}`;
}

export function NumberBox({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  unit = '',
  label,
  wide,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  wide?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(',', '.'));
    if (Number.isFinite(n)) {
      let v = n;
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      onChange(v);
    }
    setDraft(null);
  };
  return (
    <span className={`numbox${wide ? ' numbox--wide' : ''}`}>
      <input
        aria-label={label}
        value={draft ?? fmt(value, step)}
        inputMode="decimal"
        onFocus={(e) => {
          setDraft(fmt(value, step));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * (step >= 1 ? step : step * 10) * (e.shiftKey ? 10 : 1);
            let v = value + d;
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            onChange(v);
            setDraft(fmt(v, step));
          }
        }}
      />
      {unit && <span className="numbox__unit">{unit}</span>}
    </span>
  );
}

export interface ModState {
  loop: boolean;
  sound: boolean;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = '',
  onChange,
  hint,
  mod,
  onMod,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  hint?: string;
  /** Shows the animate (◇) and sound (♪) buttons. */
  mod?: ModState;
  onMod?: (kind: 'loop' | 'sound') => void;
  disabled?: boolean;
}) {
  const id = useId();
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100));
  return (
    <div className={`prow prow--slider${mod && onMod ? ' prow--mods' : ''}${disabled ? ' prow--disabled' : ''}`}>
      <label htmlFor={id} className="prow__label" title={hint}>
        {label}
        {hint && <span className="prow__hint">?</span>}
      </label>
      <input
        id={id}
        type="range"
        className="pslider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <NumberBox value={value} onChange={onChange} min={min} max={max} step={step} unit={unit} label={label} />
      {mod && onMod && (
        <span className="prow__mods">
          <button
            type="button"
            className={`modbtn${mod.loop ? ' modbtn--on' : ''}`}
            title="Animate: loop between this value and another"
            aria-pressed={mod.loop}
            onClick={() => onMod('loop')}
          >
            <Icon name="diamond" size={13} />
          </button>
          <button
            type="button"
            className={`modbtn${mod.sound ? ' modbtn--on' : ''}`}
            title="Follow the sound"
            aria-pressed={mod.sound}
            onClick={() => onMod('sound')}
          >
            <Icon name="note" size={13} />
          </button>
        </span>
      )}
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="prow prow--inline">
      <span className="prow__label" title={hint}>
        {label}
        {hint && <span className="prow__hint">?</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`pswitch${checked ? ' pswitch--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="pswitch__dot" />
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  cols,
}: {
  label?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  cols?: number;
}) {
  return (
    <div className="prow prow--stack">
      {label && <span className="prow__label">{label}</span>}
      <div
        className="pseg"
        role="radiogroup"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${cols ?? Math.min(options.length, 4)}, 1fr)` }}
      >
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            title={o.title}
            className={`pseg__opt${value === o.value ? ' pseg__opt--on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="prow">
      <label htmlFor={id} className="prow__label">
        {label}
      </label>
      <select
        id={id}
        className="pselect"
        value={String(value)}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          const found = options.find((o) => String(o.value) === raw);
          if (found) onChange(found.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="prow">
      <label htmlFor={id} className="prow__label">
        {label}
      </label>
      <span className="pcolor">
        <input
          id={id}
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
        <input
          className="pcolor__hex"
          value={(draft ?? value).toUpperCase()}
          aria-label={`${label} hex`}
          spellCheck={false}
          onFocus={() => setDraft(value)}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => {
            const v = draft && !draft.startsWith('#') ? `#${draft}` : draft;
            if (v && /^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
            setDraft(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </span>
    </div>
  );
}

/** Collapsible inspector group, like "PLACEMENT" or "PINS". */
export function Group({
  title,
  icon,
  summary,
  children,
  defaultOpen = true,
  aside,
  reveal = false,
}: {
  title: string;
  icon?: IconName;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  aside?: ReactNode;
  /** Opens the group each time this turns true (something inside needs seeing), without remounting what's in it. */
  reveal?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal) setOpen(true);
  }
  return (
    <section className={`pgroup${open ? ' pgroup--open' : ''}`}>
      <div className="pgroup__head">
        <button type="button" className="pgroup__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {icon && <Icon name={icon} size={16} />}
          <span className="pgroup__title">{title}</span>
          {summary !== undefined && <span className="pgroup__summary">{summary}</span>}
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} className="pgroup__chev" />
        </button>
        {aside}
      </div>
      {open && <div className="pgroup__body">{children}</div>}
    </section>
  );
}

/** A big toggle card (FINISH: Bloom, Streaks…). */
export function Card({
  label,
  on,
  onClick,
  icon,
  active,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  /** Its settings are showing. */
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pcard${on ? ' pcard--on' : ''}${active ? ' pcard--active' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      <span className="pcard__led" />
      <span className="pcard__icon">{icon}</span>
      <span className="pcard__label">{label}</span>
    </button>
  );
}

export function PanelTitle({ title, sub, onClose }: { title: string; sub?: string; onClose?: () => void }) {
  return (
    <div className="ptitle">
      <div className="ptitle__box">
        <span className="dots ptitle__main">{title}</span>
        {sub && <span className="ptitle__sub">{sub}</span>}
      </div>
      {onClose && (
        <button type="button" className="pbtn pbtn--icon" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}
