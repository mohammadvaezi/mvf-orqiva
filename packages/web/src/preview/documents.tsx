// ── [PCODE-155 | S15 | v0.1.0] D3 preview: Documents, UI kit and Test ──
//    Why:  the Documents tab: the project's wiki, files and artifacts, and the knowledge its agents may
//          use. Pages have an owner and a review date, so stale pages show; agents read only the folders
//          they are allowed, every read is logged and every answer cites its passage; pages built from the
//          code stay in sync, and a page that disagrees with the code says so.
import { useState, type ReactNode } from 'react';
import { TASKS } from './data2.js';
import {
  AGENT_ACCESS,
  DOC_COMMENTS,
  DOC_VERSIONS,
  DOCS,
  READ_LOG,
  TEMPLATES,
  type DocNode,
} from './data3.js';
import { person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Button, Card, Chip, Stat } from './ui.js';

const STATUS_TONE: Record<
  NonNullable<DocNode['status']>,
  'neutral' | 'success' | 'primary' | 'warning'
> = {
  draft: 'neutral',
  approved: 'primary',
  verified: 'success',
  stale: 'warning',
};

function Tree(props: {
  selected: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}): ReactNode {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<string[]>([]);
  const folders = DOCS.filter((d) => d.kind === 'folder');
  const match = (d: DocNode): boolean => !q || d.title.toLowerCase().includes(q.toLowerCase());
  return (
    <aside className="pv-doc-tree" aria-label="Pages and files">
      <div className="pv-list-pane-head">
        <strong>Wiki and files</strong>
        <Button size="sm" kind="primary" icon="plus" onClick={props.onNew}>
          New
        </Button>
      </div>
      <label className="pv-tree-search">
        <PIcon name="search" size={14} />
        <input
          value={q}
          placeholder="Search pages, files, text in images"
          aria-label="Search documents"
          onChange={(e) => {
            setQ(e.target.value);
          }}
        />
      </label>
      <ul className="pv-tree">
        {folders.map((f) => {
          const kids = DOCS.filter((d) => d.parent === f.id && match(d));
          if (q && !kids.length) return null;
          const open = !closed.includes(f.id) || Boolean(q);
          return (
            <li key={f.id}>
              <button
                type="button"
                className="pv-tree-folder"
                aria-expanded={open}
                onClick={() => {
                  setClosed((c) => (c.includes(f.id) ? c.filter((x) => x !== f.id) : [...c, f.id]));
                }}
              >
                <PIcon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
                <PIcon name="projects" size={14} />
                <span>{f.title}</span>
                <span className="pv-muted pv-small">{kids.length}</span>
              </button>
              {open ? (
                <ul>
                  {kids.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="pv-tree-item"
                        aria-current={props.selected === d.id ? 'true' : undefined}
                        onClick={() => {
                          props.onSelect(d.id);
                        }}
                      >
                        <PIcon name={d.kind === 'file' ? 'external' : 'documents'} size={14} />
                        <span className="pv-tree-title">{d.title}</span>
                        {d.status === 'stale' ? (
                          <span className="pv-dot pv-dot--at-risk" title="Review overdue" />
                        ) : null}
                        {d.generated ? (
                          <span title="Built from the code">
                            <PIcon name="ide" size={12} />
                          </span>
                        ) : null}
                        {d.shared ? (
                          <span title="Shared with the client">
                            <PIcon name="clients" size={12} />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function Diagram(): ReactNode {
  const box = (
    x: number,
    y: number,
    w: number,
    label: string,
    sub: string,
    cls = '',
  ): ReactNode => (
    <g>
      <rect className={'pv-diag-box ' + cls} x={x} y={y} width={w} height="48" rx="8" />
      <text className="pv-diag-text" x={x + w / 2} y={y + 21} textAnchor="middle">
        {label}
      </text>
      <text className="pv-diag-sub" x={x + w / 2} y={y + 37} textAnchor="middle">
        {sub}
      </text>
    </g>
  );
  return (
    <svg
      className="pv-diagram"
      viewBox="0 0 720 200"
      role="img"
      aria-label="Live routing: web, gateway, routing service, map provider, driver app"
    >
      <defs>
        <marker
          id="pv-diag-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 8 4 0 8z" className="pv-dep-head" />
        </marker>
      </defs>
      {box(10, 20, 150, 'Dispatcher web', 'drags a stop')}
      {box(250, 20, 170, 'WebSocket gateway', 'pv events, 15 s heartbeat', 'pv-diag-box--focus')}
      {box(520, 20, 180, 'Routing service', 'recalculates ETAs')}
      {box(520, 130, 180, 'Map provider', '600 requests/min limit', 'pv-diag-box--ext')}
      {box(250, 130, 170, 'Driver app', 'gets the new route')}
      <path className="pv-dep" d="M160 44 H248" markerEnd="url(#pv-diag-arrow)" />
      <path className="pv-dep" d="M420 44 H518" markerEnd="url(#pv-diag-arrow)" />
      <path className="pv-dep" d="M610 68 V128" markerEnd="url(#pv-diag-arrow)" />
      <path
        className="pv-dep"
        d="M520 52 C 470 90, 420 100, 336 128"
        markerEnd="url(#pv-diag-arrow)"
      />
    </svg>
  );
}

function Adr(props: { editing: boolean }): ReactNode {
  const live = TASKS.filter((t) => t.epic === 'E1' && t.state !== 'Backlog');
  return (
    <article
      className={'pv-doc pv-doc--page' + (props.editing ? ' pv-doc--editing' : '')}
      contentEditable={props.editing}
      suppressContentEditableWarning
    >
      <div className="pv-callout pv-callout--decision">
        <PIcon name="flag" size={16} />
        <div>
          <strong>Decision.</strong> Dispatch changes reach drivers over one WebSocket per device,
          with the server as the only writer. Polling is not used.
        </div>
      </div>
      <h3>1. Context</h3>
      <p>
        Dispatchers re-route tours live (NWL-188). Drivers must see a new route within 10 seconds.
        The map provider allows 600 routing requests per minute for the pilot.
      </p>
      <h3>2. Design</h3>
      <Diagram />
      <p>
        The gateway sends a heartbeat <mark className="pv-anchor">every 15 seconds</mark>. Each
        event carries the tour version, so a driver app that missed one asks for the gap.
      </p>
      <h3>3. Reconnects</h3>
      <p>
        A dropped connection reconnects with <mark className="pv-anchor">exponential backoff</mark>{' '}
        from 1 to 30 seconds and replays what it missed.
      </p>
      <table className="pv-table pv-table--compact pv-doc-table">
        <caption>
          Events{' '}
          <Chip tone="success" icon="ide">
            synced from src/live/events.ts 5 min ago
          </Chip>
        </caption>
        <thead>
          <tr>
            <th>Event</th>
            <th>Sent when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="pv-mono">tour.rerouted</td>
            <td>A dispatcher changes the order of stops</td>
          </tr>
          <tr>
            <td className="pv-mono">tour.eta_changed</td>
            <td>Any ETA moves by more than 2 minutes</td>
          </tr>
          <tr>
            <td className="pv-mono">driver.ack</td>
            <td>The driver app has the new route</td>
          </tr>
        </tbody>
      </table>
      <pre className="pv-code">
        {"socket.send({ type: 'tour.rerouted', tour: 'T-4411', version: 18 })"}
      </pre>
      <h3>4. Work items</h3>
      <div className="pv-embed">
        <div className="pv-embed-head">
          <PIcon name="planning" size={14} /> Live list: epic Live dispatching{' '}
          <span className="pv-muted pv-small">· updates as tasks move</span>
        </div>
        <ul className="pv-rows pv-rows--tight">
          {live.map((t) => (
            <li key={t.n} className="pv-row pv-row--static">
              <span className="pv-mono pv-muted">NWL-{t.n}</span>
              <span className="pv-row-main">
                <span className="pv-row-title">{t.title}</span>
              </span>
              <Chip
                tone={t.state === 'Done' ? 'success' : t.state === 'Review' ? 'info' : 'primary'}
              >
                {t.state}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
      <h3>5. Consequences</h3>
      <p>
        One more long-lived connection per device; the gateway must scale to 400 events per second
        (NWL-195).
      </p>
    </article>
  );
}

function Generic(props: { d: DocNode }): ReactNode {
  const d = props.d;
  if (d.kind === 'file')
    return (
      <div className="pv-file-preview">
        <PIcon name="documents" size={40} />
        <div>
          <strong>{d.title}</strong>
          <p className="pv-muted">
            Preview, search inside the file (OCR for images), and the statements the Analyst took
            from it.
          </p>
          <div className="pv-page-actions">
            <Button icon="external">Open</Button>
            <Button kind="ghost">Download</Button>
          </div>
        </div>
      </div>
    );
  return (
    <article className="pv-doc pv-doc--page">
      {d.status === 'stale' ? (
        <div className="pv-callout pv-callout--warn">
          <PIcon name="clock" size={16} />
          <div>
            <strong>Not reviewed for 94 days.</strong> {person(d.owner ?? '').name} is asked to
            confirm it, change it or archive it.
          </div>
        </div>
      ) : null}
      {d.generated ? (
        <div className="pv-callout">
          <PIcon name="ide" size={16} />
          <div>
            Built from the code (OpenAPI and doc comments). Edits here become a pull request.
          </div>
        </div>
      ) : null}
      {d.agent ? (
        <div className="pv-callout pv-callout--agent">
          <PIcon name="agents" size={16} />
          <div>Written by an agent. It counts as a draft until a person approves it.</div>
        </div>
      ) : null}
      <h3>Summary</h3>
      <p>
        This page belongs to the Fleet portal wiki. Every page has an owner, a status and a review
        date, and links back to the tasks and code it describes.
      </p>
    </article>
  );
}

function SidePanel(props: { doc: DocNode }): ReactNode {
  const [tab, setTab] = useState<'comments' | 'history' | 'links' | 'ai'>('comments');
  const [cmp, setCmp] = useState(false);
  const folder = props.doc.parent ?? '';
  const tabs: { key: typeof tab; label: string; icon: PIconName }[] = [
    { key: 'comments', label: 'Comments', icon: 'request' },
    { key: 'history', label: 'History', icon: 'clock' },
    { key: 'links', label: 'Links', icon: 'external' },
    { key: 'ai', label: 'AI', icon: 'agents' },
  ];
  return (
    <aside className="pv-doc-side" aria-label="Page details">
      <div className="pv-side-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className="pv-side-tab"
            onClick={() => {
              setTab(t.key);
            }}
          >
            <PIcon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'comments' ? (
        <ul className="pv-threads">
          {DOC_COMMENTS.map((c) => (
            <li key={c.text} className={'pv-thread' + (c.resolved ? ' pv-thread--resolved' : '')}>
              <blockquote className="pv-thread-quote">“{c.quote}”</blockquote>
              <div className="pv-thread-head">
                <Avatar id={c.who} size="xs" />
                <strong>{person(c.who).name}</strong>
                {c.resolved ? <Chip tone="success">resolved</Chip> : null}
              </div>
              <p>{c.text}</p>
              <span className="pv-muted pv-small">
                {c.replies ? String(c.replies) + ' reply' : 'Reply · Resolve · Make a task'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {tab === 'history' ? (
        <div className="pv-stack">
          <ul className="pv-rows pv-rows--tight">
            {DOC_VERSIONS.map((v) => (
              <li key={v.v} className="pv-row pv-row--static">
                <span className="pv-mono pv-strong">{v.v}</span>
                <span className="pv-row-main">
                  <span className="pv-row-title pv-wrap">{v.note}</span>
                  <span className="pv-row-sub">
                    {person(v.who).name} · {v.when}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            onClick={() => {
              setCmp((c) => !c);
            }}
          >
            {cmp ? 'Hide changes' : 'Compare v3 → v4'}
          </Button>
          {cmp ? (
            <div className="pv-diff">
              <div className="pv-del">A dropped connection reconnects after 2 seconds.</div>
              <div className="pv-ins">
                A dropped connection reconnects with exponential backoff from 1 to 30 seconds and
                replays what it missed.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === 'links' ? (
        <div className="pv-kv">
          <span>Linked tasks</span>
          <span>NWL-188, NWL-195</span>
          <span>Backlinks</span>
          <span>System overview, Runbook: map provider outage</span>
          <span>Code</span>
          <span>src/live/socket.ts, src/live/events.ts</span>
          <span>Link check</span>
          <span className="pv-text-success">All 6 links work</span>
        </div>
      ) : null}
      {tab === 'ai' ? (
        <div className="pv-stack">
          <p className="pv-muted pv-small">
            Agents that may read this page (from the folder’s setting):
          </p>
          <ul className="pv-rows pv-rows--tight">
            {AGENT_ACCESS.map((a) => (
              <li key={a.agent} className="pv-row pv-row--static">
                <Avatar id={a.agent} size="xs" />
                <span className="pv-row-main">
                  <span className="pv-row-title">{person(a.agent).name}</span>
                </span>
                {a.scope[folder] ? <Chip tone="success">may read</Chip> : <Chip>no access</Chip>}
              </li>
            ))}
          </ul>
          <p className="pv-muted pv-small">
            Read 14 times this week, cited 9 times. Last: Coder for NWL-188, §3 Reconnects.
          </p>
        </div>
      ) : null}
    </aside>
  );
}

function Templates(props: { onClose: () => void }): ReactNode {
  return (
    <div className="pv-scrim" role="presentation" onClick={props.onClose}>
      <div
        className="pv-modal"
        role="dialog"
        aria-modal="true"
        aria-label="New page from a template"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <header className="pv-modal-head">
          <strong>New page</strong>
          <button type="button" className="pv-icon-btn" aria-label="Close" onClick={props.onClose}>
            <PIcon name="x" />
          </button>
        </header>
        <div className="pv-template-grid">
          <button type="button" className="pv-template" onClick={props.onClose}>
            <PIcon name="documents" size={22} />
            <strong>Blank page</strong>
            <span className="pv-muted pv-small">Start writing</span>
          </button>
          {TEMPLATES.map((t) => (
            <button key={t.name} type="button" className="pv-template" onClick={props.onClose}>
              <PIcon name={t.icon} size={22} />
              <strong>{t.name}</strong>
              <span className="pv-muted pv-small">{t.hint}</span>
            </button>
          ))}
          <button type="button" className="pv-template" onClick={props.onClose}>
            <PIcon name="sparkle" size={22} />
            <strong>Draft with AI</strong>
            <span className="pv-muted pv-small">From tasks, commits or a meeting recording</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Pages(): ReactNode {
  const [selected, setSelected] = useState('p-adr7');
  const [editing, setEditing] = useState(false);
  const [templates, setTemplates] = useState(false);
  const doc = DOCS.find((d) => d.id === selected) ?? DOCS[0];
  if (!doc) return null;
  const folder = DOCS.find((d) => d.id === doc.parent);
  return (
    <div className="pv-docs">
      <Tree
        selected={selected}
        onSelect={setSelected}
        onNew={() => {
          setTemplates(true);
        }}
      />
      <section className="pv-doc-main">
        <div className="pv-doc-crumbs pv-muted pv-small">
          {folder?.title} / {doc.title}
        </div>
        <header className="pv-doc-head">
          <h2 className="pv-doc-title">{doc.title}</h2>
          <div className="pv-page-actions">
            {doc.kind === 'page' ? (
              <Button
                kind={editing ? 'primary' : 'secondary'}
                icon={editing ? 'check' : 'signoff'}
                onClick={() => {
                  setEditing((e) => !e);
                }}
              >
                {editing ? 'Done' : 'Edit'}
              </Button>
            ) : null}
            <Button kind="ghost" icon="sparkle">
              Ask about this page
            </Button>
            <Button kind="ghost" icon="external">
              Share
            </Button>
          </div>
        </header>
        <div className="pv-doc-props">
          {doc.status ? <Chip tone={STATUS_TONE[doc.status]}>{doc.status}</Chip> : null}
          {doc.owner ? (
            <span className="pv-who pv-small">
              <Avatar id={doc.owner} size="xs" /> Owner {person(doc.owner).name}
            </span>
          ) : null}
          <span className="pv-muted pv-small">Review by 24 Dec</span>
          {doc.shared ? <Chip icon="clients">shared with Nordwind</Chip> : null}
          <span className="pv-spacer" />
          <span className="pv-who pv-small pv-muted">
            <Avatar id="tim" size="xs" /> Tim is reading
          </span>
        </div>
        {editing ? (
          <div className="pv-editor-bar" role="toolbar" aria-label="Insert">
            {[
              'Heading',
              'Table',
              'Code',
              'Diagram',
              'Callout',
              'Task list',
              'Embed design',
              'Image',
            ].map((b) => (
              <button key={b} type="button" className="pv-editor-btn">
                {b}
              </button>
            ))}
            <span className="pv-spacer" />
            <span className="pv-muted pv-small">Lea and Tim editing · saved</span>
          </div>
        ) : null}
        {doc.id === 'p-adr7' ? <Adr editing={editing} /> : <Generic d={doc} />}
      </section>
      <SidePanel doc={doc} />
      {templates ? (
        <Templates
          onClose={() => {
            setTemplates(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Knowledge(): ReactNode {
  const folders = DOCS.filter((d) => d.kind === 'folder');
  const [access, setAccess] = useState(AGENT_ACCESS);
  const [asked, setAsked] = useState(false);
  return (
    <div className="pv-stack">
      <Card
        flush
        title="What each agent may read"
        action={<span className="pv-muted pv-small">Changes apply to the next run</span>}
      >
        <div className="pv-grid-scroll">
          <table className="pv-table pv-access">
            <thead>
              <tr>
                <th>Agent</th>
                {folders.map((f) => (
                  <th key={f.id}>{f.title}</th>
                ))}
                <th className="pv-num">Reads this week</th>
              </tr>
            </thead>
            <tbody>
              {access.map((a, i) => (
                <tr key={a.agent}>
                  <td>
                    <span className="pv-who">
                      <Avatar id={a.agent} size="xs" />
                      {person(a.agent).name}
                    </span>
                  </td>
                  {folders.map((f) => (
                    <td key={f.id} className="pv-access-cell">
                      <input
                        type="checkbox"
                        aria-label={person(a.agent).name + ' may read ' + f.title}
                        checked={a.scope[f.id] ?? false}
                        onChange={(e) => {
                          setAccess((all) =>
                            all.map((x, j) =>
                              j === i
                                ? { ...x, scope: { ...x.scope, [f.id]: e.target.checked } }
                                : x,
                            ),
                          );
                        }}
                      />
                    </td>
                  ))}
                  <td className="pv-num">{a.reads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="pv-split pv-split--even">
        <Card flush title="Read log">
          <ul className="pv-rows">
            {READ_LOG.map((r) => (
              <li key={r.page + r.at} className="pv-row pv-row--static">
                <Avatar id={r.agent} size="sm" />
                <span className="pv-row-main">
                  <span className="pv-row-title">{r.page}</span>
                  <span className="pv-row-sub">
                    {r.why} · cited {r.cited}
                  </span>
                </span>
                <span className="pv-muted pv-small">{r.at}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Test what an agent would answer">
          <div className="pv-ask">
            <input
              defaultValue="How often does the gateway send a heartbeat?"
              aria-label="Question"
            />
            <Button
              kind="primary"
              icon="sparkle"
              onClick={() => {
                setAsked(true);
              }}
            >
              Ask as Coder
            </Button>
          </div>
          {asked ? (
            <div className="pv-answer">
              <p>
                Every 15 seconds.<sup className="pv-sup">1</sup> Note: the code reconnects after a
                fixed 2 seconds, while the ADR says exponential backoff.
                <sup className="pv-sup">2</sup>
              </p>
              <ol className="pv-footnotes">
                <li>ADR-007 Live routing via WebSocket, §2 Design</li>
                <li>Comment by Reviewer on ADR-007, linked to src/live/socket.ts:88</li>
              </ol>
            </div>
          ) : (
            <p className="pv-muted pv-small">
              Answers use only the pages the agent may read, and cite them.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Health(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat label="Pages" value="14" sub="3 built from code" icon="documents" />
        <Stat
          label="Review overdue"
          value="1"
          sub="Rollback a deploy"
          tone="warning"
          icon="clock"
        />
        <Stat
          label="Disagrees with code"
          value="1"
          sub="ADR-007 reconnects"
          tone="danger"
          icon="ide"
        />
        <Stat label="Never read" value="3" sub="in the last 90 days" icon="review" />
      </div>
      <Card flush title="Needs attention">
        <ul className="pv-rows">
          {[
            {
              icon: 'clock' as const,
              t: 'Runbook “Rollback a deploy” not reviewed for 94 days',
              s: 'Owner Ole Petersen · last deploy flow changed in 1.3.9',
              a: 'Ask Ole',
            },
            {
              icon: 'ide' as const,
              t: 'ADR-007 says exponential backoff; the code waits a fixed 2 s',
              s: 'Found by Reviewer while reviewing #318',
              a: 'Make a task',
            },
            {
              icon: 'external' as const,
              t: '2 broken links in “System overview”',
              s: 'Old staging URL, removed Figma frame',
              a: 'Fix links',
            },
            {
              icon: 'agents' as const,
              t: 'Sprint 14 review notes written by Analyst, not approved yet',
              s: 'Shared with Nordwind once approved',
              a: 'Review',
            },
          ].map((r) => (
            <li key={r.t} className="pv-row pv-row--static">
              <span className="pv-kind pv-kind--request">
                <PIcon name={r.icon} size={15} />
              </span>
              <span className="pv-row-main">
                <span className="pv-row-title">{r.t}</span>
                <span className="pv-row-sub">{r.s}</span>
              </span>
              <Button size="sm">{r.a}</Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'pages', label: 'Pages and files', icon: 'documents' },
  { key: 'knowledge', label: 'AI knowledge', icon: 'agents' },
  { key: 'health', label: 'Health', icon: 'check' },
];

export function DocumentsTab(): ReactNode {
  const [view, setView] = useState('pages');
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="Documents view">
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
      {view === 'pages' ? <Pages /> : null}
      {view === 'knowledge' ? <Knowledge /> : null}
      {view === 'health' ? <Health /> : null}
    </div>
  );
}
