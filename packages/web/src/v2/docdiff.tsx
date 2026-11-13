// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-358 | S15 | v0.1.0] T35.6 Accessibility to WCAG 2.2 AA ──
// ── [PCODE-283 | S15 | v0.1.0] T29.5 Documents: named versions in the screen, visual diff, mentions in comments, page search and Cmd-K ──
//    Why:  what changed between two versions, as the page reads: blocks are compared (paragraphs,
//          headings, lists, tables, diagrams), added ones marked, removed ones struck through, and a block
//          changed in place shows its words added and taken out. The line diff stays a click away.
import { wordDiff } from '@orqiva/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { splitBlocks } from './blockedit.js';
import { Markdown, type MdLinks } from './markdown.js';
import { useDialog } from './dialog.js'; // [PCODE-358 | S15 | v0.1.0]

export type BlockOp =
  | { op: 'same'; text: string }
  | { op: 'add'; text: string }
  | { op: 'remove'; text: string }
  | { op: 'change'; from: string; to: string };

/** Two versions' blocks compared; a removed block followed by an added one is a change in place. */
export function blockDiff(from: string, to: string): BlockOp[] {
  const a = splitBlocks(from);
  const b = splitBlocks(to);
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (t[i] as number[])[j] =
        a[i] === b[j]
          ? ((t[i + 1] as number[])[j + 1] ?? 0) + 1
          : Math.max((t[i + 1] as number[])[j] ?? 0, (t[i] as number[])[j + 1] ?? 0);
  const raw: BlockOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      raw.push({ op: 'same', text: a[i] ?? '' });
      i++;
      j++;
    } else if (
      j >= m ||
      (i < n && ((t[i + 1] as number[])[j] ?? 0) >= ((t[i] as number[])[j + 1] ?? 0))
    ) {
      raw.push({ op: 'remove', text: a[i++] ?? '' });
    } else raw.push({ op: 'add', text: b[j++] ?? '' });
  }
  // blocks taken out and put in at the same place pair up, in order, as changed blocks
  const out: BlockOp[] = [];
  for (let k = 0; k < raw.length;) {
    const removed: string[] = [];
    const added: string[] = [];
    while (raw[k]?.op === 'remove') removed.push((raw[k++] as { text: string }).text);
    while (raw[k]?.op === 'add') added.push((raw[k++] as { text: string }).text);
    if (!removed.length && !added.length) {
      const x = raw[k++];
      if (x) out.push(x);
      continue;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p++)
      out.push({ op: 'change', from: removed[p] ?? '', to: added[p] ?? '' });
    for (const r of removed.slice(pairs)) out.push({ op: 'remove', text: r });
    for (const a2 of added.slice(pairs)) out.push({ op: 'add', text: a2 });
  }
  return out;
}

export function RenderedDiff(props: {
  from: string;
  to: string;
  links: MdLinks | null;
}): ReactNode {
  const ops = blockDiff(props.from, props.to);
  if (!ops.some((o) => o.op !== 'same')) return <p className="pv-muted">The texts are the same.</p>;
  return (
    <div className="v2-rdiff">
      {ops.map((o, i) =>
        o.op === 'same' ? (
          <div key={i} className="v2-rdiff-same">
            <Markdown text={o.text} links={props.links} />
          </div>
        ) : o.op === 'add' ? (
          <div key={i} className="v2-rdiff-add" aria-label="Added">
            <Markdown text={o.text} links={props.links} />
          </div>
        ) : o.op === 'remove' ? (
          <div key={i} className="v2-rdiff-del" aria-label="Removed">
            <Markdown text={o.text} links={props.links} />
          </div>
        ) : (
          <div key={i} className="v2-rdiff-change" aria-label="Changed">
            <p className="v2-rdiff-words">
              {wordDiff(o.from, o.to).map((w, k) =>
                w.op === 'same' ? (
                  <span key={k}>{w.text}</span>
                ) : w.op === 'add' ? (
                  <ins key={k}>{w.text}</ins>
                ) : (
                  <del key={k}>{w.text}</del>
                ),
              )}
            </p>
          </div>
        ),
      )}
    </div>
  );
}

/** Two versions side by side as a wide panel: rendered by default, lines on request. */
export function DiffPanel(props: {
  base: string;
  from: { version: number; name: string };
  to: { version: number; name: string };
  links: MdLinks | null;
  lines: { op: string; text: string }[];
  onClose: () => void;
}): ReactNode {
  const [texts, setTexts] = useState<[string, string] | null>(null);
  const [mode, setMode] = useState<'rendered' | 'lines'>('rendered');
  const dialog = useDialog<HTMLDivElement>(props.onClose); // [PCODE-358 | S15 | v0.1.0]
  useEffect(() => {
    void Promise.all([
      api<{ body: string }>('GET', props.base + '/versions/' + String(props.from.version)),
      api<{ body: string }>('GET', props.base + '/versions/' + String(props.to.version)),
    ]).then(([a, b]) => {
      if (a.ok && b.ok) setTexts([a.data.body, b.data.body]);
    });
  }, [props.base, props.from.version, props.to.version]);
  const label = (v: { version: number; name: string }): string =>
    'v' + String(v.version) + (v.name ? ' “' + v.name + '”' : '');
  return (
    <div ref={dialog} className="v2-diff-panel" role="dialog" aria-label="Changes between versions">
      <div className="v2-diff-head">
        <strong>
          {label(props.from)} → {label(props.to)}
        </strong>
        <div className="pv-segmented" role="radiogroup" aria-label="Show">
          {(['rendered', 'lines'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className="pv-seg"
              onClick={() => {
                setMode(m);
              }}
            >
              {m === 'rendered' ? 'As the page reads' : 'Lines'}
            </button>
          ))}
        </div>
        <button type="button" className="pv-link" onClick={props.onClose}>
          Close
        </button>
      </div>
      {mode === 'rendered' ? (
        texts ? (
          <RenderedDiff from={texts[0]} to={texts[1]} links={props.links} />
        ) : (
          <p className="pv-muted" role="status">
            Loading…
          </p>
        )
      ) : (
        <div className="pv-diff">
          {props.lines.map((l, i) =>
            l.op === 'same' ? (
              <div key={i} className="v2-diff-same">
                {l.text || ' '}
              </div>
            ) : (
              <div key={i} className={l.op === 'add' ? 'pv-ins' : 'pv-del'}>
                {(l.op === 'add' ? '+ ' : '− ') + l.text}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
