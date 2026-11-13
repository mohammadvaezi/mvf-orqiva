// ── [PCODE-319 | S15 | v0.1.0] T32.5a Bug capture on the server: a report with page, device, console, network and actions becomes a bug ──
//    Why:  the browser extension sends what it captured; the server makes the bug a person would have
//          written with all of it: where, on what, the steps before, the failures, the console and the
//          requests, the screenshot inline. Personal data is masked first, as in test results. Members,
//          testers and up file bugs this way, with a personal API token or a session.
import { bugReportMarkdown, type BugReport } from '@orqiva/shared';
import type { Pool } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';
import { visibleFile } from './files.js';
import { maskerFor } from './testdata.js';
import { createItem } from './testlab.js';

const uuid = s.string({ format: 'uuid' });
const text = (max: number) => s.string({ max });
const at = s.string({ max: 40 });

export function bugReportRoutes(pool: Pool): Route[] {
  const report = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/bug-reports',
    summary:
      'File a bug captured in the browser: page, device, console, network, the actions before it, and uploaded files (tester)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      title: s.string({ min: 1, max: 255 }),
      note: s.optional(text(10_000)),
      page: s.object({ url: text(2000), title: text(500) }),
      device: s.object({
        userAgent: text(500),
        platform: text(100),
        language: text(40),
        viewport: s.object({
          width: s.number({ integer: true, min: 0 }),
          height: s.number({ integer: true, min: 0 }),
        }),
        screen: s.object({
          width: s.number({ integer: true, min: 0 }),
          height: s.number({ integer: true, min: 0 }),
          pixelRatio: s.number({ min: 0 }),
        }),
        timeZone: text(80),
      }),
      console: s.array(
        s.object({
          level: s.enum(['error', 'warn', 'info', 'log', 'debug']),
          text: text(5000),
          at,
        }),
        { max: 200 },
      ),
      network: s.array(
        s.object({
          method: text(12),
          url: text(2000),
          status: s.number({ integer: true, min: 0 }),
          ms: s.number({ min: 0 }),
          at,
        }),
        { max: 200 },
      ),
      actions: s.array(
        s.object({
          kind: s.enum(['click', 'input', 'navigate', 'submit', 'key']),
          target: text(300),
          at,
        }),
        { max: 100 },
      ),
      screenshotFileId: s.optional(uuid),
      recordingFileId: s.optional(uuid),
    }),
    response: s.object({ itemId: s.string(), ref: s.string(), url: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'tester', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const fileLink = async (id: string | undefined, what: string): Promise<string | null> => {
          if (!id) return null;
          const f = await visibleFile(c, a, id);
          if (f.project_id !== p.id)
            throw new HttpError(
              400,
              'invalid_request',
              'The ' + what + ' belongs to another project',
              [{ path: 'body.' + what + 'FileId', message: 'is a file of another project' }],
            );
          return '/api/workspaces/' + a.workspaceId + '/files/' + f.id + '/content';
        };
        const mask = await maskerFor(c, p.id);
        const r: BugReport = {
          title: body.title,
          note: mask(body.note ?? ''),
          page: { url: mask(body.page.url), title: mask(body.page.title) },
          device: body.device,
          console: body.console.map((x) => ({ ...x, text: mask(x.text) })),
          network: body.network.map((x) => ({ ...x, url: mask(x.url) })),
          actions: body.actions.map((x) => ({ ...x, target: mask(x.target) })),
        };
        const description = bugReportMarkdown(r, {
          screenshot: await fileLink(body.screenshotFileId, 'screenshot'),
          recording: await fileLink(body.recordingFileId, 'recording'),
        });
        const made = await createItem(c, a, p.id, mask(body.title), description, 'bug', 'medium');
        return {
          status: 201,
          body: { itemId: made.id, ref: made.ref, url: '/items/' + made.id },
        };
      }),
  });
  return [report];
}
