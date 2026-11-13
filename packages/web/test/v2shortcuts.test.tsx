// ── [PCODE-346 | S15 | v0.1.0] T35.1a Cmd-K over agents, runs, people and settings; keyboard shortcut sheet ──
//    Why:  g and a letter goes somewhere only right after the g; the command bar shows agents, runs, people
//          and settings with their kind and opens them.
import { describe, expect, it } from 'vitest';
import { commandRows } from '../src/commandbar.js';
import { goTarget } from '../src/v2/shortcuts.js';

describe('keys and the command bar', () => {
  it('goes to a section on g and a letter within a second and a half', () => {
    expect(goTarget({ key: 'g', at: 1000 }, 'p', 2000)).toBe('/projects');
    expect(goTarget({ key: 'g', at: 1000 }, 'p', 3000)).toBeNull();
    expect(goTarget({ key: 'x', at: 1000 }, 'p', 1100)).toBeNull();
    expect(goTarget(null, 't', 0)).toBeNull();
    expect(goTarget({ key: 'g', at: 0 }, 'z', 10)).toBeNull();
  });
  it('lists agents, runs, people and settings, and opens them', () => {
    const went: string[] = [];
    const rows = commandRows(
      'pass',
      [],
      {
        items: [],
        projects: [],
        agents: [{ id: 'a1', key: 'analyst', name: 'Analyst agent' }],
        runs: [
          {
            id: 'r1',
            instruction: 'Summarise the password policy',
            status: 'succeeded',
            agent: 'Analyst agent',
          },
        ],
        people: [{ id: 'u1', name: 'Pascal', email: 'pascal@example.test' }],
        settings: [{ key: 'calendar.working_days', label: 'Working days' }],
      },
      (p) => went.push(p),
    );
    expect(rows.map((r) => r.hint)).toEqual([
      'Agent',
      'Run by Analyst agent · succeeded',
      'Person · pascal@example.test',
      'Setting',
    ]);
    for (const r of rows) r.run();
    expect(went).toEqual(['/agents', '/runs/r1', '/people', '/settings/workspace']);
  });
});
