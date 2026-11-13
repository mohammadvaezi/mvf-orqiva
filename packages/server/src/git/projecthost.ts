// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
//    Why:  the project's repository a sandbox reads from and opens pull requests to (GitHub or Gitea with
//          an API token), and who an agent commits as: its own name and an address at the workspace's
//          agent mail domain, so a person never appears as the author of an agent's change.
import type { PoolClient } from 'pg';
import { open as openSecret } from '../agents/secrets.js';
import { settingFor } from '../api/settingvalue.js';
import { apiBase, type HostConnection } from './hostapi.js';

/** The project's first GitHub or Gitea repository with a token, or a sentence why there is none. */
export async function projectHost(
  c: PoolClient,
  projectId: string,
): Promise<HostConnection | string> {
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
      [projectId],
    )
  ).rows[0];
  const base = conn ? apiBase(conn.provider as 'github' | 'gitea', conn.api_url) : null;
  if (!conn?.api_token || !base)
    return 'The project has no GitHub or Gitea repository with an API token (Repositories)';
  try {
    return {
      provider: conn.provider as 'github' | 'gitea',
      repo: conn.repo,
      apiUrl: base,
      token: openSecret(conn.api_token),
    };
  } catch {
    return 'The repository’s API token cannot be read; set it again';
  }
}

export interface GitIdentity {
  name: string;
  email: string;
}

/** An agent's bot identity: "Developer agent (Orqiva)" <developer@agents.orqiva.local>. */
export async function botIdentity(
  c: PoolClient,
  agent: { key: string; name: string },
  projectId: string | null,
): Promise<GitIdentity> {
  const set = await settingFor(c, 'agents.git_email_domain', projectId);
  const domain = (typeof set === 'string' ? set : '').trim().toLowerCase();
  const local = agent.key.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'agent';
  return { name: agent.name + ' (Orqiva)', email: local + '@' + (domain || 'agents.orqiva.local') };
}
