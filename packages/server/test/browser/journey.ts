// ── [PCODE-408 | S15 | v0.1.0] T36.3 Click-through of every screen in light and dark, desktop and phone ──
// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  what every journey needs: the server with the built web app and the live channel, a browser,
//          and signing a person in through the sign-in screen as they would.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTestApp, type Person, type TestApp } from '../db/apphelper.js';
import { hasDatabase } from '../db/testdb.js';
import { browserPath, launch, type Page } from './harness.js';

export const WEB_DIR = fileURLToPath(new URL('../../../web/dist', import.meta.url));

/** Journeys need the database, a browser and the built web app; without them they are skipped. */
export const canRun = hasDatabase && browserPath() !== null && existsSync(WEB_DIR + '/index.html');

export interface Journey {
  t: TestApp;
  page: Page;
  close: () => Promise<void>;
}

export async function startJourney(
  opts: { width?: number; height?: number; mobile?: boolean } = {},
): Promise<Journey> {
  const t = await startTestApp({ live: true, webDir: WEB_DIR });
  const b = await launch(opts);
  return {
    t,
    page: b.page,
    close: async () => {
      await b.close();
      await t.stop();
    },
  };
}

/** The password the test sign-up gave a person (it follows the number in their email). */
export const passwordOf = (who: Person): string =>
  'a test password ' + (/\.(\d+)@/.exec(who.email)?.[1] ?? '');

/** Signs a person in through the sign-in screen and waits for the app. */
export async function signIn(j: Journey, who: Person, password = passwordOf(who)): Promise<void> {
  await j.page.goto(j.t.base + '/login');
  await j.page.fill('Email', who.email);
  await j.page.fill('Password', password);
  await j.page.click('Sign in');
  await j.page.waitFor("location.pathname !== '/login'", 'the app after signing in');
  await j.page.settle();
}

/** Signs out through the account menu. */
export async function signOut(j: Journey): Promise<void> {
  await j.page.eval("fetch('/auth/logout', { method: 'POST' })");
  await j.page.goto(j.t.base + '/login');
}

/** Console errors and uncaught exceptions, without the browser's own noise (a missing favicon …). */
export function appErrors(page: Page): string[] {
  return quiet(page.errors);
}

/** [PCODE-408 | S15 | v0.1.0] The errors of a list that are the app's own. */
export function quiet(errors: string[]): string[] {
  return errors.filter((e) => !/favicon|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(e));
}
