// ── [PCODE-416 | S15 | v0.1.0] T37 high: A person in two workspaces can switch between them ──
//    Why:  someone with a workspace of their own is added to a team's: the sidebar's header lists both,
//          a click opens the other one, and the choice stays after a reload.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { appErrors, canRun, signIn, startJourney, type Journey } from './journey.js';

describe.skipIf(!canRun)('journey: two workspaces (browser)', () => {
  let j: Journey;
  let bea: Person;
  let team: Person;

  beforeAll(async () => {
    j = await startJourney();
    // Bea's own workspace is her oldest; the team adds her later
    bea = await j.t.signup('Bea');
    team = await j.t.signup('Tom');
    await j.t.call(team, 'POST', '/api/workspaces/' + team.workspaceId + '/members', {
      email: bea.email,
      role: 'member',
    });
    await j.t.call(team, 'POST', '/api/workspaces/' + team.workspaceId + '/projects', {
      key: 'TEAM',
      name: 'Team project',
    });
  });

  afterAll(async () => {
    await j.close();
  });

  it('opens her own workspace first and lists the other one', async () => {
    const { page } = j;
    await signIn(j, bea);
    await page.see('Bea Co');
    await page.click('Switch workspace');
    await page.see('Tom Co');
  });

  it('switches to the team’s workspace and keeps it after a reload', async () => {
    const { page, t } = j;
    await page.click('Tom Co');
    await page.see('Team project');
    await page.goto(t.base + '/');
    await page.see('Team project');
    expect(await page.shows('Bea Co')).toBe(false);
    expect(appErrors(page)).toEqual([]);
  });
});
