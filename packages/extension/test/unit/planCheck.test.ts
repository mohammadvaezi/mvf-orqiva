// ── [PCODE-33 | S06 | v0.1.0] Validate plan.json with plane_plan.py check and show errors before Publish ──
//    Why:  the engine's check output fixtures (valid and invalid) parse into a status with located errors,
//          the location resolves to a line in plan.json, and the debounce coalesces edits into one re-check.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EngineCommands } from '../../src/engine/commands';
import { parseCheck } from '../../src/engine/parse';
import {
  Debounce,
  describeLocation,
  locateInPlan,
  parseCheckError,
} from '../../src/plan/planCheck';
import { PlanService, toStatusMessage } from '../../src/plan/planService';
import { Logger } from '../../src/util/log';
import { isWebviewMessage } from '../../src/webviews/protocol';

const fixture = (n: string): string =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'engine-output', n), 'utf8');

const INVALID_PLAN = `{
  "version": "0.1.0",
  "sprints": [
    {
      "name": "Sprint 01 - Old \\"quoted\\" day",
      "date": "2026-09-20",
      "items": [
        { "title": "First thing", "description_md": "long enough description of the first thing here", "acceptance": ["a"] },
        { "title": "Second thing", "description_md": "short", "acceptance": ["b"] }
      ]
    },
    { "name": "Sprint 02 - Next", "date": "2026-09-24", "items": [{ "title": "Third", "description_md": "x", "acceptance": [] }] }
  ]
}`;

describe('plan check parsing', () => {
  it('parses the valid fixture into a summary without errors', () => {
    const c = parseCheck(fixture('check-ok.txt'));
    expect(c).toMatchObject({
      sprints: 5,
      items: 23,
      from: '2026-09-23',
      to: '2026-09-29',
      errors: [],
    });
  });

  // ── [PCODE-33 | S06 | v0.1.0] the invalid fixture: two errors with sprint / item locations ──
  it('parses the invalid fixture into located errors', () => {
    const c = parseCheck(fixture('check-invalid.txt'));
    expect(c.errors).toHaveLength(2);
    const [a, b] = c.errors.map(parseCheckError);
    expect(a).toEqual({
      raw: 'sprint 1: date 2026-09-20 is in the past (Plane closes past sprints)',
      sprint: 1,
      item: null,
      message: 'date 2026-09-20 is in the past (Plane closes past sprints)',
    });
    expect(b).toEqual({
      raw: 'sprint 1 item 2: description too short',
      sprint: 1,
      item: 2,
      message: 'description too short',
    });
    expect(describeLocation(a ?? parseCheckError(''))).toBe('Sprint 1');
    expect(describeLocation(b ?? parseCheckError(''))).toBe('Sprint 1, item 2');
    const plain = parseCheckError("plan.json needs a non-empty 'sprints' list");
    expect(plain.sprint).toBeNull();
    expect(describeLocation(plain)).toBe('');
  });

  it('locates a sprint by its name and an item by its title in plan.json', () => {
    expect(locateInPlan(INVALID_PLAN, parseCheckError('sprint 1: date in the past'))).toBe(5);
    expect(
      locateInPlan(INVALID_PLAN, parseCheckError('sprint 1 item 2: description too short')),
    ).toBe(9);
    expect(
      locateInPlan(INVALID_PLAN, parseCheckError('sprint 2 item 1: no acceptance checks')),
    ).toBe(12);
    expect(locateInPlan(INVALID_PLAN, parseCheckError('sprint 9: missing name'))).toBeNull();
    expect(locateInPlan(INVALID_PLAN, parseCheckError('no sprints'))).toBeNull();
    expect(locateInPlan('{oops', parseCheckError('sprint 1: x'))).toBeNull();
  });

  it('the status message carries the errors and keeps Publish disabled', async () => {
    const engine = new EngineCommands(() =>
      Promise.resolve({ code: 0, stdout: fixture('check-invalid.txt'), stderr: '' }),
    );
    const svc = new PlanService(
      { engine, root: () => 'C:\\p', log: new Logger() },
      { existsSync: (p) => p.endsWith('plan.json'), readFileSync: () => INVALID_PLAN },
    );
    const m = toStatusMessage(await svc.status());
    expect(m.plan).toBe('errors');
    expect(m.errors).toEqual([
      'sprint 1: date 2026-09-20 is in the past (Plane closes past sprints)',
      'sprint 1 item 2: description too short',
    ]);
    expect(m.buttons.publish).toBe(false);
    expect(isWebviewMessage({ type: 'plan/openError', index: 1 })).toBe(true);
    expect(isWebviewMessage({ type: 'plan/openError', index: -1 })).toBe(false);
    expect(isWebviewMessage({ type: 'plan/openError' })).toBe(false);
  });

  // ── [PCODE-33 | S06 | v0.1.0] many edits, one re-check ──
  it('debounces a burst of changes into one call', () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const d = new Debounce(500, () => {
        calls++;
      });
      d.schedule();
      d.schedule();
      vi.advanceTimersByTime(400);
      d.schedule();
      vi.advanceTimersByTime(400);
      expect(calls).toBe(0);
      expect(d.pending).toBe(true);
      vi.advanceTimersByTime(200);
      expect(calls).toBe(1);
      expect(d.pending).toBe(false);
      d.schedule();
      d.dispose();
      vi.advanceTimersByTime(1000);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
