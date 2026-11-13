// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-289 | S15 | v0.1.0] T30.3 Brand pages: colour, type, voice, logo use, do and don't ──
//    Why:  the UI kit's Brand view: the brand book the team writes section by section, with the palette
//          and the type specimens drawn from the tokens (in SVG, so the page keeps its no-inline-style
//          rule), the logos from the assets, do and don't examples, and the book as one HTML file.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card } from '../preview/ui.js';
import { uploadFile } from './files.js';
import { Markdown } from './markdown.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Section {
  key: string;
  title: string;
  hint: string;
  body: string;
  updatedBy: string | null;
  updatedAt: string | null;
}
interface Colour {
  name: string;
  written: string;
  hex: string;
  dark: string | null;
  rgb: string;
  onWhite: number | null;
  onBlack: number | null;
  description: string;
}
interface Book {
  sections: Section[];
  palette: { group: string; colours: Colour[] }[];
  type: {
    families: { name: string; value: string; first: string }[];
    weights: { name: string; weight: number }[];
    sizes: { name: string; value: string; px: number }[];
  };
  logos: { id: string; name: string; imageUrl: string }[];
  examples: { id: string; kind: string; caption: string; imageUrl: string | null }[];
}

/** The text colour a swatch label reads best in: white or near-black. */
export const labelOn = (c: Colour): string =>
  (c.onBlack ?? 0) >= (c.onWhite ?? 0) ? '#111111' : '#ffffff';
const SAFE_HEX = /^#[0-9a-f]{3,8}$/i;

function Palette(props: { palette: Book['palette'] }): ReactNode {
  if (!props.palette.length)
    return <p className="pv-muted pv-small">No colour tokens yet: add them under Tokens.</p>;
  return (
    <div className="v2-brand-palette">
      {props.palette.map((g) => (
        <div key={g.group}>
          <h4 className="v2-brand-group">{g.group}</h4>
          <div className="v2-brand-swatches">
            {g.colours.map((c) => (
              <figure key={c.name} className="v2-brand-swatch">
                <svg viewBox="0 0 180 72" aria-hidden="true">
                  <rect width="180" height="72" fill={SAFE_HEX.test(c.hex) ? c.hex : '#cccccc'} />
                  {c.dark && SAFE_HEX.test(c.dark) ? (
                    <rect x="132" width="48" height="72" fill={c.dark} />
                  ) : null}
                  <text x="10" y="62" fill={labelOn(c)} fontSize="12">
                    {c.hex}
                  </text>
                </svg>
                <figcaption>
                  <span className="pv-mono">{c.name}</span>
                  <span className="pv-muted">
                    {c.rgb}
                    {c.dark ? ' · dark ' + c.dark : ''}
                  </span>
                  {c.onWhite !== null ? (
                    <span className="pv-muted">
                      on white {String(c.onWhite)} · on black {String(c.onBlack ?? '')}
                    </span>
                  ) : null}
                  {c.written.startsWith('{') ? (
                    <span className="pv-muted">same as {c.written.slice(1, -1)}</span>
                  ) : null}
                  {c.description ? <span>{c.description}</span> : null}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TypeSpecimens(props: { type: Book['type'] }): ReactNode {
  const t = props.type;
  if (!t.families.length && !t.sizes.length)
    return (
      <p className="pv-muted pv-small">
        No type tokens yet: add font families and sizes (font.size.*) under Tokens.
      </p>
    );
  const body = t.families[0]?.value ?? 'system-ui, sans-serif';
  return (
    <div className="v2-brand-type">
      {t.families.map((f) => (
        <figure key={f.name}>
          <svg viewBox="0 0 720 44" className="v2-brand-specimen" role="img" aria-label={f.first}>
            <text x="0" y="34" fontFamily={f.value} fontSize="30" fill="currentColor">
              {f.first}: The quick brown fox jumps over the lazy dog
            </text>
          </svg>
          <figcaption className="pv-small pv-muted">
            <span className="pv-mono">{f.name}</span> · {f.value}
          </figcaption>
        </figure>
      ))}
      {t.sizes.map((s) => (
        <svg
          key={s.name}
          viewBox={'0 0 720 ' + String(Math.ceil(s.px * 1.4))}
          className="v2-brand-specimen"
          role="img"
          aria-label={s.name + ' ' + s.value}
        >
          <text x="0" y={s.px} fontFamily={body} fontSize={s.px} fill="currentColor">
            {s.name} · {s.value}
          </text>
        </svg>
      ))}
      {t.weights.length ? (
        <svg viewBox="0 0 720 30" className="v2-brand-specimen" role="img" aria-label="Weights">
          {t.weights.map((w, i) => (
            <text
              key={w.name}
              x={i * 180}
              y="22"
              fontFamily={body}
              fontSize="18"
              fontWeight={w.weight}
              fill="currentColor"
            >
              {w.name.split('.').pop()} {String(w.weight)}
            </text>
          ))}
        </svg>
      ) : null}
    </div>
  );
}

function SectionCard(props: {
  s: Section;
  canEdit: boolean;
  onSave: (body: string) => Promise<string | null>;
  children?: ReactNode;
}): ReactNode {
  const [edit, setEdit] = useState<string | null>(null);
  const [error, setError] = useState('');
  return (
    <Card
      title={props.s.title}
      action={
        props.canEdit && edit === null ? (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setEdit(props.s.body);
            }}
          >
            {props.s.body ? 'Edit' : 'Write'}
          </Button>
        ) : null
      }
    >
      <div className="v2-brand-section" id={'brand-' + props.s.key}>
        {props.children}
        {edit !== null ? (
          <div className="v2-brand-edit">
            <textarea
              className="v2-input v2-brand-text"
              aria-label={props.s.title}
              placeholder={props.s.hint + ' Markdown works.'}
              value={edit}
              rows={8}
              onChange={(e) => {
                setEdit(e.target.value);
              }}
            />
            <span className="v2-inline">
              <Button
                size="sm"
                kind="primary"
                onClick={() =>
                  void props.onSave(edit).then((err) => {
                    setError(err ?? '');
                    if (!err) setEdit(null);
                  })
                }
              >
                Save
              </Button>
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  setEdit(null);
                }}
              >
                Cancel
              </Button>
            </span>
            {error ? (
              <p className="v2-error pv-small" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : props.s.body ? (
          <div className="v2-brand-body">
            <Markdown text={props.s.body} />
            {props.s.updatedBy ? (
              <p className="pv-small pv-muted">Written by {props.s.updatedBy}</p>
            ) : null}
          </div>
        ) : (
          <p className="pv-muted pv-small">{props.s.hint}</p>
        )}
      </div>
    </Card>
  );
}

function Examples(props: {
  workspaceId: string;
  projectId: string;
  examples: Book['examples'];
  canEdit: boolean;
  onChanged: () => void;
}): ReactNode {
  const [kind, setKind] = useState('do');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
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
    const r = await api(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/brand/examples'),
      { kind, caption: caption.trim(), ...(fileId ? { fileId } : {}) },
    );
    setError(r.ok ? '' : r.error.message);
    if (r.ok) {
      setCaption('');
      setFile(null);
      props.onChanged();
    }
  };
  return (
    <Card title="Do and don’t">
      <div className="v2-brand-examples">
        {props.examples.map((e) => (
          <figure key={e.id} className={'v2-brand-example v2-brand-example--' + e.kind}>
            {e.imageUrl ? <img src={e.imageUrl} alt="" /> : null}
            <figcaption>
              <strong>{e.kind === 'do' ? 'Do' : 'Don’t'}</strong> {e.caption}
              {props.canEdit ? (
                <button
                  type="button"
                  className="pv-mini-btn"
                  aria-label={'Remove the example ' + e.caption}
                  onClick={() =>
                    void api('DELETE', W(props.workspaceId, '/brand-examples/' + e.id)).then(
                      props.onChanged,
                    )
                  }
                >
                  ×
                </button>
              ) : null}
            </figcaption>
          </figure>
        ))}
        {!props.examples.length ? (
          <p className="pv-muted pv-small">
            No examples yet: show a right and a wrong use side by side.
          </p>
        ) : null}
      </div>
      {props.canEdit ? (
        <form
          className="v2-inline v2-brand-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (caption.trim()) void add();
          }}
        >
          <select
            className="v2-input v2-input--sm"
            aria-label="Do or don’t"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
            }}
          >
            <option value="do">Do</option>
            <option value="dont">Don’t</option>
          </select>
          <input
            className="v2-input v2-input--sm v2-grow"
            aria-label="Caption"
            placeholder="What it shows"
            value={caption}
            onChange={(e) => {
              setCaption(e.target.value);
            }}
          />
          <label className="pv-btn pv-btn--ghost pv-btn--sm v2-file-pick">
            {file ? file.name : 'Picture'}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          </label>
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!caption.trim()}
          >
            Add
          </button>
          {error ? (
            <span className="v2-error pv-small" role="alert">
              {error}
            </span>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}

export function BrandBook(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
}): ReactNode {
  const base = W(props.workspaceId, '/projects/' + props.projectId + '/brand');
  const [book, setBook] = useState<Book | null>(null);
  const load = useCallback(async () => {
    const r = await api<Book>('GET', base);
    if (r.ok) setBook(r.data);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!book)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  const save = async (key: string, body: string): Promise<string | null> => {
    const r = await api('PUT', base + '/' + key, { body });
    if (!r.ok) return r.error.message;
    await load();
    return null;
  };
  return (
    <div className="pv-stack">
      <div className="v2-inline v2-brand-head">
        <nav className="v2-inline pv-small" aria-label="Brand book sections">
          {book.sections.map((s) => (
            <a key={s.key} className="pv-link" href={'#brand-' + s.key}>
              {s.title}
            </a>
          ))}
        </nav>
        <a className="pv-btn pv-btn--ghost pv-btn--sm" href={base + '/export'} download>
          Download the brand book (HTML)
        </a>
      </div>
      {book.sections.map((s) => (
        <SectionCard key={s.key} s={s} canEdit={props.canEdit} onSave={(body) => save(s.key, body)}>
          {s.key === 'colour' ? <Palette palette={book.palette} /> : null}
          {s.key === 'type' ? <TypeSpecimens type={book.type} /> : null}
          {s.key === 'logo' ? (
            book.logos.length ? (
              <div className="v2-brand-logos">
                {book.logos.map((l) => (
                  <figure key={l.id}>
                    <img src={l.imageUrl} alt={l.name} />
                    <figcaption className="pv-small pv-muted">{l.name}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="pv-muted pv-small">
                No logos yet: add them under Assets with the kind “logo”.
              </p>
            )
          ) : null}
        </SectionCard>
      ))}
      <Examples
        workspaceId={props.workspaceId}
        projectId={props.projectId}
        examples={book.examples}
        canEdit={props.canEdit}
        onChanged={() => void load()}
      />
    </div>
  );
}
