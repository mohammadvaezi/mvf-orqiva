// ── [PCODE-146 | S15 | v0.1.0] Show compliance, evidence packs and reviews in the web app ──
//    Why:  compliance as a page people can work with: which frameworks apply, each control measured from
//          the project's own records, evidence to add where a person must vouch, controls that do not
//          apply (with the reason), and the evidence pack one click away. And the review stage on each task:
//          the Reviewer agent's advice next to the people's decisions.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';
import { Icon } from './core/icons.js';
import { ProgressBar } from './progress.js';
import { Card, follow } from './shell.js';
import { localTime } from './views.js';

interface Source {
  source: string;
  text: string;
  status: string;
  detail: string;
}
interface Control {
  id: string;
  ref: string;
  summary: string;
  status: string;
  sources: Source[];
  evidence: { id: string; text: string; url: string; addedBy: string | null; addedAt: string }[];
  exemption: { reason: string; by: string | null; at: string } | null;
}
export interface Framework {
  key: string;
  name: string;
  note: string;
  enabled: boolean;
  met: number;
  total: number;
  controls: Control[];
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

const STATUS_TEXT: Record<string, string> = {
  met: 'Met',
  partial: 'Partly met',
  missing: 'Missing',
  exempt: 'Not applicable',
};

export function ControlState(props: { status: string }): ReactNode {
  return (
    <span className={'pe-control pe-control--' + props.status}>
      {STATUS_TEXT[props.status] ?? props.status}
    </span>
  );
}

/** The download address of the evidence pack for a period. */
export const packUrl = (workspaceId: string, projectId: string, from: string, to: string): string =>
  W(workspaceId, '/projects/' + projectId + '/evidence-pack?from=' + from + '&to=' + to);

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export function ComplianceView(props: {
  workspaceId: string;
  projectId: string;
  role: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, projectId } = props;
  const isAdmin = props.role === 'admin' || props.role === 'owner';
  const [frameworks, setFrameworks] = useState<Framework[] | null>(null);
  const [error, setError] = useState('');
  const [to, setTo] = useState(isoDay(new Date()));
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 90 * 86_400_000)));
  const load = useCallback(async () => {
    const r = await api<{ frameworks: Framework[] }>(
      'GET',
      W(workspaceId, '/projects/' + projectId + '/compliance'),
    );
    if (r.ok) setFrameworks(r.data.frameworks);
    else setError(r.error.message);
  }, [workspaceId, projectId]);
  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = props.hub.on(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 800);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [load, props.hub]);
  const take = (
    r: { ok: true; data: { frameworks: Framework[] } } | { ok: false; error: { message: string } },
  ): void => {
    if (r.ok) {
      setFrameworks(r.data.frameworks);
      setError('');
    } else setError(r.error.message);
  };

  if (!frameworks) return <p className="pe-muted">{error || 'Loading…'}</p>;
  const on = frameworks.filter((f) => f.enabled);
  return (
    <div className="pe-stack">
      <Card
        title="Evidence pack"
        subtitle="One ZIP for an auditor: a summary, every control with its status, the records behind them and a manifest of SHA-256 hashes."
      >
        <div className="pe-inline-form">
          <label className="pe-small" htmlFor="pack-from">
            From
          </label>
          <input
            id="pack-from"
            type="date"
            className="pe-input pe-input--narrow"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
          />
          <label className="pe-small" htmlFor="pack-to">
            to
          </label>
          <input
            id="pack-to"
            type="date"
            className="pe-input pe-input--narrow"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
          <a
            className="pe-btn pe-btn--primary"
            href={packUrl(workspaceId, projectId, from, to)}
            download
          >
            <Icon name="archive" size={18} /> Export evidence pack
          </a>
        </div>
      </Card>

      <Card
        title="Frameworks"
        subtitle="Turn on the ones this project answers to; G3’s compliance criterion follows them."
      >
        <ul className="pe-framework-list">
          {frameworks.map((f) => (
            <li key={f.key} className={'pe-framework' + (f.enabled ? ' pe-framework--on' : '')}>
              <div className="pe-framework-head">
                <div>
                  <h3 className="pe-agent-name">{f.name}</h3>
                  <div className="pe-small pe-muted">{f.note}</div>
                </div>
                {isAdmin ? (
                  <label className="pe-check">
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={(e) => {
                        void api<{ frameworks: Framework[] }>(
                          'PUT',
                          W(
                            workspaceId,
                            '/projects/' + projectId + '/compliance/frameworks/' + f.key,
                          ),
                          { enabled: e.target.checked },
                        ).then(take);
                      }}
                    />{' '}
                    Applies
                  </label>
                ) : f.enabled ? (
                  <span className="pe-pill">applies</span>
                ) : null}
              </div>
              <ProgressBar
                done={f.met}
                total={f.total}
                label={String(f.met) + ' of ' + String(f.total) + ' controls met'}
              />
            </li>
          ))}
        </ul>
      </Card>

      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
      {on.map((f) => (
        <Card
          key={f.key}
          title={f.name}
          subtitle={String(f.met) + ' of ' + String(f.total) + ' controls met or not applicable'}
        >
          <ul className="pe-control-list">
            {f.controls.map((ctl) => (
              <ControlRow
                key={ctl.id}
                control={ctl}
                isAdmin={isAdmin}
                canEdit={props.role !== 'guest'}
                onEvidence={async (text, url) => {
                  const r = await api<{ frameworks: Framework[] }>(
                    'POST',
                    W(workspaceId, '/projects/' + projectId + '/compliance/evidence'),
                    {
                      framework: f.key,
                      control: ctl.id,
                      text,
                      ...(url ? { url } : {}),
                    },
                  );
                  take(r);
                  return r.ok ? null : r.error.message;
                }}
                onExempt={async (reason, remove) => {
                  const r = await api<{ frameworks: Framework[] }>(
                    'POST',
                    W(workspaceId, '/projects/' + projectId + '/compliance/exemptions'),
                    {
                      framework: f.key,
                      control: ctl.id,
                      ...(remove ? { remove: true } : { reason }),
                    },
                  );
                  take(r);
                  return r.ok ? null : r.error.message;
                }}
              />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function ControlRow(props: {
  control: Control;
  isAdmin: boolean;
  canEdit: boolean;
  onEvidence: (text: string, url: string) => Promise<string | null>;
  onExempt: (reason: string, remove: boolean) => Promise<string | null>;
}): ReactNode {
  const c = props.control;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return (
    <li className="pe-control-row">
      <button
        type="button"
        className="pe-control-head"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <ControlState status={c.status} />
        <span className="pe-mono pe-small">{c.ref}</span>
        <span className="pe-control-summary">{c.summary}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>
      {open ? (
        <div className="pe-control-body">
          <ul className="pe-source-list">
            {c.sources.map((x) => (
              <li key={x.source}>
                <Icon
                  name={x.status === 'met' ? 'task' : x.status === 'partial' ? 'dot' : 'close'}
                  size={14}
                />
                <span>
                  {x.text}: <span className="pe-muted">{x.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {c.evidence.length ? (
            <ul className="pe-evidence-list">
              {c.evidence.map((e) => (
                <li key={e.id}>
                  {e.text}
                  {e.url ? (
                    <>
                      {' '}
                      <a href={e.url} target="_blank" rel="noreferrer noopener">
                        link
                      </a>
                    </>
                  ) : null}{' '}
                  <span className="pe-small pe-muted">
                    {e.addedBy ?? ''}, {localTime(e.addedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {c.exemption ? (
            <p className="pe-small">
              Not applicable ({c.exemption.by ?? 'someone'}): {c.exemption.reason}{' '}
              {props.isAdmin ? (
                <button
                  type="button"
                  className="pe-btn pe-btn--text"
                  onClick={() => {
                    void props.onExempt('', true).then((e) => {
                      setError(e ?? '');
                    });
                  }}
                >
                  It applies after all
                </button>
              ) : null}
            </p>
          ) : null}
          {props.canEdit ? (
            <form
              className="pe-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void props.onEvidence(text.trim(), url.trim()).then((err) => {
                  setError(err ?? '');
                  if (!err) {
                    setText('');
                    setUrl('');
                  }
                });
              }}
            >
              <input
                className="pe-input"
                aria-label={'Evidence for ' + c.ref}
                placeholder="Evidence: what shows this control is in place"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                }}
              />
              <input
                className="pe-input pe-input--narrow"
                aria-label={'Link for ' + c.ref}
                placeholder="https://… (optional)"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                }}
              />
              <button type="submit" className="pe-btn pe-btn--secondary" disabled={!text.trim()}>
                Add evidence
              </button>
            </form>
          ) : null}
          {props.isAdmin && !c.exemption ? (
            <form
              className="pe-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void props.onExempt(reason.trim(), false).then((err) => {
                  setError(err ?? '');
                  if (!err) setReason('');
                });
              }}
            >
              <input
                className="pe-input"
                aria-label={'Why ' + c.ref + ' does not apply'}
                placeholder="Why it does not apply here"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
              <button
                type="submit"
                className="pe-btn pe-btn--text"
                disabled={reason.trim().length < 10}
              >
                Not applicable
              </button>
            </form>
          ) : null}
          {error ? (
            <div className="pe-field-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ── the review stage on a task ──

interface Review {
  id: string;
  kind: string;
  decision: string | null;
  recommendation: string | null;
  body: string;
  runId: string | null;
  author: string | null;
  createdAt: string;
}

/** The decision that counts: the latest of a person. */
export const latestDecision = (reviews: Pick<Review, 'kind' | 'decision'>[]): string | null =>
  reviews.find((r) => r.kind === 'person')?.decision ?? null;

export function ReviewPanel(props: {
  workspaceId: string;
  itemId: string;
  canEdit: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, itemId } = props;
  const [reviews, setReviews] = useState<Review[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<Review[]>('GET', W(workspaceId, '/items/' + itemId + '/reviews'));
    if (r.ok) setReviews(r.data);
  }, [workspaceId, itemId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.data.object.id === itemId && e.data.changes?.['review']) void load();
    });
  }, [load, props.hub, itemId]);
  const decide = async (decision: string): Promise<void> => {
    const r = await api<Review[]>('POST', W(workspaceId, '/items/' + itemId + '/reviews'), {
      decision,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setNote('');
    setReviews(r.data);
  };
  const ask = async (): Promise<void> => {
    setBusy(true);
    const r = await api<Review[]>('POST', W(workspaceId, '/items/' + itemId + '/reviews/agent'));
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setReviews(r.data);
  };
  const decision = latestDecision(reviews);
  return (
    <section aria-label="Review" className="pe-panel">
      <div className="pe-panel-head">
        <div>
          <h2 className="pe-panel-title">Review</h2>
          <p className="pe-panel-subtitle">
            {decision === 'approved'
              ? 'Approved.'
              : decision === 'changes_requested'
                ? 'Changes requested.'
                : 'Not reviewed yet.'}
          </p>
        </div>
        {props.canEdit ? (
          <button
            type="button"
            className="pe-btn pe-btn--secondary"
            disabled={busy}
            onClick={() => {
              void ask();
            }}
          >
            <Icon name="agent" size={18} /> {busy ? 'Reviewing…' : 'Ask the Reviewer agent'}
          </button>
        ) : null}
      </div>
      {reviews.length ? (
        <ol className="pe-review-list">
          {reviews.map((r) => (
            <li key={r.id} className={'pe-review pe-review--' + (r.decision ?? r.kind)}>
              <div className="pe-small">
                <strong>
                  {r.kind === 'agent'
                    ? 'Reviewer agent recommends ' +
                      (r.recommendation === 'approve' ? 'approval' : 'changes')
                    : (r.author ?? 'Someone') +
                      (r.decision === 'approved' ? ' approved' : ' requested changes')}
                </strong>{' '}
                <span className="pe-muted">{localTime(r.createdAt)}</span>
                {r.runId ? (
                  <>
                    {' · '}
                    <a href={'/runs/' + r.runId} onClick={follow('/runs/' + r.runId, props.go)}>
                      run
                    </a>
                  </>
                ) : null}
              </div>
              {r.body ? <p className="pe-pre-wrap">{r.body}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {props.canEdit ? (
        <div className="pe-inline-form">
          <input
            className="pe-input"
            aria-label="Review note"
            placeholder="Note (needed to request changes)"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
          <button
            type="button"
            className="pe-btn pe-btn--primary"
            onClick={() => {
              void decide('approved');
            }}
          >
            Approve
          </button>
          <button
            type="button"
            className="pe-btn pe-btn--secondary"
            disabled={!note.trim()}
            onClick={() => {
              void decide('changes_requested');
            }}
          >
            Request changes
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
