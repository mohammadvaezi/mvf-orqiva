// ── [PCODE-197 | S15 | v0.1.0] T16.1 Docs from code: API reference, system overview and built-by-task pages, drift warnings ──
//    Why:  the pages built from the code read the same on every rebuild, and a hand-written page names the
//          repo files that changed after it or are gone, never a web address.
import { describe, expect, it } from 'vitest';
import { builtByTaskPage, codePages, codeRefs, driftOf, systemOverviewPage } from '../src/index.js';

const ep = (over: Partial<Parameters<typeof codePages>[0]['endpoints'][number]>) => ({
  kind: 'http',
  method: 'GET',
  path: '/tours',
  summary: 'List tours',
  auth: 'session',
  tag: 'Tours',
  ref: 'DEMO-4',
  ...over,
});
const file = (path: string, lines: number, over = {}) => ({
  path,
  language: 'TypeScript',
  lines,
  complexity: 10,
  churn: 2,
  authors: { ada: lines },
  agentShare: 0.5,
  ...over,
});

describe('pages built from the code', () => {
  it('writes one API page per tag, with a stable key', () => {
    const pages = codePages({
      endpoints: [
        ep({}),
        ep({ method: 'POST', summary: 'Plan | a tour', ref: null }),
        ep({ tag: '', path: '/health' }),
        ep({ kind: 'event', method: '', path: 'tour.started', tag: 'Tours' }),
      ],
      files: [],
      marks: [],
    });
    expect(pages.map((p) => [p.key, p.title, p.from])).toEqual([
      ['api:general', 'General API (from code)', 'OpenAPI (1 entry)'],
      ['api:tours', 'Tours API (from code)', 'OpenAPI (3 entries)'],
    ]);
    const tours = pages[1]?.body ?? '';
    expect(tours).toContain('| POST | `/tours` | session | Plan \\| a tour | – |');
    expect(tours).toContain('## Events and tables');
    expect(tours).toContain('| event | `tour.started` |');
  });

  it('outlines folders with lines, owners and hot spots', () => {
    const p = systemOverviewPage([
      file('packages/web/src/a.tsx', 1200, { churn: 50, complexity: 300 }),
      file('packages/web/src/b.tsx', 100),
      file('packages/server/x.ts', 300, { authors: { 'Coder agent': 300 }, agentShare: 1 }),
      file('README.md', 20, { language: 'Markdown' }),
    ]);
    expect(p?.key).toBe('code:overview');
    expect(p?.from).toBe('code scan (4 files)');
    expect(p?.body).toContain('4 files and 1.620 lines in 3 folders');
    expect(p?.body).toContain('subgraph f_packages["packages"]');
    expect(p?.body).toContain('f_packages_web["web · 1.300 lines"]');
    expect(p?.body).toContain('| `packages/server` | 1 | 300 | TypeScript | Coder agent | 100 % |');
    expect(p?.body).toContain('- `packages/web/src/a.tsx`: 50 changes in 90 days, complexity 300');
    expect(systemOverviewPage([])).toBeNull();
  });

  it('lists what each task built, newest sprint first', () => {
    const p = builtByTaskPage([
      {
        ref: 'DEMO-10',
        title: 'Reminders',
        sprint: 'S02',
        path: 'src/r.ts',
        line: 9,
        kind: 'block',
      },
      {
        ref: 'DEMO-10',
        title: 'Reminders',
        sprint: 'S02',
        path: 'src/r.ts',
        line: 1,
        kind: 'header',
      },
      { ref: 'DEMO-2', title: 'Login', sprint: 'S02', path: 'src/l.ts', line: 1, kind: 'header' },
      {
        ref: 'DEMO-1',
        title: 'Setup',
        sprint: 'S01',
        path: 'package.json',
        line: 1,
        kind: 'header',
      },
    ]);
    const b = p?.body ?? '';
    expect(p?.from).toBe('fingerprints (3 tasks)');
    expect(b.indexOf('## S02')).toBeLessThan(b.indexOf('## S01'));
    expect(b.indexOf('### DEMO-2 Login')).toBeLessThan(b.indexOf('### DEMO-10 Reminders'));
    expect(b).toContain('- `src/r.ts` lines 1, 9');
  });
});

describe('drift', () => {
  it('finds repo paths, not web addresses', () => {
    expect(
      codeRefs(
        'The socket waits in `src/live/socket.ts:88`, see packages/web/src/app.tsx. Not https://x.org/a/b.js or ../up/x.ts.',
      ),
    ).toEqual([
      { path: 'src/live/socket.ts', line: 88 },
      { path: 'packages/web/src/app.tsx', line: null },
    ]);
  });

  it('flags files changed after the page, and files that are gone', () => {
    const refs = codeRefs('`src/a.ts` `src/b.ts` `src/c.ts`');
    const files = new Map<string, Date | null>([
      ['src/a.ts', new Date('2026-10-09T10:00:00Z')],
      ['src/b.ts', new Date('2026-10-01T10:00:00Z')],
    ]);
    expect(driftOf(refs, new Date('2026-10-05T00:00:00Z'), files)).toEqual([
      { path: 'src/a.ts', line: null, state: 'changed', changedAt: '2026-10-09T10:00:00.000Z' },
      { path: 'src/c.ts', line: null, state: 'gone', changedAt: null },
    ]);
    expect(driftOf(refs, new Date(), new Map())).toEqual([]);
  });
});
