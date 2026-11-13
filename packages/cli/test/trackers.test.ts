// ── [PCODE-360 | S15 | v0.1.0] T35.7b Jira and Linear imports with assignees and comments ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-129 | S15 | v0.1.0] Import from Jira and Linear CSV exports ──
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv, records, toIso } from '../src/import/csv.js';
import { runImport } from '../src/import/command.js';
import {
  groupOfName,
  jiraComment,
  jiraGroup,
  matchPeople,
  points,
  readJira,
  readLinear,
  readPeople,
} from '../src/import/trackers.js';

const NOW = '2026-10-04T00:00:00.000Z';

// as Jira writes it: repeated Labels and Sprint columns, quotes, a line break in a description
const JIRA = [
  // [PCODE-360 | S15 | v0.1.0] with the assignee and comments as "date;author;text"
  'Summary,Issue key,Issue id,Issue Type,Status,Status Category,Project key,Project name,Priority,Created,Updated,Description,Labels,Labels,Sprint,Sprint,Custom field (Story Points),Parent,Assignee,Comment,Comment',
  'Export the report,APP-1,10001,Story,In Progress,In Progress,APP,The App,High,03/Oct/26 2:15 PM,04/Oct/26 9:00 AM,"Finance needs it, ""today"".\nTwo lines.",finance,csv,Sprint 1,Sprint 2,5,,Ada Lovelace,03/Oct/26 3:00 PM;ada@example.test;Looks good; ship it,04/Oct/26 9:00 AM;5b10ac8d;Shipped?',
  'Write the header,APP-2,10002,Sub-task,Done,Done,APP,The App,Medium,03/Oct/26 3:00 PM,03/Oct/26 4:00 PM,,,,Sprint 2,,2,10001,bob@example.test,03/Oct/26 4:00 PM;Grace;Header done,',
  "Old idea,APP-3,10003,Bug,Won't Do,Done,APP,The App,Low,01/Sep/26 10:00 AM,01/Sep/26 10:00 AM,,,,,,,,,,",
  'Other project,OPS-7,20007,Task,Backlog,To Do,OPS,Ops,Medium,01/Sep/26 10:00 AM,01/Sep/26 10:00 AM,,,,,,,,,,',
].join('\r\n');

const LINEAR = [
  'ID,Team,Title,Description,Status,Estimate,Priority,Labels,Cycle Number,Cycle Name,Parent issue,Created,Updated,Started,Completed,Canceled,Assignee',
  'ENG-12,Engineering,Login page,"Email, password",In Review,3,Urgent,"auth, web",4,,,2026-09-01T10:00:00.000Z,2026-09-02T10:00:00.000Z,2026-09-02T10:00:00.000Z,,,Ada Lovelace',
  'ENG-13,Engineering,Reset password,,Todo,,No priority,auth,,,ENG-12,2026-09-01T11:00:00.000Z,2026-09-01T11:00:00.000Z,,,,',
  'ENG-14,Engineering,Remember me,,Done,1,Low,,,,,2026-09-01T12:00:00.000Z,2026-09-03T12:00:00.000Z,,2026-09-03T12:00:00.000Z,,',
].join('\n');

describe('our CSV reader', () => {
  it('handles quotes, doubled quotes, commas and line breaks inside fields, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n,\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
      ['', ''],
    ]);
  });

  it('reads rows by column name, keeping every value of a repeated column', () => {
    const [r] = records('Labels,Name,Labels\na,N,b\n');
    expect(r?.get('labels')).toBe('a');
    expect(r?.all('Labels')).toEqual(['a', 'b']);
    expect(r?.get('missing')).toBe('');
  });

  it('turns both tools’ dates into ISO 8601', () => {
    expect(toIso('03/Oct/26 2:15 PM', NOW)).toBe('2026-10-03T14:15:00.000Z');
    expect(toIso('03/Oct/26 12:05 AM', NOW)).toBe('2026-10-03T00:05:00.000Z');
    expect(toIso('2026-09-01T10:00:00.000Z', NOW)).toBe('2026-09-01T10:00:00.000Z');
    expect(toIso('', NOW)).toBe(NOW);
    expect(toIso('yesterday-ish', NOW)).toBe(NOW);
  });
});

describe('status groups and points', () => {
  it('map by category, then by name', () => {
    expect(jiraGroup('Backlog', 'To Do')).toBe('backlog');
    expect(jiraGroup('Selected', 'To Do')).toBe('unstarted');
    expect(jiraGroup('QA', 'In Progress')).toBe('started');
    expect(jiraGroup("Won't Do", 'Done')).toBe('cancelled');
    expect(groupOfName('Closed')).toBe('completed');
    expect(groupOfName('Code Review')).toBe('started');
    expect(points('2.5')).toBe(3);
    expect(points('')).toBeNull();
  });
});

describe('a Jira export', () => {
  it('becomes the project with statuses, sprints, labels, estimates and parents', () => {
    const { bundle, skipped } = readJira(JIRA, NOW);
    expect(skipped).toBe(1);
    expect(bundle.project).toMatchObject({ key: 'APP', name: 'The App' });
    expect(bundle.items.map((i) => [i.sequence, i.estimate])).toEqual([
      [1, 5],
      [2, 2],
      [3, null],
    ]);
    const [one, two, three] = bundle.items;
    expect(one?.description).toBe('Finance needs it, "today".\nTwo lines.');
    expect(one?.labelExternalIds).toEqual(['jira:APP:label:finance', 'jira:APP:label:csv']);
    expect(one?.sprintExternalId).toBe('jira:APP:sprint:Sprint 2');
    expect(one?.createdAt).toBe('2026-10-03T14:15:00.000Z');
    expect(two?.parentExternalId).toBe(one?.externalId);
    expect(three?.labelExternalIds).toEqual(['jira:APP:label:type: Bug']);
    expect(bundle.states).toEqual([
      { externalId: 'jira:APP:state:In Progress', name: 'In Progress', group: 'started' },
      { externalId: 'jira:APP:state:Done', name: 'Done', group: 'completed' },
      { externalId: "jira:APP:state:Won't Do", name: "Won't Do", group: 'cancelled' },
    ]);
    // [PCODE-360 | S15 | v0.1.0] the comments, in order, with their dates and authors
    expect(bundle.comments.map((c) => [c.itemExternalId, c.author, c.body, c.createdAt])).toEqual([
      ['jira:10001', 'ada@example.test', 'Looks good; ship it', '2026-10-03T15:00:00.000Z'],
      ['jira:10001', '5b10ac8d', 'Shipped?', '2026-10-04T09:00:00.000Z'],
      ['jira:10002', 'Grace', 'Header done', '2026-10-03T16:00:00.000Z'],
    ]);
    expect(one?.assigneeEmails).toEqual(['Ada Lovelace']);
    expect(readJira(JIRA, NOW, 'ops').bundle.items).toHaveLength(1);
    expect(() => readJira(LINEAR, NOW)).toThrow('not a Jira export');
  });
});

describe('a Linear export', () => {
  it('becomes the team’s project, with groups from its timestamps', () => {
    const { bundle } = readLinear(LINEAR, NOW);
    expect(bundle.project).toMatchObject({ key: 'ENG', name: 'Engineering' });
    expect(bundle.states.map((s) => [s.name, s.group])).toEqual([
      ['In Review', 'started'],
      ['Todo', 'unstarted'],
      ['Done', 'completed'],
    ]);
    const [login, reset] = bundle.items;
    expect(login).toMatchObject({
      estimate: 3,
      priority: 'urgent',
      sprintExternalId: 'linear:ENG:sprint:Cycle 4',
    });
    expect(login?.labelExternalIds).toEqual(['linear:ENG:label:auth', 'linear:ENG:label:web']);
    expect(reset).toMatchObject({
      estimate: null,
      priority: 'none',
      parentExternalId: login?.externalId,
    });
    expect(login?.assigneeEmails).toEqual(['Ada Lovelace']); // [PCODE-360 | S15 | v0.1.0]
    expect(reset?.assigneeEmails).toEqual([]);
  });
});

// [PCODE-360 | S15 | v0.1.0]
describe('people in an import', () => {
  it('reads a Jira comment cell, and keeps a cell it cannot split as text', () => {
    expect(jiraComment('03/Oct/26 3:00 PM;ada;a; b', NOW)).toEqual({
      author: 'ada',
      body: 'a; b',
      createdAt: '2026-10-03T15:00:00.000Z',
    });
    expect(jiraComment('just words', NOW)).toEqual({
      author: '',
      body: 'just words',
      createdAt: NOW,
    });
  });

  it('match members by email, by name, and by the --people file; the rest stay names', () => {
    const { bundle } = readJira(JIRA, NOW);
    const people = readPeople('id,email\n5b10ac8d,ada@example.test\n');
    expect(people).toEqual([{ name: '5b10ac8d', email: 'ada@example.test' }]);
    const r = matchPeople(bundle, [{ name: 'Ada Lovelace', email: 'ada@example.test' }], people);
    expect(r).toEqual({ named: 5, unmatched: ['bob@example.test', 'Grace'] });
    expect(bundle.items.map((i) => i.assigneeEmails)).toEqual([['ada@example.test'], [], []]);
    expect(bundle.comments.map((c) => [c.author, c.authorEmail])).toEqual([
      ['ada@example.test', 'ada@example.test'],
      ['5b10ac8d', 'ada@example.test'],
      ['Grace', undefined],
    ]);
  });
});

describe('orq import jira|linear', () => {
  it('reads the file and reports a dry run without sending anything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-import-'));
    writeFileSync(join(dir, 'jira.csv'), JIRA);
    const r = await runImport(['import', 'jira', 'jira.csv', '--dry-run'], {
      cwd: dir,
      home: dir,
      hostname: 'laptop',
      exec: () => Promise.reject(new Error('no git here')),
      env: {},
      fetchImpl: () => Promise.reject(new Error('no network in a dry run')),
    });
    expect(r).toEqual({
      code: 0,
      out: 'Dry run: read 3 issues of APP (3 statuses, 1 sprints, 3 labels); 1 issues of other projects left out (choose with --project), 3 comments, 5 people named. Nothing was sent.',
    });
    await expect(
      runImport(['import', 'linear', 'missing.csv', '--dry-run'], {
        cwd: dir,
        home: dir,
        hostname: 'laptop',
        exec: () => Promise.reject(new Error('no git')),
        env: {},
      }),
    ).rejects.toThrow('Cannot read');
  });
});
