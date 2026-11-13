// ── [PCODE-231 | S15 | v0.1.0] T22.4 A day on the phone: exit test, docs and sprint close ──
//    Why:  the T22 exit: a manager follows a sprint from the phone only, for one day. Ada sets the sprint
//          up, pairs her phone and signs out of the web app; from then on she uses nothing but the calls
//          the app makes, with its device token (the map, the sprint, a task, comments, a state and an
//          assignee change, presence and the live feed, as in packages/mobile/src/load.ts and the
//          screens). Bob and Eve work in the web app. At the end of the day the phone has seen every
//          step of it as it happened, and the team has seen the manager on the phone.
import {
  Feed,
  type ActivityEvent,
  type FeedState,
  type KeyValueStore,
  type PresenceEntry,
  type SocketLike,
} from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

class MemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  getItem(k: string): Promise<string | null> {
    return Promise.resolve(this.map.get(k) ?? null);
  }
  setItem(k: string, v: string): Promise<void> {
    this.map.set(k, v);
    return Promise.resolve();
  }
  removeItem(k: string): Promise<void> {
    this.map.delete(k);
    return Promise.resolve();
  }
}

type HeaderWebSocket = new (url: string, init: { headers: Record<string, string> }) => SocketLike;

async function until(check: () => boolean, what = 'a condition', ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 20));
  }
}

interface SprintJson {
  id: string;
  status: string;
  itemCount: number;
  doneCount: number;
  estimateTotal: number;
  estimateDone: number;
}
interface ItemJson {
  id: string;
  ref: string;
  stateId: string;
  assigneeId: string | null;
  projectId: string;
}

describe.skipIf(!hasDatabase)('a day on the phone (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let eve: Person;
  let project = '';
  let token = '';
  const refs = new Map<string, string>();
  const states = new Map<string, string>();
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  /** what the app does: a call with the device token */
  const phone = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(t.base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!r.ok) throw new Error(method + ' ' + path + ' → ' + String(r.status));
    return (await r.json()) as T;
  };
  /** the sprint screen's reads (loadProject) */
  const sprintScreen = async () => {
    const [proj, sprints] = await Promise.all([
      phone<{ name: string }>('GET', W('/projects/' + project)),
      phone<SprintJson[]>('GET', W('/projects/' + project + '/sprints')),
      phone('GET', W('/members')),
    ]);
    const sprint = sprints.find((s) => s.status === 'active');
    if (!sprint) throw new Error('no running sprint');
    const [items] = await Promise.all([
      phone<ItemJson[]>('GET', W('/projects/' + project + '/items?sprintId=' + sprint.id)),
      phone('GET', W('/sprints/' + sprint.id + '/capacity')),
    ]);
    return { proj, sprint, items };
  };
  /** the task screen's reads (loadTask) */
  const taskScreen = async (ref: string) => {
    const id = refs.get(ref) ?? '';
    const item = await phone<ItemJson>('GET', W('/items/' + id));
    const [, , , comments, history] = await Promise.all([
      phone('GET', W('/projects/' + item.projectId)),
      phone('GET', W('/members')),
      phone('GET', W('/items/' + id + '/criteria')),
      phone<{ body: string; authorName: string }[]>('GET', W('/items/' + id + '/comments')),
      phone<ActivityEvent[]>('GET', W('/items/' + id + '/history')),
    ]);
    return { item, comments, history };
  };

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    eve = await t.signup('Eve');
    for (const p of [bob, eve])
      await t.call(ada, 'POST', W('/members'), { email: p.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'Patient app' })
    ).body.id;
    const detail = await t.call<{ states: { id: string; name: string }[] }>(
      ada,
      'GET',
      W('/projects/' + project),
    );
    for (const s of detail.body.states) states.set(s.name, s.id);
    const today = new Date();
    const day = (n: number): string => {
      const d = new Date(today);
      d.setDate(today.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 12',
        startDate: day(-3),
        endDate: day(6),
      })
    ).body.id;
    for (const [title, points] of [
      ['Sign-in with email', 3],
      ['Appointment list', 5],
      ['Move an appointment', 5],
      ['Reminder settings', 2],
      ['Export as PDF', 3],
    ] as const) {
      const it = await t.call<ItemJson>(ada, 'POST', W('/projects/' + project + '/items'), {
        title,
        estimate: points,
        sprintId: sprint,
      });
      refs.set(it.body.ref, it.body.id);
    }
    await t.call(ada, 'PATCH', W('/items/' + (refs.get('APP-3') ?? '')), { assigneeId: bob.id });
    expect((await t.call(ada, 'POST', W('/sprints/' + sprint + '/start'))).status).toBe(200);

    // the phone, paired; then the web app is signed out: the rest of the day is the phone's
    const code = (await t.call<{ code: string }>(ada, 'POST', W('/devices/pairing'))).body.code;
    token = (
      await t.call<{ token: string }>(null, 'POST', '/auth/devices/pair', {
        code,
        device: 'Ada’s phone',
      })
    ).body.token;
    expect((await t.call(ada, 'POST', '/auth/logout')).status).toBe(200);
    expect((await t.call(ada, 'GET', W('/projects'))).status).toBe(401);
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('follows the sprint all day from the phone', { timeout: 30_000 }, async () => {
    // morning: the app opens, live
    const feedStates: FeedState[] = [];
    let people: PresenceEntry[] = [];
    const seen: ActivityEvent[] = [];
    const feed = new Feed({
      server: t.base,
      workspaceId: ada.workspaceId,
      store: new MemoryStore(),
      open: (path) => {
        const WS = WebSocket as unknown as HeaderWebSocket;
        return new WS(t.base.replace(/^http/, 'ws') + path, {
          headers: { Authorization: 'Bearer ' + token },
        });
      },
      fetchPage: () => phone('GET', W('/activity?limit=100')),
      onChange: (s) => feedStates.push(s),
      onEvent: (e) => seen.push(e),
      onPresence: (p) => {
        people = p;
      },
      saveDelayMs: 0,
    });
    await feed.open();
    await until(() => feedStates.at(-1)?.status === 'live');
    const feedHas = (pred: (e: ActivityEvent) => boolean) => () => seen.some(pred);

    // the map, then the sprint: day 4 of 10, nothing done yet
    const map = await phone<{ projects: { id: string; health: string }[] }>(
      'GET',
      W('/command-center'),
    );
    expect(map.projects.map((p) => p.id)).toContain(project);
    let screen = await sprintScreen();
    expect(screen.sprint).toMatchObject({ itemCount: 5, doneCount: 0, estimateTotal: 18 });

    // 09:10 Bob starts APP-1 in the web app; the phone sees it as it happens
    await t.call(bob, 'PATCH', W('/items/' + (refs.get('APP-1') ?? '')), {
      stateId: states.get('In Progress'),
      assigneeId: bob.id,
    });
    await until(feedHas((e) => e.subject === refs.get('APP-1') && e.type.endsWith('.updated')));

    // 10:30 Bob asks a question on it; the manager reads it on the task and answers from the phone
    await t.call(bob, 'POST', W('/items/' + (refs.get('APP-1') ?? '') + '/comments'), {
      body: 'Do we send the sign-in link to unverified addresses too?',
    });
    await until(
      feedHas((e) => e.data.parent?.id === refs.get('APP-1') && e.type.includes('comment')),
    );
    let task = await taskScreen('APP-1');
    expect(task.comments.map((c) => c.authorName)).toEqual(['Bob']);
    feed.setPresence({
      projectId: project,
      itemId: refs.get('APP-1') ?? null,
      state: 'viewing',
      device: 'phone',
    });
    await phone('POST', W('/items/' + (refs.get('APP-1') ?? '') + '/comments'), {
      body: 'Only to verified ones; the others get the verification mail first.',
    });
    const bobReads = await t.call<{ authorName: string }[]>(
      bob,
      'GET',
      W('/items/' + (refs.get('APP-1') ?? '') + '/comments'),
    );
    expect(bobReads.body.map((c) => c.authorName)).toEqual(['Bob', 'Ada']);

    // the team sees the manager there, on the phone (Bob's web app on the same task)
    const bobLive = new (WebSocket as unknown as HeaderWebSocket)(
      t.base.replace(/^http/, 'ws') + '/live',
      { headers: { cookie: bob.cookie } },
    );
    const bobPeople: PresenceEntry[][] = [];
    let bobSubscribed = false;
    bobLive.onmessage = (m) => {
      const msg = JSON.parse(String(m.data)) as { type: string; people?: PresenceEntry[] };
      if (msg.type === 'presence' && msg.people) bobPeople.push(msg.people);
      if (msg.type === 'subscribed') bobSubscribed = true;
    };
    await new Promise<void>((r) => {
      bobLive.onopen = () => {
        r();
      };
    });
    bobLive.send(JSON.stringify({ type: 'subscribe', workspaceId: ada.workspaceId }));
    // like every client, Bob reports where he is once the server has subscribed him
    await until(() => bobSubscribed, 'Bob subscribed');
    bobLive.send(
      JSON.stringify({
        type: 'presence',
        workspaceId: ada.workspaceId,
        projectId: project,
        itemId: refs.get('APP-1'),
        state: 'editing',
      }),
    );
    await until(
      () =>
        (bobPeople.at(-1) ?? []).some(
          (p) => p.name === 'Ada' && p.itemId === refs.get('APP-1') && p.device === 'phone',
        ),
      'Bob to see Ada on the phone',
    );
    // and the phone sees Bob editing it
    await until(
      () => people.some((p) => p.name === 'Bob' && p.state === 'editing'),
      'the phone to see Bob',
    );
    bobLive.close();

    // 13:00 Eve finishes APP-2; the sprint on the phone counts it
    await t.call(eve, 'PATCH', W('/items/' + (refs.get('APP-2') ?? '')), {
      stateId: states.get('Done'),
      assigneeId: eve.id,
    });
    await until(
      feedHas((e) => e.subject === refs.get('APP-2')),
      'the phone to see APP-2 done',
    );
    screen = await sprintScreen();
    expect(screen.sprint).toMatchObject({ doneCount: 1, estimateDone: 5 });

    // 15:00 Bob is stuck; the manager hands APP-3 to Eve and parks APP-4, from the phone
    await phone('PATCH', W('/items/' + (refs.get('APP-3') ?? '')), { assigneeId: eve.id });
    await phone('PATCH', W('/items/' + (refs.get('APP-4') ?? '')), {
      stateId: states.get('Blocked'),
    });
    const eveSees = await t.call<ItemJson>(eve, 'GET', W('/items/' + (refs.get('APP-3') ?? '')));
    expect(eveSees.body.assigneeId).toBe(eve.id);

    // evening: the map shows Bob's work in progress, the sprint the day's result, the task its story
    await until(feedHas((e) => e.subject === refs.get('APP-4')));
    const evening = await phone<{
      projects: { id: string; cards: { ref: string; assignee: { name: string } | null }[] }[];
    }>('GET', W('/command-center'));
    const cards = evening.projects.find((p) => p.id === project)?.cards ?? [];
    expect(cards.find((c) => c.ref === 'APP-1')?.assignee?.name).toBe('Bob');
    screen = await sprintScreen();
    expect(screen.sprint).toMatchObject({ doneCount: 1, estimateDone: 5, itemCount: 5 });
    expect(screen.items.find((i) => i.ref === 'APP-4')?.stateId).toBe(states.get('Blocked'));
    task = await taskScreen('APP-1');
    expect(task.comments).toHaveLength(2);
    expect(task.history.length).toBeGreaterThanOrEqual(3);

    // the feed saw the whole day, each event once
    const seqs = (feedStates.at(-1)?.events ?? []).map((e) => e.sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seen.length).toBeGreaterThanOrEqual(6);
    await feed.close();
  });
});
