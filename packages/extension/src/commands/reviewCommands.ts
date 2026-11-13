// ── [PCODE-311 | S15 | v0.1.0] T31.9b Code review in VS Code: the queue, the diff and line comments ──
//    Why:  reviewing without leaving the editor. "Review pull requests" opens the queue; a pull request
//          lists its files (viewed or not) and the review actions; a file opens as a diff whose lines carry
//          the comments through VS Code's own comment threads. A comment written here is a draft, posted to
//          the host only with the review submitted at the end; the AI's suggestions are accepted (they
//          become the reviewer's drafts) or dismissed on the line.
import * as vscode from 'vscode';
import {
  addComment,
  commentLabel,
  decide,
  deleteComment,
  fileLabel,
  filesOf,
  markViewed,
  queueLabel,
  queueOf,
  shownOn,
  sidesOf,
  submitReview,
  submitSummary,
  suggest,
  threadOf,
  type Decision,
  type PullFiles,
  type ReviewComment,
  type ReviewSource,
  type Sides,
  type Thread,
} from '../server/review';
import { info } from './notify';

export const REVIEW_SCHEME = 'orqiva-review';

interface Opened {
  pull: PullFiles;
  path: string;
  side: 'old' | 'new';
  sides: Sides;
}

/** orqiva-review:/<pull id>/<side>/<path>: one side of a changed file. */
const uriOf = (pull: PullFiles, side: 'old' | 'new', path: string): vscode.Uri =>
  vscode.Uri.from({ scheme: REVIEW_SCHEME, path: '/' + pull.id + '/' + side + '/' + path });

class ReviewComment_ implements vscode.Comment {
  body: vscode.MarkdownString;
  mode = vscode.CommentMode.Preview;
  author: vscode.CommentAuthorInformation;
  contextValue: string;
  constructor(readonly data: ReviewComment) {
    this.body = new vscode.MarkdownString(data.body);
    this.author = { name: commentLabel(data) };
    this.contextValue =
      data.state === 'suggested'
        ? 'suggested'
        : data.state === 'draft' && data.mine
          ? 'draft'
          : 'posted';
  }
}

export function registerReview(
  context: vscode.ExtensionContext,
  project: () => ReviewSource | null,
  failed: (what: string) => (e: unknown) => void,
): void {
  const opened = new Map<string, Opened>();
  const threads = new Map<string, vscode.CommentThread[]>();
  const changed = new vscode.EventEmitter<vscode.Uri>();

  const provider: vscode.TextDocumentContentProvider = {
    onDidChange: changed.event,
    provideTextDocumentContent: (uri) => {
      const o = opened.get(uri.toString());
      return o ? (o.side === 'old' ? o.sides.old : o.sides.new) : '';
    },
  };

  const controller = vscode.comments.createCommentController(REVIEW_SCHEME, 'Orqiva review');
  controller.options = {
    prompt: 'Write a draft comment',
    placeHolder: 'Posted to the host with your review',
  };
  controller.commentingRangeProvider = {
    provideCommentingRanges: (doc) => {
      const o = opened.get(doc.uri.toString());
      if (!o) return [];
      return (o.side === 'new' ? o.sides.newLines : o.sides.oldLines).map(
        (n) => new vscode.Range(n - 1, 0, n - 1, 0),
      );
    },
  };

  /** Draws the comments of one pull request on its open sides again. */
  const draw = (pull: PullFiles, thread: Thread): void => {
    for (const [key, o] of opened) {
      if (o.pull.id !== pull.id) continue;
      for (const t of threads.get(key) ?? []) t.dispose();
      const uri = vscode.Uri.parse(key);
      const byLine = new Map<number, ReviewComment[]>();
      for (const c of shownOn(thread, o.path))
        if (c.side === o.side) byLine.set(c.line, [...(byLine.get(c.line) ?? []), c]);
      threads.set(
        key,
        [...byLine.entries()].map(([line, cs]) => {
          const t = controller.createCommentThread(
            uri,
            new vscode.Range(line - 1, 0, line - 1, 0),
            cs.map((c) => new ReviewComment_(c)),
          );
          t.canReply = true;
          t.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
          t.contextValue = 'orqiva';
          return t;
        }),
      );
    }
  };

  const redraw = async (src: ReviewSource, pull: PullFiles): Promise<Thread> => {
    const thread = await threadOf(src, pull.id);
    draw(pull, thread);
    return thread;
  };

  const openFile = async (src: ReviewSource, pull: PullFiles, path: string): Promise<void> => {
    const f = pull.files.find((x) => x.path === path);
    if (!f) return;
    if (f.binary || f.tooBig || !f.patch) {
      info(path + (f.binary ? ' is binary.' : ' has no patch to show (too big or a pure rename).'));
      return;
    }
    const sides = sidesOf(f.patch);
    const oldUri = uriOf(pull, 'old', f.oldPath ?? path);
    const newUri = uriOf(pull, 'new', path);
    opened.set(oldUri.toString(), { pull, path, side: 'old', sides });
    opened.set(newUri.toString(), { pull, path, side: 'new', sides });
    changed.fire(oldUri);
    changed.fire(newUri);
    await vscode.commands.executeCommand(
      'vscode.diff',
      oldUri,
      newUri,
      '#' + String(pull.number) + ' ' + path + ' (changed parts)',
      { preview: true },
    );
    await redraw(src, pull);
    if (!f.viewed) {
      await markViewed(src, pull.id, path, true);
      f.viewed = true;
    }
  };

  const submit = async (src: ReviewSource, pull: PullFiles): Promise<boolean> => {
    const thread = await threadOf(src, pull.id);
    const decisions: (vscode.QuickPickItem & { decision: Decision })[] = [
      { label: '$(check) Approve', decision: 'approve' },
      { label: '$(request-changes) Request changes', decision: 'request_changes' },
      { label: '$(comment) Comment only', decision: 'comment' },
    ];
    const choice = await vscode.window.showQuickPick(decisions, {
      title: 'Submit the review of #' + String(pull.number),
      placeHolder: submitSummary(thread),
    });
    if (!choice) return false;
    const body = await vscode.window.showInputBox({
      prompt: 'A summary for the review (optional)',
      ignoreFocusOut: true,
      validateInput: (v) =>
        choice.decision === 'request_changes' &&
        !v.trim() &&
        !thread.comments.some((c) => c.mine && c.state === 'draft')
          ? 'Say what to change'
          : null,
    });
    if (body === undefined) return false;
    const r = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Orqiva: posting the review' },
      () => submitReview(src, pull.id, choice.decision, body),
    );
    info(
      'Review posted with ' +
        String(r.posted) +
        ' comment' +
        (r.posted === 1 ? '' : 's') +
        (r.outdated ? '; ' + String(r.outdated) + ' outdated kept as drafts.' : '.'),
    );
    await redraw(src, pull);
    return true;
  };

  /** The files of a pull request and what can be done with it, until the reviewer leaves. */
  const openPull = async (src: ReviewSource, pullId: string, refresh = false): Promise<void> => {
    let pull = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Orqiva: reading the changed files' },
      () => filesOf(src, pullId, refresh),
    );
    for (;;) {
      const thread = await threadOf(src, pull.id);
      type Row = vscode.QuickPickItem & { act: string; path?: string };
      const rows: Row[] = [
        ...pull.files.map((f) => ({
          ...fileLabel(f, shownOn(thread, f.path).length),
          act: 'file',
          path: f.path,
        })),
        { label: '', kind: vscode.QuickPickItemKind.Separator, act: '' },
        { label: '$(sparkle) Ask the Reviewer agent for suggestions', act: 'suggest' },
        {
          label: '$(check-all) Submit the review…',
          description: submitSummary(thread),
          act: 'submit',
        },
        { label: '$(refresh) Read the files again from the host', act: 'refresh' },
        { label: '$(link-external) Open on the host', act: 'web' },
      ];
      const viewed = pull.files.filter((f) => f.viewed).length;
      const pick = await vscode.window.showQuickPick(rows, {
        title:
          '#' +
          String(pull.number) +
          ' ' +
          pull.title +
          ' · ' +
          String(viewed) +
          '/' +
          String(pull.files.length) +
          ' viewed' +
          (pull.truncated ? ' · the host listed only part of the files' : ''),
        placeHolder: 'A file to open as a diff, or a review action',
        matchOnDescription: true,
      });
      if (!pick) return;
      if (pick.act === 'file' && pick.path) {
        await openFile(src, pull, pick.path);
        return;
      }
      if (pick.act === 'suggest') {
        const t = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Orqiva: the Reviewer agent reads the change',
          },
          () => suggest(src, pull.id),
        );
        draw(pull, t);
        const n = t.comments.filter((c) => c.state === 'suggested').length;
        info(
          n
            ? String(n) + ' suggestion' + (n === 1 ? '' : 's') + ' on the lines.'
            : 'No suggestions.',
        );
        continue;
      }
      if (pick.act === 'submit') {
        if (await submit(src, pull)) return;
        continue;
      }
      if (pick.act === 'refresh') {
        pull = await filesOf(src, pull.id, true);
        continue;
      }
      if (pick.act === 'web') {
        await vscode.env.openExternal(vscode.Uri.parse(pull.url));
        return;
      }
    }
  };

  const sourceOr = (): ReviewSource | null => {
    const src = project();
    if (!src) info('Code review needs the folder linked to Orqiva (orq link).');
    return src;
  };
  const openOf = (uri: vscode.Uri): Opened | undefined => opened.get(uri.toString());

  context.subscriptions.push(
    changed,
    controller,
    vscode.workspace.registerTextDocumentContentProvider(REVIEW_SCHEME, provider),
    vscode.commands.registerCommand('orqiva.review', async () => {
      const src = sourceOr();
      if (!src) return;
      try {
        const queue = await queueOf(src);
        if (!queue.length) {
          info('No open pull requests in this project.');
          return;
        }
        const pick = await vscode.window.showQuickPick(
          queue.map((q) => ({ ...queueLabel(q), id: q.id })),
          {
            title: 'Pull requests to review, riskiest first',
            matchOnDescription: true,
            matchOnDetail: true,
          },
        );
        if (pick) await openPull(src, pick.id);
      } catch (e) {
        failed('The review queue did not open')(e);
      }
    }),
    vscode.commands.registerCommand('orqiva.review.files', async (uri?: vscode.Uri) => {
      const src = sourceOr();
      const o = openOf(uri ?? vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.parse(''));
      if (!src || !o) return;
      try {
        await openPull(src, o.pull.id);
      } catch (e) {
        failed('The pull request did not open')(e);
      }
    }),
    vscode.commands.registerCommand('orqiva.review.submit', async (uri?: vscode.Uri) => {
      const src = sourceOr();
      const o = openOf(uri ?? vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.parse(''));
      if (!src || !o) return;
      try {
        await submit(src, o.pull);
      } catch (e) {
        failed('The review was not posted')(e);
      }
    }),
    vscode.commands.registerCommand('orqiva.review.comment', async (reply: vscode.CommentReply) => {
      const src = sourceOr();
      const o = openOf(reply.thread.uri);
      if (!src || !o || !reply.text.trim()) return;
      const line = reply.thread.range.start.line + 1;
      try {
        await addComment(src, o.pull.id, { path: o.path, line, side: o.side, body: reply.text });
        // a new thread VS Code made for the reply is replaced by the drawn one
        if (!(threads.get(reply.thread.uri.toString()) ?? []).includes(reply.thread))
          reply.thread.dispose();
        await redraw(src, o.pull);
      } catch (e) {
        failed('The comment was not kept')(e);
      }
    }),
    ...(['accept', 'dismiss', 'delete'] as const).map((act) =>
      vscode.commands.registerCommand('orqiva.review.' + act, async (c: ReviewComment_) => {
        const src = sourceOr();
        const o = [...opened.values()].find((x) => x.path === c.data.path);
        if (!src || !o) return;
        try {
          if (act === 'delete') await deleteComment(src, c.data.id);
          else await decide(src, c.data.id, act === 'accept');
          await redraw(src, o.pull);
        } catch (e) {
          failed('That did not work')(e);
        }
      }),
    ),
  );
}
