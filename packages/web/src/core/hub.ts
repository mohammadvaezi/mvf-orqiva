// ── [PCODE-235 | S15 | v0.1.0] T23.2 Messages in the web app ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
//    Why:  the fan-out of live events to whichever page is open (moved out of workspace.tsx so every page
//          module can listen without importing the shell).
import type { ActivityEvent, ChatEvent } from '@orqiva/shared';

type Listener = (e: ActivityEvent) => void;
type ChatListener = (c: ChatEvent) => void;

export class EventHub {
  private readonly listeners = new Set<Listener>();
  // [PCODE-235 | S15 | v0.1.0] conversations arrive on their own path, never as activity
  private readonly chatListeners = new Set<ChatListener>();
  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(e: ActivityEvent): void {
    for (const l of this.listeners) l(e);
  }
  onChat(l: ChatListener): () => void {
    this.chatListeners.add(l);
    return () => this.chatListeners.delete(l);
  }
  emitChat(c: ChatEvent): void {
    for (const l of this.chatListeners) l(c);
  }
}

export const RESYNC = 'orqiva.workspace.resync';
