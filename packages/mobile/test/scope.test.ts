// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '@orqiva/shared';
import { readAt, sprintDay, touches } from '../src/scope';

const ev = (
  type: string,
  o: { subject?: string; project?: string; object?: string; parent?: string },
): ActivityEvent =>
  ({
    specversion: '1.0',
    id: 'e',
    source: '/workspaces/w',
    type,
    time: '2026-10-10T10:00:00.000Z',
    subject: o.subject ?? 'x',
    datacontenttype: 'application/json',
    workspaceid: 'w',
    sequence: 1,
    ...(o.project ? { projectid: o.project } : {}),
    data: {
      actor: { kind: 'user', id: 'u', name: 'Ada' },
      verb: 'updated',
      object: { type: type.split('.')[1], id: o.object ?? o.subject ?? 'x' },
      ...(o.parent ? { parent: { type: 'item', id: o.parent } } : {}),
    },
  }) as ActivityEvent;

describe('which events touch a screen', () => {
  it('reloads the map for work, gates, deploys, tests, risks and agents, not for everything', () => {
    for (const type of [
      'orqiva.item.moved',
      'orqiva.deploy.failed',
      'orqiva.agent_run.started',
      'prodengine.sprint.started',
    ])
      expect(touches(ev(type, {}), { kind: 'map' })).toBe(true);
    for (const type of [
      'orqiva.comment.created',
      'orqiva.member.created',
      'orqiva.timesheet.updated',
    ])
      expect(touches(ev(type, {}), { kind: 'map' })).toBe(false);
  });

  it('reloads a project for its own events only', () => {
    expect(
      touches(ev('orqiva.item.moved', { project: 'p1' }), { kind: 'project', projectId: 'p1' }),
    ).toBe(true);
    expect(
      touches(ev('orqiva.item.moved', { project: 'p2' }), { kind: 'project', projectId: 'p1' }),
    ).toBe(false);
  });

  it('reloads a task for the task and the comments on it', () => {
    const scope = { kind: 'item', itemId: 'i1' } as const;
    expect(touches(ev('orqiva.item.updated', { subject: 'i1' }), scope)).toBe(true);
    expect(touches(ev('orqiva.comment.created', { subject: 'c9', parent: 'i1' }), scope)).toBe(
      true,
    );
    expect(touches(ev('orqiva.comment.created', { subject: 'c9', parent: 'i2' }), scope)).toBe(
      false,
    );
  });
});

describe('sprint days', () => {
  it('counts the days of a sprint from 1, and stays inside it', () => {
    expect(sprintDay('2026-10-05', '2026-10-16', new Date(2026, 9, 10, 15))).toEqual({
      day: 6,
      days: 12,
      share: 0.5,
    });
    expect(sprintDay('2026-10-05', '2026-10-16', new Date(2026, 9, 1))).toMatchObject({ day: 0 });
    expect(sprintDay('2026-10-05', '2026-10-16', new Date(2026, 10, 1))).toMatchObject({
      day: 12,
      share: 1,
    });
    expect(sprintDay(null, '2026-10-16', new Date())).toBeNull();
  });

  it('says when a screen was read', () => {
    const now = new Date(2026, 9, 10, 15, 0);
    expect(readAt(new Date(2026, 9, 10, 9, 5).toISOString(), now)).toBe('09:05');
    expect(readAt(new Date(2026, 9, 9, 9, 5).toISOString(), now)).toBe('9.10. 09:05');
    expect(readAt(null, now)).toBe('');
  });
});
