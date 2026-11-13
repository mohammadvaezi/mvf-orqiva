// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
//    Why:  the Architect is given its kind's sections and the requirements to cite; a version reports what
//          it cites and what not; every version exports as Markdown, Word and Gherkin, and the Word file
//          opens as a real document (read back with our own reader).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { markdownDocx, runs, wordBody } from '../../src/export/docxwrite.js';
import { docxText, zipEntries } from '../../src/files/docx.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 10, output: 5 },
});

describe('the Word writer', () => {
  it('turns headings, bullets, bold and tables into WordprocessingML', () => {
    expect(runs('a **b** _c_ x\\*y')).toBe(
      '<w:r><w:t xml:space="preserve">a </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">b</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">c</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> x*y</w:t></w:r>',
    );
    const body = wordBody('# Title\n\n## Part\n\n- one\n\n| A | B |\n| --- | ---: |\n| x | 3 |');
    expect(body).toContain('<w:pStyle w:val="Title"/>');
    expect(body).toContain('<w:pStyle w:val="Heading2"/>');
    expect(body).toContain('<w:pStyle w:val="ListBullet"/>');
    expect(body.match(/<w:tr>/g)).toHaveLength(2);
    expect(body).toContain('<w:jc w:val="right"/>');
    const file = markdownDocx('# A & B\n\nText <x>', 'A & B', new Date('2026-10-12T10:00:00Z'));
    expect(zipEntries(file).map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'docProps/core.xml',
    ]);
    expect(docxText(file)).toContain('A & B');
    expect(docxText(file)).toContain('Text <x>');
  });
});

describe.skipIf(!hasDatabase)('the PRD (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let idea = '';
  let project = '';
  let current: (ModelProvider & { requests: { system: string; messages: unknown[] }[] }) | null =
    null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'BKG', name: 'Bookings' })
    ).body.id;
    idea = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Reminders get lost',
        body: 'Some customers get no reminder.',
      })
    ).body.id;
    await t.call(ada, 'PATCH', W('/ideas/' + idea), { kind: 'bug' });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'text',
      title: 'Support ticket',
      body: 'The reminder never arrives for numbers with a +44 prefix.',
    });
    const ws = await t.call<{ sources: { id: string }[] }>(
      ada,
      'GET',
      W('/ideas/' + idea + '/workspace'),
    );
    await t.call(ada, 'POST', W('/ideas/' + idea + '/requirements'), {
      text: 'Reminders reach numbers with any country prefix',
      sourceId: ws.body.sources[0]?.id,
      passage: 'never arrives for numbers with a +44 prefix',
    });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/requirements'), {
      text: 'As a customer, I want my reminder, so that I come.',
      kind: 'story',
      scenarios: [
        { given: 'a +44 number', when: 'it is 18:00 the day before', then: 'the SMS arrives' },
      ],
    });
    current = scriptedProvider([say('READY: Numbers with +44 get no reminder.')]);
    await t.call(ada, 'POST', W('/ideas/' + idea + '/interview'), {});
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('gives the Architect the sections of a bug and the requirements to cite', async () => {
    current = scriptedProvider([
      say(
        '```json\n' +
          JSON.stringify({
            summary: 'Reminders reach every number [R-1]. Nobody misses a slot.',
            problem: 'Numbers with +44 get nothing [S1].',
            goals: ['Every customer gets the reminder [R-1, R-2]'],
            scopeIn: ['Normalise country prefixes [R-1]'],
            scopeOut: ['Other channels'],
            risks: [],
            sections: [
              { key: 'steps', title: 'Steps to reproduce', body: '1. Book with +44. 2. Wait.' },
              { key: 'expected', title: 'Expected and actual', body: 'Expected an SMS [R-1].' },
            ],
            tasks: [{ title: 'Fix the prefix', estimate: 3 }],
          }) +
          '\n```',
      ),
    ]);
    const d = await t.call<{ version: number; content: { sections?: unknown[] } }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/proposals/draft'),
    );
    expect(d.status).toBe(201);
    expect(d.body.content.sections).toHaveLength(2);
    const brief = JSON.stringify(current.requests[0]?.messages);
    expect(brief).toContain('SECTIONS for a bug:');
    expect(brief).toContain('- steps: Steps to reproduce');
    expect(brief).toContain('REQUIREMENTS:');
    expect(brief).toContain('R-1: Reminders reach numbers with any country prefix');
    expect(current.requests[0]?.system).toContain('never invent a code');
  });

  it('reports what a version cites, with the passages behind it', async () => {
    const prd = await t.call<{
      kind: string;
      template: { key: string }[];
      refs: { code: string; source: string; passage: string }[];
      report: { total: number; cited: number; uncited: { path: string }[] };
      stories: { code: string; scenarios: unknown[] }[];
    }>(ada, 'GET', W('/ideas/' + idea + '/prd'));
    expect(prd.status).toBe(200);
    expect(prd.body.kind).toBe('bug');
    expect(prd.body.template.map((s) => s.key)).toEqual(['steps', 'expected', 'affected']);
    expect(prd.body.refs.find((r) => r.code === 'R-1')).toMatchObject({
      source: 'S1 Support ticket',
      passage: 'never arrives for numbers with a +44 prefix',
    });
    expect(prd.body.refs.find((r) => r.code === 'S1')).toMatchObject({ source: '' });
    expect(prd.body.report.uncited.map((s) => s.path)).toEqual([
      'summary.2',
      'scopeOut.1',
      'sections.steps.1',
      'sections.steps.2',
    ]);
    expect(prd.body.stories).toEqual([
      expect.objectContaining({
        code: 'R-2',
        scenarios: [expect.objectContaining({ then: 'the SMS arrives' })],
      }),
    ]);
    expect((await t.call(ada, 'GET', W('/ideas/' + idea + '/prd?version=9'))).status).toBe(404);
  });

  // [PCODE-276 | S15 | v0.1.0]
  it('sizes a version, gives a range from how finished tasks came out, and a basis per task', async () => {
    const none = await t.call<{
      range: { basis: string; confidence: string; size: string };
      text: string;
    }>(ada, 'GET', W('/ideas/' + idea + '/estimate'));
    expect(none.status).toBe(200);
    expect(none.body.range).toMatchObject({ basis: 'standard', confidence: 'low', size: 'XS' });
    // six finished tasks, each took one and a half times its estimate
    const hpp = 6;
    const set = await t.call(ada, 'PUT', W('/settings/planning.hours_per_point'), {
      scope: 'project',
      scopeId: project,
      value: hpp,
    });
    expect(set.status).toBe(200);
    for (const [i, title] of [
      'Fix the prefix parser',
      'Fix phone prefix in import',
      'Mail layout',
      'Login',
      'Search',
      'Export',
    ].entries()) {
      const id = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
          title,
          estimate: 2,
        })
      ).body.id;
      await inSystem(t.db.pool, async (c) => {
        await c.query("UPDATE items SET completed_at = now() - interval '3 days' WHERE id = $1", [
          id,
        ]);
        await c.query(
          "INSERT INTO time_entries (workspace_id, user_id, item_id, project_id, day, minutes, source) VALUES ($1, $2, $3, $4, current_date - $5::int, $6, 'manual')",
          [ada.workspaceId, ada.id, id, project, i + 1, 2 * hpp * 60 * 1.5],
        );
      });
    }
    const e = await t.call<{
      range: { basis: string; history: number; likely: number; points: number };
      text: string;
      tasks: {
        title: string;
        similar: { ref: string; hours: number }[];
        suggested: number | null;
      }[];
    }>(ada, 'GET', W('/ideas/' + idea + '/estimate'));
    expect(e.body.range).toMatchObject({ basis: 'history', history: 6, points: 3, likely: 4.5 });
    expect(e.body.text).toContain('from 6 finished tasks');
    const fix = e.body.tasks.find((x) => x.title === 'Fix the prefix');
    expect(fix?.similar.map((s) => s.ref)).toEqual(['BKG-1', 'BKG-2']);
    expect(fix?.similar[0]?.hours).toBe(18);
    expect(fix?.suggested).toBe(3);
  });

  it('exports a version as Markdown, Word and Gherkin', async () => {
    const get = (format: string) =>
      fetch(t.base + W('/ideas/' + idea + '/prd/export?version=1&format=' + format), {
        headers: { cookie: ada.cookie },
      });
    const md = await get('md');
    expect(md.status).toBe(200);
    expect(md.headers.get('content-disposition')).toContain('bkg-i1-prd-v1.md');
    const text = await md.text();
    expect(text).toContain('# BKG-I1 Reminders get lost');
    expect(text).toContain('## Steps to reproduce');
    expect(text).toContain('### R-2');
    expect(text).toContain('working days. Size XS · likely'); // [PCODE-276 | S15 | v0.1.0]
    expect(text).toContain(
      '- **R-1** Reminders reach numbers with any country prefix — S1 Support ticket:',
    );
    const docx = await get('docx');
    expect(docx.headers.get('content-type')).toContain('wordprocessingml');
    const words = docxText(Buffer.from(await docx.arrayBuffer()));
    expect(words).toContain('BKG-I1 Reminders get lost');
    expect(words).toContain('Steps to reproduce');
    expect(words).toContain('• Every customer gets the reminder [R-1, R-2]');
    const feature = await (await get('feature')).text();
    expect(feature).toContain('Feature: BKG-I1 Reminders get lost');
    expect(feature).toContain('    Then the SMS arrives');
  });
});
