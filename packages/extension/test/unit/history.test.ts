// ── [PCODE-59 | S11 | v0.1.0] Post deployment history to the Release item, including failures ──
//    Why:  posts_on_failure and posts_on_cancel, creates_release_item_when_missing, and a note that never
//          carries a token or a query string.
import { describe, expect, it } from 'vitest';
import {
  CANCELLED_LEAD,
  DEPLOY_LEAD,
  FAILED_LEAD,
  isHistoryLine,
  loadHistory,
  noteText,
  recordAttempt,
  sanitize,
  type Attempt,
  type HistoryDeps,
} from '../../src/deploy/history';
import type { DeployTarget } from '../../src/deploy/targets';
import type { Comment, Issue } from '../../src/plane/types';
import { Store } from '../../src/state/store';
import { clearRegisteredSecrets, registerSecret } from '../../src/util/redact';

const TARGET: DeployTarget = {
  name: 'prod',
  kind: 'coolify',
  url: 'https://c.example.test',
  appUuid: 'u',
};
const BASE: Attempt = { target: TARGET, version: '0.1.1', date: '2026-02-06' };

function store(): Store {
  const s = new Store();
  s.state.link = {
    project_id: 'p1',
    identifier: 'FIX',
    name: 'Fixture',
    workspace: 'ws',
    version: '0.1.1',
  };
  return s;
}

const issue = (seq: number, name: string): Issue => ({
  id: `i-${String(seq)}`,
  sequence_id: seq,
  name,
  state: 's',
  priority: 'low',
  labels: [],
});

const comment = (html: string, at: string): Comment => ({
  id: at,
  comment_html: html,
  created_at: at,
});

function deps(
  over: Partial<HistoryDeps> & {
    issues?: Issue[];
    comments?: Comment[];
    notes?: string[][];
    created?: string[];
  } = {},
): HistoryDeps {
  const notes = over.notes ?? [];
  const created = over.created ?? [];
  return {
    client: {
      getIssues: () => Promise.resolve(over.issues ?? []),
      getComments: () => Promise.resolve(over.comments ?? []),
      webUrl: (p, id) => `https://plane.example.test/${p}/${id ?? ''}`,
    },
    engine: {
      newTask: (input) => {
        created.push(input.title);
        return Promise.resolve({ ref: 'FIX-20', title: input.title, sprint: 'S11', url: 'u' });
      },
      note: (ref, text) => {
        notes.push([ref, text]);
        return Promise.resolve();
      },
    },
    store: store(),
    hasApiKey: () => Promise.resolve(true),
    ...over,
  };
}

describe('deployment history', () => {
  it('writes one line per outcome', () => {
    expect(
      noteText({
        ...BASE,
        result: {
          target: 'prod',
          kind: 'coolify',
          version: '0.1.1',
          ms: 103_000,
          detail: 'finished',
        },
      }),
    ).toBe('Deployed v0.1.1 to prod (coolify) — 1m 43s, 2026-02-06');
    expect(noteText({ ...BASE, error: 'Coolify reported the deployment as failed (dep-1).' })).toBe(
      'Deploy failed v0.1.1 to prod (coolify) — Coolify reported the deployment as failed (dep-1)., 2026-02-06',
    );
    expect(noteText({ ...BASE, cancelled: true })).toBe(
      'Deploy cancelled v0.1.1 to prod (coolify) — 2026-02-06',
    );
    for (const lead of [DEPLOY_LEAD, FAILED_LEAD, CANCELLED_LEAD])
      expect(isHistoryLine(`${lead} v0.1.1 to prod`)).toBe(true);
    expect(isHistoryLine('Started by Claude Code')).toBe(false);
  });

  // ── [PCODE-59 | S11 | v0.1.0] a note carries no token and no query string ──
  it('strips a token and a query string out of the note', () => {
    clearRegisteredSecrets();
    registerSecret('coolify_token_value_secret');
    const text = noteText({
      ...BASE,
      error:
        'POST https://c.example.test/api/v1/deploy?uuid=app-1&force=false failed with Bearer coolify_token_value_secret',
    });
    expect(text).not.toContain('coolify_token_value_secret');
    expect(text).not.toContain('uuid=app-1');
    expect(text).toContain('***');
    expect(sanitize('a\n\nb   c')).toBe('a b c');
    clearRegisteredSecrets();
  });

  // ── [PCODE-59 | S11 | v0.1.0] posts_on_failure / posts_on_cancel ──
  it('posts the note for a success, a failure and a cancellation', async () => {
    const notes: string[][] = [];
    const d = deps({ issues: [issue(20, 'Release v0.1.1')], notes });
    const ok = await recordAttempt(
      {
        ...BASE,
        result: { target: 'prod', kind: 'coolify', version: '0.1.1', ms: 5000, detail: 'finished' },
      },
      d,
    );
    expect(ok).toMatchObject({ posted: true, ref: 'FIX-20' });
    await recordAttempt({ ...BASE, error: 'ssh exited with 1' }, d);
    await recordAttempt({ ...BASE, cancelled: true }, d);
    expect(notes.map((n) => n[1]?.split(' ').slice(0, 2).join(' '))).toEqual([
      'Deployed v0.1.1',
      'Deploy failed',
      'Deploy cancelled',
    ]);
    expect(notes.every((n) => n[0] === 'FIX-20')).toBe(true);
  });

  // ── [PCODE-59 | S11 | v0.1.0] creates_release_item_when_missing ──
  it('creates the Release item when there is none, then notes on it', async () => {
    const notes: string[][] = [];
    const created: string[] = [];
    const r = await recordAttempt(
      {
        ...BASE,
        result: { target: 'prod', kind: 'coolify', version: '0.1.1', ms: 1000, detail: 'ok' },
      },
      deps({ issues: [], notes, created, section: '## v0.1.1\n\n- FIX-1 Something\n' }),
    );
    expect(created).toEqual(['Release v0.1.1']);
    expect(r).toMatchObject({ posted: true, ref: 'FIX-20' });
    expect(notes[0]?.[0]).toBe('FIX-20');
  });

  it('never turns a finished deploy into a failed one', async () => {
    const d = deps({ issues: [issue(20, 'Release v0.1.1')] });
    const failing: HistoryDeps = {
      ...d,
      engine: {
        newTask: d.engine.newTask,
        note: () => Promise.reject(new Error('Plane is unreachable')),
      },
    };
    const warnings: string[] = [];
    const r = await recordAttempt(
      { ...BASE, cancelled: true },
      { ...failing, log: (l) => warnings.push(l) },
    );
    expect(r.posted).toBe(false);
    expect(warnings[0]).toMatch(/deployment note failed: Plane is unreachable/);
    // offline: nothing is posted and nothing throws
    const offline = await recordAttempt(BASE, { ...d, hasApiKey: () => Promise.resolve(false) });
    expect(offline).toMatchObject({ posted: false, ref: null });
  });

  it('reads the history back from the Release item, newest first', async () => {
    const history = await loadHistory(
      '0.1.1',
      deps({
        issues: [issue(20, 'Release v0.1.1'), issue(21, 'Something else')],
        comments: [
          comment(
            '<p>Deployed v0.1.1 to prod (coolify) — 43s, 2026-02-05</p>',
            '2026-02-05T10:00:00Z',
          ),
          comment('<p>Started by Claude Code</p>', '2026-02-05T09:00:00Z'),
          comment(
            '<p>Deploy failed v0.1.1 to prod (coolify) — 401: token rejected, 2026-02-06</p>',
            '2026-02-06T08:00:00Z',
          ),
        ],
      }),
    );
    expect(history).toEqual([
      'Deploy failed v0.1.1 to prod (coolify) — 401: token rejected, 2026-02-06',
      'Deployed v0.1.1 to prod (coolify) — 43s, 2026-02-05',
    ]);
    expect(await loadHistory('9.9.9', deps({ issues: [issue(20, 'Release v0.1.1')] }))).toEqual([]);
    expect(
      await loadHistory('0.1.1', { ...deps(), hasApiKey: () => Promise.resolve(false) }),
    ).toEqual([]);
  });
});
