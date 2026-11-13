// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-291 | S15 | v0.1.0] T30.5 Live component preview with the project's tokens and themes ──
//    Why:  a component next to its inventory row as it looks with the project's tokens, in light, dark
//          or a theme, in a sandboxed frame of the server's preview page (nothing in it can run), and its
//          example markup and CSS to change, so the next look follows at once.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button } from '../preview/ui.js';

export function previewUrl(workspaceId: string, componentId: string, theme: string): string {
  return (
    '/api/workspaces/' +
    workspaceId +
    '/components/' +
    componentId +
    '/preview?theme=' +
    encodeURIComponent(theme)
  );
}

export function ComponentPreview(props: {
  workspaceId: string;
  projectId: string;
  component: { id: string; name: string; previewHtml?: string; previewCss?: string };
  canEdit: boolean;
  onSaved: () => void;
}): ReactNode {
  const [themes, setThemes] = useState<string[]>(['light', 'dark']);
  const [theme, setTheme] = useState('light');
  const [html, setHtml] = useState(props.component.previewHtml ?? '');
  const [css, setCss] = useState(props.component.previewCss ?? '');
  const [edit, setEdit] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ themes: { name: string }[] }>(
      'GET',
      '/api/workspaces/' + props.workspaceId + '/projects/' + props.projectId + '/tokens',
    ).then((r) => {
      if (r.ok) setThemes(['light', 'dark', ...r.data.themes.map((t) => t.name)]);
    });
  }, [props.workspaceId, props.projectId]);
  const save = async (): Promise<void> => {
    const r = await api(
      'PUT',
      '/api/workspaces/' + props.workspaceId + '/components/' + props.component.id + '/preview',
      { html, css },
    );
    setError(r.ok ? '' : r.error.message);
    if (r.ok) {
      setVersion((v) => v + 1);
      setEdit(false);
      props.onSaved();
    }
  };
  return (
    <div className="v2-preview">
      <div className="v2-inline v2-preview-bar">
        <span className="pv-small pv-muted">Theme</span>
        {themes.map((t) => (
          <button
            key={t}
            type="button"
            className="pv-subtab"
            aria-pressed={theme === t}
            onClick={() => {
              setTheme(t);
            }}
          >
            {t}
          </button>
        ))}
        {props.canEdit ? (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setEdit((x) => !x);
            }}
          >
            {edit ? 'Close the example' : 'Edit the example'}
          </Button>
        ) : null}
      </div>
      <iframe
        key={theme + String(version)}
        className="v2-preview-frame"
        title={props.component.name + ' preview, ' + theme}
        src={previewUrl(props.workspaceId, props.component.id, theme)}
        sandbox=""
        referrerPolicy="no-referrer"
      />
      {edit ? (
        <div className="v2-preview-edit">
          <label className="pv-small">
            Markup
            <textarea
              className="v2-input v2-mono"
              rows={6}
              value={html}
              placeholder='<button class="btn btn--primary">Save</button>'
              onChange={(e) => {
                setHtml(e.target.value);
              }}
            />
          </label>
          <label className="pv-small">
            CSS (use the token variables, e.g. var(--color-primary))
            <textarea
              className="v2-input v2-mono"
              rows={6}
              value={css}
              placeholder=".btn--primary { background: var(--color-primary); }"
              onChange={(e) => {
                setCss(e.target.value);
              }}
            />
          </label>
          <span className="v2-inline">
            <Button size="sm" kind="primary" onClick={() => void save()}>
              Save and show
            </Button>
            <span className="pv-small pv-muted">
              Scripts, frames, forms and outside addresses are left out of the preview.
            </span>
          </span>
          {error ? (
            <p className="v2-error pv-small" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
