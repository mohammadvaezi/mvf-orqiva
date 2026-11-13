// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
// ── [PCODE-280 | S15 | v0.1.0] T29.2 Block editor for documents: edit in place, insert menu, drag to reorder, paste images ──
//    Why:  editing a page block by block: what is not being edited reads as the page; one block at a time
//          is its Markdown in a text field that grows with it. New blocks come from a menu (or "/" in an
//          empty block) and live only in the editor until they are kept, so an empty one never touches
//          the page; blocks move by dragging their handle or with Alt+arrows, and a pasted or dropped
//          image is uploaded and placed where the cursor is.
import { merge3 } from '@orqiva/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PIcon } from '../preview/picons.js';
import {
  BLOCK_KINDS,
  imageMarkdown,
  joinBlocks,
  moveBlock,
  replaceBlock,
  slashKinds,
  splitBlocks,
  type BlockKind,
} from './blockedit.js';
import { uploadFile } from './files.js';
import { Markdown, type MdLinks } from './markdown.js';

function KindMenu(props: {
  kinds: readonly BlockKind[];
  onPick: (k: BlockKind) => void;
  onClose: () => void;
}): ReactNode {
  return (
    <ul className="v2-blk-menu" role="menu" aria-label="Insert a block">
      {props.kinds.map((k) => (
        <li key={k.key} role="none">
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => {
              // keep the text field from closing before the pick
              e.preventDefault();
            }}
            onClick={() => {
              props.onPick(k);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') props.onClose();
            }}
          >
            <strong>{k.label}</strong>
            <span>{k.hint}</span>
          </button>
        </li>
      ))}
      {!props.kinds.length ? <li className="v2-blk-menu-none">No block of that name</li> : null}
    </ul>
  );
}

/** What is open: one block being edited, or a new block after a place (-1 is the top). */
/** [PCODE-282 | S15 | v0.1.0] an edited block remembers its text when opened, as others may change the page meanwhile */
type Open = { edit: number; orig?: string } | { after: number } | null;

/**
 * The page's blocks with the open block kept. When others changed the page while it was open, the block
 * is found again by its text (blocks above may have come or gone); when the block itself was changed, the
 * two edits are merged.
 */
export function keep(blocks: readonly string[], open: Open, draft: string): string[] {
  if (!open) return [...blocks];
  if ('edit' in open) {
    const orig = open.orig;
    if (orig === undefined || blocks[open.edit] === orig)
      return replaceBlock(blocks, open.edit, draft);
    const found = blocks
      .map((b, i) => (b === orig ? i : -1))
      .filter((i) => i >= 0)
      .sort((x, y) => Math.abs(x - open.edit) - Math.abs(y - open.edit))[0];
    if (found !== undefined) return replaceBlock(blocks, found, draft);
    const theirs = blocks[open.edit];
    if (theirs === undefined) return [...blocks, ...splitBlocks(draft)];
    return replaceBlock(blocks, open.edit, merge3(orig, draft, theirs).text);
  }
  const at = open.after + 1;
  return [...blocks.slice(0, at), ...splitBlocks(draft), ...blocks.slice(at)];
}

export function BlockEditor(props: {
  body: string;
  onChange: (body: string) => void;
  workspaceId: string;
  projectId: string;
  links: MdLinks | null;
}): ReactNode {
  const blocks = splitBlocks(props.body);
  const [open, setOpen] = useState<Open>(blocks.length ? null : { after: -1 });
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement | null>(null);
  const caret = useRef<number | null>(null);

  // the field grows with its text and takes the cursor where a template wants it
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = String(el.scrollHeight + 2) + 'px';
    if (caret.current !== null) {
      el.focus();
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [draft, open]);

  /** Keeps the open block, closes it and returns the page's blocks. */
  const commit = (): string[] => {
    const next = keep(blocks, open, draft);
    if (open) props.onChange(joinBlocks(next));
    setOpen(null);
    setDraft('');
    return next;
  };
  const start = (o: Open, text: string, cursor?: number): void => {
    setOpen(o);
    setDraft(text);
    caret.current = cursor ?? text.length;
  };
  /** Opens block i after keeping the open one, which may have added or removed blocks before it. */
  const reopen = (i: number, text: string): void => {
    const before = open ? ('edit' in open ? open.edit : open.after) : Infinity;
    const kept = commit();
    const at = before < i ? i + kept.length - blocks.length : i;
    start({ edit: at, orig: kept[at] ?? text }, kept[at] ?? text);
  };
  const upload = async (file: File, pos: number): Promise<void> => {
    const name = file.name || 'screenshot.png';
    const r = await uploadFile(
      props.workspaceId,
      props.projectId,
      new File([file], name, { type: file.type }),
    );
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    const md = imageMarkdown(props.workspaceId, r.data.id, name);
    setDraft((d) => d.slice(0, pos) + md + d.slice(pos));
    caret.current = pos + md.length;
  };
  const slash = open ? slashKinds(draft) : null;
  const pickSlash = (k: BlockKind): void => {
    setDraft(k.template);
    caret.current = k.cursor;
  };

  const editor = (label: string, index: number | null): ReactNode => (
    <>
      <textarea
        ref={field}
        className="v2-input v2-mono v2-blk-field"
        aria-label={label}
        placeholder="Type, or / for a block"
        value={draft}
        rows={1}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={() => {
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Enter' && slash?.[0]) {
            e.preventDefault();
            pickSlash(slash[0]);
          } else if (index !== null && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const to = e.key === 'ArrowUp' ? index - 1 : index + 1;
            if (to < 0 || to >= blocks.length) return;
            const next = moveBlock(replaceBlock(blocks, index, draft), index, to);
            props.onChange(joinBlocks(next));
            start({ edit: to, orig: next[to] ?? '' }, next[to] ?? '');
          }
        }}
        onPaste={(e) => {
          const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
          if (!file) return;
          e.preventDefault();
          void upload(file, e.currentTarget.selectionStart);
        }}
        onDrop={(e) => {
          const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
          if (!file) return;
          e.preventDefault();
          void upload(file, e.currentTarget.selectionStart);
        }}
      />
      {slash ? (
        <KindMenu
          kinds={slash}
          onPick={pickSlash}
          onClose={() => {
            setDraft('');
          }}
        />
      ) : (
        <p className="v2-blk-help">
          Markdown · a blank line starts a new block · Esc keeps it
          {index !== null ? ' · Alt+↑↓ moves it' : ''} · paste an image to add it
        </p>
      )}
    </>
  );
  const fresh = (after: number): ReactNode =>
    open && 'after' in open && open.after === after ? (
      <div className="v2-blk v2-blk--editing">
        <div className="v2-blk-gutter" />
        <div className="v2-blk-body">{editor('New block (Markdown)', null)}</div>
      </div>
    ) : null;

  return (
    <div className="v2-blocks">
      {fresh(-1)}
      {blocks.map((b, i) => {
        const editing = open !== null && 'edit' in open && open.edit === i;
        return (
          <div key={String(i) + ':' + b.slice(0, 24)}>
            <div
              className={
                'v2-blk' +
                (editing ? ' v2-blk--editing' : '') +
                (over === i && dragging !== null && dragging !== i ? ' v2-blk--drop' : '')
              }
              onDragOver={(e) => {
                if (dragging === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                if (dragging === null) return;
                e.preventDefault();
                if (dragging !== i) props.onChange(joinBlocks(moveBlock(blocks, dragging, i)));
                setDragging(null);
                setOver(null);
              }}
            >
              <div className="v2-blk-gutter">
                <button
                  type="button"
                  className="v2-blk-handle"
                  draggable={open === null}
                  aria-label={'Move block ' + String(i + 1)}
                  title="Drag to move"
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(i));
                    setDragging(i);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  ⋮⋮
                </button>
                <button
                  type="button"
                  className="v2-blk-add"
                  aria-label={'Insert a block after block ' + String(i + 1)}
                  aria-expanded={menu === i}
                  title="Insert a block below"
                  onClick={() => {
                    setMenu(menu === i ? null : i);
                  }}
                >
                  <PIcon name="plus" size={12} />
                </button>
              </div>
              <div className="v2-blk-body">
                {editing ? (
                  editor('Block ' + String(i + 1) + ' (Markdown)', i)
                ) : (
                  <div
                    className="v2-blk-view"
                    role="button"
                    tabIndex={0}
                    aria-label={'Edit block ' + String(i + 1)}
                    onClick={(e) => {
                      // links inside a block still work
                      if (e.target instanceof HTMLElement && e.target.closest('a')) return;
                      reopen(i, b);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') reopen(i, b);
                    }}
                  >
                    <Markdown text={b} links={props.links} />
                  </div>
                )}
                {menu === i ? (
                  <KindMenu
                    kinds={BLOCK_KINDS}
                    onPick={(k) => {
                      setMenu(null);
                      commit();
                      start({ after: i }, k.template, k.cursor);
                    }}
                    onClose={() => {
                      setMenu(null);
                    }}
                  />
                ) : null}
              </div>
            </div>
            {fresh(i)}
          </div>
        );
      })}
      <div className="v2-blk-end">
        <button
          type="button"
          className="pv-link-btn"
          onClick={() => {
            const kept = commit();
            start({ after: kept.length - 1 }, '');
          }}
        >
          <PIcon name="plus" size={12} /> Add a block
        </button>
        <span className="pv-muted pv-small">
          or type / in it for headings, lists, callouts, code, math and diagrams
        </span>
      </div>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
