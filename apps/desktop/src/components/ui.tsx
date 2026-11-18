import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Station marker: a small filled square, tinted by the station's tone. */
export function Diamond({ tone = 'jarvis' }: { tone?: Tone }) {
  return (
    <svg className={`marker tone-${tone}`} width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
      <rect width="6" height="6" />
    </svg>
  );
}

export type Tone = 'jarvis' | 'ok' | 'warn' | 'bad' | 'muted' | 'live';

interface PanelProps {
  title: string;
  meta?: ReactNode;
  tone?: Tone;
  className?: string;
  children: ReactNode;
  headingLevel?: 2 | 3;
  id?: string;
}

/** Hairline-framed terminal panel with a mono header bar. */
export function Panel({ title, meta, tone = 'muted', className = '', children, headingLevel = 2, id }: PanelProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = id ?? `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className={`panel ${className}`} aria-labelledby={headingId}>
      <header className="panel-head">
        <Diamond tone={tone} />
        <Heading id={headingId} className="panel-title">
          {title}
        </Heading>
        {meta !== undefined && <div className="panel-meta">{meta}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  size?: 'md' | 'sm';
}

export function Button({ variant = 'secondary', icon: Icon, size = 'md', className = '', children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`pill tone-${tone}`}>
      <span className="pill-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-desc">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`switch ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </label>
  );
}

interface EmptyProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

/** Honest "nothing here yet" block: says what will appear and why it is empty. */
export function Empty({ icon: Icon, title, children, action }: EmptyProps) {
  return (
    <div className="empty">
      <Icon className="empty-icon" size={20} strokeWidth={1.5} aria-hidden="true" />
      <div className="empty-copy">
        <p className="empty-title">{title}</p>
        <p className="empty-text">{children}</p>
      </div>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** Segmented input-level meter. */
export function LevelMeter({ level, active, label = 'Microphone level' }: { level: number; active: boolean; label?: string }) {
  const segments = 24;
  const lit = active ? Math.round(level * segments) : 0;
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={`meter-seg ${i < lit ? (i > segments * 0.85 ? 'is-hot' : 'is-on') : ''}`} />
      ))}
    </div>
  );
}

export function Readout({ label, value, tone = 'jarvis', hint }: { label: string; value: ReactNode; tone?: Tone; hint?: string }) {
  return (
    <div className="readout">
      <span className="readout-label">{label}</span>
      <span className={`readout-value tone-${tone}`}>{value}</span>
      {hint && <span className="readout-hint">{hint}</span>}
    </div>
  );
}

export function ScreenHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="screen-head">
      <h1 className="screen-title">{title}</h1>
      {children && <p className="screen-lead">{children}</p>}
    </header>
  );
}
