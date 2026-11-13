// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
// ── [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI ──
// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
//    Why:  the daily work of the web, from the terminal: what waits for me (and an agent's approval answered
//          here), a comment on a task (for the client when asked), the timer and hours, the project's agents
//          (ask one, watch its steps, stop it, pause all) and ideas with their interview. Writes that need no
//          answer (comments, hours, inbox actions, decisions, a new idea) wait in the queue when the network
//          is gone and go with the next orq sync. Numbers in `orq inbox` stay valid until the next listing.
import { isActiveRunStatus, stepLabel } from '@orqiva/shared';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { RawBody, sendOrQueue, offline } from './api.js';
import {
  LoopError,
  linked,
  option,
  positionals,
  type Linked,
  type LoopDeps,
  type LoopResult,
} from './commands.js';
import { loadActive, readJson, statePath, writeJson } from './config.js';
import { messages, MESSAGES_USAGE } from './messages.js'; // [PCODE-236 | S15 | v0.1.0]

export const TEAM_USAGE = [
  '  inbox                      what waits for you, numbered',
  '  inbox done|snooze N        mark entry N of the last listing done, or snooze it an hour',
  '  approve N|RUN              let a waiting agent go on (inbox number or run id)',
  '  decline N|RUN [--note "why"]   stop it, with a reason the agent reads',
  '  comment REF "text" [--client]  a comment on a task; --client lets the client read it',
  '  time                       this week, today and the running timer',
  '  time start [REF] | time stop   the timer, on the active task by default',
  '  time set REF HOURS [--day YYYY-MM-DD] [--note "…"]   the hours of a task on a day (1,5 or 90m)',
  "  agent list | runs          the agents, and this project's runs",
  '  agent ask NAME "instruction" [--task REF]   ask an agent to work (on the active task by default)',
  '  agent watch RUN | agent stop RUN   follow a run step by step, or stop it',
  '  agent pause | agent resume   pause or resume every agent (admin)',
  '  idea "Title" [--body "…"] | idea list   capture an idea, list the ideas',
  '  idea interview IDEA ["answer"] [--enough]   the interview: the next question, your answer, or sum up now',
  '  idea source IDEA --file F | --link URL | --text "…" [--said-by "…"] [--title "…"]   add a source',
  '  idea show IDEA             the idea with its sources and how far each is read',
  ...MESSAGES_USAGE, // [PCODE-236 | S15 | v0.1.0]
];

export interface TeamOptions {
  sleep?: (ms: number) => Promise<void>;
  print?: (line: string) => void;
  /** how often watch asks before it gives up (tests) */
  maxPolls?: number;
}

interface InboxEntry {
  id: string;
  kind: string;
  projectKey: string | null;
  objectType: string;
  objectId: string;
  title: string;
  createdAt: string;
}
interface RunOut {
  id: string;
  agentName: string;
  itemRef: string | null;
  instruction: string;
  status: string;
  error: string;
  summary: string;
  createdAt: string;
}
interface StepOut {
  seq: number;
  kind: string;
  content: Record<string, unknown>;
  at: string;
}
interface IdeaOut {
  id: string;
  ref: string;
  title: string;
  status: string;
  interviewDone: boolean;
  summary: string;
}

const INBOX_FILE = 'inbox.json';

/** "3 min", "2 h", "4 days" since a time. */
export function ageText(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return String(m) + ' min';
  const h = Math.round(m / 60);
  return h < 48 ? String(h) + ' h' : String(Math.round(h / 24)) + ' days';
}

/** Hours as Orqiva writes them: 1,5 h. */
export const hoursText = (minutes: number): string =>
  (minutes / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
  ' h';

/** Minutes from "1,5", "1.5", "1:30", "90m" or "2h"; null when it is none of these. */
export function parseHours(s: string): number | null {
  const t = s.trim().toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /^(\d+):([0-5]\d)$/.exec(t))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+)\s*m(in)?$/.exec(t))) return Number(m[1]);
  if ((m = /^(\d+(?:[.,]\d+)?)\s*h?$/.exec(t))) {
    const v = Math.round(Number((m[1] ?? '').replace(',', '.')) * 60);
    return v <= 1440 ? v : null;
  }
  return null;
}

/** The task's id: the active task's from the state file (works offline), else from the server. */
async function taskOf(l: Linked, ref: string): Promise<{ id: string; ref: string }> {
  const active = loadActive(l.root);
  if (active && active.ref.toUpperCase() === ref.toUpperCase())
    return { id: active.taskId, ref: active.ref };
  try {
    const t = await l.api.call<{ task: { id: string; ref: string } }>(
      'GET',
      l.ws + '/loop/tasks/' + encodeURIComponent(ref),
    );
    return t.task;
  } catch (e) {
    if (offline(e))
      throw new LoopError(
        'Offline: only the active task is known without the server. Try again when online.',
      );
    throw e;
  }
}

const activeRef = (l: Linked): string | null => loadActive(l.root)?.ref ?? null;

const queued = (sent: boolean, what: string): string =>
  sent ? what : what + ' (offline: queued, goes with the next orq sync)';

// ── [PCODE-195 | S15 | v0.1.0] the inbox, numbered; approvals of agents answered here ──
async function inbox(argv: readonly string[], l: Linked, now: number): Promise<LoopResult> {
  const [, action, n] = argv;
  if (action === 'done' || action === 'snooze') {
    const e = entryAt(l, n);
    const sent = await sendOrQueue(l.root, l.api, 'PATCH', l.ws + '/inbox/' + e.id, {
      action,
      ...(action === 'snooze' ? { until: new Date(now + 3_600_000).toISOString() } : {}),
    });
    return { code: 0, out: queued(sent, (action === 'done' ? 'Done: ' : 'Snoozed: ') + e.title) };
  }
  if (action) throw new LoopError('Usage: orq inbox [done|snooze N]');
  const r = await l.api.call<{ items: InboxEntry[] }>('GET', l.ws + '/inbox?state=open');
  writeJson(statePath(l.root, INBOX_FILE), r.items);
  if (!r.items.length) return { code: 0, out: 'Nothing waits for you.' };
  return {
    code: 0,
    out: r.items
      .map(
        (e, i) =>
          String(i + 1).padStart(2) +
          '  ' +
          e.kind.padEnd(9) +
          (e.projectKey ? e.projectKey + '  ' : '') +
          e.title +
          '  · ' +
          ageText(e.createdAt, now) +
          (e.kind === 'approval' && e.objectType === 'agent_run'
            ? '  → orq approve ' + String(i + 1) + ' | orq decline ' + String(i + 1)
            : ''),
      )
      .join('\n'),
  };
}

function entryAt(l: Linked, n: string | undefined): InboxEntry {
  const list = readJson<InboxEntry[]>(statePath(l.root, INBOX_FILE)) ?? [];
  const e = n && /^\d+$/.test(n) ? list[Number(n) - 1] : undefined;
  if (!e) throw new LoopError('No entry ' + (n ?? '') + ' in the last listing. Run: orq inbox');
  return e;
}

async function decide(argv: readonly string[], l: Linked, approve: boolean): Promise<LoopResult> {
  const [verb, target] = argv;
  if (!target) throw new LoopError('Usage: orq ' + (verb ?? '') + ' N|RUN');
  let runId = target;
  let entry: InboxEntry | null = null;
  if (/^\d+$/.test(target)) {
    entry = entryAt(l, target);
    if (entry.objectType !== 'agent_run')
      throw new LoopError('Entry ' + target + ' is not an agent asking. Open it on the web.');
    runId = entry.objectId;
  }
  const note = option(argv, '--note');
  const sent = await sendOrQueue(
    l.root,
    l.api,
    'POST',
    l.ws + '/agent-runs/' + runId + '/decision',
    {
      approve,
      ...(note ? { note } : {}),
    },
  );
  if (entry && sent)
    await l.api
      .call('PATCH', l.ws + '/inbox/' + entry.id, { action: 'done' })
      .catch(() => undefined);
  return {
    code: 0,
    out: queued(sent, approve ? 'Approved: the agent goes on.' : 'Declined: the agent stops.'),
  };
}

// ── [PCODE-195 | S15 | v0.1.0] a comment, for the client when asked ──
async function comment(argv: readonly string[], l: Linked): Promise<LoopResult> {
  const [ref, text] = positionals(argv.slice(1), []);
  if (!ref || !text) throw new LoopError('Usage: orq comment REF "text" [--client]');
  const t = await taskOf(l, ref);
  const forClient = argv.includes('--client');
  const sent = await sendOrQueue(l.root, l.api, 'POST', l.ws + '/items/' + t.id + '/comments', {
    body: text,
    ...(forClient ? { visibility: 'client' } : {}),
  });
  return {
    code: 0,
    out: queued(sent, 'Commented on ' + t.ref + (forClient ? ' (the client reads it)' : '')),
  };
}

// ── [PCODE-195 | S15 | v0.1.0] time: the week, the timer, hours on a day ──
interface WeekOut {
  days: string[];
  perDay: number[];
  total: number;
  timer: { title: string; itemRef: string | null; startedAt: string } | null;
}

async function time(argv: readonly string[], l: Linked, now: number): Promise<LoopResult> {
  const [, action] = argv;
  if (action === 'start') {
    const ref = argv[2] && !argv[2].startsWith('--') ? argv[2] : activeRef(l);
    if (!ref) throw new LoopError('No active task: orq time start REF');
    const t = await taskOf(l, ref);
    await l.api.call('POST', l.ws + '/time/timer', { itemId: t.id });
    return { code: 0, out: 'Timer started on ' + t.ref };
  }
  if (action === 'stop') {
    const r = await l.api.call<{ minutes: number }>('POST', l.ws + '/time/timer/stop', {});
    return { code: 0, out: 'Timer stopped: ' + hoursText(r.minutes) + ' booked.' };
  }
  if (action === 'set') {
    const [ref, hours] = positionals(argv.slice(2), ['--day', '--note']);
    const minutes = hours ? parseHours(hours) : null;
    if (!ref || minutes === null)
      throw new LoopError('Usage: orq time set REF HOURS [--day YYYY-MM-DD] [--note "…"]');
    const day = option(argv, '--day') ?? new Date(now).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new LoopError('--day is YYYY-MM-DD');
    const t = await taskOf(l, ref);
    const note = option(argv, '--note');
    const sent = await sendOrQueue(l.root, l.api, 'PUT', l.ws + '/time/cell', {
      day,
      minutes,
      itemId: t.id,
      ...(note ? { note } : {}),
    });
    return { code: 0, out: queued(sent, t.ref + ' on ' + day + ': ' + hoursText(minutes)) };
  }
  if (action) throw new LoopError('Usage: orq time [start [REF] | stop | set REF HOURS]');
  const w = await l.api.call<WeekOut>('GET', l.ws + '/time/week');
  const today = new Date(now).toISOString().slice(0, 10);
  const i = w.days.indexOf(today);
  const lines = [
    'Today ' + hoursText(i >= 0 ? (w.perDay[i] ?? 0) : 0) + ' · this week ' + hoursText(w.total),
  ];
  if (w.timer)
    lines.push(
      'Timer on ' +
        (w.timer.itemRef ? w.timer.itemRef + ' ' : '') +
        w.timer.title +
        ' for ' +
        ageText(w.timer.startedAt, now),
    );
  return { code: 0, out: lines.join('\n') };
}

// ── [PCODE-195 | S15 | v0.1.0] agents: ask, watch, stop, pause all ──
async function runOf(l: Linked, idOrPrefix: string): Promise<string> {
  if (/^[0-9a-f-]{36}$/i.test(idOrPrefix)) return idOrPrefix;
  const runs = await l.api.call<RunOut[]>(
    'GET',
    l.ws + '/agent-runs?projectId=' + l.link.projectId,
  );
  const hits = runs.filter((r) => r.id.startsWith(idOrPrefix.toLowerCase()));
  if (hits.length !== 1)
    throw new LoopError(
      hits.length ? 'More than one run starts with ' + idOrPrefix : 'No run ' + idOrPrefix,
    );
  return (hits[0] as RunOut).id;
}

const runLine = (r: RunOut, now: number): string =>
  r.id.slice(0, 8) +
  '  ' +
  r.status.padEnd(9) +
  r.agentName +
  (r.itemRef ? ' · ' + r.itemRef : '') +
  '  ' +
  (r.status === 'failed' && r.error
    ? r.error.slice(0, 60)
    : (r.summary || r.instruction).slice(0, 60)) +
  '  · ' +
  ageText(r.createdAt, now);

async function agent(
  argv: readonly string[],
  l: Linked,
  now: number,
  opts: TeamOptions,
): Promise<LoopResult> {
  const [, action] = argv;
  switch (action) {
    case undefined:
    case 'list': {
      const list = await l.api.call<{ name: string; description: string; enabled: boolean }[]>(
        'GET',
        l.ws + '/agents',
      );
      const width = Math.max(0, ...list.map((a) => a.name.length)) + 2;
      return {
        code: 0,
        out: list
          .map((a) => (a.enabled ? '  ' : '- ') + a.name.padEnd(width) + a.description.slice(0, 70))
          .join('\n'),
      };
    }
    case 'runs': {
      const runs = await l.api.call<RunOut[]>(
        'GET',
        l.ws + '/agent-runs?projectId=' + l.link.projectId,
      );
      const ordered = [
        ...runs.filter((r) => isActiveRunStatus(r.status)),
        ...runs.filter((r) => !isActiveRunStatus(r.status)),
      ].slice(0, 20);
      return {
        code: 0,
        out: ordered.length
          ? ordered.map((r) => runLine(r, now)).join('\n')
          : 'No agent has worked on this project yet.',
      };
    }
    case 'ask': {
      const [name, instruction] = positionals(argv.slice(2), ['--task']);
      if (!name || !instruction)
        throw new LoopError('Usage: orq agent ask NAME "instruction" [--task REF]');
      const list = await l.api.call<{ id: string; key: string; name: string; enabled: boolean }[]>(
        'GET',
        l.ws + '/agents',
      );
      const a = list.find(
        (x) => x.name.toLowerCase() === name.toLowerCase() || x.key === name.toLowerCase(),
      );
      if (!a) throw new LoopError('No agent ' + name + '. orq agent list shows them.');
      if (!a.enabled) throw new LoopError(a.name + ' is switched off.');
      const ref = option(argv, '--task') ?? activeRef(l);
      const t = ref ? await taskOf(l, ref) : null;
      const run = await l.api.call<RunOut>(
        'POST',
        l.ws + '/projects/' + l.link.projectId + '/agent-runs',
        { agentId: a.id, instruction, ...(t ? { itemId: t.id } : {}) },
      );
      return {
        code: 0,
        out:
          a.name +
          ' is on it' +
          (t ? ' (' + t.ref + ')' : '') +
          '. Follow it: orq agent watch ' +
          run.id.slice(0, 8),
      };
    }
    case 'watch':
      return watch(l, await runOf(l, need(argv[2], 'orq agent watch RUN')), opts);
    case 'stop': {
      const id = await runOf(l, need(argv[2], 'orq agent stop RUN'));
      await l.api.call('POST', l.ws + '/agent-runs/' + id + '/cancel', {});
      return { code: 0, out: 'Run stopped.' };
    }
    case 'pause':
    case 'resume':
      await l.api.call('PUT', l.ws + '/agents/pause', { paused: action === 'pause' });
      return {
        code: 0,
        out:
          action === 'pause'
            ? 'All agents paused: running steps finish, nothing new starts.'
            : 'Agents resumed.',
      };
    default:
      throw new LoopError('Usage: orq agent list|runs|ask|watch|stop|pause|resume');
  }
}

const need = (v: string | undefined, usage: string): string => {
  if (!v) throw new LoopError('Usage: ' + usage);
  return v;
};

/** Prints each new step until the run is over (or waits for a person). */
async function watch(l: Linked, id: string, opts: TeamOptions): Promise<LoopResult> {
  const print = opts.print ?? ((line: string) => process.stdout.write(line + '\n'));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let seen = 0;
  for (let i = 0; i < (opts.maxPolls ?? 1800); i++) {
    const r = await l.api.call<{ run: RunOut; steps: StepOut[] }>(
      'GET',
      l.ws + '/agent-runs/' + id,
    );
    for (const s of r.steps.filter((x) => x.seq > seen)) {
      print(s.at.slice(11, 19) + '  ' + stepLabel(s));
      seen = Math.max(seen, s.seq);
    }
    if (r.run.status === 'waiting')
      return {
        code: 0,
        out: 'Waits for a person: orq inbox, then orq approve N or orq decline N',
      };
    if (!isActiveRunStatus(r.run.status))
      return {
        code: r.run.status === 'failed' ? 1 : 0,
        out:
          r.run.agentName +
          ' ' +
          r.run.status +
          (r.run.summary ? ': ' + r.run.summary : r.run.error ? ': ' + r.run.error : ''),
      };
    await sleep(2000);
  }
  return { code: 0, out: 'Still running; watch again later.' };
}

// ── [PCODE-272 | S15 | v0.1.0] sources for an idea from the terminal ──
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
};

/** The media type a file is sent as, from its extension. */
export const mimeOf = (name: string): string =>
  MIME_BY_EXT[(/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()] ??
  'application/octet-stream';

interface SourceOut {
  label: string;
  kind: string;
  title: string;
  url: string;
  fileName: string | null;
  textLength: number;
  read: { status: string; error: string } | null;
  link: { status: string; error: string } | null;
}

/** How far a source is read, in a word or two. */
export function sourceState(x: SourceOut): string {
  if (x.link?.status === 'failed') return 'failed: ' + x.link.error;
  if (x.read && x.read.status !== 'done' && !x.textLength)
    return x.read.status === 'failed' ? 'failed: ' + x.read.error : 'being read';
  if (x.link?.status === 'reading') return 'being read';
  return x.textLength ? x.textLength.toLocaleString('de-DE') + ' characters' : 'no text';
}

const sourceLine = (x: SourceOut): string =>
  x.label.padEnd(4) +
  x.kind.padEnd(6) +
  (x.title || x.fileName || x.url || '(untitled)') +
  '  ·  ' +
  sourceState(x);

async function findIdea(l: Linked, key: string): Promise<IdeaOut> {
  const list = await l.api.call<IdeaOut[]>(
    'GET',
    l.ws + '/projects/' + l.link.projectId + '/ideas',
  );
  const found = list.find((i) => i.ref.toUpperCase() === key.toUpperCase() || i.id === key);
  if (!found) throw new LoopError('No idea ' + key + '. orq idea list shows them.');
  return found;
}

async function ideaSource(argv: readonly string[], l: Linked, cwd: string): Promise<LoopResult> {
  const usage =
    'orq idea source IDEA --file F | --link URL | --text "…" [--said-by "…"] [--title "…"]';
  const found = await findIdea(l, need(argv[2], usage));
  const file = option(argv, '--file');
  const link = option(argv, '--link');
  const text = option(argv, '--text');
  const saidBy = option(argv, '--said-by');
  const title = option(argv, '--title');
  if ([file, link, text].filter(Boolean).length !== 1)
    throw new LoopError('Give exactly one of --file, --link or --text. ' + usage);
  let body: Record<string, unknown>;
  if (file) {
    const path = resolve(cwd, file);
    let data: Buffer;
    try {
      data = readFileSync(path);
    } catch {
      throw new LoopError('Cannot read ' + file);
    }
    const name = basename(path);
    const up = await l.api.call<{ id: string }>(
      'POST',
      l.ws +
        '/files?name=' +
        encodeURIComponent(name) +
        '&projectId=' +
        encodeURIComponent(l.link.projectId),
      new RawBody(data, mimeOf(name)),
      120_000,
    );
    body = { kind: 'file', fileId: up.id };
  } else if (link) body = { kind: 'link', url: link };
  else body = { kind: saidBy ? 'quote' : 'text', body: text };
  if (saidBy) body['saidBy'] = saidBy;
  if (title) body['title'] = title;
  // a link is read by the server before it answers
  const x = await l.api.call<SourceOut>(
    'POST',
    l.ws + '/ideas/' + found.id + '/sources',
    body,
    60_000,
  );
  return { code: 0, out: 'Added to ' + found.ref + ':\n' + sourceLine(x) };
}

async function ideaShow(argv: readonly string[], l: Linked): Promise<LoopResult> {
  const found = await findIdea(l, need(argv[2], 'orq idea show IDEA'));
  const w = await l.api.call<{
    sources: SourceOut[];
    requirements: unknown[];
    questions: { status: string }[];
  }>('GET', l.ws + '/ideas/' + found.id + '/workspace');
  const open = w.questions.filter((q) => q.status === 'open').length;
  return {
    code: 0,
    out: [
      found.ref + '  ' + found.title + '  (' + found.status + ')',
      String(w.requirements.length) + ' requirements, ' + String(open) + ' open questions',
      '',
      ...(w.sources.length
        ? w.sources.map(sourceLine)
        : ['No sources yet: orq idea source ' + found.ref + ' --file brief.pdf']),
    ].join('\n'),
  };
}

// ── [PCODE-195 | S15 | v0.1.0] ideas and their interview ──
async function idea(argv: readonly string[], l: Linked, cwd = '.'): Promise<LoopResult> {
  const P = l.ws + '/projects/' + l.link.projectId + '/ideas';
  if (argv[1] === 'source') return ideaSource(argv, l, cwd); // [PCODE-272 | S15 | v0.1.0]
  if (argv[1] === 'show') return ideaShow(argv, l);
  if (argv[1] === 'list') {
    const list = await l.api.call<IdeaOut[]>('GET', P);
    return {
      code: 0,
      out: list.length
        ? list
            .slice(0, 30)
            .map((i) => i.ref.padEnd(10) + i.status.padEnd(10) + i.title)
            .join('\n')
        : 'No ideas yet: orq idea "Title"',
    };
  }
  if (argv[1] === 'interview') {
    const found = await findIdea(l, need(argv[2], 'orq idea interview IDEA ["answer"]'));
    // [PCODE-273 | S15 | v0.1.0] --enough: the interviewer sums up with what it has
    const enough = argv.includes('--enough');
    const answer = argv.slice(3).find((x) => x !== '--enough');
    const r = await l.api.call<{
      idea: IdeaOut;
      messages: { role: string; body: string; area?: string | null }[];
      maxQuestions?: number;
    }>('POST', l.ws + '/ideas/' + found.id + '/interview', {
      ...(answer ? { answer } : {}),
      ...(enough ? { enough: true } : {}),
    });
    if (r.idea.interviewDone)
      return { code: 0, out: 'The interview is done. Summary:\n' + r.idea.summary };
    const q = [...r.messages].reverse().find((m) => m.role === 'agent');
    const asked = r.messages.filter((m) => m.role === 'agent').length;
    return {
      code: 0,
      out:
        (q?.area ? '[' + q.area.replace(/_/g, '-') + '] ' : '') +
        (q?.body ?? 'The interviewer is thinking; ask again in a moment.') +
        (r.maxQuestions
          ? '\n(question ' + String(asked) + ' of at most ' + String(r.maxQuestions) + ')'
          : '') +
        '\n\nAnswer: orq idea interview ' +
        r.idea.ref +
        ' "your answer"   (or --enough to sum up now)',
    };
  }
  const [title] = positionals(argv.slice(1), ['--body']);
  if (!title) throw new LoopError('Usage: orq idea "Title" [--body "…"]');
  const body = option(argv, '--body');
  const sent = await sendOrQueue(l.root, l.api, 'POST', P, { title, ...(body ? { body } : {}) });
  return {
    code: 0,
    out: queued(sent, 'Idea noted. The interview: orq idea list, then orq idea interview <IDEA>'),
  };
}

/** Runs a team command, or returns null when the command is not one. */
export async function runTeam(
  argv: readonly string[],
  deps: LoopDeps,
  opts: TeamOptions = {},
): Promise<LoopResult | null> {
  const [command] = argv;
  const now = deps.now?.() ?? Date.now();
  switch (command) {
    case 'inbox':
      return inbox(argv, linked(deps), now);
    case 'approve':
    case 'decline':
      return decide(argv, linked(deps), command === 'approve');
    case 'comment':
      return comment(argv, linked(deps));
    case 'time':
      return time(argv, linked(deps), now);
    case 'agent':
      return agent(argv, linked(deps), now, opts);
    case 'idea':
      return idea(argv, linked(deps), deps.cwd);
    // [PCODE-236 | S15 | v0.1.0] conversations
    case 'msg':
      return messages(argv, linked(deps));
    default:
      return null;
  }
}
