// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
//    Why:  the team's activity as sentences: who did what on which task, newest first. It keeps the last
//          100 events by sequence, so the history the feed opens with and the live stream that follows can
//          overlap without showing anything twice. People, agents and the platform are told apart, because
//          an agent's work should never pass for a person's. Free of vscode; the view draws it.
import type { ActivityEvent, ActorKind } from '@orqiva/shared';

export const FEED_SIZE = 100;

export interface FeedEntry {
  sequence: number;
  /** the sentence, e.g. "Ada moved APP-3 Export → Review" */
  text: string;
  actor: string;
  actorKind: ActorKind;
  /** "14:02", or "2 Oct 14:02" when not today */
  when: string;
  /** the item to open, if the event is about one */
  itemId: string | null;
}

export { describe, itemOf, whenText } from '@orqiva/shared';
import { describe, inFeed, itemOf, whenText } from '@orqiva/shared';

export class ActivityFeed {
  private events = new Map<number, ActivityEvent>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /** The history the feed opens with; replaces what was there. */
  reset(events: readonly ActivityEvent[]): void {
    this.events = new Map();
    this.put(events);
  }

  add(event: ActivityEvent): void {
    this.put([event]);
  }

  clear(): void {
    this.events.clear();
    this.emit();
  }

  private put(all: readonly ActivityEvent[]): void {
    // [PCODE-122 | S15 | v0.1.0] an agent's single steps stay on its run page
    const events = all.filter(inFeed);
    for (const e of events) this.events.set(e.sequence, e);
    const keep = [...this.events.keys()].sort((a, b) => b - a).slice(0, FEED_SIZE);
    if (keep.length < this.events.size) {
      const kept = new Set(keep);
      for (const k of [...this.events.keys()]) if (!kept.has(k)) this.events.delete(k);
    }
    this.emit();
  }

  /** Newest first. */
  entries(): FeedEntry[] {
    const now = this.now();
    return [...this.events.values()]
      .sort((a, b) => b.sequence - a.sequence)
      .map((e) => ({
        sequence: e.sequence,
        text: describe(e),
        actor: e.data.actor.name ?? '',
        actorKind: e.data.actor.kind,
        when: whenText(e.time, now),
        itemId: itemOf(e),
      }));
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
