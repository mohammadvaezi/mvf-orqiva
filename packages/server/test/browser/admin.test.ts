// ── [PCODE-425 | S15 | v0.1.0] T37 low: Settings > Policies rows fit without sideways scrolling ──
// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  a workspace admin in Settings, in the browser: they join from the owner's invitation, change a
//          colleague's role in the members settings, dry run a policy and switch it on, and rename the
//          workspace under General; the member list keeps the new role after a reload, and nothing on the
//          way writes an error to the console.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { appErrors, canRun, startJourney, type Journey } from './journey.js';

describe.skipIf(!canRun)('journey: a workspace admin in Settings (browser)', () => {
  let j: Journey;
  let ada: Person;
  let token = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    j = await startJourney();
    const { t } = j;
    // the owner: a project with a task in an open sprint, a member, and an admin invited
    ada = await t.signup('Ada');
    const project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'The App' })
    ).body.id;
    const sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 1',
        startDate: '2026-11-02',
        endDate: '2026-11-13',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/items'), {
      title: 'Vague task',
      sprintId: sprint,
    });
    const invite = async (email: string, role: string): Promise<string> =>
      (await t.call<{ token: string }>(ada, 'POST', W('/invitations'), { email, role })).body.token;
    await fetch(
      t.base + '/auth/invitations/' + (await invite('mo@example.test', 'member')) + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Mo Member', password: 'a member password 1' }),
      },
    );
    token = await invite('ann@example.test', 'admin');
  }, 90_000);

  afterAll(async () => {
    await j.close();
  });

  it('joins as an admin from the invitation link', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/invite/' + token);
    await page.see('Join Ada Co');
    await page.fill('Your name', 'Ann Admin');
    await page.fill('Choose a password', 'ann runs the settings 1');
    await page.click('Create account and join');
    await page.waitFor("location.pathname === '/'", 'the home page');
    await page.see('Ada Co');
  });

  it('makes a member a guest in the members settings', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/settings/members');
    await page.see('Mo Member');
    await page.choose('Role of Mo Member', 'Guest');
    await page.see('Saved.');
  });

  it('dry runs a policy, then switches it on', async () => {
    const { page } = j;
    await page.click('Policies', { within: 'nav[aria-label="Settings"]' });
    await page.see('New policy');
    await page.choose('Rule', 'Approval: Tasks without acceptance criteria cannot enter a sprint');
    await page.click('Dry run');
    await page.see('APP-1 Vague task');
    await page.click('Add and turn on');
    await page.see('Policies · 1');
    await page.see('Back to draft');
    // [PCODE-425 | S15 | v0.1.0] the row fits: no sideways scrolling
    expect(
      await page.eval<boolean>(
        "[...document.querySelectorAll('.pv-library-row, .pv-library-row .pv-integration')].every((e) => e.scrollWidth <= e.clientWidth + 1)",
      ),
    ).toBe(true);
  });

  it('renames the workspace under General', async () => {
    const { page } = j;
    await page.click('General', { within: 'nav[aria-label="Settings"]' });
    await page.see('Show who is where');
    await page.fill('Name', 'Ada Studio');
    await page.click('Save');
    await page.see('Saved.');
    await page.see('Ada Studio');
  });

  it('still sees the new role after a reload, and nothing broke on the way', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/settings/members');
    await page.see('Mo Member');
    expect(
      await page.eval<string>(
        'document.querySelector(\'select[aria-label="Role of Mo Member"]\').value',
      ),
    ).toBe('guest');
    expect(appErrors(page)).toEqual([]);
  });
});
