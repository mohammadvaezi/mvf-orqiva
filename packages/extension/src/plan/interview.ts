// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
//    Why:  a plan is only as good as what Claude understood. Before it plans, Claude reads the description
//          and asks what it needs to know; the user answers in the Home tab, in words and with files.
//          Rounds repeat until Claude says it is clear, then it writes the plan. Everything said is kept
//          in .orqiva/description/interview.json (the state) and conversation.md (what the planning run
//          and the portal read), so closing VS Code half-way loses nothing and a replan builds on it.
//          Free of vscode, so it is tested on its own.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projectFile, projectRel } from '../state/files';

export interface Question {
  id: string;
  question: string;
  /** why Claude asks: shown under the question, so the user knows what kind of answer helps */
  why?: string;
  /** short answers the user can pick with one click */
  options?: string[];
}

export interface Answer {
  text: string;
  /** files under .orqiva/description/attachments/, relative to that folder */
  files: string[];
}

export type Entry =
  | {
      kind: 'questions';
      at: string;
      understanding: string;
      questions: Question[];
      answers?: Record<string, Answer>;
      answeredAt?: string;
    }
  /** something the user added on their own: more to say, a changed description, a wish for the replan */
  | { kind: 'note'; at: string; text: string; files: string[] }
  | { kind: 'clear'; at: string; understanding: string };

export interface Interview {
  version: 1;
  /** the description Claude last read */
  descriptionHash: string;
  entries: Entry[];
  /** the stamp of the conversation the current plan.json was written from */
  planOf?: string;
}

/**
 * none: no conversation yet; asking: Claude's questions wait for answers; due: Claude has to read
 * again (new answers, a note, a changed description); clear: Claude knows enough to plan.
 */
export type InterviewState = 'none' | 'asking' | 'due' | 'clear';

export const INTERVIEW_FILE = ['description', 'interview.json'] as const;
export const CONVERSATION_FILE = ['description', 'conversation.md'] as const;
export const ATTACHMENTS_DIR = ['description', 'attachments'] as const;
export const PREVIOUS_PLAN = ['state', 'plan.previous.json'] as const;
export const MAX_QUESTIONS = 7;

export const hashText = (text: string): string =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);

/** What the plan is written from: the description and everything said about it. */
export const stamp = (iv: Interview): string =>
  iv.descriptionHash + '#' + String(iv.entries.length);

// ── [PCODE-457 | S15 | v0.1.0] the files: read, written together, attachments copied in ──
export function readInterview(root: string): Interview | null {
  try {
    const v = JSON.parse(
      fs.readFileSync(projectFile(root, INTERVIEW_FILE), 'utf8'),
    ) as Partial<Interview>;
    return v.version === 1 && Array.isArray(v.entries) ? (v as Interview) : null;
  } catch {
    return null;
  }
}

export function writeInterview(root: string, iv: Interview, now: Date = new Date()): void {
  const file = projectFile(root, INTERVIEW_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(iv, null, 2) + '\n', 'utf8');
  fs.writeFileSync(projectFile(root, CONVERSATION_FILE), conversationMarkdown(iv, now), 'utf8');
}

export function newInterview(descriptionHash: string): Interview {
  return { version: 1, descriptionHash, entries: [] };
}

/** Copies a file the user picked next to the description; returns its name in attachments/. */
export function addAttachment(root: string, source: string): string {
  const dir = projectFile(root, ATTACHMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(source);
  const base =
    path
      .basename(source, ext)
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file';
  let name = base + ext.toLowerCase();
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++)
    name = base + '-' + String(n) + ext.toLowerCase();
  fs.copyFileSync(source, path.join(dir, name));
  return name;
}

export const attachmentRel = (root: string, name: string): string =>
  projectRel(root, [...ATTACHMENTS_DIR, name]);

// ── [PCODE-457 | S15 | v0.1.0] interviewState: where the conversation stands, from the file alone ──
export function interviewState(iv: Interview | null, descriptionHash: string): InterviewState {
  if (!iv) return 'none';
  const last = iv.entries[iv.entries.length - 1];
  if (!last) return 'due';
  if (last.kind === 'questions' && !last.answers) return 'asking';
  if (last.kind === 'clear' && iv.descriptionHash === descriptionHash) return 'clear';
  return 'due';
}

/** The questions waiting for answers, if any. */
export function openQuestions(iv: Interview | null): Extract<Entry, { kind: 'questions' }> | null {
  const last = iv?.entries[iv.entries.length - 1];
  return last?.kind === 'questions' && !last.answers ? last : null;
}

/** Whether plan.json was written from this conversation (a plan from before the conversation counts). */
export function planIsCurrent(iv: Interview | null): boolean {
  return !iv || iv.planOf === stamp(iv);
}

// ── [PCODE-457 | S15 | v0.1.0] the user's side: answers, notes ──
export function recordAnswers(
  iv: Interview,
  answers: Record<string, Answer>,
  now: Date = new Date(),
): Interview {
  const open = openQuestions(iv);
  if (!open) return iv;
  const kept: Record<string, Answer> = {};
  for (const q of open.questions) {
    const a = answers[q.id];
    kept[q.id] = { text: (a?.text ?? '').trim(), files: a?.files ?? [] };
  }
  const extra = answers['_more'];
  const entries: Entry[] = [
    ...iv.entries.slice(0, -1),
    { ...open, answers: kept, answeredAt: now.toISOString() },
  ];
  if (extra && (extra.text.trim() || extra.files.length))
    entries.push({
      kind: 'note',
      at: now.toISOString(),
      text: extra.text.trim(),
      files: extra.files,
    });
  return { ...iv, entries };
}

export function addNote(
  iv: Interview,
  text: string,
  files: string[] = [],
  now: Date = new Date(),
): Interview {
  return {
    ...iv,
    entries: [...iv.entries, { kind: 'note', at: now.toISOString(), text: text.trim(), files }],
  };
}

// ── [PCODE-457 | S15 | v0.1.0] Claude's side: its reply, read strictly ──
export type Reply =
  | { status: 'questions'; understanding: string; questions: Omit<Question, 'id'>[] }
  | { status: 'clear'; understanding: string };

const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** The JSON object Claude was asked for, from its final message; null when there is none. */
export function parseReply(text: string): Reply | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const understanding = str(o['understanding']) ? o['understanding'].trim() : '';
  if (o['status'] === 'clear') return { status: 'clear', understanding };
  if (o['status'] !== 'questions' || !Array.isArray(o['questions'])) return null;
  const questions = (o['questions'] as unknown[])
    .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
    .filter((q) => str(q['question']))
    .slice(0, MAX_QUESTIONS)
    .map((q) => {
      const options = Array.isArray(q['options'])
        ? (q['options'] as unknown[])
            .filter(str)
            .map((x) => x.trim().slice(0, 120))
            .slice(0, 6)
        : [];
      return {
        question: (q['question'] as string).trim().slice(0, 1000),
        ...(str(q['why']) ? { why: q['why'].trim().slice(0, 500) } : {}),
        ...(options.length ? { options } : {}),
      };
    });
  // a round without a question is Claude saying it is clear
  return questions.length
    ? { status: 'questions', understanding, questions }
    : { status: 'clear', understanding };
}

export function recordReply(
  iv: Interview,
  reply: Reply,
  descriptionHash: string,
  now: Date = new Date(),
): Interview {
  const round = iv.entries.filter((e) => e.kind === 'questions').length + 1;
  const entry: Entry =
    reply.status === 'clear'
      ? { kind: 'clear', at: now.toISOString(), understanding: reply.understanding }
      : {
          kind: 'questions',
          at: now.toISOString(),
          understanding: reply.understanding,
          questions: reply.questions.map((q, n) => ({
            id: 'r' + String(round) + 'q' + String(n + 1),
            ...q,
          })),
        };
  return { ...iv, descriptionHash, entries: [...iv.entries, entry] };
}

// ── [PCODE-457 | S15 | v0.1.0] conversation.md: the meeting as the planning run and the portal read it ──
export function conversationMarkdown(iv: Interview, now: Date = new Date()): string {
  const day = (iso: string): string => iso.slice(0, 10);
  const files = (f: string[]): string =>
    f.length ? '\n\nAttached: ' + f.map((x) => '`attachments/' + x + '`').join(', ') : '';
  const out = [
    '# Planning conversation',
    '',
    'Claude read the description and asked what it needed to know; the answers and notes below are',
    'requirements as much as the description is. Newest last. Updated ' +
      day(now.toISOString()) +
      '.',
    '',
  ];
  let round = 0;
  for (const e of iv.entries) {
    if (e.kind === 'questions') {
      round++;
      out.push(`## Round ${String(round)}: Claude's questions (${day(e.at)})`, '');
      if (e.understanding) out.push('Claude understood so far: ' + e.understanding, '');
      e.questions.forEach((q, n) => {
        out.push(`**${String(n + 1)}. ${q.question}**`);
        if (q.why) out.push(`_Why: ${q.why}_`);
        const a = e.answers?.[q.id];
        if (!e.answers) out.push('', 'Answer: (waiting for the user)', '');
        else if (!a || (!a.text && !a.files.length))
          out.push('', 'Answer: (left open - Claude decides and says so)', '');
        else out.push('', 'Answer: ' + (a.text || '(see the attachment)') + files(a.files), '');
      });
    } else if (e.kind === 'note') {
      out.push(
        `## The user added (${day(e.at)})`,
        '',
        (e.text || '(files only)') + files(e.files),
        '',
      );
    } else {
      out.push(`## Claude: everything is clear (${day(e.at)})`, '', e.understanding, '');
    }
  }
  return out.join('\n');
}

// ── [PCODE-457 | S15 | v0.1.0] the prompts: the meeting, and the plan written from it ──
export const INTERVIEW_PROMPT = `You are the planning lead of the software project **{name}** (Orqiva key \`{identifier}\`). Today is {today}.
Before anything is planned you hold a short requirements meeting with the person who wants it built. They
are often not a developer: ask in plain words, one thing per question.

Every turn:
1. Read \`.orqiva/description/description.md\`, \`.orqiva/description/conversation.md\` (what was asked and
   answered so far, and notes the user added) and the files in \`.orqiva/description/attachments/\` that the
   conversation mentions. Look at the project folder too when it already has code or documents.
   \`.orqiva/description/requests.md\` names the client and what they asked for: the plan serves those
   requests, so ask where the description and a request disagree or a request is unclear.
2. Decide what you still must know to write a good plan (architecture, one-day sprints, acceptance checks).
   Typical gaps: who uses it and with which roles, the must-haves versus the nice-to-haves, data and
   integrations (which systems, APIs, import and export formats), platforms, hosting, languages, compliance,
   look and feel, deadlines. Never ask what the description, an answer or an attachment already says. Do not
   ask for technical choices the user cannot judge: decide those yourself and say so in "understanding".
3. Ask at most ${String(MAX_QUESTIONS)} questions, the most important first. Offer 2-4 short answer options where that helps.
   An answer left empty means "you decide". After three rounds of answers, only ask what truly blocks the plan.

Reply with ONLY one JSON object and nothing else, in the language of the description:
{{"status": "questions", "understanding": "<what you understood so far, 3-8 sentences>", "questions": [{{"question": "...", "why": "<why it matters for the plan, one sentence>", "options": ["...", "..."]}}]}}
or, when you know enough to plan:
{{"status": "clear", "understanding": "<what will be built: users, must-haves, nice-to-haves, integrations, platform, hosting, and the decisions and assumptions you made>"}}

Do not write, change or delete any file. Do not start planning yet.
`;

export const INTERVIEW_TASK =
  'Read the description and the planning conversation, then reply with the JSON object as instructed.';

export function planTask(dir: string, hasPrevious: boolean): string {
  return (
    `Write the plan for this project now. Read ${dir}/description/description.md, the planning conversation ` +
    `in ${dir}/description/conversation.md and the files in ${dir}/description/attachments/ it mentions: ` +
    'the answers there are requirements. Everything open was settled in that conversation, so do not ask ' +
    'questions; where something is still open, decide and write the assumption into architecture.md.' +
    (hasPrevious
      ? ` ${dir}/state/plan.previous.json is the plan written before: keep what still fits, change what the ` +
        'conversation changed.'
      : '') +
    ' Then write the planning files as instructed.'
  );
}
