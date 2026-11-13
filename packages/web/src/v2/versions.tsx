// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-336 | S15 | v0.1.0] T34.1a Portal home with health, milestone, release and budget; release deliverables and demos; client sign-off per release; files on acceptance results ──
// ── [PCODE-307 | S15 | v0.1.0] T31.7 Environment config diff: variables, secrets, settings, flags and versions side by side ──
// ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
// ── [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files ──
// ── [PCODE-206 | S15 | v0.1.0] T17.4 Release management in the web app: trains, environments with promote and rollback, notes approval, backport, go/no-go notes, changelog ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-178 | S15 | v0.1.0] B4.4 Versions tab and Releases page live in the web app: pull requests, releases with go/no-go, notes, flags, DORA, overview ──
//    Why:  the Versions tab and the Releases page of the approved design on the server's versions. Pull
//          requests show what a reviewer needs before opening them and warn when a change has no task. A
//          release is a go/no-go decision over its contents (tasks, tests, findings, the release policies),
//          with notes for the team and for the client; shipping runs the policy gate, and only an admin
//          ships past it, with the reason on record. Flags show where they are on; DORA measures delivery.
import { isEventOf } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Button, Card, Chip, PageHead, Stat } from '../preview/ui.js';
import { ago } from './inbox.js';
import { Markdown } from './markdown.js';
import { ReleaseDeliverables } from './deliverables.js'; // [PCODE-336 | S15 | v0.1.0]
// [PCODE-206 | S15 | v0.1.0] environments, trains and the release extras
import { Pipeline, ReleaseExtras, Trains } from './releasing.js';
import { VersionPlans } from './versionplan.js'; // [PCODE-306 | S15 | v0.1.0]
import { EnvConfig } from './envconfig.js'; // [PCODE-307 | S15 | v0.1.0]
// [PCODE-302 | S15 | v0.1.0] the review queue and the pull request's files
import { checksTone, ReviewQueue } from './prreview.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info' | 'primary';

export interface Pull {
  id: string;
  number: number;
  title: string;
  url: string;
  author: string;
  branch: string;
  base: string;
  repo: string;
  state: string;
  draft: boolean;
  additions: number;
  deletions: number;
  size: string;
  reviewState: string;
  checksState: string;
  itemId: string | null;
  itemRef: string | null;
  stale: boolean;
  noTask: boolean;
  openedAt: string;
}
export interface Release {
  id: string;
  version: string;
  name: string;
  component?: string; // [PCODE-306 | S15 | v0.1.0] empty for the project's own line
  train: string;
  hotfixOf: string | null;
  state: string;
  freezeAt: string | null;
  frozen: boolean;
  targetDate: string | null;
  notesTeam: string;
  notesClient: string;
  // [PCODE-206 | S15 | v0.1.0] the notes' approval
  notesApprovedBy?: string | null;
  notesApprovedAt?: string | null;
  notesByAgent?: boolean;
  environmentName: string | null;
  releasedBy: string | null;
  releasedAt: string | null;
  items: number;
  done: number;
}
interface Contents {
  release: Release;
  items: {
    id: string;
    ref: string;
    title: string;
    kind: string;
    stateGroup: string;
    breaking: boolean;
    tests: number;
    testsPassing: number;
    testsFailing: number;
    pullRequests: number;
  }[];
  tests: { cases: number; passing: number; failing: number; untested: number };
  findings: { critical: number; high: number; medium: number; low: number };
  flags: { key: string; enabled: Record<string, boolean> }[];
  suggested: string;
  previous: string | null;
}
interface PolicyCheck {
  passes: boolean;
  results: { policy: string; violations: string[] }[];
}

export const RELEASE_TONE: Record<string, Tone> = {
  planned: 'neutral',
  frozen: 'warning',
  released: 'success',
  rolled_back: 'danger',
};
export const stateText = (r: Pick<Release, 'state' | 'frozen'>): string =>
  r.state === 'rolled_back'
    ? 'rolled back'
    : r.state === 'planned' && r.frozen
      ? 'frozen'
      : r.state;

/** German date, as the workspace shows dates: 13.10.2026. */
export const dateText = (iso: string | null): string =>
  iso
    ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString(fmtLocale())
    : '—';

/** The go/no-go list of a release: what holds and what does not. */
export function goNoGo(
  c: Contents,
  policy: PolicyCheck | null,
): { label: string; ok: boolean; detail: string }[] {
  const open = c.items.filter(
    (i) => i.stateGroup !== 'completed' && i.stateGroup !== 'cancelled',
  ).length;
  const serious = c.findings.critical + c.findings.high;
  const out = [
    {
      label: 'All tasks done or moved out',
      ok: c.items.length > 0 && open === 0,
      detail: c.items.length
        ? String(c.items.length - open) + ' of ' + String(c.items.length) + ' done'
        : 'no tasks in the release',
    },
    {
      label: 'Tests',
      ok: c.tests.cases > 0 && c.tests.failing === 0 && c.tests.untested === 0,
      detail: !c.tests.cases
        ? 'no test covers these tasks'
        : String(c.tests.passing) +
          ' of ' +
          String(c.tests.cases) +
          ' passing' +
          (c.tests.failing ? ' · ' + String(c.tests.failing) + ' failing' : '') +
          (c.tests.untested ? ' · ' + String(c.tests.untested) + ' not run' : ''),
    },
    {
      label: 'Security',
      ok: serious === 0,
      detail: String(c.findings.critical) + ' critical, ' + String(c.findings.high) + ' high open',
    },
    // [PCODE-206 | S15 | v0.1.0] notes count once a person approved them
    {
      label: 'Release notes approved',
      ok:
        c.release.notesClient.trim().length > 0 &&
        c.release.notesTeam.trim().length > 0 &&
        Boolean(c.release.notesApprovedBy),
      detail: c.release.notesApprovedBy
        ? 'by ' + c.release.notesApprovedBy + ', ' + dateText(c.release.notesApprovedAt ?? null)
        : c.release.notesClient.trim()
          ? 'written, waiting for approval'
          : 'not written yet',
    },
  ];
  if (policy)
    out.push({
      label: 'Release policies',
      ok: policy.passes,
      detail: policy.results.length
        ? policy.results
            .filter((r) => r.violations.length)
            .map((r) => r.policy + ': ' + r.violations.join('; '))
            .join(' · ') || String(policy.results.length) + ' pass'
        : 'none set',
    });
  return out;
}

type View = 'prs' | 'review' | 'release' | 'flags' | 'dora' | 'environments'; // [PCODE-206 | S15 | v0.1.0] [PCODE-302 | S15 | v0.1.0] review

export function VersionsPage(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  canEdit: boolean;
  isAdmin: boolean;
  meId?: string; // [PCODE-206 | S15 | v0.1.0] the approver sees Approve on a waiting promotion
  go: (p: string) => void;
}): ReactNode {
  const [view, setView] = useState<View>('release');
  const views: { key: View; label: string; icon: PIconName }[] = [
    { key: 'release', label: 'Versions and releases', icon: 'releases' },
    { key: 'environments', label: 'Environments', icon: 'projects' }, // [PCODE-206 | S15 | v0.1.0]
    { key: 'review', label: 'Review', icon: 'review' }, // [PCODE-302 | S15 | v0.1.0]
    { key: 'prs', label: 'Pull requests', icon: 'git' },
    { key: 'flags', label: 'Feature flags', icon: 'flag' },
    { key: 'dora', label: 'Delivery metrics', icon: 'insights' },
  ];
  const base = { workspaceId: props.workspaceId, projectId: props.projectId };
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="Versions view">
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
      {view === 'environments' ? (
        <>
          <Pipeline
            {...base}
            hub={props.hub}
            canEdit={props.canEdit}
            isAdmin={props.isAdmin}
            meId={props.meId ?? ''}
            go={props.go}
          />
          {/* [PCODE-307 | S15 | v0.1.0] the environments' configuration side by side */}
          <EnvConfig {...base} isAdmin={props.isAdmin} />
        </>
      ) : null}
      {view === 'release' ? (
        <Releases
          {...base}
          canEdit={props.canEdit}
          isAdmin={props.isAdmin}
          hub={props.hub}
          go={props.go}
        />
      ) : null}
      {view === 'review' ? <ReviewQueue {...base} /> : null}
      {view === 'prs' ? <PullRequests {...base} go={props.go} /> : null}
      {view === 'flags' ? <Flags {...base} canEdit={props.canEdit} /> : null}
      {view === 'dora' ? <Delivery {...base} /> : null}
    </div>
  );
}

// ── pull requests ──

function PullRequests(props: {
  workspaceId: string;
  projectId: string;
  go: (p: string) => void;
}): ReactNode {
  const [all, setAll] = useState(false);
  const [list, setList] = useState<Pull[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<Pull[]>(
      'GET',
      W(
        props.workspaceId,
        '/projects/' + props.projectId + '/pull-requests' + (all ? '?state=all' : ''),
      ),
    ).then((r) => {
      if (r.ok) setList(r.data);
      else setError(r.error.message);
    });
  }, [props.workspaceId, props.projectId, all]);
  if (!list) return <p className="pv-muted">{error ?? 'Loading pull requests…'}</p>;
  const open = list.filter((p) => p.state === 'open').length;
  return (
    <Card
      flush
      title={'Pull requests · ' + String(open) + ' open'}
      action={
        <label className="pv-switch">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => {
              setAll(e.target.checked);
            }}
          />
          <span>Show merged and closed</span>
        </label>
      }
    >
      {list.length ? (
        <ul className="pv-rows">
          {list.map((p) => (
            <li key={p.id} className="pv-row pv-row--static pv-pr">
              <span className="pv-row-main">
                <a className="pv-row-title pv-link" href={p.url} target="_blank" rel="noreferrer">
                  <span className="pv-mono pv-muted">#{p.number}</span> {p.title}
                </a>
                <span className="pv-row-sub">
                  <span className="pv-mono">{p.branch}</span> → {p.base} · {p.author} ·{' '}
                  {p.noTask ? (
                    <span className="pv-text-warning">no task linked</span>
                  ) : (
                    <button
                      type="button"
                      className="pv-link-btn"
                      onClick={() => {
                        props.go('/items/' + (p.itemId ?? ''));
                      }}
                    >
                      {p.itemRef}
                    </button>
                  )}{' '}
                  · opened {ago(p.openedAt)} ago
                </span>
              </span>
              <span className="pv-pr-size pv-mono pv-small" title={'Size ' + p.size}>
                <span className="pv-text-success">+{p.additions}</span>{' '}
                <span className="pv-text-danger">−{p.deletions}</span>
              </span>
              <Chip>{p.size}</Chip>
              {p.state !== 'open' ? (
                <Chip tone={p.state === 'merged' ? 'success' : 'neutral'}>{p.state}</Chip>
              ) : null}
              {p.draft ? <Chip>draft</Chip> : null}
              {/* [PCODE-302 | S15 | v0.1.0] the server says passing and failing, not passed and failed */}
              <Chip
                tone={checksTone(p.checksState)}
                icon={
                  p.checksState === 'passing'
                    ? 'check'
                    : p.checksState === 'failing'
                      ? 'x'
                      : 'clock'
                }
              >
                checks {p.checksState}
              </Chip>
              <Chip
                tone={
                  p.reviewState === 'approved'
                    ? 'success'
                    : p.reviewState === 'changes_requested'
                      ? 'danger'
                      : 'neutral'
                }
              >
                {p.reviewState.replace('_', ' ')}
              </Chip>
              {p.stale ? <Chip tone="warning">stale</Chip> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-empty">
          No pull requests yet. They come from the repository’s webhook (Repositories tab).
        </p>
      )}
    </Card>
  );
}

// ── releases ──

function Releases(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  isAdmin: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, projectId } = props;
  const [data, setData] = useState<{
    releases: Release[];
    lastReleased: string | null;
    suggested: string;
    unreleased: number;
  } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [target, setTarget] = useState('');
  const load = useCallback(async () => {
    const r = await api<NonNullable<typeof data>>(
      'GET',
      W(workspaceId, '/projects/' + projectId + '/releases'),
    );
    if (r.ok) setData(r.data);
    else setError(r.error.message);
  }, [workspaceId, projectId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.projectid === projectId && isEventOf(e.type, 'project')) void load();
    });
  }, [load, props.hub, projectId]);
  if (!data) return <p className="pv-muted">{error ?? 'Loading releases…'}</p>;
  const current =
    data.releases.find((r) => r.id === sel) ??
    data.releases.find((r) => r.state === 'planned' || r.state === 'frozen') ??
    data.releases[0] ??
    null;
  const create = async (): Promise<void> => {
    const r = await api<Release>('POST', W(workspaceId, '/projects/' + projectId + '/releases'), {
      ...(version.trim() ? { version: version.trim() } : {}),
      ...(target ? { targetDate: target } : {}),
    });
    if (!r.ok) setError(r.error.message);
    else {
      setVersion('');
      setTarget('');
      setSel(r.data.id);
      void load();
    }
  };
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {/* [PCODE-306 | S15 | v0.1.0] the versions the commits call for */}
      <VersionPlans
        workspaceId={workspaceId}
        projectId={projectId}
        canEdit={props.canEdit}
        isAdmin={props.isAdmin}
        planned={(id) => {
          setSel(id);
          void load();
        }}
      />
      {props.canEdit ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            className="v2-input v2-input--sm v2-mono"
            aria-label="Version"
            placeholder={data.suggested}
            value={version}
            onChange={(e) => {
              setVersion(e.target.value);
            }}
          />
          <input
            className="v2-input v2-input--sm"
            type="date"
            aria-label="Target date"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
            }}
          />
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
            Plan {version.trim() || data.suggested}
          </button>
          <span className="pv-muted pv-small">
            {data.unreleased} done task{data.unreleased === 1 ? '' : 's'} not in a release yet
            {data.lastReleased ? ' · in production: ' + data.lastReleased : ''}
          </span>
        </form>
      ) : null}
      {current ? (
        <ReleaseView
          key={current.id}
          workspaceId={workspaceId}
          projectId={projectId}
          releaseId={current.id}
          canEdit={props.canEdit}
          isAdmin={props.isAdmin}
          go={props.go}
          onChange={() => void load()}
        />
      ) : null}
      <Card flush title={'Versions · ' + String(data.releases.length)}>
        {data.releases.length ? (
          <div className="pv-grid-scroll">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>State</th>
                  <th>Date</th>
                  <th className="pv-num">Tasks</th>
                  <th>Running on</th>
                </tr>
              </thead>
              <tbody>
                {data.releases.map((r) => (
                  <tr key={r.id} className={r.id === current?.id ? 'v2-row-on' : undefined}>
                    <td>
                      <button
                        type="button"
                        className="pv-link-btn pv-mono"
                        onClick={() => {
                          setSel(r.id);
                        }}
                      >
                        {r.version}
                      </button>
                      {/* [PCODE-306 | S15 | v0.1.0] */}
                      {r.component ? <Chip mono>{r.component}</Chip> : null}
                      {r.hotfixOf ? <Chip tone="warning">hotfix</Chip> : null}
                    </td>
                    <td>
                      <Chip
                        tone={
                          RELEASE_TONE[r.frozen && r.state === 'planned' ? 'frozen' : r.state] ??
                          'neutral'
                        }
                      >
                        {stateText(r)}
                      </Chip>
                    </td>
                    <td className="pv-muted">
                      {r.releasedAt
                        ? dateText(r.releasedAt)
                        : r.targetDate
                          ? 'planned ' + dateText(r.targetDate)
                          : '—'}
                    </td>
                    <td className="pv-num">
                      {r.done} / {r.items}
                    </td>
                    <td>{r.state === 'released' ? (r.environmentName ?? 'production') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pv-empty">No versions yet. Plan the first one above: {data.suggested}.</p>
        )}
      </Card>
      <InVersion workspaceId={workspaceId} projectId={projectId} />
    </div>
  );
}

function ReleaseView(props: {
  workspaceId: string;
  projectId: string;
  releaseId: string;
  canEdit: boolean;
  isAdmin: boolean;
  go: (p: string) => void;
  onChange: () => void;
}): ReactNode {
  const { workspaceId } = props;
  const R = W(workspaceId, '/releases/' + props.releaseId);
  const [c, setC] = useState<Contents | null>(null);
  const [policy, setPolicy] = useState<PolicyCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmShip, setConfirmShip] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Contents>('GET', R);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setC(r.data);
    if (
      props.canEdit &&
      (r.data.release.state === 'planned' || r.data.release.state === 'frozen')
    ) {
      const p = await api<PolicyCheck>(
        'POST',
        W(workspaceId, '/projects/' + props.projectId + '/policies/check'),
        {
          appliesTo: 'release',
          releaseId: props.releaseId,
        },
      );
      if (p.ok) setPolicy(p.data);
    } else setPolicy(null);
  }, [R, workspaceId, props.projectId, props.releaseId, props.canEdit]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!c) return <p className="pv-muted">{error ?? 'Loading the release…'}</p>;
  const rel = c.release;
  const checks = goNoGo(c, policy);
  const ready = checks.filter((x) => x.ok).length;
  const open = rel.state === 'planned' || rel.state === 'frozen';
  const act = async (
    action: 'freeze' | 'release' | 'rollback',
    body: object = {},
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await api('POST', R + '/' + action, body);
    setBusy(false);
    if (!r.ok) {
      if (action === 'release' && r.error.status === 409 && r.error.message.includes('polic'))
        setBlocked(r.error.message);
      else setError(r.error.message);
      return;
    }
    setBlocked(null);
    setReason('');
    props.onChange();
    void load();
  };
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card
        title={
          <>
            {/* [PCODE-306 | S15 | v0.1.0] a component's release says whose it is */}
            {rel.component ? <span className="pv-mono">{rel.component} </span> : null}
            <span className="pv-mono">{rel.version}</span>{' '}
            <Chip
              tone={
                RELEASE_TONE[rel.frozen && rel.state === 'planned' ? 'frozen' : rel.state] ??
                'neutral'
              }
            >
              {stateText(rel)}
            </Chip>
            {/* [PCODE-306 | S15 | v0.1.0] the suggestion is the project's line, not a component's */}
            {c.suggested !== rel.version && open && !rel.component ? (
              <span className="pv-muted pv-small"> · its contents suggest {c.suggested}</span>
            ) : null}
          </>
        }
        action={
          <span className="pv-muted pv-small">
            {[
              rel.train ? 'Train “' + rel.train + '”' : '',
              rel.targetDate ? 'planned ' + dateText(rel.targetDate) : '',
              rel.freezeAt ? 'freeze from ' + dateText(rel.freezeAt) : '',
              rel.releasedAt
                ? 'shipped ' +
                  dateText(rel.releasedAt) +
                  (rel.releasedBy ? ' by ' + rel.releasedBy : '')
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        }
      >
        <div className="pv-golive">
          <div className="pv-golive-score">
            <span className="pv-big pv-num">
              {ready}/{checks.length}
            </span>
            <span className="pv-muted">{open ? 'ready to ship' : 'hold now'}</span>
          </div>
          <ul className="pv-checks">
            {checks.map((x) => (
              <li
                key={x.label}
                className={x.ok ? 'pv-check pv-check--ok' : 'pv-check pv-check--no'}
              >
                <PIcon name={x.ok ? 'check' : 'x'} size={15} />
                <span>
                  <strong>{x.label}</strong> <span className="pv-muted pv-small">{x.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        {props.canEdit ? (
          <div className="pv-page-actions pv-mt">
            {rel.state === 'planned' ? (
              <Button kind="ghost" icon="snooze" disabled={busy} onClick={() => void act('freeze')}>
                Freeze: bug fixes only
              </Button>
            ) : null}
            {open ? (
              <Button
                kind="primary"
                icon="releases"
                disabled={busy}
                onClick={() => {
                  // [PCODE-178 | S15 | v0.1.0] open go/no-go checks ask for a second click
                  if (ready < checks.length && !confirmShip) setConfirmShip(true);
                  else void act('release');
                }}
              >
                {confirmShip
                  ? 'Ship with ' +
                    String(checks.length - ready) +
                    ' open check' +
                    (checks.length - ready === 1 ? '' : 's') +
                    '?'
                  : 'Ship ' + rel.version}
              </Button>
            ) : null}
            {rel.state === 'released' ? (
              <form
                className="v2-inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim()) void act('rollback', { reason: reason.trim() });
                }}
              >
                <input
                  className="v2-input v2-input--sm"
                  aria-label="Why roll back"
                  placeholder="Why roll back"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
                <button
                  type="submit"
                  className="pv-btn pv-btn--danger pv-btn--sm"
                  disabled={busy || !reason.trim()}
                >
                  Roll back
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {blocked ? (
          <div className="pv-callout pv-mt">
            <PIcon name="security" size={16} />
            <div className="pv-stack">
              <span>
                <strong>The release policies block this release.</strong> {blocked}
              </span>
              {props.isAdmin ? (
                <form
                  className="v2-inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (reason.trim())
                      void act('release', { override: true, reason: reason.trim() });
                  }}
                >
                  <input
                    className="v2-input v2-input--sm v2-grow"
                    aria-label="Reason to ship anyway"
                    placeholder="Why it ships anyway (kept in the team notes)"
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                    }}
                  />
                  <button
                    type="submit"
                    className="pv-btn pv-btn--danger pv-btn--sm"
                    disabled={busy || !reason.trim()}
                  >
                    Ship anyway
                  </button>
                </form>
              ) : (
                <span className="pv-muted pv-small">
                  Only an admin can ship past the policies, with a reason.
                </span>
              )}
            </div>
          </div>
        ) : null}
      </Card>
      <div className="pv-split">
        <ReleaseItems
          workspaceId={workspaceId}
          projectId={props.projectId}
          c={c}
          canEdit={props.canEdit && open}
          go={props.go}
          onChange={() => void load()}
        />
        <Notes
          workspaceId={workspaceId}
          rel={rel}
          canEdit={props.canEdit}
          onChange={() => void load()}
        />
      </div>
      {/* [PCODE-336 | S15 | v0.1.0] links and demos for the client, and the client's sign-off */}
      <ReleaseDeliverables
        workspaceId={workspaceId}
        projectId={props.projectId}
        releaseId={rel.id}
        canEdit={props.canEdit}
      />
      {/* [PCODE-206 | S15 | v0.1.0] notes approval, go/no-go meeting, backport, changelog */}
      <ReleaseExtras
        workspaceId={workspaceId}
        projectId={props.projectId}
        releaseId={rel.id}
        version={rel.version}
        notesWritten={rel.notesClient.trim().length > 0 || rel.notesTeam.trim().length > 0}
        notesApprovedBy={rel.notesApprovedBy ?? null}
        notesApprovedAt={rel.notesApprovedAt ?? null}
        notesByAgent={rel.notesByAgent ?? false}
        fixes={c.items
          .filter((i) => i.kind === 'bug')
          .map((i) => ({ id: i.id, ref: i.ref, title: i.title }))}
        canEdit={props.canEdit}
        onChange={() => {
          props.onChange();
          void load();
        }}
      />
    </div>
  );
}

function ReleaseItems(props: {
  workspaceId: string;
  projectId: string;
  c: Contents;
  canEdit: boolean;
  go: (p: string) => void;
  onChange: () => void;
}): ReactNode {
  const { c } = props;
  const R = W(props.workspaceId, '/releases/' + c.release.id);
  const [tasks, setTasks] = useState<{ id: string; ref: string; title: string }[]>([]);
  const [add, setAdd] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.canEdit) return;
    void api<{ id: string; ref: string; title: string }[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/items'),
    ).then((r) => {
      if (r.ok) setTasks(r.data.slice(0, 500));
    });
  }, [props.workspaceId, props.projectId, props.canEdit]);
  const call = async (method: 'POST' | 'DELETE', path: string, body?: object): Promise<void> => {
    const r = await api(method, R + path, body);
    if (!r.ok) setError(r.error.message);
    else {
      setError(null);
      setAdd('');
      props.onChange();
    }
  };
  const inside = new Set(c.items.map((i) => i.id));
  return (
    <Card flush title={'Contents · ' + String(c.items.length) + ' tasks'}>
      {error ? (
        <p className="v2-error v2-pad" role="alert">
          {error}
        </p>
      ) : null}
      {c.items.length ? (
        <ul className="pv-rows">
          {c.items.map((i) => (
            <li key={i.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <button
                  type="button"
                  className="pv-row-title pv-link-btn"
                  onClick={() => {
                    props.go('/items/' + i.id);
                  }}
                >
                  <span className="pv-mono pv-muted">{i.ref}</span> {i.title}
                </button>
                <span className="pv-row-sub">
                  {i.kind} ·{' '}
                  {i.tests
                    ? String(i.testsPassing) + '/' + String(i.tests) + ' tests passing'
                    : 'no tests'}
                  {i.pullRequests ? ' · ' + String(i.pullRequests) + ' PR' : ''}
                </span>
              </span>
              {i.breaking ? <Chip tone="danger">breaking</Chip> : null}
              {i.testsFailing ? <Chip tone="danger">tests failing</Chip> : null}
              <Chip
                tone={
                  i.stateGroup === 'completed'
                    ? 'success'
                    : i.stateGroup === 'cancelled'
                      ? 'neutral'
                      : 'warning'
                }
              >
                {i.stateGroup === 'completed' ? 'done' : i.stateGroup}
              </Chip>
              {props.canEdit ? (
                <button
                  type="button"
                  className="pv-mini-btn"
                  aria-label={'Move ' + i.ref + ' out of the release'}
                  onClick={() => void call('DELETE', '/items/' + i.id)}
                >
                  <PIcon name="x" size={12} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-empty">No tasks in this release yet.</p>
      )}
      {props.canEdit ? (
        <form
          className="v2-inline v2-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (add) void call('POST', '/items', { itemIds: [add] });
          }}
        >
          <select
            className="v2-input v2-input--sm v2-grow"
            aria-label="Add a task"
            value={add}
            onChange={(e) => {
              setAdd(e.target.value);
            }}
          >
            <option value="">Add a task…</option>
            {tasks
              .filter((t) => !inside.has(t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ref} {t.title}
                </option>
              ))}
          </select>
          <button type="submit" className="pv-btn pv-btn--secondary pv-btn--sm" disabled={!add}>
            Add
          </button>
        </form>
      ) : null}
      {c.flags.length ? (
        <p className="pv-muted pv-small v2-pad">
          Flags:{' '}
          {c.flags
            .map(
              (f) =>
                f.key +
                ' (' +
                Object.entries(f.enabled)
                  .filter(([, on]) => on)
                  .map(([k]) => k)
                  .join(', ') +
                ')',
            )
            .join(' · ')}
        </p>
      ) : null}
    </Card>
  );
}

function Notes(props: {
  workspaceId: string;
  rel: Release;
  canEdit: boolean;
  onChange: () => void;
}): ReactNode {
  const R = W(props.workspaceId, '/releases/' + props.rel.id);
  const [aud, setAud] = useState<'client' | 'team'>('client');
  const [edit, setEdit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = aud === 'client' ? props.rel.notesClient : props.rel.notesTeam;
  const write = async (): Promise<void> => {
    const r = await api('POST', R + '/notes');
    if (!r.ok) setError(r.error.message);
    else props.onChange();
  };
  const save = async (): Promise<void> => {
    const r = await api(
      'PATCH',
      R,
      aud === 'client' ? { notesClient: edit ?? '' } : { notesTeam: edit ?? '' },
    );
    if (!r.ok) setError(r.error.message);
    else {
      setEdit(null);
      props.onChange();
    }
  };
  return (
    <Card
      title="Release notes"
      action={
        <div className="pv-segmented" role="radiogroup" aria-label="Audience">
          {(['client', 'team'] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={aud === a}
              className="pv-seg"
              onClick={() => {
                setAud(a);
                setEdit(null);
              }}
            >
              {a === 'client' ? 'For the client' : 'For the team'}
            </button>
          ))}
        </div>
      }
    >
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {edit !== null ? (
        <div className="pv-stack">
          <textarea
            className="v2-input v2-mono"
            rows={12}
            aria-label="Release notes"
            value={edit}
            onChange={(e) => {
              setEdit(e.target.value);
            }}
          />
          <div className="pv-page-actions">
            <Button size="sm" kind="primary" onClick={() => void save()}>
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
          </div>
        </div>
      ) : text.trim() ? (
        <article className="pv-doc v2-md">
          <Markdown text={text} />
        </article>
      ) : (
        <p className="pv-muted pv-small">
          Not written yet: write them from the tasks in the release, then edit.
        </p>
      )}
      {props.canEdit && edit === null ? (
        <div className="pv-page-actions pv-mt">
          <Button size="sm" icon="sparkle" onClick={() => void write()}>
            {text.trim() ? 'Write again from the contents' : 'Write from the contents'}
          </Button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setEdit(text);
            }}
          >
            Edit
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function InVersion(props: { workspaceId: string; projectId: string }): ReactNode {
  const [tasks, setTasks] = useState<{ id: string; ref: string; title: string }[]>([]);
  const [item, setItem] = useState('');
  const [res, setRes] = useState<
    { id: string; version: string; state: string; releasedAt: string | null }[] | null
  >(null);
  useEffect(() => {
    void api<{ id: string; ref: string; title: string }[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/items'),
    ).then((r) => {
      if (r.ok) setTasks(r.data.slice(0, 500));
    });
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    if (!item) return;
    void api<NonNullable<typeof res>>(
      'GET',
      W(props.workspaceId, '/items/' + item + '/releases'),
    ).then((r) => {
      setRes(r.ok ? r.data : []);
    });
  }, [item, props.workspaceId]);
  return (
    <Card title="Is a task in a version?">
      <div className="pv-ask">
        <select
          className="pv-select"
          aria-label="Task"
          value={item}
          onChange={(e) => {
            setItem(e.target.value);
          }}
        >
          <option value="">Pick a task…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.ref} {t.title}
            </option>
          ))}
        </select>
      </div>
      {item && res ? (
        res.length ? (
          <ul className="pv-checks">
            {res.map((r) => (
              <li
                key={r.id}
                className={r.state === 'released' ? 'pv-check pv-check--ok' : 'pv-check'}
              >
                <PIcon name={r.state === 'released' ? 'check' : 'clock'} size={15} />
                <span>
                  <strong className="pv-mono">{r.version}</strong>{' '}
                  <span className="pv-muted pv-small">
                    {r.state === 'released'
                      ? 'shipped ' + dateText(r.releasedAt)
                      : r.state.replace('_', ' ')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-muted pv-small">Not in any version yet.</p>
        )
      ) : null}
    </Card>
  );
}

// ── flags ──

interface Flag {
  id: string;
  key: string;
  description: string;
  itemId: string | null;
  itemRef: string | null;
  enabled: Record<string, boolean>;
  ageDays: number;
  stale: boolean;
}

function Flags(props: { workspaceId: string; projectId: string; canEdit: boolean }): ReactNode {
  const [list, setList] = useState<Flag[] | null>(null);
  const [envs, setEnvs] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const P = W(props.workspaceId, '/projects/' + props.projectId);
    const [f, e] = await Promise.all([
      api<Flag[]>('GET', P + '/flags'),
      api<{ key: string }[]>('GET', P + '/environments'),
    ]);
    if (f.ok) setList(f.data);
    else setError(f.error.message);
    const known = e.ok ? e.data.map((x) => x.key) : [];
    const used = f.ok ? f.data.flatMap((x) => Object.keys(x.enabled)) : [];
    setEnvs([...new Set([...known, ...used])]);
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (f: Flag, env: string, on: boolean): Promise<void> => {
    const r = await api('PATCH', W(props.workspaceId, '/flags/' + f.id), {
      enabled: { ...f.enabled, [env]: on },
    });
    if (!r.ok) setError(r.error.message);
    void load();
  };
  const add = async (): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, '/projects/' + props.projectId + '/flags'), {
      key: key.trim(),
    });
    if (!r.ok) setError(r.error.message);
    else {
      setKey('');
      void load();
    }
  };
  const remove = async (f: Flag): Promise<void> => {
    const r = await api('DELETE', W(props.workspaceId, '/flags/' + f.id));
    if (!r.ok) setError(r.error.message);
    void load();
  };
  if (!list) return <p className="pv-muted">{error ?? 'Loading flags…'}</p>;
  return (
    <Card
      flush
      title={'Feature flags · ' + String(list.length)}
      action={
        props.canEdit ? (
          <form
            className="v2-inline"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) void add();
            }}
          >
            <input
              className="v2-input v2-input--sm v2-mono"
              aria-label="New flag"
              placeholder="live-reroute"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
              }}
            />
            <button
              type="submit"
              className="pv-btn pv-btn--secondary pv-btn--sm"
              disabled={!key.trim()}
            >
              Add flag
            </button>
          </form>
        ) : null
      }
    >
      {error ? (
        <p className="v2-error v2-pad" role="alert">
          {error}
        </p>
      ) : null}
      {list.length ? (
        <div className="pv-grid-scroll">
          <table className="pv-table">
            <thead>
              <tr>
                <th>Flag</th>
                <th>Task</th>
                {envs.map((e) => (
                  <th key={e} className="pv-center">
                    {e}
                  </th>
                ))}
                <th>Age</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id}>
                  <td>
                    <span className="pv-mono">{f.key}</span>
                    {f.description ? (
                      <span className="pv-muted pv-small"> · {f.description}</span>
                    ) : null}
                  </td>
                  <td className="pv-mono">{f.itemRef ?? '—'}</td>
                  {envs.map((e) => (
                    <td key={e} className="pv-center">
                      <input
                        type="checkbox"
                        aria-label={f.key + ' on ' + e}
                        checked={f.enabled[e] ?? false}
                        disabled={!props.canEdit}
                        onChange={(x) => void toggle(f, e, x.target.checked)}
                      />
                    </td>
                  ))}
                  <td className={f.stale ? 'pv-text-warning' : 'pv-muted'}>
                    {f.ageDays} days{f.stale ? ' · stale' : ''}
                  </td>
                  <td>
                    {props.canEdit && f.stale ? (
                      <Button size="sm" kind="ghost" onClick={() => void remove(f)}>
                        Remove
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="pv-empty">No feature flags yet.</p>
      )}
    </Card>
  );
}

// ── delivery metrics ──

interface Dora {
  days: number;
  environment: { id: string; name: string } | null;
  deploysPerWeek: number;
  leadTimeHours: number | null;
  changeFailureRate: number | null;
  timeToRestoreHours: number | null;
  prMergeHours: number | null;
  deploys: number;
}

/** Hours as people read them: 40 min, 5 h, 3 days. */
export const hoursText = (h: number | null): string =>
  h === null
    ? '—'
    : h < 1
      ? String(Math.round(h * 60)) + ' min'
      : h < 48
        ? String(Math.round(h * 10) / 10).replace('.', ',') + ' h'
        : String(Math.round(h / 24)) + ' days';

function Delivery(props: { workspaceId: string; projectId: string }): ReactNode {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Dora | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<Dora>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/dora?days=' + String(days)),
    ).then((r) => {
      if (r.ok) setD(r.data);
      else setError(r.error.message);
    });
  }, [props.workspaceId, props.projectId, days]);
  if (!d) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  return (
    <div className="pv-stack">
      <div className="pv-page-actions">
        <select
          className="v2-input v2-input--sm"
          aria-label="Period"
          value={String(days)}
          onChange={(e) => {
            setDays(Number(e.target.value));
          }}
        >
          {[30, 90, 180, 365].map((n) => (
            <option key={n} value={String(n)}>
              Last {n} days
            </option>
          ))}
        </select>
        <span className="pv-muted pv-small">
          {d.environment
            ? 'Deploys to ' + d.environment.name + ': ' + String(d.deploys)
            : 'No production environment yet'}
        </span>
      </div>
      <div className="pv-stats">
        <Stat
          label="Deploy frequency"
          value={String(d.deploysPerWeek).replace('.', ',') + ' / week'}
          icon="releases"
        />
        <Stat
          label="Lead time for changes"
          value={hoursText(d.leadTimeHours)}
          sub="first commit to production"
          icon="clock"
        />
        <Stat
          label="Change failure rate"
          value={
            d.changeFailureRate === null
              ? '—'
              : String(Math.round(d.changeFailureRate * 100)) + ' %'
          }
          tone={d.changeFailureRate !== null && d.changeFailureRate > 0.15 ? 'warning' : undefined}
          icon="incident"
        />
        <Stat label="Time to restore" value={hoursText(d.timeToRestoreHours)} icon="snooze" />
        <Stat label="Pull request to merge" value={hoursText(d.prMergeHours)} icon="git" />
      </div>
    </div>
  );
}

// ── the Releases page ──

interface OverviewRow {
  projectId: string;
  key: string;
  name: string;
  next: Release | null;
  lastReleased: { id: string; version: string; releasedAt: string | null } | null;
  openPulls: number;
  planned: number;
}

export function ReleasesOverview(props: {
  workspaceId: string;
  go: (p: string) => void;
  // [PCODE-206 | S15 | v0.1.0] the trains need the live events and who may act
  hub?: EventHub;
  canEdit?: boolean;
  isAdmin?: boolean;
}): ReactNode {
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<OverviewRow[]>('GET', W(props.workspaceId, '/release-overview')).then((r) => {
      if (r.ok) setRows(r.data);
      else setError(r.error.message);
    });
  }, [props.workspaceId]);
  const soon = (rows ?? [])
    .flatMap((r) =>
      r.next?.targetDate ? [{ key: r.key, v: r.next.version, at: r.next.targetDate }] : [],
    )
    .sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="pv-page">
      <PageHead
        title="Releases"
        sub="Every project’s next release, how ready it is, and what is in production"
        icon="releases"
        actions={
          soon[0] ? (
            <Chip icon="flag">
              Next: {soon[0].key} {soon[0].v} on {dateText(soon[0].at)}
            </Chip>
          ) : null
        }
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {rows ? (
        <>
          <div className="pv-stats">
            <Stat
              label="Projects with a planned release"
              value={String(rows.filter((r) => r.next).length) + ' / ' + String(rows.length)}
              icon="releases"
            />
            <Stat
              label="Frozen now"
              value={String(rows.filter((r) => r.next?.frozen).length)}
              icon="snooze"
            />
            <Stat
              label="Open pull requests"
              value={String(rows.reduce((n, r) => n + r.openPulls, 0))}
              icon="git"
            />
          </div>
          <Card flush title="Next releases" className="pv-mt">
            {rows.length ? (
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Next version</th>
                    <th>Planned</th>
                    <th>Now</th>
                    <th className="pv-num">Tasks done</th>
                    <th>In production</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.projectId}>
                      <td>
                        <button
                          type="button"
                          className="pv-link-btn"
                          onClick={() => {
                            props.go('/projects/' + r.projectId + '/versions');
                          }}
                        >
                          <span className="pv-mono pv-tile-key">{r.key}</span> {r.name}
                        </button>
                      </td>
                      <td className="pv-mono pv-strong">{r.next?.version ?? '—'}</td>
                      <td>{r.next?.targetDate ? dateText(r.next.targetDate) : '—'}</td>
                      <td>
                        {r.next ? (
                          <Chip
                            tone={
                              RELEASE_TONE[r.next.frozen ? 'frozen' : r.next.state] ?? 'neutral'
                            }
                          >
                            {stateText(r.next)}
                          </Chip>
                        ) : (
                          <span className="pv-muted">nothing planned</span>
                        )}
                      </td>
                      <td className="pv-num">
                        {r.next ? String(r.next.done) + ' / ' + String(r.next.items) : '—'}
                      </td>
                      <td className="pv-mono">
                        {r.lastReleased ? r.lastReleased.version : '—'}
                        {r.lastReleased?.releasedAt ? (
                          <span className="pv-muted pv-small">
                            {' '}
                            · {dateText(r.lastReleased.releasedAt)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="pv-empty">No projects yet.</p>
            )}
          </Card>
          {/* [PCODE-206 | S15 | v0.1.0] trains across the projects */}
          {props.hub ? (
            <Trains
              workspaceId={props.workspaceId}
              hub={props.hub}
              canEdit={props.canEdit ?? false}
              isAdmin={props.isAdmin ?? false}
              go={props.go}
            />
          ) : null}
        </>
      ) : (
        <p className="pv-muted">{error ? '' : 'Loading…'}</p>
      )}
    </div>
  );
}
