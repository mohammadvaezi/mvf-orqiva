// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-46 | S09 | v0.1.0] Build the Version panel with current version, last tag, commits and bump buttons ──
// ── [PCODE-47 | S09 | v0.1.0] Generate the CHANGELOG.md section from Done items since the last tag ──
// ── [PCODE-48 | S09 | v0.1.0] Bump version via plane version bump with clean-worktree guard and tag check ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  host side of the Version panel: read the three version sources, push them to the webview, and
//          re-read whenever project.json or git's HEAD/tags move - a bump in a terminal must show up here.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Debounce } from '../../plan/planCheck';
import { changelogPreview, CHANGELOG_OFFLINE } from '../../release/bump';
import {
  dirtyWarning,
  readVersionInfo,
  tagLine,
  type BumpPart,
  type VersionInfo,
} from '../../release/version';
import type { Services } from '../../services';
import { redact } from '../../util/redact';
import { createPanel, type PanelHandle } from '../host';

export { CHANGELOG_OFFLINE };
import type { HostToVersion, VersionMessage, VersionToHost } from '../protocol';

export interface VersionPanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  /** [PCODE-48] performs the bump; resolves when the engine is done */
  onBump?: (part: BumpPart) => Promise<void>;
  today?: () => string;
}

// ── [PCODE-46 | S09 | v0.1.0] toMessage: the panel gets ready-made sentences, not three raw sources ──
export function toMessage(info: VersionInfo, changelog: string | null = null): VersionMessage {
  return {
    version: info.version,
    packageVersion: info.packageVersion,
    lastTag: info.lastTag,
    tagLine: tagLine(info),
    commits: info.commits.slice(0, 20).map((c) => ({ hash: c.hash, subject: c.subject })),
    commitsSinceTag: info.commitsSinceTag,
    mismatch: info.mismatch,
    dirtyWarning: dirtyWarning(info),
    changed: info.changed.slice(0, 10),
    next: info.next,
    // [PCODE-47 | S09 | v0.1.0] a bump writes the changelog, so no changelog means no bump
    canBump: info.canBump && changelog !== null,
    changelog,
    changelogNote: changelog === null ? CHANGELOG_OFFLINE : '',
  };
}

/** .git/HEAD and .git/refs/tags: VS Code's own watcher ignores .git, so this one is node's */
export function watchGit(root: string, onChange: () => void): { dispose(): void } {
  const watchers: fs.FSWatcher[] = [];
  for (const rel of [['.git'], ['.git', 'refs', 'tags']]) {
    const dir = path.join(root, ...rel);
    if (!fs.existsSync(dir)) continue;
    try {
      const w = fs.watch(dir, { persistent: false }, (_e, name) => {
        if (rel.length > 1 || typeof name !== 'string' || /^(HEAD|packed-refs)$/.test(name))
          onChange();
      });
      w.on('error', () => undefined);
      watchers.push(w);
    } catch {
      /* a repo without refs/tags yet is fine */
    }
  }
  return {
    dispose: () => {
      watchers.forEach((w) => {
        w.close();
      });
    },
  };
}

export async function openVersionPanel(
  deps: VersionPanelDeps,
): Promise<PanelHandle<VersionToHost, HostToVersion>> {
  const { context, services } = deps;
  const { handle, created } = createPanel<VersionToHost, HostToVersion>(context, {
    id: 'version',
    title: 'Version and release',
    entry: 'version',
    log: (l) => {
      services.log.warn(l);
    },
  });
  const push = async (): Promise<void> => {
    const root = services.root();
    const link = services.store.state.link;
    if (!root || !link) {
      await handle.post({
        type: 'version/error',
        message: 'Link this folder to an Orqiva project first.',
      });
      return;
    }
    const info = await readVersionInfo({ root, version: link.version });
    const today = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
    const preview = await changelogPreview(services, info, 'patch', root, today);
    await handle.post({ type: 'version/info', info: toMessage(info, preview) });
  };
  if (!created) {
    await push();
    return handle;
  }
  // [PCODE-46 | S09 | v0.1.0] project.json (store) and git (node watcher) both move the numbers
  const refresh = new Debounce(400, () => {
    void push().catch((e: unknown) => {
      services.log.error('version panel', e);
    });
  });
  const sub = services.store.onDidChange((keys) => {
    if (keys.includes('link')) refresh.schedule();
  });
  const gitWatch = watchGit(services.root() ?? '', () => {
    refresh.schedule();
  });
  handle.panel.onDidDispose(() => {
    sub.dispose();
    gitWatch.dispose();
    refresh.dispose();
  });
  handle.onMessage((m) => {
    void (async () => {
      if (m.type === 'version/refresh') return push();
      // version/bump (the last kind)
      await handle.post({ type: 'version/busy', busy: true, what: m.part });
      try {
        if (!deps.onBump) throw new Error('Bumping is not available.');
        await deps.onBump(m.part);
      } catch (e) {
        await handle.post({
          type: 'version/error',
          message: redact(e instanceof Error ? e.message : String(e)),
        });
      } finally {
        await handle.post({ type: 'version/busy', busy: false });
      }
      await push();
    })().catch((e: unknown) => {
      services.log.error('version panel', e);
    });
  });
  await push();
  return handle;
}
