// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
//    Why:  the Checks view's code side: what the last `orq kit scan` found written by hand, by file, with
//          the token that has the same value, and how to run it again.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Card } from '../preview/ui.js';
import { Swatch } from './uikit.js';

interface Findings {
  scan: { files: number; findings: number; by: string | null; at: string } | null;
  withToken: number;
  files: {
    path: string;
    findings: { line: number; kind: string; value: string; token: string | null }[];
  }[];
}

/** One sentence on the last scan. */
export function scanSummary(f: Findings): string {
  if (!f.scan) return 'The code has not been scanned yet.';
  const n = f.scan.findings;
  return (
    String(f.scan.files) +
    ' UI files scanned ' +
    new Date(f.scan.at).toLocaleDateString() +
    (f.scan.by ? ' by ' + f.scan.by : '') +
    ': ' +
    (n
      ? String(n) +
        (n === 1 ? ' colour or size' : ' colours and sizes') +
        ' written by hand, ' +
        String(f.withToken) +
        ' of them with a token of the same value.'
      : 'no colours or sizes written by hand.')
  );
}

export function KitFindings(props: { workspaceId: string; projectId: string }): ReactNode {
  const [f, setF] = useState<Findings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void api<Findings>(
      'GET',
      '/api/workspaces/' + props.workspaceId + '/projects/' + props.projectId + '/kit-findings',
    ).then((r) => {
      if (r.ok) setF(r.data);
    });
  }, [props.workspaceId, props.projectId]);
  return (
    <Card flush title="Raw values in the code">
      <p className="pv-small pv-pad">
        {f ? scanSummary(f) : '…'} Run <code>orq kit scan</code> in the repository to scan again;{' '}
        <code>orq kit check</code> lists the changed files before a task is done.
      </p>
      {f?.files.length ? (
        <table className="pv-table">
          <thead>
            <tr>
              <th>File</th>
              <th className="pv-num">Values</th>
              <th className="pv-num">With a token</th>
            </tr>
          </thead>
          <tbody>
            {f.files.slice(0, 50).map((file) => (
              <Fragment key={file.path}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="pv-link pv-mono pv-small v2-kit-file"
                      aria-expanded={open === file.path}
                      onClick={() => {
                        setOpen(open === file.path ? null : file.path);
                      }}
                    >
                      {file.path}
                    </button>
                  </td>
                  <td className="pv-num">{file.findings.length}</td>
                  <td className="pv-num">{file.findings.filter((x) => x.token).length}</td>
                </tr>
                {open === file.path ? (
                  <tr>
                    <td colSpan={3}>
                      <ul className="v2-kit-lines">
                        {file.findings.slice(0, 100).map((x) => (
                          <li key={String(x.line) + x.value}>
                            <span className="pv-mono pv-muted">{String(x.line)}</span>
                            {x.kind === 'colour' ? <Swatch value={x.value} /> : null}
                            <span className="pv-mono">{x.value}</span>
                            {x.token ? (
                              <span>
                                → <span className="pv-mono">{x.token}</span>
                              </span>
                            ) : (
                              <span className="pv-muted">no token has this value</span>
                            )}
                          </li>
                        ))}
                        {file.findings.length > 100 ? (
                          <li className="pv-muted">
                            and {String(file.findings.length - 100)} more (orq kit check {file.path}
                            shows all)
                          </li>
                        ) : null}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  );
}
