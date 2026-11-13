// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
//    Why:  the building blocks of design system v2: avatars that tell people, agents and clients apart,
//          chips, health pills, progress drawn as SVG (the page's security policy allows no inline styles),
//          cards, stats, sparklines and keyboard hints. Every page of the preview is made of these.
import type { ReactNode } from 'react';
import { person, type Health } from './data.js';
import { PIcon, type PIconName } from './picons.js';

export function Avatar(props: {
  id: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  ring?: boolean;
}): ReactNode {
  const p = person(props.id);
  const cls =
    'pv-avatar pv-avatar--' +
    (props.size ?? 'sm') +
    ' pv-tone-' +
    String(p.tone) +
    (p.kind === 'agent' ? ' pv-avatar--agent' : '') +
    (p.kind === 'client' ? ' pv-avatar--client' : '') +
    (props.ring ? ' pv-avatar--ring' : '');
  return (
    <span className={cls} title={p.name + (p.title ? ' · ' + p.title : '')}>
      {p.kind === 'agent' ? (
        <PIcon name="agents" size={props.size === 'xs' ? 11 : 13} />
      ) : (
        p.initials
      )}
      {p.online ? <span className="pv-presence" aria-label="online" /> : null}
    </span>
  );
}

export function AvatarStack(props: { ids: string[]; max?: number }): ReactNode {
  const max = props.max ?? 4;
  const shown = props.ids.slice(0, max);
  return (
    <span className="pv-avatar-stack">
      {shown.map((id) => (
        <Avatar key={id} id={id} size="xs" ring />
      ))}
      {props.ids.length > max ? (
        <span className="pv-avatar-more">+{props.ids.length - max}</span>
      ) : null}
    </span>
  );
}

export function Chip(props: {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'agent' | undefined;
  icon?: PIconName;
  mono?: boolean;
}): ReactNode {
  return (
    <span
      className={'pv-chip pv-chip--' + (props.tone ?? 'neutral') + (props.mono ? ' pv-mono' : '')}
    >
      {props.icon ? <PIcon name={props.icon} size={12} /> : null}
      {props.children}
    </span>
  );
}

const HEALTH: Record<Health, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  'on-track': { label: 'On track', tone: 'success' },
  'at-risk': { label: 'At risk', tone: 'warning' },
  late: { label: 'Late', tone: 'danger' },
};

export function HealthPill(props: { health: Health }): ReactNode {
  const h = HEALTH[props.health];
  return (
    <span className={'pv-health pv-health--' + h.tone}>
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <circle cx="4" cy="4" r="4" />
      </svg>
      {h.label}
    </span>
  );
}

/** A bar of `value` of `max`, optionally with a marker (e.g. where it should be today). */
export function Bar(props: {
  value: number;
  max: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'agent';
  marker?: number;
  label?: string;
}): ReactNode {
  const pct = props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0;
  const mark =
    props.marker !== undefined && props.max > 0 ? Math.min(1, props.marker / props.max) : null;
  return (
    <svg
      className={'pv-bar pv-bar--' + (props.tone ?? 'primary')}
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      role="img"
      aria-label={props.label ?? String(Math.round(pct * 100)) + ' %'}
    >
      <rect className="pv-bar-track" x="0" y="0" width="100" height="6" rx="3" />
      <rect className="pv-bar-fill" x="0" y="0" width={pct * 100} height="6" rx="3" />
      {mark !== null ? (
        <rect className="pv-bar-mark" x={mark * 100 - 0.4} y="0" width="0.8" height="6" />
      ) : null}
    </svg>
  );
}

export function Card(props: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}): ReactNode {
  return (
    <section
      className={
        'pv-card' +
        (props.flush ? ' pv-card--flush' : '') +
        (props.className ? ' ' + props.className : '')
      }
    >
      {props.title || props.action ? (
        <header className="pv-card-head">
          <h2 className="pv-card-title">{props.title}</h2>
          {props.action}
        </header>
      ) : null}
      {props.children}
    </section>
  );
}

export function Stat(props: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'success' | 'warning' | 'danger' | undefined;
  icon?: PIconName;
}): ReactNode {
  return (
    <div className="pv-stat">
      <div className="pv-stat-label">
        {props.icon ? <PIcon name={props.icon} size={14} /> : null}
        {props.label}
      </div>
      <div className={'pv-stat-value' + (props.tone ? ' pv-text-' + props.tone : '')}>
        {props.value}
      </div>
      {props.sub ? <div className="pv-stat-sub">{props.sub}</div> : null}
    </div>
  );
}

export function Kbd(props: { children: ReactNode }): ReactNode {
  return <kbd className="pv-kbd">{props.children}</kbd>;
}

export function Button(props: {
  children: ReactNode;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: PIconName;
  size?: 'sm' | 'md';
  onClick?: () => void;
  title?: string;
  /** [PCODE-164 | S15 | v0.1.0] the live pages wait for valid input */
  disabled?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      className={
        'pv-btn pv-btn--' + (props.kind ?? 'secondary') + (props.size === 'sm' ? ' pv-btn--sm' : '')
      }
      onClick={props.onClick}
      title={props.title}
      disabled={props.disabled}
    >
      {props.icon ? <PIcon name={props.icon} size={props.size === 'sm' ? 14 : 16} /> : null}
      {props.children}
    </button>
  );
}

/** Burndown: remaining work per day against the ideal line, with today marked. */
export function MiniBurndown(props: {
  actual: number[];
  ideal: number[];
  days: number;
}): ReactNode {
  const w = 640;
  const h = 160;
  const max = Math.max(...props.ideal, ...props.actual, 1);
  const x = (i: number): number => (i / Math.max(1, props.days)) * (w - 8) + 4;
  const y = (v: number): number => h - 6 - (v / max) * (h - 14);
  const line = (vals: number[]): string =>
    vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const today = props.actual.length - 1;
  const last = props.actual[today] ?? 0;
  return (
    <svg
      className="pv-burndown"
      viewBox={'0 0 ' + String(w) + ' ' + String(h)}
      role="img"
      aria-label={'Burndown: ' + String(last) + ' points left'}
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} className="pv-gridline" x1="4" x2={w - 4} y1={y(max * f)} y2={y(max * f)} />
      ))}
      <path className="pv-burndown-ideal" d={line(props.ideal)} />
      <path
        className="pv-burndown-area"
        d={
          line(props.actual) +
          ' L' +
          x(today).toFixed(1) +
          ' ' +
          String(h - 6) +
          ' L4 ' +
          String(h - 6) +
          ' Z'
        }
      />
      <path className="pv-burndown-actual" d={line(props.actual)} />
      <line className="pv-burndown-today" x1={x(today)} x2={x(today)} y1="4" y2={h - 6} />
      <circle className="pv-burndown-dot" cx={x(today)} cy={y(last)} r="3.5" />
    </svg>
  );
}

/** A small ring for a share, e.g. tests passing. */
export function Ring(props: {
  value: number;
  max: number;
  tone?: 'success' | 'warning' | 'danger' | 'primary';
  size?: number;
}): ReactNode {
  const s = props.size ?? 40;
  const r = s / 2 - 4;
  const c = 2 * Math.PI * r;
  const pct = props.max > 0 ? props.value / props.max : 0;
  return (
    <svg
      className={'pv-ring pv-ring--' + (props.tone ?? 'primary')}
      width={s}
      height={s}
      viewBox={'0 0 ' + String(s) + ' ' + String(s)}
      role="img"
      aria-label={String(Math.round(pct * 100)) + ' %'}
    >
      <circle className="pv-ring-track" cx={s / 2} cy={s / 2} r={r} />
      <circle
        className="pv-ring-fill"
        cx={s / 2}
        cy={s / 2}
        r={r}
        strokeDasharray={String(c * pct) + ' ' + String(c)}
        transform={'rotate(-90 ' + String(s / 2) + ' ' + String(s / 2) + ')'}
      />
      <text className="pv-ring-text" x="50%" y="50%" dominantBaseline="central" textAnchor="middle">
        {Math.round(pct * 100)}
      </text>
    </svg>
  );
}

/** Horizontal share bars, e.g. AI spend per project. */
export function ShareBars(props: {
  rows: { label: ReactNode; value: number; display: string }[];
}): ReactNode {
  const max = Math.max(...props.rows.map((r) => r.value), 1);
  return (
    <ul className="pv-share">
      {props.rows.map((r, i) => (
        <li key={i} className="pv-share-row">
          <span className="pv-share-label">{r.label}</span>
          <Bar value={r.value} max={max} tone="agent" />
          <span className="pv-share-value pv-num">{r.display}</span>
        </li>
      ))}
    </ul>
  );
}

export function PageHead(props: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  icon?: PIconName;
}): ReactNode {
  return (
    <header className="pv-page-head">
      <div className="pv-page-title-row">
        {props.icon ? (
          <span className="pv-page-icon">
            <PIcon name={props.icon} size={20} />
          </span>
        ) : null}
        <div>
          <h1 className="pv-page-title">{props.title}</h1>
          {props.sub ? <p className="pv-page-sub">{props.sub}</p> : null}
        </div>
      </div>
      {props.actions ? <div className="pv-page-actions">{props.actions}</div> : null}
    </header>
  );
}
