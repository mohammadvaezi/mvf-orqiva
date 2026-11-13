// ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
//    Why:  shared steps are written once and change every case that uses them, and cannot be removed while
//          used; a run shows them expanded with its configuration filled into <names> and takes one result
//          per shown step; a feature file becomes one BDD case per scenario, and a case's Gherkin is checked
//          and turned into steps and parameters.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Design {
  kind: string;
  steps: { action: string; expected: string; shared?: string }[];
  shown: { action: string; expected: string; from?: { name: string } }[];
  parameters: Record<string, string[]>;
  gherkin: string;
  version: number;
}

describe.skipIf(!hasDatabase)('shared steps, parameters and BDD (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let project = '';
  let other = '';
  let signIn = '';
  let cart = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const design = (id: string, body?: Record<string, unknown>) =>
    body
      ? t.call<Design>(ada, 'PATCH', W('/test-cases/' + id + '/design'), body)
      : t
          .call<{ design: Design }>(ada, 'GET', W('/test-cases/' + id + '/design'))
          .then((r) => ({ ...r, body: r.body.design }));

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    other = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' }))
      .body.id;
    cart = (
      await t.call<{ id: string }>(ada, 'POST', P('/test-cases'), { title: 'Cart keeps items' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps shared steps once and shows them in every case that uses them', async () => {
    const made = await t.call<{ id: string; usedBy: number }>(
      ada,
      'POST',
      P('/test-shared-steps'),
      {
        name: 'Sign in',
        steps: [
          { action: 'Open <url>', expected: '' },
          { action: 'Sign in as Ada', expected: 'The board shows' },
        ],
      },
    );
    expect(made.status).toBe(201);
    signIn = made.body.id;
    expect(
      (
        await t.call(ada, 'POST', P('/test-shared-steps'), {
          name: 'Sign in',
          steps: [{ action: 'x', expected: '' }],
        })
      ).status,
    ).toBe(409);
    const d = await design(cart, {
      steps: [
        { action: '', expected: '', shared: signIn },
        { action: 'Add a book on <browser>', expected: 'The cart shows 1' },
      ],
      parameters: { browser: ['chromium', 'webkit'], url: ['https://shop.test'] },
    });
    expect(d.status).toBe(200);
    expect(d.body.steps[0]).toEqual({ action: '', expected: '', shared: signIn });
    expect(d.body.shown.map((s) => s.action + (s.from ? ' [' + s.from.name + ']' : ''))).toEqual([
      'Open <url> [Sign in]',
      'Sign in as Ada [Sign in]',
      'Add a book on <browser>',
    ]);
    // a step needs an action unless it is shared, and the shared steps must be the project's own
    expect((await design(cart, { steps: [{ action: ' ', expected: '' }] })).status).toBe(400);
    const elsewhere = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + other + '/test-shared-steps'), {
        name: 'Sign in',
        steps: [{ action: 'Open the console', expected: '' }],
      })
    ).body.id;
    expect(
      (await design(cart, { steps: [{ action: '', expected: '', shared: elsewhere }] })).status,
    ).toBe(400);

    // a change to the shared steps shows in the case; one in use is not removed
    await t.call(ada, 'PATCH', W('/test-shared-steps/' + signIn), {
      steps: [
        { action: 'Open <url>', expected: '' },
        { action: 'Sign in as Ada with a passkey', expected: 'The board shows' },
      ],
    });
    expect((await design(cart)).body.shown[1]?.action).toBe('Sign in as Ada with a passkey');
    const list = await t.call<{ name: string; usedBy: number; version: number }[]>(
      ada,
      'GET',
      P('/test-shared-steps'),
    );
    expect(list.body).toEqual([
      expect.objectContaining({ name: 'Sign in', usedBy: 1, version: 2 }),
    ]);
    const blocked = await t.call<{ error: { message: string } }>(
      ada,
      'DELETE',
      W('/test-shared-steps/' + signIn),
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toBe('Still used by “Cart keeps items”');
    expect(
      (
        await t.call(gus, 'POST', P('/test-shared-steps'), {
          name: 'x',
          steps: [{ action: 'x', expected: '' }],
        })
      ).status,
    ).toBe(403);
  });

  it('runs the case with its configuration filled in, one result per shown step', async () => {
    const runs = await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
      name: 'Release check',
      caseIds: [cart],
      configs: [{ browser: 'webkit', url: 'https://shop.test' }],
    });
    const run = runs.body[0]?.id ?? '';
    const plan = await t.call<{ cases: { caseId: string; steps: { action: string }[] }[] }>(
      ada,
      'GET',
      W('/test-runs/' + run + '/plan'),
    );
    expect(plan.body.cases[0]?.steps.map((s) => s.action)).toEqual([
      'Open https://shop.test',
      'Sign in as Ada with a passkey',
      'Add a book on webkit',
    ]);
    const two = await t.call(ada, 'PUT', W('/test-runs/' + run + '/cases/' + cart), {
      status: 'failed',
      steps: [
        { status: 'passed', note: '' },
        { status: 'failed', note: 'No passkey prompt' },
      ],
    });
    expect(two.status).toBe(400);
    const three = await t.call(ada, 'PUT', W('/test-runs/' + run + '/cases/' + cart), {
      status: 'failed',
      steps: [
        { status: 'passed', note: '' },
        { status: 'failed', note: 'No passkey prompt' },
        { status: 'untested', note: '' },
      ],
    });
    expect(three.status).toBe(200);
  });

  it('reads a feature into one BDD case per scenario, and checks a case’s Gherkin', async () => {
    const bad = await t.call<{ error: { details: { path: string; message: string }[] } }>(
      ada,
      'POST',
      P('/test-cases/gherkin'),
      { text: 'Feature: Cart\nScenario: Empty\n' },
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toEqual([
      { path: 'body.text', message: 'Scenario "Empty" has no steps' },
    ]);
    const r = await t.call<{ created: { id: string; title: string }[] }>(
      ada,
      'POST',
      P('/test-cases/gherkin'),
      {
        text: [
          'Feature: Checkout',
          '  Background:',
          '    Given a cart with a book',
          '  Scenario: Pay by card',
          '    When I pay by card',
          '    Then I see the receipt',
          '  Scenario Outline: Shipping',
          '    When I ship to <country>',
          '    Then shipping costs <cost>',
          '    Examples:',
          '      | country | cost |',
          '      | DE      | 4.90 |',
          '      | AT      | 7.90 |',
        ].join('\n'),
      },
    );
    expect(r.status).toBe(201);
    expect(r.body.created.map((c) => c.title)).toEqual(['Pay by card', 'Shipping']);
    const shipping = await design(r.body.created[1]?.id ?? '');
    expect(shipping.body).toMatchObject({
      kind: 'bdd',
      parameters: { country: ['DE', 'AT'], cost: ['4.90', '7.90'] },
      steps: [
        { action: 'Given a cart with a book', expected: '' },
        { action: 'When I ship to <country>', expected: 'shipping costs <cost>' },
      ],
    });
    expect(shipping.body.gherkin).toContain('Scenario Outline: Shipping');
    const suites = await t.call<{ suite: string }[]>(ada, 'GET', P('/test-suites'));
    expect(suites.body.map((s) => s.suite)).toContain('Checkout');

    // the case's own Gherkin: one scenario, and it makes the steps and a new version
    const id = r.body.created[0]?.id ?? '';
    const before = (await design(id)).body.version;
    expect(
      (
        await design(id, {
          gherkin: 'Feature: Checkout\nScenario: A\n  When x\nScenario: B\n  When y\n',
        })
      ).status,
    ).toBe(400);
    const changed = await design(id, {
      gherkin:
        'Feature: Checkout\nScenario: Pay by card\n  When I pay by card\n  Then I see the receipt\n  And a mail arrives\n',
    });
    expect(changed.body.steps).toEqual([
      { action: 'When I pay by card', expected: 'I see the receipt; a mail arrives' },
    ]);
    expect(changed.body.version).toBe(before + 1);
  });
});
