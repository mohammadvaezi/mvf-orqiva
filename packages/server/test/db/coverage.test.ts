// ── [PCODE-137 | S15 | v0.1.0] Show coverage to requirements, the Tester agent and the G3 tests criterion ──
//    Why:  coverage, the Tester agent's drafts and G3's tests criterion against the real database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requirementState } from '../../src/api/coverage.js';
import { scriptedProvider, type ModelReply } from '../../src/agents/provider.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 10, output: 10 },
});

describe('a requirement’s state', () => {
  it('is failing before untested before passing', () => {
    expect(requirementState([])).toBe('uncovered');
    expect(requirementState([null])).toBe('untested');
    expect(requirementState(['passed', null])).toBe('untested');
    expect(requirementState(['passed', 'skipped'])).toBe('passing');
    expect(requirementState(['passed', 'blocked'])).toBe('failing');
    expect(requirementState(['skipped'])).toBe('untested');
  });
});

describe.skipIf(!hasDatabase)('coverage and the quality gate (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let item = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Coverage = {
    totals: { requirements: number; covered: number; passing: number; failing: number };
    items: {
      ref: string;
      requirements: { text: string; cases: number; state: string }[];
      otherCases: number;
    }[];
  };
  type Life = {
    phases: {
      gate?: { key: string; criteria: { key: string; met: boolean; evidence: string }[] };
    }[];
  };
  const testsCriterion = async () =>
    (
      await t.call<{ lifecycle: Life }>(ada, 'GET', W('/projects/' + project + '/lifecycle'))
    ).body.lifecycle.phases
      .find((p) => p.gate?.key === 'g3')
      ?.gate?.criteria.find((c) => c.key === 'tests');
  const run = async (results: { caseId: string; status: string }[]) => {
    const r = await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/test-runs'), {
      name: 'Suite',
    });
    await t.call(ada, 'POST', W('/test-runs/' + r.body.id + '/results'), { results });
    await t.call(ada, 'POST', W('/test-runs/' + r.body.id + '/finish'));
  };

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () =>
          Promise.resolve(
            scriptedProvider([
              say(
                '```json\n{"cases": [{"criterion": 1, "title": "Header row", "steps": "1. Export\\n2. Open", "expected": "One header"}, {"criterion": 9, "title": "Stray", "steps": "", "expected": ""}, {"title": ""}]}\n```',
              ),
            ]),
          ),
      },
    });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/lifecycle'), {});
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/items/' + item + '/criteria'), { text: 'One header row' });
    await t.call(ada, 'POST', W('/items/' + item + '/criteria'), { text: 'ISO dates' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets the Tester agent draft cases without storing them', async () => {
    const r = await t.call<{
      cases: { criterionId: string | null; title: string; steps: string }[];
    }>(ada, 'POST', W('/items/' + item + '/test-cases/draft'));
    expect(r.status).toBe(200);
    expect(r.body.cases.map((c) => [c.title, Boolean(c.criterionId)])).toEqual([
      ['Header row', true],
      ['Stray', false],
    ]);
    expect(r.body.cases[0]?.steps).toBe('1. Export\n2. Open');
    expect(
      (await t.call<unknown[]>(ada, 'GET', W('/projects/' + project + '/test-cases'))).body,
    ).toEqual([]);
  });

  it('shows each requirement covered, failing or passing', async () => {
    let cov = await t.call<Coverage>(ada, 'GET', W('/projects/' + project + '/coverage'));
    expect(cov.body.totals).toEqual({ requirements: 2, covered: 0, passing: 0, failing: 0 });
    const cases = (
      await t.call<{ id: string }[]>(ada, 'POST', W('/items/' + item + '/test-cases/from-criteria'))
    ).body;
    await t.call(ada, 'POST', W('/projects/' + project + '/test-cases'), {
      title: 'Exports fast',
      itemId: item,
    });
    await run([
      { caseId: cases[0]?.id ?? '', status: 'passed' },
      { caseId: cases[1]?.id ?? '', status: 'failed' },
    ]);
    cov = await t.call<Coverage>(ada, 'GET', W('/projects/' + project + '/coverage'));
    expect(cov.body.totals).toEqual({ requirements: 2, covered: 2, passing: 1, failing: 1 });
    expect(cov.body.items).toEqual([
      {
        itemId: item,
        ref: 'APP-1',
        title: 'Export',
        requirements: [
          {
            criterionId: expect.any(String) as string,
            text: 'One header row',
            cases: 1,
            state: 'passing',
          },
          {
            criterionId: expect.any(String) as string,
            text: 'ISO dates',
            cases: 1,
            state: 'failing',
          },
        ],
        otherCases: 1,
      },
    ]);
    // a failing run ticks nothing
    expect((await testsCriterion())?.met).toBe(false);
  });

  it('ticks G3’s tests criterion on a clean run and takes the tick back on a failing one', async () => {
    const cases = (
      await t.call<{ id: string; title: string }[]>(
        ada,
        'GET',
        W('/projects/' + project + '/test-cases'),
      )
    ).body;
    await run(cases.map((c) => ({ caseId: c.id, status: 'passed' })));
    expect(await testsCriterion()).toMatchObject({
      met: true,
      evidence: 'Test run "Suite": 3 passed, 0 skipped',
    });
    await run([{ caseId: cases[0]?.id ?? '', status: 'failed' }]);
    expect(await testsCriterion()).toMatchObject({
      met: false,
      evidence: 'Test run "Suite" failed: 1 failing',
    });
  });
});
