// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
//    Why:  an idea is noted where it comes up, in the editor, and its interview is answered there: the
//          interviewer (the Analyst agent on the server) asks one question at a time, each answer goes back,
//          and when it has enough it writes the summary the idea's proposal starts from. The same
//          conversation as on the web; it can be left at any question and picked up there or here.
import { RawBody, type Api } from '../../../cli/src/loop/api';
import { mimeOf, sourceState } from '../../../cli/src/loop/team';

export interface IdeasSource {
  api: Api;
  workspaceId: string;
  projectId: string;
}

export interface IdeaJson {
  id: string;
  ref: string;
  title: string;
  status: string;
  interviewDone: boolean;
  summary: string;
}
interface MessageJson {
  role: string;
  body: string;
}

export interface InterviewStep {
  idea: IdeaJson;
  /** the interviewer's latest question; null when it is done or still thinking */
  question: string | null;
}

/** The interviewer's latest question, when the last word is its own. */
export function lastQuestion(messages: readonly MessageJson[]): string | null {
  const last = messages.at(-1);
  return last?.role === 'agent' ? last.body : null;
}

/** Ideas whose interview can go on: new ones not yet summarised. */
export const interviewable = (ideas: readonly IdeaJson[]): IdeaJson[] =>
  ideas.filter((i) => i.status === 'new' && !i.interviewDone);

export async function noteIdea(src: IdeasSource, title: string, body: string): Promise<IdeaJson> {
  return src.api.call<IdeaJson>(
    'POST',
    '/api/workspaces/' + src.workspaceId + '/projects/' + src.projectId + '/ideas',
    { title, ...(body ? { body } : {}) },
  );
}

export async function listIdeas(src: IdeasSource): Promise<IdeaJson[]> {
  return src.api.call<IdeaJson[]>(
    'GET',
    '/api/workspaces/' + src.workspaceId + '/projects/' + src.projectId + '/ideas',
  );
}

/** Sends an answer (or nothing, to hear the current question) and returns what comes next. */
export async function interview(
  src: IdeasSource,
  ideaId: string,
  answer?: string,
): Promise<InterviewStep> {
  const r = await src.api.call<{ idea: IdeaJson; messages: MessageJson[] }>(
    'POST',
    '/api/workspaces/' + src.workspaceId + '/ideas/' + ideaId + '/interview',
    answer ? { answer } : {},
  );
  return { idea: r.idea, question: r.idea.interviewDone ? null : lastQuestion(r.messages) };
}

// ── [PCODE-272 | S15 | v0.1.0] a source for an idea from the editor: the selection, the open file, a link or text ──
export type SourceInput =
  | { kind: 'text'; body: string; title?: string; saidBy?: string }
  | { kind: 'link'; url: string; title?: string }
  | { kind: 'file'; name: string; data: Uint8Array };

export interface SourceJson {
  label: string;
  kind: string;
  title: string;
  url: string;
  fileName: string | null;
  textLength: number;
  read: { status: string; error: string } | null;
  link: { status: string; error: string } | null;
}

/** Adds the source; a file is uploaded first, a link is read by the server before it answers. */
export async function addSource(
  src: IdeasSource,
  ideaId: string,
  input: SourceInput,
): Promise<SourceJson> {
  const ws = '/api/workspaces/' + src.workspaceId;
  let body: Record<string, unknown>;
  if (input.kind === 'file') {
    const up = await src.api.call<{ id: string }>(
      'POST',
      ws +
        '/files?name=' +
        encodeURIComponent(input.name) +
        '&projectId=' +
        encodeURIComponent(src.projectId),
      new RawBody(input.data, mimeOf(input.name)),
      120_000,
    );
    body = { kind: 'file', fileId: up.id };
  } else if (input.kind === 'link') {
    body = { kind: 'link', url: input.url, ...(input.title ? { title: input.title } : {}) };
  } else {
    body = {
      kind: input.saidBy ? 'quote' : 'text',
      body: input.body,
      ...(input.title ? { title: input.title } : {}),
      ...(input.saidBy ? { saidBy: input.saidBy } : {}),
    };
  }
  return src.api.call<SourceJson>('POST', ws + '/ideas/' + ideaId + '/sources', body, 60_000);
}

/** "S3 added to DEMO-I1: Call notes, 1.234 characters" */
export const addedText = (ref: string, x: SourceJson): string =>
  x.label +
  ' added to ' +
  ref +
  ': ' +
  (x.title || x.fileName || x.url || 'untitled') +
  ', ' +
  sourceState(x);
