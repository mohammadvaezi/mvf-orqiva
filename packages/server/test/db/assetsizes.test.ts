// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
//    Why:  sizes against the real database and file store: kept only when the header matches, named
//          safely, replaced by name; an asset as a ZIP with its rights; the portal offers only what is
//          shared and not expired, to the client's own contacts.
import { deflateSync, inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

/** A real PNG of this size, one grey colour. */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((w + 1) * h, 0x80);
  for (let y = 0; y < h; y += 1) raw[y * (w + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The names in a ZIP, from its local headers. */
function zipNames(b: Buffer): string[] {
  const out: string[] = [];
  let i = 0;
  while (b.readUInt32LE(i) === 0x04034b50) {
    const packed = b.readUInt32LE(i + 18);
    const nameLen = b.readUInt16LE(i + 26);
    const extra = b.readUInt16LE(i + 28);
    out.push(b.toString('utf8', i + 30, i + 30 + nameLen));
    i += 30 + nameLen + extra + packed;
  }
  return out;
}
function zipText(b: Buffer, name: string): string {
  let i = 0;
  while (b.readUInt32LE(i) === 0x04034b50) {
    const packed = b.readUInt32LE(i + 18);
    const nameLen = b.readUInt16LE(i + 26);
    const extra = b.readUInt16LE(i + 28);
    const start = i + 30 + nameLen + extra;
    if (b.toString('utf8', i + 30, i + 30 + nameLen) === name)
      return inflateRawSync(b.subarray(start, start + packed)).toString('utf8');
    i = start + packed;
  }
  return '';
}

describe.skipIf(!hasDatabase)('asset sizes and the download portal (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let otto: Person;
  let project = '';
  let helio = '';
  let logo = '';
  let old = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const upload = async (name: string, data: Buffer, type = 'image/png'): Promise<string> =>
    (
      (await (
        await fetch(t.base + W('/files?name=' + name + '&projectId=' + project), {
          method: 'POST',
          headers: { cookie: ada.cookie, 'content-type': type },
          body: data,
        })
      ).json()) as { id: string }
    ).id;
  const get = async (who: Person, path: string): Promise<Response> =>
    fetch(t.base + W(path), { headers: { cookie: who.cookie } });

  async function contact(client: string, email: string): Promise<Person> {
    const r = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + client + '/contacts'),
      { email, portalRole: 'viewer' },
    );
    const res = await fetch(
      t.base + '/auth/invitations/' + (r.body.invitation?.token ?? '') + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: email.split('@')[0], password: 'a client password 1' }),
      },
    );
    const p: Person = {
      id: '',
      email,
      name: email.split('@')[0] ?? '',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    p.id = (await t.call<{ user: { id: string } }>(p, 'GET', '/auth/me')).body.user.id;
    return p;
  }

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    const aurum = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Aurum' })).body
      .id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'AST', name: 'Assets' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    ines = await contact(helio, 'ines@helio.example');
    otto = await contact(aurum, 'otto@aurum.example');
    const add = async (name: string, extra: Record<string, unknown> = {}): Promise<string> =>
      (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/assets'), {
          fileId: await upload(name, png(300, 300)),
          name: name.replace('.png', ''),
          kind: 'logo',
          licence: 'Own work',
          rights: 'Web and apps of Helio',
          ...extra,
        })
      ).body.id;
    logo = await add('Brand Logo.png');
    old = await add('Old photo.png', { kind: 'image', expiresOn: '2020-01-01' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps a size only when the image is what it claims, under a safe name', async () => {
    const R = W('/assets/' + logo + '/renditions');
    const small = await upload('s.png', png(100, 100));
    const said = (name: string, width: number, height = width, fileId = small) =>
      t.call<{ name: string; format: string; width: number }>(ada, 'POST', R, {
        fileId,
        name,
        preset: 'scales',
        width,
        height,
      });
    expect((await said('brand-logo.png', 120)).status).toBe(400); // the header says 100
    expect((await said('../escape.png', 100)).status).toBe(400);
    expect((await said('a/../b.png', 100)).status).toBe(400);
    const text = await upload('notes.txt', Buffer.from('hello'), 'text/plain');
    expect((await said('notes.png', 100, 100, text)).status).toBe(400);
    const ok = await said('brand-logo.png', 100);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ name: 'brand-logo.png', format: 'png', width: 100 });
    // the same name again replaces it
    expect(
      (await said('brand-logo.png', 200, 200, await upload('m.png', png(200, 200)))).status,
    ).toBe(201);
    await said('android/mipmap-hdpi/ic_launcher.png', 72, 72, await upload('i.png', png(72, 72)));
    const list = (await t.call<{ name: string; width: number }[]>(ada, 'GET', R)).body;
    expect(list.map((x) => [x.name, x.width])).toEqual([
      ['brand-logo.png', 200],
      ['android/mipmap-hdpi/ic_launcher.png', 72],
    ]);
    const assets = (
      await t.call<{ id: string; sizes: number; clientVisible: boolean }[]>(
        ada,
        'GET',
        W('/projects/' + project + '/assets'),
      )
    ).body;
    expect(assets.find((a) => a.id === logo)).toMatchObject({ sizes: 2, clientVisible: false });

    const z = Buffer.from(await (await get(ada, '/assets/' + logo + '/zip')).arrayBuffer());
    expect(zipNames(z)).toEqual([
      'original/Brand Logo.png',
      'brand-logo.png',
      'android/mipmap-hdpi/ic_launcher.png',
      'RIGHTS.txt',
    ]);
    expect(zipText(z, 'RIGHTS.txt')).toContain('Licence: Own work');
  });

  it('offers shared assets in the portal, never expired ones, only to the client', async () => {
    expect((await t.call(ines, 'GET', W('/portal/assets'))).body).toMatchObject({ assets: [] });
    expect(
      (await t.call(ada, 'PUT', W('/assets/' + old + '/client'), { shared: true })).status,
    ).toBe(409);
    // shared earlier, expired since: still never offered
    await inSystem(t.db.pool, (c) =>
      c.query('UPDATE assets SET client_visible = true WHERE id = $1', [old]),
    );
    expect(
      (await t.call(ines, 'PUT', W('/assets/' + logo + '/client'), { shared: true })).status,
    ).toBe(403);
    await t.call(ada, 'PUT', W('/assets/' + logo + '/client'), { shared: true });
    type P = {
      zipUrl: string;
      assets: { id: string; name: string; url: string; zipUrl: string; sizes: { url: string }[] }[];
    };
    const p = (await t.call<P>(ines, 'GET', W('/portal/assets'))).body;
    expect(p.assets.map((a) => a.name)).toEqual(['Brand Logo']);
    const a = p.assets[0];
    if (!a) throw new Error('no asset');
    expect(a.sizes).toHaveLength(2);
    const file = await fetch(t.base + (a.sizes[0]?.url ?? ''), {
      headers: { cookie: ines.cookie },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('content-disposition')).toMatch(/^attachment/);
    // the expired asset's file is not reachable through the portal either
    const oldFile = await inSystem(t.db.pool, (c) =>
      c.query<{ file_id: string }>('SELECT file_id FROM assets WHERE id = $1', [old]),
    );
    expect(
      (await get(ines, '/portal/assets/' + old + '/files/' + (oldFile.rows[0]?.file_id ?? '')))
        .status,
    ).toBe(404);
    // a file of another asset is not served under this one
    expect(
      (await get(ines, '/portal/assets/' + logo + '/files/' + (oldFile.rows[0]?.file_id ?? '')))
        .status,
    ).toBe(404);
    const all = Buffer.from(
      await (await fetch(t.base + p.zipUrl, { headers: { cookie: ines.cookie } })).arrayBuffer(),
    );
    expect(zipNames(all)).toContain('brand-logo/RIGHTS.txt');
    expect(zipNames(all).some((n) => n.startsWith('old-photo'))).toBe(false);

    // another client's contact sees nothing of Helio's
    expect((await t.call<P>(otto, 'GET', W('/portal/assets'))).body.assets).toEqual([]);
    expect((await get(otto, '/portal/assets/' + logo + '/files/' + 'x')).status).toBe(400);
    // the team switches the section off
    await t.call(ada, 'PATCH', W('/clients/' + helio), { shares: { assets: false } });
    expect((await t.call(ines, 'GET', W('/portal/assets'))).status).toBe(403);
  });
});
