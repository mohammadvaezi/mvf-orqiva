// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
//    Why:  agent steps read as the web reads them, runs are asked for on the task and stopped, findings land
//          on their file and line with a quick fix only when they have no task, the code-map lens says what
//          the map knows, and each criterion carries its tests' state.
import { describe, expect, it } from 'vitest';
import type { Api } from '../../../cli/src/loop/api';
import { AgentsModel, orderRuns, runLabel, stepLabel, type RunJson } from '../../src/server/agents';
import { FindingsProblems, problemsOf, type FindingJson } from '../../src/server/findings';
import { codeMapLabel, repoPath } from '../../src/views/codeMapLens';
import { acceptanceWithTests } from '../../src/webviews/taskDetail/serverData';
import { Diagnostic, Range } from '../mocks/vscode';

function fakeApi(answers: Record<string, unknown>): {
  api: Api;
  calls: [string, string, unknown][];
} {
  const calls: [string, string, unknown][] = [];
  const api = {
    call: <T>(method: string, path: string, body?: unknown): Promise<T> => {
      calls.push([method, path, body]);
      const key = Object.keys(answers).find((k) => (method + ' ' + path).startsWith(k));
      return Promise.resolve((key ? answers[key] : {}) as T);
    },
  };
  return { api, calls };
}

const run = (over: Partial<RunJson>): RunJson => ({
  id: 'r',
  agentId: 'a',
  agentName: 'Tester',
  itemId: null,
  itemRef: null,
  instruction: 'write tests',
  status: 'succeeded',
  error: '',
  summary: '',
  costMicros: 0,
  createdAt: '2026-10-08T09:00:00Z',
  startedAt: null,
  finishedAt: null,
  ...over,
});

const finding = (over: Partial<FindingJson>): FindingJson => ({
  id: 'f',
  tool: 'orq-scan',
  rule: 'secret',
  severity: 'high',
  title: 'A key in the code',
  message: '',
  file: 'src/a.ts',
  line: 12,
  status: 'open',
  itemRef: null,
  ...over,
});

describe('agents in VS Code', () => {
  it('words steps as the web trace does', () => {
    expect(
      stepLabel({
        kind: 'model',
        content: {
          blocks: [
            { type: 'tool_use', name: 'read_file' },
            { type: 'tool_use', name: 'grep' },
          ],
        },
      }),
    ).toBe('model: calls read_file, grep');
    expect(
      stepLabel({ kind: 'model', content: { blocks: [{ type: 'text', text: 'Done.' }] } }),
    ).toBe('model: Done.');
    expect(stepLabel({ kind: 'tool_result', content: {} })).toBe('tools ran');
    expect(stepLabel({ kind: 'approval', content: { tool: 'deploy' } })).toBe(
      'asks a person: deploy',
    );
    expect(stepLabel({ kind: 'decision', content: { approve: false, by: 'Ada' } })).toBe(
      'declined by Ada',
    );
    expect(stepLabel({ kind: 'error', content: { message: 'budget' } })).toBe('error: budget');
    expect(stepLabel({ kind: 'note', content: { text: 'paused' } })).toBe('paused');
  });

  it('lists active runs first and says what a run waits for', () => {
    const list = orderRuns([
      run({ id: '1', status: 'succeeded' }),
      run({ id: '2', status: 'waiting' }),
      run({ id: '3', status: 'running' }),
    ]);
    expect(list.map((r) => r.id)).toEqual(['2', '3', '1']);
    expect(runLabel(run({ status: 'waiting', itemRef: 'HEL-4' }))).toEqual({
      label: 'Tester · HEL-4',
      description: 'waits for your approval',
    });
    expect(runLabel(run({ status: 'failed', error: 'no key' })).description).toBe('failed: no key');
  });

  it('asks an agent on the task, stops a run and pauses all', async () => {
    const { api, calls } = fakeApi({ 'GET /api/workspaces/w/agent-runs': [] });
    const m = new AgentsModel(() => ({ api, workspaceId: 'w', projectId: 'p', server: 's/' }));
    await m.ask('a1', 'write tests', 'i1');
    await m.cancel(run({ id: 'r9' }));
    await m.pauseAll(true);
    expect(calls).toContainEqual([
      'POST',
      '/api/workspaces/w/projects/p/agent-runs',
      { agentId: 'a1', instruction: 'write tests', itemId: 'i1' },
    ]);
    expect(calls).toContainEqual(['POST', '/api/workspaces/w/agent-runs/r9/cancel', {}]);
    expect(calls).toContainEqual(['PUT', '/api/workspaces/w/agents/pause', { paused: true }]);
    expect(m.urlOf(run({ id: 'r9' }))).toBe('s/runs/r9');
    m.dispose();
  });
});

describe('findings as problems', () => {
  it('puts open findings on their file and line, naming their task', () => {
    const p = problemsOf([
      finding({ id: 'f1', file: './src/a.ts', line: 12, itemRef: 'HEL-9' }),
      finding({ id: 'f2', severity: 'low', line: null }),
      finding({ id: 'f3', status: 'fixed' }),
      finding({ id: 'f4', file: '' }),
    ]);
    expect([...p.keys()]).toEqual(['src/a.ts']);
    expect(p.get('src/a.ts')?.map((x) => [x.findingId, x.line, x.severity])).toEqual([
      ['f1', 11, 'error'],
      ['f2', 0, 'information'],
    ]);
    expect(p.get('src/a.ts')?.[0]?.message).toBe('A key in the code (HEL-9)');
  });

  it('offers to make a task only for a finding without one', async () => {
    const { api, calls } = fakeApi({
      'POST /api/workspaces/w/findings/f1/task': { itemRef: 'HEL-10' },
      'GET /api/workspaces/w/projects/p/findings': [],
    });
    const fp = new FindingsProblems(() => ({
      api,
      workspaceId: 'w',
      projectId: 'p',
      server: 's',
      root: '/r',
    }));
    const mk = (id: string, ref: string | null): Diagnostic =>
      Object.assign(new Diagnostic(new Range(0, 0, 0, 1), 'x'), { findingId: id, itemRef: ref });
    const actions = fp.provideCodeActions(
      {} as never,
      new Range(0, 0, 0, 0) as never,
      {
        diagnostics: [
          mk('f1', null),
          mk('f2', 'HEL-3'),
          new Diagnostic(new Range(0, 0, 0, 0), 'lint'),
        ],
      } as never,
    );
    expect(actions.map((a) => a.command?.arguments)).toEqual([['f1']]);
    expect(await fp.makeTask('f1')).toBe('HEL-10');
    expect(calls[0]).toEqual(['POST', '/api/workspaces/w/findings/f1/task', {}]);
    fp.dispose();
  });
});

describe('code map and tests', () => {
  it('says what the code map knows about a file', () => {
    expect(
      codeMapLabel({
        path: 'src/a.ts',
        lines: 300,
        complexity: 41,
        churn: 18,
        health: 6.5,
        hotspot: 72,
        owner: 'Ada',
        tasks: ['HEL-1', 'HEL-2', 'HEL-3', 'HEL-4'],
      }),
    ).toBe(
      '$(flame) hot spot 72 · health 6,5/10 · changed 18× · complexity 41 · mostly Ada · HEL-1, HEL-2, HEL-3 +1',
    );
    expect(repoPath('/r', '/r/src/a.ts')).toBe('src/a.ts');
    expect(repoPath('/r', '/elsewhere/a.ts')).toBeNull();
  });

  it('gives each criterion its tests state by id', () => {
    expect(
      acceptanceWithTests(
        [
          { id: 'k1', text: 'SMS sent', done: true },
          { id: 'k2', text: 'Opt-out', done: false },
        ],
        {
          items: [
            {
              itemId: 'i1',
              requirements: [
                { criterionId: 'k1', cases: 2, state: 'failing' },
                { criterionId: null, cases: 1, state: 'passing' },
              ],
            },
          ],
        },
        'i1',
      ),
    ).toEqual([
      { text: 'SMS sent', done: true, tests: { cases: 2, state: 'failing' } },
      { text: 'Opt-out', done: false },
    ]);
  });
});
