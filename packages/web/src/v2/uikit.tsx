// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-297 | S15 | v0.1.0] T30.10 Figma two-way sync: variables and components, tested against recorded Figma answers ──
// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
// ── [PCODE-294 | S15 | v0.1.0] T30.8a Overlay compare of mockup versions, client pins in the portal ──
// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
// ── [PCODE-292 | S15 | v0.1.0] T30.6 Handoff specs per mockup: tokens, components, states, breakpoints, measures, export areas ──
// ── [PCODE-291 | S15 | v0.1.0] T30.5 Live component preview with the project's tokens and themes ──
// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
// ── [PCODE-289 | S15 | v0.1.0] T30.3 Brand pages: colour, type, voice, logo use, do and don't ──
// ── [PCODE-288 | S15 | v0.1.0] T30.2 Design tokens exported as a pull request (GitHub, Gitea) ──
// ── [PCODE-287 | S15 | v0.1.0] T30.1 Design tokens: themes and modes, aliases, W3C import, iOS and Android export ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-172 | S15 | v0.1.0] B3.5 UI kit live in the web app: tokens with export, components, mockups with pins and approval, assets, contrast checks ──
//    Why:  the UI kit tab of the approved design on the server's kit. Tokens hold the design's decisions in
//          light and dark and leave as files the code uses; the component inventory says what exists and
//          where; mockups are reviewed version by version with comments pinned to the spot they are about
//          (drawn in SVG, so the page keeps its no-inline-style rule) and approved for the exact image;
//          assets carry their rights; checks hold the colours to WCAG contrast.
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { sizeText, uploadFile } from './files.js';
import { BrandBook } from './brand.js'; // [PCODE-289 | S15 | v0.1.0]
import { KitFindings } from './kitchecks.js'; // [PCODE-290 | S15 | v0.1.0]
import { ComponentPreview } from './kitpreview.js'; // [PCODE-291 | S15 | v0.1.0]
import { Handoff } from './handoff.js'; // [PCODE-292 | S15 | v0.1.0]
import { AssetSizes } from './assetsizes.js'; // [PCODE-293 | S15 | v0.1.0]
import { COMPARE_MODES, CompareImages, type CompareMode } from './overlay.js'; // [PCODE-294 | S15 | v0.1.0]
import { VisualChecks } from './visual.js'; // [PCODE-295 | S15 | v0.1.0]
import { A11yFindings } from './a11ychecks.js'; // [PCODE-296 | S15 | v0.1.0]
import { FigmaSync } from './figma.js'; // [PCODE-297 | S15 | v0.1.0]
import { tokenResolver } from '@orqiva/shared'; // [PCODE-287 | S15 | v0.1.0]
import {
  AliasWarnings,
  ImportTokens,
  ThemeBar,
  TokenPullRequest,
  type AliasProblem,
  type Theme,
} from './tokenthemes.js'; // [PCODE-287 | S15 | v0.1.0]
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Token {
  id: string;
  name: string;
  type: string;
  valueLight: string;
  valueDark: string;
  description: string;
  themeValues: Record<string, string>; // [PCODE-287 | S15 | v0.1.0]
}
export interface ContrastPair {
  foreground: string;
  background: string;
  mode: string;
  ratio: number;
  grade: string;
}
interface Component {
  id: string;
  name: string;
  status: string;
  description: string;
  codePath: string;
  designUrl: string;
  props: { name: string; type: string; default?: string }[];
  usageCount: number;
  usageFiles?: { path: string; count: number }[]; // [PCODE-290 | S15 | v0.1.0] from orq kit scan
  usageScannedAt?: string | null;
  previewHtml?: string; // [PCODE-291 | S15 | v0.1.0]
  previewCss?: string;
}
interface Mockup {
  id: string;
  title: string;
  itemId: string | null;
  itemRef: string | null;
  status: string;
  version: number;
  imageUrl: string | null;
  openPins: number;
  changedAfterStart: boolean;
  clientVisible?: boolean; // [PCODE-186 | S15 | v0.1.0] shared with the client for approval
}
interface MockupFull {
  mockup: Mockup;
  versions: {
    version: number;
    imageUrl: string;
    note: string;
    author: string | null;
    createdAt: string;
  }[];
  pins: {
    id: string;
    version: number;
    x: number;
    y: number;
    body: string;
    authorName: string | null;
    resolved: boolean;
    fromClient?: boolean; // [PCODE-294 | S15 | v0.1.0]
  }[];
  decisions: {
    decision: string;
    approver: string | null;
    note: string;
    version: number | null;
    at: string;
  }[];
}
interface Asset {
  id: string;
  name: string;
  kind: string;
  rights: string;
  licence: string;
  expiresOn: string | null;
  expired: boolean;
  expiringSoon: boolean;
  tags: string[];
  mime: string;
  sizeBytes: number;
  url: string;
  clientVisible?: boolean; // [PCODE-293 | S15 | v0.1.0]
  sizes?: number;
}

type View = 'tokens' | 'components' | 'mockups' | 'assets' | 'checks' | 'brand' | 'visual'; // [PCODE-295 | S15 | v0.1.0] visual
// [PCODE-289 | S15 | v0.1.0] brand

/** A colour a swatch can show: hex, rgb(), hsl(), oklch(); anything else shows no swatch. */
export const isColour = (v: string): boolean =>
  /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))$/i.test(v.trim());

export function Swatch(props: { value: string }): ReactNode {
  if (!isColour(props.value)) return <span className="v2-swatch-none" aria-hidden="true" />;
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="pv-swatch-svg">
      <rect
        x="0.5"
        y="0.5"
        width="21"
        height="21"
        rx="5"
        fill={props.value}
        className="pv-swatch-rect"
      />
    </svg>
  );
}

const VIEWS: View[] = ['mockups', 'brand', 'tokens', 'components', 'assets', 'checks', 'visual'];

export function UiKitPage(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  canEdit: boolean;
  go: (p: string) => void;
}): ReactNode {
  // [PCODE-295 | S15 | v0.1.0] a link may open a view (orq visual check links to ?view=visual)
  const [view, setView] = useState<View>(() => {
    const asked = new URLSearchParams(window.location.search).get('view');
    return VIEWS.includes(asked as View) ? (asked as View) : 'mockups';
  });
  const views: { key: View; label: string; icon: PIconName }[] = [
    { key: 'mockups', label: 'Mockups', icon: 'review' },
    { key: 'brand', label: 'Brand', icon: 'sparkle' }, // [PCODE-289 | S15 | v0.1.0]
    { key: 'tokens', label: 'Tokens', icon: 'codemap' },
    { key: 'components', label: 'Components', icon: 'overview' },
    { key: 'assets', label: 'Assets', icon: 'documents' },
    { key: 'checks', label: 'Checks', icon: 'check' },
    { key: 'visual', label: 'Visual', icon: 'test' }, // [PCODE-295 | S15 | v0.1.0]
  ];
  const base = {
    workspaceId: props.workspaceId,
    projectId: props.projectId,
    canEdit: props.canEdit,
  };
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="UI kit view">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            className="pv-subtab"
            aria-pressed={view === v.key}
            onClick={() => {
              setView(v.key);
            }}
          >
            <PIcon name={v.icon} size={14} />
            {v.label}
          </button>
        ))}
      </nav>
      {view === 'brand' ? <BrandBook {...base} /> : null}
      {view === 'tokens' ? <Tokens {...base} /> : null}
      {view === 'components' ? <Components {...base} /> : null}
      {view === 'mockups' ? <Mockups {...base} hub={props.hub} go={props.go} /> : null}
      {view === 'assets' ? <Assets {...base} /> : null}
      {view === 'visual' ? <VisualChecks {...base} /> : null}
      {view === 'checks' ? (
        <Checks workspaceId={props.workspaceId} projectId={props.projectId} />
      ) : null}
    </div>
  );
}

const TOKEN_TYPES = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'duration',
  'shadow',
  'number',
];

function Tokens(props: { workspaceId: string; projectId: string; canEdit: boolean }): ReactNode {
  const base = W(props.workspaceId, '/projects/' + props.projectId);
  const P = base + '/tokens';
  const [tokens, setTokens] = useState<Token[] | null>(null);
  // [PCODE-287 | S15 | v0.1.0] themes beyond light and dark, and aliases that lead nowhere
  const [themes, setThemes] = useState<Theme[]>([]);
  const [problems, setProblems] = useState<AliasProblem[]>([]);
  const [form, setForm] = useState({
    name: '',
    type: 'color',
    valueLight: '',
    valueDark: '',
    description: '',
  });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ tokens: Token[]; themes: Theme[]; aliasProblems: AliasProblem[] }>(
      'GET',
      P,
    );
    if (r.ok) {
      setTokens(r.data.tokens);
      setThemes(r.data.themes);
      setProblems(r.data.aliasProblems);
    }
  }, [P]);
  const read = tokenResolver(
    (tokens ?? []).map((t) => ({ ...t, themes: t.themeValues })),
    themes.map((t) => ({ name: t.name, base: t.base === 'dark' ? 'dark' : 'light' })),
  );
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (t: {
    name: string;
    type: string;
    valueLight: string;
    valueDark: string;
    description: string;
    themeValues?: Record<string, string>;
  }): Promise<boolean> => {
    const r = await api('PUT', P + '/' + encodeURIComponent(t.name), {
      type: t.type,
      valueLight: t.valueLight,
      valueDark: t.valueDark,
      description: t.description,
      themeValues: t.themeValues ?? {},
    });
    setError(r.ok ? '' : r.error.message);
    await load();
    return r.ok;
  };
  return (
    <div className="pv-stack">
      {/* [PCODE-297 | S15 | v0.1.0] the Figma file of the kit */}
      <FigmaSync
        workspaceId={props.workspaceId}
        projectId={props.projectId}
        canEdit={props.canEdit}
        onChanged={() => void load()}
      />
      <Card
        flush
        title={'Design tokens · ' + String(tokens?.length ?? 0)}
        action={
          <span className="v2-inline">
            <span className="pv-small pv-muted">Download as</span>
            {(
              [
                ['css', 'CSS'],
                ['tailwind', 'Tailwind'],
                ['ts', 'TypeScript'],
                ['w3c', 'W3C tokens'],
                ['ios', 'iOS (Swift)'],
                ['android', 'Android (ZIP)'],
              ] as const
            ).map(([f, l]) => (
              <a
                key={f}
                className="pv-btn pv-btn--sm pv-btn--ghost"
                href={P + '/export?format=' + f}
                download
              >
                {l}
              </a>
            ))}
          </span>
        }
      >
        <ThemeBar
          base={base}
          themes={themes}
          canEdit={props.canEdit}
          onChanged={() => void load()}
        />
        <table className="pv-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Type</th>
              <th>Light</th>
              <th>Dark</th>
              {themes.map((th) => (
                <th key={th.id}>{th.name}</th>
              ))}
              <th>Meaning</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(tokens ?? []).map((t) => (
              <TokenRow
                key={t.id}
                t={t}
                themes={themes}
                read={read}
                canEdit={props.canEdit}
                onSave={save}
                onRemove={() =>
                  void api('DELETE', P + '/' + encodeURIComponent(t.name)).then(() => load())
                }
              />
            ))}
            {tokens && !tokens.length ? (
              <tr>
                <td colSpan={6 + themes.length} className="pv-muted">
                  No tokens yet. Start with color.primary, color.text, color.bg and space.4.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <AliasWarnings problems={problems} />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {props.canEdit ? (
        <div className="v2-inline v2-token-actions">
          <ImportTokens base={base} onDone={() => void load()} />
          {/* [PCODE-288 | S15 | v0.1.0] */}
          <TokenPullRequest base={base} />
        </div>
      ) : null}
      {props.canEdit ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim() && form.valueLight.trim())
              void save({ ...form, name: form.name.trim() }).then((ok) => {
                if (ok)
                  setForm({
                    name: '',
                    type: form.type,
                    valueLight: '',
                    valueDark: '',
                    description: '',
                  });
              });
          }}
        >
          <input
            className="v2-input v2-mono"
            aria-label="Token name"
            placeholder="color.primary"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
            }}
          />
          <select
            className="v2-input"
            aria-label="Type"
            value={form.type}
            onChange={(e) => {
              setForm({ ...form, type: e.target.value });
            }}
          >
            {TOKEN_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input
            className="v2-input v2-mono"
            aria-label="Light value"
            placeholder="light: #4f46e5 or {color.blue.500}"
            value={form.valueLight}
            onChange={(e) => {
              setForm({ ...form, valueLight: e.target.value });
            }}
          />
          <input
            className="v2-input v2-mono"
            aria-label="Dark value"
            placeholder="dark (optional)"
            value={form.valueDark}
            onChange={(e) => {
              setForm({ ...form, valueDark: e.target.value });
            }}
          />
          <input
            className="v2-input v2-grow"
            aria-label="Meaning"
            placeholder="What it is for"
            value={form.description}
            onChange={(e) => {
              setForm({ ...form, description: e.target.value });
            }}
          />
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!form.name.trim() || !form.valueLight.trim()}
          >
            Add
          </button>
        </form>
      ) : null}
    </div>
  );
}

function TokenRow(props: {
  t: Token;
  themes: Theme[]; // [PCODE-287 | S15 | v0.1.0]
  read: (name: string, mode: string) => string | null;
  canEdit: boolean;
  onSave: (t: Token) => Promise<boolean>;
  onRemove: () => void;
}): ReactNode {
  const [edit, setEdit] = useState<Token | null>(null);
  const t = props.t;
  // [PCODE-287 | S15 | v0.1.0] a value as written, with the swatch of what it finally is (aliases followed)
  const shown = (mode: string, own: string): ReactNode => (
    <span className="v2-inline">
      {t.type === 'color' ? <Swatch value={props.read(t.name, mode) ?? ''} /> : null}
      <span className="pv-mono pv-small">{own}</span>
    </span>
  );
  // an alias can change a mode the token itself does not set
  const differs = (mode: string, from: string): boolean =>
    props.read(t.name, mode) !== props.read(t.name, from);
  if (edit)
    return (
      <tr>
        <td className="pv-mono">{t.name}</td>
        <td>{t.type}</td>
        <td>
          <input
            className="v2-input v2-input--sm v2-mono"
            aria-label="Light value"
            value={edit.valueLight}
            onChange={(e) => {
              setEdit({ ...edit, valueLight: e.target.value });
            }}
          />
        </td>
        <td>
          <input
            className="v2-input v2-input--sm v2-mono"
            aria-label="Dark value"
            value={edit.valueDark}
            onChange={(e) => {
              setEdit({ ...edit, valueDark: e.target.value });
            }}
          />
        </td>
        {props.themes.map((th) => (
          <td key={th.id}>
            <input
              className="v2-input v2-input--sm v2-mono"
              aria-label={th.name + ' value'}
              placeholder={'as ' + th.base}
              value={edit.themeValues[th.name] ?? ''}
              onChange={(e) => {
                setEdit({
                  ...edit,
                  themeValues: { ...edit.themeValues, [th.name]: e.target.value },
                });
              }}
            />
          </td>
        ))}
        <td>
          <input
            className="v2-input v2-input--sm"
            aria-label="Meaning"
            value={edit.description}
            onChange={(e) => {
              setEdit({ ...edit, description: e.target.value });
            }}
          />
        </td>
        <td>
          <span className="v2-inline">
            <Button
              size="sm"
              kind="primary"
              onClick={() =>
                void props.onSave(edit).then((ok) => {
                  if (ok) setEdit(null);
                })
              }
            >
              Save
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setEdit(null);
              }}
            >
              Cancel
            </Button>
          </span>
        </td>
      </tr>
    );
  return (
    <tr>
      <td className="pv-mono">{t.name}</td>
      <td className="pv-small pv-muted">{t.type}</td>
      <td>{shown('light', t.valueLight)}</td>
      <td>
        {t.valueDark ? (
          shown('dark', t.valueDark)
        ) : differs('dark', 'light') ? (
          shown('dark', 'via the alias')
        ) : (
          <span className="pv-muted pv-small">same</span>
        )}
      </td>
      {props.themes.map((th) => (
        <td key={th.id}>
          {t.themeValues[th.name] ? (
            shown(th.name, t.themeValues[th.name] ?? '')
          ) : differs(th.name, th.base) ? (
            shown(th.name, 'via the alias')
          ) : (
            <span className="pv-muted pv-small">as {th.base}</span>
          )}
        </td>
      ))}
      <td className="pv-small">{t.description}</td>
      <td>
        {props.canEdit ? (
          <span className="v2-inline">
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setEdit(t);
              }}
            >
              Change
            </Button>
            <button
              type="button"
              className="pv-mini-btn"
              aria-label={'Remove ' + t.name}
              onClick={props.onRemove}
            >
              ×
            </button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function Components(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
}): ReactNode {
  const P = W(props.workspaceId, '/projects/' + props.projectId + '/components');
  const [list, setList] = useState<Component[] | null>(null);
  const [form, setForm] = useState({ name: '', codePath: '', designUrl: '', description: '' });
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState<string | null>(null); // [PCODE-291 | S15 | v0.1.0]
  const load = useCallback(async () => {
    const r = await api<Component[]>('GET', P);
    if (r.ok) setList(r.data);
  }, [P]);
  useEffect(() => {
    void load();
  }, [load]);
  const change = async (id: string, body: Record<string, unknown>): Promise<void> => {
    const r = await api('PATCH', W(props.workspaceId, '/components/' + id), body);
    setError(r.ok ? '' : r.error.message);
    await load();
  };
  const tone = (s: string): 'success' | 'info' | 'neutral' =>
    s === 'in_code' ? 'success' : s === 'design' ? 'info' : 'neutral';
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        {(['design', 'in_code', 'deprecated'] as const).map((s) => (
          <div key={s} className="pv-stat">
            <div className="pv-stat-label">
              {s === 'in_code' ? 'In code' : s === 'design' ? 'Design only' : 'Deprecated'}
            </div>
            <div className="pv-stat-value">{(list ?? []).filter((c) => c.status === s).length}</div>
          </div>
        ))}
      </div>
      <Card flush title="Component inventory">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Status</th>
              <th>In the code</th>
              <th>Props</th>
              <th className="pv-num">Used</th>
            </tr>
          </thead>
          <tbody>
            {(list ?? []).map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <td>
                    <strong>{c.name}</strong>{' '}
                    {/* [PCODE-291 | S15 | v0.1.0] the live preview under the row */}
                    <button
                      type="button"
                      className="pv-link pv-small v2-kit-file v2-preview-toggle"
                      aria-expanded={previewing === c.id}
                      onClick={() => {
                        setPreviewing(previewing === c.id ? null : c.id);
                      }}
                    >
                      {previewing === c.id ? 'Hide the preview' : 'Preview'}
                    </button>
                    {c.description ? (
                      <span className="pv-row-sub pv-wrap">{c.description}</span>
                    ) : null}
                    {c.designUrl ? (
                      <a
                        className="pv-link pv-small"
                        href={c.designUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {/* [PCODE-297 | S15 | v0.1.0] */}
                        {c.designUrl.includes('figma.com') ? 'Figma' : 'design'}
                      </a>
                    ) : null}
                  </td>
                  <td>
                    {props.canEdit ? (
                      <select
                        className="v2-input v2-input--sm"
                        aria-label={'Status of ' + c.name}
                        value={c.status}
                        onChange={(e) => void change(c.id, { status: e.target.value })}
                      >
                        <option value="design">design only</option>
                        <option value="in_code">in code</option>
                        <option value="deprecated">deprecated</option>
                      </select>
                    ) : (
                      <Chip tone={tone(c.status)}>{c.status.replace('_', ' ')}</Chip>
                    )}
                  </td>
                  <td className="pv-mono pv-small">{c.codePath || '—'}</td>
                  <td className="pv-small">{c.props.map((p) => p.name).join(', ') || '—'}</td>
                  <td
                    className="pv-num"
                    title={
                      c.usageScannedAt
                        ? 'Counted in the code ' +
                          new Date(c.usageScannedAt).toLocaleDateString() +
                          (c.usageFiles?.length
                            ? ': ' +
                              c.usageFiles.map((f) => f.path + ' ' + String(f.count)).join(', ')
                            : '')
                        : 'Typed in by hand; orq kit scan counts it in the code'
                    }
                  >
                    {c.usageCount}
                  </td>
                </tr>
                {previewing === c.id ? (
                  <tr>
                    <td colSpan={5}>
                      <ComponentPreview
                        workspaceId={props.workspaceId}
                        projectId={props.projectId}
                        component={c}
                        canEdit={props.canEdit}
                        onSaved={() => void load()}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {list && !list.length ? (
              <tr>
                <td colSpan={5} className="pv-muted">
                  No components yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {props.canEdit ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            void api('POST', P, {
              name: form.name.trim(),
              ...(form.codePath.trim()
                ? { codePath: form.codePath.trim(), status: 'in_code' }
                : {}),
              ...(form.designUrl.trim() ? { designUrl: form.designUrl.trim() } : {}),
              ...(form.description.trim() ? { description: form.description.trim() } : {}),
            }).then(async (r) => {
              setError(r.ok ? '' : r.error.message);
              if (r.ok) setForm({ name: '', codePath: '', designUrl: '', description: '' });
              await load();
            });
          }}
        >
          <input
            className="v2-input"
            aria-label="Component name"
            placeholder="Button"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
            }}
          />
          <input
            className="v2-input v2-mono"
            aria-label="Code path"
            placeholder="src/ui/Button.tsx"
            value={form.codePath}
            onChange={(e) => {
              setForm({ ...form, codePath: e.target.value });
            }}
          />
          <input
            className="v2-input"
            aria-label="Design link"
            placeholder="https://… (design file)"
            value={form.designUrl}
            onChange={(e) => {
              setForm({ ...form, designUrl: e.target.value });
            }}
          />
          <input
            className="v2-input v2-grow"
            aria-label="What it is for"
            placeholder="What it is for"
            value={form.description}
            onChange={(e) => {
              setForm({ ...form, description: e.target.value });
            }}
          />
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!form.name.trim()}
          >
            Add
          </button>
        </form>
      ) : null}
    </div>
  );
}

const MOCK_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  approved: 'success',
  in_review: 'warning',
  changes_requested: 'danger',
  draft: 'neutral',
};

function Mockups(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const P = W(props.workspaceId, '/projects/' + props.projectId + '/mockups');
  const [list, setList] = useState<Mockup[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<Mockup[]>('GET', P);
    if (r.ok) setList(r.data);
  }, [P]);
  useEffect(() => {
    void load();
  }, [load]);
  const current = list?.find((m) => m.id === sel) ?? list?.[0] ?? null;
  return (
    <div className="pv-mock v2-mock">
      <aside className="pv-stack">
        {props.canEdit ? (
          <Button
            size="sm"
            kind="primary"
            icon="plus"
            onClick={() => {
              setAdding((a) => !a);
            }}
          >
            New mockup
          </Button>
        ) : null}
        {adding ? (
          <NewMockup
            workspaceId={props.workspaceId}
            projectId={props.projectId}
            onDone={(id) => {
              setAdding(false);
              void load();
              if (id) setSel(id);
            }}
            onError={setError}
          />
        ) : null}
        {(list ?? []).map((m) => (
          <button
            key={m.id}
            type="button"
            className="pv-mock-thumb"
            aria-current={m.id === current?.id ? 'true' : undefined}
            onClick={() => {
              setSel(m.id);
            }}
          >
            {m.imageUrl ? <img src={m.imageUrl} alt="" className="v2-thumb" /> : null}
            <span className="pv-idea-top">
              <strong>{m.title}</strong>
              <Chip tone={MOCK_TONE[m.status] ?? 'neutral'}>{m.status.replace('_', ' ')}</Chip>
            </span>
            <span className="pv-muted pv-small">
              v{m.version}
              {m.itemRef ? ' · ' + m.itemRef : ''}
              {m.openPins ? ' · ' + String(m.openPins) + ' open' : ''}
            </span>
          </button>
        ))}
        {list && !list.length && !adding ? (
          <p className="pv-muted pv-small">No mockups yet.</p>
        ) : null}
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
      </aside>
      {current ? (
        <MockupView
          key={current.id}
          workspaceId={props.workspaceId}
          projectId={props.projectId}
          id={current.id}
          canEdit={props.canEdit}
          go={props.go}
          onChanged={() => void load()}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function NewMockup(props: {
  workspaceId: string;
  projectId: string;
  onDone: (id: string | null) => void;
  onError: (m: string) => void;
}): ReactNode {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [tasks, setTasks] = useState<{ id: string; ref: string; title: string }[]>([]);
  const [item, setItem] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ id: string; ref: string; title: string }[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/items'),
    ).then((r) => {
      if (r.ok) setTasks(r.data.slice(0, 300));
    });
  }, [props.workspaceId, props.projectId]);
  return (
    <form
      className="v2-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !file) return;
        setBusy(true);
        void uploadFile(props.workspaceId, props.projectId, file).then(async (up) => {
          if (!up.ok) {
            props.onError(up.error.message);
            setBusy(false);
            return;
          }
          const r = await api<{ id: string }>(
            'POST',
            W(props.workspaceId, '/projects/' + props.projectId + '/mockups'),
            { title: title.trim(), fileId: up.data.id, ...(item ? { itemId: item } : {}) },
          );
          setBusy(false);
          if (!r.ok) props.onError(r.error.message);
          props.onDone(r.ok ? r.data.id : null);
        });
      }}
    >
      <input
        className="v2-input"
        aria-label="Mockup title"
        placeholder="Title, e.g. Tracking page"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="Image"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
        }}
      />
      <select
        className="v2-input"
        aria-label="For task"
        value={item}
        onChange={(e) => {
          setItem(e.target.value);
        }}
      >
        <option value="">Not for a task</option>
        {tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.ref} {t.title}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="pv-btn pv-btn--primary pv-btn--sm"
        disabled={busy || !title.trim() || !file}
      >
        {busy ? 'Uploading…' : 'Put up for review'}
      </button>
    </form>
  );
}

function MockupView(props: {
  workspaceId: string;
  projectId: string;
  id: string;
  canEdit: boolean;
  go: (p: string) => void;
  onChanged: () => void;
  onError: (m: string) => void;
}): ReactNode {
  const M = W(props.workspaceId, '/mockups/' + props.id);
  const [data, setData] = useState<MockupFull | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [compare, setCompare] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState<CompareMode>('side'); // [PCODE-294 | S15 | v0.1.0]
  const [draftPin, setDraftPin] = useState<{ x: number; y: number } | null>(null);
  const [pinText, setPinText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'review' | 'handoff'>('review'); // [PCODE-292 | S15 | v0.1.0]
  const load = useCallback(async () => {
    const r = await api<MockupFull>('GET', M);
    if (r.ok) setData(r.data);
  }, [M]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  const m = data.mockup;
  const v = version ?? m.version;
  const shown = data.versions.find((x) => x.version === v);
  const other = compare !== null ? data.versions.find((x) => x.version === compare) : undefined;
  const pins = data.pins.filter((p) => p.version === v);
  const act = async (method: 'POST' | 'PATCH', path: string, body: unknown): Promise<boolean> => {
    const r = await api(method, W(props.workspaceId, path), body);
    if (!r.ok) props.onError(r.error.message);
    await load();
    props.onChanged();
    return r.ok;
  };
  // [PCODE-292 | S15 | v0.1.0] review and handoff of the version shown
  const modes = (
    <div className="v2-inline v2-mockup-modes" role="group" aria-label="Mockup view">
      {(['review', 'handoff'] as const).map((x) => (
        <button
          key={x}
          type="button"
          className="pv-subtab"
          aria-pressed={mode === x}
          onClick={() => {
            setMode(x);
            setDraftPin(null);
          }}
        >
          {x === 'review' ? 'Review' : 'Handoff'}
        </button>
      ))}
    </div>
  );
  if (mode === 'handoff' && shown)
    return (
      <Handoff
        key={v}
        workspaceId={props.workspaceId}
        projectId={props.projectId}
        mockupId={m.id}
        version={v}
        imageUrl={shown.imageUrl}
        canEdit={props.canEdit}
        onError={props.onError}
        title={m.title} // [PCODE-293 | S15 | v0.1.0]
        header={
          <div className="v2-inline">
            {modes}
            <select
              className="pv-select"
              aria-label="Version"
              value={v}
              onChange={(e) => {
                setVersion(Number(e.target.value));
              }}
            >
              {data.versions.map((x) => (
                <option key={x.version} value={x.version}>
                  {m.title} · v{x.version}
                  {x.version === m.version ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>
        }
      />
    );
  return (
    <>
      <div className="pv-stack">
        {modes}
        {m.changedAfterStart ? (
          <div className="pv-callout pv-callout--warn">
            <PIcon name="incident" size={16} />
            <div>
              <strong>Design changed after work started.</strong> Version {m.version} arrived while{' '}
              {m.itemRef ?? 'its task'} was already in progress; the task’s history says so.
            </div>
          </div>
        ) : null}
        <Card
          title={m.title + ' · v' + String(v)}
          action={
            <span className="pv-page-actions">
              <select
                className="pv-select"
                aria-label="Version"
                value={v}
                onChange={(e) => {
                  setVersion(Number(e.target.value));
                  setDraftPin(null);
                }}
              >
                {data.versions.map((x) => (
                  <option key={x.version} value={x.version}>
                    v{x.version}
                    {x.version === m.version ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              {data.versions.length > 1 ? (
                <select
                  className="pv-select"
                  aria-label="Compare with"
                  value={compare ?? ''}
                  onChange={(e) => {
                    setCompare(e.target.value ? Number(e.target.value) : null);
                  }}
                >
                  <option value="">No compare</option>
                  {data.versions
                    .filter((x) => x.version !== v)
                    .map((x) => (
                      <option key={x.version} value={x.version}>
                        Compare with v{x.version}
                      </option>
                    ))}
                </select>
              ) : null}
              {/* [PCODE-294 | S15 | v0.1.0] how the two versions are shown */}
              {compare !== null ? (
                <select
                  className="pv-select"
                  aria-label="Compare how"
                  value={compareMode}
                  onChange={(e) => {
                    setCompareMode(e.target.value as CompareMode);
                  }}
                >
                  {COMPARE_MODES.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {m.itemId ? (
                <Button
                  size="sm"
                  kind="ghost"
                  icon="external"
                  onClick={() => {
                    props.go('/items/' + (m.itemId ?? ''));
                  }}
                >
                  {m.itemRef}
                </Button>
              ) : null}
            </span>
          }
        >
          {shown && other && compareMode !== 'side' ? (
            // [PCODE-294 | S15 | v0.1.0] the newer of the two on top
            <CompareImages
              mode={compareMode}
              base={
                other.version < v
                  ? { url: other.imageUrl, label: 'v' + String(other.version) }
                  : { url: shown.imageUrl, label: 'v' + String(v) }
              }
              top={
                other.version < v
                  ? { url: shown.imageUrl, label: 'v' + String(v) }
                  : { url: other.imageUrl, label: 'v' + String(other.version) }
              }
            />
          ) : shown ? (
            <div className={other ? 'v2-compare' : undefined}>
              <PinnedImage
                url={shown.imageUrl}
                pins={pins}
                draft={draftPin}
                onPlace={props.canEdit ? setDraftPin : null}
                label={'Version ' + String(v)}
              />
              {other ? (
                <PinnedImage
                  url={other.imageUrl}
                  pins={data.pins.filter((p) => p.version === other.version)}
                  draft={null}
                  onPlace={null}
                  label={'Version ' + String(other.version)}
                />
              ) : null}
            </div>
          ) : null}
          {props.canEdit && !other ? (
            <p className="pv-small pv-muted">Click on the image to pin a comment to that spot.</p>
          ) : null}
          {draftPin ? (
            <form
              className="v2-inline"
              onSubmit={(e) => {
                e.preventDefault();
                if (pinText.trim())
                  void act('POST', '/mockups/' + m.id + '/pins', {
                    x: draftPin.x,
                    y: draftPin.y,
                    body: pinText.trim(),
                  }).then((ok) => {
                    if (ok) {
                      setDraftPin(null);
                      setPinText('');
                    }
                  });
              }}
            >
              <input
                className="v2-input v2-grow"
                aria-label="Pinned comment"
                placeholder="What about this spot?"
                value={pinText}
                onChange={(e) => {
                  setPinText(e.target.value);
                }}
              />
              <button
                type="submit"
                className="pv-btn pv-btn--primary pv-btn--sm"
                disabled={!pinText.trim()}
              >
                Pin
              </button>
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  setDraftPin(null);
                }}
              >
                Cancel
              </Button>
            </form>
          ) : null}
        </Card>
      </div>
      <aside className="pv-stack">
        <Card title="Review">
          <Chip tone={MOCK_TONE[m.status] ?? 'neutral'}>{m.status.replace('_', ' ')}</Chip>
          {/* [PCODE-186 | S15 | v0.1.0] the client's approver decides in their portal, with a signature */}
          {props.canEdit && m.version ? (
            <Button
              size="sm"
              kind="ghost"
              icon="clients"
              onClick={() =>
                void api('PUT', W(props.workspaceId, '/mockups/' + m.id + '/client'), {
                  shared: !m.clientVisible,
                }).then(async (r) => {
                  if (!r.ok) props.onError(r.error.message);
                  await load();
                  props.onChanged();
                })
              }
            >
              {m.clientVisible
                ? 'Shared with the client · stop'
                : 'Share with the client for approval'}
            </Button>
          ) : null}
          {props.canEdit && v === m.version ? (
            <div className="v2-form v2-mt">
              <textarea
                className="v2-input"
                rows={2}
                aria-label="Note"
                placeholder="Note (required when asking for changes)"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
              <span className="v2-inline">
                <Button
                  size="sm"
                  kind="primary"
                  icon="check"
                  onClick={() =>
                    void act('POST', '/mockups/' + m.id + '/decision', {
                      approve: true,
                      ...(note.trim() ? { note: note.trim() } : {}),
                    }).then(() => {
                      setNote('');
                    })
                  }
                >
                  Approve v{m.version}
                </Button>
                <Button
                  size="sm"
                  kind="ghost"
                  disabled={!note.trim()}
                  onClick={() =>
                    void act('POST', '/mockups/' + m.id + '/decision', {
                      approve: false,
                      note: note.trim(),
                    }).then(() => {
                      setNote('');
                    })
                  }
                >
                  Ask for changes
                </Button>
              </span>
              <label className="v2-field">
                <span>Upload a new version</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setBusy(true);
                    void uploadFile(props.workspaceId, props.projectId, f).then(async (up) => {
                      if (!up.ok) props.onError(up.error.message);
                      else
                        await act('POST', '/mockups/' + m.id + '/versions', { fileId: up.data.id });
                      setVersion(null);
                      setBusy(false);
                      e.target.value = '';
                    });
                  }}
                />
              </label>
            </div>
          ) : null}
          <ul className="pv-rows pv-rows--tight v2-mt">
            {data.decisions.map((d, i) => (
              <li key={i} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">
                    {d.decision === 'approved' ? 'Approved' : 'Changes asked'}{' '}
                    {d.version ? 'v' + String(d.version) : ''} by {d.approver ?? 'someone'}
                  </span>
                  {d.note ? <span className="pv-row-sub pv-wrap">{d.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={'Pinned comments on v' + String(v)}>
          <ol className="v2-pins">
            {pins.map((p, i) => (
              <li key={p.id} className={p.resolved ? 'v2-thread--done' : undefined}>
                <span className="v2-pin-num">{i + 1}</span>
                <span className="pv-small">
                  <strong>{p.authorName ?? 'Someone'}:</strong> {p.body}
                  {/* [PCODE-294 | S15 | v0.1.0] */}
                  {p.fromClient ? (
                    <>
                      {' '}
                      <Chip tone="info">client</Chip>
                    </>
                  ) : null}
                </span>
                {props.canEdit ? (
                  <button
                    type="button"
                    className="pv-link-btn pv-small" // [PCODE-294 | S15 | v0.1.0] a button, styled as a link
                    onClick={() =>
                      void act('PATCH', '/mockup-pins/' + p.id, { resolved: !p.resolved })
                    }
                  >
                    {p.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {!pins.length ? <p className="pv-muted pv-small">No pins on this version.</p> : null}
        </Card>
      </aside>
    </>
  );
}

/** The image in an SVG of its own size, with the pins numbered on top; a click gives the spot as shares. */
export function PinnedImage(props: {
  url: string;
  pins: { id: string; x: number; y: number; resolved: boolean }[];
  draft: { x: number; y: number } | null;
  onPlace: ((p: { x: number; y: number }) => void) | null;
  label: string;
}): ReactNode {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1600, h: 1000 });
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight)
        setSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = props.url;
  }, [props.url]);
  const r = Math.max(10, Math.round(size.w / 70));
  return (
    <figure className="v2-pinned">
      <svg
        ref={ref}
        viewBox={'0 0 ' + String(size.w) + ' ' + String(size.h)}
        className={'v2-pinned-svg' + (props.onPlace ? ' v2-pinned-svg--place' : '')}
        role="img"
        aria-label={props.label}
        onClick={(e) => {
          if (!props.onPlace || !ref.current) return;
          const box = ref.current.getBoundingClientRect();
          const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
          const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
          props.onPlace({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
        }}
      >
        <image href={props.url} x="0" y="0" width={size.w} height={size.h} />
        {props.pins.map((p, i) => (
          <g key={p.id} className={'v2-pin' + (p.resolved ? ' v2-pin--done' : '')}>
            <circle cx={p.x * size.w} cy={p.y * size.h} r={r} />
            <text
              x={p.x * size.w}
              y={p.y * size.h}
              dy="0.35em"
              textAnchor="middle"
              fontSize={r * 1.1}
            >
              {i + 1}
            </text>
          </g>
        ))}
        {props.draft ? (
          <circle
            className="v2-pin-draft"
            cx={props.draft.x * size.w}
            cy={props.draft.y * size.h}
            r={r}
          />
        ) : null}
      </svg>
      <figcaption className="pv-small pv-muted">{props.label}</figcaption>
    </figure>
  );
}

function Assets(props: { workspaceId: string; projectId: string; canEdit: boolean }): ReactNode {
  const P = W(props.workspaceId, '/projects/' + props.projectId + '/assets');
  const [list, setList] = useState<Asset[] | null>(null);
  const [form, setForm] = useState({ kind: 'logo', rights: '', licence: '', expiresOn: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null); // [PCODE-293 | S15 | v0.1.0] the asset whose sizes show
  const load = useCallback(async () => {
    const r = await api<Asset[]>('GET', P);
    if (r.ok) setList(r.data);
  }, [P]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="pv-stack">
      <div className="v2-assets">
        {(list ?? []).map((a) => (
          <Card key={a.id}>
            <div className="v2-asset">
              {a.mime.startsWith('image/') && !a.mime.includes('svg') ? (
                <img src={a.url} alt={a.name} className="v2-asset-img" />
              ) : (
                <PIcon name="documents" size={28} />
              )}
              <strong>{a.name}</strong>
              <span className="v2-inline">
                <Chip>{a.kind}</Chip>
                {a.expired ? (
                  <Chip tone="danger">expired {a.expiresOn}</Chip>
                ) : a.expiringSoon ? (
                  <Chip tone="warning">expires {a.expiresOn}</Chip>
                ) : a.expiresOn ? (
                  <Chip>until {a.expiresOn}</Chip>
                ) : null}
              </span>
              <span className="pv-small pv-muted">
                {a.licence || 'no licence noted'} · {sizeText(a.sizeBytes)}
              </span>
              {a.rights ? <span className="pv-small pv-wrap">{a.rights}</span> : null}
              {/* [PCODE-293 | S15 | v0.1.0] its sizes, the ZIP and the client portal */}
              <span className="v2-inline">
                <a className="pv-link pv-small" href={a.url} download={a.name}>
                  Download
                </a>
                <button
                  type="button"
                  className="pv-link-btn pv-small"
                  aria-expanded={open === a.id}
                  onClick={() => {
                    setOpen(open === a.id ? null : a.id);
                  }}
                >
                  Sizes{a.sizes ? ' (' + String(a.sizes) + ')' : ''}
                </button>
                {a.clientVisible ? <Chip tone="info">in the client portal</Chip> : null}
              </span>
            </div>
          </Card>
        ))}
        {list && !list.length ? (
          <p className="pv-muted">
            No assets yet: logos, icons, images and fonts with their usage rights.
          </p>
        ) : null}
      </div>
      {/* [PCODE-293 | S15 | v0.1.0] the open asset's sizes, the width of the page */}
      {(list ?? [])
        .filter((a) => a.id === open)
        .map((a) => (
          <Card key={a.id} title={'Sizes of ' + a.name}>
            <AssetSizes
              workspaceId={props.workspaceId}
              projectId={props.projectId}
              asset={a}
              canEdit={props.canEdit}
              onChanged={() => void load()}
            />
          </Card>
        ))}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {props.canEdit ? (
        <Card title="Add an asset">
          <div className="v2-inline">
            <select
              className="v2-input"
              aria-label="Kind"
              value={form.kind}
              onChange={(e) => {
                setForm({ ...form, kind: e.target.value });
              }}
            >
              {['logo', 'icon', 'image', 'font', 'video', 'other'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <input
              className="v2-input"
              aria-label="Licence"
              placeholder="Licence, e.g. Own work, CC BY 4.0"
              value={form.licence}
              onChange={(e) => {
                setForm({ ...form, licence: e.target.value });
              }}
            />
            <input
              className="v2-input v2-grow"
              aria-label="Rights"
              placeholder="Where it may be used"
              value={form.rights}
              onChange={(e) => {
                setForm({ ...form, rights: e.target.value });
              }}
            />
            <label className="v2-field">
              <span>Expires</span>
              <input
                type="date"
                className="v2-input"
                value={form.expiresOn}
                onChange={(e) => {
                  setForm({ ...form, expiresOn: e.target.value });
                }}
              />
            </label>
            <input
              type="file"
              aria-label="File"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy(true);
                void uploadFile(props.workspaceId, props.projectId, f).then(async (up) => {
                  if (!up.ok) setError(up.error.message);
                  else {
                    const r = await api('POST', P, {
                      fileId: up.data.id,
                      kind: form.kind,
                      licence: form.licence.trim(),
                      rights: form.rights.trim(),
                      ...(form.expiresOn ? { expiresOn: form.expiresOn } : {}),
                    });
                    setError(r.ok ? '' : r.error.message);
                  }
                  setBusy(false);
                  e.target.value = '';
                  await load();
                });
              }}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export const gradeTone = (g: string): 'success' | 'warning' | 'danger' =>
  g === 'AAA' || g === 'AA' ? 'success' : g === 'AA large' ? 'warning' : 'danger';

function Checks(props: { workspaceId: string; projectId: string }): ReactNode {
  const [pairs, setPairs] = useState<ContrastPair[] | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  useEffect(() => {
    void api<{ tokens: Token[]; contrast: ContrastPair[]; themes: Theme[] }>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/tokens'),
    ).then((r) => {
      if (r.ok) {
        setPairs(r.data.contrast);
        setTokens(r.data.tokens);
        setThemes(r.data.themes);
      }
    });
  }, [props.workspaceId, props.projectId]);
  // [PCODE-290 | S15 | v0.1.0] the swatch shows the final value: aliases followed, themes on their base
  const [themes, setThemes] = useState<Theme[]>([]);
  const read = tokenResolver(
    tokens.map((t) => ({ ...t, themes: t.themeValues })),
    themes.map((t) => ({ name: t.name, base: t.base === 'dark' ? 'dark' : 'light' })),
  );
  const value = (name: string, mode: string): string => read(name, mode) ?? '';
  const failing = (pairs ?? []).filter((p) => p.grade === 'fail').length;
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <div className="pv-stat">
          <div className="pv-stat-label">Colour pairs checked</div>
          <div className="pv-stat-value">{pairs?.length ?? '…'}</div>
        </div>
        <div className="pv-stat">
          <div className="pv-stat-label">Below AA large (3:1)</div>
          <div className={'pv-stat-value' + (failing ? ' pv-text-danger' : '')}>
            {pairs ? failing : '…'}
          </div>
        </div>
      </div>
      <Card flush title="Contrast of text on backgrounds (WCAG)">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Text</th>
              <th>Background</th>
              <th>Mode</th>
              <th className="pv-num">Ratio</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {(pairs ?? []).map((p) => (
              <tr key={p.foreground + p.background + p.mode}>
                <td>
                  <span className="v2-inline">
                    <Swatch value={value(p.foreground, p.mode)} />
                    <span className="pv-mono pv-small">{p.foreground}</span>
                  </span>
                </td>
                <td>
                  <span className="v2-inline">
                    <Swatch value={value(p.background, p.mode)} />
                    <span className="pv-mono pv-small">{p.background}</span>
                  </span>
                </td>
                <td className="pv-small">{p.mode}</td>
                <td className="pv-num">{p.ratio.toLocaleString(fmtLocale())} : 1</td>
                <td>
                  <Chip tone={gradeTone(p.grade)}>{p.grade}</Chip>
                </td>
              </tr>
            ))}
            {pairs && !pairs.length ? (
              <tr>
                <td colSpan={5} className="pv-muted">
                  Name text colours color.text… and backgrounds color.bg… (or surface, primary) to
                  have them checked.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="pv-muted pv-small pv-pad">
          AA needs 4.5 : 1 for body text and 3 : 1 for large text and interface parts; AAA needs 7 :
          1.
        </p>
      </Card>
      <KitFindings workspaceId={props.workspaceId} projectId={props.projectId} />
      {/* [PCODE-296 | S15 | v0.1.0] */}
      <A11yFindings workspaceId={props.workspaceId} projectId={props.projectId} />
    </div>
  );
}
