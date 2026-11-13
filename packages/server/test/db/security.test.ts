// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-139 | S15 | v0.1.0] Add security findings with SARIF import, tasks for findings and the security gate ──
// ── [PCODE-140 | S15 | v0.1.0] Write our own secret scanner and code rules: orq scan ──
//    Why:  scans, findings, their tasks and the security gate against the real database.
import { readSarif, severityOfScore, toSarif, type FindingIn } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const leak: FindingIn = {
  rule: 'secret/aws-access-key',
  severity: 'critical',
  title: 'AWS access key in the code',
  message: 'An AWS access key id is written in src/config.ts',
  file: 'src/config.ts',
  line: 4,
  fingerprint: 'aws-1',
};
const evalUse: FindingIn = {
  rule: 'js/eval',
  severity: 'medium',
  // [PCODE-140 | S15 | v0.1.0] pe-scan: ignore js/eval -- a finding's title in test data, not a call
  title: 'eval() runs text as code',
  message: 'eval of user input',
  file: 'src/run.ts',
  line: 10,
  fingerprint: 'eval-1',
};

describe('SARIF', () => {
  it('goes out and comes back the same', () => {
    const [run] = readSarif(toSarif('pe-scan', '0.1.0', [leak, evalUse]));
    expect(run?.tool).toBe('pe-scan');
    expect(run?.findings).toEqual([leak, { ...evalUse, message: 'eval of user input' }]);
  });

  it('reads other tools: severity from security-severity, else the level', () => {
    const [run] = readSarif({
      runs: [
        {
          tool: {
            driver: {
              name: 'CodeQL',
              rules: [{ id: 'js/sql', properties: { 'security-severity': '8.8' } }],
            },
          },
          results: [
            {
              ruleId: 'js/sql',
              message: { text: 'SQL built from input' },
              locations: [
                {
                  physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 3 } },
                },
              ],
            },
            { ruleId: 'js/other', level: 'note', message: { text: 'minor' } },
          ],
        },
      ],
    });
    expect(run?.findings.map((f) => [f.rule, f.severity, f.file, f.line])).toEqual([
      ['js/sql', 'high', 'a.js', 3],
      ['js/other', 'low', '', null],
    ]);
    expect(run?.findings[0]?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect([9.8, 7, 4, 0.1, 0].map(severityOfScore)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
      'info',
    ]);
  });
});

describe.skipIf(!hasDatabase)('findings and the security gate (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Finding = {
    id: string;
    rule: string;
    status: string;
    itemRef: string | null;
    itemId: string | null;
    reason: string;
  };
  type Life = {
    phases: {
      gate?: {
        key: string;
        status: string;
        missing: string[];
        criteria: { key: string; met: boolean; evidence: string }[];
      };
    }[];
  };
  const g3 = async () =>
    (
      await t.call<{ lifecycle: Life }>(ada, 'GET', W('/projects/' + project + '/lifecycle'))
    ).body.lifecycle.phases.find((p) => p.gate?.key === 'g3')?.gate;
  const scan = (findings: FindingIn[], full = true) =>
    t.call<{ newCount: number; fixedCount: number }[]>(
      mo,
      'POST',
      W('/projects/' + project + '/scans'),
      {
        sarif: toSarif('pe-scan', '0.1.0', findings),
        full,
      },
    );

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/lifecycle'), {});
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps findings across scans, makes a task for the serious one, and blocks G3', async () => {
    const first = await scan([leak, evalUse]);
    expect(first.status).toBe(201);
    expect(first.body[0]).toMatchObject({ newCount: 2, fixedCount: 0 });
    const again = await scan([leak, evalUse]);
    expect(again.body[0]).toMatchObject({ newCount: 0, fixedCount: 0 });
    const list = await t.call<Finding[]>(mo, 'GET', W('/projects/' + project + '/findings'));
    expect(list.body.map((f) => [f.rule, f.status, f.itemRef])).toEqual([
      ['secret/aws-access-key', 'open', 'APP-1'],
      ['js/eval', 'open', null],
    ]);
    const task = await t.call<{ title: string; labelIds: string[] }>(
      mo,
      'GET',
      W('/items/' + (list.body[0]?.itemId ?? '')),
    );
    expect(task.body.title).toBe('Security (critical): AWS access key in the code');
    expect(task.body.labelIds).toHaveLength(1);
    const gate = await g3();
    expect(gate?.criteria.find((c) => c.key === 'security')).toMatchObject({
      met: false,
      evidence: '1 open high or critical security finding',
    });
  });

  it('needs an admin and a reason to accept a risk, and opens the gate when nothing serious is left', async () => {
    const [crit] = (
      await t.call<Finding[]>(mo, 'GET', W('/projects/' + project + '/findings?status=open'))
    ).body;
    const D = W('/findings/' + (crit?.id ?? '') + '/decision');
    expect(
      (await t.call(mo, 'POST', D, { status: 'accepted', reason: 'test key only, never used' }))
        .status,
    ).toBe(403);
    expect((await t.call(ada, 'POST', D, { status: 'accepted', reason: 'fine' })).status).toBe(400);
    const r = await t.call<Finding>(ada, 'POST', D, {
      status: 'false_positive',
      reason: 'It is the AWS documentation example key',
    });
    expect(r.body).toMatchObject({
      status: 'false_positive',
      reason: 'It is the AWS documentation example key',
    });
    expect((await g3())?.criteria.find((c) => c.key === 'security')?.met).toBe(true);
    await t.call(ada, 'POST', D, { status: 'open' });
    expect((await g3())?.criteria.find((c) => c.key === 'security')?.met).toBe(false);
  });

  it('marks what a full scan no longer finds as fixed, and reopens it when it returns', async () => {
    const r = await scan([evalUse]);
    expect(r.body[0]).toMatchObject({ newCount: 0, fixedCount: 1 });
    const fixed = await t.call<Finding[]>(
      mo,
      'GET',
      W('/projects/' + project + '/findings?status=fixed'),
    );
    expect(fixed.body.map((f) => [f.rule, f.reason])).toEqual([
      ['secret/aws-access-key', 'Not found by the full scan'],
    ]);
    expect((await g3())?.criteria.find((c) => c.key === 'security')?.met).toBe(true);
    // a partial scan closes nothing
    expect((await scan([], false)).body[0]).toMatchObject({ fixedCount: 0 });
    await scan([leak, evalUse]);
    const open = await t.call<Finding[]>(
      mo,
      'GET',
      W('/projects/' + project + '/findings?status=open'),
    );
    expect(open.body.map((f) => f.rule)).toEqual(['secret/aws-access-key', 'js/eval']);
    // the same task, not a second one
    expect(open.body[0]?.itemRef).toBe('APP-1');
  });
});
