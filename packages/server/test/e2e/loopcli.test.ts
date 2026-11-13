// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-104 | S15 | v0.1.0] Move the fingerprint scanner and index into the server; every loop step emits an event ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  the exit check of team sprint T04, end to end: the real `orq` (its commands and its Claude Code
//          hooks) against the real server, in a real git repository, while a board is subscribed to the
//          live stream. orq start, a commit and orq done must reach the board as events, and the fingerprints
//          orq found must be in the server's index afterwards.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActivityEvent, ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnExec } from '../../../cli/src/install/exec.js';
import { run, type CliDeps } from '../../../cli/src/run.js';
import { RawWsClient } from '../wsclient.js';
import { startTestApp, type Person, type TestApp } from '../db/apphelper.js';
import { hasDatabase } from '../db/testdb.js';

describe.skipIf(!hasDatabase)('orq against the server, watched live (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let board: RawWsClient;
  let project = '';
  let repo = '';
  let home = '';
  let ref = '';
  let itemId = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  const deps = (stdin = ''): CliDeps => ({
    exec: spawnExec,
    loop: { cwd: repo, home, hostname: 'ada-laptop', env: {} },
    stdin: () => Promise.resolve(stdin),
  });
  const pe = async (...argv: string[]): Promise<string> => {
    const r = await run(argv, deps());
    expect(r.code, r.out).toBe(0);
    return r.out;
  };
  const hook = (event: string, input: Record<string, unknown>) =>
    run(['hook', event], deps(JSON.stringify({ cwd: repo, session_id: 'cc-1', ...input })));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const seen = (): ActivityEvent[] =>
    board
      .messages<ServerMessage>()
      .flatMap((m) => (m.type === 'event' && m.event.subject === itemId ? [m.event] : []));
  const arrives = async (type: string, test: (e: ActivityEvent) => boolean = () => true) => {
    await board.until(() => seen().some((e) => e.type === type && test(e)));
  };

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'DEMO', name: 'Demo' })
    ).body.id;
    const item = await t.call<{ id: string; ref: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/items'),
      {
        title: 'Export the report',
        description: 'What: a CSV export. Why: finance asks. Check: the export test passes.',
      },
    );
    ref = item.body.ref;
    itemId = item.body.id;
    const token = (await t.call<{ token: string }>(ada, 'POST', '/auth/tokens', { name: 'orq' }))
      .body.token;

    repo = mkdtempSync(join(tmpdir(), 'pe-e2e-repo-'));
    home = mkdtempSync(join(tmpdir(), 'pe-e2e-home-'));
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.email', 'ada@example.test'],
      ['config', 'user.name', 'Ada'],
      ['config', 'commit.gpgsign', 'false'],
      ['config', 'core.autocrlf', 'false'],
    ])
      git(...args);
    await pe('login', '--server', t.base, '--token', token);
    await pe('link', 'DEMO');

    board = await RawWsClient.open(t.port, { cookie: ada.cookie });
    board.sendJson({ type: 'subscribe', workspaceId: ada.workspaceId });
    await board.until(() => board.messages<ServerMessage>().some((m) => m.type === 'subscribed'));
  }, 60_000);

  afterAll(async () => {
    board.destroy();
    await t.stop();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('orq start reaches the board as the task starts', async () => {
    expect(await pe('start', ref)).toContain('[' + ref + ' | S00 | v0.1.0] Export the report');
    await arrives('orqiva.item.started', (e) => e.data.changes?.['state']?.to === 'In Progress');
  });

  it('an edit under the hooks and a commit reach the board', async () => {
    expect(
      (
        await hook('PreToolUse', {
          tool_name: 'Write',
          tool_input: { file_path: join(repo, 'src', 'export.ts') },
        })
      ).out,
    ).toBe('');
    mkdirSync(join(repo, 'src'));
    writeFileSync(
      join(repo, 'src', 'export.ts'),
      '// ── [' +
        ref +
        ' | S00 | v0.1.0] Export the report ──\nexport const csv = (rows: string[][]): string =>\n  // [' +
        ref +
        " | S00 | v0.1.0] quote every cell\n  rows.map((r) => r.map((c) => JSON.stringify(c)).join(',')).join('\\n');\n",
    );
    await hook('PostToolUse', {
      tool_name: 'Write',
      tool_input: { file_path: join(repo, 'src', 'export.ts') },
    });
    await arrives('orqiva.item.progressed', (e) =>
      JSON.stringify(e.data.changes?.['files']?.to).includes('src/export.ts'),
    );
    git('add', '.');
    git('commit', '-q', '-m', 'wip');
    await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m wip' } });
    const sha = git('rev-parse', 'HEAD');
    await arrives('orqiva.item.progressed', (e) => e.data.changes?.['commit']?.to === sha);
  });

  it('orq done reaches the board, and the server keeps the fingerprints', async () => {
    const out = await pe('done', ref);
    expect(out).toMatch(new RegExp(ref + ' → Review: 1 file\\(s\\) fingerprinted'));
    await arrives('orqiva.item.completed', (e) => e.data.changes?.['state']?.to === 'Review');

    const markers = await t.call<
      { path: string; line: number; kind: string; commit: string | null; sprint: string }[]
    >(ada, 'GET', W('/items/' + itemId + '/fingerprints'));
    expect(markers.body.map((m) => [m.path, m.line, m.kind, m.sprint])).toEqual([
      ['src/export.ts', 1, 'header', 'S00'],
      ['src/export.ts', 3, 'block', 'S00'],
    ]);
    expect(markers.body[0]?.commit).toBe(git('rev-parse', 'HEAD'));

    const index = await t.call<{
      files: { path: string; tasks: { ref: string; state: string }[] }[];
      markdown: string;
    }>(ada, 'GET', W('/projects/' + project + '/fingerprints?path=src/'));
    expect(index.body.files).toEqual([
      { path: 'src/export.ts', tasks: [expect.objectContaining({ ref, state: 'Review' })] },
    ]);
    expect(index.body.markdown).toContain('`src/export.ts:3` block');
    expect(
      (
        await t.call<{ files: unknown[] }>(
          ada,
          'GET',
          W('/projects/' + project + '/fingerprints?path=docs'),
        )
      ).body.files,
    ).toEqual([]);

    // the order the board saw it in
    const types = seen().map((e) => e.type);
    expect(types.indexOf('orqiva.item.started')).toBeLessThan(
      types.indexOf('orqiva.item.progressed'),
    );
    expect(types.lastIndexOf('orqiva.item.progressed')).toBeLessThan(
      types.indexOf('orqiva.item.completed'),
    );
  });

  it('finishing again replaces the markers and still tells the board', async () => {
    writeFileSync(
      join(repo, 'src', 'export.ts'),
      '// ── [' + ref + ' | S00 | v0.1.0] Export the report ──\nexport const csv = 1;\n',
    );
    const before = seen().filter((e) => e.type === 'orqiva.item.completed').length;
    await pe('done', ref);
    await board.until(
      () => seen().filter((e) => e.type === 'orqiva.item.completed').length > before,
    );
    const markers = await t.call<unknown[]>(ada, 'GET', W('/items/' + itemId + '/fingerprints'));
    expect(markers.body).toHaveLength(1);
  });
});
