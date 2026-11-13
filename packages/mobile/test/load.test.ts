// ── [PCODE-231 | S15 | v0.1.0] T22.4 A day on the phone: exit test, docs and sprint close ──
//    Why:  the calls the sprint and task screens make, exactly; the server's day-on-the-phone test
//          (packages/server/test/db/phoneday.test.ts) makes the same calls with a device token.
import { describe, expect, it } from 'vitest';
import type { Session } from '../src/client';
import { loadProject, loadTask } from '../src/load';

const S: Session = {
  server: 'https://orqiva.example.test',
  token: 'orq_pat_' + 'x'.repeat(43),
  tokenId: 't',
  expiresAt: null,
  workspace: { id: 'w', name: 'W' },
  user: { id: 'u', name: 'Ada', email: 'ada@example.test' },
};

function server(routes: Record<string, unknown>) {
  const asked: string[] = [];
  const f = (url: string | URL | Request): Promise<Response> => {
    const path = String(url).slice(S.server.length);
    asked.push(path);
    const body = routes[path];
    return Promise.resolve(
      body === undefined
        ? new Response('{"error":{"message":"no"}}', { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 }),
    );
  };
  return { f: f as typeof fetch, asked };
}

describe('what the screens read', () => {
  it('reads a project with its running sprint, its tasks, the people and the capacity', async () => {
    const { f, asked } = server({
      '/api/workspaces/w/projects/p': {
        id: 'p',
        key: 'APP',
        name: 'App',
        description: '',
        states: [],
      },
      '/api/workspaces/w/projects/p/sprints': [
        { id: 's0', status: 'completed' },
        { id: 's1', status: 'active' },
        { id: 's2', status: 'planned' },
      ],
      '/api/workspaces/w/members': [],
      '/api/workspaces/w/projects/p/items?sprintId=s1': [{ id: 'i1' }],
      '/api/workspaces/w/sprints/s1/capacity': {
        capacity: 10,
        committed: 8,
        velocity: null,
        velocitySprints: 0,
      },
    });
    const v = await loadProject(S, 'p', f);
    expect(v.sprint?.id).toBe('s1');
    expect(v.next?.id).toBe('s2');
    expect(v.items).toHaveLength(1);
    expect(v.capacity?.committed).toBe(8);
    expect(asked.sort()).toEqual(
      [
        '/api/workspaces/w/members',
        '/api/workspaces/w/projects/p',
        '/api/workspaces/w/projects/p/items?sprintId=s1',
        '/api/workspaces/w/projects/p/sprints',
        '/api/workspaces/w/sprints/s1/capacity',
      ].sort(),
    );
  });

  it('reads a task with its criteria, comments and history; what a guest may not read stays empty', async () => {
    const { f, asked } = server({
      '/api/workspaces/w/items/i1': { id: 'i1', projectId: 'p' },
      '/api/workspaces/w/projects/p': { id: 'p', states: [] },
      '/api/workspaces/w/items/i1/comments': [{ id: 'c1', body: 'Hi' }],
      '/api/workspaces/w/items/i1/history': [],
    });
    const v = await loadTask(S, 'i1', f);
    expect(v.comments).toHaveLength(1);
    expect(v.members).toEqual([]);
    expect(v.criteria).toEqual([]);
    expect(asked).toContain('/api/workspaces/w/items/i1/criteria');
  });
});
