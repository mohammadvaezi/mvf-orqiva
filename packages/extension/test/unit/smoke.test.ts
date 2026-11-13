// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-3 | S01 | v0.1.0] Add the vitest unit runner with a vscode API mock ──
//    Why:  proves a module importing 'vscode' runs under vitest through the alias, using the mock's recorder.
import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { recorded, resetRecorded } from '../mocks/vscode';

describe('vscode mock', () => {
  beforeEach(() => {
    resetRecorded();
  });

  // ── [PCODE-3 | S01 | v0.1.0] an output channel created through the alias is recorded ──
  it('records output channel lines', () => {
    const ch = vscode.window.createOutputChannel('Orqiva');
    ch.appendLine('hello');
    expect(recorded.outputs).toHaveLength(1);
    expect(recorded.outputs[0]?.name).toBe('Orqiva');
    expect(recorded.outputs[0]?.lines).toEqual(['hello']);
  });

  // ── [PCODE-3 | S01 | v0.1.0] messages and configuration are observable ──
  it('records messages and serves configuration', async () => {
    recorded.configuration.set('orqiva.plane.baseUrl', 'https://example.test');
    const cfg = vscode.workspace.getConfiguration('orqiva');
    expect(cfg.get<string>('plane.baseUrl')).toBe('https://example.test');
    await vscode.window.showInformationMessage('hi');
    expect(recorded.infoMessages).toEqual(['hi']);
  });
});
