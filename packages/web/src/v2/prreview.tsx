// ── [PCODE-305 | S15 | v0.1.0] T31.5b The merge queue: in order per branch, merged through the host when the policy passes ──
// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
// ── [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files ──
//    Why:  the reviewer's screen. The queue puts open pull requests riskiest first with the reasons in words
//          and how far the reader got; a pull request opens on its files: a list to jump and tick off, and
//          each file's change side by side (one column on a narrow screen), with the fingerprints its new
//          lines carry, code added without one, and fingerprints of another task called out.
import { parsePatch, sideBySide, type Hunk, type PatchLine, type SideRow } from '@orqiva/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { ago } from './inbox.js';
// [PCODE-303 | S15 | v0.1.0] comments on lines and the review form
import {
  lineKey,
  LineThread,
  ReviewForm,
  useThread,
  type LineAt,
  type LineComment,
  type ThreadApi,
} from './prcomments.js';
// [PCODE-304 | S15 | v0.1.0] the merge policy, conflicts and stacks
import {
  mergeableChip,
  PolicySettings,
  PullPolicyCard,
  VERDICT_TEXT,
  verdictTone,
} from './mergepolicy.js';
import { MergeQueue, QueueButton } from './mergequeue.js'; // [PCODE-305 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

interface Risk {
  score: number;
  level: string;
  reasons: string[];
}
export interface QueuedPull {
  id: string;
  number: number;
  title: string;
  url: string;
  author: string;
  repo: string;
  branch: string;
  base: string;
  draft: boolean;
  additions: number;
  deletions: number;
  size: string;
  reviewState: string;
  checksState: string;
  itemRef: string | null;
  updatedAt: string;
  risk: Risk;
  files: number | null;
  viewed: number;
  // [PCODE-304 | S15 | v0.1.0]
  mergeable: string;
  stackedOn: number | null;
  baseMerged: number | null;
  policy: { state: string; description: string } | null;
}
interface ReviewFile {
  path: string;
  oldPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  tooBig: boolean;
  patch: string;
  viewed: boolean;
  markers: { line: number; task: string; title: string }[];
  missing: boolean;
  foreign: string[];
}
interface PullFiles {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  branch: string;
  base: string;
  state: string;
  itemRef: string | null;
  risk: Risk;
  readAt: string;
  truncated: boolean;
  files: ReviewFile[];
}

export const riskTone = (level: string): Tone =>
  level === 'high' ? 'danger' : level === 'medium' ? 'warning' : 'success';

/** The checks state the server keeps (passing, failing, pending, none) as a chip's tone. */
export const checksTone = (state: string): Tone =>
  state === 'passing'
    ? 'success'
    : state === 'failing'
      ? 'danger'
      : state === 'pending'
        ? 'info'
        : 'neutral';

/** "2 of 5 files viewed", or why it is not known yet. */
export function progressText(files: number | null, viewed: number): string {
  if (files === null) return 'files not read yet';
  if (!files) return 'no files';
  return viewed >= files
    ? 'all ' + String(files) + ' files viewed'
    : String(viewed) + ' of ' + String(files) + ' file' + (files === 1 ? '' : 's') + ' viewed';
}

/** The review queue, or one pull request when picked. */
export function ReviewQueue(props: { workspaceId: string; projectId: string }): ReactNode {
  const [list, setList] = useState<QueuedPull[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    void api<QueuedPull[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/review-queue'),
    ).then((r) => {
      if (r.ok) setList(r.data);
      else setError(r.error.message);
    });
  }, [props.workspaceId, props.projectId]);
  useEffect(load, [load]);
  if (open)
    return (
      <PullReview
        workspaceId={props.workspaceId}
        pullId={open}
        back={() => {
          setOpen(null);
          load();
        }}
      />
    );
  if (!list) return <p className="pv-muted">{error ?? 'Loading the review queue…'}</p>;
  return (
    <div className="pv-stack">
      {/* [PCODE-304 | S15 | v0.1.0] the project's merge policy above the queue */}
      <PolicySettings workspaceId={props.workspaceId} projectId={props.projectId} />
      {/* [PCODE-305 | S15 | v0.1.0] the lines of the merge queue */}
      <MergeQueue workspaceId={props.workspaceId} projectId={props.projectId} changed={load} />
      <Card flush title={'Review queue · ' + String(list.length) + ' open, riskiest first'}>
        {list.length ? (
          <ul className="pv-rows">
            {list.map((p) => (
              <li key={p.id} className="pv-row pv-row--static v2-pr-queue">
                <span className="pv-row-main">
                  <button
                    type="button"
                    className="pv-link-btn pv-row-title"
                    onClick={() => {
                      setOpen(p.id);
                    }}
                  >
                    <span className="pv-mono pv-muted">#{p.number}</span> {p.title}
                  </button>
                  <span className="pv-row-sub">
                    <span className="pv-mono">{p.repo}</span> ·{' '}
                    <span className="pv-mono">{p.branch}</span> → {p.base} · {p.author} ·{' '}
                    {p.itemRef ? p.itemRef + ' · ' : ''}updated {ago(p.updatedAt)} ago
                  </span>
                  <span className="pv-row-sub">
                    {p.risk.reasons.length ? p.risk.reasons.join(' · ') : 'nothing stands out'} ·{' '}
                    {progressText(p.files, p.viewed)}
                  </span>
                </span>
                <span className="pv-pr-size pv-mono pv-small">
                  <span className="pv-text-success">+{p.additions}</span>{' '}
                  <span className="pv-text-danger">−{p.deletions}</span>
                </span>
                <Chip tone={riskTone(p.risk.level)}>{p.risk.level} risk</Chip>
                <Chip tone={checksTone(p.checksState)}>checks {p.checksState}</Chip>
                {p.draft ? <Chip>draft</Chip> : null}
                {/* [PCODE-304 | S15 | v0.1.0] conflicts, stacks, the policy's verdict */}
                <QueueFlags p={p} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-empty">No open pull requests to review.</p>
        )}
      </Card>
    </div>
  );
}

// [PCODE-304 | S15 | v0.1.0]
function QueueFlags(props: { p: QueuedPull }): ReactNode {
  const { p } = props;
  const m = mergeableChip(p.mergeable);
  return (
    <>
      {m ? <Chip tone={m.tone}>{m.text}</Chip> : null}
      {p.stackedOn !== null ? <Chip tone="info">stacked on #{p.stackedOn}</Chip> : null}
      {p.baseMerged !== null ? (
        <Chip tone="warning">base #{p.baseMerged} merged: retarget</Chip>
      ) : null}
      {p.policy ? (
        <span title={p.policy.description}>
          <Chip tone={verdictTone(p.policy.state)}>
            {VERDICT_TEXT[p.policy.state] ?? p.policy.state}
          </Chip>
        </span>
      ) : null}
    </>
  );
}

const narrow = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;

function PullReview(props: { workspaceId: string; pullId: string; back: () => void }): ReactNode {
  const [pr, setPr] = useState<PullFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [split, setSplit] = useState(!narrow());
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  // [PCODE-303 | S15 | v0.1.0] the comments, and the line whose comment box is open
  const t = useThread(props.workspaceId, props.pullId);
  const [writing, setWriting] = useState<string | null>(null);
  const load = useCallback(
    (refresh: boolean) => {
      setBusy(true);
      void api<PullFiles>(
        'GET',
        W(
          props.workspaceId,
          '/pull-requests/' + props.pullId + '/files' + (refresh ? '?refresh=1' : ''),
        ),
      ).then((r) => {
        setBusy(false);
        if (r.ok) {
          setPr(r.data);
          setError(null);
          setClosed(new Set(r.data.files.filter((f) => f.viewed).map((f) => f.path)));
        } else setError(r.error.message);
      });
    },
    [props.workspaceId, props.pullId],
  );
  useEffect(() => {
    load(false);
  }, [load]);
  const mark = async (f: ReviewFile, viewed: boolean): Promise<void> => {
    const r = await api('PUT', W(props.workspaceId, '/pull-requests/' + props.pullId + '/viewed'), {
      path: f.path,
      viewed,
    });
    if (!r.ok || !pr) return;
    setPr({ ...pr, files: pr.files.map((x) => (x.path === f.path ? { ...x, viewed } : x)) });
    const next = new Set(closed);
    if (viewed) next.add(f.path);
    else next.delete(f.path);
    setClosed(next);
  };
  const head = (
    <p>
      <Button size="sm" kind="ghost" onClick={props.back}>
        ← Review queue
      </Button>
    </p>
  );
  if (!pr)
    return (
      <div className="pv-stack">
        {head}
        <p className={error ? 'pv-text-danger' : 'pv-muted'} role={error ? 'alert' : undefined}>
          {error ?? 'Reading the changed files…'}
        </p>
      </div>
    );
  const viewed = pr.files.filter((f) => f.viewed).length;
  const show = (i: number): void => {
    const f = pr.files[i];
    if (f && closed.has(f.path)) {
      const next = new Set(closed);
      next.delete(f.path);
      setClosed(next);
    }
    document.getElementById('v2-prf-' + String(i))?.scrollIntoView({ block: 'start' });
  };
  return (
    <div className="pv-stack">
      {head}
      <Card
        title={
          <>
            <span className="pv-mono pv-muted">#{pr.number}</span> {pr.title}
          </>
        }
        action={
          <span className="v2-pr-actions">
            <Button
              size="sm"
              onClick={() => {
                setSplit(!split);
              }}
            >
              {split ? 'One column' : 'Side by side'}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                load(true);
              }}
            >
              {busy ? 'Reading…' : 'Read again'}
            </Button>
          </span>
        }
      >
        <p className="pv-small">
          <span className="pv-mono">{pr.repo}</span> · <span className="pv-mono">{pr.branch}</span>{' '}
          → {pr.base} · {pr.itemRef ?? <span className="pv-text-warning">no task</span>} ·{' '}
          <a className="pv-link" href={pr.url} target="_blank" rel="noreferrer">
            open on the host
          </a>
        </p>
        {/* [PCODE-305 | S15 | v0.1.0] put it in line */}
        <p className="pv-small">
          <QueueButton workspaceId={props.workspaceId} pullId={pr.id} open={pr.state === 'open'} />
        </p>
        <p className="pv-small">
          <Chip tone={riskTone(pr.risk.level)}>{pr.risk.level} risk</Chip>{' '}
          {pr.risk.reasons.length ? pr.risk.reasons.join(' · ') : 'nothing stands out'}
        </p>
        <p className="pv-small" role="status">
          {progressText(pr.files.length, viewed)}
          {pr.truncated ? ' · the host had more files than are shown' : ''} · read {ago(pr.readAt)}{' '}
          ago
        </p>
        {error ? (
          <p className="pv-text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
      {/* [PCODE-304 | S15 | v0.1.0] the rules, conflicts and stack */}
      <PullPolicyCard workspaceId={props.workspaceId} pullId={props.pullId} />
      <div className="v2-pr-layout">
        <nav className="v2-pr-files" aria-label="Changed files">
          <ul>
            {pr.files.map((f, i) => (
              <li key={f.path}>
                <input
                  type="checkbox"
                  aria-label={'Viewed ' + f.path}
                  checked={f.viewed}
                  onChange={(e) => void mark(f, e.target.checked)}
                />
                <button
                  type="button"
                  className="pv-link-btn pv-mono"
                  title={f.path}
                  onClick={() => {
                    show(i);
                  }}
                >
                  {f.path.split('/').pop()}
                </button>
                {f.missing || f.foreign.length ? (
                  <span
                    className="pv-text-warning"
                    title={f.missing ? 'Code without a fingerprint' : 'Fingerprint of another task'}
                    aria-label={
                      f.missing ? 'Code without a fingerprint' : 'Fingerprint of another task'
                    }
                  >
                    !
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
        <div className="v2-pr-diffs">
          {pr.files.map((f, i) => (
            <FileChange
              key={f.path}
              id={'v2-prf-' + String(i)}
              file={f}
              split={split}
              open={!closed.has(f.path)}
              toggle={() => {
                const next = new Set(closed);
                if (next.has(f.path)) next.delete(f.path);
                else next.add(f.path);
                setClosed(next);
              }}
              mark={(v) => void mark(f, v)}
              task={pr.itemRef}
              lines={{
                path: f.path,
                byLine: byLine(t.thread.comments, f.path),
                writing,
                open: (at) => {
                  setWriting(lineKey(at));
                },
                close: () => {
                  setWriting(null);
                },
                t,
              }}
            />
          ))}
        </div>
      </div>
      <ReviewForm t={t} canPost={pr.state === 'open'} />
    </div>
  );
}

// [PCODE-303 | S15 | v0.1.0] what a diff's rows need to show and add comments
interface Lines {
  path: string;
  byLine: ReadonlyMap<string, LineComment[]>;
  writing: string | null;
  open: (at: LineAt) => void;
  close: () => void;
  t: ThreadApi;
}

/** A file's comments by line; dismissed suggestions are counted in the review form, not shown. */
function byLine(all: readonly LineComment[], path: string): Map<string, LineComment[]> {
  const out = new Map<string, LineComment[]>();
  for (const c of all) {
    if (c.path !== path || c.state === 'dismissed') continue;
    const k = lineKey(c);
    out.set(k, [...(out.get(k) ?? []), c]);
  }
  return out;
}

/** The line's number, which opens a comment box on it. */
function NumCell(props: { at: LineAt | null; cls: string; lines: Lines }): ReactNode {
  const at = props.at;
  return (
    <td className={'v2-pr-num ' + props.cls}>
      {at ? (
        <button
          type="button"
          className="pv-link-btn v2-pr-numbtn"
          aria-label={'Comment on line ' + String(at.line) + (at.side === 'old' ? ' (old)' : '')}
          onClick={() => {
            props.lines.open(at);
          }}
        >
          {at.line}
        </button>
      ) : null}
    </td>
  );
}

/** The threads under a row: on the removed line (old side) and on the new line. */
function threadsAfter(ats: readonly (LineAt | null)[], lines: Lines, span: number): ReactNode[] {
  return ats.flatMap((at) =>
    at
      ? [
          <LineThread
            key={'t-' + lineKey(at)}
            at={at}
            comments={lines.byLine.get(lineKey(at)) ?? []}
            writing={lines.writing === lineKey(at)}
            close={lines.close}
            t={lines.t}
            span={span}
          />,
        ]
      : [],
  );
}

/** Where a comment on this line sits: a removed line on the old side, every other one on the new. */
const atOf = (l: PatchLine | null, path: string): LineAt | null =>
  !l
    ? null
    : l.kind === 'del'
      ? l.old === null
        ? null
        : { path, side: 'old', line: l.old }
      : l.new === null
        ? null
        : { path, side: 'new', line: l.new };

const STATUS_TONE: Record<string, Tone> = {
  added: 'success',
  deleted: 'danger',
  renamed: 'info',
  modified: 'neutral',
};

function FileChange(props: {
  id: string;
  file: ReviewFile;
  split: boolean;
  open: boolean;
  toggle: () => void;
  mark: (viewed: boolean) => void;
  task: string | null;
  lines: Lines; // [PCODE-303 | S15 | v0.1.0]
}): ReactNode {
  const f = props.file;
  const hunks = useMemo(() => parsePatch(f.patch), [f.patch]);
  const rows = useMemo(() => sideBySide(hunks), [hunks]);
  const marked = useMemo(() => new Set(f.markers.map((m) => m.line)), [f.markers]);
  return (
    <section id={props.id} className="pv-card v2-pr-file" aria-label={f.path}>
      <header className="v2-pr-file-head">
        <button
          type="button"
          className="pv-link-btn"
          aria-expanded={props.open}
          onClick={props.toggle}
        >
          {props.open ? '▾' : '▸'}
        </button>
        <span className="pv-mono v2-pr-path">
          {f.oldPath ? f.oldPath + ' → ' : ''}
          {f.path}
        </span>
        <Chip tone={STATUS_TONE[f.status] ?? 'neutral'}>{f.status}</Chip>
        <span className="pv-mono pv-small">
          <span className="pv-text-success">+{f.additions}</span>{' '}
          <span className="pv-text-danger">−{f.deletions}</span>
        </span>
        {[...new Set(f.markers.map((m) => m.task))].map((t) => (
          <Chip key={t} tone={props.task && t !== props.task ? 'warning' : 'info'} mono>
            {t}
          </Chip>
        ))}
        {f.missing ? <Chip tone="warning">no fingerprint</Chip> : null}
        {f.foreign.length ? (
          <span className="pv-small pv-text-warning">
            fingerprint of {f.foreign.join(', ')}, not {props.task}
          </span>
        ) : null}
        <label className="pv-switch v2-pr-viewed">
          <input
            type="checkbox"
            checked={f.viewed}
            onChange={(e) => {
              props.mark(e.target.checked);
            }}
          />
          <span>Viewed</span>
        </label>
      </header>
      {props.open ? (
        f.binary ? (
          <p className="pv-muted v2-pr-note">A binary file; it is not shown.</p>
        ) : f.tooBig ? (
          <p className="pv-muted v2-pr-note">Too big to show here; open it on the host.</p>
        ) : !rows.length ? (
          <p className="pv-muted v2-pr-note">
            {f.status === 'renamed' ? 'Renamed without changes.' : 'No changed lines.'}
          </p>
        ) : (
          <div className="v2-pr-scroll">
            <table className={'v2-pr-diff pv-mono' + (props.split ? ' v2-pr-diff--split' : '')}>
              {/* the first row is a hunk's heading across all columns: the widths come from here */}
              {props.split ? (
                <colgroup>
                  <col className="v2-pr-numcol" />
                  <col />
                  <col className="v2-pr-numcol" />
                  <col />
                </colgroup>
              ) : (
                <colgroup>
                  <col className="v2-pr-numcol" />
                  <col className="v2-pr-numcol" />
                  <col />
                </colgroup>
              )}
              <tbody>
                {props.split
                  ? rows.flatMap((r, k) => splitRows(r, k, marked, props.lines))
                  : hunks.flatMap((h, k) => unifiedRows(h, k, marked, props.lines))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}

const sign = (l: PatchLine): string => (l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' ');
const lineClass = (l: PatchLine | null, marked: ReadonlySet<number>): string =>
  !l
    ? 'v2-pr-empty'
    : 'v2-pr-' +
      l.kind +
      (l.kind === 'add' && l.new !== null && marked.has(l.new) ? ' v2-pr-mark' : '');

function HunkRow(props: { row: Extract<SideRow, { kind: 'hunk' }>; span: number }): ReactNode {
  return (
    <tr className="v2-pr-hunk">
      <td colSpan={props.span}>
        @@ −{props.row.oldStart} +{props.row.newStart} @@ {props.row.header}
      </td>
    </tr>
  );
}

// [PCODE-303 | S15 | v0.1.0] a row, then the comments on its lines; the line numbers open a comment box
function splitRows(r: SideRow, k: number, marked: ReadonlySet<number>, lines: Lines): ReactNode[] {
  if (r.kind === 'hunk') return [<HunkRow key={k} row={r} span={4} />];
  // a context line is the same on both sides: its comment sits on the new side only
  const left = r.left?.kind === 'del' ? atOf(r.left, lines.path) : null;
  const right = atOf(r.right, lines.path);
  return [
    <tr key={k}>
      {left ? (
        <NumCell at={left} cls={lineClass(r.left, marked)} lines={lines} />
      ) : (
        <td className={'v2-pr-num ' + lineClass(r.left, marked)}>{r.left?.old ?? ''}</td>
      )}
      <td className={'v2-pr-code ' + lineClass(r.left, marked)}>
        {r.left ? sign(r.left) + ' ' + r.left.text : ''}
      </td>
      <NumCell at={right} cls={lineClass(r.right, marked)} lines={lines} />
      <td className={'v2-pr-code ' + lineClass(r.right, marked)}>
        {r.right ? sign(r.right) + ' ' + r.right.text : ''}
      </td>
    </tr>,
    ...threadsAfter([left, right], lines, 4),
  ];
}

/** One column: a hunk's lines in the patch's own order. */
function unifiedRows(
  h: Hunk,
  k: number,
  marked: ReadonlySet<number>,
  lines: Lines, // [PCODE-303 | S15 | v0.1.0]
): ReactNode[] {
  return [
    <HunkRow
      key={k}
      row={{ kind: 'hunk', header: h.header, oldStart: h.oldStart, newStart: h.newStart }}
      span={3}
    />,
    ...h.lines.flatMap((l, j) => {
      const at = atOf(l, lines.path);
      return [
        <tr key={String(k) + '-' + String(j)}>
          {at?.side === 'old' ? (
            <NumCell at={at} cls={lineClass(l, marked)} lines={lines} />
          ) : (
            <td className={'v2-pr-num ' + lineClass(l, marked)}>{l.old ?? ''}</td>
          )}
          {at?.side === 'new' ? (
            <NumCell at={at} cls={lineClass(l, marked)} lines={lines} />
          ) : (
            <td className={'v2-pr-num ' + lineClass(l, marked)}>{l.new ?? ''}</td>
          )}
          <td className={'v2-pr-code ' + lineClass(l, marked)}>{sign(l) + ' ' + l.text}</td>
        </tr>,
        ...threadsAfter([at], lines, 3),
      ];
    }),
  ];
}
