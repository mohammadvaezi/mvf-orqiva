// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
//    Why:  the first steps in VS Code on Orqiva, without Python, the Plane key or a terminal: sign in to a
//          server, list the projects the person can see there, link the folder or create a project. It does
//          what `orq login` and `orq link` do and writes the same files (~/.orqiva/credentials.json and
//          .orqiva/project.json), so the CLI, the hooks and the extension keep working on one sign-in and
//          one link. Free of vscode, so it is tested against a fake server.
import { makeApi } from '../../../cli/src/loop/api';
import {
  ensureStateIgnored,
  linkPath,
  loadCredentials,
  saveCredentials,
  writeJson,
  type ProjectLink,
} from '../../../cli/src/loop/config';

export interface OrqivaAccount {
  server: string;
  email: string;
  token: string;
}

const trimServer = (s: string): string => s.trim().replace(/\/+$/, '');

/** The server this computer is signed in to: the first sign-in saved by `orq login` or Orqiva: Sign in. */
// [PCODE-454 | S15 | v0.1.0] ...or the sign-in for one server (the folder's), when it has one
export function signedIn(home: string, prefer?: string): OrqivaAccount | null {
  const servers = loadCredentials(home).servers;
  const want = prefer ? trimServer(prefer) : '';
  const own = Object.entries(servers).find(([s, c]) => trimServer(s) === want && c.token);
  if (own) return { server: own[0], email: own[1].email, token: own[1].token };
  for (const [server, c] of Object.entries(servers))
    if (c.token) return { server, email: c.email, token: c.token };
  return null;
}

/** Signs in with e-mail and password, as `orq login` does, and keeps the token for this computer. */
export async function signIn(
  home: string,
  input: { server: string; email: string; password: string; hostname: string },
  fetchImpl?: typeof fetch,
): Promise<OrqivaAccount & { name: string }> {
  const server = trimServer(input.server);
  const { token } = await makeApi(server, '', fetchImpl).call<{ token: string }>(
    'POST',
    '/auth/tokens',
    { name: 'VS Code on ' + input.hostname, email: input.email.trim(), password: input.password },
  );
  const me = await makeApi(server, token, fetchImpl).call<{
    user: { email: string; name: string };
  }>('GET', '/auth/me');
  const creds = loadCredentials(home);
  // [PCODE-454 | S15 | v0.1.0] the latest sign-in comes first, so a second server is the one used next
  const others = Object.fromEntries(Object.entries(creds.servers).filter(([s]) => s !== server));
  creds.servers = { [server]: { token, email: me.user.email }, ...others };
  saveCredentials(home, creds);
  return { server, email: me.user.email, token, name: me.user.name };
}

export interface ServerProject extends ProjectLink {
  workspaceName: string;
}

/** Every project the person can see on the server, in all their workspaces, archived ones left out. */
export async function listProjects(
  account: OrqivaAccount,
  fetchImpl?: typeof fetch,
): Promise<ServerProject[]> {
  const api = makeApi(account.server, account.token, fetchImpl);
  const me = await api.call<{ workspaces: { id: string; name: string }[] }>('GET', '/auth/me');
  const out: ServerProject[] = [];
  for (const w of me.workspaces) {
    const projects = await api.call<{ id: string; key: string; name: string; archived: boolean }[]>(
      'GET',
      '/api/workspaces/' + w.id + '/projects',
    );
    for (const p of projects)
      if (!p.archived)
        out.push({
          server: account.server,
          workspaceId: w.id,
          workspaceName: w.name,
          projectId: p.id,
          projectKey: p.key,
          projectName: p.name,
        });
  }
  return out.sort((a, b) => a.projectKey.localeCompare(b.projectKey));
}

/** The workspaces the person belongs to, for creating a project in one. */
export async function listWorkspaces(
  account: OrqivaAccount,
  fetchImpl?: typeof fetch,
): Promise<{ id: string; name: string; role: string }[]> {
  const me = await makeApi(account.server, account.token, fetchImpl).call<{
    workspaces: { id: string; name: string; role: string }[];
  }>('GET', '/auth/me');
  return me.workspaces;
}

/** Creates the project on the server with its default board states. */
export async function createProject(
  account: OrqivaAccount,
  workspace: { id: string; name: string },
  input: { key: string; name: string },
  fetchImpl?: typeof fetch,
): Promise<ServerProject> {
  const p = await makeApi(account.server, account.token, fetchImpl).call<{
    id: string;
    key: string;
    name: string;
  }>('POST', '/api/workspaces/' + workspace.id + '/projects', {
    key: input.key,
    name: input.name,
  });
  return {
    server: account.server,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    projectId: p.id,
    projectKey: p.key,
    projectName: p.name,
  };
}

/** Links the folder to the project: the same .orqiva/project.json `orq link` writes. */
export function linkFolder(root: string, p: ProjectLink): void {
  const link: ProjectLink = {
    server: p.server,
    workspaceId: p.workspaceId,
    projectId: p.projectId,
    projectKey: p.projectKey,
    projectName: p.projectName,
  };
  writeJson(linkPath(root), link);
  ensureStateIgnored(root);
}
