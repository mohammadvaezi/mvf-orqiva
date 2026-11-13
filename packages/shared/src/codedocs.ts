// ── [PCODE-197 | S15 | v0.1.0] T16.1 Docs from code: API reference, system overview and built-by-task pages, drift warnings ──
//    Why:  documentation built from what the server knows about the repository, the same on every rebuild:
//          the API reference from the OpenAPI inventory, a system overview from the code scan, and which
//          task built which files from the fingerprints. And the other way round: a page written by hand
//          that names repo files says so when one of them changed after the page, or is gone.
import { isRepoPath } from './live.js';
import { codeHealth, hotspots } from './posture.js';

/** A page built from the code: a stable key per source, so a rebuild updates the same page. */
export interface CodePage {
  key: string;
  title: string;
  body: string;
  /** what it was built from, shown on the page */
  from: string;
}

export interface CodeEndpoint {
  kind: string;
  method: string;
  path: string;
  summary: string;
  auth: string;
  tag: string;
  /** the task behind it (PCODE-12), when known */
  ref: string | null;
}

export interface CodeFileFacts {
  path: string;
  language: string;
  lines: number;
  complexity: number;
  churn: number;
  authors: Record<string, number>;
  agentShare: number;
}

export interface CodeMark {
  ref: string;
  title: string;
  sprint: string;
  path: string;
  line: number;
  kind: string;
}

/** Pages stay below the page size limit; a cut is said in the text. */
export const CODE_PAGE_MAX = 400_000;

const cell = (v: string): string => v.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '–';
const cut = (body: string): string =>
  body.length <= CODE_PAGE_MAX
    ? body
    : body.slice(0, CODE_PAGE_MAX) + '\n\n_The rest is cut: the page holds 400,000 characters._\n';
const keyOf = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'general';

/** One API reference page per tag (endpoints without a tag go to "General"). */
export function apiReferencePages(endpoints: readonly CodeEndpoint[]): CodePage[] {
  const byTag = new Map<string, CodeEndpoint[]>();
  for (const e of endpoints) {
    const t = e.tag.trim() || 'General';
    byTag.set(t, [...(byTag.get(t) ?? []), e]);
  }
  return [...byTag.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, list]) => {
      const rows = [...list].sort(
        (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
      );
      const http = rows.filter((e) => e.kind === 'http');
      const other = rows.filter((e) => e.kind !== 'http');
      const lines = [
        '# ' + tag + ' API (from code)',
        '',
        String(rows.length) +
          (rows.length === 1 ? ' entry' : ' entries') +
          ', built from the project’s OpenAPI document and code scan. Change the code and rebuild; edits here are not kept.',
        '',
      ];
      if (http.length) {
        lines.push(
          '| Method | Path | Auth | What it does | Task |',
          '| --- | --- | --- | --- | --- |',
        );
        for (const e of http)
          lines.push(
            '| ' +
              [
                e.method || '–',
                '`' + e.path + '`',
                cell(e.auth),
                cell(e.summary),
                e.ref ?? '–',
              ].join(' | ') +
              ' |',
          );
        lines.push('');
      }
      if (other.length) {
        lines.push(
          '## Events and tables',
          '',
          '| Kind | Name | What it is | Task |',
          '| --- | --- | --- | --- |',
        );
        for (const e of other)
          lines.push(
            '| ' + [e.kind, '`' + e.path + '`', cell(e.summary), e.ref ?? '–'].join(' | ') + ' |',
          );
        lines.push('');
      }
      return {
        key: 'api:' + keyOf(tag),
        title: tag + ' API (from code)',
        body: cut(lines.join('\n')),
        from: 'OpenAPI (' + String(rows.length) + (rows.length === 1 ? ' entry)' : ' entries)'),
      };
    });
}

/** The folder of a path at a depth: packages/web/src/app.tsx at depth 2 is packages/web. */
const folderAt = (path: string, depth: number): string => {
  const parts = path.split('/');
  return parts.length <= 1 ? '(root)' : parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
};
const n = (v: number): string => v.toLocaleString('de-DE');

/** The system overview: folders two levels deep, their size, languages, owners and hot spots. */
export function systemOverviewPage(files: readonly CodeFileFacts[]): CodePage | null {
  if (!files.length) return null;
  const folders = new Map<string, CodeFileFacts[]>();
  for (const f of files) {
    const k = folderAt(f.path, 2);
    folders.set(k, [...(folders.get(k) ?? []), f]);
  }
  const rows = [...folders.entries()]
    .map(([folder, list]) => {
      const lines = list.reduce((x, f) => x + f.lines, 0);
      const langs = new Map<string, number>();
      const owners = new Map<string, number>();
      for (const f of list) {
        if (f.language) langs.set(f.language, (langs.get(f.language) ?? 0) + f.lines);
        for (const [who, c] of Object.entries(f.authors))
          owners.set(who, (owners.get(who) ?? 0) + c);
      }
      const top = (m: Map<string, number>, k: number): string =>
        [...m.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, k)
          .map(([x]) => x)
          .join(', ');
      const agent = lines ? list.reduce((x, f) => x + f.agentShare * f.lines, 0) / lines : 0;
      const health = lines ? list.reduce((x, f) => x + codeHealth(f) * f.lines, 0) / lines : 10;
      return {
        folder,
        files: list.length,
        lines,
        langs: top(langs, 3),
        owners: top(owners, 2),
        agent,
        health,
      };
    })
    .sort((a, b) => b.lines - a.lines || a.folder.localeCompare(b.folder));
  const total = files.reduce((x, f) => x + f.lines, 0);
  const hot = hotspots(files)
    .filter((f) => f.hotspot >= 50)
    .sort((a, b) => b.hotspot - a.hotspot || a.path.localeCompare(b.path))
    .slice(0, 10);
  const id = (v: string): string => 'f_' + v.replace(/[^A-Za-z0-9]/g, '_');
  const tops = [...new Set(rows.map((r) => r.folder.split('/')[0] ?? r.folder))].sort();
  const out = [
    '# System overview (from code)',
    '',
    n(files.length) +
      ' files and ' +
      n(total) +
      ' lines in ' +
      String(rows.length) +
      ' folders, from the latest code scan. Change the code and rebuild; edits here are not kept.',
    '',
    '## Outline',
    '',
    '```mermaid',
    'flowchart LR',
  ];
  for (const t of tops) {
    const kids = rows.filter((r) => (r.folder.split('/')[0] ?? r.folder) === t && r.folder !== t);
    if (!kids.length) {
      out.push('  ' + id(t) + '["' + t + '"]');
      continue;
    }
    out.push('  subgraph ' + id(t) + '["' + t + '"]');
    for (const k of kids)
      out.push(
        '    ' +
          id(k.folder) +
          '["' +
          k.folder.slice(t.length + 1) +
          ' · ' +
          n(k.lines) +
          ' lines"]',
      );
    out.push('  end');
  }
  out.push(
    '```',
    '',
    '## Folders',
    '',
    '| Folder | Files | Lines | Languages | Owners | Agent share | Health |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of rows)
    out.push(
      '| ' +
        [
          '`' + r.folder + '`',
          n(r.files),
          n(r.lines),
          cell(r.langs),
          cell(r.owners),
          String(Math.round(r.agent * 100)) + ' %',
          r.health.toFixed(1).replace('.', ','),
        ].join(' | ') +
        ' |',
    );
  out.push('');
  if (hot.length) {
    out.push(
      '## Hot spots',
      '',
      'Files changed often and complex: the first places to read, test and simplify.',
      '',
    );
    for (const f of hot)
      out.push(
        '- `' + f.path + '`: ' + n(f.churn) + ' changes in 90 days, complexity ' + n(f.complexity),
      );
    out.push('');
  }
  return {
    key: 'code:overview',
    title: 'System overview (from code)',
    body: cut(out.join('\n')),
    from: 'code scan (' + n(files.length) + ' files)',
  };
}

/** Which task built which files: per sprint, each task with the files and lines its fingerprints mark. */
export function builtByTaskPage(marks: readonly CodeMark[]): CodePage | null {
  if (!marks.length) return null;
  const sprints = new Map<string, Map<string, CodeMark[]>>();
  for (const m of marks) {
    const s = sprints.get(m.sprint) ?? new Map<string, CodeMark[]>();
    s.set(m.ref, [...(s.get(m.ref) ?? []), m]);
    sprints.set(m.sprint, s);
  }
  const num = (ref: string): number => Number(/(\d+)$/.exec(ref)?.[1] ?? 0);
  const tasks = new Set(marks.map((m) => m.ref)).size;
  const out = [
    '# Built by task (from code)',
    '',
    String(tasks) +
      ' tasks marked in the code with fingerprints. Change the code and rebuild; edits here are not kept.',
    '',
  ];
  for (const [sprint, byTask] of [...sprints.entries()].sort(([a], [b]) => b.localeCompare(a))) {
    out.push('## ' + (sprint || 'No sprint'), '');
    for (const [ref, list] of [...byTask.entries()].sort(
      ([a], [b]) => num(a) - num(b) || a.localeCompare(b),
    )) {
      out.push('### ' + ref + ' ' + (list[0]?.title ?? ''), '');
      const files = new Map<string, number[]>();
      for (const m of list) files.set(m.path, [...(files.get(m.path) ?? []), m.line]);
      for (const [path, lines] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b)))
        out.push('- `' + path + '` lines ' + [...new Set(lines)].sort((a, b) => a - b).join(', '));
      out.push('');
    }
  }
  return {
    key: 'code:tasks',
    title: 'Built by task (from code)',
    body: cut(out.join('\n')),
    from: 'fingerprints (' + String(tasks) + ' tasks)',
  };
}

/** All pages built from the code, in the order the folder shows them. */
export function codePages(input: {
  endpoints: readonly CodeEndpoint[];
  files: readonly CodeFileFacts[];
  marks: readonly CodeMark[];
}): CodePage[] {
  return [
    systemOverviewPage(input.files),
    ...apiReferencePages(input.endpoints),
    builtByTaskPage(input.marks),
  ].filter((p): p is CodePage => p !== null);
}

export interface CodeRef {
  path: string;
  line: number | null;
}

/** Repo files a page names (`src/x.ts`, src/x.ts:88), not web addresses; each path once, first line kept. */
export function codeRefs(markdown: string): CodeRef[] {
  const re =
    /(?:^|[\s(`'"[])((?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,8})(?::(\d+))?(?=$|[\s)`'",;:.\]])/gm;
  const seen = new Map<string, CodeRef>();
  for (const m of markdown.matchAll(re)) {
    const path = m[1] ?? '';
    if (!isRepoPath(path) || seen.has(path)) continue;
    seen.set(path, { path, line: m[2] ? Number(m[2]) : null });
  }
  return [...seen.values()];
}

export interface DriftRef extends CodeRef {
  state: 'changed' | 'gone';
  /** when the file last changed (ISO), for a changed one */
  changedAt: string | null;
}

/**
 * Where a page disagrees with the code: a named file that changed after the page was last written or
 * approved, or that the code scan no longer has. Without a scan nothing is known, so nothing is flagged.
 */
export function driftOf(
  refs: readonly CodeRef[],
  writtenAt: Date,
  files: ReadonlyMap<string, Date | null>,
): DriftRef[] {
  if (!files.size) return [];
  const out: DriftRef[] = [];
  for (const r of refs) {
    if (!files.has(r.path)) {
      out.push({ ...r, state: 'gone', changedAt: null });
      continue;
    }
    const at = files.get(r.path);
    if (at && at.getTime() > writtenAt.getTime())
      out.push({ ...r, state: 'changed', changedAt: at.toISOString() });
  }
  return out;
}
