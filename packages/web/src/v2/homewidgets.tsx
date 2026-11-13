// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-347 | S15 | v0.1.0] T35.1b Homes for developers and testers with widgets the person chooses ──
//    Why:  below the band of Home, the widgets of this person's kind of home: a developer's, a tester's or a
//          lead's. "Choose widgets" adds, removes and orders them, kept for the person; "Back to the preset"
//          forgets the choice; another kind of home can be tried.
import {
  HOME_PRESETS,
  HOME_WIDGETS,
  hoursText,
  moveWidget,
  type HomePersona,
  type HomeWidget,
} from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface HomeData {
  persona: HomePersona;
  custom: boolean;
  widgets: HomeWidget[];
  data: Record<string, unknown>;
}

type Row = Record<string, string | number | boolean | null>;
const PERSONA: Record<HomePersona, string> = {
  developer: 'a developer',
  tester: 'a tester',
  lead: 'a lead',
};

const link =
  (to: string, go: (p: string) => void) =>
  (e: { preventDefault: () => void; metaKey: boolean; ctrlKey: boolean }) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    go(to);
  };

/** One line of a widget: what it is, a note, and where it goes. */
function Line(props: {
  to: string;
  go: (p: string) => void;
  main: string;
  sub?: string;
  chip?: ReactNode;
}): ReactNode {
  return (
    <li>
      <a href={props.to} className="pv-row" onClick={link(props.to, props.go)}>
        <span className="pv-row-main">
          <span className="pv-row-title">{props.main}</span>
          {props.sub ? <span className="pv-row-sub">{props.sub}</span> : null}
        </span>
        {props.chip}
      </a>
    </li>
  );
}

const s = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

/** What a widget shows, from its data. */
export function widgetLines(
  w: HomeWidget,
  data: unknown,
): {
  to: string;
  main: string;
  sub: string;
  tone?: 'danger' | 'warning' | 'success' | undefined;
  chip?: string;
}[] {
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  switch (w) {
    case 'my-tasks':
      return rows.map((r) => ({
        to: '/items/' + s(r['id']),
        main: s(r['ref']) + ' ' + s(r['title']),
        sub: s(r['state']),
      }));
    case 'reviews':
      return rows.map((r) => ({
        to: '/projects/' + s(r['projectId']) + '/git',
        main: '#' + s(r['number']) + ' ' + s(r['title']),
        sub: s(r['projectKey']) + ' · by ' + s(r['author']),
      }));
    case 'my-runs':
      return rows.map((r) => ({
        to: '/runs/' + s(r['id']),
        main: s(r['instruction']),
        sub: s(r['agent']),
        chip: s(r['status']),
        tone:
          r['status'] === 'failed' ? 'danger' : r['status'] === 'waiting' ? 'warning' : undefined,
      }));
    case 'deploys':
      return rows.map((r) => ({
        to: '/deploys/' + s(r['id']),
        main: s(r['projectKey']) + ' to ' + s(r['environment']),
        sub: s(r['ref']).slice(0, 12),
        chip: s(r['status']),
        tone:
          r['status'] === 'failed' ? 'danger' : r['status'] === 'succeeded' ? 'success' : undefined,
      }));
    case 'my-tests':
      return rows.map((r) => ({
        to: '/test-runs/' + s(r['id']),
        main: s(r['projectKey']) + ' ' + s(r['name']),
        sub: s(r['mine']) + ' cases for you',
        ...(Number(r['failing'])
          ? { chip: s(r['failing']) + ' failing', tone: 'danger' as const }
          : {}),
      }));
    case 'failing-tests':
      return rows.map((r) => ({
        to: '/test-runs/' + s(r['runId']),
        main: s(r['title']),
        sub: s(r['run']),
        chip: s(r['status']),
        tone: 'danger' as const,
      }));
    case 'bugs-to-verify':
      return rows.map((r) => ({
        to: '/items/' + s(r['id']),
        main: s(r['ref']) + ' ' + s(r['title']),
        sub: s(r['state']),
      }));
    case 'incidents':
      return rows.map((r) => ({
        to: '/incidents',
        main: s(r['ref']) + ' ' + s(r['title']),
        sub: (r['projectKey'] ? s(r['projectKey']) + ' · ' : '') + s(r['state']),
        chip: s(r['severity']).toUpperCase().replace('SEV', 'SEV-'),
        tone: r['severity'] === 'sev1' || r['severity'] === 'sev2' ? 'danger' : 'warning',
      }));
    case 'time-today': {
      const t = (data ?? {}) as { minutes?: number; running?: boolean };
      return [
        {
          to: '/time',
          main: hoursText(t.minutes ?? 0, fmtLocale()) + ' h booked today',
          sub: t.running ? 'a timer is running' : 'no timer running',
          ...(t.running ? { chip: 'timer', tone: 'success' as const } : {}),
        },
      ];
    }
  }
}

const EMPTY: Record<HomeWidget, string> = {
  'my-tasks': 'No open tasks for you.',
  reviews: 'No pull requests wait for a review.',
  'my-runs': 'You have not asked an agent yet.',
  deploys: 'No deploys yet.',
  'my-tests': 'No running test runs for you.',
  'failing-tests': 'Nothing failed in the last two weeks.',
  'bugs-to-verify': 'No bugs wait to be checked.',
  'time-today': '',
  incidents: 'No open incidents.',
};

export function HomeWidgets(props: {
  workspaceId: string;
  userId: string;
  go: (p: string) => void;
}): ReactNode {
  const [d, setD] = useState<HomeData | null>(null);
  const [trying, setTrying] = useState<HomePersona | null>(null);
  const [editing, setEditing] = useState<HomeWidget[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<HomeData>(
      'GET',
      W(props.workspaceId, '/home' + (trying ? '?persona=' + trying : '')),
    );
    if (r.ok) setD(r.data);
    else setError(r.error.message);
  }, [props.workspaceId, trying]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (list: HomeWidget[] | null): Promise<void> => {
    const r = list
      ? await api('PUT', W(props.workspaceId, '/settings/home.widgets'), {
          scope: 'user',
          scopeId: props.userId,
          value: list,
        })
      : await api(
          'DELETE',
          W(props.workspaceId, '/settings/home.widgets?scope=user&scopeId=' + props.userId),
        );
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setEditing(null);
    setTrying(null);
    await load();
  };
  if (!d)
    return error ? (
      <p className="v2-error" role="alert">
        {error}
      </p>
    ) : null;
  return (
    <div className="pv-stack pv-mt">
      <div className="v2-inline">
        <strong>Your home</strong>
        <span className="pv-small pv-muted">
          {trying
            ? 'Trying the home of ' + PERSONA[trying]
            : d.custom
              ? 'Your own widgets'
              : 'The home of ' + PERSONA[d.persona]}
        </span>
        <span className="pv-home-actions">
          <select
            className="v2-input v2-input--sm"
            aria-label="Try another kind of home"
            value={trying ?? ''}
            onChange={(e) => {
              setTrying((e.target.value || null) as HomePersona | null);
            }}
          >
            <option value="">{d.custom ? 'My widgets' : 'My home'}</option>
            <option value="developer">A developer’s home</option>
            <option value="tester">A tester’s home</option>
            <option value="lead">A lead’s home</option>
          </select>
          {editing ? null : (
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setEditing(d.widgets);
              }}
            >
              Choose widgets
            </Button>
          )}
        </span>
      </div>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {editing ? (
        <Card title="Choose the widgets of your home">
          <ul className="pv-home-pick">
            {(Object.keys(HOME_WIDGETS) as HomeWidget[]).map((w) => {
              const on = editing.includes(w);
              return (
                <li key={w} className="v2-inline">
                  <label className="v2-check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        setEditing(on ? editing.filter((x) => x !== w) : [...editing, w]);
                      }}
                    />
                    {HOME_WIDGETS[w]}
                  </label>
                  {on ? (
                    <span className="pv-home-actions">
                      <span className="pv-small pv-muted">place {editing.indexOf(w) + 1}</span>
                      <Button
                        size="sm"
                        kind="ghost"
                        title={'Move ' + HOME_WIDGETS[w] + ' up'}
                        onClick={() => {
                          setEditing(moveWidget(editing, w, -1));
                        }}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        kind="ghost"
                        title={'Move ' + HOME_WIDGETS[w] + ' down'}
                        onClick={() => {
                          setEditing(moveWidget(editing, w, 1));
                        }}
                      >
                        ↓
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="v2-inline pv-mt">
            <Button kind="primary" disabled={!editing.length} onClick={() => void save(editing)}>
              Save
            </Button>
            <Button kind="ghost" onClick={() => void save(null)}>
              Back to the preset
            </Button>
            <Button
              kind="ghost"
              onClick={() => {
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <span className="pv-small pv-muted">
              Preset of {PERSONA[d.persona]}:{' '}
              {HOME_PRESETS[d.persona].map((w) => HOME_WIDGETS[w]).join(', ')}
            </span>
          </div>
        </Card>
      ) : null}
      <div className="pv-home-grid">
        {d.widgets.map((w) => {
          const lines = widgetLines(w, d.data[w]);
          return (
            <Card key={w} title={HOME_WIDGETS[w]} flush>
              {lines.length ? (
                <ul className="pv-rows">
                  {lines.map((l, i) => (
                    <Line
                      key={l.to + String(i)}
                      to={l.to}
                      go={props.go}
                      main={l.main}
                      sub={l.sub}
                      chip={
                        l.chip ? (
                          <Chip {...(l.tone ? { tone: l.tone } : {})}>{l.chip}</Chip>
                        ) : undefined
                      }
                    />
                  ))}
                </ul>
              ) : (
                <p className="pv-muted v2-pad">{EMPTY[w]}</p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
