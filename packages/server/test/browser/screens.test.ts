// ── [PCODE-408 | S15 | v0.1.0] T36.3 Click-through of every screen in light and dark, desktop and phone ──
//    Why:  every screen of the app opened as a person would, in a workspace with work in it and in an
//          empty one (the empty states), in light and dark, at desktop and at phone width. A screen
//          passes when it writes no error to the console, the accessibility audit finds nothing, and a
//          phone does not have to scroll sideways. Screenshots of every screen land in out/screens for a
//          person to look through.
import { auditScript, type A11yPageReport } from '@orqiva/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../db/apphelper.js';
import { launch, type Page } from './harness.js';
import { PROJECT, WORKSPACE } from './routes.js';
import { canRun, quiet, signIn, startJourney, type Journey } from './journey.js';

const OUT = join(process.cwd(), '..', '..', 'out', 'screens');
const SIZES = [
  { name: 'desktop', width: 1400, height: 900, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
] as const;

interface Problem {
  screen: string;
  kind: string;
  detail: string;
}

describe.skipIf(!canRun)('every screen (browser)', () => {
  let j: Journey;
  let full: Person;
  let empty: Person;
  let project = '';
  let emptyProject = '';
  const problems: Problem[] = [];

  beforeAll(async () => {
    j = await startJourney();
    full = await j.t.signup('Ada');
    empty = await j.t.signup('Erin');
    const W = (p: string): string => '/api/workspaces/' + full.workspaceId + p;
    project = (
      await j.t.call<{ id: string }>(full, 'POST', W('/projects'), { key: 'APP', name: 'The App' })
    ).body.id;
    const sprint = (
      await j.t.call<{ id: string }>(full, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 1',
        startDate: '2026-11-02',
        endDate: '2026-11-13',
      })
    ).body.id;
    for (const title of ['Sign in with email', 'Appointment list', 'Reminder settings'])
      await j.t.call(full, 'POST', W('/projects/' + project + '/items'), {
        title,
        sprintId: sprint,
        assigneeId: full.id,
      });
    await j.t.call(full, 'POST', W('/projects/' + project + '/docs'), { title: 'Architecture' });
    await j.t.call(full, 'POST', W('/clients'), { name: 'Helio' });
    await j.t.call(full, 'POST', W('/incidents'), { title: 'Payments slow', severity: 'sev2' });
    emptyProject = (
      await j.t.call<{ id: string }>(
        empty,
        'POST',
        '/api/workspaces/' + empty.workspaceId + '/projects',
        {
          key: 'NEW',
          name: 'New project',
        },
      )
    ).body.id;
    mkdirSync(OUT, { recursive: true });
  });

  afterAll(async () => {
    writeFileSync(join(OUT, 'problems.json'), JSON.stringify(problems, null, 1));
    await j.close();
  });

  /** Opens every screen for a person in one look and size, and notes what is wrong. */
  async function look(
    who: Person,
    projectId: string,
    label: string,
    theme: 'light' | 'dark',
    size: (typeof SIZES)[number],
  ): Promise<void> {
    const b = await launch(size);
    const page: Page = b.page;
    try {
      const pj: Journey = { ...j, page };
      await signIn(pj, who);
      await page.eval(`localStorage.setItem('pe-theme', '${theme}')`);
      const routes = [...WORKSPACE, ...PROJECT.map((v) => '/projects/' + projectId + v)];
      for (const route of routes) {
        const screen = label + ' ' + theme + ' ' + size.name + ' ' + route.replace(projectId, 'P');
        const before = page.errors.length;
        await page.goto(j.t.base + route);
        await page.settle();
        await page.press('Tab');
        const report = await page.eval<A11yPageReport>(auditScript());
        for (const f of report.findings)
          problems.push({ screen, kind: 'a11y ' + f.rule, detail: f.selector + ': ' + f.message });
        for (const e of quiet(page.errors.slice(before)))
          problems.push({ screen, kind: 'console', detail: e.slice(0, 300) });
        if (size.mobile) {
          const wide = await page.eval<number>(
            'document.documentElement.scrollWidth - window.innerWidth',
          );
          if (wide > 1) problems.push({ screen, kind: 'sideways', detail: String(wide) + ' px' });
        }
        await page.shot('../screens/' + screen.replace(/[^\w-]+/g, '_'));
      }
    } finally {
      await b.close();
    }
  }

  for (const theme of ['light', 'dark'] as const)
    for (const size of SIZES)
      it(
        'opens every screen, ' + theme + ' at ' + size.name + ' width',
        async () => {
          await look(full, project, 'full', theme, size);
          await look(empty, emptyProject, 'empty', theme, size);
        },
        900_000,
      );

  it('found nothing wrong', () => {
    expect(problems).toEqual([]);
  });
});
