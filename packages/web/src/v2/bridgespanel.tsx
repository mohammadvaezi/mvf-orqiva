// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
//    Why:  Settings › Integrations: the optional Slack and Teams bridges with what each posts and how it
//          goes; everyone's own calendar link (on their profile too); and a project's latest pipeline runs
//          under its repositories.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

const TOPIC_TEXT: Record<string, string> = {
  incidents: 'Incidents opened and resolved',
  releases: 'Releases shipped and rolled back',
  deploys: 'Deploys finished or failed',
  ci: 'Failed CI runs and test runs',
};

interface Bridge {
  id: string;
  kind: 'slack' | 'teams';
  name: string;
  topics: string[];
  channelName: string | null;
  active: boolean;
  sent: number;
  lastError: string;
  lastAt: string | null;
}

/** What a bridge posts, in words. */
export function bridgeSummary(b: Pick<Bridge, 'topics' | 'channelName'>): string {
  const parts = b.topics.map((t) => (TOPIC_TEXT[t] ?? t).toLowerCase());
  if (b.channelName) parts.push('the messages of #' + b.channelName);
  return parts.length ? parts.join(', ') : 'nothing yet';
}

export function BridgesPanel(props: { workspaceId: string; onChanged: () => void }): ReactNode {
  const [list, setList] = useState<Bridge[]>([]);
  const [channels, setChannels] = useState<{ id: string; name: string | null; kind: string }[]>([]);
  const [form, setForm] = useState({
    kind: 'slack' as 'slack' | 'teams',
    name: '',
    url: '',
    topics: ['incidents'] as string[],
    channelId: '',
  });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [b, c] = await Promise.all([
      api<{ bridges: Bridge[] }>('GET', W(props.workspaceId, '/chat-bridges')),
      api<{ id: string; name: string | null; kind: string }[]>(
        'GET',
        W(props.workspaceId, '/channels'),
      ),
    ]);
    if (b.ok) setList(b.data.bridges);
    if (c.ok && Array.isArray(c.data)) setChannels(c.data.filter((x) => x.kind !== 'direct'));
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async (): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, '/chat-bridges'), {
      kind: form.kind,
      name: form.name.trim(),
      url: form.url.trim(),
      topics: form.topics,
      ...(form.channelId ? { channelId: form.channelId } : {}),
    });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setForm({ ...form, name: '', url: '' });
    await load();
    props.onChanged();
  };
  const test = async (id: string): Promise<void> => {
    const r = await api<{ ok: boolean; error: string }>(
      'POST',
      W(props.workspaceId, '/chat-bridges/' + id + '/test'),
    );
    setNote(
      r.ok
        ? r.data.ok
          ? 'The test message went out.'
          : 'The chat did not take it: ' + r.data.error
        : r.error.message,
    );
    await load();
  };
  const remove = async (id: string): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/chat-bridges/' + id));
    await load();
    props.onChanged();
  };
  return (
    <Card title="Slack and Teams">
      <div id="bridges" className="pv-stack">
        <p className="pv-small pv-muted">
          Optional. Conversations stay in Orqiva; a bridge posts what you choose to a Slack channel
          (an incoming webhook) or a Teams channel (a workflow that takes webhooks). The address is
          kept sealed and not shown again.
        </p>
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        {note ? <p className="pv-small">{note}</p> : null}
        {list.length ? (
          <ul className="pv-list">
            {list.map((b) => (
              <li key={b.id} className="pv-integration">
                <span className="pv-row-main">
                  <span className="pv-row-title">
                    {b.kind === 'slack' ? 'Slack' : 'Teams'} · {b.name}
                  </span>
                  <span className="pv-row-sub">
                    Posts {bridgeSummary(b)} · {b.sent} sent
                    {b.lastError ? ' · last error: ' + b.lastError : ''}
                  </span>
                </span>
                <Chip tone={!b.active ? 'danger' : b.lastError ? 'warning' : 'success'}>
                  {!b.active ? 'stopped' : b.lastError ? 'failing' : 'on'}
                </Chip>
                <span className="pv-home-actions">
                  <Button size="sm" kind="ghost" onClick={() => void test(b.id)}>
                    Test
                  </Button>
                  <Button size="sm" kind="ghost" onClick={() => void remove(b.id)}>
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="v2-inline">
          <select
            className="v2-input v2-input--sm"
            aria-label="Chat"
            value={form.kind}
            onChange={(e) => {
              setForm({ ...form, kind: e.target.value as 'slack' | 'teams' });
            }}
          >
            <option value="slack">Slack</option>
            <option value="teams">Microsoft Teams</option>
          </select>
          <input
            className="v2-input v2-input--sm"
            aria-label="Name of the bridge"
            placeholder="Name, e.g. #ops"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
            }}
          />
          <input
            className="v2-input v2-input--sm pv-grow"
            aria-label="Webhook address"
            placeholder={
              form.kind === 'slack'
                ? 'https://hooks.slack.com/services/…'
                : 'https://…logic.azure.com/workflows/…'
            }
            value={form.url}
            onChange={(e) => {
              setForm({ ...form, url: e.target.value });
            }}
          />
        </div>
        <div className="v2-inline">
          {Object.entries(TOPIC_TEXT).map(([k, label]) => (
            <label key={k} className="v2-check">
              <input
                type="checkbox"
                checked={form.topics.includes(k)}
                onChange={() => {
                  setForm({
                    ...form,
                    topics: form.topics.includes(k)
                      ? form.topics.filter((x) => x !== k)
                      : [...form.topics, k],
                  });
                }}
              />
              {label}
            </label>
          ))}
          <select
            className="v2-input v2-input--sm"
            aria-label="Channel to mirror"
            value={form.channelId}
            onChange={(e) => {
              setForm({ ...form, channelId: e.target.value });
            }}
          >
            <option value="">No channel mirrored</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                Mirror #{c.name ?? 'channel'}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            kind="primary"
            disabled={
              !form.name.trim() || !form.url.trim() || (!form.topics.length && !form.channelId)
            }
            onClick={() => void add()}
          >
            Add the bridge
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Each person's own link to their dates, for Google Calendar or Outlook. */
export function CalendarFeedCard(props: { workspaceId: string }): ReactNode {
  const [d, setD] = useState<{ url: string | null; readAt: string | null } | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ url: string | null; readAt: string | null }>(
      'GET',
      W(props.workspaceId, '/calendar-feed'),
    );
    if (r.ok) setD(r.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!d) return null;
  return (
    <Card title="Your calendar">
      <div id="calendar" className="pv-stack">
        <p className="pv-small pv-muted">
          Your tasks’ due dates, your sprints, days off, on-call shifts and meetings in Google
          Calendar or Outlook: add this link there as a calendar from the internet. Anyone with the
          link sees these dates; make a new one if it got out.
        </p>
        {d.url ? (
          <>
            <code className="pv-code pv-break">{d.url}</code>
            <span className="pv-small pv-muted">
              {d.readAt
                ? 'Last read by your calendar ' + new Date(d.readAt).toLocaleString(fmtLocale())
                : 'Not read yet'}
            </span>
          </>
        ) : null}
        <div className="v2-inline">
          <Button
            size="sm"
            kind={d.url ? 'ghost' : 'primary'}
            onClick={() =>
              void api('POST', W(props.workspaceId, '/calendar-feed')).then(() => load())
            }
          >
            {d.url ? 'Make a new link' : 'Make my calendar link'}
          </Button>
          {d.url ? (
            <Button
              size="sm"
              kind="ghost"
              onClick={() =>
                void api('DELETE', W(props.workspaceId, '/calendar-feed')).then(() => load())
              }
            >
              Stop the link
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

interface CiRun {
  id: string;
  pipeline: string;
  status: 'running' | 'passed' | 'failed' | 'cancelled';
  branch: string;
  sha: string;
  url: string;
  itemRefs: string[];
  startedAt: string;
}

const CI_TONE = {
  running: 'info',
  passed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
} as const;

/** A project's latest pipeline runs, under its repositories. */
export function CiRuns(props: { workspaceId: string; projectId: string }): ReactNode {
  const [runs, setRuns] = useState<CiRun[] | null>(null);
  useEffect(() => {
    void api<{ runs: CiRun[] }>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/ci-runs'),
    ).then((r) => {
      if (r.ok) setRuns(r.data.runs);
    });
  }, [props.workspaceId, props.projectId]);
  if (!runs) return null;
  return (
    <div className="pv-app v2-part pv-mt">
      <Card title="CI pipelines">
        {runs.length ? (
          <table className="pv-table">
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.url ? (
                      <a className="pv-link" href={r.url} target="_blank" rel="noreferrer">
                        {r.pipeline}
                      </a>
                    ) : (
                      r.pipeline
                    )}
                  </td>
                  <td className="pv-small pv-muted">
                    {r.branch}
                    {r.sha ? ' · ' + r.sha.slice(0, 7) : ''}
                    {r.itemRefs.length ? ' · ' + r.itemRefs.join(', ') : ''}
                  </td>
                  <td>
                    <Chip tone={CI_TONE[r.status]}>{r.status}</Chip>
                  </td>
                  <td className="pv-small pv-muted">
                    {new Date(r.startedAt).toLocaleString(fmtLocale())}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-small pv-muted">
            No runs reported yet. A pipeline reports each run with an access token: POST to the
            project’s ci-runs with its id, pipeline, status, branch, commit and link.
          </p>
        )}
      </Card>
    </div>
  );
}
