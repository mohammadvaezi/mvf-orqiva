// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
//    Why:  from a finding to the change that fixes it, reviewed like any other: a dependency finding with
//          a fixed version becomes an upgrade of its manifest; a code finding is handed with its file to the
//          Security agent, whose corrected file becomes the pull request. A secret is not "fixed" by a
//          change, so it is refused. The finding moves to fixing and keeps the pull request's link.
import {
  bumpPackageJson,
  bumpRequirements,
  fixNoteOf,
  fixedFileOf,
  manifestOf,
  type FileChange,
} from '@orqiva/shared';
import type { Pool } from 'pg';
import { askAgent } from '../agents/oneshot.js';
import { MODE_FIX } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { open as openSecret } from '../agents/secrets.js';
import { inWorkspace } from '../db/pool.js';
import {
  HostError,
  apiBase,
  openPullRequest,
  readRepoFile,
  type HostConnection,
} from '../git/hostapi.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, requireUser } from './access.js';
import { FINDING_SELECT, findingJson, findingOut, type FindingRow } from './security.js';

const uuid = s.string({ format: 'uuid' });
const MAX_FILE = 60_000;

export const FIX_PROMPT =
  MODE_FIX +
  ' A security finding points at a line of this file. Fix the problem with the smallest change that keeps' +
  ' the file working: do not reformat, rename or reorder anything else. Answer with one or two sentences' +
  ' saying what you changed and why, then the whole corrected file in one fenced code block.';

export function fixPrRoutes(
  pool: Pool,
  models: ProviderFor,
  fetchImpl: typeof fetch = fetch,
): Route[] {
  const fix = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/findings/:findingId/fix-pr',
    summary:
      'Open a pull request that fixes the finding: an upgrade of a vulnerable dependency, or the Security agent’s fix of the code (member)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, findingId: uuid }),
    response: s.object({
      kind: s.enum(['upgrade', 'ai']),
      url: s.string(),
      number: s.nullable(s.number({ integer: true })),
      summary: s.string(),
      finding: findingOut,
    }),
    handler: async ({ params, req }) => {
      const ctx = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const f = (
          await c.query<FindingRow & { fixed_version: string; package: string }>(
            FINDING_SELECT + ' WHERE f.id = $1',
            [params.findingId],
          )
        ).rows[0];
        if (!f) throw new HttpError(404, 'not_found', 'Finding not found');
        const p = await requireProject(c, a, f.project_id);
        if (f.status !== 'open') throw new HttpError(409, 'conflict', 'The finding is ' + f.status);
        if (f.fix_pr_url)
          throw new HttpError(
            409,
            'conflict',
            'A fix pull request is open already: ' + f.fix_pr_url,
          );
        if (f.rule.startsWith('secret/'))
          throw new HttpError(
            409,
            'conflict',
            'A secret is fixed by rotating it: a pull request does not take it out of the history',
          );
        const conn = (
          await c.query<{
            provider: string;
            repo: string;
            api_url: string | null;
            api_token: string | null;
          }>(
            `SELECT provider, repo, api_url, api_token FROM git_connections
              WHERE project_id = $1 AND provider IN ('github', 'gitea') AND api_token IS NOT NULL
              ORDER BY created_at LIMIT 1`,
            [p.id],
          )
        ).rows[0];
        const base = conn ? apiBase(conn.provider as 'github' | 'gitea', conn.api_url) : null;
        if (!conn?.api_token || !base)
          throw new HttpError(
            409,
            'conflict',
            'Fix pull requests need a GitHub or Gitea repository with an API token (Repositories)',
          );
        let token: string;
        try {
          token = openSecret(conn.api_token);
        } catch {
          throw new HttpError(409, 'conflict', 'The API token cannot be read; set it again');
        }
        const host: HostConnection = {
          provider: conn.provider as 'github' | 'gitea',
          repo: conn.repo,
          apiUrl: base,
          token,
        };
        return { f, p, host, user: a.user };
      });
      const { f, p, host } = ctx;
      const failed = (e: unknown): never => {
        if (e instanceof HostError)
          throw new HttpError(
            e.status === 401 || e.status === 403 ? 409 : 502,
            'bad_gateway',
            e.message,
          );
        throw e;
      };
      const manifest = manifestOf(f.file);
      let change: FileChange | null = null;
      let kind: 'upgrade' | 'ai';
      let note = '';
      if (f.package && f.fixed_version && manifest) {
        kind = 'upgrade';
        const now = await readRepoFile(host, manifest.path, fetchImpl).catch(failed);
        if (!now) throw new HttpError(409, 'conflict', manifest.path + ' is not in the repository');
        const bumped =
          manifest.kind === 'npm'
            ? bumpPackageJson(now.text, f.package, f.fixed_version)
            : bumpRequirements(now.text, f.package, f.fixed_version);
        if (!bumped)
          throw new HttpError(
            409,
            'conflict',
            f.package + ' is at ' + f.fixed_version + ' already in ' + manifest.path,
          );
        change = { ...bumped, path: manifest.path };
        note =
          'Raises ' +
          f.package +
          ' to ' +
          f.fixed_version +
          ', the first version without ' +
          (f.cve || f.rule) +
          '.\n\nRun the install (npm install, pip install -r) so the lockfile follows, and let the checks run.';
      } else if (f.file && f.line) {
        kind = 'ai';
        const now = await readRepoFile(host, f.file, fetchImpl).catch(failed);
        if (!now) throw new HttpError(409, 'conflict', f.file + ' is not in the repository');
        if (now.text.length > MAX_FILE)
          throw new HttpError(409, 'conflict', f.file + ' is too long for the agent to fix whole');
        const user = await requireUser(pool, req);
        const asked = await askAgent(pool, models, {
          workspaceId: params.workspaceId,
          projectId: p.id,
          agentKey: 'security',
          requestedBy: user.id,
          instruction: 'Fix the finding ' + f.title,
          system: FIX_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: [
                    'Rule: ' + f.rule,
                    'Severity: ' + f.severity,
                    'File: ' + f.file,
                    'Line: ' + String(f.line),
                    'Finding: ' + f.title,
                    f.message,
                    '',
                    '```',
                    now.text.replace(/\n$/, ''),
                    '```',
                  ].join('\n'),
                },
              ],
            },
          ],
        });
        const text = fixedFileOf(asked.text, now.text);
        if (!text)
          throw new HttpError(
            422,
            'invalid_request',
            'The Security agent did not answer with a corrected file',
          );
        change = { path: f.file, text, summary: 'the Security agent’s fix of ' + f.file };
        note = fixNoteOf(asked.text) || 'The Security agent’s fix.';
      } else
        throw new HttpError(
          409,
          'conflict',
          'This finding names no file and line to fix, and no package with a fixed version',
        );
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const pull = await openPullRequest(
        host,
        [{ path: change.path, text: change.text }],
        {
          branch: 'orqiva/fix-' + f.id.slice(0, 8) + '-' + stamp,
          title: (kind === 'upgrade'
            ? 'Upgrade ' + f.package + ' to ' + f.fixed_version
            : 'Fix ' + f.title
          ).slice(0, 200),
          message:
            kind === 'upgrade'
              ? 'Upgrade ' + f.package + ' to ' + f.fixed_version
              : 'Fix: ' + f.title.slice(0, 100),
          body:
            note +
            '\n\nFinding: ' +
            f.title +
            ' (' +
            f.severity +
            ', ' +
            f.rule +
            ') in ' +
            p.key +
            ', opened from Orqiva by ' +
            ctx.user.name +
            '. ' +
            (kind === 'ai'
              ? 'Written by an AI agent: review it like any other change.\n\n'
              : '\n\n'),
        },
        fetchImpl,
      ).catch(failed);
      if (!pull) throw new HttpError(409, 'conflict', 'Nothing would change');
      const after = await inWorkspace(pool, params.workspaceId, async (c) => {
        await c.query("UPDATE findings SET fix_pr_url = $2, workflow = 'fixing' WHERE id = $1", [
          f.id,
          pull.url,
        ]);
        return (await c.query<FindingRow>(FINDING_SELECT + ' WHERE f.id = $1', [f.id])).rows[0];
      });
      if (!after) throw new Error('finding vanished');
      return {
        body: {
          kind,
          url: pull.url,
          number: pull.number,
          summary: change.summary,
          finding: findingJson(after),
        },
      };
    },
  });
  return [fix];
}
