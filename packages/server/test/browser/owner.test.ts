// ── [PCODE-432 | S15 | v0.1.0] T37 medium: The empty home guides a new workspace ──
// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  the owner's first hour, in the browser: an account and its workspace from the sign-up screen,
//          a first project from the Projects page, a colleague invited from the members settings, and
//          signing out and in again; nothing on the way writes an error to the console.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appErrors, canRun, startJourney, type Journey } from './journey.js';

describe.skipIf(!canRun)('journey: the owner (browser)', () => {
  let j: Journey;
  const email = 'olga.owner@example.test';
  const password = 'olga owns the place 1';

  beforeAll(async () => {
    j = await startJourney();
  });

  afterAll(async () => {
    await j.close();
  });

  it('signs up with a workspace of their own', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/signup');
    await page.fill('Your name', 'Olga Owner');
    await page.fill('Work email', email);
    await page.fill('Password', password);
    await page.fill('Workspace name', 'Olga Studio');
    await page.click('Create account');
    await page.waitFor("location.pathname === '/'", 'the home page');
    await page.see('Olga Studio');
    // [PCODE-432 | S15 | v0.1.0] a new workspace says what to do first
    await page.see('Get started');
    await page.see('Start a project');
  });

  it('starts the first project', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/projects');
    await page.click('New project');
    await page.fill('Name', 'Delivery app');
    await page.fill('Key', 'DLV');
    await page.click('Create project');
    await page.see('Delivery app');
    // [PCODE-432 | S15 | v0.1.0] the first step is ticked off
    await page.goto(t.base + '/');
    await page.waitFor(
      "[...document.querySelectorAll('.v2-start-step--done')].some((e) => e.textContent.includes('Start a project'))",
      'the first step done',
    );
  });

  it('invites a colleague', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/settings/members');
    await page.fill('Email address', 'bob.builder@example.test');
    await page.click('Invite');
    await page.see('bob.builder@example.test');
  });

  it('signs out and back in, and nothing broke on the way', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/');
    await page.click('Your account');
    await page.click('Sign out');
    await page.waitFor("location.pathname === '/login'", 'the sign-in screen');
    await page.fill('Email', email);
    await page.fill('Password', password);
    await page.click('Sign in');
    await page.see('Olga Studio');
    expect(appErrors(page)).toEqual([]);
  });
});
