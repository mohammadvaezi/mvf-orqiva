// ── [PCODE-169 | S15 | v0.1.0] B3.2 Documents and UI kit on the server: page tree, versions, comments, backlinks, templates, knowledge, tokens, components, mockups, assets ──
//    Why:  Documents and the UI kit through the API against PostgreSQL: pages from templates in a tree,
//          versions that refuse a stale save and a foreign lock, diff and restore, backlinks and the link
//          check, comments on passages, search, what agents may read; tokens with export and contrast,
//          components, mockups with versions, pins and an approval naming the image, assets that expire.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contrastPairs } from '../../src/api/uikit.js';
import { isPrivateAddress } from '../../src/api/documents.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('rules', () => {
  it('pairs text colours with backgrounds for the contrast check', () => {
    const pairs = contrastPairs([
      {
        name: 'color.text',
        type: 'color',
        valueLight: '#111111',
        valueDark: '#eeeeee',
        description: '',
      },
      {
        name: 'color.bg',
        type: 'color',
        valueLight: '#ffffff',
        valueDark: '#222222',
        description: '',
      },
      {
        name: 'color.text.muted',
        type: 'color',
        valueLight: '#999999',
        valueDark: '',
        description: '',
      },
    ]);
    expect(pairs.map((p) => [p.foreground, p.mode, p.grade])).toEqual([
      ['color.text.muted', 'light', 'fail'],
      ['color.text.muted', 'dark', 'AA'],
      ['color.text', 'dark', 'AAA'],
      ['color.text', 'light', 'AAA'],
    ]);
  });

  // [PCODE-172 | S15 | v0.1.0] on-X colours are checked on X only, not on every background
  it('checks on-primary on primary, and text on backgrounds only', () => {
    const pairs = contrastPairs([
      {
        name: 'color.primary',
        type: 'color',
        valueLight: '#4f46e5',
        valueDark: '',
        description: '',
      },
      {
        name: 'color.on-primary',
        type: 'color',
        valueLight: '#ffffff',
        valueDark: '',
        description: '',
      },
      { name: 'color.text', type: 'color', valueLight: '#111111', valueDark: '', description: '' },
      { name: 'color.bg', type: 'color', valueLight: '#ffffff', valueDark: '', description: '' },
    ]);
    expect(pairs.map((p) => p.foreground + ' on ' + p.background).sort()).toEqual([
      'color.on-primary on color.primary',
      'color.text on color.bg',
    ]);
  });

  it('keeps the link check away from private addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.4',
      '172.20.0.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2a00:1450::1'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe.skipIf(!hasDatabase)('documents and the UI kit (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let project = '';
  const id: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  type Page = {
    page: {
      id: string;
      title: string;
      version: number;
      template: string;
      stale: boolean;
      needsApproval: boolean;
      lockedBy: string | null;
      backlinks: number;
    };
    body: string;
    backlinks: { title: string }[];
    links: { url: string; toPageId: string | null; httpStatus: number | null }[];
    watching: boolean;
  };
  const upload = async (name: string, type: string, data: Buffer | string): Promise<string> => {
    const r = await fetch(t.base + W('/files?name=' + name + '&projectId=' + project), {
      method: 'POST',
      headers: { cookie: ada.cookie, 'content-type': type },
      body: data,
    });
    return ((await r.json()) as { id: string }).id;
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'DOC', name: 'Docs' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('builds a tree of folders and pages, from templates', async () => {
    id['F'] = (
      await t.call<Page>(ada, 'POST', P('/docs'), { title: 'Operations', kind: 'folder' })
    ).body.page.id;
    const rb = await t.call<Page>(ada, 'POST', P('/docs'), {
      title: 'Restart the API',
      template: 'runbook',
      parentId: id['F'],
      tags: ['ops'],
    });
    expect(rb.status).toBe(201);
    expect(rb.body.page).toMatchObject({
      title: 'Runbook: Restart the API',
      template: 'runbook',
      version: 1,
    });
    expect(rb.body.body).toContain('## Rollback');
    id['RB'] = rb.body.page.id;
    expect((await t.call(ada, 'POST', P('/docs'), { title: 'x', template: 'poem' })).status).toBe(
      400,
    );
    const tree = await t.call<{ id: string; parentId: string | null }[]>(ada, 'GET', P('/docs'));
    expect(tree.body.find((n) => n.id === id['RB'])?.parentId).toBe(id['F']);
    expect(
      (await t.call(ada, 'PATCH', W('/docs/' + (id['F'] ?? '')), { parentId: id['RB'] })).status,
    ).toBe(400);
  });

  it('saves versions, refuses a stale save and a foreign lock, diffs and restores', async () => {
    const rb = id['RB'] ?? '';
    const v2 = await t.call<Page>(ada, 'PUT', W('/docs/' + rb), {
      body: '## Steps\n\n1. Drain the node\n2. Restart',
      baseVersion: 1,
    });
    expect(v2.body.page.version).toBe(2);
    expect(
      (await t.call(cy, 'PUT', W('/docs/' + rb), { body: 'old edit', baseVersion: 1 })).status,
    ).toBe(409);
    await t.call(ada, 'PATCH', W('/docs/' + rb), { locked: true });
    expect((await t.call(cy, 'PUT', W('/docs/' + rb), { body: 'x', baseVersion: 2 })).status).toBe(
      409,
    );
    expect((await t.call(cy, 'PATCH', W('/docs/' + rb), { locked: false })).status).toBe(403);
    await t.call(ada, 'PATCH', W('/docs/' + rb), { locked: false });
    await t.call(cy, 'PUT', W('/docs/' + rb), {
      body: '## Steps\n\n1. Drain the node\n2. Restart\n3. Check health',
      baseVersion: 2,
    });
    const diff = await t.call<{ lines: { op: string; text: string }[] }>(
      ada,
      'GET',
      W('/docs/' + rb + '/diff?from=2&to=3'),
    );
    expect(diff.body.lines.filter((l) => l.op !== 'same')).toEqual([
      { op: 'add', text: '3. Check health' },
    ]);
    const back = await t.call<Page>(ada, 'POST', W('/docs/' + rb + '/versions/2/restore'));
    expect(back.body.page.version).toBe(4);
    expect(back.body.body).not.toContain('Check health');
    await t.call(ada, 'PATCH', W('/docs/' + rb + '/versions/4'), { name: 'Agreed with ops' });
    const hist = await t.call<{ version: number; name: string; author: string }[]>(
      ada,
      'GET',
      W('/docs/' + rb + '/versions'),
    );
    expect(hist.body.map((h) => h.version)).toEqual([4, 3, 2, 1]);
    expect(hist.body[0]).toMatchObject({ name: 'Agreed with ops', author: 'Ada' });
  });

  it('links pages both ways and checks web links', async () => {
    const health = t.base + '/health';
    const missing = t.base + '/no-such-page';
    const idx = await t.call<Page>(ada, 'POST', P('/docs'), {
      title: 'Index',
      body:
        'Start with [the runbook](/docs/' +
        (id['RB'] ?? '') +
        ') and [[Operations]]. Health: ' +
        health +
        ' and [old](' +
        missing +
        ').',
    });
    expect(idx.body.links.filter((l) => l.toPageId).length).toBe(2);
    expect(
      idx.body.links
        .filter((l) => l.url)
        .map((l) => l.url)
        .sort(),
    ).toEqual([health, missing].sort());
    const rb = await t.call<Page>(ada, 'GET', W('/docs/' + (id['RB'] ?? '')));
    expect(rb.body.backlinks.map((b) => b.title)).toEqual(['Index']);
    const check = await t.call<{ checked: number; broken: { url: string; httpStatus: number }[] }>(
      ada,
      'POST',
      P('/docs/check-links'),
    );
    expect(check.body.checked).toBe(2);
    expect(check.body.broken).toEqual([
      { pageId: idx.body.page.id, title: 'Index', url: missing, httpStatus: 404 },
    ]);
  });

  it('takes comments on passages, watches, searches, flags stale and agent pages', async () => {
    const rb = id['RB'] ?? '';
    expect(
      (
        await t.call(cy, 'POST', W('/docs/' + rb + '/comments'), {
          body: 'Which node first?',
          anchor: 'Drain the node',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t.call(cy, 'POST', W('/docs/' + rb + '/comments'), {
          body: 'x',
          anchor: 'not on the page',
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.call<{ watching: boolean }>(cy, 'POST', W('/docs/' + rb + '/watch'))).body.watching,
    ).toBe(true);
    const found = await t.call<{ title: string; snippet: string }[]>(
      ada,
      'GET',
      P('/docs/search?q=drain'),
    );
    expect(found.body[0]?.title).toBe('Runbook: Restart the API');
    expect(found.body[0]?.snippet).toContain('«Drain»');
    const stale = await t.call<Page>(ada, 'PATCH', W('/docs/' + rb), {
      reviewBy: '2020-01-01',
      ownerId: cy.id,
    });
    expect(stale.body.page.stale).toBe(true);
    expect((await t.call(ada, 'POST', W('/docs/' + rb + '/approve'))).status).toBe(409);
  });

  it('lets an admin decide what an agent may read', async () => {
    const other = await t.call<Page>(ada, 'POST', P('/docs'), {
      title: 'Tagged note',
      tags: ['ops'],
    });
    await t.call(ada, 'POST', P('/docs'), { title: 'Secret plans' });
    const set = await t.call<{ readable: number; tags: string[] }>(
      ada,
      'PUT',
      P('/knowledge/coder'),
      { pageIds: [id['F']], tags: ['ops'] },
    );
    expect(set.body).toMatchObject({ readable: 2, tags: ['ops'] });
    expect((await t.call(cy, 'PUT', P('/knowledge/coder'), { pageIds: [], tags: [] })).status).toBe(
      403,
    );
    const k = await t.call<{ scopes: { agentKey: string; readable: number }[] }>(
      ada,
      'GET',
      P('/knowledge'),
    );
    expect(k.body.scopes).toEqual([
      {
        agentKey: 'coder',
        pages: [{ id: id['F'], title: 'Operations' }],
        tags: ['ops'],
        readable: 2,
      },
    ]);
    expect(other.status).toBe(201);
  });

  it('keeps design tokens, exports them and checks contrast', async () => {
    await t.call(ada, 'PUT', P('/tokens/color.bg'), {
      type: 'color',
      valueLight: '#ffffff',
      valueDark: '#111827',
    });
    await t.call(ada, 'PUT', P('/tokens/color.text'), {
      type: 'color',
      valueLight: '#9ca3af',
      valueDark: '#f9fafb',
    });
    expect(
      (
        await t.call(ada, 'PUT', P('/tokens/color.bad'), {
          type: 'color',
          valueLight: 'red; } body { x',
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.call(ada, 'PUT', P('/tokens/Color'), { type: 'color', valueLight: '#fff' })).status,
    ).toBe(400);
    const tok = await t.call<{ contrast: { foreground: string; mode: string; grade: string }[] }>(
      ada,
      'GET',
      P('/tokens'),
    );
    expect(tok.body.contrast.find((p) => p.mode === 'light')?.grade).toBe('fail');
    const css = await fetch(t.base + P('/tokens/export?format=css'), {
      headers: { cookie: ada.cookie },
    });
    expect(css.headers.get('content-disposition')).toContain('doc-tokens.css');
    expect(await css.text()).toContain('--color-text: #9ca3af;');
  });

  it('keeps the component inventory', async () => {
    const b = await t.call<{ id: string; props: unknown[] }>(ada, 'POST', P('/components'), {
      name: 'Button',
      status: 'in_code',
      codePath: 'src/ui/Button.tsx',
      props: [{ name: 'variant', type: "'primary' | 'ghost'", default: 'primary' }],
    });
    expect(b.status).toBe(201);
    expect((await t.call(ada, 'POST', P('/components'), { name: 'Button' })).status).toBe(409);
    expect(
      (await t.call(ada, 'PATCH', W('/components/' + b.body.id), { designUrl: 'javascript:x' }))
        .status,
    ).toBe(400);
    expect(
      (
        await t.call<{ status: string }>(ada, 'PATCH', W('/components/' + b.body.id), {
          status: 'deprecated',
        })
      ).body.status,
    ).toBe('deprecated');
  });

  it('reviews mockups: versions, pins, approval of the exact image, a task told of the change', async () => {
    const png1 = await upload('home-v1.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
    const png2 = await upload('home-v2.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]));
    const txt = await upload('notes.txt', 'text/plain', 'not an image');
    const states = (await t.call<{ states: { id: string; group: string }[] }>(ada, 'GET', P('')))
      .body.states;
    const task = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Build the home page',
        stateId: states.find((s) => s.group === 'started')?.id,
      })
    ).body.id;
    expect((await t.call(ada, 'POST', P('/mockups'), { title: 'x', fileId: txt })).status).toBe(
      400,
    );
    const m = await t.call<{
      id: string;
      version: number;
      status: string;
      changedAfterStart: boolean;
    }>(ada, 'POST', P('/mockups'), { title: 'Home', fileId: png1, itemId: task });
    expect(m.body).toMatchObject({ version: 1, status: 'in_review', changedAfterStart: false });
    expect(
      (
        await t.call(cy, 'POST', W('/mockups/' + m.body.id + '/pins'), {
          x: 0.4,
          y: 0.2,
          body: 'Logo too small',
        })
      ).status,
    ).toBe(201);
    expect(
      (await t.call(cy, 'POST', W('/mockups/' + m.body.id + '/decision'), { approve: false }))
        .status,
    ).toBe(400);
    await t.call(cy, 'POST', W('/mockups/' + m.body.id + '/decision'), {
      approve: false,
      note: 'Bigger logo',
    });
    const v2 = await t.call<{ version: number; status: string; changedAfterStart: boolean }>(
      ada,
      'POST',
      W('/mockups/' + m.body.id + '/versions'),
      { fileId: png2, note: 'Logo bigger' },
    );
    expect(v2.body).toMatchObject({ version: 2, status: 'in_review', changedAfterStart: true });
    const ok = await t.call<{ status: string }>(
      cy,
      'POST',
      W('/mockups/' + m.body.id + '/decision'),
      { approve: true },
    );
    expect(ok.body.status).toBe('approved');
    const full = await t.call<{
      versions: { version: number }[];
      pins: { version: number }[];
      decisions: { decision: string; version: number }[];
    }>(ada, 'GET', W('/mockups/' + m.body.id));
    expect(full.body.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(full.body.decisions.map((d) => [d.decision, d.version])).toEqual([
      ['approved', 2],
      ['declined', 1],
    ]);
    const history = await t.call<{ changes: Record<string, unknown> }[]>(
      ada,
      'GET',
      W('/items/' + task + '/history'),
    );
    expect(JSON.stringify(history.body)).toContain('version 2 of Home');
  });

  it('keeps assets with their rights and expiry', async () => {
    const logo = await upload('logo.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]));
    const a = await t.call<{ id: string; kind: string; expired: boolean }>(
      ada,
      'POST',
      P('/assets'),
      { fileId: logo, kind: 'logo', licence: 'Own work', expiresOn: '2020-12-31' },
    );
    expect(a.body).toMatchObject({ kind: 'logo', expired: true });
    const later = await t.call<{ expired: boolean; expiringSoon: boolean }>(
      ada,
      'PATCH',
      W('/assets/' + a.body.id),
      { expiresOn: null },
    );
    expect(later.body).toMatchObject({ expired: false, expiringSoon: false });
    expect((await t.call<unknown[]>(ada, 'GET', P('/assets'))).body).toHaveLength(1);
  });
});
