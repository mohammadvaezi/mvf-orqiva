// ── [PCODE-154 | S15 | v0.1.0] D2 preview: Ideation, Planning and Canvas ──
//    Why:  the Ideation tab: documents come in, the Analyst agent interviews the people who know until
//          every area is covered, and what it learns becomes requirements that cite their source, open
//          questions with owners, risks, stories with acceptance criteria, a priority score and finally a
//          versioned PRD that the client and the lead sign. The interview continues in VS Code with
//          `pe idea` and shows here live.
import { useState, type ReactNode } from 'react';
import {
  COVERAGE,
  DECISIONS,
  GLOSSARY,
  IDEAS,
  INTERVIEW,
  PRD_VERSIONS,
  QUESTIONS,
  REQUIREMENTS,
  RISKS2,
  SOURCES,
  type IdeaState,
} from './data2.js';
import { person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, Ring } from './ui.js';

const STATE_TONE: Record<
  IdeaState,
  'neutral' | 'primary' | 'info' | 'warning' | 'success' | 'danger'
> = {
  new: 'neutral',
  interviewing: 'primary',
  drafting: 'info',
  'in review': 'warning',
  approved: 'success',
  rejected: 'danger',
};

const SUBTABS: { key: string; label: string; icon: PIconName; count?: number }[] = [
  { key: 'interview', label: 'Interview', icon: 'question' },
  { key: 'sources', label: 'Sources', icon: 'documents', count: SOURCES.length },
  { key: 'requirements', label: 'Requirements', icon: 'check', count: REQUIREMENTS.length },
  { key: 'questions', label: 'Open questions', icon: 'question', count: 2 },
  { key: 'risks', label: 'Risks and assumptions', icon: 'incident', count: RISKS2.length },
  { key: 'stories', label: 'Personas and stories', icon: 'user' },
  { key: 'priority', label: 'Priority', icon: 'insights' },
  { key: 'prd', label: 'PRD', icon: 'signoff' },
  { key: 'decisions', label: 'Decisions and glossary', icon: 'flag' },
];

const NEXT_QUESTIONS = [
  {
    text: 'Understood. Should the page work without JavaScript for older phones, or is a modern browser fine?',
    area: 'Non-functional',
  },
  {
    text: 'Last one for security: may anyone with the link see the page, or should the customer confirm their postcode first?',
    area: 'Security',
  },
  {
    text: 'Every area is covered. I will write PRD v4 with R-16 to R-18 and send it to you and Kai for review.',
    area: '',
  },
];

function Interview(props: { pkey: string }): ReactNode {
  const [messages, setMessages] = useState(INTERVIEW);
  const [draft, setDraft] = useState('');
  const [step, setStep] = useState(0);
  const [coverage, setCoverage] = useState(COVERAGE);
  const answer = (): void => {
    const text = draft.trim();
    if (!text) return;
    const next = NEXT_QUESTIONS[step];
    setMessages((m) => [
      ...m,
      { who: 'mara', text },
      ...(next ? [{ who: 'a-analyst', text: next.text, area: next.area }] : []),
    ]);
    setCoverage((c) =>
      c.map((a, i) => (i === 3 + step || (step === 2 && a.pct < 100) ? { ...a, pct: 100 } : a)),
    );
    setStep((s) => s + 1);
    setDraft('');
  };
  const total = Math.round(coverage.reduce((s, a) => s + a.pct, 0) / coverage.length);
  return (
    <div className="pv-split">
      <Card flush className="pv-chat-card">
        <div className="pv-chat">
          {messages.map((m, i) => (
            <div
              key={i}
              className={'pv-msg' + (person(m.who).kind === 'agent' ? ' pv-msg--agent' : '')}
            >
              <Avatar id={m.who} size="sm" />
              <div className="pv-msg-body">
                <div className="pv-msg-head">
                  <strong>{person(m.who).name}</strong>
                  {'area' in m && m.area ? <Chip tone="primary">{m.area}</Chip> : null}
                </div>
                <p>{m.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="pv-composer">
          <textarea
            value={draft}
            placeholder="Answer the Analyst… (Ctrl Enter to send)"
            aria-label="Your answer"
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) answer();
            }}
          />
          <div className="pv-composer-row">
            <Button kind="ghost" icon="user" size="sm">
              Ask someone else
            </Button>
            <Button kind="ghost" icon="documents" size="sm">
              Attach
            </Button>
            <Button kind="ghost" icon="snooze" size="sm">
              Skip for now
            </Button>
            <span className="pv-spacer" />
            <span className="pv-hint">
              In VS Code:{' '}
              <span className="pv-mono">pe idea {props.pkey === 'NWL' ? 'I-15' : 'I-14'}</span>
            </span>
            <Button kind="primary" icon="arrowRight" size="sm" onClick={answer}>
              Send
            </Button>
          </div>
        </div>
      </Card>
      <div className="pv-stack">
        <Card title="Coverage">
          <div className="pv-coverage-head">
            <Ring value={total} max={100} size={64} tone={total === 100 ? 'success' : 'primary'} />
            <p className="pv-muted pv-small">
              The interview ends when every area is covered. Each answer becomes a requirement, a
              question or a decision.
            </p>
          </div>
          <ul className="pv-coverage">
            {coverage.map((a) => (
              <li key={a.area}>
                <span>{a.area}</span>
                <Bar value={a.pct} max={100} tone={a.pct === 100 ? 'success' : 'primary'} />
                <span className="pv-num pv-muted">{a.pct} %</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Learned so far">
          <div className="pv-kv">
            <span>Requirements</span>
            <span>23 (7 non-functional)</span>
            <span>Open questions</span>
            <span>2, owners named</span>
            <span>Decisions</span>
            <span>3 recorded</span>
            <span>Out of scope</span>
            <span>Proof-of-delivery photos</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Sources(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-drop">
        <PIcon name="documents" size={28} />
        <div>
          <strong>Drop documents, images, audio or links</strong>
          <span className="pv-muted pv-block">
            PDF, Word, PowerPoint, images (read with OCR), audio and video (transcribed), web pages.
            From VS Code: <span className="pv-mono">pe idea add spec.pdf</span>
          </span>
        </div>
        <Button kind="primary" icon="plus">
          Add files
        </Button>
      </div>
      <Card flush>
        <table className="pv-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Kind</th>
              <th>Read</th>
              <th className="pv-num">Statements</th>
              <th>Added by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.name}>
                <td className="pv-cell-grow">
                  <strong>{s.name}</strong>
                  <span className="pv-muted pv-block pv-small">{s.size}</span>
                </td>
                <td>
                  <Chip>{s.kind}</Chip>
                </td>
                <td>
                  <Chip tone="success" icon="check">
                    {s.status}
                  </Chip>
                </td>
                <td className="pv-num">{s.extracted}</td>
                <td>
                  <span className="pv-who">
                    <Avatar id={s.by} size="xs" />
                    {person(s.by).name}
                  </span>
                </td>
                <td>
                  <Button kind="ghost" size="sm">
                    Show passages
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Requirements(): ReactNode {
  const [type, setType] = useState('All');
  const types = ['All', ...new Set(REQUIREMENTS.map((r) => r.type))];
  return (
    <Card
      flush
      title="Requirements"
      action={
        <div className="pv-segmented" role="radiogroup" aria-label="Type">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              className="pv-seg"
              onClick={() => {
                setType(t);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      }
    >
      <table className="pv-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Requirement</th>
            <th>Source</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {REQUIREMENTS.filter((r) => type === 'All' || r.type === type).map((r) => (
            <tr key={r.id}>
              <td className="pv-mono pv-cell-ref">{r.id}</td>
              <td className="pv-cell-grow">
                {r.text}
                <span className="pv-muted pv-block pv-small">{r.type}</span>
              </td>
              <td>
                <span className="pv-cite">
                  <PIcon name="documents" size={13} />
                  {r.source}
                </span>
              </td>
              <td>
                <Chip tone={r.status === 'agreed' ? 'success' : 'warning'}>{r.status}</Chip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Questions(): ReactNode {
  return (
    <Card
      flush
      title="Open questions"
      action={
        <Button size="sm" icon="plus">
          Ask a question
        </Button>
      }
    >
      <ul className="pv-rows">
        {QUESTIONS.map((q) => (
          <li key={q.id} className="pv-row pv-row--static">
            <span className="pv-mono pv-muted">{q.id}</span>
            <span className="pv-row-main">
              <span className="pv-row-title">{q.text}</span>
              <span className="pv-row-sub">
                Owner {person(q.owner).name} · {q.state === 'open' ? 'due ' + q.due : 'answered'}
              </span>
            </span>
            <Avatar id={q.owner} size="sm" />
            <Chip tone={q.state === 'open' ? 'warning' : 'success'}>{q.state}</Chip>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Risks(): ReactNode {
  return (
    <div className="pv-split pv-split--even">
      <Card title="Risk matrix">
        <div className="pv-matrix" role="img" aria-label="Risks by likelihood and impact">
          {[5, 4, 3, 2, 1].map((imp) =>
            [1, 2, 3, 4, 5].map((lik) => {
              const here = RISKS2.map((r, i) => ({ ...r, i })).filter(
                (r) => r.l === lik && r.i === imp,
              );
              const score = imp * lik;
              return (
                <div
                  key={String(imp) + String(lik)}
                  className={
                    'pv-matrix-cell pv-matrix-cell--' +
                    (score >= 12 ? 'high' : score >= 6 ? 'mid' : 'low')
                  }
                >
                  {here.map((r) => (
                    <span key={r.i} className="pv-matrix-dot" title={r.text}>
                      {r.i + 1}
                    </span>
                  ))}
                </div>
              );
            }),
          )}
        </div>
        <div className="pv-matrix-axis">
          <span>Likelihood →</span>
          <span>↑ Impact</span>
        </div>
      </Card>
      <div className="pv-stack">
        <Card title="Risks">
          <ol className="pv-numbered">
            {RISKS2.map((r) => (
              <li key={r.text}>
                {r.text}{' '}
                <span className="pv-muted">
                  · likelihood {r.l}, impact {r.i}
                </span>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Assumptions">
          <ul className="pv-rows pv-rows--tight">
            {[
              [
                'Most end customers open the link on a phone',
                'Check SMS click data after 2 weeks of pilot',
              ],
              ['Nordwind IT can set up track.nordwind.de by November', 'Ask in Q-19'],
            ].map(([a, v]) => (
              <li key={a} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">{a}</span>
                  <span className="pv-row-sub">Validate: {v}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Stories(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-personas">
        {[
          [
            'End customer',
            'Waits at home for a delivery; opens a link on a phone; wants to know when, not where the truck is.',
          ],
          [
            'Dispatcher',
            'Plans 30 tours a day; gets calls when customers do not know when the truck comes.',
          ],
          ['Customer service', 'Answers “where is my delivery”; wants fewer calls.'],
        ].map(([n, d]) => (
          <Card key={n}>
            <div className="pv-persona">
              <span className="pv-persona-icon">
                <PIcon name="user" />
              </span>
              <strong>{n}</strong>
            </div>
            <p className="pv-muted pv-small">{d}</p>
          </Card>
        ))}
      </div>
      <Card flush title="Stories">
        <ul className="pv-stories">
          {[
            {
              t: 'As an end customer I see the ETA window so that I can plan my day',
              g: [
                'Given a delivery is planned for today',
                'When I open the link',
                'Then I see a 30-minute window and the number of stops before mine',
              ],
              r: 'R-01, R-04',
            },
            {
              t: 'As an end customer I leave a delivery note so that the driver finds me',
              g: [
                'Given the truck is more than 2 stops away',
                'When I write a note and send it',
                'Then the driver sees it on the next stop list',
              ],
              r: 'R-07',
            },
          ].map((s) => (
            <li key={s.t}>
              <div className="pv-story-title">
                {s.t} <span className="pv-muted pv-small pv-mono">{s.r}</span>
              </div>
              <ul className="pv-gwt">
                {s.g.map((x) => (
                  <li key={x}>
                    <strong>{x.split(' ')[0]}</strong> {x.split(' ').slice(1).join(' ')}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Priority(): ReactNode {
  const [reach, setReach] = useState(4000);
  const [impact, setImpact] = useState(2);
  const [confidence, setConfidence] = useState(80);
  const [effort, setEffort] = useState(4);
  const score = Math.round((reach * impact * (confidence / 100)) / Math.max(effort, 0.5) / 10);
  const field = (
    label: string,
    value: number,
    set: (n: number) => void,
    hint: string,
    step = 1,
  ): ReactNode => (
    <label className="pv-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          set(Number(e.target.value));
        }}
      />
      <span className="pv-muted pv-small">{hint}</span>
    </label>
  );
  return (
    <div className="pv-split pv-split--even">
      <Card title="RICE score" action={<Chip tone="primary">RICE · ICE · WSJF · MoSCoW</Chip>}>
        <div className="pv-rice">
          {field('Reach', reach, setReach, 'people per quarter', 100)}
          {field('Impact', impact, setImpact, '0.25 minimal … 3 massive', 0.25)}
          {field('Confidence %', confidence, setConfidence, 'how sure the numbers are', 5)}
          {field('Effort', effort, setEffort, 'person-months', 0.5)}
        </div>
        <div className="pv-rice-score">
          <span className="pv-big pv-num">{score}</span>
          <span className="pv-muted">RICE · scored by Mara and Kai; spread 152–181</span>
        </div>
      </Card>
      <Card flush title="Ideas by score">
        <table className="pv-table">
          <tbody>
            {[...IDEAS]
              .sort((a, b) => b.rice - a.rice)
              .map((i) => (
                <tr key={i.id}>
                  <td className="pv-mono pv-cell-ref">{i.id}</td>
                  <td className="pv-cell-grow">{i.title}</td>
                  <td className="pv-cell-bar">
                    <Bar value={i.id === 'I-14' ? score : i.rice} max={200} />
                  </td>
                  <td className="pv-num">{i.id === 'I-14' ? score : i.rice}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
      <Card title="MoSCoW for the first release" className="pv-span-2">
        <div className="pv-moscow">
          {[
            [
              'Must',
              ['R-01 Tracking link', 'R-04 ETA window', 'R-12 Link expiry', 'R-13 First name only'],
            ],
            ['Should', ['R-07 Delivery note', 'R-15 Fast on 3G']],
            ['Could', ['Own domain track.nordwind.de', 'English and Polish']],
            ["Won't (this time)", ['Proof-of-delivery photos', 'Live truck position on the map']],
          ].map(([h, items]) => (
            <div key={String(h)} className="pv-moscow-col">
              <div className="pv-moscow-head">{h}</div>
              {(items as string[]).map((x) => (
                <div key={x} className="pv-moscow-item">
                  {x}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Prd(): ReactNode {
  const [diff, setDiff] = useState(true);
  const [signed, setSigned] = useState<string[]>(['mara']);
  return (
    <div className="pv-prd">
      <aside className="pv-stack">
        <Card flush title="Versions">
          <ul className="pv-rows">
            {PRD_VERSIONS.map((v) => (
              <li key={v.v} className="pv-row pv-row--static">
                <span className="pv-mono pv-strong">{v.v}</span>
                <span className="pv-row-main">
                  <span className="pv-row-title">{v.note}</span>
                  <span className="pv-row-sub">
                    {person(v.by).name} · {v.date}
                  </span>
                </span>
                <Chip tone={v.state === 'in review' ? 'warning' : 'neutral'}>{v.state}</Chip>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Sign-off">
          <ul className="pv-signers">
            {['mara', 'c-kai'].map((id) => (
              <li key={id}>
                <Avatar id={id} size="sm" />
                <span className="pv-row-main">
                  <strong>{person(id).name}</strong>
                  <span className="pv-muted pv-small">{person(id).title}</span>
                </span>
                {signed.includes(id) ? (
                  <Chip tone="success" icon="check">
                    Signed 09:40
                  </Chip>
                ) : (
                  <Button
                    size="sm"
                    kind="primary"
                    icon="signoff"
                    onClick={() => {
                      setSigned((s) => [...s, id]);
                    }}
                  >
                    Sign
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="pv-muted pv-small">
            Signing records name, time and a hash of v3. A later edit reopens the sign-off.
          </p>
        </Card>
      </aside>
      <Card
        title="PRD v3 · Customer self-service tracking"
        action={
          <div className="pv-page-actions">
            <label className="pv-switch">
              <input
                type="checkbox"
                checked={diff}
                onChange={(e) => {
                  setDiff(e.target.checked);
                }}
              />
              <span>Changes since v2</span>
            </label>
            <Button size="sm" kind="ghost" icon="external">
              Export
            </Button>
          </div>
        }
      >
        <article className="pv-doc">
          <h3>1. Problem</h3>
          <p>
            Nordwind’s customer service answers about 900 “where is my delivery” calls a week. End
            customers do not know when the truck arrives.<sup className="pv-sup">1</sup>
          </p>
          <h3>2. Goal</h3>
          <p>
            Halve these calls within three months of the pilot, measured by the call centre’s weekly
            report.
          </p>
          <h3>3. Requirements</h3>
          <ul>
            <li>
              R-01 A tracking link per delivery, sent by SMS and e-mail.
              <sup className="pv-sup">1</sup>
            </li>
            <li>R-04 ETA window of 30 minutes and stops before theirs.</li>
            <li className={diff ? 'pv-ins' : ''}>
              R-12 The link expires 24 h after delivery; then only “delivered” is shown.
              <sup className="pv-sup">3</sup>
            </li>
            <li className={diff ? 'pv-ins' : ''}>
              R-13 Only the driver’s first name; no photo.<sup className="pv-sup">2</sup>
            </li>
            <li className={diff ? 'pv-del' : 'pv-hidden'}>Proof-of-delivery photo on the page.</li>
          </ul>
          <h3>4. Out of scope</h3>
          <p>Live truck position on a map; proof-of-delivery photos (D-4).</p>
          <ol className="pv-footnotes">
            <li>Tracking requirements v2.pdf, p. 3</li>
            <li>Workshop 22 Sep – whiteboard.jpg</li>
            <li>Interview, Kai Lorenz, 4 Oct 09:05</li>
          </ol>
        </article>
      </Card>
    </div>
  );
}

function Decisions(): ReactNode {
  return (
    <div className="pv-split pv-split--even">
      <Card flush title="Decision log">
        <ul className="pv-rows">
          {DECISIONS.map((d) => (
            <li key={d.id} className="pv-row pv-row--static">
              <span className="pv-mono pv-muted">{d.id}</span>
              <span className="pv-row-main">
                <span className="pv-row-title">{d.text}</span>
                <span className="pv-row-sub">
                  {person(d.by).name} · {d.date} · {d.why}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card
        flush
        title="Glossary"
        action={
          <Chip tone="agent" icon="agents">
            Agents use it
          </Chip>
        }
      >
        <table className="pv-table">
          <tbody>
            {GLOSSARY.map(([t, d]) => (
              <tr key={t}>
                <td className="pv-cell-strong">{t}</td>
                <td className="pv-cell-grow pv-muted">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function IdeationTab(props: { pkey: string }): ReactNode {
  const [selected, setSelected] = useState('I-14');
  const [sub, setSub] = useState('interview');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const idea = IDEAS.find((i) => i.id === selected) ?? IDEAS[0];
  if (!idea) return null;
  const list = IDEAS.filter(
    (i) => filter === 'all' || (i.state !== 'approved' && i.state !== 'rejected'),
  );
  const body: Record<string, ReactNode> = {
    interview: <Interview pkey={props.pkey} />,
    sources: <Sources />,
    requirements: <Requirements />,
    questions: <Questions />,
    risks: <Risks />,
    stories: <Stories />,
    priority: <Priority />,
    prd: <Prd />,
    decisions: <Decisions />,
  };
  return (
    <div className="pv-workspace">
      <aside className="pv-list-pane" aria-label="Ideas">
        <div className="pv-list-pane-head">
          <strong>Ideas</strong>
          <Button size="sm" kind="primary" icon="plus">
            New
          </Button>
        </div>
        <div className="pv-segmented pv-segmented--full" role="radiogroup" aria-label="Show">
          <button
            type="button"
            role="radio"
            aria-checked={filter === 'open'}
            className="pv-seg"
            onClick={() => {
              setFilter('open');
            }}
          >
            Open
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filter === 'all'}
            className="pv-seg"
            onClick={() => {
              setFilter('all');
            }}
          >
            All, with rejected
          </button>
        </div>
        <ul className="pv-idea-list">
          {list.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className="pv-idea"
                aria-current={i.id === idea.id ? 'true' : undefined}
                onClick={() => {
                  setSelected(i.id);
                }}
              >
                <span className="pv-idea-top">
                  <span className="pv-mono pv-muted">{i.id}</span>
                  <Chip tone={STATE_TONE[i.state]}>{i.state}</Chip>
                </span>
                <span className="pv-idea-title">{i.title}</span>
                <span className="pv-idea-meta">
                  <Avatar id={i.from} size="xs" />
                  <span>RICE {i.rice || '—'}</span>
                  <span>·</span>
                  <span>{i.coverage} % covered</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="pv-detail-pane">
        <header className="pv-idea-head">
          <div>
            <div className="pv-idea-head-top">
              <span className="pv-mono pv-muted">{idea.id}</span>
              <Chip tone={STATE_TONE[idea.state]}>{idea.state}</Chip>
              <span className="pv-muted pv-small">
                from {person(idea.from).name} · {idea.sources} sources · updated {idea.updated}
              </span>
            </div>
            <h2 className="pv-idea-h">{idea.title}</h2>
          </div>
          <div className="pv-page-actions">
            <Button icon="ide" title="pe idea I-14 opens the same interview in the terminal">
              Continue in VS Code
            </Button>
            <Button kind="primary" icon="signoff">
              Send for sign-off
            </Button>
            <Button
              kind="ghost"
              icon="arrowRight"
              title="Turns the approved PRD into an epic and stories in Planning"
            >
              Promote to planning
            </Button>
          </div>
        </header>
        <nav className="pv-subtabs" aria-label="Idea">
          {SUBTABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="pv-subtab"
              aria-pressed={sub === t.key}
              onClick={() => {
                setSub(t.key);
              }}
            >
              <PIcon name={t.icon} size={14} />
              {t.label}
              {t.count ? <span className="pv-subtab-count">{t.count}</span> : null}
            </button>
          ))}
        </nav>
        {body[sub]}
        <p className="pv-footer-hint">
          Everything here is also in VS Code and in the client portal for Nordwind.
        </p>
      </section>
    </div>
  );
}
