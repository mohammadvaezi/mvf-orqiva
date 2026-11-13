// ── [PCODE-426 | S15 | v0.1.0] T37 low: Portal home shows the budget only when there is one ──
// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  a client's contact in the client portal, in the browser: they join from the invitation link the
//          team sent, sign in again, find their project on the portal home, write a request and see it in
//          their list, and vote on a colleague's request; nothing on the way writes an error to the console.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { appErrors, canRun, signIn, signOut, startJourney, type Journey } from './journey.js';

describe.skipIf(!canRun)('journey: a client contact in the portal (browser)', () => {
  let j: Journey;
  let ada: Person;
  let token = '';
  let colleagueRef = '';
  const email = 'ines@helio.example';
  const password = 'ines checks the portal 1';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    j = await startJourney();
    const { t } = j;
    // the team: a client with a project, a contact invited, a colleague of theirs with a request
    ada = await t.signup('Ada');
    const helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body
      .id;
    const project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    const invite = async (to: string): Promise<string> =>
      (
        await t.call<{ invitation: { token: string } | null }>(
          ada,
          'POST',
          W('/clients/' + helio + '/contacts'),
          { email: to, portalRole: 'requester' },
        )
      ).body.invitation?.token ?? '';
    token = await invite(email);
    const res = await fetch(
      t.base + '/auth/invitations/' + (await invite('tom@helio.example')) + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Tom Helio', password: 'a client password 1' }),
      },
    );
    const tom: Person = {
      id: '',
      email: 'tom@helio.example',
      name: 'Tom Helio',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    colleagueRef = (
      await t.call<{ ref: string }>(tom, 'POST', W('/client-requests'), {
        kind: 'feature',
        title: 'Export the calendar to PDF',
      })
    ).body.ref;
  }, 90_000);

  afterAll(async () => {
    await j.close();
  });

  it('joins from the invitation link', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/invite/' + token);
    await page.see('Join Ada Co');
    await page.fill('Your name', 'Ines Helio');
    await page.fill('Choose a password', password);
    await page.click('Create account and join');
    await page.waitFor("location.pathname === '/'", 'the portal home');
    await page.see('Helio · your projects with us');
  });

  it('signs out and in again, and finds the project on the portal home', async () => {
    const { page } = j;
    await signOut(j);
    await signIn(j, { id: '', email, name: 'Ines Helio', cookie: '', workspaceId: '' }, password);
    await page.see('Client portal');
    await page.see('Your projects');
    // [PCODE-426 | S15 | v0.1.0] no budget and nothing spent: no budget card
    expect(await page.shows('so far')).toBe(false);
    await page.see('Helio app');
  });

  it('writes a request and sees it in the list', async () => {
    const { page } = j;
    await page.click('Requests');
    await page.waitFor("location.pathname.startsWith('/requests')", 'the requests page');
    await page.click('New request');
    await page.click('Bug');
    await page.fill('What happened or what do you need?', 'Reminders ring an hour late');
    await page.fill('Details (optional)', 'Since the clocks changed, every reminder is late.');
    await page.click('Send');
    await page.waitFor('/^\\/requests\\/./.test(location.pathname)', 'the new request');
    await page.see('Reminders ring an hour late');
    await page.waitFor(
      "[...document.querySelectorAll('.pv-req')].some((e) => e.textContent.includes('Reminders ring an hour late'))",
      'the request in the list',
    );
  });

  it('votes on a colleague’s request, and nothing broke on the way', async () => {
    const { page } = j;
    await page.click(colleagueRef);
    await page.see('Export the calendar to PDF');
    await page.click('This matters to me too');
    await page.see('You voted');
    await page.see('1 vote');
    expect(appErrors(page)).toEqual([]);
  });
});
