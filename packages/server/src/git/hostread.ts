// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
// ── [PCODE-301 | S15 | v0.1.0] T31.2b Git history backfill through the hosts' APIs; branches and tags in the Repositories screen ──
//    Why:  the webhooks tell what happens from now on; what happened before is read once through the host's
//          API with the connection's token: the default branch and its recent commits, every branch and tag,
//          the recent pull requests. Each host answers in its own shape; the answers are turned into the
//          shape GitHub's webhooks have, so the same code keeps them.
import { HostError } from './hostapi.js';
import { azureMergeState, gitlabMergeState, type Provider } from './hosts.js'; // [PCODE-304 | S15 | v0.1.0]

export interface ReadConn {
  provider: Provider;
  repo: string;
  token: string;
  /** the host's API address; GitHub's, GitLab.com's and Azure DevOps' are known */
  apiUrl: string | null;
}

export interface RepoHistory {
  defaultBranch: string;
  branches: { name: string; sha: string }[];
  tags: { name: string; sha: string }[];
  /** commits of the default branch, oldest first, in a GitHub push's shape */
  commits: Record<string, unknown>[];
  /** pull requests in a GitHub webhook's shape */
  pulls: Record<string, unknown>[];
}

export const READ_LIMITS = { commits: 500, pulls: 200, refs: 1000 };

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The API address of a host when none is given; Gitea has none (it is always self-hosted). */
export function readBase(provider: Provider, apiUrl: string | null): string | null {
  if (apiUrl) return apiUrl.replace(/\/+$/, '');
  if (provider === 'github') return 'https://api.github.com';
  if (provider === 'gitlab') return 'https://gitlab.com/api/v4';
  if (provider === 'azure') return 'https://dev.azure.com';
  return null;
}

const authOf = (conn: ReadConn): Record<string, string> =>
  conn.provider === 'github'
    ? { authorization: 'Bearer ' + conn.token }
    : conn.provider === 'gitea'
      ? { authorization: 'token ' + conn.token }
      : conn.provider === 'gitlab'
        ? { 'private-token': conn.token }
        : { authorization: 'Basic ' + Buffer.from(':' + conn.token).toString('base64') };

// [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files
//   the authenticated reads, shared with the reading of a pull request's files
export interface HostClient {
  base: string;
  get: (url: string) => Promise<unknown>;
  /** a raw answer (a diff, a file's content) */
  text: (url: string) => Promise<string>;
  // [PCODE-303 | S15 | v0.1.0] a write (a review, a comment, a vote); the answer's JSON, or null when empty
  send: (method: 'POST' | 'PUT' | 'PATCH', url: string, body: unknown) => Promise<unknown>;
}

export function hostClient(conn: ReadConn, fetchImpl: typeof fetch = fetch): HostClient {
  const base = readBase(conn.provider, conn.apiUrl);
  if (!base)
    throw new HostError(
      'A Gitea connection needs its API address, e.g. https://git.example.com/api/v1',
      409,
    );
  const answer = async (
    url: string,
    accept: string,
    write?: { method: string; body: unknown },
  ): Promise<Response> => {
    const r = await fetchImpl(url, {
      // [PCODE-303 | S15 | v0.1.0] writes carry a JSON body
      ...(write ? { method: write.method, body: JSON.stringify(write.body) } : {}),
      headers: {
        ...authOf(conn),
        accept,
        'user-agent': 'Orqiva',
        ...(write ? { 'content-type': 'application/json' } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new HostError('The host cannot be reached', 502);
    });
    if (!r.ok) {
      const why = (await r.text().catch(() => '')).slice(0, 200);
      throw new HostError(
        (r.status === 401 || r.status === 403
          ? 'The host refused the token'
          : r.status === 404
            ? 'The host does not know ' + conn.repo + ', or the token cannot see it'
            : 'The host answered ' + String(r.status)) +
          (why && r.status !== 404 ? ': ' + why : ''),
        r.status,
      );
    }
    return r;
  };
  return {
    base,
    get: async (url) => (await answer(url, 'application/json')).json(),
    text: async (url) => (await answer(url, 'text/plain, */*')).text(),
    // [PCODE-303 | S15 | v0.1.0]
    send: async (method, url, body) => {
      const raw = await (await answer(url, 'application/json', { method, body })).text();
      return raw ? (JSON.parse(raw) as unknown) : null;
    },
  };
}

export async function readHistory(
  conn: ReadConn,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoHistory> {
  const { base, get } = hostClient(conn, fetchImpl);
  /** pages of a list until it ends or the limit is reached */
  const pages = async (
    url: (page: number) => string,
    limit: number,
    pick: (body: unknown) => unknown[] = arr,
  ): Promise<unknown[]> => {
    const out: unknown[] = [];
    for (let page = 1; out.length < limit && page <= 50; page += 1) {
      const items = pick(await get(url(page)));
      out.push(...items);
      if (!items.length || conn.provider === 'azure') break; // Azure answers with $top in one go
    }
    return out.slice(0, limit);
  };

  if (conn.provider === 'github' || conn.provider === 'gitea') {
    const repo = base + '/repos/' + conn.repo;
    const gh = conn.provider === 'github';
    const size = (n: number) => (gh ? 'per_page=' + String(n) : 'limit=' + String(Math.min(n, 50)));
    const info = obj(await get(repo));
    const main = str(info['default_branch']) || 'main';
    const refs = (path: string) =>
      pages((p) => repo + path + '?' + size(100) + '&page=' + String(p), READ_LIMITS.refs).then(
        (l) =>
          l.map((x) => {
            const c = obj(obj(x)['commit']);
            return {
              name: str(obj(x)['name']),
              sha: (str(c['sha']) || str(c['id'])).toLowerCase(),
            };
          }),
      );
    const commits = await pages(
      (p) =>
        repo + '/commits?sha=' + encodeURIComponent(main) + '&' + size(100) + '&page=' + String(p),
      READ_LIMITS.commits,
    );
    const pulls = await pages(
      (p) =>
        repo +
        '/pulls?state=all&' +
        size(100) +
        '&page=' +
        String(p) +
        (gh ? '&sort=updated&direction=desc' : ''),
      READ_LIMITS.pulls,
    );
    return {
      defaultBranch: main,
      branches: await refs('/branches'),
      tags: await refs('/tags'),
      commits: commits.reverse().map((raw) => {
        const c = obj(raw);
        const inner = obj(c['commit']);
        const author = obj(inner['author']);
        return {
          id: str(c['sha']).toLowerCase(),
          message: str(inner['message']),
          url: str(c['html_url']),
          timestamp: str(author['date']),
          author: { name: str(author['name']), username: str(obj(c['author'])['login']) },
        };
      }),
      // GitHub's list has merged_at but no merged flag (its webhooks have both)
      pulls: pulls.map((x) => {
        const pr = obj(x);
        return { ...pr, merged: pr['merged'] === true || Boolean(str(pr['merged_at'])) };
      }),
    };
  }

  if (conn.provider === 'gitlab') {
    const project = base + '/projects/' + encodeURIComponent(conn.repo);
    const info = obj(await get(project));
    const main = str(info['default_branch']) || 'main';
    const refs = (path: string) =>
      pages((p) => project + path + '?per_page=100&page=' + String(p), READ_LIMITS.refs).then((l) =>
        l.map((x) => ({
          name: str(obj(x)['name']),
          sha: str(obj(obj(x)['commit'])['id']).toLowerCase(),
        })),
      );
    const commits = await pages(
      (p) =>
        project +
        '/repository/commits?ref_name=' +
        encodeURIComponent(main) +
        '&per_page=100&page=' +
        String(p),
      READ_LIMITS.commits,
    );
    const mrs = await pages(
      (p) =>
        project + '/merge_requests?state=all&order_by=updated_at&per_page=100&page=' + String(p),
      READ_LIMITS.pulls,
    );
    return {
      defaultBranch: main,
      branches: await refs('/repository/branches'),
      tags: await refs('/repository/tags'),
      commits: commits.reverse().map((raw) => {
        const c = obj(raw);
        return {
          id: str(c['id']).toLowerCase(),
          message: str(c['message']),
          url: str(c['web_url']),
          timestamp: str(c['committed_date']) || str(c['created_at']),
          author: { name: str(c['author_name']), username: '' },
        };
      }),
      pulls: mrs.map((raw) => {
        const m = obj(raw);
        const state = str(m['state']);
        return {
          number: Number(m['iid']) || 0,
          title: str(m['title']),
          body: str(m['description']),
          html_url: str(m['web_url']),
          state: state === 'opened' || state === 'locked' ? 'open' : 'closed',
          merged: state === 'merged',
          draft: m['draft'] === true || m['work_in_progress'] === true,
          head: { ref: str(m['source_branch']), sha: str(m['sha']) },
          base: { ref: str(m['target_branch']) },
          mergeable_state: gitlabMergeState(m), // [PCODE-304 | S15 | v0.1.0]
          user: { login: str(obj(m['author'])['username']) },
          created_at: str(m['created_at']),
          updated_at: str(m['updated_at']),
          merged_at: str(m['merged_at']) || null,
          closed_at: str(m['closed_at']) || null,
        };
      }),
    };
  }

  // Azure Repos: organisation/project/repository
  const [org, proj, name] = conn.repo.split('/');
  const repo =
    base +
    '/' +
    encodeURIComponent(org ?? '') +
    '/' +
    encodeURIComponent(proj ?? '') +
    '/_apis/git/repositories/' +
    encodeURIComponent(name ?? '');
  const v = 'api-version=7.1';
  const info = obj(await get(repo + '?' + v));
  const main = str(info['defaultBranch']).replace(/^refs\/heads\//, '') || 'main';
  const web = str(info['webUrl']);
  const refs = async (filter: string): Promise<{ name: string; sha: string }[]> =>
    arr(obj(await get(repo + '/refs?filter=' + filter + '&' + v))['value']).map((x) => {
      const r = obj(x);
      return {
        name: str(r['name']).replace(/^refs\/(heads|tags)\//, ''),
        sha: (str(r['peeledObjectId']) || str(r['objectId'])).toLowerCase(),
      };
    });
  const commits = arr(
    obj(
      await get(
        repo +
          '/commits?searchCriteria.itemVersion.version=' +
          encodeURIComponent(main) +
          '&$top=' +
          String(READ_LIMITS.commits) +
          '&' +
          v,
      ),
    )['value'],
  );
  const prs = arr(
    obj(
      await get(
        repo +
          '/pullrequests?searchCriteria.status=all&$top=' +
          String(READ_LIMITS.pulls) +
          '&' +
          v,
      ),
    )['value'],
  );
  return {
    defaultBranch: main,
    branches: await refs('heads/'),
    tags: await refs('tags/'),
    commits: commits.reverse().map((raw) => {
      const c = obj(raw);
      const id = str(c['commitId']).toLowerCase();
      const author = obj(c['author']);
      return {
        id,
        message: str(c['comment']),
        url: web ? web + '/commit/' + id : '',
        timestamp: str(author['date']),
        author: { name: str(author['name']), username: '' },
      };
    }),
    pulls: prs.map((raw) => {
      const r = obj(raw);
      const status = str(r['status']);
      const id = Number(r['pullRequestId']) || 0;
      return {
        number: id,
        title: str(r['title']),
        body: str(r['description']),
        html_url: web ? web + '/pullrequest/' + String(id) : '',
        state: status === 'active' ? 'open' : 'closed',
        merged: status === 'completed',
        draft: r['isDraft'] === true,
        head: {
          ref: str(r['sourceRefName']).replace(/^refs\/heads\//, ''),
          sha: str(obj(r['lastMergeSourceCommit'])['commitId']),
        },
        base: { ref: str(r['targetRefName']).replace(/^refs\/heads\//, '') },
        mergeable_state: azureMergeState(r), // [PCODE-304 | S15 | v0.1.0]
        user: { login: str(obj(r['createdBy'])['uniqueName']) },
        created_at: str(r['creationDate']),
        updated_at: str(r['closedDate']) || str(r['creationDate']),
        merged_at: status === 'completed' ? str(r['closedDate']) || null : null,
        closed_at: status === 'abandoned' ? str(r['closedDate']) || null : null,
      };
    }),
  };
}
