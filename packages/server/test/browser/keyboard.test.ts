// ── [PCODE-411 | S15 | v0.1.0] T36.6 Keyboard-only and screen-reader passes ──
//    Why:  every screen used without a mouse and heard through a screen reader. With Tab only: the skip
//          link comes first, focus never sticks, and every visible control is reached before focus comes
//          round again. Ctrl+K opens the command bar with the focus inside and Escape closes it. The
//          accessibility tree, as the browser hands it to a screen reader: a main region and navigation,
//          a top heading, and a name on every control.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { PROJECT, WORKSPACE } from './routes.js';
import { canRun, quiet, signIn, startJourney, type Journey } from './journey.js';

interface Problem {
  screen: string;
  kind: string;
  detail: string;
}

interface AxNode {
  ignored: boolean;
  role?: { value: string };
  name?: { value: string };
  properties?: { name: string; value: { value: unknown } }[];
}

const NAMED = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'searchbox',
  'slider',
  'spinbutton',
]);

describe.skipIf(!canRun)('keyboard and screen reader (browser)', () => {
  let j: Journey;
  let ada: Person;
  let project = '';
  const problems: Problem[] = [];

  beforeAll(async () => {
    j = await startJourney();
    ada = await j.t.signup('Ada');
    const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
    project = (
      await j.t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'The App' })
    ).body.id;
    for (const title of ['Sign in with email', 'Appointment list'])
      await j.t.call(ada, 'POST', W('/projects/' + project + '/items'), { title });
    await signIn(j, ada);
  });

  afterAll(async () => {
    await j.close();
  });

  /** One Tab press; the focused element, described, and whether focus left the page's elements. */
  const tab = async (): Promise<string> => {
    await j.page.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    await j.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' });
    return j.page.eval<string>(`(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return 'body';
      if (!e.dataset.kbd) e.dataset.kbd = String(Math.random()).slice(2);
      return e.dataset.kbd;
    })()`);
  };

  it('walks every screen with Tab alone', async () => {
    const { page, t } = j;
    for (const route of [...WORKSPACE, ...PROJECT.map((v) => '/projects/' + project + v)]) {
      const screen = route.replace(project, 'P');
      await page.goto(t.base + route);
      // the app has drawn its frame (a heavy page can take a moment)
      await page.waitFor("document.querySelector('main#pv-main')", 'the app on ' + screen);
      await page.settle();
      // what is on the page when the walk starts; parts that arrive later are not counted against it
      await page.eval(
        "document.querySelectorAll('a[href], button, input, select, textarea, [tabindex], summary').forEach((e) => { e.dataset.pre = '1'; })",
      );
      const first = await tab();
      const isSkip = await page.eval<boolean>(
        "/skip to/i.test(document.activeElement?.textContent ?? '')",
      );
      if (!isSkip)
        problems.push({ screen, kind: 'skip-link', detail: 'the first Tab is not a skip link' });
      // walk until focus comes round to where it started, or 400 presses
      const seen = new Set([first]);
      let previous = first;
      let same = 0;
      for (let i = 0; i < 400; i++) {
        const now = await tab();
        if (now === previous && now !== 'body') same += 1;
        else same = 0;
        if (same >= 3) {
          problems.push({ screen, kind: 'stuck', detail: 'Tab stays on one element' });
          break;
        }
        if (now === first) break;
        seen.add(now);
        previous = now;
      }
      const missed = await page.eval<string[]>(`(() => {
        const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';
        return [...document.querySelectorAll(sel)]
          .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')
          .filter((e) => !e.closest('[inert], [aria-hidden="true"]'))
          // inside a closed menu nothing can take the focus
          .filter((e) => !e.closest('details:not([open])') || e.tagName === 'SUMMARY')
          .filter((e) => e.dataset.pre === '1' && !e.dataset.kbd)
          .slice(0, 5)
          .map((e) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : '') + ' “' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30) + '”');
      })()`);
      if (missed.length && seen.size < 400)
        problems.push({ screen, kind: 'unreached', detail: missed.join('; ') });

      // what a screen reader gets
      const tree = await page.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
      const roles = tree.nodes.filter((n) => !n.ignored).map((n) => n.role?.value ?? '');
      if (!roles.includes('main')) problems.push({ screen, kind: 'landmark', detail: 'no main' });
      if (!roles.includes('navigation'))
        problems.push({ screen, kind: 'landmark', detail: 'no navigation' });
      const headings = tree.nodes.filter(
        (n) =>
          !n.ignored &&
          n.role?.value === 'heading' &&
          n.properties?.some((p) => p.name === 'level' && p.value.value === 1),
      );
      if (headings.length !== 1)
        problems.push({
          screen,
          kind: 'heading',
          detail: String(headings.length) + ' top headings',
        });
      const nameless = tree.nodes
        .filter((n) => !n.ignored && NAMED.has(n.role?.value ?? '') && !n.name?.value.trim())
        .map((n) => n.role?.value ?? '');
      if (nameless.length)
        problems.push({ screen, kind: 'unnamed', detail: nameless.slice(0, 5).join(', ') });
    }
  }, 1_800_000);

  it('opens the command bar with Ctrl+K and closes it with Escape', async () => {
    const { page, t } = j;
    await page.goto(t.base + '/');
    // the app listens for its keys once it has drawn its frame
    await page.waitFor("document.querySelector('main#pv-main')", 'the app');
    await page.settle();
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'k',
      code: 'KeyK',
      windowsVirtualKeyCode: 75,
      modifiers: 2,
    });
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'k',
      code: 'KeyK',
      modifiers: 2,
    });
    await page.waitFor(
      "document.activeElement?.closest('[role=dialog]')?.getAttribute('aria-label') === 'Command bar'",
      'the command bar with the focus inside',
    );
    await page.press('Escape');
    expect(
      await page.eval<boolean>('!document.querySelector(\'[aria-label="Command bar"]\')'),
    ).toBe(true);
  });

  it('found nothing wrong', () => {
    expect(quiet(j.page.errors)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
