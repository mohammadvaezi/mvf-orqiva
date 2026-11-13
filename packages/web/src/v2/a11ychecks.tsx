// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
//    Why:  next to the contrast checks, what the code scan and the page audits found: counted by rule,
//          the code by file and line, each screen with the element and what is wrong with it, and how
//          to run them when nothing was sent yet.
import { A11Y_RULES, type A11yRule } from '@orqiva/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Card, Chip } from '../preview/ui.js';

interface Report {
  id: string;
  name: string;
  url: string;
  title: string;
  files: number;
  checked: { targets?: number; focusable?: number; images?: number };
  counts: Record<string, number>;
  findings: {
    rule: string;
    path?: string;
    line?: number;
    snippet?: string;
    selector?: string;
    message?: string;
  }[];
  commit: string;
  by: string | null;
  at: string;
}

export const ruleText = (r: string): string => (r in A11Y_RULES ? A11Y_RULES[r as A11yRule] : r);

/** The rules of a report, most frequent first: "Image without alt text 3, …". */
export function countsText(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([r, n]) => ruleText(r) + ' ' + String(n))
    .join(', ');
}

function Counts(props: { counts: Record<string, number> }): ReactNode {
  const list = Object.entries(props.counts).sort((a, b) => b[1] - a[1]);
  if (!list.length) return <Chip tone="success">no problems</Chip>;
  return (
    <span className="v2-handoff-chips">
      {list.map(([r, n]) => (
        <Chip key={r} tone="warning">
          {ruleText(r)} · {n}
        </Chip>
      ))}
    </span>
  );
}

export function A11yFindings(props: { workspaceId: string; projectId: string }): ReactNode {
  const [data, setData] = useState<{ code: Report | null; pages: Report[] } | null>(null);
  useEffect(() => {
    void api<{ code: Report | null; pages: Report[] }>(
      'GET',
      '/api/workspaces/' + props.workspaceId + '/projects/' + props.projectId + '/a11y',
    ).then((r) => {
      if (r.ok) setData(r.data);
    });
  }, [props.workspaceId, props.projectId]);
  if (!data) return null;
  const byFile = new Map<string, Report['findings']>();
  for (const f of data.code?.findings ?? [])
    byFile.set(f.path ?? '', [...(byFile.get(f.path ?? '') ?? []), f]);
  return (
    <Card title="Accessibility">
      {!data.code && !data.pages.length ? (
        <p className="pv-small">
          Nothing checked yet. <code className="v2-mono">orq a11y scan</code> reads the code: alt
          text, names, clicks the keyboard cannot reach, tabindex, labels, focus styles. On a
          running page, CI runs the script of <code className="v2-mono">orq a11y script</code> and
          sends what it gives with{' '}
          <code className="v2-mono">orq a11y report FILE.json --name SCREEN</code>: real target
          sizes, the focus order and focus marks.
        </p>
      ) : null}
      {data.code ? (
        <section className="pv-stack">
          <h4 className="v2-handoff-h">
            In the code · {data.code.files} UI files · {data.code.at.slice(0, 10)}
            {data.code.by ? ' by ' + data.code.by : ''}
          </h4>
          <Counts counts={data.code.counts} />
          {byFile.size ? (
            <details>
              <summary className="pv-small">{byFile.size} files with problems</summary>
              <ul className="pv-rows pv-rows--tight v2-mt">
                {[...byFile.entries()]
                  .sort((a, b) => b[1].length - a[1].length)
                  .slice(0, 60)
                  .map(([path, list]) => (
                    <li key={path} className="pv-row pv-row--static">
                      <span className="pv-row-main">
                        <span className="pv-row-title v2-mono">{path}</span>
                        {list.slice(0, 12).map((f, i) => (
                          <span key={i} className="pv-row-sub">
                            line {f.line}: {ruleText(f.rule)}{' '}
                            <span className="v2-mono">{f.snippet}</span>
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
      {data.pages.length ? (
        <section className="pv-stack v2-mt">
          <h4 className="v2-handoff-h">On the page · {data.pages.length} screens</h4>
          <ul className="pv-rows pv-rows--tight">
            {data.pages.map((p) => (
              <li key={p.id} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">
                    {p.name}{' '}
                    <span className="pv-muted pv-small">
                      {p.checked.targets ?? 0} targets · {p.checked.images ?? 0} images ·{' '}
                      {p.at.slice(0, 10)}
                      {p.commit ? ' · ' + p.commit.slice(0, 7) : ''}
                    </span>
                  </span>
                  <Counts counts={p.counts} />
                  {p.findings.length ? (
                    <details>
                      <summary className="pv-small">{p.findings.length} problems</summary>
                      <ul className="v2-handoff-list v2-mt">
                        {p.findings.slice(0, 100).map((f, i) => (
                          <li key={i} className="pv-small">
                            <strong>{ruleText(f.rule)}</strong>{' '}
                            <span className="v2-mono">{f.selector}</span>: {f.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}
