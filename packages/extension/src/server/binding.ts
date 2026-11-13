// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
//    Why:  VS Code plans for someone: it reads and sets the project's client (or that it is internal), takes the
//          client's requests into the project or makes one from the description, writes them where Claude reads
//          them (description/requests.md), and links the published tasks to the requests the plan names.
//          Free of vscode, so it is tested against a fake server.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeApi } from '../../../cli/src/loop/api';
import { projectFile } from '../state/files';
import type { PlanJson } from '../state/types';
import type { PlanTarget } from './planSync';

export interface BindingRequest {
  id: string;
  ref: string;
  kind: string;
  title: string;
  state: string;
  text: string;
  inProject: boolean;
  items: { id: string; ref: string }[];
}

export interface Binding {
  client: { id: string; name: string } | null;
  internal: boolean;
  requests: BindingRequest[];
}

/** What the user chose on the Home tab: the client (an existing one, a new one, or none) and the requests. */
export interface BindingChoice {
  clientId?: string;
  newClient?: string;
  internal?: boolean;
  requestIds: string[];
  /** make a request of the client from the description */
  fromDescription?: boolean;
}

export const REQUESTS_FILE = ['description', 'requests.md'] as const;
export const BINDING_FILE = ['description', 'binding.json'] as const;

type Target = Omit<PlanTarget, 'root'>;
const api = (t: Target, fetchImpl?: typeof fetch) => makeApi(t.server, t.token, fetchImpl);
const ws = (t: Target): string => '/api/workspaces/' + t.workspaceId;

export async function loadBinding(t: Target, fetchImpl?: typeof fetch): Promise<Binding> {
  return api(t, fetchImpl).call<Binding>('GET', ws(t) + '/projects/' + t.projectId + '/binding');
}

export async function listClients(
  t: Target,
  fetchImpl?: typeof fetch,
): Promise<{ id: string; name: string }[]> {
  const all = await api(t, fetchImpl).call<
    { id: string; name: string; archivedAt?: string | null }[]
  >('GET', ws(t) + '/clients');
  return all.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, name: c.name }));
}

/** The first line of the description, as a request's title. */
export function requestTitle(description: string): string {
  const line =
    description
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, '').trim())
      .find((l) => l && l.toLowerCase() !== 'project description') ?? 'The project';
  return line.length > 120 ? line.slice(0, 117) + '…' : line;
}

// ── [PCODE-467 | S15 | v0.1.0] applyBinding: the choice on the server, then the files Claude reads ──
export async function applyBinding(
  t: PlanTarget,
  choice: BindingChoice,
  description: string,
  fetchImpl?: typeof fetch,
): Promise<Binding> {
  const a = api(t, fetchImpl);
  let clientId = choice.clientId ?? null;
  if (!clientId && choice.newClient?.trim())
    clientId = (
      await a.call<{ id: string }>('POST', ws(t) + '/clients', { name: choice.newClient.trim() })
    ).id;
  const internal = !clientId && choice.internal === true;
  let b = await a.call<Binding>('PUT', ws(t) + '/projects/' + t.projectId + '/binding', {
    clientId,
    internal,
  });
  if (clientId) {
    for (const id of choice.requestIds) {
      const r = b.requests.find((x) => x.id === id);
      if (r && !r.inProject)
        b = await a.call<Binding>(
          'POST',
          ws(t) + '/projects/' + t.projectId + '/binding/requests',
          {
            requestId: id,
          },
        );
    }
    if (choice.fromDescription && description.trim()) {
      const made = await a.call<{ id: string }>('POST', ws(t) + '/client-requests', {
        kind: 'feature',
        title: requestTitle(description),
        body: description.slice(0, 20_000),
        clientId,
        projectId: t.projectId,
      });
      b = await loadBinding(t, fetchImpl);
      if (!b.requests.find((x) => x.id === made.id)?.inProject)
        b = await a.call<Binding>(
          'POST',
          ws(t) + '/projects/' + t.projectId + '/binding/requests',
          {
            requestId: made.id,
          },
        );
    }
  }
  writeBindingFiles(t.root, b);
  return b;
}

/** binding.json (for whom, checked before planning) and requests.md (what Claude maps the tasks to). */
export function writeBindingFiles(root: string, b: Binding): void {
  const file = projectFile(root, BINDING_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        client: b.client,
        internal: b.internal,
        requests: b.requests.filter((r) => r.inProject).map((r) => ({ id: r.id, ref: r.ref })),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  fs.writeFileSync(projectFile(root, REQUESTS_FILE), requestsMarkdown(b), 'utf8');
}

export function readBindingFile(root: string): {
  client: { id: string; name: string } | null;
  internal: boolean;
  requests: { id: string; ref: string }[];
} | null {
  try {
    return JSON.parse(fs.readFileSync(projectFile(root, BINDING_FILE), 'utf8')) as never;
  } catch {
    return null;
  }
}

export function requestsMarkdown(b: Binding): string {
  const mine = b.requests.filter((r) => r.inProject);
  if (b.internal || !b.client)
    return '# For whom\n\nAn internal project: no client asked for it. Leave every task\'s "requests" empty.\n';
  const out = [
    '# For whom: ' + b.client.name,
    '',
    'The plan answers these requests of the client. Give every task the refs of the requests it serves',
    '(plan.json: "requests": ["F-1"]). A task no request asks for - foundation, tooling - gets [] and its',
    'description says why it is needed.',
    '',
  ];
  for (const r of mine) out.push('## ' + r.ref + ' ' + r.title, '', r.text || '(no text)', '');
  if (!mine.length) out.push('(No request is planned for this project yet.)', '');
  return out.join('\n');
}

// ── [PCODE-467 | S15 | v0.1.0] linkPlanRequests: every published task linked to the requests the plan names ──
export async function linkPlanRequests(
  t: Target,
  plan: PlanJson,
  fetchImpl?: typeof fetch,
): Promise<{ linked: number; unknown: string[] }> {
  const a = api(t, fetchImpl);
  const [b, items] = await Promise.all([
    loadBinding(t, fetchImpl),
    a.call<{ id: string; title: string }[]>('GET', ws(t) + '/projects/' + t.projectId + '/items'),
  ]);
  const byRef = new Map(
    b.requests.filter((r) => r.inProject).map((r) => [r.ref.toUpperCase(), r.id]),
  );
  const byTitle = new Map(items.map((i) => [i.title.trim().toLowerCase(), i.id]));
  const r = { linked: 0, unknown: [] as string[] };
  for (const it of plan.sprints.flatMap((s) => s.items)) {
    const refs = (it as { requests?: unknown }).requests;
    if (!Array.isArray(refs)) continue;
    const id = byTitle.get(it.title.trim().toLowerCase());
    if (!id) continue;
    const ids = refs
      .filter((x): x is string => typeof x === 'string')
      .map((x) => {
        const found = byRef.get(x.toUpperCase());
        if (!found) r.unknown.push(x);
        return found;
      })
      .filter((x): x is string => Boolean(x));
    await a.call('PUT', ws(t) + '/items/' + id + '/requests', { requestIds: [...new Set(ids)] });
    r.linked++;
  }
  return r;
}
