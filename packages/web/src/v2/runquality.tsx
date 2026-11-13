// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
//    Why:  under a run's trace: what came of it, the judge's score with its reason (and a button to ask
//          for one), what people said, and your own good-or-bad with tags and a note.
import { OUTCOME_TEXT, RUN_TAGS, type RunOutcome } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface RunQualityData {
  annotations: {
    userId: string;
    name: string;
    verdict: 'good' | 'bad';
    tags: string[];
    note: string;
    at: string;
  }[];
  judge: { score: number; reason: string; runId: string | null; at: string } | null;
  outcome: RunOutcome;
}

/** "3 good, 1 bad" or "nobody said yet". */
export function verdictText(a: RunQualityData['annotations']): string {
  const good = a.filter((x) => x.verdict === 'good').length;
  const bad = a.length - good;
  return a.length ? String(good) + ' good, ' + String(bad) + ' bad' : 'nobody said yet';
}

export function RunQuality(props: {
  workspaceId: string;
  runId: string;
  finished: boolean;
  canEdit: boolean;
}): ReactNode {
  const R = W(props.workspaceId, '/agent-runs/' + props.runId);
  const [d, setD] = useState<RunQualityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const mine = d?.annotations.find((a) => a.userId === me);
  const [verdict, setVerdict] = useState<'good' | 'bad' | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    const r = await api<RunQualityData>('GET', R + '/quality');
    if (r.ok) setD(r.data);
  }, [R]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void api<{ user: { id: string } }>('GET', '/auth/me').then((r) => {
      if (r.ok) setMe(r.data.user.id);
    });
  }, []);
  useEffect(() => {
    setVerdict(mine?.verdict ?? null);
    setTags(mine?.tags ?? []);
    setNote(mine?.note ?? '');
  }, [mine?.verdict, mine?.tags, mine?.note]);
  const save = async (): Promise<void> => {
    if (!verdict) return;
    const r = await api<RunQualityData>('PUT', R + '/annotation', { verdict, tags, note });
    if (r.ok) {
      setD(r.data);
      setError(null);
    } else setError(r.error.message);
  };
  const judge = async (): Promise<void> => {
    setBusy(true);
    const r = await api<RunQualityData>('POST', R + '/judge');
    setBusy(false);
    if (r.ok) {
      setD(r.data);
      setError(null);
    } else setError(r.error.message);
  };
  if (!d) return null;
  return (
    <div className="pv-runq">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-runq-row">
        <span className="pv-small">
          <strong>Outcome:</strong> {OUTCOME_TEXT[d.outcome]}
        </span>
        <span className="pv-small">
          <strong>Judge:</strong>{' '}
          {d.judge ? (
            <>
              <Chip
                tone={d.judge.score >= 4 ? 'success' : d.judge.score >= 3 ? 'warning' : 'danger'}
              >
                {String(d.judge.score)} / 5
              </Chip>{' '}
              <span className="pv-muted">{d.judge.reason}</span>
            </>
          ) : (
            <span className="pv-muted">not judged</span>
          )}
        </span>
        {props.canEdit && props.finished ? (
          <Button size="sm" kind="ghost" disabled={busy} onClick={() => void judge()}>
            {busy ? 'Judging…' : d.judge ? 'Judge again' : 'Judge'}
          </Button>
        ) : null}
      </div>
      <div className="pv-runq-row">
        <span className="pv-small">
          <strong>People:</strong> {verdictText(d.annotations)}
        </span>
        {d.annotations
          .filter((a) => a.tags.length || a.note)
          .map((a) => (
            <span key={a.userId} className="pv-small pv-muted">
              {a.name}: {[...a.tags, ...(a.note ? ['“' + a.note + '”'] : [])].join(', ')}
            </span>
          ))}
      </div>
      {props.canEdit ? (
        <form
          className="pv-runq-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="pv-segmented" role="radiogroup" aria-label="Your verdict">
            {(['good', 'bad'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={verdict === v}
                className={'pv-seg pv-seg--' + (v === 'good' ? 'allowed' : 'never')}
                onClick={() => {
                  setVerdict(v);
                }}
              >
                {v === 'good' ? 'Good' : 'Bad'}
              </button>
            ))}
          </div>
          <div className="pv-runq-tags" role="group" aria-label="Tags">
            {RUN_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tags.includes(t)}
                className={'pv-runq-tag' + (tags.includes(t) ? ' pv-runq-tag--on' : '')}
                onClick={() => {
                  setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            className="v2-input v2-input--sm"
            aria-label="Note"
            placeholder="A note (optional)"
            maxLength={2000}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm" disabled={!verdict}>
            {mine ? 'Update' : 'Save'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
