// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
//    Why:  the comments under a diff's line (the reader's drafts, the AI's suggestions to accept or dismiss,
//          what was posted), the box to write one, and the review form that posts the drafts to the host
//          with approve, request changes or just the comments.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { ago } from './inbox.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface LineComment {
  id: string;
  path: string;
  line: number;
  side: 'new' | 'old';
  body: string;
  source: 'person' | 'ai';
  state: 'suggested' | 'dismissed' | 'draft' | 'posted';
  severity: 'note' | 'warning' | 'risk' | null;
  author: string | null;
  mine: boolean;
  outdated: boolean;
  createdAt: string;
  postedAt: string | null;
}
export interface PostedReview {
  id: string;
  decision: 'approve' | 'request_changes' | 'comment';
  body: string;
  comments: number;
  author: string | null;
  hostRef: string;
  createdAt: string;
}
interface Thread {
  comments: LineComment[];
  reviews: PostedReview[];
}
/** a line a comment can sit on */
export interface LineAt {
  path: string;
  side: 'new' | 'old';
  line: number;
}

export const lineKey = (l: LineAt): string => l.side + ':' + String(l.line) + ':' + l.path;

export const DECISION_TEXT: Record<PostedReview['decision'], string> = {
  approve: 'approved',
  request_changes: 'asked for changes',
  comment: 'commented',
};

const SEVERITY_TONE = { risk: 'danger', warning: 'warning', note: 'info' } as const;

/** "3 drafts will be posted; 1 is on a file that changed and stays here" */
export function draftsText(drafts: readonly LineComment[]): string {
  const fresh = drafts.filter((d) => !d.outdated).length;
  const old = drafts.length - fresh;
  if (!drafts.length) return 'No comments on lines waiting to be posted.';
  return (
    String(fresh) +
    ' comment' +
    (fresh === 1 ? '' : 's') +
    ' on lines will be posted' +
    (old ? '; ' + String(old) + ' on a file that changed since stay here' : '') +
    '.'
  );
}

/** The comments of a pull request and what can be done with them. */
export interface ThreadApi {
  thread: Thread;
  error: string | null;
  /** what the last AI request or review came to */
  news: string | null;
  busy: string | null;
  add: (at: LineAt, body: string) => Promise<boolean>;
  edit: (id: string, body: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  decide: (id: string, accept: boolean) => Promise<boolean>;
  suggest: () => Promise<boolean>;
  submit: (decision: PostedReview['decision'], body: string) => Promise<boolean>;
}

export function useThread(workspaceId: string, pullId: string): ThreadApi {
  const [thread, setThread] = useState<Thread>({ comments: [], reviews: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [news, setNews] = useState<string | null>(null);
  const base = W(workspaceId, '/pull-requests/' + pullId);
  const load = useCallback(() => {
    void api<Thread>('GET', base + '/comments').then((r) => {
      if (r.ok) setThread(r.data);
    });
  }, [base]);
  useEffect(load, [load]);
  const run = async <T,>(
    label: string,
    fn: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>,
    told?: (data: T) => string,
  ): Promise<boolean> => {
    setBusy(label);
    setNews(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.error.message);
    else {
      setError(null);
      if (told) setNews(told(r.data));
      load();
    }
    return r.ok;
  };
  return {
    thread,
    error,
    news,
    busy,
    add: (at: LineAt, body: string) =>
      run('add', () => api('POST', base + '/comments', { ...at, body })),
    edit: (id: string, body: string) =>
      run('edit', () => api('PATCH', W(workspaceId, '/pull-request-comments/' + id), { body })),
    remove: (id: string) =>
      run('remove', () => api('DELETE', W(workspaceId, '/pull-request-comments/' + id))),
    decide: (id: string, accept: boolean) =>
      run('decide', () =>
        api('POST', W(workspaceId, '/pull-request-comments/' + id + '/decide'), { accept }),
      ),
    suggest: () =>
      run(
        'suggest',
        () => api<Thread>('POST', base + '/ai-comments'),
        (t) => {
          const n = t.comments.filter((c) => c.state === 'suggested').length;
          return n
            ? 'The AI suggests ' + String(n) + ' comment' + (n === 1 ? '' : 's') + '.'
            : 'The AI found nothing to comment on.';
        },
      ),
    submit: (decision: PostedReview['decision'], body: string) =>
      run(
        'submit',
        () =>
          api<{ posted: number; outdated: number }>('POST', base + '/reviews', { decision, body }),
        (r) =>
          'Posted to the host' +
          (r.posted ? ' with ' + String(r.posted) + ' comment' + (r.posted === 1 ? '' : 's') : '') +
          (r.outdated ? '; ' + String(r.outdated) + ' on changed files stay here' : '') +
          '.',
      ),
  };
}

function Composer(props: {
  initial?: string;
  label: string;
  save: (body: string) => Promise<boolean>;
  cancel: () => void;
}): ReactNode {
  const [text, setText] = useState(props.initial ?? '');
  return (
    <div className="v2-pr-composer">
      <textarea
        className="v2-input"
        rows={3}
        aria-label={props.label}
        placeholder="What should change, and why?"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <span className="v2-pr-comment-actions">
        <Button
          size="sm"
          kind="primary"
          disabled={!text.trim()}
          onClick={() => {
            void props.save(text.trim()).then((ok) => {
              if (ok) props.cancel();
            });
          }}
        >
          {props.initial === undefined ? 'Add comment' : 'Save'}
        </Button>
        <Button size="sm" kind="ghost" onClick={props.cancel}>
          Cancel
        </Button>
      </span>
    </div>
  );
}

function OneComment(props: { c: LineComment; t: ThreadApi }): ReactNode {
  const { c, t } = props;
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <Composer
        initial={c.body}
        label={'Change your comment on line ' + String(c.line)}
        save={(body) => t.edit(c.id, body)}
        cancel={() => {
          setEditing(false);
        }}
      />
    );
  return (
    <div className={'v2-pr-comment' + (c.state === 'suggested' ? ' v2-pr-comment--ai' : '')}>
      <p className="pv-small v2-pr-comment-head">
        <strong>{c.state === 'suggested' ? 'AI suggestion' : (c.author ?? 'Someone')}</strong>
        {c.source === 'ai' && c.state !== 'suggested' ? (
          <span className="pv-muted"> · from an AI suggestion</span>
        ) : null}
        {c.severity && c.state === 'suggested' ? (
          <Chip tone={SEVERITY_TONE[c.severity]}>{c.severity}</Chip>
        ) : null}
        {c.state === 'draft' ? <Chip>draft</Chip> : null}
        {c.state === 'posted' ? (
          <Chip tone="success">posted {ago(c.postedAt ?? c.createdAt)} ago</Chip>
        ) : null}
        {c.outdated ? <Chip tone="warning">file changed since</Chip> : null}
      </p>
      <p className="v2-pr-comment-body">{c.body}</p>
      {c.state === 'suggested' ? (
        <span className="v2-pr-comment-actions">
          <Button size="sm" kind="primary" onClick={() => void t.decide(c.id, true)}>
            Accept
          </Button>
          <Button size="sm" kind="ghost" onClick={() => void t.decide(c.id, false)}>
            Dismiss
          </Button>
        </span>
      ) : c.state === 'draft' && c.mine ? (
        <span className="v2-pr-comment-actions">
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit
          </Button>
          <Button size="sm" kind="ghost" onClick={() => void t.remove(c.id)}>
            Delete
          </Button>
        </span>
      ) : null}
    </div>
  );
}

/** The comments under one line, and the box to add one when it is open. */
export function LineThread(props: {
  at: LineAt;
  comments: readonly LineComment[];
  writing: boolean;
  close: () => void;
  t: ThreadApi;
  span: number;
}): ReactNode {
  if (!props.comments.length && !props.writing) return null;
  return (
    <tr className="v2-pr-thread">
      <td colSpan={props.span}>
        {props.comments.map((c) => (
          <OneComment key={c.id} c={c} t={props.t} />
        ))}
        {props.writing ? (
          <Composer
            label={'Comment on line ' + String(props.at.line) + ' of ' + props.at.path}
            save={(body) => props.t.add(props.at, body)}
            cancel={props.close}
          />
        ) : null}
      </td>
    </tr>
  );
}

/** The summary and the decision; the drafts go with it. */
export function ReviewForm(props: { t: ThreadApi; canPost: boolean }): ReactNode {
  const { t } = props;
  const [body, setBody] = useState('');
  const drafts = t.thread.comments.filter((c) => c.state === 'draft' && c.mine);
  const waiting = t.thread.comments.filter((c) => c.state === 'suggested').length;
  const dismissed = t.thread.comments.filter((c) => c.state === 'dismissed').length;
  const send = (d: PostedReview['decision']): void => {
    void t.submit(d, body.trim()).then((ok) => {
      if (ok) setBody('');
    });
  };
  return (
    <Card
      title="Your review"
      action={
        <Button
          size="sm"
          icon="sparkle"
          disabled={t.busy === 'suggest'}
          onClick={() => void t.suggest()}
        >
          {t.busy === 'suggest' ? 'The AI is reading…' : 'Ask the AI for comments'}
        </Button>
      }
    >
      <p className="pv-small" role="status">
        {draftsText(drafts)}
        {waiting
          ? ' ' +
            String(waiting) +
            ' AI suggestion' +
            (waiting === 1 ? '' : 's') +
            ' to accept or dismiss.'
          : ''}
        {dismissed ? ' ' + String(dismissed) + ' dismissed.' : ''}
      </p>
      <textarea
        className="v2-input v2-pr-summary"
        rows={3}
        aria-label="Summary of your review"
        placeholder="A summary for the author (optional when you approve)"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
      />
      <div className="pv-page-actions">
        <Button
          size="sm"
          kind="primary"
          icon="check"
          disabled={!props.canPost || t.busy === 'submit'}
          onClick={() => {
            send('approve');
          }}
        >
          Approve
        </Button>
        <Button
          size="sm"
          kind="danger"
          disabled={!props.canPost || t.busy === 'submit'}
          onClick={() => {
            send('request_changes');
          }}
        >
          Request changes
        </Button>
        <Button
          size="sm"
          disabled={!props.canPost || t.busy === 'submit'}
          onClick={() => {
            send('comment');
          }}
        >
          Comment only
        </Button>
      </div>
      {t.news ? <p className="pv-small pv-text-success">{t.news}</p> : null}
      {t.error ? (
        <p className="pv-text-danger" role="alert">
          {t.error}
        </p>
      ) : null}
      {t.thread.reviews.length ? (
        <ul className="pv-small v2-pr-reviews">
          {t.thread.reviews.map((r) => (
            <li key={r.id}>
              <strong>{r.author ?? 'Someone'}</strong> {DECISION_TEXT[r.decision]}
              {r.comments
                ? ' with ' + String(r.comments) + ' comment' + (r.comments === 1 ? '' : 's')
                : ''}{' '}
              · {ago(r.createdAt)} ago{r.body ? ': ' + r.body : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
