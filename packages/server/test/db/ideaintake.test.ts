// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
//    Why:  a link source is read by the server: a page becomes readable lines with its title, a redirect
//          is followed and checked, a Word file behind a link is kept and queued like an upload, what cannot
//          be read says why and can be read again, and the extraction names the sources still empty.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelProvider } from '../../src/agents/provider.js';
import { decodeEntities, pageText, readLink } from '../../src/files/linkread.js';
import { sampleDocx } from '../docxfile.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

describe('reading a page', () => {
  it('keeps the main part as lines, with headings, list items and entities', () => {
    const { title, text } = pageText(
      `<html><head><title>Booking &amp; reminders</title><style>p{}</style></head><body>
       <nav><a href="/">Home</a> <a href="/x">Pricing</a></nav>
       <main><h1>Reminders</h1><p>Customers forget&nbsp;bookings.</p>
       <ul><li>Send it the day <b>before</b></li><li>Include the time &#8211; always</li></ul>
       <script>track()</script></main><footer>© us</footer></body></html>`,
    );
    expect(title).toBe('Booking & reminders');
    expect(text).toBe(
      '# Reminders\n\nCustomers forget bookings.\n\n- Send it the day before\n- Include the time – always',
    );
    expect(decodeEntities('&auml;&#x41;&bogus;')).toBe('äA&bogus;');
  });

  it('drops page furniture when there is no main part', () => {
    const { text } = pageText(
      '<body><header>Site</header><p>Only this.</p><aside>Ads</aside><footer>Foot</footer></body>',
    );
    expect(text).toBe('Only this.');
  });

  it('refuses addresses on the inside network and other schemes', async () => {
    await expect(readLink('http://127.0.0.1:9/x')).rejects.toThrow(/not a public address/);
    await expect(readLink('http://localhost/x')).rejects.toThrow(/not a public address/);
    await expect(readLink('ftp://example.com/x')).rejects.toThrow(/Only http and https/);
    await expect(readLink('https://u:p@example.com/')).rejects.toThrow(/user name or password/);
    await expect(readLink('nonsense')).rejects.toThrow(/not a web address/);
  });

  it('checks every redirect again', async () => {
    // a public address given as a number: no name lookup needed
    const fetchImpl = (u: string) =>
      Promise.resolve(
        u.startsWith('https://93.184.215.14')
          ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/admin' } })
          : new Response('inside', { headers: { 'content-type': 'text/plain' } }),
      );
    await expect(
      readLink('https://93.184.215.14/go', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        allowPrivate: false,
      }),
    ).rejects.toThrow(/10\.0\.0\.5 is not a public address/);
  });
});

describe.skipIf(!hasDatabase)('link sources (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let web: Server;
  let site = '';
  let idea = '';
  let current: ModelProvider | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Source = {
    id: string;
    label: string;
    title: string;
    fileId: string | null;
    fileName: string | null;
    textLength: number;
    read: { status: string } | null;
    link: { status: string; error: string; readAt: string | null } | null;
  };
  let pageBody =
    '<html><head><title>Call notes</title></head><body><p>Drivers should not get reminders.</p></body></html>';

  beforeAll(async () => {
    web = createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(pageBody);
      } else if (req.url === '/moved') {
        res.writeHead(301, { location: '/page' });
        res.end();
      } else if (req.url === '/brief') {
        res.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-disposition': 'attachment; filename="brief.docx"',
        });
        res.end(sampleDocx());
      } else if (req.url === '/logo') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from([1, 2, 3]));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await listenFetchable(web); // [PCODE-365 | S15 | v0.1.0]
    site = 'http://127.0.0.1:' + String((web.address() as AddressInfo).port);
    t = await startTestApp({
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    const project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'LNK', name: 'Links' })
    ).body.id;
    idea = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Booking reminders',
        body: 'Customers forget bookings.',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await new Promise((r) => web.close(r));
  });

  it('reads a page given as a link, through a redirect, with its title', async () => {
    const r = await t.call<Source>(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'link',
      url: site + '/moved',
    });
    expect(r.status).toBe(201);
    expect(r.body.title).toBe('Call notes');
    expect(r.body.link).toMatchObject({ status: 'read', error: '' });
    expect(r.body.link?.readAt).toBeTruthy();
    expect(r.body.textLength).toBe('Drivers should not get reminders.'.length);
  });

  it('keeps a Word file behind a link as a file, read like uploads', async () => {
    const r = await t.call<Source>(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'link',
      url: site + '/brief',
      title: 'The brief',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: 'The brief', fileName: 'brief.docx' });
    expect(r.body.fileId).toBeTruthy();
    expect(r.body.link?.status).toBe('read');
    expect(r.body.read).not.toBeNull();
  });

  it('says why a link failed, and reads it again on request', async () => {
    const bad = await t.call<Source>(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'link',
      url: site + '/logo',
    });
    expect(bad.body.link).toMatchObject({ status: 'failed' });
    expect(bad.body.link?.error).toMatch(/image\/png, which is not read/);
    const gone = await t.call<Source>(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'link',
      url: site + '/nothing',
      title: 'Later',
    });
    expect(gone.body.link?.error).toMatch(/answered 404/);

    pageBody = '<p>Reminders go out at 18:00.</p>';
    const page = await t.call<Source>(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'link',
      url: site + '/page',
    });
    expect(page.body.textLength).toBe('Reminders go out at 18:00.'.length);
    pageBody = '<p>Reminders go out at 17:00 now, and on Sundays too.</p>';
    const again = await t.call<Source>(ada, 'POST', W('/idea-sources/' + page.body.id + '/read'));
    expect(again.status).toBe(200);
    expect(again.body.textLength).toBe('Reminders go out at 17:00 now, and on Sundays too.'.length);

    const text = await t.call<Source>(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'text',
      body: 'Pasted.',
    });
    const refused = await t.call(ada, 'POST', W('/idea-sources/' + text.body.id + '/read'));
    expect(refused.status).toBe(409);
  });

  it('names the sources the extraction found empty', async () => {
    current = scriptedProvider([
      {
        content: [{ type: 'text', text: '```json\n{"requirements": []}\n```' }],
        stopReason: 'end_turn',
        usage: { input: 10, output: 5 },
      },
    ]);
    const r = await t.call<{ unread: string[] }>(ada, 'POST', W('/ideas/' + idea + '/extract'));
    expect(r.status).toBe(200);
    // the logo and the missing page have nothing; the docx waits for its read
    expect(r.body.unread).toEqual(['S2', 'S3', 'S4']);
  });
});
