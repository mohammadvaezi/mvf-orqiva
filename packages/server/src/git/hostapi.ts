// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
// ── [PCODE-288 | S15 | v0.1.0] T30.2 Design tokens exported as a pull request (GitHub, Gitea) ──
//    Why:  the server writes to a repository only through the host's API, with the token an admin gave the
//          connection: a branch from the default branch, the files that changed (a file whose text is
//          the same is left alone), and a pull request. GitHub and Gitea differ only in how a branch is
//          made, how a file is created, and the word before the token.
export type HostKind = 'github' | 'gitea';

export interface HostConnection {
  provider: HostKind;
  repo: string;
  /** https://api.github.com, or a Gitea server's https://git.example.com/api/v1 */
  apiUrl: string;
  token: string;
}

export interface PullResult {
  branch: string;
  base: string;
  number: number | null;
  url: string;
  changed: string[];
}

export class HostError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The API address of a connection: GitHub's, or the one given for a self-hosted host. */
export function apiBase(provider: HostKind, apiUrl: string | null): string | null {
  if (apiUrl) return apiUrl.replace(/\/+$/, '');
  return provider === 'github' ? 'https://api.github.com' : null;
}

/** Plain http only to this machine (a local Gitea, or a test); everything else is https. */
export function apiUrlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'is not an address';
  }
  if (u.username || u.password) return 'cannot hold a user or password';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
    return null;
  return 'must be https (plain http only to this machine)';
}

const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

/** Opens a pull request that writes `files` on a new branch; null when no file would change. */
export async function openPullRequest(
  conn: HostConnection,
  files: readonly { path: string; text: string }[],
  pr: {
    branch: string;
    title: string;
    body: string;
    message: string;
    // [PCODE-333 | S15 | v0.1.0] who the commits are by; the token's owner when left out
    identity?: { name: string; email: string };
  },
  fetchImpl: typeof fetch = fetch,
): Promise<PullResult | null> {
  const repoUrl = conn.apiUrl + '/repos/' + conn.repo;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T | null> => {
    const r = await fetchImpl(repoUrl + path, {
      method,
      headers: {
        authorization: (conn.provider === 'github' ? 'Bearer ' : 'token ') + conn.token,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'user-agent': 'Orqiva',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 404 && method === 'GET') return null;
    if (!r.ok) {
      const why = await r.text().catch(() => '');
      let msg = '';
      try {
        const m = (JSON.parse(why) as { message?: unknown }).message;
        msg = typeof m === 'string' ? m : '';
      } catch {
        msg = why.slice(0, 200);
      }
      throw new HostError(
        (r.status === 401 || r.status === 403
          ? 'The host refused the token'
          : 'The host answered ' + String(r.status)) + (msg ? ': ' + msg : ''),
        r.status,
      );
    }
    return (await r.json()) as T;
  };

  const repo = await call<{ default_branch?: string }>('GET', '');
  if (!repo) throw new HostError('The host does not know ' + conn.repo, 404);
  const base = repo.default_branch ?? 'main';

  // only files whose text differs on the default branch
  type Content = { sha?: string; content?: string; encoding?: string };
  const changed: { path: string; text: string; sha: string | null }[] = [];
  for (const f of files) {
    const now = await call<Content>(
      'GET',
      '/contents/' + encodePath(f.path) + '?ref=' + encodeURIComponent(base),
    );
    const old =
      now?.content !== undefined
        ? Buffer.from(now.content.replace(/\s/g, ''), 'base64').toString('utf8')
        : null;
    if (old !== f.text) changed.push({ ...f, sha: now?.sha ?? null });
  }
  if (!changed.length) return null;

  if (conn.provider === 'github') {
    const ref = await call<{ object?: { sha?: string } }>(
      'GET',
      '/git/ref/heads/' + encodePath(base),
    );
    const sha = ref?.object?.sha;
    if (!sha) throw new HostError('The default branch ' + base + ' has no commit', 409);
    await call('POST', '/git/refs', { ref: 'refs/heads/' + pr.branch, sha });
  } else await call('POST', '/branches', { new_branch_name: pr.branch, old_branch_name: base });

  for (const f of changed) {
    const body = {
      message: pr.message,
      content: Buffer.from(f.text, 'utf8').toString('base64'),
      branch: pr.branch,
      ...(f.sha ? { sha: f.sha } : {}),
      ...(pr.identity ? { author: pr.identity, committer: pr.identity } : {}),
    };
    // GitHub writes both with PUT; Gitea creates with POST and updates with PUT
    await call(
      conn.provider === 'gitea' && !f.sha ? 'POST' : 'PUT',
      '/contents/' + encodePath(f.path),
      body,
    );
  }
  const pull = await call<{ number?: number; html_url?: string }>('POST', '/pulls', {
    title: pr.title,
    head: pr.branch,
    base,
    body: pr.body + changed.map((f) => '- `' + f.path + '`').join('\n') + '\n',
  });
  return {
    branch: pr.branch,
    base,
    number: pull?.number ?? null,
    url: pull?.html_url ?? '',
    changed: changed.map((f) => f.path),
  };
}

// [PCODE-324 | S15 | v0.1.0] a file of the default branch, to fix it; null when the repository has none
export async function readRepoFile(
  conn: HostConnection,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; base: string } | null> {
  const get = async <T>(p: string): Promise<T | null> => {
    const r = await fetchImpl(conn.apiUrl + '/repos/' + conn.repo + p, {
      headers: {
        authorization: (conn.provider === 'github' ? 'Bearer ' : 'token ') + conn.token,
        accept: 'application/json',
        'user-agent': 'Orqiva',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 404) return null;
    if (!r.ok)
      throw new HostError(
        r.status === 401 || r.status === 403
          ? 'The host refused the token'
          : 'The host answered ' + String(r.status),
        r.status,
      );
    return (await r.json()) as T;
  };
  const repo = await get<{ default_branch?: string }>('');
  if (!repo) throw new HostError('The host does not know ' + conn.repo, 404);
  const base = repo.default_branch ?? 'main';
  const file = await get<{ content?: string }>(
    '/contents/' + encodePath(path) + '?ref=' + encodeURIComponent(base),
  );
  if (file?.content === undefined) return null;
  return { text: Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8'), base };
}
