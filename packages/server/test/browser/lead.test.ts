// ── [PCODE-434 | S15 | v0.1.0] T37 low: Board WIP limits and custom-field filters in the screen ──
// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  the lead's sprint planning, in the browser: in a project with tasks waiting in the backlog,
//          a new sprint from the Planning tab, tasks moved into it from the backlog, one handed to a
//          developer in the task drawer, and the sprint's board showing them; nothing on the way writes
//          an error to the console.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { appErrors, canRun, signIn, startJourney, type Journey } from './journey.js';

describe.skipIf(!canRun)('journey: the lead (browser)', () => {
  let j: Journey;
  let lena: Person;
  let dev: Person;
  let project = '';
  const tasks: { id: string; ref: string; title: string }[] = [];
  const W = (p: string): string => '/api/workspaces/' + lena.workspaceId + p;

  beforeAll(async () => {
    j = await startJourney();
    lena = await j.t.signup('Lena Lead');
    dev = await j.t.signup('Dave Developer');
    await j.t.call(lena, 'POST', W('/members'), { email: dev.email, role: 'member' });
    project = (
      await j.t.call<{ id: string }>(lena, 'POST', W('/projects'), {
        key: 'SHOP',
        name: 'Shop app',
      })
    ).body.id;
    for (const title of ['Checkout page', 'Payment form', 'Order history'])
      tasks.push(
        (
          await j.t.call<{ id: string; ref: string; title: string }>(
            lena,
            'POST',
            W('/projects/' + project + '/items'),
            { title, estimate: 3 },
          )
        ).body,
      );
  }, 60_000);

  afterAll(async () => {
    await j.close();
  });

  it('signs in and opens the project’s planning', async () => {
    const { page, t } = j;
    await signIn(j, lena);
    await page.goto(t.base + '/projects/' + project + '/planning');
    await page.see('No sprint yet');
  });

  it('creates a sprint', async () => {
    const { page } = j;
    await page.click('New sprint');
    await page.fill('Sprint name', 'Sprint 1');
    await page.fill('Goal', 'Customers can pay');
    await page.click('Create');
    await page.see('Customers can pay');
  });

  it('puts two backlog tasks into the sprint', async () => {
    const { page } = j;
    await page.click('Backlog', { within: '.pv-subtabs' });
    await page.see('Order history');
    for (const task of tasks.slice(0, 2)) {
      await page.click('To sprint', { within: 'tr[data-item="' + task.id + '"]' });
      await page.waitFor(
        '[...document.querySelectorAll(\'tr[data-item="' +
          task.id +
          '"] button\')].some((b) => b.textContent.trim() === "To backlog")',
        task.title + ' in the sprint',
      );
    }
    await page.see('Sprint 1 · 6 points');
  });

  it('assigns a task to the developer', async () => {
    const { page } = j;
    const task = tasks[0] ?? { id: '', ref: '', title: '' };
    await page.click(task.ref, { within: 'tr[data-item="' + task.id + '"]' });
    await page.waitFor('document.querySelector(".pv-drawer")', 'the task drawer');
    await page.choose('Assignee', 'Dave Developer');
    await page.click('Close', { within: '.pv-drawer' });
    const saved = await j.t.call<{ assigneeId: string | null }>(
      lena,
      'GET',
      W('/items/' + task.id),
    );
    expect(saved.body.assigneeId).toBe(dev.id);
  });

  it('sees the sprint’s tasks on the board, and nothing broke on the way', async () => {
    const { page } = j;
    await page.click('Board', { within: '.pv-subtabs' });
    await page.see('Checkout page');
    await page.see('Payment form');
    expect(await page.shows('Order history')).toBe(false);
    expect(appErrors(page)).toEqual([]);
  });

  // [PCODE-434 | S15 | v0.1.0]
  it('sets a column’s WIP limit on the board', async () => {
    const { page, t } = j;
    const states = (
      await t.call<{ states: { id: string; name: string }[] }>(
        lena,
        'GET',
        W('/projects/' + project),
      )
    ).body.states;
    const todo = states[1] ?? states[0];
    const name = todo?.name ?? '';
    await page.click('Set the WIP limit of ' + name);
    await page.fill('WIP limit of ' + name, '3');
    await page.press('Enter');
    await page.waitFor("document.body.innerText.includes(' / 3')", 'the limit beside the count');
    const after = (
      await t.call<{ states: { id: string; wipLimit?: number | null }[] }>(
        lena,
        'GET',
        W('/projects/' + project),
      )
    ).body.states;
    expect(after.find((x) => x.id === todo?.id)?.wipLimit).toBe(3);
  });
});
