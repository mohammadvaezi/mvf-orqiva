// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
//    Why:  one answer to "may this agent touch that?", shared by the server's tools, the scope check route,
//          the Claude Code hook and the web app. Files are repository paths matched by globs (* within one
//          folder, ** across folders, a plain folder means everything under it); branches are names with *
//          (agent/* is agent/fix-1, not agent/a/b); hosts are names, *.example.com being its subdomains. Files
//          and branches with no list are not limited; network with no list is closed, because reaching out is
//          the one thing an agent does not do unless someone opened it.

export type ScopeKind = 'files' | 'branches' | 'network';

export interface AgentScope {
  files?: string[];
  branches?: string[];
  network?: string[];
  documents?: string[];
}

const escape = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** `src/**` or `docs/*.md`: a folder prefix, or a pattern with * (not /) and ** (anything). */
export function globMatches(path: string, pattern: string): boolean {
  const rel = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const p = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p) return false;
  if (!p.includes('*')) return rel === p || rel.startsWith(p.endsWith('/') ? p : p + '/');
  const re = p
    .split('**')
    .map((part) => part.split('*').map(escape).join('[^/]*'))
    .join('.*');
  return new RegExp('^' + re + '$').test(rel);
}

/** `agent/*` matches agent/fix-1; a name without * matches only itself. */
export function branchMatches(branch: string, pattern: string): boolean {
  const b = branch.trim().replace(/^refs\/heads\//, '');
  const p = pattern.trim();
  if (!p) return false;
  return new RegExp('^' + p.split('*').map(escape).join('[^/]*') + '$').test(b);
}

/** `api.github.com` matches itself; `*.example.com` its subdomains (not example.com itself). */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  const p = pattern.trim().toLowerCase().replace(/\.$/, '');
  if (!p || !h) return false;
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

export interface ScopeAnswer {
  allowed: boolean;
  reason: string;
}

/** Whether the agent's scope lets it touch the target, and why. */
export function agentScopeAllows(
  scope: AgentScope,
  kind: ScopeKind,
  target: string,
  agentName = 'The agent',
): ScopeAnswer {
  const list = (scope[kind] ?? []).filter((x) => x.trim());
  if (!list.length)
    return kind === 'network'
      ? { allowed: false, reason: agentName + ' may reach no host: its network scope is empty' }
      : { allowed: true, reason: agentName + ' has no ' + kind + ' scope: not limited' };
  const match = kind === 'files' ? globMatches : kind === 'branches' ? branchMatches : hostMatches;
  const hit = list.find((p) => match(target, p));
  return hit
    ? { allowed: true, reason: target + ' is in the ' + kind + ' scope (' + hit + ')' }
    : {
        allowed: false,
        reason:
          target + ' is outside ' + agentName + "'s " + kind + ' scope (' + list.join(', ') + ')',
      };
}
