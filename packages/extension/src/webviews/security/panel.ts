// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-60 | S12 | v0.1.0] Add the security checklist template and a panel with persistent checkboxes ──
// ── [PCODE-66 | S13 | v0.1.0] Add npm audit and secret scan runners wired to the security checklist ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  host side of the security panel. A tick is written to .plane/security.md the moment it is made -
//          there is no Save button to forget - and the file stays the single source, so the same tick shows
//          up in the Docs tree, in a review and on the next machine.
import * as vscode from 'vscode';
import {
  checklistPath,
  ensureChecklist,
  parseChecklist,
  progressLine,
  readChecklist,
  writeToggle,
  type Checklist,
} from '../../security/checklist';
import { CHECKS, runCheck, type CheckId, type CheckResult } from '../../security/runChecks';
import type { Services } from '../../services';
import { createPanel, type PanelHandle } from '../host';
import type { HostToSecurity, SecurityMessage, SecurityToHost } from '../protocol';

export interface SecurityPanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  /** the Docs view, so its '12/34' follows a tick */
  onChanged?: () => void;
}

export function toMessage(
  list: Checklist,
  file: string,
  checks: CheckResult[] = [],
  busy: string | null = null,
): SecurityMessage {
  return {
    sections: list.sections.map((s) => ({
      title: s.title,
      items: s.items.map((i) => ({
        index: i.index,
        text: i.text,
        checked: i.checked,
        hint: i.hint,
        note: i.note,
      })),
    })),
    progress: progressLine(list),
    checked: list.checked,
    total: list.total,
    file,
    // [PCODE-66 | S13 | v0.1.0] the checks as the panel lists them, run or not
    checks: CHECKS.filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i).map((c) => {
      const ran = checks.find((r) => r.id === c.id);
      return {
        id: c.id,
        label: c.label,
        summary: ran?.summary ?? '',
        ...(ran?.unavailable ? { unavailable: ran.unavailable } : {}),
        ...(ran?.findings ? { findings: ran.findings } : {}),
      };
    }),
    busy,
  };
}

export async function openSecurityPanel(
  deps: SecurityPanelDeps,
): Promise<PanelHandle<SecurityToHost, HostToSecurity>> {
  const { context, services } = deps;
  const { handle, created } = createPanel<SecurityToHost, HostToSecurity>(context, {
    id: 'security',
    title: 'Security checklist',
    entry: 'security',
    log: (l) => {
      services.log.warn(l);
    },
  });
  // [PCODE-66 | S13 | v0.1.0] what each check last reported, for as long as the panel is open
  const results: CheckResult[] = [];
  let busy: string | null = null;

  const push = async (): Promise<void> => {
    const root = services.root();
    if (!root) {
      await handle.post({
        type: 'security/error',
        message: 'Link this folder to an Orqiva project first.',
      });
      return;
    }
    // [PCODE-60 | S12 | v0.1.0] the first open writes the template; a later one never overwrites it
    const ensured = ensureChecklist({ root, extensionPath: context.extensionPath });
    if (ensured.created) services.log.info(`security checklist created at ${checklistPath(root)}`);
    const list = readChecklist(root) ?? parseChecklist(ensured.text);
    await handle.post({
      type: 'security/state',
      state: toMessage(list, checklistPath(root), results, busy),
    });
  };
  if (!created) {
    await push();
    return handle;
  }
  handle.onMessage((m) => {
    void (async () => {
      const root = services.root();
      if (!root) return;
      if (m.type === 'security/refresh') {
        await push();
        return;
      }
      if (m.type === 'security/open') {
        const doc = await vscode.workspace.openTextDocument(checklistPath(root));
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }
      if (m.type === 'security/run') {
        // [PCODE-66 | S13 | v0.1.0] one check at a time; npm audit reaches the network and takes seconds
        if (busy) return;
        busy = m.check;
        await push();
        try {
          const loc = await services.location();
          const result = await runCheck(m.check as CheckId, {
            root,
            ...(loc.python.length ? { python: loc.python } : {}),
          });
          const at = results.findIndex((r) => r.id === result.id);
          if (at >= 0) results[at] = result;
          else results.push(result);
          services.log.info(
            `security check ${result.label}: ${result.summary || (result.unavailable ?? '')}`,
          );
        } finally {
          busy = null;
          await push();
          deps.onChanged?.();
        }
        return;
      }
      // security/toggle (the last kind)
      const list = writeToggle(root, m.index, m.checked);
      if (list) {
        await handle.post({
          type: 'security/state',
          state: toMessage(list, checklistPath(root), results, busy),
        });
        deps.onChanged?.();
      }
    })().catch((e: unknown) => {
      services.log.error('security panel', e);
    });
  });
  await push();
  return handle;
}
