// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  Chrome and Firefox share the extension APIs this needs (Firefox also answers to chrome.*);
//          one small typed view of them, promise-based in Manifest V3 in both, so no type package is needed.

export interface Tab {
  id?: number;
  url?: string;
  title?: string;
  windowId?: number;
}

type Listener = (
  message: unknown,
  sender: { tab?: Tab },
  reply: (answer: unknown) => void,
) => boolean | undefined;

export interface Ext {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: { addListener(fn: Listener): void };
    getURL(path: string): string;
    openOptionsPage(): Promise<void>;
  };
  tabs: {
    query(q: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    get(tabId: number): Promise<Tab>;
    captureVisibleTab(windowId: number | undefined, options: { format: 'png' }): Promise<string>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    create(o: { url: string }): Promise<Tab>;
  };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
  };
}

const g = globalThis as { browser?: Ext; chrome?: Ext };
export const ext: Ext = (g.browser ?? g.chrome) as Ext;
