// ── [PCODE-305 | S15 | v0.1.0] T31.5b The merge queue: in order per branch, merged through the host when the policy passes ──
//    Why:  the merge queue in Versions → Review: one line per repository and base branch, in order, with
//          "Merge next" and what the last attempt said; what left the line lately and why. On a pull
//          request, the button that puts it in line.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { ago } from './inbox.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface QueueEntry {
  id: string;
  pullId: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  branch: string;
  base: string;
  lane: string;
  method: string;
  state: 'queued' | 'merged' | 'removed';
  reason: string;
  addedBy: string | null;
  addedAt: string;
  finishedAt: string | null;
}
interface Outcome {
  outcome: 'merged' | 'merging' | 'removed' | 'waiting' | 'empty';
  number: number | null;
  reason: string;
}

export interface Lane {
  lane: string;
  repo: string;
  base: string;
  queued: QueueEntry[];
}

/** The lines in the order their first entry was added. */
export function lanesOf(entries: readonly QueueEntry[]): Lane[] {
  const out = new Map<string, Lane>();
  for (const e of entries) {
    if (e.state !== 'queued') continue;
    const l = out.get(e.lane) ?? { lane: e.lane, repo: e.repo, base: e.base, queued: [] };
    l.queued.push(e);
    out.set(e.lane, l);
  }
  return [...out.values()];
}

/** What "Merge next" came to, in a sentence. */
export function outcomeText(o: Outcome): string {
  const n = o.number === null ? '' : '#' + String(o.number) + ' ';
  switch (o.outcome) {
    case 'merged':
      return n + 'merged.';
    case 'merging':
      return n + 'is being merged: ' + o.reason + '.';
    case 'removed':
      return n + 'left the queue: ' + o.reason + '.';
    case 'waiting':
      return n + 'keeps its place: ' + o.reason + '.';
    case 'empty':
      return 'Nothing waits in this line.';
  }
}

const STATE_TONE = { merged: 'success', removed: 'warning', queued: 'info' } as const;

export function MergeQueue(props: {
  workspaceId: string;
  projectId: string;
  /** after a merge the review queue changes too */
  changed: () => void;
}): ReactNode {
  const [entries, setEntries] = useState<QueueEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<Record<string, { ok: boolean; text: string }>>({});
  const base = W(props.workspaceId, '/projects/' + props.projectId + '/merge-queue');
  const load = useCallback(() => {
    void api<QueueEntry[]>('GET', base).then((r) => {
      if (r.ok) setEntries(r.data);
    });
  }, [base]);
  useEffect(load, [load]);
  if (!entries) return null;
  const lanes = lanesOf(entries);
  const recent = entries
    .filter((e) => e.state !== 'queued')
    .slice(-5)
    .reverse();
  if (!lanes.length && !recent.length) return null;
  const mergeNext = async (lane: string): Promise<void> => {
    setBusy(lane);
    const r = await api<Outcome>('POST', base + '/next', { lane });
    setBusy(null);
    setSaid({
      ...said,
      [lane]: r.ok
        ? {
            ok: r.data.outcome === 'merged' || r.data.outcome === 'merging',
            text: outcomeText(r.data),
          }
        : { ok: false, text: r.error.message },
    });
    load();
    if (r.ok && r.data.outcome !== 'waiting') props.changed();
  };
  const out = async (e: QueueEntry): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/pull-requests/' + e.pullId + '/queue'));
    load();
  };
  return (
    <Card title="Merge queue">
      {lanes.map((l) => (
        <section key={l.lane} className="v2-mq-lane" aria-label={'Merge queue for ' + l.base}>
          <header className="v2-mq-head">
            <span className="pv-small">
              <span className="pv-mono">{l.repo}</span> → <span className="pv-mono">{l.base}</span>{' '}
              · {l.queued.length} waiting
            </span>
            <Button
              size="sm"
              kind="primary"
              disabled={busy === l.lane}
              onClick={() => void mergeNext(l.lane)}
            >
              {busy === l.lane ? 'Merging…' : 'Merge next'}
            </Button>
          </header>
          <ol className="v2-mq-list pv-small">
            {l.queued.map((e) => (
              <li key={e.id}>
                <span className="pv-mono pv-muted">#{e.number}</span> {e.title}{' '}
                <span className="pv-muted">
                  · {e.method} · added {ago(e.addedAt)} ago{e.addedBy ? ' by ' + e.addedBy : ''}
                </span>
                {e.reason ? <span className="pv-text-warning"> · {e.reason}</span> : null}{' '}
                <button type="button" className="pv-link-btn" onClick={() => void out(e)}>
                  Take out
                </button>
              </li>
            ))}
          </ol>
          {said[l.lane] ? (
            <p
              className={'pv-small ' + (said[l.lane]?.ok ? 'pv-text-success' : 'pv-text-warning')}
              role="status"
            >
              {said[l.lane]?.text}
            </p>
          ) : null}
        </section>
      ))}
      {recent.length ? (
        <>
          <p className="pv-small pv-muted v2-mq-recent">Lately</p>
          <ul className="v2-mq-list pv-small">
            {recent.map((e) => (
              <li key={e.id}>
                <Chip tone={STATE_TONE[e.state]}>{e.state}</Chip>{' '}
                <span className="pv-mono pv-muted">#{e.number}</span> {e.title}
                {e.reason ? <span className="pv-muted"> · {e.reason}</span> : null}
                {e.finishedAt ? <span className="pv-muted"> · {ago(e.finishedAt)} ago</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

/** On a pull request: put it in line, with the way to merge. */
export function QueueButton(props: {
  workspaceId: string;
  pullId: string;
  open: boolean;
}): ReactNode {
  const [method, setMethod] = useState('squash');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  if (!props.open) return null;
  const add = async (): Promise<void> => {
    const r = await api<{ position: number }>(
      'POST',
      W(props.workspaceId, '/pull-requests/' + props.pullId + '/queue'),
      { method },
    );
    setNote(
      r.ok
        ? { ok: true, text: 'In the merge queue, number ' + String(r.data.position) + ' in line.' }
        : { ok: false, text: r.error.message },
    );
  };
  return (
    <span className="v2-mq-add">
      <select
        className="v2-input"
        aria-label="How to merge"
        value={method}
        onChange={(e) => {
          setMethod(e.target.value);
        }}
      >
        <option value="squash">Squash</option>
        <option value="merge">Merge commit</option>
        <option value="rebase">Rebase</option>
      </select>
      <Button size="sm" onClick={() => void add()}>
        Add to merge queue
      </Button>
      {note ? (
        <span
          className={'pv-small ' + (note.ok ? 'pv-text-success' : 'pv-text-danger')}
          role={note.ok ? 'status' : 'alert'}
        >
          {note.text}
        </span>
      ) : null}
    </span>
  );
}
