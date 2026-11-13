// ── [PCODE-432 | S15 | v0.1.0] T37 medium: The empty home guides a new workspace ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-114 | S15 | v0.1.0] Add the Home dashboard and project overview with our own charts ──
// ── [PCODE-116 | S15 | v0.1.0] Restyle the web app after the owner's reference kit: gradient band, hero cards, KPI tiles, lavender sidebar ──
//    Why:  the charts of the Home page (every project at a glance, the team's pace) and of a project's
//          Overview (work by state, pace, the sprint burndown, open work by person). The numbers come
//          from the stats endpoints and are read again when the live stream says work moved.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import { Burndown, Donut, HBars, Kpi, WeeklyBars } from './charts.js';
import type { EventHub } from './core/hub.js';
import { projectPath } from './core/nav.js';
import { W } from './pages.js';
import { Card, EmptyState } from './shell.js';

interface Week {
  week: string;
  created: number;
  completed: number;
}

export interface WorkspaceStats {
  projects: {
    projectId: string;
    key: string;
    name: string;
    backlog: number;
    unstarted: number;
    started: number;
    completed: number;
    cancelled: number;
  }[];
  weekly: Week[];
}

export interface ProjectStats {
  byState: { stateId: string; name: string; group: string; color: string; count: number }[];
  byAssignee: { userId: string | null; name: string; open: number }[];
  weekly: Week[];
  burndown: {
    sprintId: string;
    name: string;
    total: number;
    days: { date: string; remaining: number | null }[];
  } | null;
}

/** Reads a stats endpoint, and again (gathered over a second) whenever items or sprints change. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T names the shape of the answer
function useStats<T>(path: string, hub: EventHub, projectId?: string): T | null {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(async () => {
    const r = await api<T>('GET', path);
    if (r.ok) setData(r.data);
  }, [path]);
  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = hub.on((e) => {
      if (projectId && e.projectid !== projectId) return;
      const t = e.data.object.type;
      if (t !== 'item' && t !== 'sprint' && t !== 'project' && e.type !== 'orqiva.workspace.resync')
        return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
      }, 1000);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [load, hub, projectId]);
  return data;
}

const GROUPS: { key: 'started' | 'unstarted' | 'backlog' | 'completed'; label: string }[] = [
  { key: 'started', label: 'In progress' },
  { key: 'unstarted', label: 'To do' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'completed', label: 'Done' },
];

export function WorkspaceInsights(props: {
  workspaceId: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const stats = useStats<WorkspaceStats>(W(props.workspaceId, '/stats'), props.hub);
  if (!stats) return null;
  const totals = GROUPS.map((g) => ({
    ...g,
    value: stats.projects.reduce((n, p) => n + p[g.key], 0),
  }));
  const finished12 = stats.weekly.reduce((n, w) => n + w.completed, 0);
  // [PCODE-432 | S15 | v0.1.0] no work yet: say so instead of drawing empty charts
  if (!totals.some((x) => x.value > 0) && !finished12)
    return (
      <Card title="Charts">
        <p className="pe-muted">
          The charts fill in as soon as there are tasks: how many get done each week, what is in
          progress, and how each project stands.
        </p>
      </Card>
    );
  return (
    <>
      <PaceKpis
        weeks={stats.weekly}
        third={{
          label: 'In progress now',
          hint: 'by project',
          bars: stats.projects.map((p) => p.started),
        }}
      />
      <div className="pe-chart-grid-layout">
        <Card
          title="Throughput"
          subtitle={
            'Tasks created and finished per week · ' + String(finished12) + ' finished in 12 weeks'
          }
          className="pe-span-2"
        >
          <WeeklyBars
            title="Tasks created and finished per week, last 12 weeks"
            weeks={stats.weekly}
          />
        </Card>
        <Card title="Status of all work">
          <Donut
            title="All tasks by status"
            slices={totals.map((g) => ({
              label: g.label,
              value: g.value,
              color: GROUP_COLOR[g.key],
            }))}
            centerLabel="tasks"
          />
        </Card>
        <Card title="Tasks by project" subtitle="By status" className="pe-span-3">
          {stats.projects.length ? (
            <HBars
              title="Tasks by status per project"
              go={props.go}
              legend={GROUPS.map((g) => ({ label: g.label, color: GROUP_COLOR[g.key] }))}
              rows={stats.projects.map((p) => ({
                label: p.key + ' · ' + p.name,
                href: projectPath(p.projectId),
                parts: GROUPS.map((g) => ({
                  label: g.label,
                  value: p[g.key],
                  color: GROUP_COLOR[g.key],
                })),
              }))}
            />
          ) : (
            <EmptyState icon="folder" title="No projects yet" />
          )}
        </Card>
      </div>
    </>
  );
}

/** [PCODE-116 | S15 | v0.1.0] three KPI tiles: this week against the last, with the weeks as bars */
function PaceKpis(props: {
  weeks: Week[];
  third: { label: string; hint: string; bars: number[] };
}): ReactNode {
  const last = props.weeks.slice(-6);
  const now = last[last.length - 1] ?? { week: '', created: 0, completed: 0 };
  const before = last[last.length - 2] ?? { week: '', created: 0, completed: 0 };
  const third = props.third.bars.length ? props.third.bars : [0];
  return (
    <div className="pe-kpis">
      <Kpi
        label="Finished this week"
        value={now.completed}
        delta={now.completed - before.completed}
        hint="against last week"
        tone="coral"
        bars={last.map((w) => w.completed)}
      />
      <Kpi
        label="Created this week"
        value={now.created}
        delta={now.created - before.created}
        hint="against last week"
        tone="indigo"
        bars={last.map((w) => w.created)}
      />
      <Kpi
        label={props.third.label}
        value={third.reduce((n, v) => n + v, 0)}
        hint={props.third.hint}
        tone="teal"
        bars={third.slice(0, 7)}
        highlight={third.indexOf(Math.max(...third))}
      />
    </div>
  );
}

/** Group colours: the board's own state colours, so a chart and the board say the same thing. */
const GROUP_COLOR: Record<'started' | 'unstarted' | 'backlog' | 'completed', string> = {
  started: '#f59e0b',
  unstarted: '#3f76ff',
  backlog: '#8b8d98',
  completed: '#16a34a',
};

export function ProjectCharts(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
}): ReactNode {
  const stats = useStats<ProjectStats>(
    W(props.workspaceId, '/projects/' + props.projectId + '/stats'),
    props.hub,
    props.projectId,
  );
  if (!stats) return null;
  const done = stats.byState
    .filter((s) => s.group === 'completed')
    .reduce((n, s) => n + s.count, 0);
  const all = stats.byState.reduce((n, s) => n + s.count, 0);
  const remaining =
    stats.burndown?.days.flatMap((d) => (d.remaining === null ? [] : [d.remaining])) ?? [];
  return (
    <>
      <PaceKpis
        weeks={stats.weekly}
        third={
          stats.burndown
            ? { label: 'Left in the sprint', hint: stats.burndown.name, bars: remaining.slice(-7) }
            : {
                label: 'Open by person',
                hint: 'open tasks',
                bars: stats.byAssignee.map((a) => a.open),
              }
        }
      />
      <div className="pe-chart-grid-layout">
        <Card title="Work by state">
          <Donut
            title="Tasks by state"
            slices={stats.byState.map((s) => ({ label: s.name, value: s.count, color: s.color }))}
            center={all ? String(Math.round((done / all) * 100)) + '%' : '0%'}
            centerLabel="done"
          />
        </Card>
        <Card title="Pace" subtitle="Created and finished per week" className="pe-span-2">
          <WeeklyBars
            title="Tasks created and finished per week, last 12 weeks"
            weeks={stats.weekly}
          />
        </Card>
        {stats.burndown ? (
          <Card
            title="Sprint burndown"
            subtitle={stats.burndown.name + ' · ' + String(stats.burndown.total) + ' tasks'}
            className="pe-span-2"
          >
            <Burndown
              title={'Remaining tasks in ' + stats.burndown.name}
              total={stats.burndown.total}
              days={stats.burndown.days}
            />
          </Card>
        ) : null}
        <Card title="Open work by person" className={stats.burndown ? undefined : 'pe-span-3'}>
          {stats.byAssignee.length ? (
            <HBars
              title="Open tasks by person"
              rows={stats.byAssignee.map((a) => ({
                label: a.name,
                parts: [{ label: 'Open', value: a.open, className: 'pe-series-1' }],
              }))}
            />
          ) : (
            <EmptyState icon="users" title="Nothing open" />
          )}
        </Card>
      </div>
    </>
  );
}
