// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
// ── [PCODE-129 | S15 | v0.1.0] Import from Jira and Linear CSV exports ──
//    Why:  `orq import plane` moves a Plane project into Orqiva through Plane's public REST API only (the
//          key a user creates in Plane, read-only calls). It keeps to Plane's rate limit (at most 50
//          requests a minute, waiting out a 429), reads everything first, then sends it to the server in
//          chunks the server upserts, so a second run updates and an interrupted one resumes.
import type { Api } from '../loop/api.js';
import { htmlToText } from './html.js';

export interface PlaneSettings {
  baseUrl: string;
  workspace: string;
  apiKey: string;
}

export class PlaneError extends Error {}

interface Page<T> {
  results: T[];
  next_cursor?: string;
  next_page_results?: boolean;
}

export interface PlaneReaderOptions {
  fetchImpl?: typeof fetch;
  /** fewest milliseconds between two requests; 1200 = 50 a minute */
  spacingMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export class PlaneReader {
  private last = 0;
  requests = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly settings: PlaneSettings,
    private readonly opts: PlaneReaderOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private url(path: string): string {
    return (
      this.settings.baseUrl.replace(/\/$/, '') +
      '/api/v1/workspaces/' +
      this.settings.workspace +
      path
    );
  }

  async get<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + (this.opts.spacingMs ?? 1200) - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.last = Date.now();
      this.requests++;
      let res: Response;
      try {
        res = await this.fetchImpl(this.url(path), {
          headers: { 'X-API-Key': this.settings.apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        if (attempt < 3) {
          await this.sleep(2000 * (attempt + 1));
          continue;
        }
        throw new PlaneError(
          'Cannot reach Plane at ' +
            this.settings.baseUrl +
            ': ' +
            (e instanceof Error ? e.message : String(e)),
        );
      }
      if (res.status === 429 && attempt < 6) {
        const after = Number(res.headers.get('retry-after') ?? '') || 60;
        this.opts.log?.('Plane asks to slow down; waiting ' + String(after) + ' s');
        await this.sleep(after * 1000);
        continue;
      }
      if (res.status === 401 || res.status === 403)
        throw new PlaneError('Plane refused the API key (' + String(res.status) + ')');
      if (!res.ok) throw new PlaneError('Plane answered ' + String(res.status) + ' for ' + path);
      return (await res.json()) as T;
    }
  }

  /** Every page of a list; Plane lists answer either an array or a cursor page. */
  async all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const sep = path.includes('?') ? '&' : '?';
      const r = await this.get<Page<T> | T[]>(
        path + sep + 'per_page=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      );
      if (Array.isArray(r)) return [...out, ...r];
      out.push(...r.results);
      if (!r.next_page_results || !r.next_cursor) return out;
      cursor = r.next_cursor;
    }
  }
}

interface PProject {
  id: string;
  identifier: string;
  name: string;
  description?: string;
}
interface PState {
  id: string;
  name: string;
  group: string;
  color?: string;
}
interface PLabel {
  id: string;
  name: string;
  color?: string;
}
interface PMember {
  id: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}
interface PCycle {
  id: string;
  name: string;
  description?: string;
  start_date: string | null;
  end_date: string | null;
}
interface PIssue {
  id: string;
  sequence_id: number;
  name: string;
  description_html?: string;
  state: string;
  priority?: string | null;
  labels: string[];
  assignees?: string[];
  parent?: string | null;
  created_at: string;
  updated_at: string;
}
interface PComment {
  id: string;
  comment_html?: string;
  created_at: string;
  edited_at?: string | null;
  actor?: string;
  created_by?: string;
}
interface PActivity {
  id: string;
  created_at: string;
  verb: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  comment?: string | null;
  actor?: string;
}

const GROUPS = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'];
const day = (v: string | null | undefined): string | null => (v ? v.slice(0, 10) : null);
const cut = (v: string | null | undefined, n: number): string | null =>
  v == null ? null : v.slice(0, n);

export interface Bundle {
  project: { externalId: string; key: string; name: string; description: string };
  states: { externalId: string; name: string; group: string; color?: string }[];
  labels: { externalId: string; name: string; color?: string }[];
  sprints: {
    externalId: string;
    name: string;
    goal: string;
    startDate: string | null;
    endDate: string | null;
  }[];
  items: {
    externalId: string;
    sequence: number;
    title: string;
    description: string;
    stateExternalId: string;
    labelExternalIds: string[];
    sprintExternalId: string | null;
    parentExternalId: string | null;
    priority: string;
    /** [PCODE-129 | S15 | v0.1.0] story points, when the tool keeps them */
    estimate?: number | null;
    assigneeEmails: string[];
    createdAt: string;
    updatedAt: string;
  }[];
  comments: {
    externalId: string;
    itemExternalId: string;
    body: string;
    author: string;
    authorEmail?: string;
    createdAt: string;
    editedAt: string | null;
  }[];
  history: {
    externalId: string;
    itemExternalId: string;
    at: string;
    actor: string;
    verb: string;
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    note: string | null;
  }[];
}

/** Reads one Plane project, by its identifier (PCODE), into the shape the server imports. */
export async function readPlaneProject(
  reader: PlaneReader,
  identifier: string,
  log: (l: string) => void = () => undefined,
): Promise<Bundle> {
  const projects = await reader.all<PProject>('/projects/');
  const p = projects.find((x) => x.identifier.toUpperCase() === identifier.toUpperCase());
  if (!p)
    throw new PlaneError(
      'No Plane project ' +
        identifier.toUpperCase() +
        ' (found: ' +
        projects.map((x) => x.identifier).join(', ') +
        ')',
    );
  const base = '/projects/' + p.id;
  const [states, labels, members, cycles, issues] = [
    await reader.all<PState>(base + '/states/'),
    await reader.all<PLabel>(base + '/labels/'),
    await reader.all<PMember>('/members/'),
    await reader.all<PCycle>(base + '/cycles/'),
    await reader.all<PIssue>(base + '/issues/'),
  ];
  log(
    'Plane ' +
      p.identifier +
      ': ' +
      String(issues.length) +
      ' issues, ' +
      String(cycles.length) +
      ' cycles',
  );
  const person = new Map(members.map((m) => [m.id, m]));
  const nameOf = (id: string | undefined): string => {
    const m = id ? person.get(id) : undefined;
    return m
      ? m.display_name ||
          [m.first_name, m.last_name].filter(Boolean).join(' ') ||
          m.email ||
          'Plane user'
      : 'Plane';
  };

  // an issue in several cycles belongs to the latest one
  const cycleOf = new Map<string, PCycle>();
  for (const c of [...cycles].sort((a, b) =>
    (a.start_date ?? '').localeCompare(b.start_date ?? ''),
  )) {
    for (const i of await reader.all<{ id: string }>(base + '/cycles/' + c.id + '/cycle-issues/'))
      cycleOf.set(i.id, c);
  }

  const bundle: Bundle = {
    project: {
      externalId: p.id,
      key: p.identifier.toUpperCase(),
      name: p.name.slice(0, 120),
      description: p.description ?? '',
    },
    states: states.map((s) => ({
      externalId: s.id,
      name: s.name.slice(0, 60),
      group: GROUPS.includes(s.group) ? s.group : 'backlog',
      ...(s.color ? { color: s.color } : {}),
    })),
    labels: labels.map((l) => ({
      externalId: l.id,
      name: l.name.slice(0, 60),
      ...(l.color ? { color: l.color } : {}),
    })),
    sprints: cycles.map((c) => ({
      externalId: c.id,
      name: c.name.slice(0, 120),
      goal: (c.description ?? '').slice(0, 5000),
      startDate: day(c.start_date),
      endDate: day(c.end_date),
    })),
    items: [],
    comments: [],
    history: [],
  };

  let n = 0;
  for (const i of [...issues].sort((a, b) => a.sequence_id - b.sequence_id)) {
    bundle.items.push({
      externalId: i.id,
      sequence: i.sequence_id,
      title: (i.name.trim() || '(untitled)').slice(0, 255),
      description: htmlToText(i.description_html).slice(0, 100_000),
      stateExternalId: i.state,
      labelExternalIds: i.labels,
      sprintExternalId: cycleOf.get(i.id)?.id ?? null,
      parentExternalId: i.parent ?? null,
      priority: i.priority ?? 'none',
      assigneeEmails: (i.assignees ?? []).flatMap((a) => person.get(a)?.email ?? []),
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    });
    for (const c of await reader.all<PComment>(base + '/issues/' + i.id + '/comments/')) {
      const who = person.get(c.actor ?? c.created_by ?? '');
      bundle.comments.push({
        externalId: c.id,
        itemExternalId: i.id,
        body: htmlToText(c.comment_html),
        author: nameOf(c.actor ?? c.created_by),
        ...(who?.email ? { authorEmail: who.email } : {}),
        createdAt: c.created_at,
        editedAt: c.edited_at ?? null,
      });
    }
    for (const h of await reader.all<PActivity>(base + '/issues/' + i.id + '/activities/')) {
      bundle.history.push({
        externalId: h.id,
        itemExternalId: i.id,
        at: h.created_at,
        actor: nameOf(h.actor).slice(0, 200),
        verb: (h.verb || 'updated').slice(0, 60),
        field: cut(h.field, 100),
        oldValue: cut(h.old_value, 2000),
        newValue: cut(h.new_value, 2000),
        note: cut(h.comment, 2000),
      });
    }
    if (++n % 20 === 0) log('read ' + String(n) + ' of ' + String(issues.length) + ' issues');
  }
  return bundle;
}

export interface ImportCounts {
  states: number;
  labels: number;
  sprints: number;
  items: number;
  comments: number;
  history: number;
}

/** Chunks of at most `size` entries and about `maxBytes` of JSON: the server takes 1 MB a request. */
export function chunks<T>(list: T[], size: number, maxBytes = 600_000): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const x of list) {
    const b = Buffer.byteLength(JSON.stringify(x));
    if (cur.length && (cur.length >= size || bytes + b > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(x);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Sends a bundle to the server in chunks: the frame first, then items (twice: parents), comments, history. */
export async function sendBundle(
  api: Api,
  workspaceId: string,
  b: Bundle,
  intoProjectId: string | undefined,
  log: (l: string) => void = () => undefined,
): Promise<{ projectId: string; counts: ImportCounts }> {
  const path = '/api/workspaces/' + workspaceId + '/import/plane';
  const head = { project: b.project, ...(intoProjectId ? { intoProjectId } : {}) };
  const total: ImportCounts = {
    states: 0,
    labels: 0,
    sprints: 0,
    items: 0,
    comments: 0,
    history: 0,
  };
  let projectId = '';
  const send = async (part: Partial<Bundle>): Promise<void> => {
    const r = await api.call<{ projectId: string; counts: ImportCounts }>(
      'POST',
      path,
      { ...head, ...part },
      120_000,
    );
    projectId = r.projectId;
    for (const k of Object.keys(total) as (keyof ImportCounts)[]) total[k] += r.counts[k];
  };
  await send({ states: b.states, labels: b.labels, sprints: b.sprints });
  for (const c of chunks(b.items, 200)) await send({ items: c });
  // a parent can sit in a later chunk than its child: the children once more, now every parent exists
  const withParent = b.items.filter((i) => i.parentExternalId);
  for (const c of chunks(withParent, 200)) {
    await send({ items: c });
    total.items -= c.length;
  }
  log('sent ' + String(b.items.length) + ' items');
  for (const c of chunks(b.comments, 500)) await send({ comments: c });
  for (const c of chunks(b.history, 1000)) await send({ history: c });
  log(
    'sent ' +
      String(b.comments.length) +
      ' comments and ' +
      String(b.history.length) +
      ' history entries',
  );
  return { projectId, counts: total };
}
