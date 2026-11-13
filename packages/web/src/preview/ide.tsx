// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-158 | S15 | v0.1.0] D6 preview: Clients and portal, Incidents, Time, web and VS Code side by side ──
//    Why:  the owner decided that everything stays in sync between the web app and the IDE. This page
//          shows both at once: VS Code with the Orqiva sidebar, fingerprints with CodeLens, coverage in
//          the gutter, an agent run streaming in the panel and the task and timer in the status bar; next
//          to it the web app. An action on either side arrives on the other within a second.
import { useState, type ReactNode } from 'react';
import { person } from './data.js';
import { PIcon } from './picons.js';
import { Avatar, Button, Card, Chip, PageHead } from './ui.js';

type State = 'In Progress' | 'Review';

const CODE: { n: number; text: string; kind?: 'fp' | 'covered' | 'uncovered' }[] = [
  {
    n: 38,
    text: '// ── [NWL-191 | S14 | v1.4.0] Tour export: CSV in pages of 5 000 ──',
    kind: 'fp',
  },
  { n: 39, text: 'export async function* exportTours(filter: TourFilter) {', kind: 'covered' },
  { n: 40, text: '  let page = 0;', kind: 'covered' },
  { n: 41, text: '  for (;;) {', kind: 'covered' },
  {
    n: 42,
    text: '    const rows = await db.tours(filter, { offset: page * 5000, limit: 5000 });',
    kind: 'covered',
  },
  { n: 43, text: '    if (!rows.length) return;', kind: 'covered' },
  { n: 44, text: '    yield toCsv(rows, { header: page === 0 });', kind: 'covered' },
  { n: 45, text: '    page += 1;', kind: 'covered' },
  { n: 46, text: '  }', kind: 'covered' },
  { n: 47, text: '}' },
  { n: 48, text: '' },
  {
    n: 49,
    text: 'function toCsv(rows: Tour[], opts: { header: boolean }): string {',
    kind: 'uncovered',
  },
];

export function IdePage(): ReactNode {
  const [state, setState] = useState<State>('In Progress');
  const [approved, setApproved] = useState(false);
  const [comment, setComment] = useState('');
  const [comments, setComments] = useState<{ who: string; text: string; from: 'web' | 'ide' }[]>([
    { who: 'sara', text: 'Firefox still stops at 5 000 rows on staging.', from: 'web' },
  ]);
  const [toast, setToast] = useState('');
  const flash = (t: string): void => {
    setToast(t);
    window.setTimeout(() => {
      setToast('');
    }, 2600);
  };
  return (
    <div className="pv-page pv-page--wide">
      <PageHead
        title="Web app and VS Code, in sync"
        sub="Same task, inbox, agents and time on both sides · change something on either side"
        icon="ide"
        actions={
          toast ? (
            <Chip tone="success" icon="live">
              {toast}
            </Chip>
          ) : (
            <Chip icon="live">Connected · 1 live stream for web, VS Code, CLI and phone</Chip>
          )
        }
      />
      <div className="pv-sync">
        <div className="pv-vsc" aria-label="VS Code">
          <div className="pv-vsc-title">route.ts — fleet-portal — Visual Studio Code</div>
          <div className="pv-vsc-body">
            <div className="pv-vsc-activity" aria-hidden="true">
              <PIcon name="documents" size={18} />
              <PIcon name="search" size={18} />
              <PIcon name="git" size={18} />
              <span className="pv-vsc-pe">P</span>
            </div>
            <div className="pv-vsc-side">
              <div className="pv-vsc-head">ORQIVA</div>
              <div className="pv-vsc-group">ACTIVE TASK</div>
              <div className="pv-vsc-item pv-vsc-item--active">
                <span
                  className={
                    'pv-vsc-state pv-vsc-state--' + (state === 'Review' ? 'review' : 'progress')
                  }
                />{' '}
                NWL-191 CSV export at scale
              </div>
              <div className="pv-vsc-actions">
                <button
                  type="button"
                  className="pv-vsc-btn"
                  disabled={state === 'Review'}
                  onClick={() => {
                    setState('Review');
                    flash('VS Code → web: NWL-191 moved to Review (0.3 s)');
                  }}
                >
                  orq status review
                </button>
              </div>
              <div className="pv-vsc-group">SPRINT 14 · 21/35 PT</div>
              {['NWL-188 Live re-routing', 'NWL-189 Traffic layer', 'NWL-196 Map tiles cache'].map(
                (t) => (
                  <div key={t} className="pv-vsc-item">
                    <span className="pv-vsc-state pv-vsc-state--todo" /> {t}
                  </div>
                ),
              )}
              <div className="pv-vsc-group">INBOX · {approved ? 1 : 2}</div>
              {approved ? null : (
                <div className="pv-vsc-item pv-vsc-item--warn">
                  <PIcon name="approval" size={13} /> Coder waits: migration on staging
                </div>
              )}
              <div className="pv-vsc-item">
                <PIcon name="mention" size={13} /> Sara mentioned you on NWL-191
              </div>
              <div className="pv-vsc-group">COMMENTS ON NWL-191</div>
              {comments.map((c, i) => (
                <div key={i} className="pv-vsc-item pv-vsc-item--wrap">
                  <strong>{person(c.who).name.split(' ')[0]}:</strong> {c.text}
                </div>
              ))}
            </div>
            <div className="pv-vsc-editor">
              <div className="pv-vsc-tabs">
                <span className="pv-vsc-tab pv-vsc-tab--on">route.ts</span>
                <span className="pv-vsc-tab">export.ts</span>
              </div>
              <div className="pv-vsc-lens">
                NWL-191 · {state} · Sara: “Firefox still stops…” ·{' '}
                <span className="pv-vsc-link">open in Orqiva</span> · Lea 2 min ago
              </div>
              <pre className="pv-vsc-code">
                {CODE.map((l) => (
                  <div
                    key={l.n}
                    className={'pv-vsc-line' + (l.kind ? ' pv-vsc-line--' + l.kind : '')}
                  >
                    <span className="pv-vsc-n">{l.n}</span>
                    <span className="pv-vsc-gutter" />
                    <span>{l.text}</span>
                  </div>
                ))}
              </pre>
              <div className="pv-vsc-panel">
                <div className="pv-vsc-panel-head">ORQIVA: AGENT RUN 1 482 · CODER · NWL-188</div>
                <div>✓ step 12 write_file src/dispatch/route.ts</div>
                <div>✓ step 13 shell npm test -- route (21.7 s, 14 passed)</div>
                <div className="pv-vsc-run">
                  ● step 14 writing tests for route recalculation … €1.92 so far
                </div>
              </div>
            </div>
          </div>
          <div className="pv-vsc-status">
            <span>⎇ fix/csv-pages</span>
            <span>NWL-191 · S14 · v1.4.0</span>
            <span>● synced</span>
            <span>⏱ 2:14</span>
            <span>{approved ? 'inbox 1' : 'inbox 2'}</span>
          </div>
        </div>

        <div className="pv-stack">
          <Card title="Web app · NWL-191">
            <div className="pv-sync-task">
              <Chip tone={state === 'Review' ? 'info' : 'primary'}>{state}</Chip>
              <span className="pv-muted pv-small">Lea · timer 2:14 · 3 commits · PR #323</span>
            </div>
            <ul className="pv-rows pv-rows--tight">
              {comments.map((c, i) => (
                <li key={i} className="pv-row pv-row--static">
                  <Avatar id={c.who} size="xs" />
                  <span className="pv-row-main">
                    <span className="pv-row-title pv-wrap">{c.text}</span>
                    <span className="pv-row-sub">
                      from {c.from === 'web' ? 'the web app' : 'VS Code'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="pv-ask">
              <input
                value={comment}
                placeholder="Comment from the web…"
                aria-label="Comment"
                onChange={(e) => {
                  setComment(e.target.value);
                }}
              />
              <Button
                onClick={() => {
                  if (!comment.trim()) return;
                  setComments((c) => [...c, { who: 'mara', text: comment.trim(), from: 'web' }]);
                  setComment('');
                  flash('web → VS Code: comment shown in the sidebar (0.2 s)');
                }}
              >
                Send
              </Button>
            </div>
          </Card>
          <Card title="Web app · inbox">
            {approved ? (
              <Chip tone="success" icon="check">
                Approved · the agent continues · gone from both inboxes
              </Chip>
            ) : (
              <div className="pv-sync-task">
                <span className="pv-row-main">
                  <strong>Coder wants to run migration 0042 on staging</strong>
                  <span className="pv-muted pv-small">HEL-212 · €0.84 remaining</span>
                </span>
                <Button
                  kind="primary"
                  size="sm"
                  onClick={() => {
                    setApproved(true);
                    flash('web → VS Code: approval arrived, inbox updated (0.2 s)');
                  }}
                >
                  Approve
                </Button>
              </div>
            )}
          </Card>
          <Card flush title="Where each part works">
            <table className="pv-table pv-table--compact">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th className="pv-center">Web</th>
                  <th className="pv-center">VS Code</th>
                  <th className="pv-center">CLI pe</th>
                  <th className="pv-center">Phone</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Tasks, start and done', 1, 1, 1, 1],
                  ['Inbox and approvals', 1, 1, 1, 1],
                  ['Ideation interview', 1, 1, 1, 0],
                  ['Comments and mentions', 1, 1, 1, 1],
                  ['Agents: start, watch, pause', 1, 1, 1, 1],
                  ['Code map and fingerprints', 1, 1, 1, 0],
                  ['Test results and evidence', 1, 1, 1, 1],
                  ['Time tracking', 1, 1, 1, 1],
                  ['Gantt, documents, UI kit', 1, 0, 0, 0],
                ].map(([f, ...v]) => (
                  <tr key={String(f)}>
                    <td>{f}</td>
                    {v.map((x, i) => (
                      <td key={i} className="pv-center">
                        {x ? (
                          <PIcon name="check" size={14} className="pv-text-success" />
                        ) : (
                          <span className="pv-muted">opens web</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  );
}
