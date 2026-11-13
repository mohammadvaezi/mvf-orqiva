// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
//    Why:  a computer signed in to an Orqiva server (orq login or Orqiva: Sign in) is ready and connected:
//          the server is where the tasks live, so neither the Python engine nor a Plane key is asked for.
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-25 | S05 | v0.1.0] Add the Welcome view variants for no engine, no key and no linked project ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  three context keys drive which welcome the Sprints view shows (and which commands are enabled):
//          orqiva.engineFound, orqiva.connected, orqiva.linked. Computed here, set on activation and
//          whenever the store, the secrets or the engine location change.
// ── [PCODE-64 | S12 | v0.1.0] Add the Get Started walkthrough content and smoke checklist for Sprint 12 ──
//    Why:  three more keys exist only for the walkthrough: planned, developing, released. A step that
//          completes on onCommand ticks when the panel is merely *opened*, which is a lie - the Plan panel
//          can be opened and nothing published. These keys are the state each step claims, read from the
//          same files the rest of the extension reads.
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CHANGELOG_FILE } from '../release/changelog';
import { signedIn } from '../server/account';
import type { Services } from '../services';

export interface WelcomeInputs {
  engineFound: boolean;
  connected: boolean;
  linked: boolean;
  /** a plan has been published to Plane */
  planned?: boolean;
  /** a task is active in this folder */
  developing?: boolean;
  /** a version has been released from here (the CHANGELOG a bump writes) */
  released?: boolean;
}

export type WelcomeVariant = 'setup' | 'connect' | 'link' | 'board';

export interface ContextKeys {
  'orqiva.engineFound': boolean;
  'orqiva.connected': boolean;
  'orqiva.linked': boolean;
  'orqiva.planned': boolean;
  'orqiva.developing': boolean;
  'orqiva.released': boolean;
  'orqiva.welcome': WelcomeVariant;
}

// ── [PCODE-64 | S12 | v0.1.0] hasRelease: the CHANGELOG a bump writes, in the project root ──
export function hasRelease(
  root: string | null,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): boolean {
  return root !== null && exists(path.join(root, CHANGELOG_FILE));
}

// ── [PCODE-25 | S05 | v0.1.0] computeContextKeys: pure; the first missing prerequisite wins ──
export function computeContextKeys(i: WelcomeInputs): ContextKeys {
  const variant: WelcomeVariant = !i.engineFound
    ? 'setup'
    : !i.connected
      ? 'connect'
      : !i.linked
        ? 'link'
        : 'board';
  return {
    'orqiva.engineFound': i.engineFound,
    'orqiva.connected': i.connected,
    'orqiva.linked': i.linked,
    'orqiva.planned': i.planned ?? false,
    'orqiva.developing': i.developing ?? false,
    'orqiva.released': i.released ?? false,
    'orqiva.welcome': variant,
  };
}

// ── [PCODE-25 | S05 | v0.1.0] WelcomeState: reads the inputs from the services and pushes the keys to VS Code ──
export class WelcomeState implements vscode.Disposable {
  private last: ContextKeys | null = null;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly services: Services,
    private readonly setContext: (key: string, value: unknown) => Thenable<unknown> = (k, v) =>
      vscode.commands.executeCommand('setContext', k, v),
    private readonly home: () => string = homedir, // [PCODE-453 | S15 | v0.1.0] test seam
  ) {
    this.subs.push(
      services.store.onDidChange((keys) => {
        // [PCODE-64 | S12 | v0.1.0] the walkthrough keys follow the active task and the published plan too
        if (keys.includes('link') || keys.includes('active') || keys.includes('published'))
          void this.refresh();
      }),
    );
  }

  get current(): ContextKeys | null {
    return this.last;
  }

  async refresh(): Promise<ContextKeys> {
    const [loc, connected] = await Promise.all([
      this.services.location(),
      this.services.secrets.hasApiKey(),
    ]);
    const state = this.services.store.state;
    // [PCODE-453 | S15 | v0.1.0] signed in to Orqiva, or a folder already on an Orqiva server; the
    // engine is asked for only on a computer that still uses a Plane key
    const onOrqiva = signedIn(this.home()) !== null || Boolean(state.link?.server);
    const keys = computeContextKeys({
      engineFound: onOrqiva || !connected || (Boolean(loc.home) && loc.python.length > 0),
      connected: onOrqiva || connected,
      linked: state.link !== null,
      // [PCODE-64 | S12 | v0.1.0] the walkthrough's three: published, working, released
      planned: state.published !== null,
      developing: state.active !== null,
      released: hasRelease(state.root),
    });
    if (JSON.stringify(keys) !== JSON.stringify(this.last)) {
      this.last = keys;
      for (const [k, v] of Object.entries(keys)) await this.setContext(k, v);
    }
    return keys;
  }

  dispose(): void {
    this.subs.forEach((s) => {
      s.dispose();
    });
  }
}
