// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-294 | S15 | v0.1.0] T30.8a Overlay compare of mockup versions, client pins in the portal ──
//    Why:  a client contact looks at a design shared with them closely and pins a comment to the spot it
//          is about, instead of describing it in words; they see their side's pins on it.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button } from '../preview/ui.js';
import { PinnedImage } from './uikit.js';

interface DesignView {
  id: string;
  title: string;
  version: number;
  imageUrl: string;
  mayPin: boolean;
  pins: {
    id: string;
    x: number;
    y: number;
    body: string;
    author: string | null;
    resolved: boolean;
  }[];
}

export function PortalDesign(props: { base: string; qs: string; id: string }): ReactNode {
  const D = props.base + '/portal/designs/' + props.id;
  const [view, setView] = useState<DesignView | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<DesignView>('GET', D + props.qs);
    if (r.ok) setView(r.data);
    else setError(r.error.message);
  }, [D, props.qs]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!view)
    return error ? (
      <p className="v2-error pv-small" role="alert">
        {error}
      </p>
    ) : null;
  return (
    <div className="pv-stack v2-mt">
      <PinnedImage
        url={view.imageUrl}
        pins={view.pins}
        draft={draft}
        onPlace={view.mayPin ? setDraft : null}
        label={view.title + ', version ' + String(view.version)}
      />
      {view.mayPin && !draft ? (
        <p className="pv-small pv-muted">Click on the design to pin a comment to that spot.</p>
      ) : null}
      {draft ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void api('POST', D + '/pins', { x: draft.x, y: draft.y, body: text.trim() }).then(
              async (r) => {
                if (!r.ok) {
                  setError(r.error.message);
                  return;
                }
                setError('');
                setDraft(null);
                setText('');
                await load();
              },
            );
          }}
        >
          <input
            className="v2-input v2-grow"
            aria-label="Your comment on this spot"
            placeholder="What about this spot?"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!text.trim()}
          >
            Pin
          </button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setDraft(null);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : null}
      {error ? (
        <p className="v2-error pv-small" role="alert">
          {error}
        </p>
      ) : null}
      {view.pins.length ? (
        <ol className="v2-pins">
          {view.pins.map((p, i) => (
            <li key={p.id} className={p.resolved ? 'v2-thread--done' : undefined}>
              <span className="v2-pin-num">{i + 1}</span>
              <span className="pv-small">
                <strong>{p.author ?? 'Someone'}:</strong> {p.body}
                {p.resolved ? <span className="pv-muted"> · done</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
