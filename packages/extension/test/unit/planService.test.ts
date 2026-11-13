// ── [PCODE-31 | S06 | v0.1.0] Build the plan panel: description status, Draft, Check and Publish ──
//    Why:  the status matrix for description / plan / published, the check output parsing (incl. error lines),
//          the button preconditions, and the fixture workspace against the fake engine.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineCommands } from '../../src/engine/commands';
import { runEngine } from '../../src/engine/run';
import {
  PlanService,
  TEMPLATE_MARKER,
  buttonsFor,
  computeStatus,
  descriptionStatus,
  planFileStatus,
  publishedLine,
  summaryLine,
  toStatusMessage,
} from '../../src/plan/planService';
import { Logger } from '../../src/util/log';
import { isWebviewMessage } from '../../src/webviews/protocol';

const FAKE_HOME = path.resolve(__dirname, '..', 'fixtures', 'fake-engine');
const WORKSPACE = path.resolve(__dirname, '..', 'fixtures', 'workspace');
const OK = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'engine-output', 'check-ok.txt'),
  'utf8',
);
const ERRORS = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'engine-output', 'check-errors.txt'),
  'utf8',
);

const VALID_PLAN = '{"version":"0.1.0","sprints":[{"name":"S","date":"2026-01-01","items":[]}]}';

function services(stdout: string | Error, calls: string[][] = []) {
  const run = (_script: string, args: string[]) => {
    calls.push(args);
    if (stdout instanceof Error) return Promise.reject(stdout);
    return Promise.resolve({ code: 0, stdout, stderr: '' });
  };
  return { engine: new EngineCommands(run), root: () => 'C:\\proj', log: new Logger() };
}

describe('planService (pure)', () => {
  it('reads the description status like ui.ps1', () => {
    expect(descriptionStatus(null)).toBe('missing');
    expect(descriptionStatus(`# X\n\n${TEMPLATE_MARKER}. Plain language is fine.`)).toBe(
      'template',
    );
    expect(descriptionStatus('   \n')).toBe('template');
    expect(descriptionStatus('# Letterman\nA mail app.')).toBe('written');
    // [PCODE-454 | S15 | v0.1.0] the template's sentence left in, the headings filled in: written
    const head = `# Project description\n\n${TEMPLATE_MARKER}. Plain language is fine.\n\n`;
    expect(descriptionStatus(head + '## What it is\nA PIM system.\n')).toBe('written');
    expect(descriptionStatus(head + '## What it is\n\n## Must have\n')).toBe('template');
  });

  it('classifies plan.json', () => {
    expect(planFileStatus(null)).toBe('missing');
    expect(planFileStatus('{not json')).toBe('invalid');
    expect(planFileStatus('{"version":"1"}')).toBe('invalid');
    expect(planFileStatus(VALID_PLAN)).toBe('present');
  });

  // ── [PCODE-31 | S06 | v0.1.0] the status matrix ──
  it('status matrix: description x plan x published', () => {
    const none = computeStatus('C:\\p', { description: null, plan: null, publishedAt: null }, null);
    expect(none.description).toBe('missing');
    expect(none.plan).toBe('missing');
    expect(summaryLine(none)).toBe('No plan yet. Draft one with Claude.');
    expect(publishedLine(none)).toBe('Not yet published');
    expect(none.buttons).toEqual({
      openDescription: true,
      draft: false,
      check: false,
      publish: false,
    });

    const written = computeStatus(
      'C:\\p',
      { description: 'Real text', plan: null, publishedAt: null },
      null,
    );
    expect(written.buttons.draft).toBe(true);

    const invalid = computeStatus(
      'C:\\p',
      { description: 'Real text', plan: '{oops', publishedAt: null },
      null,
    );
    expect(invalid.plan).toBe('invalid');
    expect(invalid.buttons).toEqual({
      openDescription: true,
      draft: true,
      check: true,
      publish: false,
    });

    const checked = computeStatus(
      'C:\\p',
      { description: 'Real text', plan: VALID_PLAN, publishedAt: null },
      {
        sprints: 14,
        items: 68,
        from: '2026-09-23',
        to: '2026-10-12',
        version: '0.1.0',
        publishedAt: null,
        errors: [],
      },
    );
    expect(checked.plan).toBe('valid');
    expect(summaryLine(checked)).toBe('Plan valid: 14 sprints, 68 items, 2026-09-23 to 2026-10-12');
    expect(checked.buttons.publish).toBe(true);

    const withErrors = computeStatus(
      'C:\\p',
      { description: 'Real text', plan: VALID_PLAN, publishedAt: null },
      {
        sprints: 3,
        items: 9,
        from: 'a',
        to: 'b',
        version: '0.1.0',
        publishedAt: null,
        errors: [
          'sprint 1: date 2026-09-20 is in the past',
          'sprint 2 item 3: no acceptance checks',
        ],
      },
    );
    expect(withErrors.plan).toBe('errors');
    expect(summaryLine(withErrors)).toBe('Plan has 2 error(s).');
    expect(withErrors.buttons.publish).toBe(false);

    const published = computeStatus(
      'C:\\p',
      { description: 'Real text', plan: VALID_PLAN, publishedAt: '2026-09-22T10:00:00' },
      null,
    );
    expect(publishedLine(published)).toBe('Published 2026-09-22T10:00:00');

    const failed = computeStatus(
      'C:\\p',
      { description: 'Real text', plan: VALID_PLAN, publishedAt: null },
      null,
      'engine exploded',
    );
    expect(failed.plan).toBe('invalid');
    expect(failed.checkError).toBe('engine exploded');

    expect(buttonsFor({ root: null, description: 'written', plan: 'valid' })).toEqual({
      openDescription: false,
      draft: false,
      check: false,
      publish: false,
    });
    expect(buttonsFor({ root: 'x', description: 'written', plan: 'valid' }, true).publish).toBe(
      false,
    );
  });

  it('the message for the webview carries strings, errors and buttons', () => {
    const m = toStatusMessage(
      computeStatus(
        'C:\\p',
        { description: 'Real', plan: VALID_PLAN, publishedAt: null },
        {
          sprints: 1,
          items: 0,
          from: 'a',
          to: 'a',
          version: '1',
          publishedAt: '2026-01-01',
          errors: ['e1'],
        },
      ),
    );
    expect(m).toMatchObject({
      root: 'C:\\p',
      plan: 'errors',
      summary: 'Plan has 1 error(s).',
      errors: ['e1'],
      publishedAt: '2026-01-01',
      published: 'Published 2026-01-01',
    });
    expect(m.buttons.publish).toBe(false);
  });

  it('accepts the plan messages from the webview', () => {
    for (const t of ['refresh', 'openDescription', 'openPlan', 'draft', 'check', 'publish'])
      expect(isWebviewMessage({ type: `plan/${t}` })).toBe(true);
    expect(isWebviewMessage({ type: 'plan/nuke' })).toBe(false);
  });
});

describe('PlanService.status (scripted engine)', () => {
  const io = (files: Record<string, string>) => ({
    existsSync: (p: string) => Object.keys(files).some((k) => p.endsWith(k)),
    readFileSync: (p: string) => files[Object.keys(files).find((k) => p.endsWith(k)) ?? ''] ?? '',
  });

  it('parses the engine check: valid output', async () => {
    const calls: string[][] = [];
    const svc = new PlanService(services(OK, calls), io({ 'plan.json': VALID_PLAN }));
    const s = await svc.status();
    expect(calls).toEqual([['check']]);
    expect(s.plan).toBe('valid');
    expect(summaryLine(s)).toBe('Plan valid: 5 sprints, 23 items, 2026-09-23 to 2026-09-29');
  });

  it('parses the engine check: error lines (exit 1 is still a result)', async () => {
    const svc = new PlanService(services(ERRORS), io({ 'plan.json': VALID_PLAN }));
    const s = await svc.status();
    expect(s.plan).toBe('errors');
    expect(s.check?.errors).toEqual([
      'sprint 1: date 2026-09-20 is in the past (Plane closes past sprints)',
      'sprint 2 item 3: no acceptance checks',
    ]);
  });

  it('does not run the engine without a plan and reports an engine failure', async () => {
    const calls: string[][] = [];
    const none = new PlanService(services(OK, calls), io({}));
    expect((await none.status()).plan).toBe('missing');
    expect(calls).toEqual([]);
    const failing = new PlanService(
      services(new Error('spawn ENOENT')),
      io({ 'plan.json': VALID_PLAN }),
    );
    const s = await failing.status();
    expect(s.plan).toBe('invalid');
    expect(s.checkError).toBe('spawn ENOENT');
  });
});

// ── [PCODE-31 | S06 | v0.1.0] the fixture workspace through the fake engine (real python) ──
describe('PlanService.status (fixture workspace, fake engine)', () => {
  const python = (() => {
    for (const c of [['py', '-3'], ['python3'], ['python']]) {
      const r = spawnSync(c[0] ?? '', [...c.slice(1), '--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return c;
    }
    return null;
  })();
  afterEach(() => {
    const calls = path.join(FAKE_HOME, 'plan-calls.jsonl');
    if (fs.existsSync(calls)) fs.unlinkSync(calls);
  });

  it.skipIf(!python)('shows Description written, Plan valid …, Not yet published', async () => {
    const engine = new EngineCommands((script, args) =>
      runEngine({ python: python ?? [], home: FAKE_HOME }, script, args, { cwd: WORKSPACE }),
    );
    const svc = new PlanService({ engine, root: () => WORKSPACE, log: new Logger() });
    const m = toStatusMessage(await svc.status());
    expect(m.description).toBe('written');
    expect(m.summary).toBe('Plan valid: 2 sprints, 3 items, 2026-01-01 to 2026-01-02');
    expect(m.published).toBe('Not yet published');
    expect(m.buttons).toEqual({ openDescription: true, draft: true, check: true, publish: true });
  });
});
