// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-73 | S03 | v0.1.0] Support VS Code workspace trust: limited mode until the folder is trusted ──
//    Why:  the gate refuses while untrusted, passes when trusted, and the manifest declares limited support.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startDevelopment } from '../../src/commands/devCommands';
import type { Services } from '../../src/services';
import { OrqivaError } from '../../src/util/errors';
import { isTrusted, requireTrust, TRUST_MESSAGE } from '../../src/util/trust';
import { recorded, resetRecorded } from '../mocks/vscode';

describe('workspace trust', () => {
  it('requireTrust throws a config error while untrusted and passes when trusted', () => {
    expect(() => {
      requireTrust({ isTrusted: false });
    }).toThrow(OrqivaError);
    expect(() => {
      requireTrust({ isTrusted: false });
    }).toThrow(/Trust this folder to run the engine/);
    expect(() => {
      requireTrust({ isTrusted: true });
    }).not.toThrow();
    expect(isTrusted({ isTrusted: true })).toBe(true);
  });

  // ── [PCODE-73 | S03 | v0.1.0] Start development refuses without trust and opens no terminal ──
  it('startDevelopment answers with the trust message instead of opening a terminal', async () => {
    resetRecorded();
    recorded.workspaceTrusted = false;
    const created: unknown[] = [];
    const services = {
      root: () => 'C:\\proj',
      secrets: { envForEngine: () => Promise.resolve({}) },
      location: () => Promise.resolve({ home: '', python: [], versions: {}, problems: [] }),
    } as unknown as Services;
    const r = await startDevelopment({
      services,
      host: {
        terminals: [],
        createTerminal: (o) => {
          created.push(o);
          return { name: o.name, sendText: () => undefined, show: () => undefined };
        },
      },
    });
    expect(r).toBeUndefined();
    expect(created).toEqual([]);
    expect(recorded.infoMessages.at(-1)).toBe(TRUST_MESSAGE);
    recorded.workspaceTrusted = true;
  });

  it('package.json declares limited untrusted-workspace support with a description', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as {
      capabilities: { untrustedWorkspaces: { supported: string; description: string } };
    };
    expect(pkg.capabilities.untrustedWorkspaces.supported).toBe('limited');
    expect(pkg.capabilities.untrustedWorkspaces.description.length).toBeGreaterThan(20);
  });
});
