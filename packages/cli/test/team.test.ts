// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
//    Why:  the team commands as a developer types them, against a stand-in server that records what orq
//          sends: inbox numbers that stay valid, approvals by number, comments for the client, hours
//          parsed the German way, agents asked on the active task and watched step by step, the idea
//          interview, and writes queued while the server is gone and sent by orq sync.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnExec } from '../src/install/exec.js';
import { queueLength } from '../src/loop/api.js';
import type { LoopDeps } from '../src/loop/commands.js';
import { mimeOf, parseHours, runTeam, sourceState } from '../src/loop/team.js';

const WS = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';
const W = '/api/workspaces/' + WS;
const NOW = Date.parse('2026-10-08T12:00:00Z');

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}
let server: Server;
let base = '';
let seen: Seen[] = [];
let polls = 0;
let dir = '';

// [PCODE-236 | S15 | v0.1.0] conversations
const msgJson = (id: string, body: string, extra: Record<string, unknown> = {}) => ({
  id,
  channelId: 'c1',
  parentId: null,
  author: { id: 'u2', name: 'Bob Builder' },
  body,
  fileIds: [],
  files: [],
  itemId: null,
  replyCount: 0,
  lastReplyAt: null,
  reactions: [],
  createdAt: '2026-10-08T09:15:00Z',
  editedAt: null,
  deleted: false,
  ...extra,
});
const chan = (id: string, extra: Record<string, unknown>) => ({
  id,
  kind: 'channel',
  name: null,
  topic: '',
  projectId: null,
  clientId: null,
  private: false,
  members: [],
  joined: true,
  muted: false,
  unread: 0,
  mentioned: false,
  lastMessageAt: null,
  archived: false,
  ...extra,
});

function reply(path: string, method: string): [number, unknown] {
  if (path === '/auth/me') return [200, { user: { id: 'u1', name: 'Ada', email: 'ada@x.test' } }];
  if (path === W + '/members')
    return [
      200,
      [
        { userId: 'u1', name: 'Ada', email: 'ada@x.test', role: 'owner' },
        { userId: 'u2', name: 'Bob Builder', email: 'bob@x.test', role: 'member' },
        { userId: 'u3', name: 'Eve', email: 'eve@x.test', role: 'member' },
      ],
    ];
  if (path === W + '/channels')
    return [
      200,
      [
        chan('c1', { name: 'general', unread: 0 }),
        chan('c2', { name: 'release', unread: 3, mentioned: true, topic: 'Release 2.4' }),
        chan('d1', {
          kind: 'direct',
          private: true,
          unread: 1,
          members: [
            { id: 'u1', name: 'Ada' },
            { id: 'u2', name: 'Bob Builder' },
          ],
        }),
      ],
    ];
  if (path.startsWith(W + '/channels/c1/messages?limit=') && method === 'GET')
    return [
      200,
      {
        messages: [
          msgJson('aaaaaaaa-0000-4000-8000-000000000001', 'Morning! Scope is in DEMO-7', {
            replyCount: 2,
          }),
          msgJson('aaaaaaaa-0000-4000-8000-000000000002', 'Lunch at 12:30'),
        ],
        more: false,
      },
    ];
  if (path === W + '/direct' && method === 'POST')
    return [
      200,
      chan('d2', {
        kind: 'direct',
        private: true,
        members: [
          { id: 'u1', name: 'Ada' },
          { id: 'u3', name: 'Eve' },
        ],
      }),
    ];
  if (path === W + '/inbox?state=open')
    return [
      200,
      {
        items: [
          {
            id: 'n1',
            kind: 'mention',
            projectKey: 'DEMO',
            objectType: 'comment',
            objectId: 'c1',
            title: 'Ada mentioned you',
            createdAt: '2026-10-08T11:40:00Z',
          },
          {
            id: 'n2',
            kind: 'approval',
            projectKey: 'DEMO',
            objectType: 'agent_run',
            objectId: RUN,
            title: 'Coder asks to deploy',
            createdAt: '2026-10-08T09:00:00Z',
          },
        ],
      },
    ];
  if (path.startsWith(W + '/loop/tasks/DEMO-9'))
    return [200, { task: { id: 'item-9', ref: 'DEMO-9' } }];
  if (path === W + '/time/week')
    return [
      200,
      {
        days: ['2026-10-06', '2026-10-07', '2026-10-08'],
        perDay: [480, 300, 90],
        total: 870,
        timer: { title: 'Reminders', itemRef: 'DEMO-7', startedAt: '2026-10-08T11:00:00Z' },
      },
    ];
  if (path === W + '/time/timer/stop') return [200, { minutes: 60 }];
  if (path === W + '/agents')
    return [
      200,
      [
        { id: 'a1', key: 'tester', name: 'Tester', description: 'Writes tests', enabled: true },
        { id: 'a2', key: 'coder', name: 'Coder', description: 'Writes code', enabled: false },
      ],
    ];
  if (path.startsWith(W + '/agent-runs?'))
    return [
      200,
      [
        {
          id: RUN,
          agentName: 'Tester',
          itemRef: 'DEMO-7',
          instruction: 'write tests',
          status: 'running',
          error: '',
          summary: '',
          createdAt: '2026-10-08T11:58:00Z',
        },
      ],
    ];
  if (path === W + '/projects/p1/agent-runs' && method === 'POST') return [201, { id: RUN }];
  if (path === W + '/agent-runs/' + RUN) {
    polls++;
    const steps = [
      {
        seq: 1,
        kind: 'model',
        content: { blocks: [{ type: 'tool_use', name: 'read_file' }] },
        at: '2026-10-08T11:58:01Z',
      },
      { seq: 2, kind: 'tool_result', content: {}, at: '2026-10-08T11:58:02Z' },
    ];
    return [
      200,
      {
        run: {
          id: RUN,
          agentName: 'Tester',
          status: polls < 2 ? 'running' : 'succeeded',
          summary: polls < 2 ? '' : 'Wrote 4 tests',
          error: '',
        },
        steps: polls < 2 ? steps.slice(0, 1) : steps,
      },
    ];
  }
  if (path === W + '/projects/p1/ideas' && method === 'GET')
    return [
      200,
      [
        {
          id: 'i1',
          ref: 'DEMO-I1',
          title: 'Reminders by SMS',
          status: 'new',
          interviewDone: false,
          summary: '',
        },
      ],
    ];
  // [PCODE-272 | S15 | v0.1.0] sources
  if (path.startsWith(W + '/files?name=brief.pdf')) return [201, { id: 'f1' }];
  if (path === W + '/ideas/i1/sources' && method === 'POST')
    return [
      201,
      {
        label: 'S2',
        kind: 'link',
        title: 'Call notes',
        url: 'https://example.com/notes',
        fileName: null,
        textLength: 1234,
        read: null,
        link: { status: 'read', error: '' },
      },
    ];
  if (path === W + '/ideas/i1/workspace')
    return [
      200,
      {
        sources: [
          {
            label: 'S1',
            kind: 'file',
            title: 'brief.pdf',
            url: '',
            fileName: 'brief.pdf',
            textLength: 0,
            read: { status: 'queued', error: '' },
            link: null,
          },
        ],
        requirements: [{}, {}],
        questions: [{ status: 'open' }, { status: 'answered' }],
      },
    ];
  if (path === W + '/ideas/i1/interview')
    return [
      200,
      {
        idea: { id: 'i1', ref: 'DEMO-I1', interviewDone: false, summary: '' },
        messages: [
          { role: 'owner', body: 'SMS' },
          { role: 'agent', body: 'Who forgets the appointments most?' },
        ],
      },
    ];
  return [200, {}];
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      let body: Record<string, unknown> | undefined;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      } catch {
        body = { raw, type: req.headers['content-type'] }; // [PCODE-272 | S15 | v0.1.0] an upload
      }
      seen.push({ method: req.method ?? '', path: req.url ?? '', body });
      const [status, out] = reply(req.url ?? '', req.method ?? '');
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
});
afterAll(() => {
  server.close();
});

function folder(serverUrl: string): string {
  const d = mkdtempSync(join(tmpdir(), 'orq-team-'));
  mkdirSync(join(d, '.orqiva', 'state'), { recursive: true });
  writeFileSync(
    join(d, '.orqiva', 'project.json'),
    JSON.stringify({
      server: serverUrl,
      workspaceId: WS,
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: 'Demo',
    }),
  );
  writeFileSync(
    join(d, '.orqiva', 'state', 'active.json'),
    JSON.stringify({ ref: 'DEMO-7', taskId: 'item-7', title: 'Reminders', files: [], pending: [] }),
  );
  return d;
}
const deps = (cwd: string): LoopDeps => ({
  cwd,
  home: cwd,
  hostname: 'test',
  exec: spawnExec,
  env: { ORQIVA_TOKEN: 'orq_test' },
  now: () => NOW,
});
const orq = (argv: string[], cwd = dir, lines: string[] = []) =>
  runTeam(argv, deps(cwd), {
    sleep: () => Promise.resolve(),
    print: (l) => lines.push(l),
    maxPolls: 5,
  });

beforeEach(() => {
  seen = [];
  polls = 0;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = folder(base);
});

// [PCODE-236 | S15 | v0.1.0]
describe('orq msg', () => {
  it('lists conversations, the ones with something new first', async () => {
    const r = await orq(['msg']);
    const lines = (r?.out ?? '').split(String.fromCharCode(10));
    expect(lines[0]).toMatch(/^#release\s+3 new {2}@ you$/);
    expect(lines[1]).toMatch(/^@bob\s+1 new$/);
    expect(lines[2]).toMatch(/^#general/);
  });

  it('reads a conversation and marks it read', async () => {
    const r = await orq(['msg', '#general']);
    expect(r?.out).toContain(
      'Bob Builder: Morning! Scope is in DEMO-7  [2 replies, thread aaaaaaaa]',
    );
    expect(seen.some((x) => x.method === 'POST' && x.path === W + '/channels/c1/read')).toBe(true);
  });

  it('writes, replies in a thread by a short id, and opens a direct conversation', async () => {
    expect((await orq(['msg', '#general', 'Freeze is Wednesday']))?.out).toBe('Sent to #general');
    expect(
      seen.find((x) => x.method === 'POST' && x.path === W + '/channels/c1/messages')?.body,
    ).toEqual({
      body: 'Freeze is Wednesday',
    });
    seen = [];
    expect((await orq(['msg', '#general', 'On it', '--thread', 'aaaaaaaa']))?.out).toBe(
      'Replied in the thread in #general',
    );
    expect(
      seen.find((x) => x.method === 'POST' && x.path === W + '/channels/c1/messages')?.body,
    ).toEqual({
      body: 'On it',
      parentId: 'aaaaaaaa-0000-4000-8000-000000000001',
    });
    seen = [];
    await orq(['msg', '@eve', 'Got 5 minutes?']);
    expect(seen.find((x) => x.path === W + '/direct')?.body).toEqual({ userIds: ['u3'] });
    expect(seen.some((x) => x.method === 'POST' && x.path === W + '/channels/d2/messages')).toBe(
      true,
    );
    await expect(orq(['msg', '@nobody', 'hi'])).rejects.toThrow('Nobody called @nobody');
    await expect(orq(['msg', '#nope'])).rejects.toThrow('No channel #nope');
  });
});

describe('orq with the team', () => {
  it('numbers the inbox and answers an agent by its number', async () => {
    const list = await orq(['inbox']);
    expect(list?.out).toContain(' 1  mention  DEMO  Ada mentioned you  · 20 min');
    expect(list?.out).toContain('orq approve 2 | orq decline 2');
    const ok = await orq(['decline', '2', '--note', 'not today']);
    expect(ok?.out).toBe('Declined: the agent stops.');
    expect(seen).toContainEqual({
      method: 'POST',
      path: W + '/agent-runs/' + RUN + '/decision',
      body: { approve: false, note: 'not today' },
    });
    expect(seen).toContainEqual({
      method: 'PATCH',
      path: W + '/inbox/n2',
      body: { action: 'done' },
    });
    await expect(orq(['approve', '1'])).rejects.toThrow('not an agent asking');
    await orq(['inbox', 'snooze', '1']);
    expect(seen.at(-1)).toEqual({
      method: 'PATCH',
      path: W + '/inbox/n1',
      body: { action: 'snooze', until: '2026-10-08T13:00:00.000Z' },
    });
  });

  it('comments for the client and sets hours on the active task', async () => {
    await orq(['comment', 'DEMO-7', 'Live on staging', '--client']);
    expect(seen.at(-1)).toEqual({
      method: 'POST',
      path: W + '/items/item-7/comments',
      body: { body: 'Live on staging', visibility: 'client' },
    });
    const set = await orq(['time', 'set', 'DEMO-9', '1,5', '--day', '2026-10-07']);
    expect(set?.out).toBe('DEMO-9 on 2026-10-07: 1,50 h');
    expect(seen.at(-1)?.body).toEqual({ day: '2026-10-07', minutes: 90, itemId: 'item-9' });
    expect((await orq(['time']))?.out).toBe(
      'Today 1,50 h · this week 14,50 h\nTimer on DEMO-7 Reminders for 1 h',
    );
    await orq(['time', 'start']);
    expect(seen.at(-1)).toEqual({
      method: 'POST',
      path: W + '/time/timer',
      body: { itemId: 'item-7' },
    });
    expect((await orq(['time', 'stop']))?.out).toBe('Timer stopped: 1,00 h booked.');
  });

  it('reads hours the way people write them', () => {
    expect(parseHours('1,5')).toBe(90);
    expect(parseHours('2h')).toBe(120);
    expect(parseHours('1:45')).toBe(105);
    expect(parseHours('90m')).toBe(90);
    expect(parseHours('soon')).toBeNull();
    expect(parseHours('30')).toBeNull();
  });

  it('asks an agent on the active task and watches it to the end', async () => {
    const ask = await orq(['agent', 'ask', 'tester', 'write tests for the criteria']);
    expect(ask?.out).toBe('Tester is on it (DEMO-7). Follow it: orq agent watch 33333333');
    expect(seen.at(-1)?.body).toEqual({
      agentId: 'a1',
      instruction: 'write tests for the criteria',
      itemId: 'item-7',
    });
    await expect(orq(['agent', 'ask', 'coder', 'x'])).rejects.toThrow('Coder is switched off.');
    const lines: string[] = [];
    const w = await orq(['agent', 'watch', '3333'], dir, lines);
    expect(lines).toEqual(['11:58:01  model: calls read_file', '11:58:02  tools ran']);
    expect(w?.out).toBe('Tester succeeded: Wrote 4 tests');
    expect((await orq(['agent', 'runs']))?.out).toContain('33333333  running  Tester · DEMO-7');
  });

  it('runs the idea interview from the terminal', async () => {
    const r = await orq(['idea', 'interview', 'demo-i1', 'Older patients']);
    expect(r?.out).toContain('Who forgets the appointments most?');
    expect(seen.at(-1)).toEqual({
      method: 'POST',
      path: W + '/ideas/i1/interview',
      body: { answer: 'Older patients' },
    });
    // [PCODE-273 | S15 | v0.1.0] the owner may end it: the interviewer sums up now
    await orq(['idea', 'interview', 'DEMO-I1', '--enough']);
    expect(seen.at(-1)?.body).toEqual({ enough: true });
  });

  // [PCODE-272 | S15 | v0.1.0]
  it('adds sources to an idea and shows how far each is read', async () => {
    const link = await orq(['idea', 'source', 'DEMO-I1', '--link', 'https://example.com/notes']);
    expect(link?.out).toBe('Added to DEMO-I1:\nS2  link  Call notes  ·  1.234 characters');
    expect(seen.at(-1)?.body).toEqual({ kind: 'link', url: 'https://example.com/notes' });

    await orq(['idea', 'source', 'DEMO-I1', '--text', 'We lose bookings', '--said-by', 'Support']);
    expect(seen.at(-1)?.body).toEqual({
      kind: 'quote',
      body: 'We lose bookings',
      saidBy: 'Support',
    });

    writeFileSync(join(dir, 'brief.pdf'), '%PDF-1.4 fake');
    await orq(['idea', 'source', 'DEMO-I1', '--file', 'brief.pdf', '--title', 'The brief']);
    const upload = seen.at(-2);
    expect(upload?.path).toBe(W + '/files?name=brief.pdf&projectId=p1');
    expect(upload?.body).toEqual({ raw: '%PDF-1.4 fake', type: 'application/pdf' });
    expect(seen.at(-1)?.body).toEqual({ kind: 'file', fileId: 'f1', title: 'The brief' });

    await expect(orq(['idea', 'source', 'DEMO-I1'])).rejects.toThrow('Give exactly one of');
    await expect(orq(['idea', 'source', 'DEMO-I1', '--file', 'missing.pdf'])).rejects.toThrow(
      'Cannot read missing.pdf',
    );

    const show = await orq(['idea', 'show', 'demo-i1']);
    expect(show?.out).toBe(
      'DEMO-I1  Reminders by SMS  (new)\n2 requirements, 1 open questions\n\nS1  file  brief.pdf  ·  being read',
    );
    expect(mimeOf('Notes.DOCX')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(
      sourceState({
        label: 'S3',
        kind: 'link',
        title: '',
        url: 'x',
        fileName: null,
        textLength: 0,
        read: null,
        link: { status: 'failed', error: 'example.com answered 404' },
      }),
    ).toBe('failed: example.com answered 404');
  });

  it('queues writes while the server is gone', async () => {
    const off = folder('http://127.0.0.1:9');
    try {
      expect((await orq(['comment', 'DEMO-7', 'offline note'], off))?.out).toContain('queued');
      expect((await orq(['idea', 'Offline idea'], off))?.out).toContain('queued');
      expect(queueLength(off)).toBe(2);
      await expect(orq(['comment', 'DEMO-9', 'x'], off)).rejects.toThrow(
        'only the active task is known',
      );
    } finally {
      rmSync(off, { recursive: true, force: true });
    }
  });
});
