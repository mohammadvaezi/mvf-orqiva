// ── [PCODE-289 | S15 | v0.1.0] T30.3 Brand pages: colour, type, voice, logo use, do and don't ──
//    Why:  the brand book on the server: sections written by members only, the palette and type taken
//          from the tokens as they are now, logos from the assets, examples only with the project's own
//          images, and the downloaded book carries its pictures inside.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe.skipIf(!hasDatabase)('the brand book (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let aud: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const upload = async (name: string, type: string, data: Buffer): Promise<string> =>
    (
      (await (
        await fetch(t.base + W('/files?name=' + name + '&projectId=' + project), {
          method: 'POST',
          headers: { cookie: ada.cookie, 'content-type': type },
          body: data,
        })
      ).json()) as { id: string }
    ).id;
  type Book = {
    sections: { key: string; body: string; updatedBy: string | null }[];
    palette: { group: string; colours: { name: string; hex: string }[] }[];
    type: { families: { first: string }[]; sizes: { px: number }[] };
    logos: { name: string }[];
    examples: { kind: string; caption: string; imageUrl: string | null }[];
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    aud = await t.signup('Aud');
    await t.call(ada, 'POST', W('/members'), { email: aud.email, role: 'auditor' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'BRD', name: 'Brand' })
    ).body.id;
    await t.call(ada, 'PUT', P('/tokens/color.brand.violet'), {
      type: 'color',
      valueLight: '#7c3aed',
    });
    await t.call(ada, 'PUT', P('/tokens/font.family.body'), {
      type: 'fontFamily',
      valueLight: 'Inter, sans-serif',
    });
    await t.call(ada, 'PUT', P('/tokens/font.size.h1'), { type: 'dimension', valueLight: '2rem' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps each section’s words and reads colour and type from the tokens', async () => {
    expect(
      (await t.call(ada, 'PUT', P('/brand/voice'), { body: 'We say **you**, never "the user".' }))
        .status,
    ).toBe(200);
    expect((await t.call(ada, 'PUT', P('/brand/jingle'), { body: 'x' })).status).toBe(404);
    expect((await t.call(aud, 'PUT', P('/brand/voice'), { body: 'x' })).status).toBe(403);
    const b = (await t.call<Book>(aud, 'GET', P('/brand'))).body;
    expect(b.sections.map((x) => x.key)).toEqual(['overview', 'colour', 'type', 'voice', 'logo']);
    expect(b.sections.find((x) => x.key === 'voice')).toMatchObject({
      body: 'We say **you**, never "the user".',
      updatedBy: 'Ada',
    });
    expect(b.palette).toEqual([
      { group: 'color.brand', colours: [expect.objectContaining({ hex: '#7c3aed' })] },
    ]);
    expect(b.type.families[0]?.first).toBe('Inter');
    expect(b.type.sizes[0]?.px).toBe(32);
  });

  it('shows logos and examples, and downloads the book with its pictures', async () => {
    const logo = await upload('logo.png', 'image/png', PNG);
    await t.call(ada, 'POST', P('/assets'), { fileId: logo, name: 'Main logo', kind: 'logo' });
    const pic = await upload('stretched.png', 'image/png', PNG);
    const text = await upload('notes.txt', 'text/plain', Buffer.from('x'));
    expect(
      (
        await t.call(ada, 'POST', P('/brand/examples'), {
          kind: 'dont',
          caption: 'x',
          fileId: text,
        })
      ).status,
    ).toBe(400);
    const ex = await t.call<{ id: string; imageUrl: string }>(ada, 'POST', P('/brand/examples'), {
      kind: 'dont',
      caption: 'Stretch the logo',
      fileId: pic,
    });
    expect(ex.status).toBe(201);
    await t.call(ada, 'POST', P('/brand/examples'), { kind: 'do', caption: 'Give it room' });
    const b = (await t.call<Book>(ada, 'GET', P('/brand'))).body;
    expect(b.logos.map((l) => l.name)).toEqual(['Main logo']);
    expect(b.examples.map((e) => [e.kind, e.caption, Boolean(e.imageUrl)])).toEqual([
      ['dont', 'Stretch the logo', true],
      ['do', 'Give it room', false],
    ]);
    const file = await fetch(t.base + P('/brand/export'), { headers: { cookie: aud.cookie } });
    expect(file.headers.get('content-disposition')).toContain('brd-brand-book.html');
    const html = await file.text();
    expect(html).toContain('<title>Brand brand book</title>');
    expect(html).toContain('<p>We say <strong>you</strong>, never &quot;the user&quot;.</p>');
    expect(html).toContain('background:#7c3aed');
    expect(html.match(/src="data:image\/png;base64,/g)?.length).toBe(2);
    await t.call(ada, 'DELETE', W('/brand-examples/' + ex.body.id));
    expect((await t.call<Book>(ada, 'GET', P('/brand'))).body.examples).toHaveLength(1);
  });
});
