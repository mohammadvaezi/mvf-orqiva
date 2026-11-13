// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  a designer's page in the project's documents, in the browser: a new page from the tree,
//          its text written in the block editor and saved as a version, the page in the tree, a
//          second edit, and both versions in its history; nothing writes an error.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { appErrors, canRun, signIn, startJourney, type Journey } from './journey.js';

describe.skipIf(!canRun)('journey: the designer (browser)', () => {
  let j: Journey;
  let lead: Person;
  let dana: Person;
  let project = '';
  const title = 'Map style guide';
  const first = 'Pins are round and use the brand blue.';
  const second = 'Pins are round, use the brand blue and grow on hover.';
  const inTree = (text: string): string =>
    '[...document.querySelectorAll(\'[aria-label="Pages"] .pv-tree-title\')].some((e) => ' +
    'e.textContent === ' +
    JSON.stringify(text) +
    ')';

  beforeAll(async () => {
    j = await startJourney();
    const { t } = j;
    // the lead first: a person's oldest workspace is the one the app opens
    lead = await t.signup('Lena Lead');
    dana = await t.signup('Dana Designer');
    const W = (p: string): string => '/api/workspaces/' + lead.workspaceId + p;
    await t.call(lead, 'POST', W('/members'), { email: dana.email, role: 'designer' });
    project = (
      await t.call<{ id: string }>(lead, 'POST', W('/projects'), { key: 'DLV', name: 'Delivery' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await j.close();
  });

  it('signs in and starts a page from the tree', async () => {
    const { page, t } = j;
    await signIn(j, dana);
    await page.goto(t.base + '/projects/' + project + '/documents');
    await page.see('No pages yet.');
    await page.click('New', { within: '[aria-label="Pages"]' });
    await page.fill('Title', title);
    await page.click('Create');
    await page.waitFor(inTree(title), 'the page in the tree');
  });

  it('writes the text and saves it as a version', async () => {
    const { page } = j;
    await page.click('Edit');
    await page.click('Add a block');
    await page.fill('New block (Markdown)', first);
    await page.click('Save as version');
    await page.waitFor('!document.querySelector(\'[aria-label="Title"]\')', 'the page saved');
    await page.see(first);
    await page.see('version 2');
  });

  it('edits it again and sees both versions in its history', async () => {
    const { page } = j;
    await page.click('Edit');
    await page.click('Edit block 1');
    await page.fill('Block 1 (Markdown)', second);
    await page.click('Save as version');
    await page.waitFor('!document.querySelector(\'[aria-label="Title"]\')', 'the page saved');
    await page.see(second);
    await page.see('version 3');
    await page.click('History');
    await page.see('v3');
    await page.see('v2');
    await page.see('Changes');
    expect(await page.eval<boolean>(inTree(title))).toBe(true);
    expect(appErrors(page)).toEqual([]);
  });
});
