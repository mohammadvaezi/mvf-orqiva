// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
//    Why:  the client's part in ideation, in the portal: the PRDs a contact is named to approve, read in
//          full, approved with a signature or sent back with what should change; and the questions the
//          team handed to them, answered right there.
import { SIGN_CONSENT } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { Markdown } from './markdown.js';

interface PortalPrd {
  ideaId: string;
  ref: string;
  title: string;
  status: string;
  version: number;
  markdown: string;
  mayDecide: boolean;
  myDecision: string | null;
  approvers: { name: string; decision: string | null }[];
}
interface PortalQuestion {
  id: string;
  text: string;
  ideaRef: string;
  ideaTitle: string;
  dueDate: string | null;
  askedBy: string | null;
}

function useList<T>(
  base: string,
  qs: string,
  path: string,
  hub: EventHub,
): [T[], () => Promise<void>] {
  const [rows, setRows] = useState<T[]>([]);
  const load = useCallback(async () => {
    const r = await api<T[]>('GET', base + '/portal' + path + qs);
    if (r.ok) setRows(r.data);
  }, [base, qs, path]);
  useEffect(() => {
    void load();
    return hub.on(() => void load());
  }, [load, hub]);
  return [rows, load];
}

/** What a contact sees of a PRD's state. */
export function prdStateText(p: Pick<PortalPrd, 'status' | 'myDecision' | 'approvers'>): string {
  if (p.status === 'approved') return 'Approved by everyone named';
  if (p.myDecision === 'approved')
    return (
      'You approved · waiting for ' +
      (p.approvers
        .filter((a) => a.decision !== 'approved')
        .map((a) => a.name)
        .join(', ') || 'the others')
    );
  if (p.myDecision === 'changes') return 'You asked for changes · the team is on it';
  if (p.status === 'in_review') return 'Waiting for your decision';
  return 'Being prepared by the team';
}

function PrdCard(props: { base: string; prd: PortalPrd; onDone: () => Promise<void> }): ReactNode {
  const p = props.prd;
  const [reading, setReading] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (decision: 'approve' | 'changes'): Promise<void> => {
    setBusy(true);
    const r = await api('POST', props.base + '/portal/prds/' + p.ideaId + '/decision', {
      version: p.version,
      decision,
      name,
      consent,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    setError(r.ok ? '' : r.error.message);
    if (r.ok) await props.onDone();
  };
  return (
    <Card>
      <div className="pv-approval">
        <div className="pv-row-main">
          <span className="pv-muted pv-small">
            Proposal (PRD) · version {p.version} · <span className="pv-mono">{p.ref}</span>
          </span>
          <strong className="pv-approval-title">{p.title}</strong>
          <span className="pv-small">{prdStateText(p)}</span>
        </div>
        <div className="pv-page-actions">
          <Button
            kind={p.mayDecide ? 'primary' : 'ghost'}
            onClick={() => {
              setReading((x) => !x);
            }}
          >
            {reading ? 'Close' : p.mayDecide ? 'Read and decide' : 'Read'}
          </Button>
        </div>
      </div>
      {reading ? (
        <div className="pv-prd-read">
          <Markdown text={p.markdown} />
        </div>
      ) : null}
      {reading && p.mayDecide ? (
        <div className="pv-sign">
          <label className="pv-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
              }}
            />
            <span className="pv-small">{SIGN_CONSENT}</span>
          </label>
          <div className="pv-ask">
            <input
              value={name}
              placeholder="Type your full name"
              aria-label="Your name"
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
          <div className="pv-ask">
            <input
              value={note}
              placeholder="What should change? (needed to ask for changes)"
              aria-label="Note"
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </div>
          <div className="pv-page-actions">
            <Button
              disabled={busy || !consent || !name.trim() || !note.trim()}
              onClick={() => void send('changes')}
            >
              Ask for changes
            </Button>
            <Button
              kind="primary"
              icon="signoff"
              disabled={busy || !consent || !name.trim()}
              onClick={() => void send('approve')}
            >
              Approve and sign
            </Button>
          </div>
          {error ? (
            <p className="v2-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function PortalPrds(props: { base: string; qs: string; hub: EventHub }): ReactNode {
  const [rows, load] = useList<PortalPrd>(props.base, props.qs, '/prds', props.hub);
  if (!rows.length) return null;
  return (
    <>
      {rows.map((p) => (
        <PrdCard key={p.ideaId} base={props.base} prd={p} onDone={load} />
      ))}
    </>
  );
}

export function PortalQuestions(props: { base: string; qs: string; hub: EventHub }): ReactNode {
  const [rows, load] = useList<PortalQuestion>(props.base, props.qs, '/questions', props.hub);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  if (!rows.length) return null;
  return (
    <Card title="Questions for you">
      <ul className="pv-rows">
        {rows.map((q) => (
          <li key={q.id} className="pv-row pv-row--static pv-question">
            <span className="pv-row-main">
              <span className="pv-row-title">{q.text}</span>
              <span className="pv-row-sub">
                {q.ideaRef} {q.ideaTitle}
                {q.askedBy ? ' · asked by ' + q.askedBy : ''}
                {q.dueDate ? ' · ' : ''}
                {q.dueDate ? <Chip tone="warning">due {q.dueDate}</Chip> : null}
              </span>
              <form
                className="pv-ask"
                onSubmit={(e) => {
                  e.preventDefault();
                  const answer = (answers[q.id] ?? '').trim();
                  if (!answer) return;
                  void api('POST', props.base + '/portal/questions/' + q.id + '/answer', {
                    answer,
                  }).then(async (r) => {
                    setError(r.ok ? '' : r.error.message);
                    if (r.ok) await load();
                  });
                }}
              >
                <input
                  value={answers[q.id] ?? ''}
                  placeholder="Your answer"
                  aria-label={'Answer: ' + q.text}
                  onChange={(e) => {
                    setAnswers((x) => ({ ...x, [q.id]: e.target.value }));
                  }}
                />
                <button
                  type="submit"
                  className="pv-btn pv-btn--primary"
                  disabled={!(answers[q.id] ?? '').trim()}
                >
                  Answer
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
