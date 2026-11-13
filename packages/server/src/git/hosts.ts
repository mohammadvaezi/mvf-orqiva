// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
// ── [PCODE-300 | S15 | v0.1.0] T31.2a Git history from the webhooks: commits, branches, tags; close on merge; revert detection ──
// ── [PCODE-299 | S15 | v0.1.0] T31.1 GitLab and Azure Repos: webhooks, secrets, setup, read into one shape ──
//    Why:  four hosts, one reading. GitLab and Azure DevOps send their own payloads and prove themselves
//          differently (a secret token, a header or basic authentication instead of a signature), so their
//          deliveries are checked here and turned into the shape GitHub's have, which the rest of the code
//          already understands: pushes and new branches, pull requests with drafts and approvals, and
//          pipeline or build results as checks. Nothing else changes for linking and moving tasks.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { POLICY_CONTEXT } from '@orqiva/shared'; // [PCODE-304 | S15 | v0.1.0]

export const PROVIDERS = ['github', 'gitea', 'gitlab', 'azure'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const HOST_NAME: Record<Provider, string> = {
  github: 'GitHub',
  gitea: 'Gitea',
  gitlab: 'GitLab',
  azure: 'Azure Repos',
};

/** The repository names each host uses: owner/name, group/…/name, organisation/project/repository. */
export function repoProblem(provider: Provider, repo: string): string | null {
  const parts = repo.split('/');
  const seg = /^[A-Za-z0-9_.-]+$/;
  if (provider === 'gitlab')
    return parts.length >= 2 && parts.length <= 20 && parts.every((p) => seg.test(p))
      ? null
      : 'is group/project, with subgroups if any (group/sub/project)';
  if (provider === 'azure')
    return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_. -]+$/.test(p) && p.trim() === p)
      ? null
      : 'is organisation/project/repository';
  return parts.length === 2 && parts.every((p) => seg.test(p)) ? null : 'is owner/name';
}

const header = (headers: IncomingMessage['headers'], name: string): string => {
  const raw = headers[name];
  return String(Array.isArray(raw) ? raw[0] : (raw ?? ''));
};

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** GitLab's secret token, or Azure DevOps' header (or basic authentication password), in constant time. */
export function tokenValid(
  provider: 'gitlab' | 'azure',
  secret: string,
  headers: IncomingMessage['headers'],
): boolean {
  if (provider === 'gitlab') return same(header(headers, 'x-gitlab-token'), secret);
  if (same(header(headers, 'x-orqiva-secret'), secret)) return true;
  const auth = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header(headers, 'authorization'))?.[1];
  if (!auth) return false;
  const decoded = Buffer.from(auth, 'base64').toString('utf8');
  return same(decoded.slice(decoded.indexOf(':') + 1), secret);
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ZERO = /^0{40}$/;

/** GitLab writes times as "2026-10-12 08:15:00 UTC" in older versions, ISO in newer ones. */
export function isoTime(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  const old = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/.exec(s);
  const d = new Date(old ? (old[1] ?? '') + 'T' + (old[2] ?? '') + 'Z' : s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** "https://org@dev.azure.com/org/project/_git/repo" (or the older visualstudio.com form) → org/project/repo. */
export function azureRepoName(remoteUrl: string): string {
  try {
    const u = new URL(remoteUrl);
    const p = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const git = p.indexOf('_git');
    if (git < 1) return '';
    if (u.hostname === 'dev.azure.com' || u.hostname.endsWith('.dev.azure.com'))
      return [p[0], p[git - 1], p[git + 1]].join('/');
    const org = u.hostname.replace(/\.visualstudio\.com$/, '');
    return [org, p[git - 1], p[git + 1]].join('/');
  } catch {
    return '';
  }
}
const azureWeb = (remoteUrl: string): string => {
  try {
    const u = new URL(remoteUrl);
    u.username = '';
    u.password = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
};

/** A delivery in GitHub's shape: the event name and its payload. */
export interface Delivery {
  event: string;
  payload: Record<string, unknown>;
}

/** The event a delivery names: from the header for GitHub, Gitea and GitLab, from the body for Azure. */
export function eventOf(
  provider: Provider,
  headers: IncomingMessage['headers'],
  payload: unknown,
): string {
  if (provider === 'github') return header(headers, 'x-github-event');
  if (provider === 'gitea') return header(headers, 'x-gitea-event');
  if (provider === 'gitlab') return header(headers, 'x-gitlab-event');
  return str(obj(payload)['eventType']);
}

// [PCODE-304 | S15 | v0.1.0] whether it merges cleanly, in GitHub's words (dirty, behind, clean, blocked; '' when not known)
export function gitlabMergeState(m: Record<string, unknown>): string {
  const d = str(m['detailed_merge_status']);
  if (m['has_conflicts'] === true || d === 'conflict') return 'dirty';
  if (d === 'need_rebase') return 'behind';
  if (d === 'mergeable') return 'clean';
  if (d && d !== 'checking' && d !== 'unchecked' && d !== 'preparing') return 'blocked';
  const s = str(m['merge_status']);
  return s === 'can_be_merged' ? 'clean' : s === 'cannot_be_merged' ? 'dirty' : '';
}

export function azureMergeState(r: Record<string, unknown>): string {
  const s = str(r['mergeStatus']);
  return s === 'succeeded'
    ? 'clean'
    : s === 'conflicts'
      ? 'dirty'
      : s === 'failure' || s === 'rejectedByPolicy'
        ? 'blocked'
        : '';
}

function gitlabPull(p: Record<string, unknown>): Record<string, unknown> {
  const a = obj(p['object_attributes']);
  const state = str(a['state']);
  return {
    number: Number(a['iid']) || 0,
    title: str(a['title']),
    body: str(a['description']),
    html_url: str(a['url']),
    state: state === 'opened' || state === 'locked' ? 'open' : 'closed',
    merged: state === 'merged',
    draft: a['draft'] === true || a['work_in_progress'] === true,
    head: { ref: str(a['source_branch']), sha: str(obj(a['last_commit'])['id']) },
    base: { ref: str(a['target_branch']) },
    mergeable_state: gitlabMergeState(a), // [PCODE-304 | S15 | v0.1.0]
    user: { login: str(obj(p['user'])['username']) },
    created_at: isoTime(a['created_at']),
    updated_at: isoTime(a['updated_at']),
    merged_at: state === 'merged' ? isoTime(a['merged_at']) || isoTime(a['updated_at']) : null,
    closed_at: state === 'closed' ? isoTime(a['closed_at']) || isoTime(a['updated_at']) : null,
  };
}

function fromGitlab(event: string, p: Record<string, unknown>): Delivery[] {
  // [PCODE-300 | S15 | v0.1.0] the default branch, and what history needs: the pushed commit, deletions, files
  const repository = {
    full_name: str(obj(p['project'])['path_with_namespace']),
    default_branch: str(obj(p['project'])['default_branch']),
  };
  const kind = str(p['object_kind']) || event;
  if (kind === 'push' || event === 'Push Hook') {
    const ref = str(p['ref']);
    const after = str(p['after']);
    if (ZERO.test(after))
      return [{ event: 'push', payload: { ref, after, deleted: true, commits: [], repository } }];
    const out: Delivery[] = [];
    if (ZERO.test(str(p['before'])))
      out.push({
        event: 'create',
        payload: {
          ref: ref.replace(/^refs\/heads\//, ''),
          ref_type: 'branch',
          sender: { login: str(p['user_username']) },
          repository,
        },
      });
    out.push({
      event: 'push',
      payload: {
        ref,
        after,
        repository,
        commits: arr(p['commits']).map((raw) => {
          const c = obj(raw);
          return {
            id: str(c['id']),
            message: str(c['message']),
            url: str(c['url']),
            timestamp: isoTime(c['timestamp']),
            author: { name: str(obj(c['author'])['name']), username: '' },
            added: arr(c['added']),
            modified: arr(c['modified']),
            removed: arr(c['removed']),
          };
        }),
      },
    });
    return out;
  }
  if (kind === 'tag_push') {
    if (ZERO.test(str(p['after'])))
      return [
        {
          event: 'push',
          payload: {
            ref: str(p['ref']),
            after: str(p['after']),
            deleted: true,
            commits: [],
            repository,
          },
        },
      ];
    return [
      {
        event: 'create',
        payload: {
          ref: str(p['ref']).replace(/^refs\/tags\//, ''),
          ref_type: 'tag',
          sha: str(p['after']),
          sender: { login: str(p['user_username']) },
          repository,
        },
      },
    ];
  }
  if (kind === 'merge_request') {
    const pr = gitlabPull(p);
    const action = str(obj(p['object_attributes'])['action']);
    const out: Delivery[] = [
      {
        event: 'pull_request',
        payload: { action, number: pr['number'], pull_request: pr, repository },
      },
    ];
    if (action === 'approved' || action === 'approval')
      out.push({
        event: 'pull_request_review',
        payload: { review: { state: 'approved' }, pull_request: pr, repository },
      });
    return out;
  }
  if (kind === 'pipeline') {
    const a = obj(p['object_attributes']);
    const status = str(a['status']);
    const state =
      status === 'success' || status === 'skipped'
        ? 'success'
        : status === 'failed' || status === 'canceled'
          ? 'failure'
          : 'pending';
    // [PCODE-304 | S15 | v0.1.0] our own commit status comes back as an external pipeline: it names itself
    const builds = arr(p['builds']).map((b) => str(obj(b)['name']));
    const ours = builds.length > 0 && builds.every((b) => b === POLICY_CONTEXT);
    return [
      {
        event: 'status',
        payload: {
          sha: str(a['sha']),
          state,
          ...(ours ? { context: POLICY_CONTEXT } : {}),
          repository,
        },
      },
    ];
  }
  return [];
}

function azurePull(r: Record<string, unknown>): Record<string, unknown> {
  const repo = obj(r['repository']);
  const status = str(r['status']);
  const id = Number(r['pullRequestId']) || 0;
  const web = azureWeb(str(repo['remoteUrl']) || str(repo['webUrl']));
  const merged = status === 'completed';
  return {
    number: id,
    title: str(r['title']),
    body: str(r['description']),
    html_url: web ? web + '/pullrequest/' + String(id) : '',
    state: status === 'active' ? 'open' : 'closed',
    merged,
    draft: r['isDraft'] === true,
    head: {
      ref: str(r['sourceRefName']).replace(/^refs\/heads\//, ''),
      sha: str(obj(r['lastMergeSourceCommit'])['commitId']),
    },
    base: { ref: str(r['targetRefName']).replace(/^refs\/heads\//, '') },
    mergeable_state: azureMergeState(r), // [PCODE-304 | S15 | v0.1.0]
    user: {
      login: str(obj(r['createdBy'])['uniqueName']) || str(obj(r['createdBy'])['displayName']),
    },
    created_at: isoTime(r['creationDate']),
    updated_at: isoTime(r['closedDate']) || new Date().toISOString(),
    merged_at: merged ? isoTime(r['closedDate']) || null : null,
    closed_at: status === 'abandoned' ? isoTime(r['closedDate']) || null : null,
  };
}

/** Azure's reviewer votes as one verdict: a rejection wins, then an approval. */
export function azureVerdict(reviewers: unknown): 'approved' | 'changes_requested' | null {
  const votes = arr(reviewers).map((x) => Number(obj(x)['vote']) || 0);
  if (votes.some((v) => v <= -10)) return 'changes_requested';
  if (votes.some((v) => v >= 5)) return 'approved';
  return null;
}

function fromAzure(event: string, p: Record<string, unknown>): Delivery[] {
  const r = obj(p['resource']);
  const repo = obj(r['repository']);
  const repository = {
    full_name: azureRepoName(str(repo['remoteUrl']) || str(repo['webUrl'])),
    id: str(repo['id']),
    default_branch: str(repo['defaultBranch']).replace(/^refs\/heads\//, ''), // [PCODE-300 | S15 | v0.1.0]
  };
  if (event === 'git.push') {
    const out: Delivery[] = [];
    const web = azureWeb(str(repo['remoteUrl']));
    for (const u of arr(r['refUpdates'])) {
      const ref = obj(u);
      const name = str(ref['name']);
      const after = str(ref['newObjectId']);
      // [PCODE-300 | S15 | v0.1.0] tags and deletions for the history
      if (name.startsWith('refs/tags/') || ZERO.test(after)) {
        out.push({
          event: 'push',
          payload: { ref: name, after, deleted: ZERO.test(after), commits: [], repository },
        });
        continue;
      }
      if (!name.startsWith('refs/heads/')) continue;
      if (ZERO.test(str(ref['oldObjectId'])))
        out.push({
          event: 'create',
          payload: {
            ref: name.replace(/^refs\/heads\//, ''),
            ref_type: 'branch',
            sender: { login: str(obj(r['pushedBy'])['uniqueName']) },
            repository,
          },
        });
      out.push({
        event: 'push',
        payload: {
          ref: name,
          after,
          repository,
          commits: arr(r['commits']).map((raw) => {
            const c = obj(raw);
            const id = str(c['commitId']);
            return {
              id,
              message: str(c['comment']),
              url: web ? web + '/commit/' + id : '',
              timestamp: isoTime(obj(c['author'])['date']),
              author: { name: str(obj(c['author'])['name']), username: '' },
            };
          }),
        },
      });
    }
    return out;
  }
  if (event.startsWith('git.pullrequest.')) {
    const pr = azurePull(r);
    const out: Delivery[] = [
      {
        event: 'pull_request',
        payload: { action: event.slice(16), number: pr['number'], pull_request: pr, repository },
      },
    ];
    const verdict = azureVerdict(r['reviewers']);
    if (verdict)
      out.push({
        event: 'pull_request_review',
        payload: { review: { state: verdict }, pull_request: pr, repository },
      });
    return out;
  }
  if (event === 'build.complete') {
    const result = str(r['result']);
    const state =
      result === 'succeeded' || result === 'partiallySucceeded'
        ? 'success'
        : result
          ? 'failure'
          : 'pending';
    return [{ event: 'status', payload: { sha: str(r['sourceVersion']), state, repository } }];
  }
  return [];
}

/** A delivery read into GitHub's shape; GitHub's and Gitea's stay as they are. */
export function normalize(provider: Provider, event: string, payload: unknown): Delivery[] {
  const p = obj(payload);
  if (provider === 'gitlab') return fromGitlab(event, p);
  if (provider === 'azure') return fromAzure(event, p);
  return [{ event, payload: p }];
}
