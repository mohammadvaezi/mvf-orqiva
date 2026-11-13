// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-89 | S15 | v0.1.0] Define the activity event envelope and the transactional outbox ──
import { describe, expect, it } from 'vitest';
import { eventProblems, eventType, type ActivityEvent } from '../src/index.js';

const event: ActivityEvent = {
  specversion: '1.0',
  id: '5f0c6c1e-8b8e-4f7e-9a51-0c1f7f0b8d11',
  source: '/workspaces/w1',
  type: eventType('test_run', 'progressed'),
  time: '2026-10-03T09:00:00.000Z',
  subject: 'run-7',
  datacontenttype: 'application/json',
  workspaceid: 'w1',
  sequence: 42,
  data: {
    actor: { kind: 'integration', id: 'github-actions' },
    verb: 'progressed',
    object: { type: 'test_run', id: 'run-7', label: 'CI #7' },
    parent: { type: 'item', id: 'i-12', label: 'PCODE-12' },
    progress: { done: 31, total: 120, unit: 'tests' },
  },
};

describe('activity event envelope', () => {
  it('names the type after object and verb', () => {
    expect(event.type).toBe('orqiva.test_run.progressed');
  });

  it('accepts a well-formed event', () => {
    expect(eventProblems(event)).toEqual([]);
  });

  it('keeps CloudEvents extension names lowercase alphanumeric', () => {
    for (const key of Object.keys(event)) expect(key).toMatch(/^[a-z0-9]{1,20}$/);
  });

  it('reports every problem of a malformed event', () => {
    const bad = {
      ...event,
      specversion: '0.3',
      sequence: 0,
      data: { ...event.data, verb: 'teleported', progress: { done: 5, total: 2, unit: 'tests' } },
    };
    expect(eventProblems(bad)).toEqual([
      'specversion must be "1.0"',
      'sequence must be a positive integer',
      'data.verb is not a known verb',
      'data.progress needs 0 <= done <= total',
    ]);
  });
});
