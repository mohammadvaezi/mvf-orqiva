// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
//    Why:  a scan replaces the last one: components it did not find count zero, findings come back by
//          file with the token to use; the kit rule reaches the coding tool through the loop and the
//          developer agent through its run, and an agent that does not shape UI is spared it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelRequest,
} from '../../src/agents/provider.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ef'.repeat(32);

describe.skipIf(!hasDatabase)('the kit in the code (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let current: (ModelProvider & { requests: ModelRequest[] }) | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);

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
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'KIT', name: 'Kit' })
    ).body.id;
    await t.call(ada, 'PUT', P('/tokens/color.primary'), {
      type: 'color',
      valueLight: '#4f46e5',
    });
    for (const [name, status] of [
      ['Button', 'in_code'],
      ['Card', 'in_code'],
      ['OldModal', 'deprecated'],
    ] as const)
      await t.call(ada, 'POST', P('/components'), {
        name,
        status,
        description: '',
        codePath: 'src/ui/' + name + '.tsx',
        designUrl: '',
        props: [],
        usageCount: 5,
      });
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'anthropic',
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps the last scan: uses per component and findings by file', async () => {
    const r = await t.call<{ components: number; findings: number }>(ada, 'POST', P('/kit-scan'), {
      files: 40,
      usage: [{ name: 'Button', count: 12, files: [{ path: 'src/pages/Home.tsx', count: 7 }] }],
      findings: [
        { path: 'src/a.css', line: 3, kind: 'colour', value: '#4f46e5', token: 'color.primary' },
        { path: 'src/a.css', line: 9, kind: 'size', value: '13px', token: null },
        { path: 'src/b.tsx', line: 2, kind: 'colour', value: '#fff', token: null },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ components: 3, findings: 3 });
    const comps = (
      await t.call<{ name: string; usageCount: number; usageFiles: { path: string }[] }[]>(
        ada,
        'GET',
        P('/components'),
      )
    ).body;
    expect(comps.map((c) => [c.name, c.usageCount, c.usageFiles.length])).toEqual([
      ['Button', 12, 1],
      ['Card', 0, 0],
      ['OldModal', 0, 0],
    ]);
    const f = await t.call<{
      scan: { files: number; by: string };
      withToken: number;
      files: { path: string; findings: { line: number }[] }[];
    }>(ada, 'GET', P('/kit-findings'));
    expect(f.body.scan).toMatchObject({ files: 40, by: 'Ada' });
    expect(f.body.withToken).toBe(1);
    expect(f.body.files.map((x) => [x.path, x.findings.length])).toEqual([
      ['src/a.css', 2],
      ['src/b.tsx', 1],
    ]);
    await t.call(ada, 'POST', P('/kit-scan'), { files: 41, usage: [], findings: [] });
    expect((await t.call<{ files: unknown[] }>(ada, 'GET', P('/kit-findings'))).body.files).toEqual(
      [],
    );
  });

  it('gives the kit rule to the coding tool and to the developer agent, not to the analyst', async () => {
    const rule = (await t.call<{ rule: string }>(ada, 'GET', P('/kit-rule'))).body.rule;
    expect(rule).toContain('Components: Button (src/ui/Button.tsx), Card (src/ui/Card.tsx).');
    expect(rule).toContain('Deprecated, do not use: OldModal.');
    expect(rule).toContain('Tokens: color.primary #4f46e5.');

    const sprint = (await t.call<{ id: string }>(ada, 'POST', P('/sprints'), { name: 'Sprint 1' }))
      .body;
    await t.call(ada, 'POST', W('/sprints/' + sprint.id + '/start'));
    const item = await t.call<{ ref: string }>(ada, 'POST', P('/items'), {
      title: 'Restyle the checkout',
      description: 'Use the kit for the checkout page, its buttons and its colours.',
    });
    const start = await t.call<{ rules: { kit?: string } }>(ada, 'POST', W('/loop/start'), {
      ref: item.body.ref,
      client: 'test-cli',
    });
    expect(start.status).toBe(200);
    expect(start.body.rules.kit).toBe(rule);

    const agents = (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body;
    const runOf = async (key: string): Promise<string> => {
      current = scriptedProvider([]);
      const r = await t.call<{ id: string }>(ada, 'POST', P('/agent-runs'), {
        agentId: agents.find((x) => x.key === key)?.id,
        instruction: 'Look at the checkout',
      });
      const end = Date.now() + 10_000;
      for (;;) {
        const g = await t.call<{ run: { status: string } }>(
          ada,
          'GET',
          W('/agent-runs/' + r.body.id),
        );
        if (['succeeded', 'failed', 'waiting'].includes(g.body.run.status)) break;
        if (Date.now() > end) throw new Error('run stayed ' + g.body.run.status);
        await new Promise((res) => setTimeout(res, 50));
      }
      return current.requests[0]?.system ?? '';
    };
    expect(await runOf('developer')).toContain('UI kit rule:');
    expect(await runOf('analyst')).not.toContain('UI kit rule:');
  });
});
