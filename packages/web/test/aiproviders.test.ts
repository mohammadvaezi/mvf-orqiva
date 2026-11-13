// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
//    Why:  the forms ask each provider only for what it needs, a connection's last call reads as one
//          line, and a file's read says whether it is still going on or why it failed.
import { describe, expect, it } from 'vitest';
import { fieldsFor, stateOf } from '../src/aiproviders.js';
import { readText } from '../src/v2/files.js';

describe('AI providers in Settings', () => {
  it('asks each provider only for the fields it needs', () => {
    expect(fieldsFor('openai', 'apiKey')).toEqual(['key']);
    expect(fieldsFor('azure', 'apiKey')).toEqual(['endpoint', 'key']);
    expect(fieldsFor('bedrock', 'apiKey')).toEqual(['region', 'auth', 'key']);
    expect(fieldsFor('bedrock', 'accessKeys')).toEqual(['region', 'auth', 'accessKeys']);
    expect(fieldsFor('demo', 'apiKey')).toEqual([]);
  });

  it('says how a connection’s last call went', () => {
    expect(
      stateOf({
        provider: 'openai',
        lastError: 'The model provider answered 401: bad key',
        lastUsedAt: null,
      }),
    ).toEqual({
      tone: 'bad',
      text: 'The model provider answered 401: bad key',
    });
    expect(stateOf({ provider: 'openai', lastError: '', lastUsedAt: null }).text).toBe(
      'not used yet',
    );
    expect(stateOf({ provider: 'demo', lastError: '', lastUsedAt: null }).text).toBe(
      'no key needed',
    );
    expect(
      stateOf({ provider: 'gemini', lastError: '', lastUsedAt: '2026-10-11T08:00:00Z' }).tone,
    ).toBe('ok');
  });

  it('tells people how a file’s read goes', () => {
    expect(readText(null)).toEqual({ text: '', pending: false, failed: false });
    expect(readText({ status: 'queued', error: '' })).toMatchObject({ pending: true });
    expect(readText({ status: 'skipped', error: 'xAI Grok does not read PDF files' })).toEqual({
      text: 'not read: xAI Grok does not read PDF files',
      pending: false,
      failed: true,
    });
    expect(readText({ status: 'done', error: '' }).text).toBe('');
  });
});
