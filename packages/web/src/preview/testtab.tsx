// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-155 | S15 | v0.1.0] D3 preview: Documents, UI kit and Test ──
//    Why:  the Test tab: testers, developers, clients and agents testing together. A run covers cases on a
//          matrix of browsers and devices; each step gets a result and evidence (screenshots, recordings
//          with console and network, voice notes that are transcribed), and a failure becomes a linked bug
//          in one click. Coverage shows what each requirement has; flaky tests are found and quarantined;
//          the Tester agent drafts cases and sorts failures; a named person signs the run off.
import { useState, type ReactNode } from 'react';
import { CASES, CONFIGS, COVERAGE_REQ, DEFECTS, FLAKY, MATRIX, type Result } from './data3.js';
import { euro, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, Stat } from './ui.js';

const RESULT_TONE: Record<Result, 'success' | 'danger' | 'warning' | 'neutral' | 'info'> = {
  passed: 'success',
  failed: 'danger',
  blocked: 'warning',
  skipped: 'neutral',
  untested: 'neutral',
  retest: 'info',
};

function Evidence(): ReactNode {
  const [tab, setTab] = useState<'shot' | 'rec' | 'voice'>('rec');
  return (
    <div className="pv-evidence">
      <div className="pv-side-tabs" role="tablist">
        {(
          [
            ['shot', 'Screenshot', 'uikit'],
            ['rec', 'Recording 0:42', 'play'],
            ['voice', 'Voice note 0:18', 'mention'],
          ] as [typeof tab, string, PIconName][]
        ).map(([k, l, i]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className="pv-side-tab"
            onClick={() => {
              setTab(k);
            }}
          >
            <PIcon name={i} size={14} />
            {l}
          </button>
        ))}
      </div>
      {tab === 'shot' ? (
        <svg
          className="pv-wire"
          viewBox="0 0 100 50"
          role="img"
          aria-label="Screenshot with a marked area"
        >
          <rect className="pv-wire-frame" x="0.5" y="0.5" width="99" height="49" rx="2" />
          <rect className="pv-wire-bar" x="0.5" y="0.5" width="99" height="6" rx="2" />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              className="pv-wire-line"
              x="4"
              y={11 + i * 7}
              width="60"
              height="4.5"
              rx="1"
            />
          ))}
          <rect className="pv-wire-eta" x="68" y="12" width="28" height="9" rx="1.5" />
          <text className="pv-wire-text" x="70" y="18.2">
            5 000 rows
          </text>
          <rect className="pv-mark-box" x="66" y="10" width="32" height="13" rx="2" />
          <rect className="pv-mark-blur" x="4" y="32" width="40" height="5" rx="1" />
          <text className="pv-wire-text pv-wire-text--small" x="4" y="44">
            Personal data in the list is masked automatically
          </text>
        </svg>
      ) : null}
      {tab === 'rec' ? (
        <div className="pv-rec">
          <div className="pv-player">
            <PIcon name="play" size={16} />
            <svg
              className="pv-timeline"
              viewBox="0 0 100 8"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect className="pv-bar-track" x="0" y="2" width="100" height="4" rx="2" />
              <rect className="pv-bar-fill-agent" x="0" y="2" width="64" height="4" rx="2" />
              <circle className="pv-tl-err" cx="78" cy="4" r="2.4" />
            </svg>
            <span className="pv-mono pv-small">0:27 / 0:42</span>
          </div>
          <div className="pv-console">
            <div className="pv-console-head">
              Console · 3 errors · captured by the Orqiva Capture extension
            </div>
            <code className="pv-log pv-log--warn">
              0:21 warn Export: 5 000 row page limit reached, requesting next page
            </code>
            <code className="pv-log pv-log--err">
              0:33 error Uncaught RangeError: Invalid array length (export-worker.js:118)
            </code>
            <code className="pv-log pv-log--err">0:33 error Download aborted</code>
          </div>
          <div className="pv-console">
            <div className="pv-console-head">Network · 1 failed</div>
            <code className="pv-log">0:19 GET /api/tours/export?page=1 200 1.9 MB 2.1 s</code>
            <code className="pv-log pv-log--err">
              0:32 GET /api/tours/export?page=2 500 — 0.4 s
            </code>
          </div>
        </div>
      ) : null}
      {tab === 'voice' ? (
        <div className="pv-voice">
          <svg className="pv-wave" viewBox="0 0 200 30" aria-hidden="true">
            {Array.from({ length: 50 }, (_, i) => {
              const h = 4 + Math.abs(Math.sin(i * 1.7) * 11) + (i % 7);
              return (
                <rect
                  key={i}
                  className="pv-wave-bar"
                  x={i * 4}
                  y={15 - h / 2}
                  width="2.4"
                  height={h}
                  rx="1"
                />
              );
            })}
          </svg>
          <p className="pv-transcript">
            “In Firefox the export stops after the first five thousand rows, Chrome is fine. It
            happens every time with September data. The console shows an invalid array length.”
          </p>
          <span className="pv-muted pv-small">
            Transcribed automatically · the Tester agent can read it
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Runs(): ReactNode {
  const c = CASES[0];
  const [results, setResults] = useState<(Result | null)[]>([
    'passed',
    'passed',
    'passed',
    'failed',
    null,
  ]);
  const [bug, setBug] = useState(false);
  const [signed, setSigned] = useState(false);
  const [cell, setCell] = useState<[number, number]>([0, 1]);
  if (!c) return null;
  const set = (i: number, r: Result): void => {
    setResults((all) => all.map((x, j) => (j === i ? r : x)));
  };
  const total = MATRIX.flat().length;
  const passed = MATRIX.flat().filter((r) => r === 'passed').length;
  return (
    <div className="pv-stack">
      <Card>
        <div className="pv-sprint-row">
          <div>
            <div className="pv-sprint-title">
              <strong className="pv-run-title">Run 88 · Exports and dispatch regression</strong>
              <Chip tone="primary">in progress</Chip>
            </div>
            <div className="pv-muted pv-small pv-mt-4">
              Sprint 14 · build 1.4.0-rc.2 on staging · started 08:10 by Sara · 6 configurations
            </div>
          </div>
          <div className="pv-sprint-figures">
            <div>
              <span className="pv-muted pv-small">Passed</span>
              <strong className="pv-num">
                {passed} / {total}
              </strong>
            </div>
            <div>
              <span className="pv-muted pv-small">Testers</span>
              <span className="pv-avatar-stack">
                <Avatar id="sara" size="xs" ring />
                <Avatar id="lea" size="xs" ring />
                <Avatar id="a-tester" size="xs" ring />
                <Avatar id="c-kai" size="xs" ring />
              </span>
            </div>
            {signed ? (
              <Chip tone="success" icon="signoff">
                Signed off by Sara · snapshot kept
              </Chip>
            ) : (
              <Button
                kind="primary"
                icon="signoff"
                onClick={() => {
                  setSigned(true);
                }}
              >
                Sign off the run
              </Button>
            )}
          </div>
        </div>
        <Bar value={passed} max={total} tone="success" />
      </Card>

      <Card flush title="Matrix">
        <div className="pv-grid-scroll">
          <table className="pv-table pv-matrix-table">
            <thead>
              <tr>
                <th>Case</th>
                {CONFIGS.map((x) => (
                  <th key={x} className="pv-center">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row, i) => (
                <tr key={i}>
                  <td>
                    <span className="pv-mono pv-muted">{CASES[i]?.id}</span> {CASES[i]?.title}
                  </td>
                  {row.map((r, j) => (
                    <td key={j} className="pv-center">
                      <button
                        type="button"
                        className={
                          'pv-result pv-result--' +
                          r +
                          (cell[0] === i && cell[1] === j ? ' pv-result--sel' : '')
                        }
                        onClick={() => {
                          setCell([i, j]);
                        }}
                        title={(CASES[i]?.id ?? '') + ' on ' + (CONFIGS[j] ?? '')}
                      >
                        {r}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="pv-split">
        <Card
          title={
            <>
              <span className="pv-mono pv-muted">{c.id}</span> {c.title}{' '}
              <span className="pv-muted pv-small">
                · {CONFIGS[1]} · case v{c.version}
              </span>
            </>
          }
          action={
            <span className="pv-page-actions">
              <span className="pv-muted pv-small pv-num">
                <PIcon name="clock" size={12} /> 6:40
              </span>
              <Chip tone="info">requirement {c.req}</Chip>
            </span>
          }
        >
          <ol className="pv-steps">
            {c.steps.map((s, i) => {
              const r = results[i];
              return (
                <li
                  key={s.action}
                  className={'pv-step' + (r === 'failed' ? ' pv-step--failed' : '')}
                >
                  <span className="pv-step-num">{i + 1}</span>
                  <div className="pv-step-body">
                    <strong>{s.action}</strong>
                    <span className="pv-muted pv-small">Expected: {s.expected}</span>
                    {r === 'failed' ? (
                      <span className="pv-text-danger pv-small">
                        Actual: download stops at 5 000 rows, 3 console errors
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="pv-step-results"
                    role="group"
                    aria-label={'Result of step ' + String(i + 1)}
                  >
                    {(['passed', 'failed', 'blocked', 'skipped'] as Result[]).map((x) => (
                      <button
                        key={x}
                        type="button"
                        className={'pv-step-btn pv-step-btn--' + x}
                        aria-pressed={r === x}
                        onClick={() => {
                          set(i, x);
                        }}
                      >
                        {x === 'passed'
                          ? 'Pass'
                          : x === 'failed'
                            ? 'Fail'
                            : x === 'blocked'
                              ? 'Block'
                              : 'Skip'}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
        <div className="pv-stack">
          <Card
            title="Evidence for step 4"
            action={
              <Button size="sm" kind="ghost" icon="plus">
                Add
              </Button>
            }
          >
            <Evidence />
            <p className="pv-muted pv-small">
              Also from a phone: scan the run’s code and record. Clients upload the same way in
              their portal.
            </p>
          </Card>
          <Card title="AI triage">
            <div className="pv-callout pv-callout--agent">
              <PIcon name="agents" size={16} />
              <div>
                <strong>Likely a product bug (91 %).</strong> Same cause as NWL-191: the export
                worker builds one array for all rows. Only Firefox hits its limit first.
              </div>
            </div>
            {bug ? (
              <Chip tone="success" icon="check">
                NWL-216 filed: linked to C-412 step 4, with recording, console, network and voice
                note
              </Chip>
            ) : (
              <div className="pv-page-actions">
                <Button
                  kind="primary"
                  icon="plus"
                  onClick={() => {
                    setBug(true);
                  }}
                >
                  File bug with all evidence
                </Button>
                <Button kind="ghost">Link to NWL-191 instead</Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Repository(): ReactNode {
  const suites = [...new Set(CASES.map((c) => c.suite))];
  return (
    <Card
      flush
      title={'Test cases · ' + String(CASES.length)}
      action={
        <span className="pv-page-actions">
          <Button size="sm" icon="plus">
            New case
          </Button>
          <Button size="sm" kind="ghost">
            Import JUnit, Playwright, Cypress
          </Button>
        </span>
      }
    >
      <table className="pv-table">
        <thead>
          <tr>
            <th>Case</th>
            <th>Type</th>
            <th>Run by</th>
            <th>Requirement</th>
            <th className="pv-num">Version</th>
            <th>Last result</th>
          </tr>
        </thead>
        {suites.map((s) => (
          <tbody key={s}>
            <tr className="pv-group-row">
              <td colSpan={6}>{s}</td>
            </tr>
            {CASES.filter((c) => c.suite === s).map((c) => (
              <tr key={c.id}>
                <td>
                  <span className="pv-mono pv-muted">{c.id}</span> {c.title}
                </td>
                <td>
                  <Chip>{c.type === 'bdd' ? 'Given/When/Then' : c.type}</Chip>
                </td>
                <td>
                  <Chip tone={c.auto === 'manual' ? 'neutral' : 'agent'}>{c.auto}</Chip>
                </td>
                <td className="pv-mono">{c.req}</td>
                <td className="pv-num">v{c.version}</td>
                <td>
                  <Chip tone={RESULT_TONE[c.last]}>{c.last}</Chip>
                  {c.flaky ? <Chip tone="warning">flaky {Math.round(c.flaky * 100)} %</Chip> : null}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </Card>
  );
}

function Coverage(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Requirements with tests"
          value="5 / 6"
          sub="NWL-202 has none"
          tone="warning"
          icon="check"
        />
        <Stat label="Automated" value="62 %" sub="of 18 cases" icon="agents" />
        <Stat label="Code covered" value="81 %" sub="lines, from CI" icon="ide" />
        <Stat
          label="Bugs that escaped"
          value="1"
          sub="found in production this month"
          tone="danger"
          icon="incident"
        />
      </div>
      <Card flush title="Coverage per requirement">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Requirement</th>
              <th className="pv-num">Cases</th>
              <th>Passing</th>
              <th className="pv-num">Automated</th>
            </tr>
          </thead>
          <tbody>
            {COVERAGE_REQ.map((r) => (
              <tr key={r.req}>
                <td className="pv-cell-grow">{r.req}</td>
                <td className="pv-num">{r.cases}</td>
                <td className="pv-cell-bar">
                  {r.cases ? (
                    <>
                      <Bar
                        value={r.passed}
                        max={r.cases}
                        tone={r.passed === r.cases ? 'success' : 'warning'}
                      />
                      <span className="pv-small pv-muted">
                        {r.passed} of {r.cases}
                      </span>
                    </>
                  ) : (
                    <Chip tone="danger">no tests</Chip>
                  )}
                </td>
                <td className="pv-num">{r.auto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Flaky(): ReactNode {
  const [q, setQ] = useState<string[]>(FLAKY.filter((f) => f.quarantined).map((f) => f.id));
  return (
    <Card
      flush
      title="Flaky tests"
      action={
        <span className="pv-muted pv-small">
          A test is flaky when it changes result without a code change
        </span>
      }
    >
      <table className="pv-table">
        <thead>
          <tr>
            <th>Case</th>
            <th>Last 10 runs</th>
            <th className="pv-num">Flips</th>
            <th>Quarantine</th>
          </tr>
        </thead>
        <tbody>
          {FLAKY.map((f) => (
            <tr key={f.id}>
              <td className="pv-cell-grow">
                <span className="pv-mono pv-muted">{f.id}</span> {f.title}
              </td>
              <td>
                <span className="pv-runs">
                  {f.runs.split('').map((r, i) => (
                    <span
                      key={i}
                      className={'pv-run-dot pv-run-dot--' + (r === 'P' ? 'ok' : 'bad')}
                    />
                  ))}
                </span>
              </td>
              <td className="pv-num">{f.rate} %</td>
              <td>
                <label className="pv-switch">
                  <input
                    type="checkbox"
                    checked={q.includes(f.id)}
                    onChange={(e) => {
                      setQ((all) =>
                        e.target.checked ? [...all, f.id] : all.filter((x) => x !== f.id),
                      );
                    }}
                  />
                  <span>{q.includes(f.id) ? 'does not block the gate' : 'blocks the gate'}</span>
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Defects(): ReactNode {
  return (
    <Card flush title="Bugs from testing">
      <ul className="pv-rows">
        {DEFECTS.map((d) => (
          <li key={d.id} className="pv-row pv-row--static">
            <span
              className={'pv-kind pv-kind--' + (d.severity === 'high' ? 'incident' : 'request')}
            >
              <PIcon name="incident" size={15} />
            </span>
            <span className="pv-row-main">
              <span className="pv-row-title">
                <span className="pv-mono pv-muted">{d.id}</span> {d.title}
              </span>
              <span className="pv-row-sub">
                From {d.from} · reported by {person(d.who).name} · AI: {d.ai}
              </span>
            </span>
            <Chip
              tone={
                d.severity === 'high' ? 'danger' : d.severity === 'medium' ? 'warning' : 'neutral'
              }
            >
              {d.severity}
            </Chip>
            <Chip>{d.state}</Chip>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Generate(): ReactNode {
  const [made, setMade] = useState(false);
  return (
    <Card
      title={
        <span className="pv-who">
          <Avatar id="a-tester" size="xs" /> Draft cases with the Tester agent
        </span>
      }
    >
      <div className="pv-ask">
        <select className="pv-select" aria-label="From" defaultValue="NWL-202">
          <option value="NWL-202">From NWL-202 Customer tracking link (criteria and PRD)</option>
          <option value="NWL-188">From NWL-188 code diff (#318)</option>
        </select>
        <Button
          kind="primary"
          icon="sparkle"
          onClick={() => {
            setMade(true);
          }}
        >
          Draft cases · about {euro(0.3, 2)}
        </Button>
      </div>
      {made ? (
        <ul className="pv-draft">
          {[
            'Link opens the tracking page for the right delivery',
            'Link shows only “delivered” 24 h after delivery (R-12)',
            'Driver photo never appears, first name only (R-13)',
            'Page loads in under 1.5 s on a 3G profile (R-15)',
            'Exploratory: delivery note close to the cut-off (2 stops away)',
          ].map((t) => (
            <li key={t} className="pv-draft-row pv-draft-row--on">
              <label className="pv-draft-check">
                <input type="checkbox" defaultChecked />
              </label>
              <span className="pv-row-main">
                <span className="pv-row-title">{t}</span>
              </span>
            </li>
          ))}
          <li className="pv-draft-foot">
            <Button kind="primary" icon="check">
              Add 5 cases to the repository
            </Button>
          </li>
        </ul>
      ) : (
        <p className="pv-muted pv-small">
          The agent reads the requirement, its PRD passages and the diff, and proposes cases you
          accept one by one.
        </p>
      )}
    </Card>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'runs', label: 'Run 88', icon: 'play' },
  { key: 'repo', label: 'Repository', icon: 'documents' },
  { key: 'coverage', label: 'Coverage', icon: 'check' },
  { key: 'flaky', label: 'Flaky', icon: 'flag' },
  { key: 'defects', label: 'Bugs', icon: 'incident' },
  { key: 'generate', label: 'AI cases', icon: 'sparkle' },
];

export function TestTab(): ReactNode {
  const [view, setView] = useState('runs');
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="Test view">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className="pv-subtab"
            aria-pressed={view === v.key}
            onClick={() => {
              setView(v.key);
            }}
          >
            <PIcon name={v.icon} size={14} />
            {v.label}
          </button>
        ))}
      </nav>
      {view === 'runs' ? <Runs /> : null}
      {view === 'repo' ? <Repository /> : null}
      {view === 'coverage' ? <Coverage /> : null}
      {view === 'flaky' ? <Flaky /> : null}
      {view === 'defects' ? <Defects /> : null}
      {view === 'generate' ? <Generate /> : null}
    </div>
  );
}
