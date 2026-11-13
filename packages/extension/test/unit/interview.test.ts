// ── [PCODE-461 | S15 | v0.1.0] Planning in VS Code shows what Claude writes right now: file and size live, failed tools as steps ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
//    Why:  the planning conversation end to end against a fake Claude: the first round asks, the answers
//          (with a file) go into conversation.md, the next round is clear, the plan is written from it;
//          plan it again and a changed description bring the questions back; Claude's reply and its
//          stream are read strictly; the Home tab's steps follow the files; the webview's new messages
//          are gated.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  headlessArgs,
  parseStreamLine,
  StreamReader,
  addUsage,
  type ClaudeRunOptions,
} from '../../src/plan/claudeRun';
import {
  addAttachment,
  conversationMarkdown,
  hashText,
  interviewState,
  newInterview,
  parseReply,
  planIsCurrent,
  readInterview,
  recordAnswers,
  recordReply,
  stamp,
} from '../../src/plan/interview';
import { PlanningSession } from '../../src/plan/session';
import { wizardModel, type WizardInputs } from '../../src/webviews/home/wizard';
import { isWebviewMessage } from '../../src/webviews/protocol';

let root = '';
const put = (rel: string, text: string): void => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const read = (rel: string): string => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const exists = (rel: string): boolean => fs.existsSync(path.join(root, ...rel.split('/')));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-talk-'));
  put('.orqiva/project.json', '{}');
  put('.orqiva/description/description.md', '# Project description\n\nA PIM for a shop.\n');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const PLAN = JSON.stringify({ version: '0.1.0', sprints: [] });

/** A Claude that answers each run with the next reply; a plan run writes plan.json. */
function fakeClaude(replies: string[]) {
  const runs: ClaudeRunOptions[] = [];
  const run = (o: ClaudeRunOptions) => {
    runs.push(o);
    o.onStep?.('Read .orqiva/description/description.md');
    const plan = o.args.includes('acceptEdits');
    if (plan) put('.orqiva/plan.json', PLAN);
    return {
      done: Promise.resolve({
        text: plan ? 'Plan written.' : (replies.shift() ?? ''),
        isError: false,
        stderr: '',
        code: 0,
      }),
      stop: () => undefined,
    };
  };
  return { runs, run };
}

const session = (run: ReturnType<typeof fakeClaude>['run']): PlanningSession =>
  new PlanningSession({
    log: { info: () => undefined, warn: () => undefined },
    folder: () => ({ root, name: 'Shop', identifier: 'SHOP', orqiva: false }),
    claudeCommand: () => 'claude',
    run,
    now: () => new Date('2026-10-23T10:00:00Z'),
  });

const ASK = JSON.stringify({
  status: 'questions',
  understanding: 'A PIM for one shop.',
  questions: [
    { question: 'Which shop system?', why: 'Integration', options: ['Shopware', 'Shopify'] },
    { question: 'How many products?' },
  ],
});
const CLEAR = '```json\n{"status": "clear", "understanding": "Shopware 6, 5000 products."}\n```';

describe('the planning conversation', () => {
  it('asks, takes the answers with a file, is clear, and writes the plan from it', async () => {
    const c = fakeClaude([ASK, CLEAR]);
    const s = session(c.run);
    await s.ask();
    expect(s.state).toMatchObject({ phase: 'idle', error: null });
    expect(s.state.steps).toEqual(['Read .orqiva/description/description.md']);
    let iv = readInterview(root);
    const desc = hashText(read('.orqiva/description/description.md'));
    expect(interviewState(iv, desc)).toBe('asking');
    // the first round is read-only, with the meeting prompt
    expect(c.runs[0]?.args).toContain('Read,Glob,Grep');
    expect(c.runs[0]?.args).not.toContain('acceptEdits');
    expect(read('.orqiva/state/interview_prompt.txt')).toContain('**Shop**');

    const src = path.join(root, 'Spec v2 (final).PDF');
    fs.writeFileSync(src, 'pdf');
    const name = addAttachment(root, src);
    expect(name).toBe('Spec-v2-final.pdf');
    expect(addAttachment(root, src)).toBe('Spec-v2-final-2.pdf');
    await s.answer({
      r1q1: { text: 'Shopware 6', files: [name] },
      r1q2: { text: '', files: [] },
      _more: { text: 'Go live in March', files: [] },
    });
    iv = readInterview(root);
    expect(interviewState(iv, desc)).toBe('clear');
    const md = read('.orqiva/description/conversation.md');
    expect(md).toContain('**1. Which shop system?**');
    expect(md).toContain('Answer: Shopware 6');
    expect(md).toContain('`attachments/Spec-v2-final.pdf`');
    expect(md).toContain('(left open - Claude decides and says so)');
    expect(md).toContain('Go live in March');
    expect(md).toContain('Shopware 6, 5000 products.');
    expect(planIsCurrent(iv)).toBe(false);

    await s.writePlan();
    expect(s.state.error).toBeNull();
    expect(c.runs[2]?.args).toContain('acceptEdits');
    expect(c.runs[2]?.input).toContain('conversation.md');
    expect(read('.orqiva/state/plan_prompt.txt')).toContain('the planning conversation');
    expect(planIsCurrent(readInterview(root))).toBe(true);
  });

  it('plans again: the old plan is set aside, the wish noted, and Claude reads again', async () => {
    const c = fakeClaude([CLEAR, ASK]);
    const s = session(c.run);
    await s.ask();
    await s.writePlan();
    await s.replan('Fewer sprints');
    expect(exists('.orqiva/plan.json')).toBe(false);
    expect(read('.orqiva/state/plan.previous.json')).toBe(PLAN);
    expect(read('.orqiva/description/conversation.md')).toContain(
      'Plan it again. What should change: Fewer sprints',
    );
    // Claude asked again; the next plan run is told about the previous plan
    expect(
      interviewState(readInterview(root), hashText(read('.orqiva/description/description.md'))),
    ).toBe('asking');
    await s.skipQuestions();
    expect(c.runs[c.runs.length - 1]?.input).toContain('plan.previous.json');
    expect(exists('.orqiva/plan.json')).toBe(true);
  });

  it('reads a changed description again, also for a plan made before the conversation existed', async () => {
    put('.orqiva/plan.json', PLAN);
    const c = fakeClaude([ASK]);
    const s = session(c.run);
    const before = read('.orqiva/description/description.md');
    // saved unchanged: nothing happens
    await s.descriptionChanged(before);
    expect(c.runs).toHaveLength(0);
    put('.orqiva/description/description.md', '# Project description\n\nA PIM for two shops.\n');
    await s.descriptionChanged(before);
    expect(c.runs).toHaveLength(1);
    const iv = readInterview(root);
    expect(iv?.entries[0]).toMatchObject({
      kind: 'note',
      text: 'The user changed the description.',
    });
    expect(planIsCurrent(iv)).toBe(false);
  });

  it('starts the first round when a new description is saved, and says why a run failed', async () => {
    const c = fakeClaude(['I could not decide.']);
    const s = session(c.run);
    await s.descriptionChanged(null);
    expect(s.state.error).toBe('Claude did not answer with its questions: I could not decide.');
    expect(interviewState(readInterview(root), 'x')).toBe('due');
  });
});

describe("Claude's reply", () => {
  it('is the JSON object, fenced or not; a round without questions is clear', () => {
    expect(parseReply(CLEAR)).toEqual({
      status: 'clear',
      understanding: 'Shopware 6, 5000 products.',
    });
    expect(parseReply('{"status":"questions","understanding":"u","questions":[]}')).toEqual({
      status: 'clear',
      understanding: 'u',
    });
    expect(parseReply('no json')).toBeNull();
    expect(parseReply('{"status":"maybe"}')).toBeNull();
    const many = JSON.stringify({
      status: 'questions',
      questions: Array.from({ length: 12 }, (_, i) => ({
        question: 'Q' + String(i),
        options: [1, 'A'],
      })),
    });
    const r = parseReply(many);
    expect(r?.status === 'questions' ? r.questions : []).toHaveLength(7);
    expect(r?.status === 'questions' ? r.questions[0] : null).toEqual({
      question: 'Q0',
      options: ['A'],
    });
  });

  it('numbers the questions per round and keeps answers per question', () => {
    let iv = recordReply(
      newInterview('h'),
      parseReply(ASK) ?? { status: 'clear', understanding: '' },
      'h',
    );
    expect(iv.entries[0]).toMatchObject({ kind: 'questions' });
    iv = recordAnswers(iv, { r1q1: { text: ' x ', files: [] } });
    const e = iv.entries[0];
    expect(e?.kind === 'questions' ? e.answers : null).toEqual({
      r1q1: { text: 'x', files: [] },
      r1q2: { text: '', files: [] },
    });
    iv = recordReply(iv, parseReply(ASK) ?? { status: 'clear', understanding: '' }, 'h');
    const second = iv.entries[1];
    expect(second?.kind === 'questions' ? second.questions.map((q) => q.id) : []).toEqual([
      'r2q1',
      'r2q2',
    ]);
    expect(stamp(iv)).toBe('h#2');
    expect(conversationMarkdown(iv)).toContain("## Round 2: Claude's questions");
  });

  it("comes from Claude Code's stream: tools become steps, the result ends it", () => {
    expect(
      parseStreamLine(
        root,
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.md' } }] },
        }),
      )?.step,
    ).toMatch(/a\.md$/);
    expect(
      parseStreamLine(root, JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' })),
    ).toEqual({
      result: { text: 'ok', isError: false },
    });
    expect(
      parseStreamLine(root, JSON.stringify({ type: 'result', subtype: 'error_max_turns' }))?.result
        ?.isError,
    ).toBe(true);
    expect(parseStreamLine(root, 'not json')).toBeNull();
    expect(headlessArgs('interview', 'p.txt')).not.toContain('Write');
    expect(headlessArgs('plan', 'p.txt')).toContain('acceptEdits');
  });
});

// ── [PCODE-461 | S15 | v0.1.0] the step in progress: the file Claude writes and how far, a failed tool as a step ──
describe('what Claude does right now', () => {
  const ev = (event: unknown): string => JSON.stringify({ type: 'stream_event', event });
  it('names the file being written as soon as its path arrives, and counts what is written', () => {
    const r = new StreamReader('C:\\Dev\\Shop');
    expect(
      r.read(
        ev({ type: 'content_block_start', content_block: { type: 'tool_use', name: 'Write' } }),
      ),
    ).toEqual({ live: 'Writing…' });
    const part = (j: string) =>
      r.read(
        ev({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: j } }),
      );
    expect(part('{"file_path": "C:\\Dev\\Shop\\.orqiva\\plan.json", "content": "')?.live).toBe(
      'Writing .orqiva/plan.json (59 bytes so far)',
    );
    expect(part('x'.repeat(100))).toBeNull(); // not a new line for every piece
    expect(part('x'.repeat(5000))?.live).toBe('Writing .orqiva/plan.json (5 KB so far)');
    expect(
      r.read(ev({ type: 'content_block_start', content_block: { type: 'thinking' } }))?.live,
    ).toBe('Thinking about the next step');
  });
  it('turns a failed tool into a step of its own', () => {
    const failed = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            is_error: true,
            content: 'Editing a code file without an active task is refused',
          },
        ],
      },
    });
    expect(new StreamReader('/x').read(failed)).toEqual({
      step: 'Failed: Editing a code file without an active task is refused',
    });
    const ok = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'File created' }] },
    });
    expect(new StreamReader('/x').read(ok)).toBeNull();
    expect(headlessArgs('plan', 'p.txt')).toContain('--include-partial-messages');
  });
});

describe('the Home tab with the conversation', () => {
  const w = (over: Partial<WizardInputs> = {}): WizardInputs => ({
    description: 'written',
    descriptionText: 'A PIM',
    plan: 'missing',
    planJson: null,
    errors: [],
    checkError: null,
    published: false,
    conversation: { state: 'none', entries: [], planCurrent: true },
    ...over,
  });
  const talk = (state: 'none' | 'asking' | 'due' | 'clear', planCurrent = true) => ({
    state,
    entries: [],
    planCurrent,
  });

  it('puts the questions between the idea and the plan', () => {
    expect(wizardModel(w())?.steps.map((s) => s.title)).toEqual([
      'Describe your idea',
      "Answer Claude's questions",
      'Claude writes the plan',
      'Check and publish',
    ]);
    expect(wizardModel(w())?.step).toBe('questions');
    expect(wizardModel(w({ conversation: talk('asking') }))?.step).toBe('questions');
    expect(wizardModel(w({ conversation: talk('clear') }))?.step).toBe('draft');
    expect(wizardModel(w({ conversation: talk('clear'), plan: 'valid' }))?.step).toBe('publish');
    // a plan from before the conversation stands; one from an older conversation is written again
    expect(wizardModel(w({ plan: 'valid' }))?.step).toBe('publish');
    expect(wizardModel(w({ conversation: talk('clear', false), plan: 'valid' }))?.step).toBe(
      'draft',
    );
    expect(wizardModel(w({ conversation: talk('due', false), plan: 'valid' }))?.step).toBe(
      'questions',
    );
    // a run decides the screen while it lasts
    const running = { phase: 'writing' as const, steps: [], startedAt: null, error: null };
    expect(wizardModel(w({ conversation: talk('clear'), running }))?.step).toBe('draft');
    expect(wizardModel(w({ conversation: talk('clear'), plan: 'errors' }))?.steps[2]?.state).toBe(
      'current',
    );
  });

  it('accepts only sane answers and plain attachment names from the webview', () => {
    const ok = { type: 'home/answers', answers: { r1q1: { text: 'x', files: ['a.pdf'] } } };
    expect(isWebviewMessage(ok)).toBe(true);
    expect(
      isWebviewMessage({
        type: 'home/answers',
        answers: { r1q1: { text: 'x', files: ['../secret'] } },
      }),
    ).toBe(false);
    expect(
      isWebviewMessage({
        type: 'home/answers',
        answers: { evil: { text: 'x', files: [] } },
      }),
    ).toBe(false);
    expect(isWebviewMessage({ type: 'home/plan', op: 'write' })).toBe(true);
    expect(isWebviewMessage({ type: 'home/plan', op: 'rm' })).toBe(false);
    expect(isWebviewMessage({ type: 'home/attach', question: 'r2q3' })).toBe(true);
    expect(isWebviewMessage({ type: 'home/replan', wish: '' })).toBe(true);
  });
});

// ── [PCODE-466 | S15 | v0.1.0] the planning conversation's tokens and price, from Claude Code's result line ──
describe('the usage of a headless run', () => {
  it('sums the models of the result line and keeps Claude Code its own price', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '{}',
      total_cost_usd: 0.51,
      modelUsage: {
        'claude-haiku-5-5': { inputTokens: 100, outputTokens: 10, costUSD: 0.01 },
        'claude-opus-5-5': {
          inputTokens: 12,
          outputTokens: 14046,
          cacheReadInputTokens: 214046,
          cacheCreationInputTokens: 31650,
          costUSD: 0.5,
        },
      },
    });
    const u = new StreamReader('/x').read(line)?.result?.usage;
    expect(u).toEqual({
      model: 'claude-opus-5-5',
      tokensIn: 112,
      tokensOut: 14056,
      cacheRead: 214046,
      cacheWrite: 31650,
      costUsd: 0.51,
    });
    expect(addUsage(u, u)?.costUsd).toBeCloseTo(1.02);
    expect(addUsage(undefined, u)).toBe(u);
  });
});
