// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
//    Why:  a code scan and screen audits replace their last ones, are counted by rule, read by auditors,
//          written by members only, and a rule the server does not know is refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('accessibility reports (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let aud: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    aud = await t.signup('Aud');
    await t.call(ada, 'POST', W('/members'), { email: aud.email, role: 'auditor' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'A11', name: 'Access' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps the latest code scan and the latest audit per screen', async () => {
    const f = (rule: string, line = 1) => ({
      path: 'src/App.tsx',
      line,
      rule,
      snippet: '<img src={a} />',
    });
    expect(
      (await t.call(aud, 'POST', P('/a11y/code'), { files: 3, findings: [f('alt-missing')] }))
        .status,
    ).toBe(403);
    expect(
      (await t.call(ada, 'POST', P('/a11y/code'), { files: 3, findings: [f('made-up')] })).status,
    ).toBe(400);
    await t.call(ada, 'POST', P('/a11y/code'), {
      files: 3,
      findings: [f('alt-missing'), f('alt-missing', 4), f('name-missing', 9)],
    });
    await t.call(ada, 'POST', P('/a11y/code'), {
      files: 4,
      findings: [f('alt-missing')],
      commit: 'abc1234',
    });
    const page = (name: string, n: number) =>
      t.call(ada, 'POST', P('/a11y/pages'), {
        name,
        url: 'http://localhost:5173/checkout',
        title: 'Checkout',
        checked: { targets: 20, focusable: 18, images: 4 },
        findings: Array.from({ length: n }, (_, i) => ({
          rule: i % 2 ? 'target-size' : 'focus-invisible',
          selector: 'button.icon:nth(' + String(i) + ')',
          message: 'm',
        })),
      });
    await page('Checkout', 5);
    await page('Checkout', 3); // replaces
    await page('Home', 0);
    expect((await page('../x', 1)).status).toBe(400);

    type R = {
      code: { files: number; counts: Record<string, number>; commit: string; by: string } | null;
      pages: { name: string; counts: Record<string, number>; checked: { targets: number } }[];
    };
    const r = (await t.call<R>(aud, 'GET', P('/a11y'))).body;
    expect(r.code).toMatchObject({
      files: 4,
      counts: { 'alt-missing': 1 },
      commit: 'abc1234',
      by: 'Ada',
    });
    expect(r.pages.map((p) => [p.name, p.counts])).toEqual([
      ['Checkout', { 'focus-invisible': 2, 'target-size': 1 }],
      ['Home', {}],
    ]);
    expect(r.pages[0]?.checked.targets).toBe(20);
  });
});
