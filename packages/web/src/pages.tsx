// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-423 | S15 | v0.1.0] T37 low: No command-line words in the web app ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-190 | S15 | v0.1.0] Commit leftovers of B4.5–B6.1: classic pages removed, invite session with request ──
// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-116 | S15 | v0.1.0] Restyle the web app after the owner's reference kit: gradient band, hero cards, KPI tiles, lavender sidebar ──
// ── [PCODE-118 | S15 | v0.1.0] Show and drive the lifecycle in the web app: stepper, stages, gate checklist and sign-off ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
//    Why:  the workspace-wide pages of the new layout: Home (where things stand), My work (what is mine),
//          Projects (all of them, as cards, with a New project dialog) and Activity (what the team and its
//          agents did, by day). Each page loads what it shows and follows the live stream.
import {
  describe,
  inFeed,
  itemOf,
  whenText,
  type ActivityEvent,
  type ActorKind,
} from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';
import { Icon, type IconName } from './core/icons.js';
import { projectPath } from './core/nav.js';
import { Card, Dialog, EmptyState, PageHeader, Stat, follow } from './shell.js';
import type { Project } from './views.js';

export const W = (workspaceId: string, path: string): string =>
  '/api/workspaces/' + workspaceId + path;

export interface MyItem {
  id: string;
  ref: string;
  title: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  state: string;
  stateGroup: string;
  stateColor: string;
  sprint: string | null;
  updatedAt: string;
}

export function StateChip(props: { name: string; color: string }): ReactNode {
  return (
    <span className="pe-chip">
      <svg className="pe-dot" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <circle cx="4" cy="4" r="4" fill={props.color} />
      </svg>
      {props.name}
    </span>
  );
}

function useMyWork(workspaceId: string, hub: EventHub): MyItem[] | null {
  const [items, setItems] = useState<MyItem[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<MyItem[]>('GET', W(workspaceId, '/my-work'));
    if (r.ok) setItems(r.data);
  }, [workspaceId]);
  useEffect(() => {
    void load();
    return hub.on((e) => {
      if (e.data.object.type === 'item' || e.type === 'orqiva.workspace.resync') void load();
    });
  }, [load, hub]);
  return items;
}

function useActivity(
  workspaceId: string,
  hub: EventHub,
  projectId?: string,
  limit = 50,
): ActivityEvent[] | null {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  useEffect(() => {
    let current = true;
    const q = '?limit=' + String(limit) + (projectId ? '&projectId=' + projectId : '');
    void api<{ events: ActivityEvent[] }>('GET', W(workspaceId, '/activity' + q)).then((r) => {
      if (current && r.ok) setEvents([...r.data.events].reverse());
    });
    const off = hub.on((e) => {
      if (projectId && e.projectid !== projectId) return;
      setEvents((list) =>
        list && !list.some((x) => x.sequence === e.sequence) ? [e, ...list].slice(0, limit) : list,
      );
    });
    return () => {
      current = false;
      off();
    };
  }, [workspaceId, hub, projectId, limit]);
  return events;
}

function useProjects(workspaceId: string, hub: EventHub): [Project[] | null, () => Promise<void>] {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<Project[]>('GET', W(workspaceId, '/projects'));
    if (r.ok) setProjects(r.data);
  }, [workspaceId]);
  useEffect(() => {
    void load();
    return hub.on((e) => {
      if (e.data.object.type === 'project' || e.type === 'orqiva.workspace.resync') void load();
    });
  }, [load, hub]);
  return [projects, load];
}

const ACTOR_ICON: Record<ActorKind, IconName> = {
  user: 'person',
  agent: 'bolt',
  system: 'settings',
  integration: 'git',
};

export function ActivityList(props: {
  events: ActivityEvent[];
  go: (p: string) => void;
  compact?: boolean;
}): ReactNode {
  const now = new Date();
  // [PCODE-122 | S15 | v0.1.0] an agent's single steps stay on its run page
  const events = props.events.filter(inFeed);
  if (events.length === 0)
    return (
      <EmptyState icon="pulse" title="Nothing has happened yet">
        Work done here and in VS Code shows up as it happens.
      </EmptyState>
    );
  return (
    <ol className={'pe-activity' + (props.compact ? ' pe-activity--compact' : '')}>
      {events.map((e) => {
        const item = itemOf(e);
        const kind = e.data.actor.kind;
        return (
          <li key={e.sequence} className={'pe-activity-row pe-activity-row--' + kind}>
            <span className="pe-activity-icon" title={kind === 'agent' ? 'AI agent' : undefined}>
              <Icon name={ACTOR_ICON[kind]} size={16} />
            </span>
            <span className="pe-activity-text">
              {item ? (
                <a href={'/items/' + item} onClick={follow('/items/' + item, props.go)}>
                  {describe(e)}
                </a>
              ) : (
                describe(e)
              )}
            </span>
            <time className="pe-activity-time" dateTime={e.time}>
              {whenText(e.time, now)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}

export function MyWorkTable(props: {
  items: MyItem[];
  go: (p: string) => void;
  limit?: number;
}): ReactNode {
  const shown = props.limit ? props.items.slice(0, props.limit) : props.items;
  if (shown.length === 0)
    return (
      <EmptyState icon="task" title="Nothing assigned to you">
        Tasks you start or are given appear here.
      </EmptyState>
    );
  return (
    <table className="pe-grid-table" aria-label="My tasks">
      <thead>
        <tr>
          <th scope="col">Task</th>
          <th scope="col">Project</th>
          <th scope="col">State</th>
          <th scope="col">Sprint</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((i) => (
          <tr key={i.id}>
            <td>
              <span className="pe-ref">{i.ref}</span>{' '}
              <a href={'/items/' + i.id} onClick={follow('/items/' + i.id, props.go)}>
                {i.title}
              </a>
            </td>
            <td className="pe-muted">{i.projectName}</td>
            <td>
              <StateChip name={i.state} color={i.stateColor} />
            </td>
            <td className="pe-muted">{i.sprint ?? 'Backlog'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function HomePage(props: {
  workspaceId: string;
  workspaceName: string;
  userName: string;
  hub: EventHub;
  go: (p: string) => void;
  /** [PCODE-114] the charts of the dashboard, when there is a project to chart */
  insights?: ReactNode;
  /** [PCODE-164 | S15 | v0.1.0] the v2 shell greets above; the dashboard then starts with its numbers */
  headless?: boolean;
}): ReactNode {
  const mine = useMyWork(props.workspaceId, props.hub);
  const events = useActivity(props.workspaceId, props.hub, undefined, 12);
  const [projects] = useProjects(props.workspaceId, props.hub);
  const lifecycle = useLifecycleOverview(props.workspaceId, props.hub);
  const first = props.userName.split(' ')[0] ?? props.userName;
  const inProgress = mine?.filter((i) => i.stateGroup === 'started').length ?? 0;
  return (
    <div className="pe-page">
      {props.headless ? null : (
        <PageHeader
          eyebrow={props.workspaceName}
          title={greeting(new Date()) + ', ' + first}
          subtitle="Where your work and your team's work stand right now."
        />
      )}
      <div className="pe-stats">
        <Stat label="Assigned to you" icon="task" value={mine ? mine.length : '…'} />
        <Stat label="In progress" icon="bolt" value={mine ? inProgress : '…'} />
        <Stat
          label="Projects"
          icon="folder"
          value={projects ? projects.filter((p) => !p.archived).length : '…'}
        />
        <Stat
          label="Events today"
          icon="pulse"
          value={
            events
              ? events.filter((e) => new Date(e.time).toDateString() === new Date().toDateString())
                  .length
              : '…'
          }
        />
      </div>
      {props.insights}
      <div className="pe-columns">
        <Card
          title="My tasks"
          subtitle="Open and assigned to you, in progress first"
          actions={
            <a
              className="pe-btn pe-btn--text"
              href="/my-work"
              onClick={follow('/my-work', props.go)}
            >
              All my work
            </a>
          }
        >
          {mine ? (
            <MyWorkTable items={mine} go={props.go} limit={8} />
          ) : (
            <p className="pe-muted" role="status">
              Loading…
            </p>
          )}
        </Card>
        <Card
          title="Recent activity"
          actions={
            <a
              className="pe-btn pe-btn--text"
              href="/activity"
              onClick={follow('/activity', props.go)}
            >
              All activity
            </a>
          }
        >
          {events ? (
            <ActivityList events={events} go={props.go} compact />
          ) : (
            <p className="pe-muted" role="status">
              Loading…
            </p>
          )}
        </Card>
      </div>
      <Card title="Projects">
        {projects ? (
          <ProjectGrid
            projects={projects.filter((p) => !p.archived).slice(0, 6)}
            go={props.go}
            lifecycle={lifecycle}
          />
        ) : (
          <p className="pe-muted" role="status">
            Loading…
          </p>
        )}
      </Card>
    </div>
  );
}

export function MyWorkPage(props: {
  workspaceId: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const mine = useMyWork(props.workspaceId, props.hub);
  const groups: [string, string][] = [
    ['started', 'In progress'],
    ['unstarted', 'Up next'],
    ['backlog', 'Backlog'],
  ];
  return (
    <div className="pe-page">
      <PageHeader
        title="My work"
        subtitle="Everything open that is assigned to you, across all projects."
      />
      {!mine ? (
        <p className="pe-muted" role="status">
          Loading…
        </p>
      ) : mine.length === 0 ? (
        <Card>
          <EmptyState icon="task" title="Nothing assigned to you">
            {/* [PCODE-423 | S15 | v0.1.0] words for everyone, not only for the terminal */}
            Tasks given to you show here. Pick one up in a project, or ask your lead for one.
          </EmptyState>
        </Card>
      ) : (
        groups.map(([group, label]) => {
          const list = mine.filter((i) => i.stateGroup === group);
          return list.length ? (
            <Card
              key={group}
              title={label}
              subtitle={String(list.length) + (list.length === 1 ? ' task' : ' tasks')}
            >
              <MyWorkTable items={list} go={props.go} />
            </Card>
          ) : null;
        })
      )}
    </div>
  );
}

// [PCODE-118 | S15 | v0.1.0] where each project stands in its lifecycle
export interface LifecyclePosition {
  projectId: string;
  phaseName: string;
  gates: { key: string; name: string; status: string }[];
}

export function useLifecycleOverview(
  workspaceId: string,
  hub: EventHub,
): Map<string, LifecyclePosition> {
  const [rows, setRows] = useState<LifecyclePosition[]>([]);
  const load = useCallback(async () => {
    const r = await api<LifecyclePosition[]>('GET', W(workspaceId, '/lifecycle'));
    if (r.ok) setRows(r.data);
  }, [workspaceId]);
  useEffect(() => {
    void load();
    return hub.on((e) => {
      const t = e.data.object.type;
      if (t === 'gate' || t === 'stage' || e.type === 'orqiva.workspace.resync') void load();
    });
  }, [load, hub]);
  return new Map(rows.map((r) => [r.projectId, r]));
}

export function ProjectGrid(props: {
  projects: Project[];
  go: (p: string) => void;
  lifecycle?: Map<string, LifecyclePosition>;
}): ReactNode {
  if (props.projects.length === 0)
    return (
      <EmptyState icon="folder" title="No projects yet">
        Create one to start tracking work.
      </EmptyState>
    );
  return (
    <ul className="pe-project-grid">
      {props.projects.map((p) => (
        <li key={p.id}>
          <a
            className="pe-project-card"
            href={projectPath(p.id)}
            onClick={follow(projectPath(p.id), props.go)}
          >
            <span className="pe-project-key">{p.key}</span>
            <span className="pe-project-name">{p.name}</span>
            <span className="pe-project-desc">{p.description || 'No description yet.'}</span>
            {p.archived ? <span className="pe-chip">Archived</span> : null}
            {props.lifecycle?.get(p.id) ? (
              <span className="pe-project-phase">
                <span className="pe-chip">{props.lifecycle.get(p.id)?.phaseName}</span>
                {props.lifecycle.get(p.id)?.gates.map((g) => (
                  <span
                    key={g.key}
                    className={'pe-gate-dot pe-gate--' + g.status}
                    title={g.name + ': ' + g.status}
                  />
                ))}
              </span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function NewProjectDialog(props: {
  onCreate: (key: string, name: string, description: string) => Promise<string | null>;
  onClose: () => void;
}): ReactNode {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (): void => {
    if (!name.trim()) {
      setError('Name the project.');
      return;
    }
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
      setError(
        'The key is 2–10 capital letters or digits, starting with a letter, e.g. APP. It starts every task number: APP-12.',
      );
      return;
    }
    setBusy(true);
    void props.onCreate(key, name.trim(), description.trim()).then((err) => {
      setBusy(false);
      if (err) setError(err);
      else props.onClose();
    });
  };
  return (
    <Dialog
      title="New project"
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="pe-btn pe-btn--text" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" className="pe-btn pe-btn--primary" disabled={busy} onClick={submit}>
            Create project
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="pe-field">
          <label htmlFor="np-name">Name</label>
          <input
            id="np-name"
            className="pe-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!key || key === suggestKey(name)) setKey(suggestKey(e.target.value));
            }}
          />
        </div>
        <div className="pe-field">
          <label htmlFor="np-key">Key</label>
          <input
            id="np-key"
            className="pe-input pe-input--key"
            value={key}
            aria-describedby="np-key-hint"
            onChange={(e) => {
              setKey(e.target.value.toUpperCase());
            }}
          />
          <span id="np-key-hint" className="pe-small pe-muted">
            Starts every task number, e.g. {key || 'APP'}-12. It cannot be changed later.
          </span>
        </div>
        <div className="pe-field">
          <label htmlFor="np-desc">Description</label>
          <textarea
            id="np-desc"
            className="pe-input pe-textarea"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </div>
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function suggestKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const k = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4);
  return /^[A-Z]/.test(k) ? k.slice(0, 10) : '';
}

export function ProjectsPage(props: {
  workspaceId: string;
  canCreate: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const [projects, load] = useProjects(props.workspaceId, props.hub);
  const lifecycle = useLifecycleOverview(props.workspaceId, props.hub);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const archived = projects?.filter((p) => p.archived).length ?? 0;
  return (
    <div className="pe-page">
      <PageHeader
        title="Projects"
        subtitle="Every project of this workspace, with its people and agents."
        actions={
          props.canCreate ? (
            <button
              type="button"
              className="pe-btn pe-btn--primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              <Icon name="plus" size={18} /> New project
            </button>
          ) : null
        }
      />
      <Card>
        {projects ? (
          <ProjectGrid
            projects={projects.filter((p) => showArchived || !p.archived)}
            go={props.go}
            lifecycle={lifecycle}
          />
        ) : (
          <p className="pe-muted" role="status">
            Loading…
          </p>
        )}
        {archived ? (
          <button
            type="button"
            className="pe-btn pe-btn--text"
            onClick={() => {
              setShowArchived((x) => !x);
            }}
          >
            {showArchived ? 'Hide archived' : 'Show ' + String(archived) + ' archived'}
          </button>
        ) : null}
      </Card>
      {creating ? (
        <NewProjectDialog
          onClose={() => {
            setCreating(false);
          }}
          onCreate={async (key, name, description) => {
            const r = await api<Project>('POST', W(props.workspaceId, '/projects'), {
              key,
              name,
              description,
            });
            if (!r.ok)
              return r.error.status === 409 ? 'The key ' + key + ' is taken.' : r.error.message;
            await load();
            props.go(projectPath(r.data.id));
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

export { useActivity, useMyWork, useProjects };
