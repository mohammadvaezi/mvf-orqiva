// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-285 | S15 | v0.1.0] T29.7 Documents import (Markdown, Notion, Confluence) and export (Markdown, HTML, PDF, ZIP) ──
// ── [PCODE-284 | S15 | v0.1.0] T29.6 Documents: tree drag and drop, files, image annotation, read analytics, per-task knowledge, checked citations ──
// ── [PCODE-283 | S15 | v0.1.0] T29.5 Documents: named versions in the screen, visual diff, mentions in comments, page search and Cmd-K ──
// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
// ── [PCODE-280 | S15 | v0.1.0] T29.2 Block editor for documents: edit in place, insert menu, drag to reorder, paste images ──
// ── [PCODE-198 | S15 | v0.1.0] T16.2 Documenter agent: document tools with knowledge scopes, agent-written drafts, Ask the Documenter ──
// ── [PCODE-197 | S15 | v0.1.0] T16.1 Docs from code: API reference, system overview and built-by-task pages, drift warnings ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-171 | S15 | v0.1.0] B3.4 Documents live in the web app: page tree, Markdown pages with editor, versions and diff, comments, templates, knowledge, health ──
//    Why:  the Documents tab of the approved design on the server's wiki. The tree holds folders and
//          pages; a page reads as rendered Markdown and edits with a live preview, every save a version
//          that history, diff and restore work on. Comments sit on the passage they are about. Owners and
//          review dates mark stale pages, agent-written pages wait for a person's approval, broken links
//          show up in Health, and Knowledge says per agent what it may read and what it read.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { BlockEditor } from './blockeditor.js';
import { DiffPanel } from './docdiff.js'; // [PCODE-283 | S15 | v0.1.0]
import { ImportPanel, PageExports, zipHref } from './docio.js'; // [PCODE-285 | S15 | v0.1.0]
import { AnnotateDialog, dropTarget, PageFiles, PageReaders, TaskKnowledge } from './docside.js'; // [PCODE-284 | S15 | v0.1.0]
import { useLiveDoc } from './livedoc.js'; // [PCODE-282 | S15 | v0.1.0] // [PCODE-280 | S15 | v0.1.0]
import { Markdown, type MdLinks } from './markdown.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface DocNode {
  id: string;
  parentId: string | null;
  kind: string;
  title: string;
  rank: number;
  template: string;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  reviewBy: string | null;
  stale: boolean;
  agentWritten: boolean;
  approvedBy: string | null;
  needsApproval: boolean;
  generatedFrom: string;
  lockedBy: string | null;
  lockedByName: string | null;
  tags: string[];
  version: number;
  openComments: number;
  backlinks: number;
  updatedAt: string;
  clientVisible?: boolean; // [PCODE-186 | S15 | v0.1.0] shared with the project's client
  files?: { id: string; name: string; mime: string }[]; // [PCODE-284 | S15 | v0.1.0]
}
interface FullPage {
  page: DocNode;
  body: string;
  backlinks: { id: string; title: string }[];
  links: {
    toPageId: string | null;
    title: string | null;
    url: string;
    httpStatus: number | null;
    checkedAt: string | null;
  }[];
  watching: boolean;
  watchers: number;
}
interface Template {
  key: string;
  title: string;
  body: string;
}
interface Person {
  id: string;
  name: string;
}

/** Children per parent, each list in rank order; pages whose parent is gone sit at the top. */
export function treeOf(nodes: readonly DocNode[]): Map<string | null, DocNode[]> {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string | null, DocNode[]>();
  for (const n of nodes) {
    const p = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    out.set(p, [...(out.get(p) ?? []), n]);
  }
  for (const list of out.values())
    list.sort(
      (a, b) =>
        Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
        a.rank - b.rank ||
        a.title.localeCompare(b.title),
    );
  return out;
}

/** The folders and pages above a page, top first. */
export function pathOf(nodes: readonly DocNode[], id: string): DocNode[] {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const out: DocNode[] = [];
  let n = by.get(id);
  for (let i = 0; n?.parentId && i < 20; i++) {
    n = by.get(n.parentId);
    if (n) out.unshift(n);
  }
  return out;
}

type View = 'pages' | 'knowledge' | 'health';

export function DocumentsPage(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  canEdit: boolean;
  isAdmin: boolean;
  meId: string;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, projectId } = props;
  const [view, setView] = useState<View>('pages');
  const [nodes, setNodes] = useState<DocNode[] | null>(null);
  // [PCODE-283 | S15 | v0.1.0] a link may name the page (?page=…), as inbox entries and search hits do
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('page'),
  );
  const load = useCallback(async () => {
    const r = await api<DocNode[]>('GET', W(workspaceId, '/projects/' + projectId + '/docs'));
    if (r.ok) setNodes(r.data);
  }, [workspaceId, projectId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.projectid === projectId && e.data.changes && 'page' in e.data.changes) void load();
    });
  }, [load, props.hub, projectId]);
  const views: { key: View; label: string; icon: PIconName }[] = [
    { key: 'pages', label: 'Pages', icon: 'documents' },
    { key: 'knowledge', label: 'AI knowledge', icon: 'agents' },
    { key: 'health', label: 'Health', icon: 'check' },
  ];
  const health = (nodes ?? []).filter((n) => n.stale || n.needsApproval).length;
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="Documents view">
        {views.map((v) => (
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
            {v.key === 'health' && health ? (
              <span className="pv-subtab-count">{health}</span>
            ) : null}
          </button>
        ))}
      </nav>
      {/* [PCODE-198 | S15 | v0.1.0] the Documenter writes a page on request */}
      {view === 'pages' && props.canEdit ? (
        <AskDocumenter workspaceId={workspaceId} projectId={projectId} go={props.go} />
      ) : null}
      {/* [PCODE-285 | S15 | v0.1.0] bring a wiki in, take it out */}
      {view === 'pages' ? (
        <div className="v2-inline v2-doc-io">
          {props.canEdit ? (
            <ImportPanel
              workspaceId={workspaceId}
              projectId={projectId}
              folders={(nodes ?? [])
                .filter((n) => n.kind === 'folder')
                .map((n) => ({ id: n.id, title: n.title }))}
              onDone={(first) => {
                void load();
                if (first) setSelected(first);
              }}
            />
          ) : null}
          <a className="pv-link pv-small" href={zipHref(workspaceId, projectId)} download>
            Download the wiki (ZIP)
          </a>
        </div>
      ) : null}
      {view === 'pages' ? (
        <Pages
          workspaceId={workspaceId}
          projectId={projectId}
          nodes={nodes}
          selected={selected}
          canEdit={props.canEdit}
          isAdmin={props.isAdmin}
          meId={props.meId}
          hub={props.hub}
          onSelect={setSelected}
          onChanged={() => void load()}
          go={props.go}
        />
      ) : null}
      {view === 'knowledge' ? (
        <Knowledge
          workspaceId={workspaceId}
          projectId={projectId}
          nodes={nodes ?? []}
          isAdmin={props.isAdmin}
          onOpen={(id) => {
            setSelected(id);
            setView('pages');
          }}
        />
      ) : null}
      {view === 'health' ? (
        <Health
          workspaceId={workspaceId}
          projectId={projectId}
          nodes={nodes ?? []}
          canEdit={props.canEdit}
          onOpen={(id) => {
            setSelected(id);
            setView('pages');
          }}
        />
      ) : null}
    </div>
  );
}

function Pages(props: {
  workspaceId: string;
  projectId: string;
  nodes: DocNode[] | null;
  selected: string | null;
  canEdit: boolean;
  isAdmin: boolean;
  meId: string;
  hub: EventHub;
  onSelect: (id: string) => void;
  onChanged: () => void;
  go: (p: string) => void; // [PCODE-281 | S15 | v0.1.0]
}): ReactNode {
  const nodes = props.nodes ?? [];
  const [creating, setCreating] = useState(false);
  const firstPage = nodes.find((n) => n.kind === 'page')?.id ?? null;
  const current =
    nodes.find((n) => n.id === props.selected) ?? nodes.find((n) => n.id === firstPage) ?? null;
  return (
    <div className="pv-docs v2-docs">
      <DocTree
        workspaceId={props.workspaceId}
        projectId={props.projectId}
        nodes={nodes}
        selected={current?.id ?? null}
        canEdit={props.canEdit}
        onSelect={props.onSelect}
        onNew={() => {
          setCreating((c) => !c);
        }}
        onMove={(id, to) =>
          void api('PATCH', W(props.workspaceId, '/docs/' + id), {
            parentId: to.parentId,
            rank: to.rank,
          }).then(() => {
            props.onChanged();
          })
        }
      />
      <div className="pv-doc-main">
        {creating ? (
          <NewPage
            workspaceId={props.workspaceId}
            projectId={props.projectId}
            nodes={nodes}
            near={current}
            onDone={(id) => {
              setCreating(false);
              props.onChanged();
              if (id) props.onSelect(id);
            }}
          />
        ) : null}
        {current ? (
          <PageView
            key={current.id}
            workspaceId={props.workspaceId}
            projectId={props.projectId}
            node={current}
            nodes={nodes}
            canEdit={props.canEdit}
            isAdmin={props.isAdmin}
            meId={props.meId}
            hub={props.hub}
            onSelect={props.onSelect}
            onChanged={props.onChanged}
            go={props.go}
          />
        ) : (
          <Card>
            <div className="pv-empty">
              <PIcon name="documents" size={28} />
              <strong>{props.nodes ? 'No pages yet.' : 'Loading…'}</strong>
              <span>
                Start with a template: ADR, RFC, runbook, postmortem, meeting notes or API doc.
              </span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function DocTree(props: {
  workspaceId: string; // [PCODE-283 | S15 | v0.1.0]
  projectId: string;
  nodes: DocNode[];
  selected: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onMove: (id: string, to: { parentId: string | null; rank: number }) => void; // [PCODE-284 | S15 | v0.1.0]
}): ReactNode {
  // [PCODE-284 | S15 | v0.1.0] a page dragged onto another goes under it, onto the top edge of one before it
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; place: 'inside' | 'before' } | null>(null);
  const dnd = (n: DocNode) =>
    props.canEdit && !n.generatedFrom
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', n.id);
            setDragging(n.id);
          },
          onDragEnd: () => {
            setDragging(null);
            setDrop(null);
          },
          onDragOver: (e: React.DragEvent<HTMLElement>) => {
            if (!dragging || dragging === n.id) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const place = e.clientY - r.top < r.height * 0.35 ? 'before' : 'inside';
            if (drop?.id !== n.id || drop.place !== place) setDrop({ id: n.id, place });
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const to =
              dragging && drop ? dropTarget(props.nodes, dragging, n.id, drop.place) : null;
            if (dragging && to) props.onMove(dragging, to);
            setDragging(null);
            setDrop(null);
          },
        }
      : {};
  const dropClass = (n: DocNode): string =>
    drop?.id === n.id ? ' v2-tree-drop--' + drop.place : '';
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // [PCODE-283 | S15 | v0.1.0] the text of every page, with the passage that matches
  const [hits, setHits] = useState<{ id: string; title: string; snippet: string }[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void api<{ id: string; title: string; snippet: string }[]>(
        'GET',
        W(
          props.workspaceId,
          '/projects/' + props.projectId + '/docs/search?q=' + encodeURIComponent(term),
        ),
      ).then((r) => {
        setHits(r.ok ? r.data : []);
      });
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [q, props.workspaceId, props.projectId]);
  const tree = useMemo(() => treeOf(props.nodes), [props.nodes]);
  const match = (n: DocNode): boolean =>
    !q ||
    n.title.toLowerCase().includes(q.toLowerCase()) ||
    n.tags.some((t) => t.toLowerCase() === q.toLowerCase());
  const visible = (n: DocNode): boolean => match(n) || (tree.get(n.id) ?? []).some(visible);
  const walk = (parent: string | null, depth: number): ReactNode =>
    (tree.get(parent) ?? []).filter(visible).map((n) => {
      const open = !closed.has(n.id) || Boolean(q);
      const kids = tree.get(n.id) ?? [];
      return (
        <li key={n.id}>
          {n.kind === 'folder' ? (
            <button
              type="button"
              className={'pv-tree-folder' + dropClass(n)}
              aria-expanded={open}
              {...dnd(n)}
              onClick={() => {
                setClosed((c) => {
                  const x = new Set(c);
                  if (x.has(n.id)) x.delete(n.id);
                  else x.add(n.id);
                  return x;
                });
              }}
            >
              <PIcon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
              <PIcon name="projects" size={14} />
              <span>{n.title}</span>
              <span className="pv-muted pv-small">{kids.length}</span>
            </button>
          ) : (
            <button
              type="button"
              className={'pv-tree-item v2-depth-' + String(Math.min(depth, 4)) + dropClass(n)}
              aria-current={props.selected === n.id ? 'true' : undefined}
              {...dnd(n)}
              onClick={() => {
                props.onSelect(n.id);
              }}
            >
              <PIcon name="documents" size={14} />
              <span className="pv-tree-title">{n.title}</span>
              {n.stale ? <span className="pv-dot pv-dot--at-risk" title="Review overdue" /> : null}
              {n.needsApproval ? (
                <span title="Written by an agent, not yet approved">
                  <PIcon name="agents" size={12} />
                </span>
              ) : null}
              {n.generatedFrom ? (
                <span title={'Built from ' + n.generatedFrom}>
                  <PIcon name="ide" size={12} />
                </span>
              ) : null}
              {n.lockedBy ? (
                <span title={'Locked by ' + (n.lockedByName ?? 'someone')}>
                  <PIcon name="lock" size={12} />
                </span>
              ) : null}
            </button>
          )}
          {/* [PCODE-284 | S15 | v0.1.0] the page's files under it */}
          {n.kind === 'page' && n.files?.length ? (
            <ul className="v2-tree-files">
              {n.files.map((f) => (
                <li key={f.id}>
                  <a
                    href={W(props.workspaceId, '/files/' + f.id + '/content')}
                    target="_blank"
                    rel="noreferrer"
                    className={'v2-depth-' + String(Math.min(depth + 1, 4))}
                  >
                    <PIcon name={f.mime.startsWith('image/') ? 'uikit' : 'documents'} size={12} />
                    {f.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {open && kids.length ? <ul>{walk(n.id, depth + 1)}</ul> : null}
        </li>
      );
    });
  return (
    <aside className="pv-doc-tree" aria-label="Pages">
      <div className="pv-list-pane-head">
        <strong>Wiki</strong>
        {props.canEdit ? (
          <Button size="sm" kind="primary" icon="plus" onClick={props.onNew}>
            New
          </Button>
        ) : null}
      </div>
      <label className="pv-tree-search">
        <PIcon name="search" size={14} />
        <input
          value={q}
          placeholder="Search titles, tags and text"
          aria-label="Search pages"
          onChange={(e) => {
            setQ(e.target.value);
          }}
        />
      </label>
      <ul className="pv-tree">{walk(null, 0)}</ul>
      {hits.length ? (
        <div className="v2-doc-hits">
          <div className="pv-small pv-muted">In the text</div>
          <ul>
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  aria-current={props.selected === h.id ? 'true' : undefined}
                  onClick={() => {
                    props.onSelect(h.id);
                  }}
                >
                  <strong>{h.title}</strong>
                  <span>{snippetParts(h.snippet)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

/** [PCODE-283 | S15 | v0.1.0] A search passage with its matches («…») marked. */
export function snippetParts(snippet: string): ReactNode[] {
  return snippet
    .split(/(«[^»]*»)/)
    .map((p, i) =>
      p.startsWith('«') && p.endsWith('»') ? <mark key={i}>{p.slice(1, -1)}</mark> : p,
    );
}

function NewPage(props: {
  workspaceId: string;
  projectId: string;
  nodes: DocNode[];
  near: DocNode | null;
  onDone: (id: string | null) => void;
}): ReactNode {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('page');
  const [template, setTemplate] = useState('');
  const [parent, setParent] = useState(
    props.near ? (props.near.kind === 'folder' ? props.near.id : (props.near.parentId ?? '')) : '',
  );
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Template[]>('GET', W(props.workspaceId, '/doc-templates')).then((r) => {
      if (r.ok) setTemplates(r.data);
    });
  }, [props.workspaceId]);
  const folders = props.nodes.filter((n) => n.kind === 'folder');
  return (
    <Card title="New page">
      <form
        className="v2-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          void api<FullPage>(
            'POST',
            W(props.workspaceId, '/projects/' + props.projectId + '/docs'),
            {
              title: title.trim(),
              kind,
              ...(parent ? { parentId: parent } : {}),
              ...(kind === 'page' && template ? { template } : {}),
            },
          ).then((r) => {
            if (r.ok) props.onDone(r.data.page.id);
            else setError(r.error.message);
          });
        }}
      >
        <label className="v2-field">
          <span>What</span>
          <select
            className="v2-input"
            value={kind === 'folder' ? 'folder' : template}
            onChange={(e) => {
              if (e.target.value === 'folder') {
                setKind('folder');
                setTemplate('');
              } else {
                setKind('page');
                setTemplate(e.target.value);
              }
            }}
          >
            <option value="">Empty page</option>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.title.replace(/:\s*$/, '')} template
              </option>
            ))}
            <option value="folder">Folder</option>
          </select>
        </label>
        <label className="v2-field">
          <span>Title</span>
          <input
            className="v2-input"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            placeholder={template ? 'e.g. Use our own tile server' : 'Title'}
          />
        </label>
        <label className="v2-field">
          <span>In</span>
          <select
            className="v2-input"
            value={parent}
            onChange={(e) => {
              setParent(e.target.value);
            }}
          >
            <option value="">The top</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="v2-actions">
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!title.trim()}
          >
            Create
          </button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              props.onDone(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PageView(props: {
  workspaceId: string;
  projectId: string;
  node: DocNode;
  nodes: DocNode[];
  canEdit: boolean;
  isAdmin: boolean;
  meId: string;
  hub: EventHub;
  onSelect: (id: string) => void;
  onChanged: () => void;
  go: (p: string) => void; // [PCODE-281 | S15 | v0.1.0]
}): ReactNode {
  const D = (p: string): string => W(props.workspaceId, '/docs/' + props.node.id + p);
  const [page, setPage] = useState<FullPage | null>(null);
  const [editing, setEditing] = useState(false);
  // [PCODE-282 | S15 | v0.1.0] editing is joining the page's live draft: everyone editing sees the others' changes
  const live = useLiveDoc(props.workspaceId, props.node.id, editing, props.meId);
  const { title, body, setTitle, setBody } = live;
  const [source, setSource] = useState(false); // [PCODE-280 | S15 | v0.1.0] the whole page as Markdown
  const [error, setError] = useState('');
  const [side, setSide] = useState<
    'comments' | 'history' | 'links' | 'properties' | 'files' | 'readers'
  >('comments');
  const [annotating, setAnnotating] = useState<{ src: string; alt: string } | null>(null); // [PCODE-284 | S15 | v0.1.0]
  const [anchor, setAnchor] = useState('');
  const load = useCallback(async () => {
    const r = await api<FullPage>('GET', D(''));
    if (r.ok) setPage(r.data);
    else setError(r.error.message);
  }, [props.workspaceId, props.node.id]);
  useEffect(() => {
    void load();
  }, [load, props.node.version]);
  const links: MdLinks = {
    page: (t) => {
      const n = t.id
        ? props.nodes.find((x) => x.id === t.id)
        : props.nodes.find((x) => x.title.toLowerCase() === (t.title ?? '').toLowerCase());
      return n ? '#doc-' + n.id : null;
    },
    go: (p) => {
      props.onSelect(p.replace('#doc-', ''));
    },
    // [PCODE-281 | S15 | v0.1.0] embeds drawn live in the project
    embed: {
      workspaceId: props.workspaceId,
      projectId: props.projectId,
      hub: props.hub,
      open: props.go,
    },
  };
  const act = async (
    method: 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    path: string,
    b?: unknown,
  ): Promise<boolean> => {
    const r = await api<FullPage | { removed: number }>(method, D(path), b);
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      if ('page' in r.data) setPage(r.data);
    }
    props.onChanged();
    return r.ok;
  };
  if (!page) return <p className="pv-muted">{error || 'Loading…'}</p>;
  const n = page.page;
  const lockedByOther = Boolean(n.lockedBy && n.lockedBy !== props.meId);
  // [PCODE-197 | S15 | v0.1.0] a page built from the code changes in the code, then a rebuild
  const fromCode = n.generatedFrom !== '';
  const crumbs = pathOf(props.nodes, n.id);
  return (
    <div className="v2-doc">
      <article className="v2-doc-page">
        <div className="pv-doc-crumbs pv-muted pv-small">
          {crumbs.map((c) => c.title).join(' / ') || 'Wiki'}
        </div>
        <header className="pv-doc-head">
          {editing ? (
            <input
              className="pv-title-input"
              aria-label="Title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          ) : (
            <h2 className="pv-doc-title">{n.title}</h2>
          )}
          <div className="pv-page-actions">
            {n.kind === 'page' && props.canEdit && !editing && !fromCode ? (
              <Button
                size="sm"
                kind="primary"
                icon="documents"
                disabled={lockedByOther}
                title={
                  lockedByOther ? 'Locked by ' + (n.lockedByName ?? 'someone') : 'Edit the page'
                }
                onClick={() => {
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            ) : null}
            {editing ? (
              <>
                <Button
                  size="sm"
                  kind="primary"
                  icon="check"
                  disabled={live.state !== 'live'}
                  title="Saves the text everyone editing has written as the next version"
                  onClick={() =>
                    void live.save().then(async (v) => {
                      if (v === null) return;
                      setEditing(false);
                      await load();
                      props.onChanged();
                    })
                  }
                >
                  Save as version {n.version + 1}
                </Button>
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : null}
            {!editing && n.kind === 'page' ? (
              <PageExports workspaceId={props.workspaceId} pageId={n.id} />
            ) : null}
            {!editing ? (
              <Button
                size="sm"
                kind="ghost"
                icon="bell"
                onClick={() =>
                  void api<{ watching: boolean }>('POST', D('/watch')).then(() => load())
                }
              >
                {page.watching ? 'Watching' : 'Watch'}
              </Button>
            ) : null}
            {/* [PCODE-197 | S15 | v0.1.0] rebuild instead of edit */}
            {fromCode && props.canEdit ? (
              <Button
                size="sm"
                kind="primary"
                icon="ide"
                onClick={() =>
                  void rebuildFromCode(props.workspaceId, props.projectId).then((msg) => {
                    setError(msg.startsWith('Rebuilt') ? '' : msg);
                    void load();
                    props.onChanged();
                  })
                }
              >
                Rebuild from code
              </Button>
            ) : null}
            {!editing && props.canEdit && n.kind === 'page' && !fromCode ? (
              <Button
                size="sm"
                kind="ghost"
                icon="lock"
                disabled={lockedByOther && !props.isAdmin}
                onClick={() => void act('PATCH', '', { locked: !n.lockedBy })}
              >
                {n.lockedBy ? 'Unlock' : 'Lock'}
              </Button>
            ) : null}
            {/* [PCODE-186 | S15 | v0.1.0] a published page can be shared with the project's client */}
            {!editing && props.canEdit && n.kind === 'page' ? (
              <Button
                size="sm"
                kind="ghost"
                icon="clients"
                title={
                  n.status === 'published'
                    ? 'The client reads it under Documents in their portal'
                    : 'Clients see published pages only'
                }
                onClick={() =>
                  void api('PUT', D('/client'), { shared: !n.clientVisible }).then((r) => {
                    if (!r.ok) setError(r.error.message);
                    void load();
                    props.onChanged();
                  })
                }
              >
                {n.clientVisible ? 'Shared with the client' : 'Share with the client'}
              </Button>
            ) : null}
          </div>
        </header>
        <div className="pv-doc-props">
          <Chip
            tone={
              n.status === 'published'
                ? 'success'
                : n.status === 'in_review'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {n.status.replace('_', ' ')}
          </Chip>
          <span className="pv-muted pv-small">
            version {n.version} · owner {n.ownerName ?? '—'}
            {n.reviewBy ? ' · review by ' + n.reviewBy : ''}
          </span>
          {n.stale ? <Chip tone="danger">review overdue</Chip> : null}
          {n.lockedBy ? <Chip icon="lock">locked by {n.lockedByName ?? 'someone'}</Chip> : null}
          {n.tags.map((t) => (
            <Chip key={t}>#{t}</Chip>
          ))}
          {n.needsApproval ? (
            <span className="v2-inline">
              <Chip tone="agent" icon="agents">
                written by an agent
              </Chip>
              {props.canEdit ? (
                <Button size="sm" kind="primary" onClick={() => void act('POST', '/approve')}>
                  Approve
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
        {/* [PCODE-197 | S15 | v0.1.0] where the page comes from */}
        {fromCode && n.kind === 'page' ? (
          <div className="pv-callout">
            Built from the code ({n.generatedFrom}). Change the code and rebuild; edits here are not
            kept.
          </div>
        ) : null}
        {error ? (
          <p className="v2-error" role="alert">
            {error}{' '}
            {error.includes('changed since') ? (
              <button
                type="button"
                className="pv-link"
                onClick={() => {
                  setEditing(false);
                  setError('');
                  void load();
                }}
              >
                Reload
              </button>
            ) : null}
          </p>
        ) : null}
        {/* [PCODE-282 | S15 | v0.1.0] who else is editing, what could not be merged, a draft closed by someone's save */}
        {editing ? (
          <div className="v2-live-bar" role="status">
            {live.state === 'joining' ? (
              <span className="pv-muted pv-small">Opening the draft…</span>
            ) : null}
            {live.state === 'live' ? (
              <span className="pv-small">
                <span className="v2-live-dot" aria-hidden="true" />
                {live.others.length
                  ? live.others.join(', ') +
                    (live.others.length === 1 ? ' is' : ' are') +
                    ' editing too'
                  : 'Live: others who open the page edit with you'}
              </span>
            ) : null}
            {live.conflicts ? (
              <span className="pv-small v2-live-clash">
                {live.conflicts} {live.conflicts === 1 ? 'passage was' : 'passages were'} changed by
                two people at once; both versions are kept one after the other
              </span>
            ) : null}
            {live.state === 'closed' || live.state === 'error' ? (
              <span className="pv-small v2-error">
                {live.message}{' '}
                <button
                  type="button"
                  className="pv-link"
                  onClick={() => {
                    setEditing(false);
                    void load();
                  }}
                >
                  Reload
                </button>
              </span>
            ) : null}
          </div>
        ) : null}
        {editing ? (
          <div className="pv-segmented v2-editor-mode" role="radiogroup" aria-label="Editor">
            {(
              [
                [false, 'Blocks'],
                [true, 'Source'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={source === v}
                className="pv-seg"
                onClick={() => {
                  setSource(v);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {editing && !source ? (
          <BlockEditor
            body={body}
            onChange={setBody}
            workspaceId={props.workspaceId}
            projectId={props.projectId}
            links={links}
          />
        ) : editing ? (
          <div className="v2-editor-split">
            <textarea
              className="v2-input v2-mono v2-editor-text"
              aria-label="Page text (Markdown)"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
              }}
            />
            <div className="v2-editor-preview" aria-label="Preview">
              <Markdown text={body} links={links} />
            </div>
          </div>
        ) : n.kind === 'folder' ? (
          <p className="pv-muted">
            A folder. Its pages are in the tree.{' '}
            <a
              className="pv-link"
              href={zipHref(props.workspaceId, props.projectId, n.id)}
              download
            >
              Download it as a ZIP
            </a>
          </p>
        ) : (
          <div
            onClick={(e) => {
              // [PCODE-284 | S15 | v0.1.0] an image of the page opens to be drawn on
              const t = e.target;
              if (
                t instanceof HTMLImageElement &&
                t.classList.contains('v2-md-img') &&
                props.canEdit &&
                !fromCode &&
                !lockedByOther
              )
                setAnnotating({ src: t.getAttribute('src') ?? '', alt: t.alt });
            }}
            onMouseUp={() => {
              const sel = window.getSelection()?.toString().trim() ?? '';
              if (sel && sel.length <= 1000 && page.body.includes(sel)) {
                setAnchor(sel);
                setSide('comments');
              }
            }}
          >
            <Markdown text={page.body} links={links} />
          </div>
        )}
        {annotating ? (
          <AnnotateDialog
            workspaceId={props.workspaceId}
            projectId={props.projectId}
            src={annotating.src}
            alt={annotating.alt}
            onClose={() => {
              setAnnotating(null);
            }}
            onSaved={(md) => {
              // the annotated image takes the place of the first time the old one is shown
              const old = new RegExp(
                '!\\[[^\\]]*\\]\\(' + annotating.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)',
              );
              void act('PUT', '', {
                body: page.body.replace(old, md),
                baseVersion: n.version,
              }).then(() => {
                setAnnotating(null);
              });
            }}
          />
        ) : null}
      </article>
      <aside className="pv-doc-side">
        <div className="pv-side-tabs" role="tablist">
          {(
            [
              [
                'comments',
                'Comments' + (n.openComments ? ' (' + String(n.openComments) + ')' : ''),
              ],
              ['history', 'History'],
              ['links', 'Links (' + String(page.backlinks.length) + ' back)'],
              ['files', 'Files' + (n.files?.length ? ' (' + String(n.files.length) + ')' : '')],
              ['readers', 'Readers'],
              ['properties', 'Properties'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              className="pv-side-tab"
              aria-selected={side === k}
              onClick={() => {
                setSide(k);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        {side === 'comments' ? (
          <Comments
            workspaceId={props.workspaceId}
            pageId={n.id}
            canEdit={props.canEdit}
            meId={props.meId}
            anchor={anchor}
            onAnchor={setAnchor}
            onChanged={props.onChanged}
          />
        ) : null}
        {side === 'history' ? (
          <History
            workspaceId={props.workspaceId}
            pageId={n.id}
            links={links}
            version={n.version}
            canEdit={props.canEdit && !lockedByOther}
            onRestored={() => {
              void load();
              props.onChanged();
            }}
          />
        ) : null}
        {side === 'links' ? <Links page={page} onOpen={props.onSelect} /> : null}
        {side === 'files' ? (
          <PageFiles
            workspaceId={props.workspaceId}
            projectId={props.projectId}
            pageId={n.id}
            canEdit={props.canEdit && n.kind === 'page' && !fromCode && !lockedByOther}
            onInsert={(md) =>
              void act('PUT', '', {
                body: page.body.replace(/\s*$/, '') + '\n\n' + md + '\n',
                baseVersion: n.version,
              })
            }
            onChanged={props.onChanged}
          />
        ) : null}
        {side === 'readers' ? (
          <PageReaders workspaceId={props.workspaceId} pageId={n.id} version={n.version} />
        ) : null}
        {side === 'properties' ? (
          <TaskKnowledge workspaceId={props.workspaceId} pageId={n.id} canEdit={props.canEdit} />
        ) : null}
        {side === 'properties' ? (
          <Properties
            workspaceId={props.workspaceId}
            node={n}
            nodes={props.nodes}
            canEdit={props.canEdit}
            act={act}
          />
        ) : null}
      </aside>
    </div>
  );
}

interface Comment {
  id: string;
  anchor: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  resolved: boolean;
  createdAt: string;
}

function Comments(props: {
  workspaceId: string;
  pageId: string;
  canEdit: boolean;
  meId: string;
  anchor: string;
  onAnchor: (a: string) => void;
  onChanged: () => void;
}): ReactNode {
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const load = useCallback(async () => {
    const r = await api<Comment[]>(
      'GET',
      W(props.workspaceId, '/docs/' + props.pageId + '/comments'),
    );
    if (r.ok) setList(r.data);
  }, [props.workspaceId, props.pageId]);
  useEffect(() => {
    void load();
  }, [load]);
  const change = async (method: 'POST' | 'PATCH', path: string, b: unknown): Promise<void> => {
    await api(method, W(props.workspaceId, path), b);
    await load();
    props.onChanged();
  };
  return (
    <div className="pv-threads">
      {(list ?? []).map((c) => (
        <div key={c.id} className={'v2-thread' + (c.resolved ? ' v2-thread--done' : '')}>
          {c.anchor ? <div className="pv-thread-quote">“{c.anchor}”</div> : null}
          <div className="pv-thread-head pv-small">
            <strong>{c.authorName ?? 'Someone'}</strong>{' '}
            <span className="pv-muted">
              {new Date(c.createdAt).toLocaleString(fmtLocale(), {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
          </div>
          <p className="pv-small">{c.body}</p>
          {props.canEdit ? (
            <button
              type="button"
              className="pv-link pv-small"
              onClick={() =>
                void change('PATCH', '/doc-comments/' + c.id, { resolved: !c.resolved })
              }
            >
              {c.resolved ? 'Reopen' : 'Resolve'}
            </button>
          ) : null}
        </div>
      ))}
      {list && !list.length ? (
        <p className="pv-muted pv-small">
          No comments. Select a passage on the page to comment on it.
        </p>
      ) : null}
      {props.canEdit ? (
        <form
          className="v2-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void change('POST', '/docs/' + props.pageId + '/comments', {
              body: text.trim(),
              ...(props.anchor ? { anchor: props.anchor } : {}),
            }).then(() => {
              setText('');
              props.onAnchor('');
            });
          }}
        >
          {props.anchor ? (
            <div className="pv-thread-quote">
              On “{props.anchor.slice(0, 120)}”{' '}
              <button
                type="button"
                className="pv-mini-btn"
                aria-label="Comment on the whole page instead"
                onClick={() => {
                  props.onAnchor('');
                }}
              >
                ×
              </button>
            </div>
          ) : null}
          <textarea
            className="v2-input"
            rows={3}
            aria-label="Comment"
            placeholder={
              (props.anchor ? 'Your comment on this passage' : 'A comment on the page') +
              ' (@name tells someone)'
            }
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!text.trim()}
          >
            Comment
          </button>
        </form>
      ) : null}
    </div>
  );
}

interface Version {
  version: number;
  title: string;
  name: string;
  author: string | null;
  byAgent: boolean;
  createdAt: string;
  size: number;
}

function History(props: {
  workspaceId: string;
  pageId: string;
  links: MdLinks | null; // [PCODE-283 | S15 | v0.1.0]
  version: number;
  canEdit: boolean;
  onRestored: () => void;
}): ReactNode {
  const D = (p: string): string => W(props.workspaceId, '/docs/' + props.pageId + p);
  const [list, setList] = useState<Version[]>([]);
  const [diff, setDiff] = useState<{
    from: number;
    to: number;
    lines: { op: string; text: string }[];
  } | null>(null);
  const load = useCallback(async () => {
    const r = await api<Version[]>('GET', D('/versions'));
    if (r.ok) setList(r.data);
  }, [props.workspaceId, props.pageId]);
  useEffect(() => {
    void load();
  }, [load, props.version]);
  const [naming, setNaming] = useState<number | null>(null);
  const [name, setName] = useState('');
  const show = async (from: number, to: number): Promise<void> => {
    const r = await api<{ from: number; to: number; lines: { op: string; text: string }[] }>(
      'GET',
      D('/diff?from=' + String(from) + '&to=' + String(to)),
    );
    if (r.ok) setDiff(r.data);
  };
  return (
    <div className="pv-stack">
      <ul className="pv-rows pv-rows--tight">
        {list.map((v) => (
          <li key={v.version} className="pv-row pv-row--static">
            <span className="pv-mono pv-strong">v{v.version}</span>
            <span className="pv-row-main">
              {naming === v.version ? (
                <form
                  className="v2-inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void api('PATCH', D('/versions/' + String(v.version)), { name }).then(() => {
                      setNaming(null);
                      void load();
                    });
                  }}
                >
                  <input
                    className="v2-input"
                    aria-label={'Name of version ' + String(v.version)}
                    placeholder="e.g. Sent to the client"
                    value={name}
                    maxLength={120}
                    autoFocus
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                  />
                  <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
                    Keep
                  </button>
                </form>
              ) : (
                <span className="pv-row-title">{v.name ? '“' + v.name + '”' : v.title}</span>
              )}
              <span className="pv-row-sub">
                {v.byAgent ? 'an agent' : (v.author ?? 'someone')} ·{' '}
                {new Date(v.createdAt).toLocaleString(fmtLocale(), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </span>
            {v.version > 1 ? (
              <button
                type="button"
                className="pv-link pv-small"
                onClick={() => void show(v.version - 1, v.version)}
              >
                Changes
              </button>
            ) : null}
            {props.canEdit && naming !== v.version ? (
              <button
                type="button"
                className="pv-link pv-small"
                onClick={() => {
                  setNaming(v.version);
                  setName(v.name);
                }}
              >
                {v.name ? 'Rename' : 'Name'}
              </button>
            ) : null}
            {props.canEdit && v.version !== props.version ? (
              <button
                type="button"
                className="pv-link pv-small"
                onClick={() =>
                  void api('POST', D('/versions/' + String(v.version) + '/restore')).then(
                    props.onRestored,
                  )
                }
              >
                Restore
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {diff ? (
        <DiffPanel
          base={D('')}
          from={{ version: diff.from, name: list.find((v) => v.version === diff.from)?.name ?? '' }}
          to={{ version: diff.to, name: list.find((v) => v.version === diff.to)?.name ?? '' }}
          links={props.links}
          lines={diff.lines}
          onClose={() => {
            setDiff(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Links(props: { page: FullPage; onOpen: (id: string) => void }): ReactNode {
  const pages = props.page.links.filter((l) => l.toPageId);
  const web = props.page.links.filter((l) => l.url);
  return (
    <div className="pv-stack">
      <div>
        <h3 className="v2-h3">Linked from</h3>
        {props.page.backlinks.length ? (
          <ul className="pv-rows pv-rows--tight">
            {props.page.backlinks.map((b) => (
              <li key={b.id} className="pv-row pv-row--static">
                <button
                  type="button"
                  className="pv-link-btn"
                  onClick={() => {
                    props.onOpen(b.id);
                  }}
                >
                  {b.title}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-muted pv-small">No page links here yet.</p>
        )}
      </div>
      <div>
        <h3 className="v2-h3">Links to</h3>
        <ul className="pv-rows pv-rows--tight">
          {pages.map((l) => (
            <li key={l.toPageId} className="pv-row pv-row--static">
              <button
                type="button"
                className="pv-link-btn"
                onClick={() => {
                  props.onOpen(l.toPageId ?? '');
                }}
              >
                {l.title}
              </button>
            </li>
          ))}
          {web.map((l) => (
            <li key={l.url} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title v2-break">{l.url}</span>
              </span>
              {l.httpStatus === null ? (
                <Chip>not checked</Chip>
              ) : l.httpStatus === 0 || l.httpStatus >= 400 ? (
                <Chip tone="danger">{l.httpStatus || 'unreachable'}</Chip>
              ) : (
                <Chip tone="success">{l.httpStatus}</Chip>
              )}
            </li>
          ))}
          {!pages.length && !web.length ? <li className="pv-muted pv-small">No links.</li> : null}
        </ul>
      </div>
    </div>
  );
}

function Properties(props: {
  workspaceId: string;
  node: DocNode;
  nodes: DocNode[];
  canEdit: boolean;
  act: (m: 'PATCH' | 'DELETE', p: string, b?: unknown) => Promise<boolean>;
}): ReactNode {
  const n = props.node;
  const [people, setPeople] = useState<Person[]>([]);
  const [tags, setTags] = useState(n.tags.join(', '));
  useEffect(() => {
    void api<{ userId: string; name: string; role: string }[]>(
      'GET',
      W(props.workspaceId, '/members'),
    ).then((r) => {
      if (r.ok)
        setPeople(
          r.data.filter((m) => m.role !== 'guest').map((m) => ({ id: m.userId, name: m.name })),
        );
    });
  }, [props.workspaceId]);
  const dis = !props.canEdit;
  const folders = props.nodes.filter((x) => x.kind === 'folder' && x.id !== n.id);
  return (
    <div className="pv-props v2-props-col">
      <label>
        <span>Status</span>
        <select
          value={n.status}
          disabled={dis}
          onChange={(e) => void props.act('PATCH', '', { status: e.target.value })}
        >
          <option value="draft">draft</option>
          <option value="in_review">in review</option>
          <option value="published">published</option>
        </select>
      </label>
      <label>
        <span>Owner</span>
        <select
          value={n.ownerId ?? ''}
          disabled={dis}
          onChange={(e) => void props.act('PATCH', '', { ownerId: e.target.value || null })}
        >
          <option value="">Nobody</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Review by</span>
        <input
          type="date"
          value={n.reviewBy ?? ''}
          disabled={dis}
          onChange={(e) => void props.act('PATCH', '', { reviewBy: e.target.value || null })}
        />
      </label>
      <label>
        <span>In folder</span>
        <select
          value={n.parentId ?? ''}
          disabled={dis}
          onChange={(e) => void props.act('PATCH', '', { parentId: e.target.value || null })}
        >
          <option value="">The top</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Tags</span>
        <input
          value={tags}
          disabled={dis}
          placeholder="ops, api"
          onChange={(e) => {
            setTags(e.target.value);
          }}
          onBlur={() => {
            const next = [
              ...new Set(
                tags
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ].slice(0, 20);
            if (next.join() !== n.tags.join()) void props.act('PATCH', '', { tags: next });
          }}
        />
      </label>
      {n.template ? (
        <p className="pv-small pv-muted">
          From the {n.template} template{n.generatedFrom ? ' · built from ' + n.generatedFrom : ''}
        </p>
      ) : null}
      {props.canEdit ? (
        <Button size="sm" kind="danger" onClick={() => void props.act('DELETE', '')}>
          Remove {n.kind === 'folder' ? 'the folder and its pages' : 'the page'}
        </Button>
      ) : null}
    </div>
  );
}

interface KnowledgeData {
  scopes: {
    agentKey: string;
    pages: { id: string; title: string }[];
    tags: string[];
    readable: number;
  }[];
  reads: {
    agentKey: string;
    pageId: string | null;
    title: string | null;
    version: number | null;
    passage: string;
    runId: string | null;
    at: string;
    citedOk?: boolean | null; // [PCODE-284 | S15 | v0.1.0]
  }[];
}

function Knowledge(props: {
  workspaceId: string;
  projectId: string;
  nodes: DocNode[];
  isAdmin: boolean;
  onOpen: (id: string) => void;
}): ReactNode {
  const P = W(props.workspaceId, '/projects/' + props.projectId + '/knowledge');
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [agents, setAgents] = useState<{ key: string; name: string }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState('');
  const load = useCallback(async () => {
    const r = await api<KnowledgeData>('GET', P);
    if (r.ok) setData(r.data);
  }, [P]);
  useEffect(() => {
    void load();
    void api<{ key: string; name: string }[]>('GET', W(props.workspaceId, '/agents')).then((r) => {
      if (r.ok) setAgents(r.data.map((x) => ({ key: x.key, name: x.name })));
    });
  }, [load, props.workspaceId]);
  const scopeOf = (key: string) => data?.scopes.find((s) => s.agentKey === key);
  return (
    <div className="pv-split">
      <Card title="What each agent may read in this project" flush>
        <ul className="pv-rows">
          {agents.map((ag) => {
            const s = scopeOf(ag.key);
            return (
              <li key={ag.key} className="pv-row pv-row--static v2-question">
                <span className="pv-row-main">
                  <span className="pv-row-title">{ag.name}</span>
                  <span className="pv-row-sub pv-wrap">
                    {s
                      ? [...s.pages.map((p) => p.title), ...s.tags.map((t) => '#' + t)].join(', ') +
                        ' · ' +
                        String(s.readable) +
                        ' pages'
                      : 'Nothing: this agent reads no pages of the project'}
                  </span>
                  {editing === ag.key ? (
                    <span className="v2-form">
                      <span className="v2-switches">
                        {props.nodes
                          .filter((x) => x.kind === 'folder' || !x.parentId)
                          .map((x) => (
                            <label key={x.id} className="v2-switch">
                              <input
                                type="checkbox"
                                checked={pick.has(x.id)}
                                onChange={(e) => {
                                  setPick((p) => {
                                    const n = new Set(p);
                                    if (e.target.checked) n.add(x.id);
                                    else n.delete(x.id);
                                    return n;
                                  });
                                }}
                              />
                              <span>{x.title}</span>
                            </label>
                          ))}
                      </span>
                      <input
                        className="v2-input"
                        aria-label="Tags"
                        placeholder="Tags, e.g. ops, api"
                        value={tags}
                        onChange={(e) => {
                          setTags(e.target.value);
                        }}
                      />
                      <span className="v2-inline">
                        <Button
                          size="sm"
                          kind="primary"
                          onClick={() =>
                            void api('PUT', P + '/' + ag.key, {
                              pageIds: [...pick],
                              tags: tags
                                .split(',')
                                .map((t) => t.trim())
                                .filter(Boolean),
                            }).then(() => {
                              setEditing(null);
                              void load();
                            })
                          }
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          kind="ghost"
                          onClick={() => {
                            setEditing(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </span>
                    </span>
                  ) : null}
                </span>
                {props.isAdmin && editing !== ag.key ? (
                  <Button
                    size="sm"
                    kind="ghost"
                    onClick={() => {
                      setPick(new Set(s?.pages.map((p) => p.id) ?? []));
                      setTags(s?.tags.join(', ') ?? '');
                      setEditing(ag.key);
                    }}
                  >
                    Change
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="pv-muted pv-small pv-pad">
          A folder includes every page under it; a tag includes every page that carries it. Agents
          cite the passage they used; every read is logged.
        </p>
      </Card>
      <Card title="Recent reads" flush>
        <ul className="pv-rows pv-rows--tight">
          {(data?.reads ?? []).map((r, i) => (
            <li key={i} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">
                  {r.agentKey} read{' '}
                  {r.pageId ? (
                    <button
                      type="button"
                      className="pv-link-btn"
                      onClick={() => {
                        props.onOpen(r.pageId ?? '');
                      }}
                    >
                      {r.title}
                    </button>
                  ) : (
                    'a removed page'
                  )}
                  {r.version ? ' v' + String(r.version) : ''}
                </span>
                {r.passage ? (
                  <span
                    className={'v2-cite' + (r.citedOk === false ? ' v2-cite--wrong' : '')}
                    title={
                      r.citedOk === false
                        ? 'This passage is not on the page the agent read'
                        : r.citedOk
                          ? 'Found on the page'
                          : undefined
                    }
                  >
                    {r.citedOk === false ? '✗ ' : r.citedOk ? '✓ ' : ''}“{r.passage}”
                  </span>
                ) : null}
              </span>
              <span className="pv-small pv-muted">
                {new Date(r.at).toLocaleString(fmtLocale(), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </li>
          ))}
          {data && !data.reads.length ? (
            <li className="pv-row pv-muted">No agent has read a page yet.</li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}

// ── [PCODE-198 | S15 | v0.1.0] what the Documenter is asked to write ──
export type DocAsk = 'runbook' | 'architecture' | 'handover' | 'other';
export const DOC_ASKS: { key: DocAsk; label: string }[] = [
  { key: 'runbook', label: 'A runbook' },
  { key: 'architecture', label: 'The architecture page' },
  { key: 'handover', label: 'The handover readme' },
  { key: 'other', label: 'Something else' },
];

export function documenterInstruction(kind: DocAsk, note: string): string {
  const n = note.trim();
  const base: Record<DocAsk, string> = {
    runbook:
      'Write a runbook (a page titled "Runbook: …") for ' +
      (n || 'the operation the team needs most') +
      ': when to use it, the steps, how to check each one worked, and how to roll back.',
    architecture:
      'Write or update the page "Architecture": the parts of the system, how they talk to each other, where the data lives, and the decisions behind them. Start from the pages built from the code.',
    handover:
      'Write or update the page "Handover readme" for the client: what was built, how to run and deploy it, where the documentation is, known limits, and who to call.',
    other: n,
  };
  return (
    base[kind] +
    (kind !== 'other' && kind !== 'runbook' && n ? ' Also: ' + n : '') +
    ' Read the pages you may read first and name the repository files you describe.'
  );
}

function AskDocumenter(props: {
  workspaceId: string;
  projectId: string;
  go: (p: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocAsk>('runbook');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async (): Promise<void> => {
    setBusy(true);
    const agents = await api<{ id: string; key: string; enabled?: boolean }[]>(
      'GET',
      W(props.workspaceId, '/agents'),
    );
    const doc = agents.ok ? agents.data.find((a) => a.key === 'documenter') : undefined;
    if (!doc) {
      setBusy(false);
      setError(agents.ok ? 'This workspace has no Documenter agent' : agents.error.message);
      return;
    }
    const r = await api<{ id: string }>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/agent-runs'),
      { agentId: doc.id, instruction: documenterInstruction(kind, note) },
    );
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else props.go('/runs/' + r.data.id);
  };
  if (!open)
    return (
      <div className="v2-inline">
        <Button
          size="sm"
          icon="agents"
          onClick={() => {
            setOpen(true);
          }}
        >
          Ask the Documenter
        </Button>
        <span className="pv-muted pv-small">
          It reads the pages its knowledge allows and writes a draft for a person to approve.
        </span>
      </div>
    );
  return (
    <Card title="Ask the Documenter">
      <form
        className="pv-stack"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <label className="v2-field">
          <span>What to write</span>
          <select
            className="v2-input"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as DocAsk);
            }}
          >
            {DOC_ASKS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="v2-field">
          <span>{kind === 'runbook' ? 'For which operation' : 'Note (optional)'}</span>
          <input
            className="v2-input"
            value={note}
            maxLength={2000}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </label>
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="v2-inline">
          <Button
            kind="primary"
            size="sm"
            disabled={busy || (kind === 'other' && !note.trim())}
            onClick={() => void start()}
          >
            {busy ? 'Starting…' : 'Start the run'}
          </Button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ── [PCODE-197 | S15 | v0.1.0] rebuild the pages built from the code; says what changed ──
export async function rebuildFromCode(workspaceId: string, projectId: string): Promise<string> {
  const r = await api<{ created: number; updated: number; unchanged: number; removed: number }>(
    'POST',
    W(workspaceId, '/projects/' + projectId + '/docs/from-code'),
  );
  if (!r.ok) return r.error.message;
  const d = r.data;
  return d.created + d.updated + d.unchanged === 0
    ? 'Nothing to build yet: send a code scan, the OpenAPI document or fingerprints first'
    : 'Rebuilt: ' +
        [
          d.created ? String(d.created) + ' new' : '',
          d.updated ? String(d.updated) + ' changed' : '',
          d.unchanged ? String(d.unchanged) + ' unchanged' : '',
          d.removed ? String(d.removed) + ' removed' : '',
        ]
          .filter(Boolean)
          .join(', ');
}

export interface DriftPage {
  pageId: string;
  title: string;
  ownerName: string | null;
  refs: {
    path: string;
    line: number | null;
    state: 'changed' | 'gone';
    changedAt: string | null;
  }[];
}

/** What a drift row says: "src/a.ts:88 changed after the page", "src/b.ts is gone". */
export const driftText = (r: DriftPage['refs'][number]): string =>
  r.path +
  (r.line ? ':' + String(r.line) : '') +
  (r.state === 'gone' ? ' is gone' : ' changed after the page');

function Health(props: {
  workspaceId: string;
  projectId: string;
  nodes: DocNode[];
  canEdit: boolean;
  onOpen: (id: string) => void;
}): ReactNode {
  const [check, setCheck] = useState<{
    checked: number;
    broken: { pageId: string; title: string; url: string; httpStatus: number }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const stale = props.nodes.filter((n) => n.stale);
  const approval = props.nodes.filter((n) => n.needsApproval);
  // [PCODE-197 | S15 | v0.1.0] pages that disagree with the code, and the rebuild
  const [drift, setDrift] = useState<DriftPage[] | null>(null);
  const [made, setMade] = useState<Record<string, string>>({});
  const [built, setBuilt] = useState('');
  const fromCode = props.nodes.filter((n) => n.kind === 'page' && n.generatedFrom).length;
  useEffect(() => {
    void api<DriftPage[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/docs/drift'),
    ).then((r) => {
      if (r.ok) setDrift(r.data);
    });
  }, [props.workspaceId, props.projectId, props.nodes]);
  const makeTask = async (d: DriftPage): Promise<void> => {
    const r = await api<{ ref: string }>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/items'),
      {
        title: ('Bring "' + d.title + '" in line with the code').slice(0, 255),
        description:
          'The page disagrees with the code:\n\n' +
          d.refs.map((r) => '- ' + driftText(r)).join('\n') +
          '\n\nChange the page or the code.',
      },
    );
    if (r.ok) setMade({ ...made, [d.pageId]: r.data.ref });
  };
  const row = (n: DocNode, why: string): ReactNode => (
    <li key={n.id + why} className="pv-row pv-row--static">
      <span className="pv-row-main">
        <button
          type="button"
          className="pv-link-btn v2-left"
          onClick={() => {
            props.onOpen(n.id);
          }}
        >
          {n.title}
        </button>
        <span className="pv-row-sub">{why}</span>
      </span>
    </li>
  );
  return (
    <div className="pv-split pv-split--even">
      <Card title={'Review overdue · ' + String(stale.length)} flush>
        <ul className="pv-rows">
          {stale.map((n) =>
            row(n, 'review by ' + (n.reviewBy ?? '') + ' · owner ' + (n.ownerName ?? 'nobody')),
          )}
          {!stale.length ? (
            <li className="pv-row pv-muted">Every page is within its review date.</li>
          ) : null}
        </ul>
      </Card>
      {/* [PCODE-197 | S15 | v0.1.0] */}
      <Card title={'Disagrees with code · ' + String(drift?.length ?? 0)} flush>
        <ul className="pv-rows">
          {(drift ?? []).map((d) => (
            <li key={d.pageId} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <button
                  type="button"
                  className="pv-link-btn v2-left"
                  onClick={() => {
                    props.onOpen(d.pageId);
                  }}
                >
                  {d.title}
                </button>
                <span className="pv-row-sub">{d.refs.map(driftText).join(' · ')}</span>
              </span>
              {made[d.pageId] ? (
                <Chip tone="success">{made[d.pageId]}</Chip>
              ) : props.canEdit ? (
                <Button size="sm" onClick={() => void makeTask(d)}>
                  Make a task
                </Button>
              ) : null}
            </li>
          ))}
          {drift && !drift.length ? (
            <li className="pv-row pv-muted">
              No page names a file that changed after it or is gone.
            </li>
          ) : null}
        </ul>
      </Card>
      <Card
        title={'Built from the code · ' + String(fromCode)}
        flush
        action={
          props.canEdit ? (
            <Button
              size="sm"
              icon="ide"
              onClick={() =>
                void rebuildFromCode(props.workspaceId, props.projectId).then(setBuilt)
              }
            >
              Rebuild from code
            </Button>
          ) : null
        }
      >
        <p className="pv-muted pv-small pv-pad">
          {built ||
            'The API reference, the system overview and which task built which files, from the code scan, the OpenAPI document and the fingerprints.'}
        </p>
      </Card>
      <Card title={'Waiting for approval · ' + String(approval.length)} flush>
        <ul className="pv-rows">
          {approval.map((n) => row(n, 'written by an agent'))}
          {!approval.length ? (
            <li className="pv-row pv-muted">No agent-written page waits.</li>
          ) : null}
        </ul>
      </Card>
      <Card
        title="Links"
        flush
        action={
          props.canEdit ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api<{
                  checked: number;
                  broken: { pageId: string; title: string; url: string; httpStatus: number }[];
                }>(
                  'POST',
                  W(props.workspaceId, '/projects/' + props.projectId + '/docs/check-links'),
                ).then((r) => {
                  setBusy(false);
                  if (r.ok) setCheck(r.data);
                });
              }}
            >
              {busy ? 'Checking…' : 'Check links now'}
            </Button>
          ) : null
        }
      >
        {check ? (
          <ul className="pv-rows">
            {check.broken.map((b) => (
              <li key={b.pageId + b.url} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title v2-break">{b.url}</span>
                  <button
                    type="button"
                    className="pv-link-btn pv-small v2-left"
                    onClick={() => {
                      props.onOpen(b.pageId);
                    }}
                  >
                    on {b.title}
                  </button>
                </span>
                <Chip tone="danger">{b.httpStatus || 'unreachable'}</Chip>
              </li>
            ))}
            {!check.broken.length ? (
              <li className="pv-row pv-muted">{check.checked} links checked, none broken.</li>
            ) : null}
          </ul>
        ) : (
          <p className="pv-muted pv-small pv-pad">
            Web links on the pages are checked on demand; private addresses are not.
          </p>
        )}
      </Card>
    </div>
  );
}
