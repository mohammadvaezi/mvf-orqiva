// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-336 | S15 | v0.1.0] T34.1a Portal home with health, milestone, release and budget; release deliverables and demos; client sign-off per release; files on acceptance results ──
//    Why:  what a release delivers to the client, kept on the team's release page (links and demo
//          recordings, a video file or a link) and shown in the client's release notes, with the client's
//          sign-off; and the portal home's project health in words.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { uploadFile } from './files.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

export interface Deliverable {
  id: string;
  kind: 'link' | 'demo';
  title: string;
  url: string;
  fileId: string | null;
  fileName: string | null;
  mime: string | null;
}
export interface SignOff {
  decision: 'approved' | 'declined';
  signedName: string;
  note: string;
  at: string;
}

/** Where a deliverable opens: its link, or its file. */
export const deliverableHref = (base: string, d: Deliverable): string =>
  d.url || (d.fileId ? base + '/files/' + d.fileId + '/content' : '');

export const signOffText = (s: SignOff): string =>
  (s.decision === 'approved' ? 'Signed off by ' : 'Declined by ') +
  s.signedName +
  ' · ' +
  new Date(s.at).toLocaleDateString(fmtLocale()) +
  (s.note ? ' · ' + s.note : '');

/** The list a client sees, with a demo video playing in place. */
export function DeliverableList(props: { base: string; items: Deliverable[] }): ReactNode {
  if (!props.items.length) return null;
  return (
    <ul className="pv-deliverables">
      {props.items.map((d) => (
        <li key={d.id}>
          <Chip tone={d.kind === 'demo' ? 'info' : 'neutral'}>
            {d.kind === 'demo' ? 'demo' : 'link'}
          </Chip>{' '}
          <a href={deliverableHref(props.base, d)} target="_blank" rel="noreferrer">
            {d.title}
          </a>
          {d.kind === 'demo' && d.fileId && d.mime?.startsWith('video/') ? (
            <video
              className="pv-demo"
              controls
              preload="metadata"
              src={deliverableHref(props.base, d)}
            >
              <track kind="captions" />
            </video>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The team's card on a release: add links and demos, see the client's sign-off. */
export function ReleaseDeliverables(props: {
  workspaceId: string;
  projectId: string;
  releaseId: string;
  canEdit: boolean;
}): ReactNode {
  const base = '/api/workspaces/' + props.workspaceId;
  const R = base + '/releases/' + props.releaseId + '/deliverables';
  const [d, setD] = useState<{ deliverables: Deliverable[]; signOff: SignOff | null } | null>(null);
  const [kind, setKind] = useState<'link' | 'demo'>('link');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ deliverables: Deliverable[]; signOff: SignOff | null }>('GET', R);
    if (r.ok) setD(r.data);
  }, [R]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async (): Promise<void> => {
    let fileId: string | undefined;
    if (file) {
      const up = await uploadFile(props.workspaceId, props.projectId, file);
      if (!up.ok) {
        setError(up.error.message);
        return;
      }
      fileId = up.data.id;
    }
    const r = await api('POST', R, {
      kind,
      title: title.trim(),
      ...(url.trim() ? { url: url.trim() } : {}),
      ...(fileId ? { fileId } : {}),
    });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError(null);
    setTitle('');
    setUrl('');
    setFile(null);
    await load();
  };
  if (!d) return null;
  return (
    <Card title="For the client">
      <p className="pv-muted pv-small">Links and demo recordings shown with the release notes.</p>
      {d.signOff ? (
        <p className="pv-small">
          <Chip tone={d.signOff.decision === 'approved' ? 'success' : 'danger'}>
            {d.signOff.decision === 'approved' ? 'signed off' : 'declined'}
          </Chip>{' '}
          {signOffText(d.signOff)}
        </p>
      ) : (
        <p className="pv-muted pv-small">The client has not signed off this release yet.</p>
      )}
      <ul className="pv-deliverables">
        {d.deliverables.map((x) => (
          <li key={x.id}>
            <Chip tone={x.kind === 'demo' ? 'info' : 'neutral'}>{x.kind}</Chip>{' '}
            <a href={deliverableHref(base, x)} target="_blank" rel="noreferrer">
              {x.title}
            </a>
            {props.canEdit ? (
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  void api('DELETE', R + '/' + x.id).then(() => load());
                }}
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {props.canEdit ? (
        <form
          className="pv-page-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && (url.trim() || file)) void add();
          }}
        >
          {error ? (
            <span className="v2-error" role="alert">
              {error}
            </span>
          ) : null}
          <select
            className="v2-input v2-input--sm"
            aria-label="Kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value === 'demo' ? 'demo' : 'link');
            }}
          >
            <option value="link">Link</option>
            <option value="demo">Demo recording</option>
          </select>
          <input
            className="v2-input v2-input--sm"
            aria-label="Title"
            placeholder="Title"
            maxLength={200}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
          <input
            className="v2-input v2-input--sm"
            aria-label="Link"
            placeholder="https://…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
            }}
          />
          {kind === 'demo' ? (
            <input
              type="file"
              aria-label="Recording"
              accept="video/*"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          ) : null}
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!title.trim() || (!url.trim() && !file)}
          >
            Add
          </button>
        </form>
      ) : null}
    </Card>
  );
}
