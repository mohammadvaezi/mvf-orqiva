// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-423 | S15 | v0.1.0] T37 low: No command-line words in the web app ──
// ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
// ── [PCODE-202 | S15 | v0.1.0] Fix project pages: duplicated tab bars, visible scrollbars, cut-off sidebar, narrow widths ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-114 | S15 | v0.1.0] Add the Home dashboard and project overview with our own charts ──
// ── [PCODE-116 | S15 | v0.1.0] Restyle the web app after the owner's reference kit: gradient band, hero cards, KPI tiles, lavender sidebar ──
// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
//    Why:  one frame for every page of a project: its name and key, its pages as tabs (Overview, List,
//          Board, Backlog, Repositories, Settings) and the page's own actions. The Overview says where the
//          project stands: the active sprint, the work by state and what happened lately.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js'; // [PCODE-248 | S15 | v0.1.0]
import { GitMovesForm } from './v2/plankeys.js'; // [PCODE-255 | S15 | v0.1.0]
import { ShapeSettings } from './v2/hierarchyui.js'; // [PCODE-257 | S15 | v0.1.0]
import { overdueDays } from './v2/planning.js'; // [PCODE-271 | S15 | v0.1.0]
import type { EventHub } from './core/hub.js';
import { projectPath, type ProjectViewKind } from './core/nav.js';
import { ActivityList, useActivity } from './pages.js';
import type { Sprint } from './planning.js';
import { Card, PageHeader, Stat, follow } from './shell.js';
import type { Item } from './sync/items.js';
import type { Project, State } from './views.js';

export function ProjectHeader(props: {
  project: Project;
  view: ProjectViewKind;
  go: (p: string) => void;
  actions?: ReactNode;
}): ReactNode {
  return (
    <PageHeader
      eyebrow={
        <>
          <a href="/projects" onClick={follow('/projects', props.go)}>
            Projects
          </a>
          <span aria-hidden="true"> / </span>
          <span className="pe-mono">{props.project.key}</span>
        </>
      }
      title={props.project.name}
      actions={props.actions}
      go={props.go}
      // [PCODE-202 | S15 | v0.1.0] the project's tabs are the bar above every project page; no second row here
    />
  );
}

/** A plain progress bar: the share done, drawn as SVG (no inline styles under the page's CSP). */
export function Progress(props: { done: number; total: number; label: string }): ReactNode {
  const share = props.total ? props.done / props.total : 0;
  return (
    <div className="pe-progress">
      <svg
        width="100%"
        height="8"
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        role="img"
        aria-label={props.label}
      >
        <rect className="pe-progress-track" x="0" y="0" width="100" height="8" rx="4" />
        <rect
          className="pe-progress-fill"
          x="0"
          y="0"
          width={Math.max(share * 100, share ? 2 : 0)}
          height="8"
          rx="4"
        />
      </svg>
      <span className="pe-small pe-muted">
        {props.done} of {props.total} done · {Math.round(share * 100)}%
      </span>
    </div>
  );
}

export function ProjectOverview(props: {
  workspaceId: string;
  project: Project;
  states: State[];
  items: Item[];
  sprints: Sprint[];
  hub: EventHub;
  go: (p: string) => void;
  /** [PCODE-114] the project's charts */
  charts?: ReactNode;
}): ReactNode {
  const events = useActivity(props.workspaceId, props.hub, props.project.id, 15);
  const groupOf = new Map(props.states.map((s) => [s.id, s.group]));
  const open = props.items.filter((i) =>
    ['backlog', 'unstarted', 'started'].includes(groupOf.get(i.stateId) ?? ''),
  );
  const started = props.items.filter((i) => groupOf.get(i.stateId) === 'started').length;
  const done = props.items.filter((i) => groupOf.get(i.stateId) === 'completed').length;
  const active = props.sprints.find((s) => s.status === 'active');
  return (
    <>
      <div className="pe-stats">
        <Stat label="Open" icon="task" value={open.length} />
        <Stat label="In progress" icon="bolt" value={started} />
        <Stat label="Done" icon="chart" value={done} />
        <Stat
          label="Sprints"
          icon="backlog"
          value={props.sprints.length}
          hint={
            active
              ? active.name +
                (overdueDays(active.endDate) > 0
                  ? ' ended ' + String(overdueDays(active.endDate)) + ' d ago and is still open'
                  : ' is running')
              : 'none running'
          }
        />
      </div>
      {props.charts}
      <div className="pe-columns">
        <div className="pe-stack">
          <Card title="About">
            <p className="pe-prewrap">
              {props.project.description || 'No description yet. Add one in the project settings.'}
            </p>
          </Card>
          <Card
            title={active ? active.name : 'No sprint running'}
            subtitle={
              active
                ? (active.startDate ?? '') + (active.endDate ? ' – ' + active.endDate : '')
                : 'Plan and start one in the backlog.'
            }
            actions={
              <a
                className="pe-btn pe-btn--text"
                href={projectPath(props.project.id, 'backlog')}
                onClick={follow(projectPath(props.project.id, 'backlog'), props.go)}
              >
                Backlog
              </a>
            }
          >
            {active ? (
              <>
                {active.goal ? <p className="pe-prewrap">{active.goal}</p> : null}
                <Progress
                  done={active.doneCount}
                  total={active.itemCount}
                  label={
                    'Sprint progress: ' +
                    String(active.doneCount) +
                    ' of ' +
                    String(active.itemCount) +
                    ' done'
                  }
                />
              </>
            ) : null}
          </Card>
        </div>
        <Card title="Recent activity">
          {events ? (
            <ActivityList events={events} go={props.go} compact />
          ) : (
            <p className="pe-muted" role="status">
              Loading…
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

// ── [PCODE-115 | S15 | v0.1.0] the project's settings: general for members, version, loop rules and archive for admins ──
export interface ProjectSettingsData {
  id: string;
  key: string;
  name: string;
  description: string;
  archived: boolean;
  version: string;
  loopRules: { reviewBeforeDone: boolean; autoTestState: boolean; unguardedPaths: string[] };
  costCentre?: string; // [PCODE-328 | S15 | v0.1.0]
}

export function ProjectSettings(props: {
  project: ProjectSettingsData;
  canEdit: boolean;
  canAdmin: boolean;
  /** [PCODE-248 | S15 | v0.1.0] for the project's own roles */
  workspaceId?: string;
  projectId?: string;
  onSave: (fields: Record<string, unknown>) => Promise<string | null>;
}): ReactNode {
  const p = props.project;
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description);
  const [version, setVersion] = useState(p.version);
  const [paths, setPaths] = useState(p.loopRules.unguardedPaths.join('\n'));
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [centre, setCentre] = useState(p.costCentre ?? ''); // [PCODE-328 | S15 | v0.1.0]
  const save = (fields: Record<string, unknown>): void => {
    void props.onSave(fields).then((err) => {
      setMsg(err ? { error: err } : { ok: 'Saved.' });
    });
  };
  const outcome = msg.error ? (
    <div className="pe-field-error" role="alert">
      {msg.error}
    </div>
  ) : msg.ok ? (
    <div className="pe-ok" role="status">
      {msg.ok}
    </div>
  ) : null;
  return (
    <div className="pe-settings-body">
      <Card title="General">
        <form
          className="pe-form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            save({ name: name.trim(), description });
          }}
        >
          <div className="pe-field">
            <label htmlFor="ps-name">Name</label>
            <input
              id="ps-name"
              className="pe-input"
              value={name}
              disabled={!props.canEdit}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
          <div className="pe-field">
            <label htmlFor="ps-key">Key</label>
            <input
              id="ps-key"
              className="pe-input pe-input--key"
              value={p.key}
              readOnly
              aria-describedby="ps-key-hint"
            />
            <span id="ps-key-hint" className="pe-small pe-muted">
              Every task number starts with it ({p.key}-12), so it stays as it is.
            </span>
          </div>
          <div className="pe-field">
            <label htmlFor="ps-desc">Description</label>
            <textarea
              id="ps-desc"
              className="pe-input pe-textarea"
              value={description}
              disabled={!props.canEdit}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
            />
          </div>
          {props.canEdit ? (
            <div className="pe-form-actions">
              <button type="submit" className="pe-btn pe-btn--primary" disabled={!name.trim()}>
                Save
              </button>
              {outcome}
            </div>
          ) : null}
        </form>
      </Card>
      {props.canAdmin ? (
        <>
          {/* [PCODE-328 | S15 | v0.1.0] where the project's AI cost is booked */}
          <Card title="Cost centre" subtitle="AI costs are charged back to it in Agents → Costs.">
            <form
              className="pe-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                save({ costCentre: centre.trim() });
              }}
            >
              <div className="pe-field">
                <label htmlFor="ps-centre">Cost centre</label>
                <input
                  id="ps-centre"
                  className="pe-input pe-input--small"
                  maxLength={60}
                  placeholder="e.g. 4711 Product"
                  value={centre}
                  onChange={(e) => {
                    setCentre(e.target.value);
                  }}
                />
              </div>
              <div className="pe-form-actions">
                <button type="submit" className="pe-btn pe-btn--primary">
                  Save
                </button>
              </div>
            </form>
          </Card>
          <Card
            title="Version and development loop"
            subtitle="What the fingerprints in the code carry, and how pe and the hooks move tasks."
          >
            <form
              className="pe-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                save({
                  version: version.trim(),
                  loopRules: {
                    unguardedPaths: paths
                      .split('\n')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  },
                });
              }}
            >
              <div className="pe-field">
                <label htmlFor="ps-version">Version</label>
                <input
                  id="ps-version"
                  className="pe-input pe-input--small pe-mono"
                  value={version}
                  onChange={(e) => {
                    setVersion(e.target.value);
                  }}
                />
              </div>
              <label className="pe-toggle">
                <input
                  type="checkbox"
                  checked={p.loopRules.reviewBeforeDone}
                  onChange={(e) => {
                    save({ loopRules: { reviewBeforeDone: e.target.checked } });
                  }}
                />
                <span>
                  <strong>Review before done</strong>
                  <span className="pe-small pe-muted">
                    {' '}
                    {/* [PCODE-423 | S15 | v0.1.0] */}
                    Finishing a task in VS Code moves it to Review; a person moves it to Done.
                  </span>
                </span>
              </label>
              <label className="pe-toggle">
                <input
                  type="checkbox"
                  checked={p.loopRules.autoTestState}
                  onChange={(e) => {
                    save({ loopRules: { autoTestState: e.target.checked } });
                  }}
                />
                <span>
                  <strong>Green tests move the task to Test</strong>
                  <span className="pe-small pe-muted"> When the hooks see a test run pass.</span>
                </span>
              </label>
              <div className="pe-field">
                <label htmlFor="ps-paths">Paths edited without an active task</label>
                <textarea
                  id="ps-paths"
                  className="pe-input pe-textarea pe-mono"
                  placeholder={'docs/\nscripts/*.sh'}
                  value={paths}
                  onChange={(e) => {
                    setPaths(e.target.value);
                  }}
                />
                <span className="pe-small pe-muted">
                  One per line: a folder, or a pattern with * and **.
                </span>
              </div>
              <div className="pe-form-actions">
                <button type="submit" className="pe-btn pe-btn--primary">
                  Save
                </button>
                {outcome}
              </div>
            </form>
          </Card>
          {props.workspaceId && props.projectId ? (
            <ProjectRoles workspaceId={props.workspaceId} projectId={props.projectId} />
          ) : null}
          {/* [PCODE-255 | S15 | v0.1.0] */}
          {props.workspaceId && props.projectId ? (
            <Card
              title="Git moves the tasks"
              subtitle="A task named in a branch, a pull request or a merge moves forward to the state chosen here; never back, and never out of done."
            >
              <GitMovesForm workspaceId={props.workspaceId} projectId={props.projectId} />
            </Card>
          ) : null}
          {/* [PCODE-257 | S15 | v0.1.0] the project's own types and fields */}
          {props.workspaceId && props.projectId ? (
            <ShapeSettings workspaceId={props.workspaceId} projectId={props.projectId} />
          ) : null}
          <Card
            title={p.archived ? 'Restore the project' : 'Archive the project'}
            className="pe-danger-zone"
          >
            <p className="pe-muted">
              {p.archived
                ? 'It comes back into the sidebar, the dashboards and My work.'
                : 'It leaves the sidebar, the dashboards and My work. Nothing is deleted; it can be restored here.'}
            </p>
            <button
              type="button"
              className={p.archived ? 'pe-btn pe-btn--primary' : 'pe-btn pe-btn--danger'}
              onClick={() => {
                save({ archived: !p.archived });
              }}
            >
              {p.archived ? 'Restore' : 'Archive'}
            </button>
          </Card>
        </>
      ) : null}
    </div>
  );
}

// ── [PCODE-248 | S15 | v0.1.0] the project's own roles ──

const PROJECT_ROLES = ['lead', 'member', 'tester', 'designer', 'viewer'] as const;

interface ProjectMember {
  userId: string;
  name: string;
  workspaceRole: string;
  role: string;
}

/** A person's role in this project, which overrides their workspace role here; a viewer only reads. */
function ProjectRoles(props: { workspaceId: string; projectId: string }): ReactNode {
  const base = '/api/workspaces/' + props.workspaceId;
  const [list, setList] = useState<ProjectMember[]>([]);
  const [people, setPeople] = useState<{ userId: string; name: string; role: string }[]>([]);
  const [pick, setPick] = useState({ user: '', role: 'viewer' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<ProjectMember[]>('GET', base + '/projects/' + props.projectId + '/members');
    if (r.ok) setList(r.data);
  }, [base, props.projectId]);
  useEffect(() => {
    void load();
    // [PCODE-271 | S15 | v0.1.0] people get project roles, not machine accounts
    void api<{ userId: string; name: string; role: string; service?: boolean }[]>(
      'GET',
      base + '/members',
    ).then((r) => {
      if (r.ok) setPeople(r.data.filter((m) => !m.service && !['owner', 'guest'].includes(m.role)));
    });
  }, [load, base]);
  const set = async (userId: string, role: string | null): Promise<void> => {
    setError(null);
    const path = base + '/projects/' + props.projectId + '/members/' + userId;
    const r = role
      ? await api<ProjectMember[]>('PUT', path, { role })
      : await api<ProjectMember[]>('DELETE', path);
    if (!r.ok) setError(r.error.message);
    else setList(r.data);
  };
  return (
    <Card
      title="Roles in this project"
      subtitle="A role here overrides the workspace role in this project. A viewer reads and changes nothing."
    >
      {list.length ? (
        <table className="pe-table">
          <tbody>
            {list.map((m) => (
              <tr key={m.userId}>
                <td>{m.name}</td>
                <td className="pe-muted">{m.workspaceRole} in the workspace</td>
                <td>
                  <select
                    className="pe-input"
                    aria-label={'Role of ' + m.name}
                    value={m.role}
                    onChange={(e) => void set(m.userId, e.target.value)}
                  >
                    {PROJECT_ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="pe-btn pe-btn--ghost"
                    onClick={() => void set(m.userId, null)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pe-muted">Everyone works here with their workspace role.</p>
      )}
      <div className="pe-form-actions">
        <select
          className="pe-input"
          aria-label="Person"
          value={pick.user}
          onChange={(e) => {
            setPick({ ...pick, user: e.target.value });
          }}
        >
          <option value="">Pick a person…</option>
          {people
            .filter((p) => !list.some((m) => m.userId === p.userId))
            .map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
        </select>
        <select
          className="pe-input"
          aria-label="Project role"
          value={pick.role}
          onChange={(e) => {
            setPick({ ...pick, role: e.target.value });
          }}
        >
          {PROJECT_ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <button
          type="button"
          className="pe-btn pe-btn--primary"
          disabled={!pick.user}
          onClick={() => {
            void set(pick.user, pick.role).then(() => {
              setPick({ user: '', role: 'viewer' });
            });
          }}
        >
          Add
        </button>
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
