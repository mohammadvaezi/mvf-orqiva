// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
//    Why:  VS Code on the Orqiva server: the task panel's data comes from Orqiva (Markdown made safe,
//          criteria, comments for the client marked), comments go to the server, the inbox answers an
//          agent's approval and marks the entry done, the timer shows the running clock or today's hours,
//          and the lens cache never asks Plane for a linked folder.
import { describe, expect, it } from 'vitest';
import type { Api } from '../../../cli/src/loop/api';
import { InboxModel, ageText, isAgentApproval, type InboxEntry } from '../../src/server/inbox';
import { markdownToHtml } from '../../src/util/markdown';
import { clockText, hoursText, timerViewOf } from '../../src/views/timerStatus';
import { commentOnServer, taskDataFromServer } from '../../src/webviews/taskDetail/serverData';

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

describe('VS Code on the Orqiva server', () => {
  it('makes task Markdown safe HTML', () => {
    const html = markdownToHtml(
      '## Why\n\nPatients **forget** `slots`.\n\n- [ ] SMS sent\n- [x] opt-out\n\n<script>x</script> [docs](https://a.example)',
    );
    expect(html).toContain('<h4>Why</h4>');
    expect(html).toContain('<strong>forget</strong>');
    expect(html).toContain('<li>☐ SMS sent</li>');
    expect(html).toContain('<li>☑ opt-out</li>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="https://a.example">docs</a>');
  });

  it('builds the task panel from Orqiva, with criteria and comments for the client', async () => {
    const { api } = fakeApi({
      'GET /api/workspaces/w/items/i1/comments': [
        {
          id: 'c2',
          authorName: 'Ines',
          body: 'Looks good',
          createdAt: '2026-10-08T09:00:00Z',
          visibility: 'client',
        },
        {
          id: 'c1',
          authorName: 'Ada',
          body: 'Started',
          createdAt: '2026-10-07T09:00:00Z',
          visibility: 'team',
        },
      ],
      'GET /api/workspaces/w/items/i1/criteria': [{ id: 'k1', text: 'SMS sent', done: true }],
      'GET /api/workspaces/w/projects/p1/coverage': { items: [] },
      'GET /api/workspaces/w/items/i1': { id: 'i1', description: 'Send **SMS**' },
      'GET /api/workspaces/w/clients': [{ projects: [{ id: 'p1' }] }],
    });
    const d = await taskDataFromServer(
      { api, workspaceId: 'w', projectId: 'p1', server: 'http://localhost:8480/' },
      {
        id: 'i1',
        ref: 'HEL-1',
        title: 'Reminders',
        state: { name: 'In Progress', group: 'started' },
        priority: 'high',
        labels: ['sms'],
        done: false,
      },
      [],
      'HEL-1',
    );
    expect(d).toMatchObject({
      source: 'orqiva',
      clientProject: true,
      isActive: true,
      url: 'http://localhost:8480/items/i1',
      acceptance: [{ text: 'SMS sent', done: true }],
    });
    expect(d.descriptionHtml).toContain('<strong>SMS</strong>');
    expect(d.comments.map((c) => [c.who, c.forClient ?? false])).toEqual([
      ['Ada', false],
      ['Ines', true],
    ]);
  });

  it('writes a comment for the client only when asked', async () => {
    const { api, calls } = fakeApi({});
    const src = { api, workspaceId: 'w', projectId: 'p', server: 's' };
    await commentOnServer(src, 'i1', 'For you', true);
    await commentOnServer(src, 'i1', 'Internal', false);
    expect(calls).toEqual([
      ['POST', '/api/workspaces/w/items/i1/comments', { body: 'For you', visibility: 'client' }],
      ['POST', '/api/workspaces/w/items/i1/comments', { body: 'Internal' }],
    ]);
  });

  it('answers an agent’s approval from the inbox and marks it done', async () => {
    const entry: InboxEntry = {
      id: 'e1',
      kind: 'approval',
      projectKey: 'HEL',
      objectType: 'agent_run',
      objectId: 'r1',
      title: 'Coder waits',
      detail: '',
      priority: 'urgent',
      state: 'open',
      createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      readAt: null,
      url: '/runs/r1',
    };
    const { api, calls } = fakeApi({ 'GET /api/workspaces/w/inbox': { items: [] } });
    const model = new InboxModel(() => ({ api, workspaceId: 'w', server: 'http://h:1' }));
    expect(isAgentApproval(entry)).toBe(true);
    expect(ageText(entry.createdAt)).toBe('5 min');
    expect(model.urlOf(entry)).toBe('http://h:1/runs/r1');
    await model.decide(entry, false, 'not today');
    expect(calls.slice(0, 2)).toEqual([
      ['POST', '/api/workspaces/w/agent-runs/r1/decision', { approve: false, note: 'not today' }],
      ['PATCH', '/api/workspaces/w/inbox/e1', { action: 'done' }],
    ]);
    model.dispose();
  });

  it('shows the running timer or today’s hours', () => {
    const v = timerViewOf(
      {
        days: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'],
        perDay: [60, 0, 0, 345],
        total: 405,
        timer: { title: 'Reminders', itemRef: 'HEL-1', startedAt: '2026-10-08T07:00:00Z' },
      },
      '2026-10-08',
    );
    expect(v).toMatchObject({
      todayMinutes: 345,
      weekMinutes: 405,
      running: { label: 'HEL-1 Reminders' },
    });
    expect(clockText(2 * 3600_000 + 14 * 60_000 + 8_000)).toBe('2:14:08');
    expect(hoursText(345)).toBe('5,75 h');
  });
});
