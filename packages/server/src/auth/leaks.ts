// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
//    Why:  a token pasted where others can read it (a task, a comment) is as good as public. Whatever
//          text the workspace stores is scanned for tokens; a live one is revoked at once, its owner
//          learns of it in the inbox, and the leak is kept for the Tokens and costs page.
import { createHash } from 'node:crypto';
import { findTokens } from '@orqiva/shared';
import type { Pool } from 'pg';
import { inSystem } from '../db/pool.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Revokes every live token in the texts; returns how many were revoked. */
export async function revokeLeaks(
  pool: Pool,
  workspaceId: string,
  texts: readonly (string | null | undefined)[],
  where: {
    foundIn: 'task' | 'comment' | 'commit' | 'trace' | 'log' | 'document';
    location: string;
  },
): Promise<number> {
  const found = findTokens(texts.filter(Boolean).join('\n'));
  if (!found.length) return 0;
  return inSystem(pool, async (c) => {
    let n = 0;
    for (const token of found) {
      const t = (
        await c.query<{ id: string; user_id: string; name: string }>(
          'UPDATE api_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id, user_id, name',
          [sha256(token)],
        )
      ).rows[0];
      if (!t) continue;
      n += 1;
      await c.query(
        'INSERT INTO token_leaks (workspace_id, token_id, user_id, token_name, found_in, location, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, now())',
        [workspaceId, t.id, t.user_id, t.name, where.foundIn, where.location.slice(0, 300)],
      );
    }
    return n;
  });
}
