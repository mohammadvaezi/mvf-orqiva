// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
//    Why:  the handover as screens. The team sees what the pack still lacks, ticks its own checklist and
//          sends a frozen pack; the client reads the pack as it was sent, downloads it as PDF and accepts it
//          with a signed name or asks for changes. The views take their data as props, so the design
//          preview shows them with sample data and the live pages with the server's.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Button, Card, Chip, Stat } from '../preview/ui.js';
import { Markdown } from './markdown.js';

export interface HandoverCheckView {
  key: string;
  label: string;
  state: string;
  detail: string;
}
export interface HandoverItemView {
  id: string;
  label: string;
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
  note: string;
}
export interface PackSummaryView {
  id: string;
  number: number;
  status: string;
  note: string;
  hash: string;
  sentBy: string | null;
  sentAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  signedName: string;
  decisionNote: string;
}
export interface HandoverData {
  checks: HandoverCheckView[];
  ready: boolean;
  items: HandoverItemView[];
  suggested: string[];
  client: string | null;
  pages: { id: string; title: string; version: number }[];
  packs: PackSummaryView[];
}
export interface PackContentsView {
  project: { key: string; name: string };
  client: string | null;
  checks: HandoverCheckView[];
  pages: { id: string; title: string; version: number; generated: boolean }[];
  release: { version: string; notes: string; releasedAt: string | null } | null;
  tests: { name: string; passed: number; failed: number; finishedAt: string | null } | null;
  acceptance: { name: string; accepted: boolean; signedName: string; at: string | null } | null;
  openTasks: { ref: string; title: string; state: string }[];
  note: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 9 Oct 2026 */
export const dayText = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return String(d.getDate()) + ' ' + (MONTHS[d.getMonth()] ?? '') + ' ' + String(d.getFullYear());
};

const STATE: Record<
  string,
  { tone: 'success' | 'warning' | 'danger'; icon: PIconName; text: string }
> = {
  ok: { tone: 'success', icon: 'check', text: 'ready' },
  warn: { tone: 'warning', icon: 'flag', text: 'note' },
  missing: { tone: 'danger', icon: 'x', text: 'missing' },
};
export const PACK_STATUS: Record<
  string,
  { tone: 'success' | 'warning' | 'neutral' | 'info'; text: string }
> = {
  sent: { tone: 'info', text: 'waiting for the client' },
  accepted: { tone: 'success', text: 'accepted' },
  changes_requested: { tone: 'warning', text: 'changes asked for' },
  superseded: { tone: 'neutral', text: 'replaced by a newer pack' },
};

/** Counts per state, for the summary. */
export const checkCounts = (
  checks: readonly HandoverCheckView[],
): Record<'ok' | 'warn' | 'missing', number> => ({
  ok: checks.filter((c) => c.state === 'ok').length,
  warn: checks.filter((c) => c.state === 'warn').length,
  missing: checks.filter((c) => c.state === 'missing').length,
});

function CheckRows(props: { checks: HandoverCheckView[]; skipItems?: boolean }): ReactNode {
  return (
    <ul className="pv-rows">
      {props.checks
        .filter((c) => !props.skipItems || !c.key.startsWith('item:'))
        .map((c) => {
          const st = STATE[c.state] ?? {
            tone: 'warning' as const,
            icon: 'flag' as const,
            text: c.state,
          };
          return (
            <li key={c.key} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">{c.label}</span>
                <span className="pv-row-sub">{c.detail}</span>
              </span>
              <Chip tone={st.tone} icon={st.icon}>
                {st.text}
              </Chip>
            </li>
          );
        })}
    </ul>
  );
}

/** The team's Handover tab. */
export function HandoverView(props: {
  data: HandoverData;
  canEdit: boolean;
  busy?: boolean;
  error?: string;
  pdfHref: (packId: string) => string;
  onToggle: (item: HandoverItemView) => void;
  onAdd: (label: string) => void;
  onSuggested: () => void;
  onRemove: (item: HandoverItemView) => void;
  onSend: (note: string) => void;
  onOpenPack: (packId: string) => void;
}): ReactNode {
  const d = props.data;
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const n = checkCounts(d.checks);
  const latest = d.packs[0];
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Ready"
          icon="check"
          value={String(n.ok) + ' of ' + String(d.checks.length)}
          tone={d.ready ? 'success' : undefined}
        />
        <Stat
          label="Missing"
          icon="x"
          value={n.missing}
          tone={n.missing ? 'danger' : undefined}
          sub="blocks sending"
        />
        <Stat
          label="Notes"
          icon="flag"
          value={n.warn}
          tone={n.warn ? 'warning' : undefined}
          sub="shown, not blocking"
        />
        <Stat
          label="Latest pack"
          icon="signoff"
          value={latest ? 'Pack ' + String(latest.number) : '—'}
          sub={latest ? PACK_STATUS[latest.status]?.text : 'none sent yet'}
        />
      </div>
      <div className="pv-split pv-split--even">
        <Card title="Checks" flush>
          <CheckRows checks={d.checks} skipItems />
        </Card>
        <Card
          title={
            'Team checklist · ' +
            String(d.items.filter((i) => i.done).length) +
            ' of ' +
            String(d.items.length)
          }
          flush
          action={
            props.canEdit && d.suggested.length ? (
              <Button size="sm" onClick={props.onSuggested}>
                Add the suggested items
              </Button>
            ) : null
          }
        >
          <ul className="pv-rows">
            {d.items.map((i) => (
              <li key={i.id} className="pv-row pv-row--static">
                <label className="pv-row-main v2-check">
                  <input
                    type="checkbox"
                    checked={i.done}
                    disabled={!props.canEdit}
                    onChange={() => {
                      props.onToggle(i);
                    }}
                  />
                  <span>
                    <span className="pv-row-title">{i.label}</span>
                    <span className="pv-row-sub">
                      {i.done
                        ? 'Done by ' + (i.doneBy ?? 'someone') + ' · ' + dayText(i.doneAt)
                        : 'Not done yet'}
                    </span>
                  </span>
                </label>
                {props.canEdit ? (
                  <button
                    type="button"
                    className="pv-icon-btn"
                    aria-label={'Remove ' + i.label}
                    onClick={() => {
                      props.onRemove(i);
                    }}
                  >
                    <PIcon name="x" size={12} />
                  </button>
                ) : null}
              </li>
            ))}
            {!d.items.length ? (
              <li className="pv-row pv-muted">
                Things only people can confirm: credentials handed over (outside Orqiva), access,
                support.
              </li>
            ) : null}
          </ul>
          {props.canEdit ? (
            <form
              className="pv-ask pv-pad"
              onSubmit={(e) => {
                e.preventDefault();
                if (label.trim()) {
                  props.onAdd(label.trim());
                  setLabel('');
                }
              }}
            >
              <input
                value={label}
                maxLength={200}
                placeholder="Add an item"
                aria-label="New checklist item"
                onChange={(e) => {
                  setLabel(e.target.value);
                }}
              />
              <Button
                size="sm"
                disabled={!label.trim()}
                onClick={() => {
                  if (label.trim()) {
                    props.onAdd(label.trim());
                    setLabel('');
                  }
                }}
              >
                Add
              </Button>
            </form>
          ) : null}
        </Card>
      </div>
      <Card
        title={
          'The pack carries · ' +
          String(d.pages.length) +
          (d.pages.length === 1 ? ' page' : ' pages')
        }
        flush
      >
        <ul className="pv-rows">
          {d.pages.map((p) => (
            <li key={p.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">
                  <PIcon name="documents" size={12} /> {p.title}
                </span>
              </span>
              <span className="pv-muted pv-small">version {p.version}</span>
            </li>
          ))}
          {!d.pages.length ? (
            <li className="pv-row pv-muted">
              Published pages titled “Handover readme”, “Architecture” and “Runbook: …”, the pages
              built from the code and pages shared with the client go into the pack.
            </li>
          ) : null}
        </ul>
      </Card>
      {props.canEdit ? (
        <Card title={'Send to ' + (d.client ?? 'the client')}>
          <div className="pv-stack">
            <p className="pv-small pv-muted">
              Sending freezes the pack as it is now: the checks, the pages at their versions, the
              release, the tests and the open tasks.{' '}
              {d.client ? d.client + '’s approvers' : 'The client'} read it in the portal and accept
              it with their signature.
            </p>
            <textarea
              className="v2-input"
              rows={2}
              maxLength={4000}
              aria-label="Note for the client"
              placeholder="A note for the client (optional)"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
            {props.error ? (
              <p className="v2-error" role="alert">
                {props.error}
              </p>
            ) : null}
            <div className="v2-inline">
              <Button
                kind="primary"
                icon="signoff"
                disabled={!d.ready || Boolean(props.busy)}
                title={d.ready ? 'Freeze and send the pack' : 'Something required is missing'}
                onClick={() => {
                  props.onSend(note);
                  setNote('');
                }}
              >
                {props.busy ? 'Sending…' : 'Send pack ' + String((latest?.number ?? 0) + 1)}
              </Button>
              {!d.ready ? (
                <span className="pv-muted pv-small">
                  Missing:{' '}
                  {d.checks
                    .filter((c) => c.state === 'missing')
                    .map((c) => c.label)
                    .join(', ')}
                </span>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}
      <Card title="Packs sent" flush>
        <ul className="pv-rows">
          {d.packs.map((p) => (
            <PackRow
              key={p.id}
              pack={p}
              pdfHref={props.pdfHref(p.id)}
              onOpen={() => {
                props.onOpenPack(p.id);
              }}
            />
          ))}
          {!d.packs.length ? <li className="pv-row pv-muted">No pack sent yet.</li> : null}
        </ul>
      </Card>
    </div>
  );
}

function PackRow(props: {
  pack: PackSummaryView;
  pdfHref: string;
  onOpen: () => void;
  label?: string;
}): ReactNode {
  const p = props.pack;
  const st = PACK_STATUS[p.status] ?? { tone: 'neutral' as const, text: p.status };
  return (
    <li className="pv-row pv-row--static">
      <span className="pv-row-main">
        <button type="button" className="pv-link-btn v2-left" onClick={props.onOpen}>
          {props.label ?? 'Pack ' + String(p.number)}
        </button>
        <span className="pv-row-sub">
          Sent {dayText(p.sentAt)}
          {p.sentBy ? ' by ' + p.sentBy : ''}
          {p.status === 'accepted'
            ? ' · signed by ' + p.signedName + ' on ' + dayText(p.decidedAt)
            : ''}
          {p.status === 'changes_requested' ? ' · “' + p.decisionNote + '”' : ''}
        </span>
      </span>
      <Chip tone={st.tone}>{st.text}</Chip>
      <a className="pv-link pv-small" href={props.pdfHref} target="_blank" rel="noreferrer">
        PDF
      </a>
    </li>
  );
}

/** One pack as it was sent: for the team and the client. */
export function PackView(props: {
  pack: PackSummaryView;
  contents: PackContentsView;
  pdfHref: string;
  openPage: (pageId: string) => Promise<{ title: string; version: number; body: string } | null>;
  mayDecide: boolean;
  onDecide?: (decision: 'accepted' | 'changes_requested', text: string) => Promise<string>;
  onBack?: () => void;
}): ReactNode {
  const { pack, contents: c } = props;
  const [page, setPage] = useState<{ title: string; version: number; body: string } | null>(null);
  const [mode, setMode] = useState<'sign' | 'changes' | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const st = PACK_STATUS[pack.status] ?? { tone: 'neutral' as const, text: pack.status };
  const decide = async (): Promise<void> => {
    if (!props.onDecide || !mode) return;
    setBusy(true);
    const e = await props.onDecide(mode === 'sign' ? 'accepted' : 'changes_requested', text.trim());
    setBusy(false);
    setErr(e);
    if (!e) {
      setMode(null);
      setText('');
    }
  };
  return (
    <div className="pv-stack">
      <div className="v2-inline">
        {props.onBack ? (
          <Button size="sm" kind="ghost" onClick={props.onBack}>
            All packs
          </Button>
        ) : null}
        <strong>
          {c.project.key} · Handover pack {pack.number}
        </strong>
        <Chip tone={st.tone}>{st.text}</Chip>
        <span className="pv-muted pv-small">
          sent {dayText(pack.sentAt)}
          {pack.sentBy ? ' by ' + pack.sentBy : ''}
        </span>
        <a className="pv-link pv-small" href={props.pdfHref} target="_blank" rel="noreferrer">
          Download PDF
        </a>
      </div>
      {c.note ? <div className="pv-callout">{c.note}</div> : null}
      {pack.status === 'accepted' ? (
        <div className="pv-callout">
          <PIcon name="signoff" size={16} /> Accepted and signed by {pack.signedName} on{' '}
          {dayText(pack.decidedAt)}.
        </div>
      ) : null}
      {pack.status === 'changes_requested' ? (
        <div className="pv-callout pv-callout--warn">Changes asked for: {pack.decisionNote}</div>
      ) : null}
      {props.mayDecide && pack.status === 'sent' ? (
        <Card>
          {!mode ? (
            <div className="v2-inline">
              <span className="pv-small">Read what is handed over, then decide.</span>
              <Button
                onClick={() => {
                  setMode('changes');
                  setText('');
                }}
              >
                Ask for changes
              </Button>
              <Button
                kind="primary"
                icon="signoff"
                onClick={() => {
                  setMode('sign');
                  setText('');
                }}
              >
                Accept
              </Button>
            </div>
          ) : (
            <div className="pv-sign">
              <p className="pv-small">
                {mode === 'sign'
                  ? 'Signing accepts handover pack ' +
                    String(pack.number) +
                    ' as it is shown here. Your name, the time and a fingerprint of the pack are recorded.'
                  : 'Say what is missing or should change; your team sends a new pack.'}
              </p>
              <div className="pv-ask">
                <input
                  value={text}
                  placeholder={mode === 'sign' ? 'Type your full name' : 'What should change?'}
                  aria-label={mode === 'sign' ? 'Your name' : 'Note'}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
                <Button
                  kind="primary"
                  disabled={busy || (mode === 'sign' ? text.trim().length < 3 : !text.trim())}
                  onClick={() => void decide()}
                >
                  {mode === 'sign' ? 'Sign' : 'Send'}
                </Button>
                <Button
                  kind="ghost"
                  onClick={() => {
                    setMode(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
              {err ? (
                <p className="v2-error" role="alert">
                  {err}
                </p>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}
      <div className="pv-split pv-split--even">
        <Card title="What was checked" flush>
          <CheckRows checks={c.checks} />
        </Card>
        <Card title="Release, tests and acceptance" flush>
          <ul className="pv-rows">
            <li className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">Release</span>
                <span className="pv-row-sub">
                  {c.release ? c.release.version + ' · ' + dayText(c.release.releasedAt) : 'none'}
                </span>
              </span>
            </li>
            <li className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">Tests</span>
                <span className="pv-row-sub">
                  {c.tests
                    ? c.tests.name +
                      ': ' +
                      String(c.tests.passed) +
                      ' passed, ' +
                      String(c.tests.failed) +
                      ' failed'
                    : 'no finished run'}
                </span>
              </span>
            </li>
            <li className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">Acceptance</span>
                <span className="pv-row-sub">
                  {c.acceptance
                    ? c.acceptance.name +
                      (c.acceptance.accepted
                        ? ', accepted by ' + c.acceptance.signedName
                        : ', not accepted')
                    : 'no round'}
                </span>
              </span>
            </li>
            <li className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">Open tasks</span>
                <span className="pv-row-sub">
                  {c.openTasks.length
                    ? c.openTasks
                        .slice(0, 5)
                        .map((t) => t.ref + ' ' + t.title)
                        .join(' · ') +
                      (c.openTasks.length > 5
                        ? ' · and ' + String(c.openTasks.length - 5) + ' more'
                        : '')
                    : 'none'}
                </span>
              </span>
            </li>
          </ul>
        </Card>
      </div>
      <div className="pv-split">
        <Card title="Documents" flush>
          <ul className="pv-rows">
            {c.pages.map((p) => (
              <li key={p.id} className="pv-row pv-row--static">
                <button
                  type="button"
                  className="pv-link-btn v2-left"
                  onClick={() => void props.openPage(p.id).then(setPage)}
                >
                  <PIcon name={p.generated ? 'ide' : 'documents'} size={12} /> {p.title}
                </button>
                <span className="pv-muted pv-small">v{p.version}</span>
              </li>
            ))}
            {!c.pages.length ? <li className="pv-row pv-muted">No pages.</li> : null}
          </ul>
        </Card>
        {page ? (
          <Card title={page.title + ' · version ' + String(page.version)}>
            <Markdown text={page.body} links={{ page: () => null, go: () => undefined }} />
          </Card>
        ) : (
          <Card>
            <p className="pv-muted pv-small">Open a document to read it as it was sent.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── [PCODE-200 | S15 | v0.1.0] the live team tab ──
export function HandoverPage(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  canEdit: boolean;
}): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const P = W + '/projects/' + props.projectId;
  const [data, setData] = useState<HandoverData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ pack: PackSummaryView; contents: PackContentsView } | null>(
    null,
  );
  const load = useCallback(async () => {
    const r = await api<HandoverData>('GET', P + '/handover');
    if (r.ok) setData(r.data);
    else setError(r.error.message);
  }, [P]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.projectid === props.projectId) void load();
    });
  }, [load, props.hub, props.projectId]);
  const run = async (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<boolean> => {
    const r = await api(method, W + path, body);
    setError(r.ok ? '' : r.error.message);
    await load();
    return r.ok;
  };
  if (!data) return <p className="pv-muted">{error || 'Loading…'}</p>;
  if (open)
    return (
      <PackView
        pack={open.pack}
        contents={open.contents}
        pdfHref={W + '/handover-packs/' + open.pack.id + '/pdf'}
        mayDecide={false}
        openPage={async (pageId) => {
          const r = await api<{ title: string; version: number; body: string }>(
            'GET',
            W + '/handover-packs/' + open.pack.id + '/pages/' + pageId,
          );
          return r.ok ? r.data : null;
        }}
        onBack={() => {
          setOpen(null);
        }}
      />
    );
  return (
    <HandoverView
      data={data}
      canEdit={props.canEdit}
      busy={busy}
      error={error}
      pdfHref={(id) => W + '/handover-packs/' + id + '/pdf'}
      onToggle={(i) => void run('PATCH', '/handover-items/' + i.id, { done: !i.done })}
      onAdd={(label) =>
        void run('POST', '/projects/' + props.projectId + '/handover/items', { label })
      }
      onSuggested={() =>
        void run('POST', '/projects/' + props.projectId + '/handover/items', { suggested: true })
      }
      onRemove={(i) => void run('DELETE', '/handover-items/' + i.id)}
      onSend={(note) => {
        setBusy(true);
        void run(
          'POST',
          '/projects/' + props.projectId + '/handover/packs',
          note.trim() ? { note: note.trim() } : {},
        ).then(() => {
          setBusy(false);
        });
      }}
      onOpenPack={(id) =>
        void api<{ pack: PackSummaryView; contents: PackContentsView }>(
          'GET',
          W + '/handover-packs/' + id,
        ).then((r) => {
          if (r.ok) setOpen(r.data);
        })
      }
    />
  );
}

// ── [PCODE-200 | S15 | v0.1.0] the portal's Handover section ──
export function PortalHandoverView(props: {
  packs: { projectKey: string; projectName: string; latest: boolean; pack: PackSummaryView }[];
  onOpen: (packId: string) => void;
  pdfHref: (packId: string) => string;
}): ReactNode {
  if (!props.packs.length)
    return (
      <Card>
        <div className="pv-empty">
          <PIcon name="signoff" size={28} />
          <strong>No handover pack yet.</strong>
          <span>
            When your team hands a project over, its pack shows here for you to read and accept.
          </span>
        </div>
      </Card>
    );
  return (
    <Card title="Handover packs" flush>
      <ul className="pv-rows">
        {props.packs.map((p) => (
          <PackRow
            key={p.pack.id}
            pack={p.pack}
            label={p.projectName + ' · pack ' + String(p.pack.number)}
            pdfHref={props.pdfHref(p.pack.id)}
            onOpen={() => {
              props.onOpen(p.pack.id);
            }}
          />
        ))}
      </ul>
    </Card>
  );
}
