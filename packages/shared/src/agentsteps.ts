// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
//    Why:  one wording of an agent's steps for the web's trace, the VS Code Agents view and orq agent watch:
//          what the model called or said, that tools ran, what it asked a person and who decided.

export interface AgentStepLike {
  kind: string;
  content: Record<string, unknown>;
}

const txt = (v: unknown, dflt = ''): string => (typeof v === 'string' && v ? v : dflt);

/** One line for a step of an agent run. */
export function stepLabel(s: AgentStepLike): string {
  const blocks = Array.isArray(s.content['blocks'])
    ? (s.content['blocks'] as { type: string; name?: string; text?: string }[])
    : [];
  const tools = blocks.filter((b) => b.type === 'tool_use').map((b) => b.name ?? '');
  switch (s.kind) {
    case 'model':
      return tools.length
        ? 'model: calls ' + tools.join(', ')
        : 'model: ' + (blocks.find((b) => b.type === 'text')?.text ?? '').slice(0, 60);
    case 'tool_result':
      return 'tools ran';
    case 'approval':
      return 'asks a person: ' + txt(s.content['tool']);
    case 'decision':
      return (
        (s.content['approve'] === true ? 'approved by ' : 'declined by ') +
        txt(s.content['by'], 'a person')
      );
    case 'error':
      return 'error: ' + txt(s.content['message']);
    default:
      return txt(s.content['text'], s.kind);
  }
}

/** Whether a run is still going: queued, running, or waiting for a person. */
export const isActiveRunStatus = (status: string): boolean =>
  status === 'queued' || status === 'running' || status === 'waiting';
