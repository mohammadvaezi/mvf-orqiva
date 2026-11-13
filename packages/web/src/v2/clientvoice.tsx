// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-427 | S15 | v0.1.0] T37 low: The portal survey waits for a later visit and its field fits ──
// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
//    Why:  the client's voice on screen: votes and a merge on a request, the recommendation question in
//          the portal now and then, and on the team's client page the score with its comments and the
//          feedback widgets with the snippet for the client's site.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip, Stat } from '../preview/ui.js';

/** "+40" for a positive score, "−20" below zero, "—" without answers. */
export const npsText = (score: number | null): string =>
  score === null ? '—' : score > 0 ? '+' + String(score) : score < 0 ? '−' + String(-score) : '0';

// ── on a request ──
export function RequestVotes(props: {
  base: string;
  request: {
    id: string;
    clientId: string;
    votes?: number;
    voterIds?: string[];
    mergedInto?: { id: string; ref: string } | null;
    pageUrl?: string;
    closedAt: string | null;
  };
  team: boolean;
  go: (p: string) => void;
  onChanged: () => void;
}): ReactNode {
  const r = props.request;
  const [me, setMe] = useState<string | null>(null);
  const [others, setOthers] = useState<{ id: string; ref: string; title: string }[]>([]);
  const [into, setInto] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ user: { id: string } }>('GET', '/auth/me').then((x) => {
      if (x.ok) setMe(x.data.user.id);
    });
  }, []);
  useEffect(() => {
    if (!props.team || r.closedAt) return;
    void api<{ id: string; ref: string; title: string }[]>(
      'GET',
      props.base + '/client-requests?open=1&clientId=' + r.clientId,
    ).then((x) => {
      if (x.ok) setOthers(x.data.filter((o) => o.id !== r.id));
    });
  }, [props.base, props.team, r.clientId, r.id, r.closedAt]);
  const voted = me !== null && (r.voterIds ?? []).includes(me);
  const R = props.base + '/client-requests/' + r.id;
  const call = async (method: 'POST' | 'DELETE', path: string, body?: Record<string, unknown>) => {
    const x = await api(method, R + path, body);
    if (!x.ok) setError(x.error.message);
    else {
      setError('');
      props.onChanged();
    }
  };
  return (
    <div className="pv-req-voice">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {r.mergedInto ? (
        <p className="pv-small">
          Merged into{' '}
          <button
            type="button"
            className="pv-link-btn pv-mono"
            onClick={() => {
              props.go('/requests/' + (r.mergedInto?.id ?? ''));
            }}
          >
            {r.mergedInto.ref}
          </button>
          .
        </p>
      ) : (
        <span className="pv-page-actions">
          <Button
            size="sm"
            kind={voted ? 'primary' : 'ghost'}
            icon="check"
            aria-pressed={voted}
            onClick={() => void call(voted ? 'DELETE' : 'POST', '/vote')}
          >
            {voted ? 'You voted' : 'This matters to me too'}
          </Button>
          <span className="pv-small pv-muted">
            {String(r.votes ?? 0)} {(r.votes ?? 0) === 1 ? 'vote' : 'votes'}
          </span>
        </span>
      )}
      {r.pageUrl ? (
        <p className="pv-small pv-muted">
          Sent from{' '}
          <a href={r.pageUrl} target="_blank" rel="noreferrer">
            {r.pageUrl}
          </a>
        </p>
      ) : null}
      {props.team && !r.closedAt && others.length ? (
        <span className="pv-page-actions">
          <select
            className="v2-input v2-input--sm"
            aria-label="Merge into"
            value={into}
            onChange={(e) => {
              setInto(e.target.value);
            }}
          >
            <option value="">A duplicate of…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.ref} {o.title}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            kind="ghost"
            disabled={!into}
            onClick={() => void call('POST', '/merge', { intoId: into })}
          >
            Merge into it
          </Button>
        </span>
      ) : null}
    </div>
  );
}

// ── in the portal ──
export function NpsPrompt(props: { workspaceId: string }): ReactNode {
  const P = '/api/workspaces/' + props.workspaceId + '/portal/nps';
  const [due, setDue] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    let later = false;
    try {
      later = sessionStorage.getItem('orq-nps-later') === '1';
    } catch {
      // no storage: ask anyway
    }
    if (later) return;
    void api<{ due: boolean }>('GET', P).then((r) => {
      if (r.ok) setDue(r.data.due);
    });
  }, [P]);
  if (!due && !done) return null;
  if (done)
    return (
      <Card>
        <p className="pv-small">{done}</p>
      </Card>
    );
  const send = async (): Promise<void> => {
    if (score === null) return;
    const r = await api('POST', P, {
      score,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    });
    setDone(r.ok ? 'Thank you. Your account owner reads every answer.' : r.error.message);
    setDue(false);
  };
  return (
    <Card title="How likely are you to recommend us to a colleague?">
      <div className="pv-nps" role="radiogroup" aria-label="Score from 0 to 10">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            className={'pv-nps-btn' + (score === n ? ' pv-nps-btn--on' : '')}
            onClick={() => {
              setScore(n);
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="pv-small pv-muted">0 not at all · 10 certainly</p>
      {/* [PCODE-427 | S15 | v0.1.0] the whole width, so the question shows in full */}
      <input
        className="v2-input v2-input--sm pv-nps-reason"
        aria-label="What is the main reason?"
        placeholder="What is the main reason? (optional)"
        maxLength={2000}
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
        }}
      />
      <span className="pv-page-actions">
        <Button kind="primary" size="sm" disabled={score === null} onClick={() => void send()}>
          Send
        </Button>
        <Button
          kind="ghost"
          size="sm"
          onClick={() => {
            try {
              sessionStorage.setItem('orq-nps-later', '1');
            } catch {
              // nothing kept: it may ask again on the next visit
            }
            setDue(false);
          }}
        >
          Not now
        </Button>
      </span>
    </Card>
  );
}

// ── on the team's client page ──
interface Widget {
  id: string;
  name: string;
  key: string;
  origins: string[];
  enabled: boolean;
  received: number;
  lastUsedAt: string | null;
  snippet: string;
}
interface Nps {
  clientId: string;
  score: number | null;
  answers: number;
  promoters: number;
  passives: number;
  detractors: number;
  comments: { score: number; comment: string; name: string; at: string }[];
}

export function ClientVoice(props: { base: string; clientId: string; admin: boolean }): ReactNode {
  const [nps, setNps] = useState<Nps | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('https://');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [n, w] = await Promise.all([
      api<Nps[]>('GET', props.base + '/clients-nps'),
      api<Widget[]>('GET', props.base + '/clients/' + props.clientId + '/widgets'),
    ]);
    if (n.ok) setNps(n.data.find((x) => x.clientId === props.clientId) ?? null);
    if (w.ok) setWidgets(w.data);
  }, [props.base, props.clientId]);
  useEffect(() => {
    void load();
  }, [load]);
  const W = props.base + '/clients/' + props.clientId + '/widgets';
  const add = async (): Promise<void> => {
    const r = await api('POST', W, { name: name.trim(), origins: [origin.trim()] });
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      setName('');
      setOrigin('https://');
      await load();
    }
  };
  return (
    <Card title="The client’s voice">
      <div className="pv-stats">
        <Stat
          label="Recommendation (NPS)"
          value={npsText(nps?.score ?? null)}
          sub={
            nps
              ? String(nps.answers) +
                (nps.answers === 1 ? ' answer' : ' answers') +
                ' in 180 days · ' +
                String(nps.promoters) +
                ' promoters, ' +
                String(nps.detractors) +
                ' detractors'
              : 'no answers yet; contacts are asked every 90 days'
          }
          icon="check"
        />
      </div>
      {nps?.comments.length ? (
        <ul className="pv-nps-comments">
          {nps.comments.map((c, i) => (
            <li key={i} className="pv-small">
              <Chip tone={c.score >= 9 ? 'success' : c.score <= 6 ? 'danger' : 'neutral'}>
                {c.score}
              </Chip>{' '}
              “{c.comment}” <span className="pv-muted">· {c.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="pv-small pv-strong pv-mt">Feedback widget on the client’s site</p>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {widgets.map((w) => (
        <div key={w.id} className="pv-widget">
          <span className="pv-page-actions">
            <strong className="pv-small">{w.name}</strong>
            <Chip tone={w.enabled ? 'success' : 'neutral'}>{w.enabled ? 'on' : 'off'}</Chip>
            <span className="pv-small pv-muted">
              {w.origins.join(', ')} · {w.received} received
            </span>
            {props.admin ? (
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  void api('PATCH', W + '/' + w.id, { enabled: !w.enabled }).then(() => load());
                }}
              >
                {w.enabled ? 'Switch off' : 'Switch on'}
              </Button>
            ) : null}
          </span>
          <code className="pv-widget-snippet">{w.snippet}</code>
        </div>
      ))}
      {props.admin ? (
        <form
          className="pv-page-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void add();
          }}
        >
          <input
            className="v2-input v2-input--sm"
            aria-label="Widget name"
            placeholder="Name, e.g. Patient app"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <input
            className="v2-input v2-input--sm"
            aria-label="Site that may use it"
            value={origin}
            onChange={(e) => {
              setOrigin(e.target.value);
            }}
          />
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!name.trim()}
          >
            Add a widget
          </button>
        </form>
      ) : null}
    </Card>
  );
}
