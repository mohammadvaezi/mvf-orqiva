// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
//    Why:  sign in, the project list, a new project and the link, against a fake server: the token lands in
//          the same credentials.json `orq login` writes, the link in the same .orqiva/project.json `orq link`
//          writes, and archived projects are not offered.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProject,
  linkFolder,
  listProjects,
  listWorkspaces,
  signIn,
  signedIn,
} from '../../src/server/account';

const SERVER = 'http://orqiva.test:8490';

interface Call {
  method: string;
  url: string;
  auth: string;
  body: unknown;
}

function fakeServer(calls: Call[]): typeof fetch {
  return ((url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const body = init.body ? (JSON.parse(init.body as string) as unknown) : undefined;
    calls.push({ method: init.method ?? 'GET', url, auth: headers.authorization ?? '', body });
    const json = (status: number, v: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(v), { status }));
    const p = url.slice(SERVER.length);
    if (p === '/auth/tokens') return json(201, { id: 't1', name: 'x', token: 'orq_secret' });
    if (p === '/auth/me')
      return json(200, {
        user: { email: 'ada@example.test', name: 'Ada' },
        workspaces: [
          { id: 'w1', name: 'Orqiva', role: 'owner' },
          { id: 'w2', name: 'Guests', role: 'guest' },
        ],
      });
    if (p === '/api/workspaces/w1/projects' && init.method === 'POST')
      return json(201, { id: 'p9', key: 'NEW', name: 'New one' });
    if (p === '/api/workspaces/w1/projects')
      return json(200, [
        { id: 'p2', key: 'WEB', name: 'Website', archived: false },
        { id: 'p1', key: 'APP', name: 'The App', archived: false },
        { id: 'p0', key: 'OLD', name: 'Old', archived: true },
      ]);
    if (p === '/api/workspaces/w2/projects') return json(200, []);
    return json(404, { error: { message: 'no route ' + p } });
  }) as unknown as typeof fetch;
}

let home = '';
let folder = '';
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-home-'));
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-folder-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(folder, { recursive: true, force: true });
});

describe('Orqiva account in VS Code', () => {
  it('is not signed in on a new computer', () => {
    expect(signedIn(home)).toBeNull();
  });

  it('signs in with e-mail and password and keeps only the token', async () => {
    const calls: Call[] = [];
    const me = await signIn(
      home,
      {
        server: SERVER + '/',
        email: ' ada@example.test ',
        password: 'pw-123456789',
        hostname: 'pc1',
      },
      fakeServer(calls),
    );
    expect(me).toMatchObject({ server: SERVER, email: 'ada@example.test', name: 'Ada' });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { name: 'VS Code on pc1', email: 'ada@example.test', password: 'pw-123456789' },
    });
    expect(calls[1]?.auth).toBe('Bearer orq_secret');
    const saved = fs.readFileSync(path.join(home, '.orqiva', 'credentials.json'), 'utf8');
    expect(JSON.parse(saved)).toEqual({
      servers: { [SERVER]: { token: 'orq_secret', email: 'ada@example.test' } },
    });
    expect(saved).not.toContain('pw-123456789');
    expect(signedIn(home)).toEqual({
      server: SERVER,
      email: 'ada@example.test',
      token: 'orq_secret',
    });
  });

  // [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server
  it("uses the latest sign-in next, and the folder's own server when asked for it", async () => {
    const dir = path.join(home, '.orqiva');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'credentials.json'),
      JSON.stringify({ servers: { 'http://old.test': { token: 'orq_old', email: 'o@x.test' } } }),
    );
    await signIn(
      home,
      { server: SERVER, email: 'ada@example.test', password: 'pw', hostname: 'pc1' },
      fakeServer([]),
    );
    expect(signedIn(home)?.server).toBe(SERVER);
    expect(signedIn(home, 'http://old.test/')).toEqual({
      server: 'http://old.test',
      email: 'o@x.test',
      token: 'orq_old',
    });
    expect(signedIn(home, 'http://unknown.test')?.server).toBe(SERVER);
  });

  it('lists the visible projects of every workspace, without archived ones, by key', async () => {
    const calls: Call[] = [];
    const account = { server: SERVER, email: 'ada@example.test', token: 'orq_secret' };
    const list = await listProjects(account, fakeServer(calls));
    expect(list.map((p) => p.projectKey)).toEqual(['APP', 'WEB']);
    expect(list[0]).toEqual({
      server: SERVER,
      workspaceId: 'w1',
      workspaceName: 'Orqiva',
      projectId: 'p1',
      projectKey: 'APP',
      projectName: 'The App',
    });
    expect((await listWorkspaces(account, fakeServer(calls))).map((w) => w.id)).toEqual([
      'w1',
      'w2',
    ]);
  });

  it('creates a project on the server and links the folder the way orq link does', async () => {
    const calls: Call[] = [];
    const account = { server: SERVER, email: 'ada@example.test', token: 'orq_secret' };
    const p = await createProject(
      account,
      { id: 'w1', name: 'Orqiva' },
      { key: 'NEW', name: 'New one' },
      fakeServer(calls),
    );
    expect(calls[0]).toMatchObject({ method: 'POST', body: { key: 'NEW', name: 'New one' } });
    linkFolder(folder, p);
    const link = JSON.parse(
      fs.readFileSync(path.join(folder, '.orqiva', 'project.json'), 'utf8'),
    ) as unknown;
    expect(link).toEqual({
      server: SERVER,
      workspaceId: 'w1',
      projectId: 'p9',
      projectKey: 'NEW',
      projectName: 'New one',
    });
    expect(fs.readFileSync(path.join(folder, '.orqiva', '.gitignore'), 'utf8')).toBe('state/\n');
  });
});
