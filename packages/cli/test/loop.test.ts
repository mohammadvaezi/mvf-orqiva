// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
//    Why:  the loop as a developer runs it: login, link, start, edit under the hooks, commit, test, done,
//          against a stand-in server that records what orq sends, in a real temporary git repository.
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnExec } from '../src/install/exec.js';
import { branchTargets, installHooks, matchesPath, RUN_TOOLS } from '../src/loop/hooks.js';
import { queueLength } from '../src/loop/api.js';
import { run, type CliDeps } from '../src/run.js';

interface Seen {
  method: string;
  path: string;
  auth: string;
  body: Record<string, unknown> | undefined;
}

const WS = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'pe_testtoken';
const RULES = { reviewBeforeDone: true, autoTestState: true, unguardedPaths: ['scripts/'] };
// [PCODE-247 | S15 | v0.1.0] DEMO-9 is assigned to an agent with a scope
const rulesFor = (ref: string | null) =>
  ref === 'DEMO-9'
    ? { ...RULES, agent: { name: 'Developer agent', files: ['src/**'], branches: ['agent/*'] } }
    : RULES;
const task = (ref: string) => ({
  id: '22222222-2222-4222-8222-22222222222' + ref.slice(-1),
  ref,
  title: 'Add the thing',
  description: 'What, why and how to check it.',
  state: 'In Progress',
  projectId: 'p1',
  projectKey: 'DEMO',
});
const fp = (ref: string) => ({
  task: ref,
  sprint: 'S03',
  version: '0.2.0',
  title: 'Add the thing',
  marker: '[' + ref + ' | S03 | v0.2.0] Add the thing',
});

let server: Server;
let base = '';
let seen: Seen[] = [];
let activeRef: string | null = null;
let up = true;

function reply(
  path: string,
  method: string,
  body: Record<string, unknown> | undefined,
): [number, unknown] {
  const ws = '/api/workspaces/' + WS;
  if (path === '/auth/tokens' && method === 'POST')
    return body?.['password'] === 'right'
      ? [201, { id: 't', name: 'x', token: TOKEN }]
      : [401, { error: { message: 'Wrong email or password' } }];
  if (path === '/auth/me')
    return [
      200,
      { user: { email: 'dev@example.test', name: 'Dev' }, workspaces: [{ id: WS, name: 'Acme' }] },
    ];
  // [PCODE-456 | S15 | v0.1.0] steps of a run VS Code opened
  if (/\/agent-runs\/[^/]+\/steps$/.test(path) && method === 'POST') return [201, { seq: 1 }];
  if (path === ws + '/projects')
    return [200, [{ id: 'p1', key: 'DEMO', name: 'Demo', archived: false }]];
  if (path.startsWith(ws + '/loop/open'))
    return [
      200,
      [
        {
          ref: 'DEMO-7',
          title: 'Add the thing',
          state: 'Todo',
          sprint: 'Sprint 3',
          sprintStatus: 'active',
        },
      ],
    ];
  if (path.startsWith(ws + '/loop/tasks/')) {
    const ref = path.split('/').pop() ?? '';
    return [200, { task: task(ref), fingerprint: fp(ref), rules: rulesFor(ref) }];
  }
  if (path === ws + '/loop/start') {
    const ref = String(body?.['ref']);
    if (activeRef && activeRef !== ref)
      return [409, { error: { message: activeRef + ' is still active' } }];
    const resumed = activeRef === ref;
    activeRef = ref;
    return [
      200,
      { sessionId: 's1', task: task(ref), fingerprint: fp(ref), rules: rulesFor(ref), resumed },
    ];
  }
  if (path.startsWith(ws + '/loop/active'))
    return [
      200,
      {
        active: activeRef
          ? {
              sessionId: 's1',
              task: task(activeRef),
              fingerprint: fp(activeRef),
              rules: rulesFor(activeRef),
            }
          : null,
      },
    ];
  if (path === ws + '/loop/progress') return [200, { state: 'In Progress' }];
  if (path === ws + '/loop/status') {
    activeRef = null;
    return [200, { state: 'Blocked', ended: true }];
  }
  if (path === ws + '/loop/done') {
    activeRef = null;
    return [200, { state: 'Review', files: (body?.['files'] as unknown[]).length }];
  }
  if (path.endsWith('/comments')) return [201, { id: 'c' }];
  if (path === ws + '/projects/p1/items') return [201, { ref: 'DEMO-8', title: body?.['title'] }];
  return [404, { error: { message: 'no route ' + path } }];
}

let repo = '';
let home = '';

function deps(stdin = '', env: Record<string, string> = {}): CliDeps {
  return {
    exec: spawnExec,
    loop: {
      cwd: repo,
      home,
      hostname: 'laptop',
      env: { ORQIVA_PASSWORD: 'right', ...env },
      now: () => Date.now(),
    },
    stdin: () => Promise.resolve(stdin),
  };
}

const hook = async (event: string, input: Record<string, unknown>): Promise<string> => {
  const r = await run(
    ['hook', event],
    deps(JSON.stringify({ cwd: repo, session_id: 'cc1', ...input })),
  );
  expect(r.code).toBe(0);
  return r.out;
};
const progress = (): Seen[] => seen.filter((s) => s.path.endsWith('/loop/progress'));
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

beforeAll(async () => {
  server = createServer((req, res) => {
    let text = '';
    req.on('data', (d: Buffer) => (text += d.toString()));
    req.on('end', () => {
      if (!up) {
        req.socket.destroy();
        return;
      }
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
      const path = req.url ?? '';
      seen.push({ method: req.method ?? '', path, auth: req.headers.authorization ?? '', body });
      const [status, out] = reply(path, req.method ?? '', body);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  seen = [];
  activeRef = null;
  up = true;
  repo = mkdtempSync(join(tmpdir(), 'pe-repo-'));
  home = mkdtempSync(join(tmpdir(), 'pe-home-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'dev@example.test');
  git('config', 'user.name', 'Dev');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  return () => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  };
});

async function loginAndLink(): Promise<void> {
  expect(
    (await run(['login', '--server', base, '--email', 'dev@example.test'], deps())).out,
  ).toContain('Signed in');
  expect((await run(['link', 'demo'], deps())).code).toBe(0);
}

describe('orq login and link', () => {
  it('trades email and password for a token kept private in the home folder', async () => {
    await loginAndLink();
    const creds = JSON.parse(readFileSync(join(home, '.orqiva', 'credentials.json'), 'utf8')) as {
      servers: Record<string, { token: string }>;
    };
    expect(creds.servers[base]?.token).toBe(TOKEN);
    if (process.platform !== 'win32')
      expect(statSync(join(home, '.orqiva', 'credentials.json')).mode & 0o077).toBe(0);
    const link = JSON.parse(readFileSync(join(repo, '.orqiva', 'project.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(link).toMatchObject({
      server: base,
      workspaceId: WS,
      projectKey: 'DEMO',
      projectId: 'p1',
    });
    expect(readFileSync(join(repo, '.orqiva', '.gitignore'), 'utf8')).toBe('state/\n');
    expect(
      seen.filter((s) => s.path !== '/auth/tokens').every((s) => s.auth === 'Bearer ' + TOKEN),
    ).toBe(true);
  });

  it('passes the server’s refusal on', async () => {
    const r = await run(
      ['login', '--server', base, '--email', 'x@example.test'],
      deps('', { ORQIVA_PASSWORD: 'wrong' }),
    );
    expect(r).toEqual({ code: 1, out: 'Wrong email or password' });
  });

  it('asks for a link before any loop command', async () => {
    const r = await run(['list'], deps());
    expect(r.code).toBe(1);
    expect(r.out).toContain('orq link');
  });
});

describe('the loop', () => {
  it('lists, starts with the client key, refuses a second task, and reports status', async () => {
    await loginAndLink();
    expect((await run(['list'], deps())).out).toContain('DEMO-7');
    const s = await run(['start', 'DEMO-7'], deps('', { CLAUDE_SESSION_ID: 'cc1' }));
    expect(s.out).toContain('Started DEMO-7');
    expect(s.out).toContain('[DEMO-7 | S03 | v0.2.0] Add the thing');
    const start = seen.find((x) => x.path.endsWith('/loop/start'));
    expect(start?.body).toEqual({
      ref: 'DEMO-7',
      client: 'laptop:' + repo.replace(/\\/g, '/'),
      clientSession: 'cc1',
    });
    expect((await run(['start', 'DEMO-9'], deps())).out).toContain('DEMO-7 is still active');
    const st = await run(['status', 'DEMO-7', 'blocked', '--note', 'waiting for keys'], deps());
    expect(st.out).toContain('Blocked');
    expect(seen.at(-1)?.body).toEqual({
      ref: 'DEMO-7',
      state: 'blocked',
      note: 'waiting for keys',
    });
    expect(existsSync(join(repo, '.orqiva', 'state', 'active.json'))).toBe(true);
    expect(readFileSync(join(repo, '.orqiva', 'state', 'active.json'), 'utf8').trim()).toBe('null');
  });

  it('creates a task from a description file and starts it', async () => {
    await loginAndLink();
    writeFileSync(join(repo, 'd.md'), 'What: x. Why: y. Check: z.');
    const r = await run(['new', 'Fix the export', '--desc-file', 'd.md', '--start'], deps());
    expect(r.out).toContain('Created DEMO-8');
    expect(r.out).toContain('Started DEMO-8');
    expect(seen.find((x) => x.path.endsWith('/items'))?.body).toEqual({
      title: 'Fix the export',
      description: 'What: x. Why: y. Check: z.',
    });
  });

  it('refuses done without a fingerprint, then commits, scans and reports', async () => {
    await loginAndLink();
    await run(['start', 'DEMO-7'], deps());
    writeFileSync(join(repo, 'other.ts'), 'export const untouched = 1;\n');
    const refused = await run(['done', 'DEMO-7'], deps());
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('No fingerprint of DEMO-7');

    mkdirSync(join(repo, 'src'));
    writeFileSync(
      join(repo, 'src', 'thing.ts'),
      '// ── [DEMO-7 | S03 | v0.2.0] Add the thing ──\nexport const a = 1;\n// [DEMO-7 | S03 | v0.2.0] the block\nexport const b = 2;\n',
    );
    // [PCODE-218 | S15 | v0.1.0] build output git ignores carries the marker too, and is left out
    writeFileSync(join(repo, '.gitignore'), 'out/\n');
    mkdirSync(join(repo, 'out'));
    writeFileSync(join(repo, 'out', 'site.css'), '/* [DEMO-7 | S03 | v0.2.0] built */\n');
    const r = await run(['done', 'DEMO-7'], deps());
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DEMO-7 → Review: 2 file\(s\) fingerprinted, commit [0-9a-f]{9}/);
    expect(git('log', '-1', '--format=%s')).toBe('DEMO-7 Add the thing');
    const committed = git('show', '--name-only', '--format=', 'HEAD').split('\n');
    expect(committed.sort()).toEqual(['.orqiva/fingerprints.md', 'src/thing.ts']);
    const done = seen.find((x) => x.path.endsWith('/loop/done'));
    expect(done?.body).toEqual({
      ref: 'DEMO-7',
      commit: git('rev-parse', 'HEAD'),
      files: [
        { path: 'src/thing.ts', line: 1, kind: 'header' },
        { path: 'src/thing.ts', line: 3, kind: 'block' },
      ],
    });
    expect(readFileSync(join(repo, '.orqiva', 'fingerprints.md'), 'utf8')).toContain(
      '`src/thing.ts:3` block',
    );
  });

  it('closes a task without code with --force', async () => {
    await loginAndLink();
    await run(['start', 'DEMO-7'], deps());
    const r = await run(['done', 'DEMO-7', '--force', '--no-commit'], deps());
    expect(r.out).toContain('nothing to commit');
    expect(seen.at(-1)?.body).toMatchObject({
      ref: 'DEMO-7',
      commit: null,
      files: [],
      force: true,
    });
  });
});

// [PCODE-247 | S15 | v0.1.0]
describe('branchTargets', () => {
  it('names the branches a command writes to', () => {
    expect(branchTargets('git checkout -b agent/a', 'main')).toEqual(['agent/a']);
    expect(branchTargets('git switch -c agent/b && git commit -am x', 'agent/b')).toEqual([
      'agent/b',
    ]);
    expect(branchTargets('git -C repo commit -m x', 'main')).toEqual(['main']);
    expect(branchTargets('git push', 'agent/c')).toEqual(['agent/c']);
    expect(branchTargets('git push origin HEAD:refs/heads/release/1', 'x')).toEqual(['release/1']);
    expect(branchTargets('git push -u origin +agent/d', 'x')).toEqual(['agent/d']);
    expect(branchTargets('git branch -d old', 'main')).toEqual([]);
    expect(branchTargets('git status; git log', 'main')).toEqual([]);
  });
});

describe('the Claude Code hooks', () => {
  it('stay silent outside a linked repository', async () => {
    expect(
      await hook('PreToolUse', {
        tool_name: 'Write',
        tool_input: { file_path: join(repo, 'a.ts') },
      }),
    ).toBe('');
  });

  it('refuse a code edit without an active task, allow docs and unguarded paths', async () => {
    await loginAndLink();
    const denied = JSON.parse(
      await hook('PreToolUse', {
        tool_name: 'Edit',
        tool_input: { file_path: join(repo, 'src', 'a.ts') },
      }),
    ) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(denied.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain('orq start');
    expect(
      await hook('PreToolUse', {
        tool_name: 'Write',
        tool_input: { file_path: join(repo, 'README.md') },
      }),
    ).toBe('');
    expect(
      await hook('PreToolUse', {
        tool_name: 'Write',
        tool_input: { file_path: join(tmpdir(), 'elsewhere.ts') },
      }),
    ).toBe('');
    await run(['start', 'DEMO-7'], deps());
    expect(
      await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } }),
    ).toBe('');
  });

  // [PCODE-247 | S15 | v0.1.0]
  it('keep a task assigned to an agent inside its files and branches', async () => {
    await loginAndLink();
    await run(['start', 'DEMO-9'], deps());
    const decision = async (input: Record<string, unknown>): Promise<string> => {
      const out = await hook('PreToolUse', input);
      return out
        ? (JSON.parse(out) as { hookSpecificOutput: { permissionDecisionReason: string } })
            .hookSpecificOutput.permissionDecisionReason
        : 'allowed';
    };
    expect(await decision({ tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } })).toBe(
      'allowed',
    );
    expect(await decision({ tool_name: 'Write', tool_input: { file_path: 'README.md' } })).toBe(
      "README.md is outside Developer agent's files scope (src/**). DEMO-9 is assigned to Developer agent.",
    );
    // the repository is on main: a commit there is refused, a new agent branch is fine
    expect(
      await decision({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }),
    ).toContain("main is outside Developer agent's branches scope (agent/*)");
    expect(
      await decision({ tool_name: 'Bash', tool_input: { command: 'git checkout -b agent/fix-1' } }),
    ).toBe('allowed');
    expect(
      await decision({ tool_name: 'Bash', tool_input: { command: 'git push origin feature/x' } }),
    ).toContain('feature/x is outside');
    expect(await decision({ tool_name: 'Bash', tool_input: { command: 'npm test' } })).toBe(
      'allowed',
    );
  });

  it('give the agent the fingerprint at session start and on every prompt', async () => {
    await loginAndLink();
    expect(await hook('SessionStart', { source: 'startup' })).toContain('No active task');
    activeRef = 'DEMO-7'; // started elsewhere (the web app or another session): the server is the truth
    const s = await hook('SessionStart', { source: 'startup' });
    expect(s).toContain('Active task: DEMO-7');
    expect(await hook('UserPromptSubmit', { prompt: 'go' })).toContain('[DEMO-7 | S03 | v0.2.0]');
  });

  it('report edits coalesced, remind of a missing fingerprint, report commits and tests', async () => {
    await loginAndLink();
    await run(['start', 'DEMO-7'], deps());
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    const reminder = await hook('PostToolUse', {
      tool_name: 'Write',
      tool_input: { file_path: join(repo, 'src', 'a.ts') },
    });
    expect(reminder).toContain('src/a.ts has no fingerprint of DEMO-7');
    writeFileSync(join(repo, 'src', 'b.ts'), '// [DEMO-7 | S03 | v0.2.0] Add the thing\n');
    expect(
      await hook('PostToolUse', {
        tool_name: 'Write',
        tool_input: { file_path: join(repo, 'src', 'b.ts') },
      }),
    ).toBe('');
    // the first edit went out at once, the second waits for the next report
    expect(progress().map((p) => p.body)).toEqual([
      { client: expect.any(String) as string, kind: 'edit', files: ['src/a.ts'] },
    ]);

    await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
    await hook('PostToolUseFailure', {
      tool_name: 'Bash',
      tool_input: { command: 'npx vitest run' },
    });
    git('add', '.');
    git('commit', '-q', '-m', 'wip');
    await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m wip' } });
    expect(progress().map((p) => p.body)).toEqual([
      expect.objectContaining({ kind: 'edit', files: ['src/a.ts'] }),
      expect.objectContaining({ kind: 'edit', files: ['src/b.ts'] }),
      expect.objectContaining({ kind: 'tests', command: 'npm test', green: true }),
      expect.objectContaining({ kind: 'tests', command: 'npx vitest run', green: false }),
      expect.objectContaining({ kind: 'commit', commit: git('rev-parse', 'HEAD') }),
    ]);
  });

  it('keep reports while the server is away and send them later', async () => {
    await loginAndLink();
    await run(['start', 'DEMO-7'], deps());
    up = false;
    await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm run check' } });
    expect(queueLength(repo)).toBe(1);
    up = true;
    await hook('Stop', {});
    expect(queueLength(repo)).toBe(0);
    expect(progress().at(-1)?.body).toMatchObject({ kind: 'tests', command: 'npm run check' });
  });

  it('install into .claude/settings.json next to the user’s own hooks, without doubling', async () => {
    await loginAndLink();
    mkdirSync(join(repo, '.claude'));
    writeFileSync(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({
        model: 'x',
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
      }),
    );
    const env = { PE_MAIN: 'C:/tools/pe/dist/main.js' };
    await run(['hooks', 'install'], deps('', env));
    await run(['hooks', 'install'], deps('', env));
    const s = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8')) as {
      model: string;
      hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    };
    expect(s.model).toBe('x');
    expect(s.hooks['Stop']?.map((e) => e.hooks[0]?.command)).toEqual([
      'say done',
      'node "C:/tools/pe/dist/main.js" hook Stop',
    ]);
    expect(s.hooks['PreToolUse']).toEqual([
      {
        matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash', // [PCODE-247 | S15 | v0.1.0]
        hooks: [
          {
            type: 'command',
            command: 'node "C:/tools/pe/dist/main.js" hook PreToolUse',
            timeout: 5,
          },
        ],
      },
    ]);
  });
});

// ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
describe('the hooks during a run VS Code opened', () => {
  const steps = (): Seen[] => seen.filter((x) => x.path.endsWith('/steps'));

  it('report each tool, a failure, an answer and the waiting as steps of the run', async () => {
    await loginAndLink();
    seen = [];
    await hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: join(repo, 'a.md') } });
    expect(steps()).toEqual([]); // no run open: nothing is sent
    mkdirSync(join(repo, '.orqiva', 'state'), { recursive: true });
    writeFileSync(join(repo, '.orqiva', 'state', 'run.json'), JSON.stringify({ runId: 'r1' }));
    await hook('SessionStart', {});
    await hook('PostToolUse', {
      tool_name: 'Read',
      tool_input: { file_path: join(repo, '.orqiva', 'description', 'description.md') },
    });
    await hook('PostToolUse', { tool_name: 'Glob', tool_input: { pattern: '**/*.md' } });
    await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git status' } });
    await hook('PostToolUseFailure', {
      tool_name: 'Write',
      tool_input: { file_path: join(repo, '.orqiva', 'plan.json') },
    });
    await hook('UserPromptSubmit', { prompt: 'use FastAPI' });
    await hook('Stop', {});
    expect(steps().every((x) => x.path === '/api/workspaces/' + WS + '/agent-runs/r1/steps')).toBe(
      true,
    );
    expect(steps().map((x) => x.body)).toEqual([
      { kind: 'note', text: 'Claude Code started' },
      {
        kind: 'tool_result',
        text: 'Read .orqiva/description/description.md',
        path: '.orqiva/description/description.md',
        tool: 'Read',
      },
      { kind: 'tool_result', text: 'Looked for files: **/*.md', tool: 'Glob' },
      { kind: 'tool_result', text: 'Ran: git status', tool: 'Bash' },
      { kind: 'error', text: 'Failed: Wrote .orqiva/plan.json' },
      { kind: 'note', text: 'Got an answer in VS Code' },
      { kind: 'note', text: 'Claude is waiting: it finished, or it asks something in VS Code' },
    ]);
    // what was typed stays on the machine
    expect(JSON.stringify(steps())).not.toContain('FastAPI');
    rmSync(join(repo, '.orqiva', 'state', 'run.json'));
  });
});

describe('orq hooks install over the hooks of the setup program', () => {
  // [PCODE-456 | S15 | v0.1.0] the single-file orq.mjs is ours too: replaced, never doubled
  it('replaces them, with the reading tools for the live run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-hooks-'));
    mkdirSync(join(dir, '.claude'));
    const old = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
            hooks: [
              { type: 'command', command: 'node \"C:/Orqiva/bin/orq.mjs\" hook PostToolUse' },
            ],
          },
        ],
      },
    };
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(old));
    installHooks(dir, 'C:/Orqiva/bin/orq.mjs');
    const s = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as {
      hooks: Record<string, { matcher?: string }[]>;
    };
    expect(s.hooks['PostToolUse']).toHaveLength(1);
    expect(s.hooks['PostToolUse']?.[0]?.matcher).toBe(RUN_TOOLS);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('unguarded paths', () => {
  it('match prefixes and patterns', () => {
    expect(matchesPath('scripts/x.sh', 'scripts/')).toBe(true);
    expect(matchesPath('scripts/x.sh', 'scripts')).toBe(true);
    expect(matchesPath('scriptsx/x.sh', 'scripts')).toBe(false);
    expect(matchesPath('src/gen/a.ts', 'src/*/a.ts')).toBe(true);
    expect(matchesPath('src/gen/x/a.ts', 'src/*/a.ts')).toBe(false);
    expect(matchesPath('src/gen/x/a.ts', 'src/**/a.ts')).toBe(true);
  });
});

// [PCODE-239 | S15 | v0.1.0] a local server over IPv4; HTTPS and other hosts as they are
describe('reaching a local server', () => {
  it('sends http://localhost to 127.0.0.1 and leaves everything else alone', async () => {
    const { viaIPv4 } = await import('../src/loop/api.js');
    expect(viaIPv4('http://localhost:8480/api/x')).toBe('http://127.0.0.1:8480/api/x');
    expect(viaIPv4('http://LOCALHOST/health')).toBe('http://127.0.0.1/health');
    expect(viaIPv4('https://localhost:8443/x')).toBe('https://localhost:8443/x');
    expect(viaIPv4('http://localhost.example.com/x')).toBe('http://localhost.example.com/x');
    expect(viaIPv4('http://orqiva.example.com')).toBe('http://orqiva.example.com');
  });
});
