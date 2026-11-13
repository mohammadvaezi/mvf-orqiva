// ── [PCODE-325 | S15 | v0.1.0] T32.8b Leak scans of commits, traces and logs ──
//    Why:  secrets turn up where nobody meant to keep them: a commit message, a deploy log, what an agent
//          read. An Orqiva token found there is revoked at once; another service's secret becomes a finding
//          of the project, said by its kind and where, never by value, asking to rotate it. The same place
//          and kind is one finding, however often it is seen.
import { fnv, redactSecrets } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { revokeLeaks } from '../auth/leaks.js';
import { refreshFindings } from '../api/posture.js';
import { inWorkspace } from '../db/pool.js';

export const LEAK_TOOL = 'orq-leaks';

export interface LeakPlace {
  foundIn: 'commit' | 'trace' | 'log';
  /** "commit 1a2b3c4 of acme/shop", "the deploy of 1.4.0 to production, step build" */
  location: string;
}

const slug = (kind: string): string => kind.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** "a" or "an" as the kind is said: an AWS key, a GitHub token, an Orqiva token. */
export const article = (kind: string): string => {
  const word = kind.split(' ')[0] ?? '';
  const spelled = word.length > 1 && word === word.toUpperCase();
  return (spelled ? /^[AEFHILMNORSX]/ : /^[aeiou]/i).test(word) ? 'An' : 'A';
};

/** The findings for the secrets found in one place; returns how many were new. */
export async function recordLeaks(
  c: PoolClient,
  workspaceId: string,
  projectId: string,
  kinds: readonly string[],
  where: LeakPlace,
): Promise<number> {
  let fresh = 0;
  for (const kind of kinds) {
    const r = await c.query(
      `INSERT INTO findings (workspace_id, project_id, tool, rule, severity, title, message, file, line, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '', NULL, $8)
       ON CONFLICT (project_id, tool, fingerprint) DO NOTHING`,
      [
        workspaceId,
        projectId,
        LEAK_TOOL,
        'leak/' + slug(kind),
        kind === 'private key' ? 'critical' : 'high',
        (article(kind) + ' ' + kind + ' in ' + where.location).slice(0, 300),
        article(kind) +
          ' ' +
          kind +
          ' was found in ' +
          where.location +
          '. Orqiva keeps the text with the value replaced, but it was seen where others can read it' +
          (where.foundIn === 'commit' ? ', and the commit stays in every clone' : '') +
          '. Rotate the secret if it is real.',
        fnv(where.foundIn + '|' + where.location + '|' + kind),
      ],
    );
    fresh += r.rowCount ?? 0;
  }
  if (fresh) await refreshFindings(c, projectId);
  return fresh;
}

/** Scans texts for leaks: revokes Orqiva tokens, makes findings of other secrets. */
export async function scanForLeaks(
  pool: Pool,
  workspaceId: string,
  projectId: string | null,
  texts: readonly string[],
  where: LeakPlace,
): Promise<{ revoked: number; findings: number }> {
  const joined = texts.filter(Boolean).join('\n');
  if (!joined) return { revoked: 0, findings: 0 };
  const revoked = await revokeLeaks(pool, workspaceId, [joined], where);
  const kinds = redactSecrets(joined).found.filter((k) => k !== 'Orqiva token');
  const findings =
    kinds.length && projectId
      ? await inWorkspace(pool, workspaceId, (c) =>
          recordLeaks(c, workspaceId, projectId, kinds, where),
        )
      : 0;
  return { revoked, findings };
}
