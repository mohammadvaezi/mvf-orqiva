// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-42 | S08 | v0.1.0] Add the Generate code documentation command with progress and Docs tree entries ──
// ── [PCODE-43 | S08 | v0.1.0] Post the documentation link as a Plane comment on each task via plane note ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the button behind the generator: scan (cancellable, with progress), ask Plane what it knows about
//          the tasks that have code, write the pages, refresh the Docs view and offer the README. Nothing is
//          written before the whole set is rendered, so a cancelled run leaves the previous docs untouched.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { generateDocs, type GenerateResult } from '../docs/generate';
import { commentKind, type TaskDetail } from '../docs/model';
import { scanProject } from '../docs/scan';
import { changedTaskPages, postNotes, readDocsIndex, writeDocsIndex } from '../docs/notes';
import type { Services } from '../services';
import { splitAcceptance } from '../webviews/taskDetail/data';
import { htmlToText } from '../util/sanitize';
import { info, showError } from './notify';

export const OUTPUT_SETTING = 'docs.outputFolder';
export const DEFAULT_OUTPUT = 'docs/generated';
/** above this many documented tasks the comment history is skipped: one request per task is too many */
export const COMMENT_LIMIT = 20;
export const POST_SETTING = 'docs.postToPlane';

// ── [PCODE-42 | S08 | v0.1.0] outputFolder: the setting, kept inside the project ──
export function normalizeOutputFolder(value: string | undefined): string {
  const raw = (value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || raw.split('/').includes('..'))
    return DEFAULT_OUTPUT;
  return raw;
}

export function outputFolder(): string {
  return normalizeOutputFolder(
    vscode.workspace.getConfiguration('orqiva').get<string>(OUTPUT_SETTING, DEFAULT_OUTPUT),
  );
}

// ── [PCODE-42 | S08 | v0.1.0] collectDetails: one issues/states/labels round trip, comments only for a small board ──
export async function collectDetails(
  services: Pick<Services, 'client' | 'store' | 'secrets' | 'log'>,
  refs: readonly string[],
): Promise<Map<string, TaskDetail>> {
  const details = new Map<string, TaskDetail>();
  const link = services.store.state.link;
  if (!link || !(await services.secrets.hasApiKey())) return details;
  try {
    // the board already carries state, priority and labels; only description, acceptance and the
    // comments have to come from Plane
    const issues = await services.client.getIssues(link.project_id);
    const wanted = new Set(refs);
    const mine = issues.filter((i) => wanted.has(`${link.identifier}-${String(i.sequence_id)}`));
    for (const issue of mine) {
      const ref = `${link.identifier}-${String(issue.sequence_id)}`;
      const { body, acceptance } = splitAcceptance(issue.description_html ?? '');
      details.set(ref, {
        description: htmlToText(body).trim(),
        acceptance,
        url: services.client.webUrl(link.project_id, issue.id),
      });
    }
    if (mine.length <= COMMENT_LIMIT) {
      for (const issue of mine) {
        const ref = `${link.identifier}-${String(issue.sequence_id)}`;
        const entry = details.get(ref);
        if (!entry) continue;
        const comments = await services.client.getComments(link.project_id, issue.id);
        entry.comments = [...comments]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((c) => {
            const text = htmlToText(c.comment_html).trim();
            return {
              date: c.created_at.slice(0, 10),
              kind: commentKind(text),
              text,
              ...(c.actor_detail?.display_name ? { who: c.actor_detail.display_name } : {}),
            };
          });
      }
    } else {
      services.log.info(
        `documentation: ${String(mine.length)} documented tasks - comment history skipped (limit ${String(COMMENT_LIMIT)})`,
      );
    }
  } catch (e) {
    services.log.warn(
      `documentation: task details unavailable (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  return details;
}

export function postToPlane(): boolean {
  return vscode.workspace.getConfiguration('orqiva').get<boolean>(POST_SETTING, true);
}

export interface GenerateDeps {
  services: Services;
  /** injected for tests */
  postNotes?: typeof postNotes;
  wait?: (ms: number) => Promise<void>;
  /** the Docs view, refreshed once the pages are on disk */
  onGenerated?: (result: GenerateResult) => void;
  progress?: <T>(
    title: string,
    fn: (report: (message: string) => void, token: vscode.CancellationToken) => Promise<T>,
  ) => Promise<T>;
  today?: () => string;
}

const defaultProgress = <T>(
  title: string,
  fn: (report: (message: string) => void, token: vscode.CancellationToken) => Promise<T>,
): Promise<T> =>
  Promise.resolve(
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (progress, token) =>
        fn((message) => {
          progress.report({ message });
        }, token),
    ),
  );

/** read through a function: TS narrows a token's flag across an await, the user does not */
function cancelled(token: vscode.CancellationToken): boolean {
  return token.isCancellationRequested;
}

export function summaryOf(result: GenerateResult): string {
  const notes = result.notes?.posted.length
    ? `, ${String(result.notes.posted.length)} note(s) posted`
    : '';
  return `Documentation generated: ${String(result.model.sprints.length)} sprints, ${String(result.model.tasks.length)} tasks (${String(result.written.length)} page(s) written${notes}).`;
}

// ── [PCODE-42 | S08 | v0.1.0] generateDocumentation: scan -> Plane details -> pages; cancelled = nothing written ──
export async function generateDocumentation(
  deps: GenerateDeps,
): Promise<GenerateResult | undefined> {
  const { services } = deps;
  const root = services.root();
  const link = services.store.state.link;
  if (!root || !link) {
    info('Link this folder to an Orqiva project first.');
    return undefined;
  }
  const folder = outputFolder();
  const today = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
  return (deps.progress ?? defaultProgress)(
    'Orqiva: generating code documentation',
    async (report, token) => {
      report('scanning the workspace…');
      const index = await scanProject(root, {
        cancel: token,
        onProgress: (p) => {
          report(
            `scanning ${String(p.files)}/${String(p.total)} files — ${String(p.hits)} fingerprints`,
          );
        },
      });
      if (cancelled(token)) {
        services.log.info('documentation cancelled during the scan; nothing was written');
        return undefined;
      }
      report('asking about the tasks…');
      const details = await collectDetails(services, [...index.byTask.keys()]);
      if (cancelled(token)) {
        services.log.info('documentation cancelled before writing; nothing was written');
        return undefined;
      }
      report('writing the pages…');
      const result = generateDocs(
        {
          index,
          board: services.store.state.sprints,
          project: {
            name: link.name,
            identifier: link.identifier,
            version: link.version,
          },
          details,
          generatedAt: today,
        },
        { outDir: path.join(root, ...folder.split('/')), outFolder: folder },
      );
      services.log.info(
        `documentation: ${String(result.written.length)} written, ${String(result.unchanged.length)} unchanged, ${String(result.removed.length)} removed in ${folder}`,
      );
      deps.onGenerated?.(result);
      // [PCODE-43 | S08 | v0.1.0] one Plane note per task page that really changed, then record the hashes
      const outDir = path.join(root, ...folder.split('/'));
      const previous = readDocsIndex(outDir);
      const changes = changedTaskPages(result.pages, previous);
      const notes = await (deps.postNotes ?? postNotes)(changes, {
        engine: services.engine,
        outFolder: folder,
        version: link.version,
        date: today,
        enabled: postToPlane(),
        confirm: (count) =>
          Promise.resolve(
            vscode.window.showWarningMessage(
              `Post ${String(count)} documentation notes? One comment per changed task page.`,
              { modal: true },
              'Post notes',
            ),
          ).then((pick) => pick === 'Post notes'),
        ...(deps.wait ? { wait: deps.wait } : {}),
        log: (l) => {
          services.log.warn(l);
        },
      });
      if (notes.posted.length || notes.failed.length)
        services.log.info(
          `documentation notes: ${String(notes.posted.length)} posted, ${String(notes.failed.length)} failed`,
        );
      writeDocsIndex(outDir, result.pages, { version: link.version, generatedAt: today });
      result.notes = notes;
      return result;
    },
  );
}

export function registerDocsCommands(
  context: vscode.ExtensionContext,
  services: Services,
  onGenerated?: (result: GenerateResult) => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.generateDocs', async () => {
      try {
        const result = await generateDocumentation({
          services,
          ...(onGenerated ? { onGenerated } : {}),
        });
        if (!result) return;
        // [PCODE-44 | S08 | v0.1.0] the toast is not awaited: the command is finished once the pages are
        // written, and a notification nobody clicks must not keep it running
        const OPEN = 'Open README';
        void Promise.resolve(vscode.window.showInformationMessage(summaryOf(result), OPEN)).then(
          (pick) =>
            pick === OPEN
              ? vscode.commands.executeCommand(
                  'markdown.showPreview',
                  vscode.Uri.file(path.join(result.outDir, 'README.md')),
                )
              : undefined,
          () => undefined,
        );
      } catch (e) {
        await showError('Generate documentation', e, services.log);
      }
    }),
  );
}
