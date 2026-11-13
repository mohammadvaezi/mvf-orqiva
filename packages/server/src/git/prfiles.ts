// ── [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files ──
//    Why:  a pull request's changed files, read through the host's API with the connection's token. GitHub
//          lists files with their patches; Gitea sends the pull request's whole diff; GitLab lists the merge
//          request's diffs; Azure DevOps lists the changes of the last iteration without patches, so both
//          versions of each file are read and diffed here. All end as the same FileDiff.
import { fileDiff, splitDiff, unifiedPatch, type FileDiff } from '@orqiva/shared';
import { hostClient, type ReadConn } from './hostread.js';

export const FILE_LIMITS = {
  /** files kept of one pull request */
  files: 300,
  /** Azure needs two reads per file */
  azureFiles: 100,
  /** a patch longer than this is kept as "too big to show" */
  patchChars: 400_000,
};

export interface PullFiles {
  files: (FileDiff & { tooBig: boolean })[];
  truncated: boolean;
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const kept = (files: FileDiff[], limit: number): PullFiles => ({
  files: files
    .slice(0, limit)
    .map((f) =>
      f.patch.length > FILE_LIMITS.patchChars
        ? { ...f, patch: '', tooBig: true }
        : { ...f, tooBig: false },
    ),
  truncated: files.length > limit,
});

/** The changed files of pull request `number`, in the host's order. */
export async function readPullFiles(
  conn: ReadConn,
  number: number,
  fetchImpl: typeof fetch = fetch,
): Promise<PullFiles> {
  const { base, get, text } = hostClient(conn, fetchImpl);
  const n = String(number);

  if (conn.provider === 'github') {
    const out: FileDiff[] = [];
    for (let page = 1; out.length <= FILE_LIMITS.files && page <= 30; page += 1) {
      const items = arr(
        await get(
          base + '/repos/' + conn.repo + '/pulls/' + n + '/files?per_page=100&page=' + String(page),
        ),
      );
      for (const raw of items) {
        const f = obj(raw);
        const status = str(f['status']);
        const patch = str(f['patch']);
        const lines = Number(f['additions'] ?? 0) + Number(f['deletions'] ?? 0);
        out.push(
          fileDiff({
            path: str(f['filename']),
            oldPath: str(f['previous_filename']) || null,
            status: status === 'removed' ? 'deleted' : status === 'renamed' ? 'renamed' : status,
            // GitHub leaves out the patch of a binary file (and of a very large one, which still has lines)
            patch,
            binary: !patch && lines === 0 && status !== 'renamed',
          }),
        );
      }
      if (items.length < 100) break;
    }
    return kept(out, FILE_LIMITS.files);
  }

  if (conn.provider === 'gitea')
    return kept(
      splitDiff(await text(base + '/repos/' + conn.repo + '/pulls/' + n + '.diff')),
      FILE_LIMITS.files,
    );

  if (conn.provider === 'gitlab') {
    const mr = base + '/projects/' + encodeURIComponent(conn.repo) + '/merge_requests/' + n;
    const out: FileDiff[] = [];
    for (let page = 1; out.length <= FILE_LIMITS.files && page <= 30; page += 1) {
      const items = arr(await get(mr + '/diffs?per_page=100&page=' + String(page)));
      for (const raw of items) {
        const d = obj(raw);
        const diff = str(d['diff']);
        out.push(
          fileDiff({
            path: str(d['new_path']) || str(d['old_path']),
            oldPath: str(d['old_path']) || null,
            status:
              d['new_file'] === true
                ? 'added'
                : d['deleted_file'] === true
                  ? 'deleted'
                  : d['renamed_file'] === true
                    ? 'renamed'
                    : 'modified',
            patch: diff,
            binary: /^Binary files /m.test(diff),
          }),
        );
      }
      if (items.length < 100) break;
    }
    return kept(out, FILE_LIMITS.files);
  }

  // Azure Repos: the last iteration's changes, then both versions of each file
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
  const pr = repo + '/pullRequests/' + n;
  const iterations = arr(obj(await get(pr + '/iterations?' + v))['value']).map(obj);
  const last = iterations[iterations.length - 1];
  if (!last) return { files: [], truncated: false };
  const head = str(obj(last['sourceRefCommit'])['commitId']);
  const common = str(obj(last['commonRefCommit'])['commitId']);
  const changes = arr(
    obj(
      await get(
        pr +
          '/iterations/' +
          str(last['id']) +
          '/changes?$top=' +
          String(FILE_LIMITS.files + 1) +
          '&' +
          v,
      ),
    )['changeEntries'],
  )
    .map(obj)
    .filter((c) => str(obj(c['item'])['gitObjectType']) !== 'tree');
  const content = async (path: string, sha: string): Promise<string> =>
    text(
      repo +
        '/items?path=' +
        encodeURIComponent(path) +
        '&versionDescriptor.versionType=commit&versionDescriptor.version=' +
        sha +
        '&$format=octetStream&' +
        v,
    );
  const out: FileDiff[] = [];
  for (const c of changes.slice(0, FILE_LIMITS.azureFiles)) {
    const path = str(obj(c['item'])['path']).replace(/^\//, '');
    const type = str(c['changeType']);
    const oldPath =
      (str(c['originalPath']) || str(c['sourceServerItem'])).replace(/^\//, '') || null;
    const status = type.includes('add')
      ? 'added'
      : type.includes('delete')
        ? 'deleted'
        : type.includes('rename')
          ? 'renamed'
          : 'modified';
    const before = status === 'added' ? '' : await content(oldPath ?? path, common);
    const after = status === 'deleted' ? '' : await content(path, head);
    const binary = before.includes('\u0000') || after.includes('\u0000');
    out.push(
      fileDiff({
        path,
        oldPath,
        status,
        patch: binary ? '' : unifiedPatch(before, after),
        binary,
      }),
    );
  }
  return {
    ...kept(out, FILE_LIMITS.azureFiles),
    truncated: changes.length > FILE_LIMITS.azureFiles,
  };
}
