// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-142 | S15 | v0.1.0] Show security findings in the web app with Security agent triage ──
//    Why:  the Security agent's triage is kept as a note and changes nothing else about the finding.
import { toSarif } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelProvider } from '../../src/agents/provider.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('Security agent triage (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let current: (ModelProvider & { requests: { system: string; messages: unknown[] }[] }) | null =
    null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

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
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/scans'), {
      sarif: toSarif('pe-scan', '0.1.0', [
        {
          rule: 'js/shell-from-string',
          severity: 'high',
          title: 'Shell command built from a string',
          // pe-scan: ignore js/shell-from-string -- a finding's message in test data, not a call
          message: 'exec(`git log ${ref}`)',
          file: 'src/git.ts',
          line: 12,
          fingerprint: 'f1',
        },
      ]),
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps the agent’s note with the finding and its run', async () => {
    const [f] = (
      await t.call<{ id: string; status: string }[]>(
        ada,
        'GET',
        W('/projects/' + project + '/findings'),
      )
    ).body;
    current = scriptedProvider([
      {
        content: [
          {
            type: 'text',
            text: 'High is right: ref comes from the request. Use execFile with an argument list.',
          },
        ],
        stopReason: 'end_turn',
        usage: { input: 300, output: 40 },
      },
    ]);
    const r = await t.call<{
      status: string;
      triage: string;
      triageRunId: string | null;
      triagedAt: string | null;
    }>(ada, 'POST', W('/findings/' + (f?.id ?? '') + '/triage'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'open',
      triage: 'High is right: ref comes from the request. Use execFile with an argument list.',
    });
    expect(r.body.triageRunId).toBeTruthy();
    expect(r.body.triagedAt).toBeTruthy();
    const sent = JSON.stringify(current.requests[0]?.messages);
    expect(current.requests[0]?.system).toContain('[orqiva:triage]');
    expect(sent).toContain('Where: src/git.ts:12');
    const run = await t.call<{ run: { agentName: string } }>(
      ada,
      'GET',
      W('/agent-runs/' + (r.body.triageRunId ?? '')),
    );
    expect(run.body.run.agentName).toBe('Security agent');
  });
});
