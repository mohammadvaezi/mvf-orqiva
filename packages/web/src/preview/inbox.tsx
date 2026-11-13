// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
//    Why:  one place for everything that waits for a person: an agent asking for approval, a review, a
//          mention, an agent's question, a sign-off, a client request, tests to run, an incident. Each kind
//          has its own actions right in the reading pane, so most items are handled without leaving the
//          inbox. Keyboard: j and k move, e marks done, s snoozes. The same inbox is in VS Code.
import { useEffect, useState, type ReactNode } from 'react';
import { euro, person, project, type InboxItem, type InboxKind } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Button, Chip, Kbd, PageHead } from './ui.js';

export const KIND: Record<InboxKind, { label: string; icon: PIconName }> = {
  approval: { label: 'Approvals', icon: 'approval' },
  review: { label: 'Reviews', icon: 'review' },
  mention: { label: 'Mentions', icon: 'mention' },
  question: { label: 'Questions', icon: 'question' },
  signoff: { label: 'Sign-offs', icon: 'signoff' },
  request: { label: 'Client requests', icon: 'request' },
  test: { label: 'Tests', icon: 'test' },
  incident: { label: 'Incidents', icon: 'incident' },
};

function Actions(props: { item: InboxItem; onDone: () => void; onSnooze: () => void }): ReactNode {
  const i = props.item;
  const main: Record<InboxKind, ReactNode> = {
    approval: (
      <>
        <Button kind="primary" icon="check" onClick={props.onDone}>
          Approve
        </Button>
        <Button icon="x" onClick={props.onDone}>
          Decline
        </Button>
        <Button kind="ghost" icon="agents">
          Open the run
        </Button>
      </>
    ),
    review: (
      <>
        <Button kind="primary" icon="review">
          Start review
        </Button>
        <Button kind="ghost" icon="ide">
          Open in VS Code
        </Button>
      </>
    ),
    mention: (
      <>
        <Button kind="primary" icon="request">
          Reply
        </Button>
        <Button kind="ghost">Open task</Button>
      </>
    ),
    question: (
      <>
        <Button kind="primary" icon="request">
          Answer
        </Button>
        <Button>Ask someone else</Button>
      </>
    ),
    signoff: (
      <>
        <Button kind="primary" icon="signoff" onClick={props.onDone}>
          Review and sign
        </Button>
        <Button kind="ghost">Accept line by line</Button>
      </>
    ),
    request: (
      <>
        <Button kind="primary" icon="euro">
          Send quote
        </Button>
        <Button>Ask the client</Button>
        <Button kind="ghost">Plan it</Button>
      </>
    ),
    test: (
      <>
        <Button kind="primary" icon="play">
          Start run
        </Button>
        <Button kind="ghost">Reassign</Button>
      </>
    ),
    incident: (
      <>
        <Button kind="primary" icon="documents">
          Review postmortem
        </Button>
        <Button kind="ghost">Open timeline</Button>
      </>
    ),
  };
  return (
    <div className="pv-reader-actions">
      {main[i.kind]}
      <span className="pv-spacer" />
      <Button
        kind="ghost"
        icon="snooze"
        onClick={props.onSnooze}
        title="Snooze until tomorrow 9:00 (s)"
      >
        Snooze
      </Button>
      <Button kind="ghost" icon="check" onClick={props.onDone} title="Done (e)">
        Done
      </Button>
    </div>
  );
}

function Context(props: { item: InboxItem }): ReactNode {
  const i = props.item;
  if (i.kind === 'approval')
    return (
      <div className="pv-reader-box">
        <div className="pv-reader-box-title">What the agent wants to run</div>
        <pre className="pv-code">npm run migrate -- --env staging --to 0042_booking_slots</pre>
        <div className="pv-kv">
          <span>Policy</span>
          <span>Shell on staging needs a lead’s approval</span>
          <span>Run so far</span>
          <span>9 of 12 steps · 41 k tokens · {euro(2.31, 2)}</span>
          <span>If declined</span>
          <span>The agent stops and leaves a note on HEL-212</span>
        </div>
      </div>
    );
  if (i.kind === 'review')
    return (
      <div className="pv-reader-box">
        <div className="pv-reader-box-title">Change at a glance</div>
        <div className="pv-kv">
          <span>Size</span>
          <span>+412 −96 · 14 files · medium risk (touches a public API)</span>
          <span>Checks</span>
          <span>Build, 418 tests, security scan: all passed</span>
          <span>AI review</span>
          <span>2 comments: missing timeout on the routing call; unused import</span>
          <span>Fingerprints</span>
          <span>All 9 blocks carry NWL-188</span>
        </div>
      </div>
    );
  if (i.kind === 'signoff' && i.project === 'AUR')
    return (
      <div className="pv-reader-box">
        <div className="pv-reader-box-title">Draft plan</div>
        <table className="pv-table pv-table--compact">
          <tbody>
            {[
              ['AUR-1', 'Account model and IBAN validation', 3],
              ['AUR-2', 'SEPA instant: submit transfer', 5],
              ['AUR-3', 'SEPA instant: status webhooks', 5],
              ['AUR-4', 'Idempotency keys', 5],
              ['AUR-5', 'Audit log for PSD2 evidence', 3],
            ].map(([r, t, p]) => (
              <tr key={String(r)}>
                <td className="pv-mono pv-cell-ref">{r}</td>
                <td className="pv-cell-grow">{t}</td>
                <td className="pv-num pv-muted">{p} pt</td>
              </tr>
            ))}
            <tr>
              <td />
              <td className="pv-muted">and 9 more · 3 without an estimate</td>
              <td className="pv-num pv-muted">29 pt</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  if (i.kind === 'request')
    return (
      <div className="pv-reader-box">
        <div className="pv-reader-box-title">Impact, estimated by Analyst</div>
        <div className="pv-kv">
          <span>Effort</span>
          <span>8 points (confidence 70 %, based on HEL-140 and NWL-77)</span>
          <span>Price</span>
          <span>{euro(3400)} at the agreed rate</span>
          <span>Schedule</span>
          <span>Release moves from 17 to 21 October</span>
          <span>SLA</span>
          <span>Answer due today 16:00</span>
        </div>
      </div>
    );
  return null;
}

export function InboxPage(props: {
  items: InboxItem[];
  done: Set<string>;
  snoozed: Set<string>;
  selected: string | null;
  onSelect: (id: string) => void;
  onDone: (id: string) => void;
  onSnooze: (id: string) => void;
  onUndo: () => void;
}): ReactNode {
  const [filter, setFilter] = useState<InboxKind | 'all' | 'snoozed' | 'done'>('all');
  const [project_, setProject] = useState<string>('all');
  const open = props.items.filter((i) => !props.done.has(i.id) && !props.snoozed.has(i.id));
  const list = (
    filter === 'done'
      ? props.items.filter((i) => props.done.has(i.id))
      : filter === 'snoozed'
        ? props.items.filter((i) => props.snoozed.has(i.id))
        : open.filter((i) => filter === 'all' || i.kind === filter)
  ).filter((i) => project_ === 'all' || i.project === project_);
  const current = list.find((i) => i.id === props.selected) ?? list[0];
  const projects = [...new Set(props.items.map((i) => i.project))];

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const at = current ? list.indexOf(current) : -1;
      if (e.key === 'j' && list[at + 1]) props.onSelect(list[at + 1]?.id ?? '');
      else if (e.key === 'k' && at > 0) props.onSelect(list[at - 1]?.id ?? '');
      else if (e.key === 'e' && current) props.onDone(current.id);
      else if (e.key === 's' && current) props.onSnooze(current.id);
      else if (e.key === 'z') props.onUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  const count = (k: InboxKind): number => open.filter((i) => i.kind === k).length;
  return (
    <div className="pv-page pv-page--full">
      <PageHead
        title="Inbox"
        sub={
          String(open.length) + ' open · ' + String(open.filter((i) => i.unread).length) + ' unread'
        }
        icon="inbox"
        actions={
          <>
            <span className="pv-hint">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd> move <Kbd>e</Kbd> done <Kbd>s</Kbd> snooze <Kbd>z</Kbd> undo
            </span>
            <Button kind="ghost" icon="check">
              Mark all read
            </Button>
          </>
        }
      />
      <div className="pv-inbox">
        <aside className="pv-inbox-filters" aria-label="Filters">
          <button
            type="button"
            className="pv-filter"
            aria-pressed={filter === 'all'}
            onClick={() => {
              setFilter('all');
            }}
          >
            <PIcon name="inbox" size={16} />
            <span>All</span>
            <span className="pv-filter-count">{open.length}</span>
          </button>
          {(Object.keys(KIND) as InboxKind[]).map((k) =>
            count(k) || filter === k ? (
              <button
                key={k}
                type="button"
                className="pv-filter"
                aria-pressed={filter === k}
                onClick={() => {
                  setFilter(k);
                }}
              >
                <PIcon name={KIND[k].icon} size={16} />
                <span>{KIND[k].label}</span>
                <span className="pv-filter-count">{count(k)}</span>
              </button>
            ) : null,
          )}
          <div className="pv-filter-sep" />
          <button
            type="button"
            className="pv-filter"
            aria-pressed={filter === 'snoozed'}
            onClick={() => {
              setFilter('snoozed');
            }}
          >
            <PIcon name="snooze" size={16} />
            <span>Snoozed</span>
            <span className="pv-filter-count">{props.snoozed.size}</span>
          </button>
          <button
            type="button"
            className="pv-filter"
            aria-pressed={filter === 'done'}
            onClick={() => {
              setFilter('done');
            }}
          >
            <PIcon name="check" size={16} />
            <span>Done</span>
            <span className="pv-filter-count">{props.done.size}</span>
          </button>
          <div className="pv-filter-sep" />
          <label className="pv-filter-select">
            <span>Project</span>
            <select
              value={project_}
              onChange={(e) => {
                setProject(e.target.value);
              }}
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p} · {project(p)?.name}
                </option>
              ))}
            </select>
          </label>
        </aside>
        <ul className="pv-inbox-list" aria-label="Items">
          {list.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className={'pv-inbox-item' + (i.unread ? ' pv-inbox-item--unread' : '')}
                aria-current={current?.id === i.id ? 'true' : undefined}
                onClick={() => {
                  props.onSelect(i.id);
                }}
              >
                <span className={'pv-kind pv-kind--' + i.kind}>
                  <PIcon name={KIND[i.kind].icon} size={15} />
                </span>
                <span className="pv-inbox-main">
                  <span className="pv-inbox-top">
                    <span className="pv-mono pv-inbox-project">{i.project}</span>
                    <span className="pv-inbox-from">{person(i.from).name}</span>
                    <span className="pv-inbox-age">{i.age}</span>
                  </span>
                  <span className="pv-inbox-title">{i.title}</span>
                </span>
                {i.priority === 'urgent' ? <span className="pv-urgent" title="Urgent" /> : null}
              </button>
            </li>
          ))}
          {!list.length ? (
            <li className="pv-empty">
              <PIcon name="check" size={28} />
              <strong>Nothing here.</strong>
              <span>Everything that needs you lands in this inbox, here and in VS Code.</span>
            </li>
          ) : null}
        </ul>
        <article className="pv-reader" aria-label="Item">
          {current ? (
            <>
              <div className="pv-reader-head">
                <Chip icon={KIND[current.kind].icon}>
                  {KIND[current.kind].label.replace(/s$/, '')}
                </Chip>
                <Chip mono>{current.project}</Chip>
                {current.ref ? <Chip mono>{current.ref}</Chip> : null}
                {current.priority !== 'normal' ? (
                  <Chip tone={current.priority === 'urgent' ? 'danger' : 'warning'}>
                    {current.priority === 'urgent' ? 'Urgent' : 'High'}
                  </Chip>
                ) : null}
                {current.due ? <Chip tone="warning">Due {current.due}</Chip> : null}
              </div>
              <h2 className="pv-reader-title">{current.title}</h2>
              <div className="pv-reader-from">
                <Avatar id={current.from} size="sm" />
                <span>
                  <strong>{person(current.from).name}</strong>{' '}
                  <span className="pv-muted">
                    {person(current.from).title} · {current.age} ago
                  </span>
                </span>
              </div>
              <p className="pv-reader-text">{current.detail}</p>
              <Context item={current} />
              <Actions
                item={current}
                onDone={() => {
                  props.onDone(current.id);
                }}
                onSnooze={() => {
                  props.onSnooze(current.id);
                }}
              />
            </>
          ) : (
            <div className="pv-empty">
              <span>Select an item.</span>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
