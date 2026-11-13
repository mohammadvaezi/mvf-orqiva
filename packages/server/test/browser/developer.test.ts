// ── [PCODE-429 | S15 | v0.1.0] T37 low: A very short timer says why it booked nothing ──
// ── [PCODE-417 | S15 | v0.1.0] T37 medium: Members do not see the Administration group they cannot use ──
// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  the developer's day, in the browser: joining the team from the invitation link, finding the
//          task the lead gave them under My work, moving it to In Progress, writing a comment on it,
//          and booking time on the Time page (a timer stopped at once books nothing) and in the week's sheet; nothing on the way
//          writes an error to the console.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { appErrors, canRun, startJourney, type Journey } from './journey.js';

describe.skipIf(!canRun)('journey: the developer (browser)', () => {
  let j: Journey;
  let lena: Person;
  let token = '';
  let project = '';
  let task = { id: '', ref: '', title: '' };
  let devId = '';
  const email = 'dina.dev@example.test';
  const W = (p: string): string => '/api/workspaces/' + lena.workspaceId + p;

  beforeAll(async () => {
    j = await startJourney();
    lena = await j.t.signup('Lena Lead');
    project = (
      await j.t.call<{ id: string }>(lena, 'POST', W('/projects'), {
        key: 'SHOP',
        name: 'Shop app',
      })
    ).body.id;
    task = (
      await j.t.call<typeof task>(lena, 'POST', W('/projects/' + project + '/items'), {
        title: 'Fix the login redirect',
      })
    ).body;
    await j.t.call(lena, 'POST', W('/projects/' + project + '/items'), {
      title: 'Somebody else’s task',
    });
    token = (
      await j.t.call<{ token: string }>(lena, 'POST', W('/invitations'), {
        email,
        role: 'member',
      })
    ).body.token;
  }, 60_000);

  afterAll(async () => {
    await j.close();
  });

  it('joins the team from the invitation link', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/invite/' + token);
    await page.see('Join Lena Lead Co');
    await page.fill('Your name', 'Dina Dev');
    await page.fill('Choose a password', 'dina writes the code 1');
    await page.click('Create account and join');
    await page.waitFor("location.pathname === '/'", 'the home page');
    await page.see('Lena Lead Co');
    // the lead hands her a task (the lead's own journey does this in the browser)
    const members = await t.call<{ userId: string; email: string }[]>(lena, 'GET', W('/members'));
    devId = members.body.find((m) => m.email === email)?.userId ?? '';
    expect(
      (await t.call(lena, 'PATCH', W('/items/' + task.id), { assigneeId: devId })).status,
    ).toBe(200);
  });

  it('finds the task under My work and opens it', async () => {
    const { page } = j;
    await page.click('My work');
    await page.waitFor("location.pathname === '/my-work'", 'My work');
    await page.see(task.title);
    expect(await page.shows('Somebody else’s task')).toBe(false);
    await page.click(task.title);
    await page.waitFor("location.pathname === '/items/" + task.id + "'", 'the task');
    await page.see(task.ref);
    // [PCODE-418 | S15 | v0.1.0] the task page says whose it is
    await page.waitFor(
      "document.querySelector('#item-assignee')?.selectedOptions[0]?.textContent === 'Dina Dev'",
      'Dina as the assignee',
    );
  });

  it('moves it to In Progress', async () => {
    const { page, t } = j;
    await page.choose('State', 'In Progress');
    await page.waitFor("!document.body.innerText.includes(' · saving')", 'the state saved');
    const saved = await t.call<{ stateId: string }>(lena, 'GET', W('/items/' + task.id));
    const states = await t.call<{ states: { id: string; name: string }[] }>(
      lena,
      'GET',
      W('/projects/' + project),
    );
    expect(states.body.states.find((s) => s.id === saved.body.stateId)?.name).toBe('In Progress');
  });

  it('writes a comment', async () => {
    const { page } = j;
    await page.fill('Comment', 'The redirect loses the return address; fixing it in the guard.');
    await page.click('Comment');
    await page.see('fixing it in the guard', 5_000);
    await page.waitFor("document.querySelector('#new-comment').value === ''", 'the empty box');
  });

  it('times the task with the timer on the Time page', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/time');
    await page.waitFor(
      '[...document.querySelectorAll(\'select[aria-label="Task for the timer"] option\')].length > 1',
      'her tasks in the timer’s list',
    );
    await page.choose('Task for the timer', task.ref + ' ' + task.title);
    await page.click('Start');
    await page.see('stops at 19:00 if forgotten');
    await page.click('Stop');
    await page.waitFor(
      'document.querySelector(\'select[aria-label="Task for the timer"]\')',
      'the timer stopped',
    );
    // [PCODE-429 | S15 | v0.1.0] seconds are not work: nothing booked, and the page says why
    await page.see('Stopped within a minute: nothing was booked.');
  });

  it('books hours for the task in the week, and nothing broke on the way', async () => {
    const { page } = j;
    // the sheet's first column is the Monday of this week, as the server counts it
    const monday = await page.eval<string>(
      "fetch('/api/workspaces/" +
        lena.workspaceId +
        "/time/week').then((r) => r.json()).then((w) => w.days[0])",
    );
    const cell = task.title + ' Mon ' + String(Number(monday.slice(8, 10)));
    // [PCODE-429 | S15 | v0.1.0] the task goes into the week's sheet from its list
    await page.choose('Add a task', task.ref + ' ' + task.title);
    await page.see(task.ref + ' ' + task.title);
    await page.fill(cell, '1,5');
    await page.press('Tab');
    await page.see('1,5');
    const after = await page.eval<{ total: number }>(
      "fetch('/api/workspaces/" + lena.workspaceId + "/time/week').then((r) => r.json())",
    );
    expect(after.total).toBeGreaterThanOrEqual(90);
    // [PCODE-417 | S15 | v0.1.0] a member's own settings and costs are not called administration
    expect(
      await page.eval<string[]>(
        "[...document.querySelectorAll('.pv-nav-heading')].map((e) => e.textContent ?? '')",
      ),
    ).toContain('Your account');
    expect(appErrors(page)).toEqual([]);
  });
});
