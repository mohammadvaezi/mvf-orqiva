// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
// ── [PCODE-142 | S15 | v0.1.0] Show security findings in the web app with Security agent triage ──
// ── [PCODE-145 | S15 | v0.1.0] Add the review stage and the Reviewer agent ──
// ── [PCODE-137 | S15 | v0.1.0] Show coverage to requirements, the Tester agent and the G3 tests criterion ──
// ── [PCODE-128 | S15 | v0.1.0] Add capacity, velocity and the sprint planning agent ──
// ── [PCODE-124 | S15 | v0.1.0] Generate proposals with an estimate from the interview, with versions ──
// ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
//    Why:  one interface for every model: a turn takes the system prompt, the conversation and the tools,
//          and answers with text and tool calls plus the tokens used. The Anthropic Messages API is called
//          over HTTPS with fetch (no SDK). The demo model needs no key and walks a fixed, harmless path,
//          so the whole runtime can be tried; the scripted model answers what a test tells it to.
// ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
import { storyParts } from '@orqiva/shared'; // [PCODE-274 | S15 | v0.1.0]
import type { Usage } from '@orqiva/shared'; // [PCODE-327 | S15 | v0.1.0]

export type Block =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
      // [PCODE-240 | S15 | v0.1.0] what a provider wants back with the call on the next turn (Gemini's thought signature)
      signature?: string;
    }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  // [PCODE-240 | S15 | v0.1.0] a picture or a PDF for the model to read, base64
  | { type: 'image'; mime: string; data: string }
  | { type: 'document'; mime: 'application/pdf'; name: string; data: string };

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelRequest {
  model: string;
  system: string;
  messages: ModelMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  // [PCODE-180 | S15 | v0.1.0] the agent's temperature, when it sets one
  temperature?: number;
}

export interface ModelReply {
  content: Block[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other';
  // [PCODE-327 | S15 | v0.1.0] with the cache read and written and the reasoning share of the output
  usage: Usage;
  // [PCODE-240 | S15 | v0.1.0] who answered, when a connection's fallback took over
  by?: Answerer;
  /** the connection that failed before the fallback answered */
  failed?: { by: Answerer; error: string };
}

/** [PCODE-240 | S15 | v0.1.0] a provider and model behind an answer, with the connection or project key */
export interface Answerer {
  provider: string;
  model: string;
  connectionId?: string;
  projectId?: string;
}

export interface ModelProvider {
  name: string;
  complete(req: ModelRequest): Promise<ModelReply>;
  // [PCODE-240 | S15 | v0.1.0] the model this connection uses instead of the agent's own, and where the key comes from
  model?: string;
  connectionId?: string;
  projectId?: string;
}

export class ProviderError extends Error {
  // [PCODE-240 | S15 | v0.1.0] true when another provider may well succeed: no network, rate limits, outages
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

// [PCODE-240 | S15 | v0.1.0] one HTTPS call to a provider: JSON in, JSON out, the provider's own words on failure
export async function callProvider(
  fetchImpl: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; body: string | FormData; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 180_000),
    });
  } catch (e) {
    throw new ProviderError(
      'The model provider cannot be reached: ' + (e instanceof Error ? e.message : String(e)),
      true,
    );
  }
  const text = await res.text();
  let body: unknown = {};
  try {
    body = JSON.parse(text);
  } catch {
    // reported below
  }
  if (!res.ok) {
    const b = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined;
    const err = b?.['error'];
    const msg =
      (typeof err === 'object' && err && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : typeof err === 'string'
          ? err
          : typeof b?.['message'] === 'string'
            ? b['message']
            : '') || text.slice(0, 200);
    throw new ProviderError(
      'The model provider answered ' + String(res.status) + ': ' + msg,
      res.status === 408 || res.status === 429 || res.status >= 500,
    );
  }
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** [PCODE-240 | S15 | v0.1.0] the text blocks of an answer, joined */
export const textOfReply = (r: ModelReply): string =>
  r.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('\n')
    .trim();

// [PCODE-123 | S15 | v0.1.0] marks in a system prompt that tell the demo model which part it plays
export const MODE_INTERVIEW = '[orqiva:interview]';
export const MODE_PROPOSAL = '[orqiva:proposal]'; // [PCODE-124 | S15 | v0.1.0]
export const MODE_PLANNING = '[orqiva:planning]'; // [PCODE-128 | S15 | v0.1.0]
export const MODE_TESTCASES = '[orqiva:testcases]'; // [PCODE-137 | S15 | v0.1.0]
export const MODE_TRIAGE = '[orqiva:triage]'; // [PCODE-142 | S15 | v0.1.0]
export const MODE_REVIEW = '[orqiva:review]'; // [PCODE-145 | S15 | v0.1.0]
export const MODE_EXTRACT = '[orqiva:extract]'; // [PCODE-168 | S15 | v0.1.0]
export const MODE_LINES = '[orqiva:lines]'; // [PCODE-303 | S15 | v0.1.0] comments on a pull request's lines
export const MODE_FAILURE = '[orqiva:failure]'; // [PCODE-317 | S15 | v0.1.0] a failed test's triage
export const MODE_FIX = '[orqiva:fix]'; // [PCODE-324 | S15 | v0.1.0] a finding's corrected file
export const MODE_JUDGE = '[orqiva:judge]'; // [PCODE-330 | S15 | v0.1.0] a run's score against the rubric
export const MODE_POSTMORTEM = '[orqiva:postmortem]'; // [PCODE-342 | S15 | v0.1.0] an incident's postmortem

export function anthropicProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  base = 'https://api.anthropic.com',
): ModelProvider {
  return {
    name: 'anthropic',
    async complete(req) {
      const body = await callProvider(fetchImpl, base + '/v1/messages', {
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          system: req.system,
          // [PCODE-240 | S15 | v0.1.0] our blocks in the Messages API's shape
          messages: req.messages.map((m) => ({
            role: m.role,
            content: m.content.map(anthropicBlock),
          })),
          // [PCODE-123 | S15 | v0.1.0] a one-answer call has no tools; the API wants the field left out then
          ...(req.tools.length ? { tools: req.tools } : {}),
        }),
      });
      const usage = (body['usage'] ?? {}) as {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      const stop = typeof body['stop_reason'] === 'string' ? body['stop_reason'] : '';
      return {
        content: ((body['content'] ?? []) as Block[]).flatMap((b): Block[] =>
          b.type === 'tool_use'
            ? [{ type: 'tool_use', id: b.id, name: b.name, input: b.input }]
            : b.type === 'text'
              ? [{ type: 'text', text: b.text }]
              : [],
        ),
        stopReason:
          stop === 'end_turn' || stop === 'tool_use' || stop === 'max_tokens' ? stop : 'other',
        // [PCODE-327 | S15 | v0.1.0] input_tokens leaves out what came from or went into the cache
        usage: {
          input: usage.input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
          cacheWrite: usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

// [PCODE-240 | S15 | v0.1.0]
function anthropicBlock(b: Block): Record<string, unknown> {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: b.content,
        ...(b.is_error ? { is_error: true } : {}),
      };
    case 'image':
      return { type: 'image', source: { type: 'base64', media_type: b.mime, data: b.data } };
    case 'document':
      return {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b.data },
      };
  }
}

/** Answers from a list, one per turn; a test's way to drive a run. */
export function scriptedProvider(
  replies: ModelReply[],
): ModelProvider & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    name: 'scripted',
    requests,
    complete(req) {
      requests.push(structuredClone(req));
      const next = replies.shift();
      if (!next)
        return Promise.resolve({
          content: [{ type: 'text', text: 'Done.' }],
          stopReason: 'end_turn',
          usage: { input: 1, output: 1 },
        });
      return Promise.resolve(next);
    },
  };
}

/**
 * The demo model: no key, no network. It reads the task list, comments on the task it was started on
 * with a short summary, proposes to move it to In Progress (which waits for a person), and ends.
 */
export function demoProvider(): ModelProvider {
  return {
    name: 'demo',
    complete(req) {
      // [PCODE-123 | S15 | v0.1.0] the owner interview: fixed questions, then a summary
      if (req.system.includes(MODE_INTERVIEW)) return Promise.resolve(demoInterview(req));
      // [PCODE-124 | S15 | v0.1.0] the proposal: a small, fixed plan around the idea's title
      if (req.system.includes(MODE_PROPOSAL)) return Promise.resolve(demoProposal(req));
      // [PCODE-128 | S15 | v0.1.0] sprint planning: the backlog in order, as far as the room goes
      if (req.system.includes(MODE_PLANNING)) return Promise.resolve(demoPlanning(req));
      // [PCODE-137 | S15 | v0.1.0] test cases: one per criterion, with plain steps
      if (req.system.includes(MODE_TESTCASES)) return Promise.resolve(demoTestCases(req));
      // [PCODE-142 | S15 | v0.1.0] triage: a plain note from the finding's own fields
      if (req.system.includes(MODE_TRIAGE)) return Promise.resolve(demoTriage(req));
      // [PCODE-145 | S15 | v0.1.0] review: approve when criteria and tests say so
      if (req.system.includes(MODE_REVIEW)) return Promise.resolve(demoReview(req));
      // [PCODE-168 | S15 | v0.1.0] extraction: sentences sorted into requirements, questions, assumptions, risks
      if (req.system.includes(MODE_EXTRACT)) return Promise.resolve(demoExtract(req));
      // [PCODE-303 | S15 | v0.1.0] line comments: added lines that leave debugging or a TODO behind
      if (req.system.includes(MODE_LINES)) return Promise.resolve(demoLines(req));
      // [PCODE-317 | S15 | v0.1.0] a failed test: flaky by its history, the environment by its message, …
      if (req.system.includes(MODE_FAILURE)) return Promise.resolve(demoFailure(req));
      // [PCODE-324 | S15 | v0.1.0] a fix: the file back, with a marked note above the finding's line
      if (req.system.includes(MODE_FIX)) return Promise.resolve(demoFix(req));
      // [PCODE-330 | S15 | v0.1.0] the judge: a failed or empty run scores low, an answer scores 4
      if (req.system.includes(MODE_JUDGE)) return Promise.resolve(demoJudge(req));
      // [PCODE-342 | S15 | v0.1.0] a postmortem: the brief's facts in the five sections, deploys named as the likely cause
      if (req.system.includes(MODE_POSTMORTEM)) return Promise.resolve(demoPostmortem(req));
      const turn = req.messages.filter((m) => m.role === 'assistant').length;
      const instruction = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
      const ref = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/.exec(instruction)?.[1];
      const usage = { input: 400 + turn * 150, output: 120 };
      const lastResults =
        req.messages[req.messages.length - 1]?.content.filter((b) => b.type === 'tool_result') ??
        [];
      const said = (s: string): ModelReply => ({
        content: [{ type: 'text', text: s }],
        stopReason: 'end_turn',
        usage,
      });
      const call = (text: string, name: string, input: Record<string, unknown>): ModelReply => ({
        content: [
          { type: 'text', text },
          { type: 'tool_use', id: 'demo-' + String(turn), name, input },
        ],
        stopReason: 'tool_use',
        usage,
      });
      if (turn === 0)
        return Promise.resolve(
          call('I will look at the open tasks of this project first.', 'list_items', {}),
        );
      if (turn === 1 && ref)
        return Promise.resolve(
          call('I have the list. Now I read the task I was asked about.', 'get_item', { ref }),
        );
      if (turn === 2 && ref)
        return Promise.resolve(
          call('I note what I found on the task.', 'add_comment', {
            ref,
            body:
              'Demo agent: I read this task and the open work around it. Instruction: "' +
              instruction.slice(0, 200) +
              '"',
          }),
        );
      if (turn === 3 && ref)
        return Promise.resolve(
          call('I propose to start work on it.', 'move_item', { ref, state: 'In Progress' }),
        );
      const declined = lastResults.some((b) => b.is_error);
      return Promise.resolve(
        said(
          declined
            ? 'Understood, I leave the task where it is. Done.'
            : 'Done. The task is commented and moved.',
        ),
      );
    },
  };
}

// [PCODE-123 | S15 | v0.1.0]
const DEMO_QUESTIONS = [
  'What problem does this solve, and for whom?',
  'What should be true when it is done? How will you know it worked?',
  'What is in scope for the first version, and what is explicitly not?',
  'Are there constraints: systems it must work with, rules, budget or a deadline?',
];

// [PCODE-273 | S15 | v0.1.0] by coverage: the weakest area named in the steering line, until it says to finish
const DEMO_AREA_QUESTIONS: Record<string, string> = {
  problem: 'What problem does this solve, and what happens today without it?',
  users: 'Who runs into this most often, and how many people are they?',
  scope: 'What must the first version do, at the least?',
  non_goals: 'What should it explicitly not do in the first version?',
  non_functional: 'How fast, how available, how accessible must it be?',
  data: 'Which data does it read or keep, and for how long?',
  integrations: 'Which systems must it work with?',
  security: 'Who may see or change what, and are there rules such as GDPR to meet?',
};

function demoInterview(req: ModelRequest): ModelReply {
  const asked = req.messages.filter((m) => m.role === 'assistant').length;
  const lastText = req.messages.at(-1)?.content.find((b) => b.type === 'text')?.text ?? '';
  const steer = /\[ORQIVA\] COVERAGE:[^\n]*/.exec(lastText)?.[0];
  const usage = { input: 300 + asked * 120, output: 60 };
  const say = (text: string): ModelReply => ({
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage,
  });
  const weakest = steer ? /Weakest: ([a-z_]+)/.exec(steer)?.[1] : undefined;
  if (steer && !steer.includes('FINISH NOW') && weakest)
    return say(
      '[' + weakest + '] ' + (DEMO_AREA_QUESTIONS[weakest] ?? 'What else should we know?'),
    );
  const q = steer ? undefined : DEMO_QUESTIONS[asked];
  if (q) return say(q);
  const answers = req.messages
    .slice(1)
    .filter((m) => m.role === 'user')
    .map((m) =>
      (m.content.find((b) => b.type === 'text')?.text ?? '')
        .replace(/\n*\[ORQIVA\] COVERAGE:[^\n]*/, '')
        .trim(),
    )
    .filter(Boolean);
  return say(
    'READY: ' +
      answers.map((a) => a.replace(/\s+/g, ' ').slice(0, 160)).join(' / ') +
      ' (demo summary of the owner’s answers)',
  );
}

// [PCODE-124 | S15 | v0.1.0]
function demoProposal(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  const title = (/^The idea: (.*)$/m.exec(text)?.[1] ?? 'the idea').trim();
  const summary = /^Interview summary: (.*)$/m.exec(text)?.[1]?.trim();
  // [PCODE-275 | S15 | v0.1.0] the kind's sections, and the first requirements cited in scope
  const after = (head: string): string[] => {
    const at = text.indexOf('\n' + head);
    if (at < 0) return [];
    const out: string[] = [];
    for (const l of text.slice(at + head.length + 2).split('\n')) {
      if (!l.trim()) break;
      out.push(l);
    }
    return out;
  };
  const sections = after('SECTIONS for')
    .slice(1)
    .map((l) => /^- ([a-z_]+): (.+?) \((.*)\)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ key: m[1] ?? '', title: m[2] ?? '', body: 'Demo: ' + (m[3] ?? '') }));
  const reqs = after('REQUIREMENTS:')
    .map((l) => /^(R-\d+): (.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .slice(0, 3);
  const proposal = {
    summary: 'Demo proposal for ' + title + '.',
    problem: summary ?? 'The owner described the need in the interview.',
    goals: ['Deliver a first version of ' + title, 'Measure that it is used'],
    scopeIn: [
      'The smallest version that solves the problem',
      ...reqs.map((m) => (m[2] ?? '').replace(/[.!]$/, '') + ' [' + (m[1] ?? '') + ']'),
    ],
    ...(sections.length ? { sections } : {}),
    scopeOut: ['Everything the interview did not ask for'],
    risks: ['The demo model does not read the answers; a real model will.'],
    tasks: [
      { title: 'Write acceptance criteria for ' + title, estimate: 1, description: '' },
      { title: 'Design the change', estimate: 2, description: '' },
      { title: 'Build ' + title, estimate: 5, description: '' },
      { title: 'Test ' + title, estimate: 3, description: '' },
      { title: 'Document and release ' + title, estimate: 1, description: '' },
    ],
  };
  return {
    content: [{ type: 'text', text: '```json\n' + JSON.stringify(proposal, null, 2) + '\n```' }],
    stopReason: 'end_turn',
    usage: { input: 900, output: 450 },
  };
}

// [PCODE-128 | S15 | v0.1.0]
function demoPlanning(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  let room = Number(/^Room: (\d+)/m.exec(text)?.[1] ?? 0);
  const items: string[] = [];
  for (const m of text.matchAll(/^([A-Z][A-Z0-9]*-\d+) \| (\d+) \|/gm)) {
    const points = Number(m[2]);
    if (points <= room) {
      items.push(m[1] ?? '');
      room -= points;
    }
  }
  const answer = {
    items,
    reasons:
      'Demo planner: the backlog in its order, as far as the room goes; tasks without an estimate are left out.',
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(answer) }],
    stopReason: 'end_turn',
    usage: { input: 600, output: 120 },
  };
}

// [PCODE-168 | S15 | v0.1.0] each sentence of each source: a requirement when it says must, should or
// needs; a question when it asks; an assumption when it assumes; a risk when it names one
function demoExtract(req: ModelRequest): ModelReply {
  // [PCODE-271 | S15 | v0.1.0] what is already known is not new input
  const text =
    (req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '').split(
      /\n\nEXISTING requirements:/,
    )[0] ?? '';
  const out = {
    requirements: [] as Record<string, unknown>[],
    personas: [] as Record<string, string>[], // [PCODE-274 | S15 | v0.1.0]
    questions: [] as Record<string, string>[],
    assumptions: [] as Record<string, string>[],
    risks: [] as Record<string, unknown>[],
    glossary: [] as Record<string, string>[],
  };
  for (const block of text.split(/^### /m).slice(1)) {
    const source = /^(S\d+|IDEA|INTERVIEW)\b/.exec(block)?.[1] ?? 'IDEA';
    // the interview: only the answers, without their labels
    const lines = block.split('\n').slice(1);
    const body = (
      source === 'INTERVIEW'
        ? lines.filter((l) => l.startsWith('A: ')).map((l) => l.slice(3))
        : lines
    ).join(' ');
    for (const raw of body.split(/(?<=[.!?])\s+/)) {
      const s = raw.trim();
      if (s.length < 8) continue;
      // [PCODE-274 | S15 | v0.1.0] "As a dispatcher, I want …": a story, its persona and one scenario
      const story = storyParts(s);
      if (story) {
        const name = story.role.charAt(0).toUpperCase() + story.role.slice(1);
        if (!out.personas.some((p) => p['name'] === name))
          out.personas.push({
            name,
            role: story.role,
            goals: story.want,
            pains: '',
            quote: '',
            source,
          });
        out.requirements.push({
          text: s,
          kind: 'story',
          area: 'users',
          priority: 'should',
          source,
          passage: s,
          persona: name,
          scenarios: [
            {
              given: 'a ' + story.role,
              when: 'they ' + story.want.replace(/^to\s+/i, ''),
              then: story.benefit || 'it works as they expect',
            },
          ],
        });
      } else if (s.endsWith('?')) out.questions.push({ text: s, area: 'scope' });
      else if (/\bassum/i.test(s))
        out.assumptions.push({ text: s, validateHow: 'Ask the people who said it' });
      else if (/\brisk\b/i.test(s))
        out.risks.push({ text: s, likelihood: 3, impact: 3, mitigation: '' });
      else if (/\b(must|should|needs? to|has to|have to)\b/i.test(s))
        out.requirements.push({
          text: s,
          kind: 'functional',
          area: /secur|privacy|gdpr/i.test(s) ? 'security' : 'scope',
          priority: /\bmust\b/i.test(s) ? 'must' : 'should',
          source,
          passage: s,
        });
    }
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(out) }],
    stopReason: 'end_turn',
    usage: { input: 800, output: 200 },
  };
}

// [PCODE-137 | S15 | v0.1.0]
function demoTestCases(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  const criteria = [...text.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({
    n: Number(m[1]),
    text: m[2] ?? '',
  }));
  const cases = criteria.map((c) => ({
    criterion: c.n,
    title: 'Check: ' + c.text.slice(0, 120),
    steps: [
      '1. Prepare the data the criterion talks about.',
      '2. Do what a user does to reach it.',
      '3. Look at the result.',
    ].join('\n'),
    expected: c.text,
  }));
  return {
    content: [{ type: 'text', text: JSON.stringify({ cases }) }],
    stopReason: 'end_turn',
    usage: { input: 500, output: 80 * Math.max(1, cases.length) },
  };
}

// [PCODE-142 | S15 | v0.1.0]
function demoTriage(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  const field = (name: string): string =>
    new RegExp('^' + name + ': (.*)$', 'm').exec(text)?.[1] ?? '';
  const severity = field('Severity') || 'medium';
  const rule = field('Rule') || 'the rule';
  const where = field('Where') || 'the code';
  const note = [
    'Severity: I agree with ' + severity + ' until someone shows the input cannot reach it.',
    'Exploitability: ' + rule + ' at ' + where + ' needs a review of who controls the value.',
    'Fix: follow the rule help, add a test that proves the fix, then let the next full scan close the finding.',
    '(Demo agent: a real model reads the code around the finding.)',
  ].join(' ');
  return {
    content: [{ type: 'text', text: note }],
    stopReason: 'end_turn',
    usage: { input: 700, output: 120 },
  };
}

// [PCODE-317 | S15 | v0.1.0] the demo's triage: the history's flips mean flaky; a timeout or a refused
// connection the environment; a selector that finds nothing the test; anything else the product
function demoFailure(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  const flips = Number(/^Flips in the last results: (\d+)/m.exec(text)?.[1] ?? '0');
  const what = (/^What happened: (.*)$/m.exec(text)?.[1] ?? '').toLowerCase();
  const answer =
    flips >= 2
      ? {
          category: 'flaky',
          confidence: 0.7,
          reason: 'It passed and failed in turn ' + String(flips) + ' times lately.',
          next: 'Quarantine it and find what it waits on.',
        }
      : /timeout|timed out|econn|unreachable|not reachable|503|502/.test(what)
        ? {
            category: 'environment',
            confidence: 0.6,
            reason: 'The message points at a service or network the test needs.',
            next: 'Check the test environment, then run it again.',
          }
        : /selector|locator|element|not found|no such/.test(what)
          ? {
              category: 'test_bug',
              confidence: 0.55,
              reason: 'The test could not find what it looks for; the page may have changed.',
              next: 'Update the test to the current page.',
            }
          : {
              category: 'product_bug',
              confidence: 0.6,
              reason: 'The steps ran and the result was not what was expected.',
              next: 'File a bug with the steps and the evidence.',
            };
  return {
    content: [{ type: 'text', text: JSON.stringify(answer) + ' (Demo agent.)' }],
    stopReason: 'end_turn',
    usage: { input: 600, output: 80 },
  };
}

// [PCODE-324 | S15 | v0.1.0] the demo cannot fix code; it gives the file back with a note above the line
function demoFix(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  const line = Number(/^Line: (\d+)/m.exec(text)?.[1] ?? '1');
  const rule = /^Rule: (.*)$/m.exec(text)?.[1] ?? 'the finding';
  const path = /^File: (.*)$/m.exec(text)?.[1] ?? '';
  const body = /```[\w+-]*\n([\s\S]*?)\n```/.exec(text)?.[1] ?? '';
  const lines = body.split('\n');
  const mark = /\.(py|rb|sh|ya?ml|toml)$/.test(path) ? '# ' : '// ';
  const indent = /^\s*/.exec(lines[line - 1] ?? '')?.[0] ?? '';
  lines.splice(
    Math.max(0, line - 1),
    0,
    indent + mark + 'Orqiva: ' + rule + ' flagged the next line; review it before merging.',
  );
  return {
    content: [
      {
        type: 'text',
        text:
          'The demo agent cannot rewrite code, so it marks the line for a person.\n\n```\n' +
          lines.join('\n') +
          '\n```',
      },
    ],
    stopReason: 'end_turn',
    usage: { input: 900, output: 300 },
  };
}

// [PCODE-145 | S15 | v0.1.0]
// [PCODE-303 | S15 | v0.1.0] the demo's line comments: added lines with a TODO, a console.log or a debugger
function demoLines(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  const found: { path: string; line: number; severity: string; body: string }[] = [];
  let path = '';
  for (const l of text.split('\n')) {
    if (l.startsWith('FILE ')) path = l.slice(5);
    const m = /^\s*(\d+) \+ (.*)$/.exec(l);
    if (!m || !path) continue;
    const code = m[2] ?? '';
    const why = /\b(console\.log|debugger)\b/.test(code)
      ? 'Debugging output left in; remove it before merging.'
      : /\b(TODO|FIXME)\b/.test(code)
        ? 'A TODO in new code: make it a task, or finish it here.'
        : '';
    if (why) found.push({ path, line: Number(m[1]), severity: 'warning', body: why });
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(found) }],
    stopReason: 'end_turn',
    usage: { input: 900, output: 60 },
  };
}

// [PCODE-330 | S15 | v0.1.0] the demo judge reads the status and whether there is an answer
// [PCODE-342 | S15 | v0.1.0] the offline postmortem: only what the brief says, in the asked shape
function demoPostmortem(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  const head = /^Incident: (.*)$/m.exec(text)?.[1] ?? 'The incident';
  const open = /open for (.*)$/m.exec(text)?.[1] ?? 'a while';
  const timeline =
    text
      .split('Timeline:')[1]
      ?.split('\n\n')[0]
      ?.split('\n')
      .filter((l) => l.startsWith('- '))
      .slice(0, 12) ?? [];
  const deploy = timeline.find((l) => /deploy|rollback|release/i.test(l));
  const md = [
    '### What happened',
    '',
    head + ' was open for ' + open + '.',
    '',
    '### Timeline (UTC)',
    '',
    ...(timeline.length ? timeline : ['- (no timeline lines)']),
    '',
    '### Why',
    '',
    deploy
      ? 'Most likely the change named here: ' + deploy.slice(2) + '. Not yet confirmed.'
      : 'The cause is not clear from the timeline; the team should add it.',
    '',
    '### Impact',
    '',
    'Users of the affected service, for up to ' + open + '.',
    '',
    '### Actions',
    '',
    '- Add an alert that catches this earlier',
    '- Write a runbook for this problem',
    ...(deploy ? ['- Add a check to the deploy that would have stopped this change'] : []),
    '- Review the updates sent and their timing',
  ].join('\n');
  return {
    content: [{ type: 'text', text: md }],
    stopReason: 'end_turn',
    usage: { input: 900, output: 260 },
  };
}

function demoJudge(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  const failed = /^Status: failed/m.test(text);
  const empty = /^Answer:\n\(none\)/m.test(text);
  const v = failed
    ? { score: 1, reason: 'The run failed, so the instruction was not done.' }
    : empty
      ? { score: 2, reason: 'The run ended without an answer to check.' }
      : {
          score: 4,
          reason: 'The run answered the instruction; a real judge also checks it is right.',
        };
  return {
    content: [{ type: 'text', text: JSON.stringify(v) }],
    stopReason: 'end_turn',
    usage: { input: 600, output: 40 },
  };
}

function demoReview(req: ModelRequest): ModelReply {
  const text = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
  const open = (text.match(/^- \[ \]/gm) ?? []).length;
  const failing = (text.match(/: (failed|blocked)$/gm) ?? []).length;
  const ok = open === 0 && failing === 0;
  const lines = [
    'RECOMMEND: ' + (ok ? 'approve' : 'changes'),
    ok
      ? 'Every acceptance criterion is ticked and no test fails.'
      : String(open) +
        ' criteria are not ticked and ' +
        String(failing) +
        ' tests fail or are blocked.',
    '(Demo agent: a real model also reads the commits and the code.)',
  ];
  return {
    content: [{ type: 'text', text: lines.join(' ') }],
    stopReason: 'end_turn',
    usage: { input: 800, output: 90 },
  };
}
