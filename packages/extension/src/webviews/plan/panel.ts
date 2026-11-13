// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
// ── [PCODE-31 | S06 | v0.1.0] Build the plan panel: description status, Draft, Check and Publish ──
// ── [PCODE-32 | S06 | v0.1.0] Run Draft plan in the integrated terminal with the planning prompt ──
// ── [PCODE-33 | S06 | v0.1.0] Validate plan.json with plane_plan.py check and show errors before Publish ──
// ── [PCODE-34 | S06 | v0.1.0] Publish the plan with confirmation, single-flight guard and result summary ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  host side of the plan panel. Status comes from PlanService; Open description opens (and, when the
//          scaffold is missing, creates) .plane/description/description.md; Draft and Publish are handed to
//          the extension (PCODE-32 / PCODE-34), so this file never spawns Claude or writes to Plane itself.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Debounce, locateInPlan, parseCheckError } from '../../plan/planCheck';
import { resultMessage, type PublishResult } from '../../plan/publish';
import {
  PlanService,
  TEMPLATE_MARKER,
  descriptionPath,
  toStatusMessage,
} from '../../plan/planService';
import type { Services } from '../../services';
import { planePath } from '../../state/files';
import { redact } from '../../util/redact';
import { createPanel, type PanelHandle } from '../host';
import type { HostToPlan, PlanToHost } from '../protocol';

export interface PlanPanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  /** [PCODE-32 | S06 | v0.1.0] opens the planning terminal; `closed` settles when it is closed */
  onDraft?: () => Promise<{ closed: Promise<void> }>;
  /** [PCODE-34 | S06 | v0.1.0] publishes (check, confirm, engine); undefined = cancelled */
  onPublish?: () => Promise<PublishResult | undefined>;
  planService?: PlanService;
}

export const DESCRIPTION_TEMPLATE = `# Project description

${TEMPLATE_MARKER}. Plain language is fine. The planning run reads every file in this folder.

## What it is

## Who uses it

## Must have

## Nice to have

## Constraints (stack, hosting, legal, deadlines)
`;

// ── [PCODE-31 | S06 | v0.1.0] openDescription: the scaffold's file, created from the template when absent ──
export async function openDescription(root: string): Promise<vscode.TextEditor> {
  const file = descriptionPath(root);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, DESCRIPTION_TEMPLATE, 'utf8');
  }
  const doc = await vscode.workspace.openTextDocument(file);
  return vscode.window.showTextDocument(doc, { preview: false });
}

export async function openPlanPanel(
  deps: PlanPanelDeps,
): Promise<PanelHandle<PlanToHost, HostToPlan>> {
  const { context, services } = deps;
  const plan = deps.planService ?? new PlanService(services);
  const { handle, created } = createPanel<PlanToHost, HostToPlan>(context, {
    id: 'plan',
    title: 'Plan the project',
    entry: 'plan',
    log: (l) => {
      services.log.warn(l);
    },
  });
  let lastErrors: string[] = [];
  const push = async (withCheck: boolean): Promise<void> => {
    if (!withCheck) {
      await handle.post({ type: 'plan/status', status: toStatusMessage(plan.filesOnly()) });
      return;
    }
    await handle.post({ type: 'plan/busy', busy: true, what: 'check' });
    try {
      const status = toStatusMessage(await plan.status());
      lastErrors = status.errors;
      await handle.post({ type: 'plan/status', status });
    } finally {
      await handle.post({ type: 'plan/busy', busy: false });
    }
  };
  if (!created) {
    await push(true);
    return handle;
  }
  // [PCODE-33 | S06 | v0.1.0] plan.json edited (store watcher, 250 ms) -> one re-check after 750 ms of quiet
  const recheck = new Debounce(750, () => {
    void push(true).catch((e: unknown) => {
      services.log.error('plan re-check', e);
    });
  });
  const sub = services.store.onDidChange((keys) => {
    if (keys.includes('plan')) recheck.schedule();
  });
  handle.panel.onDidDispose(() => {
    sub.dispose();
    recheck.dispose();
  });
  const openError = async (index: number): Promise<void> => {
    const root = services.root();
    const raw = lastErrors[index];
    if (!root || raw === undefined) return;
    const file = planePath(root, 'plan');
    if (!fs.existsSync(file)) return;
    const line = locateInPlan(fs.readFileSync(file, 'utf8'), parseCheckError(raw));
    const doc = await vscode.workspace.openTextDocument(file);
    const pos = new vscode.Position(Math.max(0, (line ?? 1) - 1), 0);
    await vscode.window.showTextDocument(doc, {
      preview: false,
      selection: new vscode.Range(pos, pos),
    });
  };
  const guarded = async (what: string, fn: () => Promise<void>): Promise<void> => {
    await handle.post({ type: 'plan/busy', busy: true, what });
    try {
      await fn();
    } catch (e) {
      await handle.post({
        type: 'plan/error',
        message: redact(e instanceof Error ? e.message : String(e)),
      });
    } finally {
      await handle.post({ type: 'plan/busy', busy: false });
    }
  };
  handle.onMessage((m) => {
    void (async () => {
      if (m.type === 'plan/refresh') return push(true);
      if (m.type === 'plan/check') return push(true);
      if (m.type === 'plan/openDescription') {
        const root = services.root();
        if (root) await openDescription(root);
        return;
      }
      if (m.type === 'plan/openError') return openError(m.index);
      if (m.type === 'plan/openPlan') {
        const root = services.root();
        if (!root) return;
        const file = planePath(root, 'plan');
        if (fs.existsSync(file))
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), {
            preview: false,
          });
        return;
      }
      if (m.type === 'plan/draft') {
        // [PCODE-32 | S06 | v0.1.0] the panel stays usable while Claude plans; the check re-runs on close
        await guarded('draft', async () => {
          if (!deps.onDraft) throw new Error('Draft plan is not available.');
          const r = await deps.onDraft();
          await handle.post({
            type: 'plan/info',
            message:
              'Claude Code is planning in the terminal. When it has finished, close the terminal - the plan is checked again.',
          });
          void r.closed
            .then(() => push(true))
            .catch((e: unknown) => {
              services.log.error('plan re-check', e);
            });
        });
        return push(false);
      }
      // plan/publish (the last message kind) - [PCODE-34 | S06 | v0.1.0] result summary with Open board
      await guarded('publish', async () => {
        if (!deps.onPublish) throw new Error('Publish plan is not available.');
        const r = await deps.onPublish();
        if (!r) return;
        await handle.post({ type: 'plan/info', message: resultMessage(r) });
        const OPEN = 'Open board';
        const pick = await vscode.window.showInformationMessage(
          resultMessage(r),
          ...(r.board ? [OPEN] : []),
        );
        if (pick === OPEN && r.board) await vscode.env.openExternal(vscode.Uri.parse(r.board));
      });
      return push(true);
    })().catch((e: unknown) => {
      services.log.error('plan panel', e);
    });
  });
  await push(true);
  return handle;
}
