// ── [PCODE-201 | S15 | v0.1.0] T16.5 Docs and handover from the terminal and VS Code: orq docs scan/build/drift, orq handover ──
//    Why:  from the editor, the pages built from the code are rebuilt in one command, and the handover's
//          state is one quick pick away: each check with what it found, the team checklist (picking an item
//          ticks or unticks it), and sending the pack once nothing required is missing.
import type { Api } from '../../../cli/src/loop/api';

export interface HandoverSource {
  api: Api;
  workspaceId: string;
  projectId: string;
}

export interface HandoverJson {
  checks: { key: string; label: string; state: string; detail: string }[];
  ready: boolean;
  items: { id: string; label: string; done: boolean }[];
  client: string | null;
  packs: { number: number; status: string; signedName: string; decisionNote: string }[];
}

export type HandoverPick =
  | { label: string; description: string; detail?: string; action: 'none' }
  | { label: string; description: string; action: 'toggle'; itemId: string; done: boolean }
  | { label: string; description: string; action: 'send' };

const ICON: Record<string, string> = { ok: '$(check)', warn: '$(warning)', missing: '$(error)' };

/** The quick pick of the handover: send (when ready), the checks, then the checklist to tick. */
export function handoverPicks(h: HandoverJson): HandoverPick[] {
  const next = (h.packs[0]?.number ?? 0) + 1;
  const out: HandoverPick[] = [];
  if (h.ready)
    out.push({
      label: '$(mail) Send handover pack ' + String(next),
      description: 'to ' + (h.client ?? 'the client') + ', frozen as it is now',
      action: 'send',
    });
  for (const c of h.checks.filter((x) => !x.key.startsWith('item:')))
    out.push({
      label: (ICON[c.state] ?? '') + ' ' + c.label,
      description: c.detail,
      action: 'none',
    });
  for (const i of h.items)
    out.push({
      label: (i.done ? '$(pass-filled) ' : '$(circle-large-outline) ') + i.label,
      description: i.done ? 'done · pick to untick' : 'pick to tick',
      action: 'toggle',
      itemId: i.id,
      done: i.done,
    });
  return out;
}

/** One line on where the handover stands, for the pick's title. */
export function handoverTitle(h: HandoverJson): string {
  const missing = h.checks.filter((c) => c.state === 'missing').length;
  const last = h.packs[0];
  return (
    (h.ready ? 'Ready to hand over' : String(missing) + ' missing before the handover') +
    (last
      ? ' · pack ' +
        String(last.number) +
        ' ' +
        (last.status === 'accepted'
          ? 'accepted by ' + last.signedName
          : last.status === 'changes_requested'
            ? 'needs changes'
            : last.status === 'sent'
              ? 'waits for the client'
              : last.status)
      : '')
  );
}

const P = (s: HandoverSource): string =>
  '/api/workspaces/' + s.workspaceId + '/projects/' + s.projectId;

export const handoverOf = (s: HandoverSource): Promise<HandoverJson> =>
  s.api.call<HandoverJson>('GET', P(s) + '/handover');

export const toggleItem = (s: HandoverSource, itemId: string, done: boolean): Promise<unknown> =>
  s.api.call('PATCH', '/api/workspaces/' + s.workspaceId + '/handover-items/' + itemId, {
    done: !done,
  });

export async function sendPack(s: HandoverSource, note: string): Promise<number> {
  const r = await s.api.call<{ pack: { number: number } }>(
    'POST',
    P(s) + '/handover/packs',
    note.trim() ? { note: note.trim() } : {},
  );
  return r.pack.number;
}

/** Rebuilds the pages built from the code and says what changed. */
export async function rebuildDocs(s: HandoverSource): Promise<string> {
  const r = await s.api.call<{
    created: number;
    updated: number;
    unchanged: number;
    removed: number;
  }>('POST', P(s) + '/docs/from-code');
  if (!r.created && !r.updated && !r.unchanged)
    return 'Nothing to build yet: run orq docs scan in the terminal first.';
  return (
    'Docs from code rebuilt: ' +
    [
      r.created ? String(r.created) + ' new' : '',
      r.updated ? String(r.updated) + ' changed' : '',
      r.unchanged ? String(r.unchanged) + ' unchanged' : '',
      r.removed ? String(r.removed) + ' removed' : '',
    ]
      .filter(Boolean)
      .join(', ')
  );
}
