// ── [PCODE-286 | S15 | v0.1.0] T29.8 T29 exit check, docs and sprint close ──
//    Why:  the T29 exit as one team's path, end to end against the real server: a runbook imported from a
//          Markdown archive with its image, written further with a callout, math and a diagram; two people
//          editing it live with their edits merged; a mention that reaches the inbox; a named version;
//          the page found by global search; a file in the tree and who read which version; the page opened
//          to one task, where the agent's citation is checked; and the page out again as HTML and a ZIP.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { zip } from '../../src/export/zip.js';
import { zipEntries } from '../../src/files/docx.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const use = (
  name: string,
  input: Record<string, unknown>,
  id = name + '-1',
): ModelReply['content'][number] => ({ type: 'tool_use', id, name, input });
const turn = (content: ModelReply['content']): ModelReply => ({
  content,
  stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
  usage: { input: 100, output: 50 },
});

describe.skipIf(!hasDatabase)('T29 exit: documents (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let project = '';
  let page = '';
  let current: ModelProvider | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const D = (p: string): string => W('/docs/' + page + p);
  type Live = { rev: number; body: string; conflicts: number };
  type Node = { id: string; parentId: string | null; title: string; files: { name: string }[] };

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    bo = await t.signup('Bo');
    await t.call(ada, 'POST', W('/members'), { email: bo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' })
    ).body.id;
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'anthropic',
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('imports a runbook from a Markdown archive, its image with it', async () => {
    const archive = zip([
      {
        name: 'ops/Rollback.md',
        data: Buffer.from(
          '# Rollback runbook\n\nRoll back within ten minutes.\n\nDeploys run on Monday.\n\n![flow](img/flow.png)\n',
        ),
      },
      { name: 'ops/img/flow.png', data: PNG },
    ]);
    const up = await fetch(t.base + W('/files?name=ops.zip&projectId=' + project), {
      method: 'POST',
      headers: { cookie: ada.cookie, 'content-type': 'application/zip' },
      body: archive,
    });
    const fileId = ((await up.json()) as { id: string }).id;
    const r = await t.call<{ pages: number; files: number; firstPageId: string }>(
      ada,
      'POST',
      P('/docs/import'),
      { fileId },
    );
    expect(r.body).toMatchObject({ pages: 1, files: 1 });
    page = r.body.firstPageId;
    const tree = (await t.call<Node[]>(ada, 'GET', P('/docs'))).body;
    expect(tree.find((n) => n.id === page)).toMatchObject({
      title: 'Rollback runbook',
      files: [{ name: 'flow.png' }],
    });
  });

  it('is edited by two people at once, their edits merged into one version', async () => {
    const start = await t.call<Live & { baseVersion: number }>(ada, 'POST', D('/live'));
    await t.call(bo, 'POST', D('/live'));
    const blocks =
      '\n> [!WARNING] Before you start\n> Tell the on-call.\n\n$$e^{i\\pi} + 1 = 0$$\n\n```mermaid\ngraph LR\nA[Deploy] --> B[Rollback]\n```\n';
    await t.call<Live>(ada, 'POST', D('/live/sync'), {
      rev: start.body.rev,
      title: 'Rollback runbook',
      body: start.body.body + blocks,
    });
    const both = await t.call<Live>(bo, 'POST', D('/live/sync'), {
      rev: start.body.rev,
      title: 'Rollback runbook',
      body: start.body.body.replace('Monday', 'Tuesday'),
    });
    expect(both.body.conflicts).toBe(0);
    expect(both.body.body).toContain('Deploys run on Tuesday.');
    expect(both.body.body).toContain('> [!WARNING] Before you start');
    const saved = await t.call<{ version: number }>(bo, 'POST', D('/live/save'), {
      rev: both.body.rev,
      title: 'Rollback runbook',
      body: both.body.body,
    });
    expect(saved.body.version).toBe(2);
  });

  it('tells the person a comment names, and keeps a named version', async () => {
    await t.call(ada, 'POST', D('/comments'), {
      body: 'Could @' + (bo.email.split('@')[0] ?? '') + ' check the diagram?',
    });
    const inbox = (await t.call<{ items: { url: string }[] }>(bo, 'GET', W('/inbox'))).body.items;
    expect(inbox.some((i) => i.url.includes('?page=' + page))).toBe(true);
    await t.call(ada, 'PATCH', D('/versions/2'), { name: 'Agreed with ops' });
    const v = await t.call<{ name: string; body: string }>(ada, 'GET', D('/versions/2'));
    expect(v.body.name).toBe('Agreed with ops');
    expect(v.body.body).toContain('Tuesday');
    const v1 = await t.call<{ body: string }>(ada, 'GET', D('/versions/1'));
    expect(v1.body.body).toContain('Monday');
  });

  it('is found by search, and counts who read which version', async () => {
    const s = await t.call<{ docs: { id: string }[] }>(bo, 'GET', W('/search?q=rollback'));
    expect(s.body.docs.map((d) => d.id)).toContain(page);
    await t.call(bo, 'GET', D(''));
    const r = await t.call<{ readers: { name: string; version: number }[] }>(
      ada,
      'GET',
      D('/readers'),
    );
    expect(r.body.readers).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: bo.name, version: 2 })]),
    );
  });

  it('opens to one task, where the agent’s citation is checked', async () => {
    const item = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), { title: 'Roll back the release' })
    ).body.id;
    await t.call(ada, 'POST', D('/tasks'), { ref: 'OPS-1' });
    const agents = await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'));
    const documenter = agents.body.find((a) => a.key === 'documenter')?.id ?? '';
    current = scriptedProvider([
      turn([
        use('read_doc', { page: 'Rollback runbook', cite: 'roll back within TEN minutes' }),
        use('read_doc', { page: 'Rollback runbook', cite: 'within five minutes' }, 'read-2'),
      ]),
      turn([{ type: 'text', text: 'Read.' }]),
    ]);
    const run = await t.call<{ id: string }>(ada, 'POST', P('/agent-runs'), {
      agentId: documenter,
      instruction: 'How fast do we roll back?',
      itemId: item,
    });
    expect(run.status).toBe(201);
    const end = Date.now() + 10_000;
    for (;;) {
      const g = await t.call<{ run: { status: string } }>(
        ada,
        'GET',
        W('/agent-runs/' + run.body.id),
      );
      if (['succeeded', 'failed', 'waiting'].includes(g.body.run.status)) {
        expect(g.body.run.status).toBe('succeeded');
        break;
      }
      if (Date.now() > end) throw new Error('run stayed ' + g.body.run.status);
      await new Promise((res) => setTimeout(res, 50));
    }
    const k = await t.call<{ reads: { pageId: string; passage: string; citedOk: boolean }[] }>(
      ada,
      'GET',
      P('/knowledge'),
    );
    const mine = k.body.reads.filter((x) => x.pageId === page);
    expect(mine.map((x) => [x.passage, x.citedOk]).sort()).toEqual([
      ['roll back within TEN minutes', true],
      ['within five minutes', false],
    ]);
  });

  it('leaves as one HTML file and as a ZIP of the wiki', async () => {
    const get = (p: string) => fetch(t.base + p, { headers: { cookie: ada.cookie } });
    const html = await (await get(D('/export?format=html'))).text();
    expect(html).toContain('<aside class="callout warning"><strong>Before you start</strong>');
    expect(html).toContain('<math');
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('src="data:image/png;base64,');
    const zipped = Buffer.from(await (await get(P('/docs/export'))).arrayBuffer());
    const names = zipEntries(zipped).map((e) => e.name);
    expect(names).toContain('Rollback runbook.md'); // the archive's one top folder is not kept
    expect(names.some((n) => n.endsWith('-flow.png'))).toBe(true);
  });
});
