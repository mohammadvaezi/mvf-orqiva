// ── [PCODE-433 | S15 | v0.1.0] T37 low: Task descriptions show formatted text ──
// ── [PCODE-419 | S15 | v0.1.0] T37 medium: A filed bug shows as a bug and carries the failing step note ──
// ── [PCODE-415 | S15 | v0.1.0] T37 high: Testers can write test cases and plan runs in the browser ──
// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  a tester's day, in the browser: the project's Test tab, the case in the repository, a run
//          to work through, a step that fails with what happened, a bug filed from that failure with
//          one click, and the bug opened as a task of the project; nothing writes an error.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { appErrors, canRun, signIn, startJourney, type Journey } from './journey.js';

describe.skipIf(!canRun)('journey: the tester (browser)', () => {
  let j: Journey;
  let lead: Person;
  let tess: Person;
  let project = '';
  const caseTitle = 'Courier sees the drop-off on the map';
  const runName = 'Release 2.1 regression';
  const happened = 'The map stays grey; the pin never shows';
  const stepNote = 'Spinner for 30 s, then an empty map';
  const W = (p: string): string => '/api/workspaces/' + lead.workspaceId + p;

  beforeAll(async () => {
    j = await startJourney();
    const { t } = j;
    // the lead first: a person's oldest workspace is the one the app opens
    lead = await t.signup('Lena Lead');
    tess = await t.signup('Tess Tester');
    await t.call(lead, 'POST', W('/members'), { email: tess.email, role: 'tester' });
    project = (
      await t.call<{ id: string }>(lead, 'POST', W('/projects'), { key: 'DLV', name: 'Delivery' })
    ).body.id;
  }, 60_000);

  // [PCODE-415 | S15 | v0.1.0] the tester writes the case and plans the run in the browser
  it('writes a test case and plans a run', async () => {
    const { page, t } = j;
    await signIn(j, tess);
    await page.goto(t.base + '/projects/' + project + '/tests');
    await page.click('Repository');
    await page.fill('New case', caseTitle);
    await page.click('Add');
    await page.see(caseTitle);
    // its steps, as the case editor would save them
    const cases = (
      await t.call<{ id: string; title: string }[]>(
        tess,
        'GET',
        W('/projects/' + project + '/test-cases'),
      )
    ).body;
    const id = cases.find((x) => x.title === caseTitle)?.id ?? '';
    await t.call(tess, 'PATCH', W('/test-cases/' + id + '/design'), {
      suite: 'Tracking',
      kind: 'manual',
      steps: [
        { action: 'Open an order on its way', expected: 'The order shows' },
        { action: 'Open the map', expected: 'The drop-off pin shows' },
      ],
    });
    await page.click('Runs');
    await page.click('Plan a run');
    await page.fill('Name', runName);
    await page.click('Plan the run');
    await page.see(runName);
  }, 60_000);

  afterAll(async () => {
    await j.close();
  });

  it('finds the case in the Test tab', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/projects/' + project + '/tests');
    await page.click('Repository');
    await page.see(caseTitle);
    await page.see('Tracking');
  });

  it('opens the run and works through the case', async () => {
    const { page } = j;
    await page.click('Runs');
    await page.see(runName);
    await page.see('Open an order on its way');
    await page.click('Pass', { within: '[aria-label="Result of step 1"]' });
    await page.waitFor(
      'document.querySelector(\'[aria-label="Result of step 1"] [aria-pressed="true"]\')',
      'step 1 marked passed',
    );
  });

  it('fails the second step with what happened', async () => {
    const { page } = j;
    await page.fill('What happened', happened);
    await page.click('Fail', { within: '[aria-label="Result of step 2"]' });
    await page.see('File bug with all evidence');
    // [PCODE-419 | S15 | v0.1.0] and what happened at that very step
    await page.fill('What happened at step 2', stepNote);
    await page.press('Tab');
  });

  it('files a bug from the failure and opens it as a task', async () => {
    const { page } = j;
    await page.click('File bug with all evidence');
    await page.see('filed from this result');
    await page.click('Open');
    await page.waitFor("location.pathname.startsWith('/items/')", 'the bug as a task');
    // the title and the description are fields to edit: their text is in their values
    const typed = (text: string): string =>
      "[...document.querySelectorAll('input, textarea')].some((e) => e.value.includes(" +
      JSON.stringify(text) +
      '))';
    await page.waitFor(typed('Fails: ' + caseTitle), 'the bug’s title');
    // [PCODE-433 | S15 | v0.1.0] the description reads as formatted text
    await page.see(happened);
    await page.see(stepNote);
    await page.see('DLV-1');
    // [PCODE-419 | S15 | v0.1.0] the task says it is a bug
    await page.waitFor(
      "document.querySelector('.pe-kind-chip')?.textContent === 'Bug'",
      'the Bug label',
    );
    expect(appErrors(page)).toEqual([]);
  });
});
