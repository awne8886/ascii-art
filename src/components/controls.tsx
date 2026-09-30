import { useId, useState, type CSSProperties, type ReactNode } from 'react';

function loadOpen(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`ascii-art:section:${key}`);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function Section({
  id,
  title,
  defaultOpen = true,
  aside,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** Shown in the header, right-aligned (e.g. an on/off switch). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => loadOpen(id, defaultOpen));
  const bodyId = useId();
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(`ascii-art:section:${id}`, o ? '0' : '1');
      } catch {
        // Not persisted; fine.
      }
      return !o;
    });
  };
  return (
    <section className={`section${open ? ' section--open' : ''}`}>
      <div className="section__head">
        <button type="button" className="section__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <span className="section__chevron" aria-hidden="true">
            ›
          </span>
          {title}
        </button>
        {aside}
      </div>
      {open && (
        <div className="section__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={`control${disabled ? ' control--disabled' : ''}`}>
      <div className="control__row">
        <label htmlFor={id} className="control__label">
          {label}
        </label>
        <output htmlFor={id} className="control__value">
          {format ? format(value) : value.toFixed(2)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      {hint && <p className="control__hint">{hint}</p>}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Just the switch (label is for screen readers), for section headers. */
  compact?: boolean;
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={compact ? label : undefined}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  );
  if (compact) return sw;
  return (
    <div className={`control control--inline${disabled ? ' control--disabled' : ''}`}>
      <span className="control__label" onClick={() => !disabled && onChange(!checked)}>
        {label}
      </span>
      {sw}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`control${disabled ? ' control--disabled' : ''}`}>
      <span className="control__label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            title={o.title}
            disabled={disabled}
            className={`segmented__opt${value === o.value ? ' segmented__opt--on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`control${disabled ? ' control--disabled' : ''}`}>
      <label htmlFor={id} className="control__label">
        {label}
      </label>
      <select
        id={id}
        className="select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
