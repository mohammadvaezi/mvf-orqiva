// ── [PCODE-421 | S15 | v0.1.0] T37 medium: Members can pick their own language ──
//    Why:  a member who is not an admin picks German in their own profile; the app speaks German at
//          once and after a reload, and goes back to the workspace's language when they choose so.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { appErrors, canRun, signIn, startJourney, type Journey } from './journey.js';

describe.skipIf(!canRun)('journey: a member picks their language (browser)', () => {
  let j: Journey;
  let ada: Person;
  let mo: Person;
  const pick = (value: string) =>
    `(() => {
      const sel = document.querySelector('select option[value="de"]')?.parentElement;
      if (!sel) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      set.call(sel, ${JSON.stringify(value)});
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`;

  beforeAll(async () => {
    j = await startJourney();
    ada = await j.t.signup('Ada');
    mo = await j.t.signup('Mo');
    // Mo is a plain member of Ada's workspace, the one his browser opens
    await j.t.call(ada, 'POST', '/api/workspaces/' + ada.workspaceId + '/members', {
      email: mo.email,
      role: 'member',
    });
  });

  afterAll(async () => {
    await j.close();
  });

  it('switches to German from the profile, also after a reload', async () => {
    const { page, t } = j;
    await signIn(j, mo);
    await page.eval(`localStorage.setItem('orqiva-workspace', '${ada.workspaceId}')`);
    await page.goto(t.base + '/settings/profile');
    await page.see('Ada Co');
    await page.see('Your language');
    expect(await page.eval<boolean>(pick('de'))).toBe(true);
    await page.see('Meine Arbeit');
    await page.goto(t.base + '/');
    await page.see('Meine Arbeit');
  });

  it('goes back to the workspace’s language', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/settings/profile');
    await page.waitFor(
      "document.querySelector('select option[value=\"de\"]')?.parentElement?.value === 'de'",
      'the German choice',
    );
    expect(await page.eval<boolean>(pick(''))).toBe(true);
    await page.see('My work');
    expect(appErrors(page)).toEqual([]);
  });
});
