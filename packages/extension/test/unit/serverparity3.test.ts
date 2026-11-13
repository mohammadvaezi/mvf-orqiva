// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
//    Why:  presence tells me who else is in this file and on which block, never myself; the fingerprint
//          lens names them; the idea interview hands back the interviewer's question and stops when the
//          summary is written.
import type { PresenceEntry } from '@orqiva/shared';
import { describe, expect, it } from 'vitest';
import type { Api } from '../../../cli/src/loop/api';
import { RawBody } from '../../../cli/src/loop/api';
import {
  addSource,
  addedText,
  interview,
  interviewable,
  lastQuestion,
  noteIdea,
} from '../../src/server/ideas';
import { namesText, onBlock, othersInFile } from '../../src/server/presence';
import { lensesFor } from '../../src/views/codelens';

const person = (over: Partial<PresenceEntry>): PresenceEntry => ({
  userId: 'u',
  name: 'Ada',
  kind: 'user',
  projectId: 'p',
  itemId: 'i7',
  state: 'viewing',
  since: '2026-10-08T12:00:00Z',
  ...over,
});

function fakeApi(answer: unknown): { api: Api; calls: [string, string, unknown][] } {
  const calls: [string, string, unknown][] = [];
  return {
    calls,
    api: {
      call: <T>(method: string, path: string, body?: unknown): Promise<T> => {
        calls.push([method, path, body]);
        return Promise.resolve(answer as T);
      },
    },
  };
}

describe('presence in VS Code', () => {
  const people = [
    person({ userId: 'me', name: 'Me', file: 'src/a.ts' }),
    person({ userId: 'ada', name: 'Ada', file: 'src/a.ts', state: 'editing' }),
    person({ userId: 'bob', name: 'Bob', file: 'src/a.ts', itemId: 'i8' }),
    person({ userId: 'cy', name: 'Cy', file: 'src/b.ts' }),
    person({ userId: 'dee', name: 'Dee' }),
  ];

  it('names the others in this file, never me', () => {
    expect(othersInFile(people, 'me', 'src/a.ts').map((p) => p.name)).toEqual(['Ada', 'Bob']);
    expect(namesText(othersInFile(people, 'me', 'src/a.ts'))).toBe('Ada (editing), Bob');
    expect(othersInFile(people, 'me', null)).toEqual([]);
  });

  it('puts them on the block of their task', () => {
    expect(onBlock(people, 'me', 'src/a.ts', 'i7')).toEqual(['Ada']);
    expect(onBlock(people, 'me', 'src/a.ts', null)).toEqual([]);
    const text = '// [DEMO-7 | S01 | v0.1.0] Reminders\nconst x = 1;\n';
    const cache = { get: () => ({ kind: 'pending' as const }) };
    expect(lensesFor(text, cache, (ref) => (ref === 'DEMO-7' ? ['Ada'] : []))[0]?.title).toBe(
      'DEMO-7 · … · Ada is here',
    );
    expect(lensesFor(text, cache)[0]?.title).toBe('DEMO-7 · …');
  });
});

describe('the idea interview in VS Code', () => {
  it('hands back the latest question until the summary is written', async () => {
    expect(
      lastQuestion([
        { role: 'owner', body: 'SMS' },
        { role: 'agent', body: 'Who?' },
      ]),
    ).toBe('Who?');
    expect(
      lastQuestion([
        { role: 'agent', body: 'Who?' },
        { role: 'owner', body: 'Ops' },
      ]),
    ).toBe(null);
    const asking = fakeApi({
      idea: { id: 'i1', ref: 'DEMO-I1', interviewDone: false, summary: '' },
      messages: [{ role: 'agent', body: 'Who forgets most?' }],
    });
    const src = { api: asking.api, workspaceId: 'w', projectId: 'p' };
    expect((await interview(src, 'i1', 'Older patients')).question).toBe('Who forgets most?');
    expect(asking.calls[0]).toEqual([
      'POST',
      '/api/workspaces/w/ideas/i1/interview',
      { answer: 'Older patients' },
    ]);
    const done = fakeApi({
      idea: { id: 'i1', ref: 'DEMO-I1', interviewDone: true, summary: 'SMS a day before.' },
      messages: [{ role: 'agent', body: 'Summary' }],
    });
    expect((await interview({ ...src, api: done.api }, 'i1')).question).toBeNull();
    await noteIdea({ ...src, api: done.api }, 'SMS reminders', '');
    expect(done.calls.at(-1)).toEqual([
      'POST',
      '/api/workspaces/w/projects/p/ideas',
      { title: 'SMS reminders' },
    ]);
    expect(
      interviewable([
        { id: '1', ref: 'I1', title: '', status: 'new', interviewDone: false, summary: '' },
        { id: '2', ref: 'I2', title: '', status: 'new', interviewDone: true, summary: 'x' },
        { id: '3', ref: 'I3', title: '', status: 'declined', interviewDone: false, summary: '' },
      ]).map((i) => i.ref),
    ).toEqual(['I1']);
  });
});

// [PCODE-272 | S15 | v0.1.0]
describe('sources for an idea from VS Code', () => {
  const added = {
    label: 'S3',
    kind: 'text',
    title: 'src/a.ts:4-9',
    url: '',
    fileName: null,
    textLength: 1234,
    read: null,
    link: null,
  };
  it('sends the selection as text and a quote with who said it', async () => {
    const f = fakeApi(added);
    const src = { api: f.api, workspaceId: 'w', projectId: 'p' };
    const x = await addSource(src, 'i1', { kind: 'text', body: 'code', title: 'src/a.ts:4-9' });
    expect(f.calls[0]).toEqual([
      'POST',
      '/api/workspaces/w/ideas/i1/sources',
      { kind: 'text', body: 'code', title: 'src/a.ts:4-9' },
    ]);
    expect(addedText('DEMO-I1', x)).toBe('S3 added to DEMO-I1: src/a.ts:4-9, 1.234 characters');
    await addSource(src, 'i1', { kind: 'text', body: 'We lose bookings', saidBy: 'Support' });
    expect(f.calls[1]?.[2]).toEqual({ kind: 'quote', body: 'We lose bookings', saidBy: 'Support' });
    await addSource(src, 'i1', { kind: 'link', url: 'https://example.com' });
    expect(f.calls[2]?.[2]).toEqual({ kind: 'link', url: 'https://example.com' });
  });

  it('uploads the open file first, then adds it', async () => {
    const f = fakeApi({ ...added, id: 'f1' });
    const src = { api: f.api, workspaceId: 'w', projectId: 'p' };
    await addSource(src, 'i1', { kind: 'file', name: 'notes.md', data: Buffer.from('# Notes') });
    expect(f.calls[0]?.[1]).toBe('/api/workspaces/w/files?name=notes.md&projectId=p');
    const raw = f.calls[0]?.[2] as RawBody;
    expect(raw).toBeInstanceOf(RawBody);
    expect(raw.type).toBe('text/markdown');
    expect(f.calls[1]).toEqual([
      'POST',
      '/api/workspaces/w/ideas/i1/sources',
      { kind: 'file', fileId: 'f1' },
    ]);
  });
});
