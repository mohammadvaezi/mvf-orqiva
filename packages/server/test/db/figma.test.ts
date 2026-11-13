// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-297 | S15 | v0.1.0] T30.10 Figma two-way sync: variables and components, tested against recorded Figma answers ──
//    Why:  the sync against recorded answers of Figma's REST API, served by a stand-in Figma that checks
//          the token and keeps what is sent: the first comparison (no base yet), taking and sending in
//          one go, then changes on one side or both after a sync; components linked by name; Figma's
//          refusals said plainly; the token never shown again.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL('../fixtures/figma/' + name, import.meta.url), 'utf8'));

type Vars = {
  meta: {
    variables: Record<string, { valuesByMode: Record<string, unknown> }>;
  };
};
const TOKEN = 'figd_test-token-for-the-stand-in';
const FILE = 'Ab12Cd34Ef56Gh78Ij90';

describe.skipIf(!hasDatabase)('Figma two-way sync (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mia: Person;
  let project = '';
  let figma: Server;
  let figmaUrl = '';
  let vars = fixture('variables-local.json') as Vars;
  let refuse = 0;
  const posted: unknown[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const token = (name: string, type: string, valueLight: string, valueDark = '') =>
    t.call(ada, 'PUT', P('/tokens/' + name), { type, valueLight, valueDark });

  beforeAll(async () => {
    figma = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const send = (status: number, o: unknown): void => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(o));
        };
        if (req.headers['x-figma-token'] !== TOKEN) {
          send(403, { status: 403, err: 'Invalid token' });
          return;
        }
        if (refuse) {
          send(refuse, { status: refuse, error: true, message: 'Limited by Figma plan' });
          return;
        }
        const base = '/v1/files/' + FILE;
        if (req.method === 'GET' && req.url === base + '/variables/local') {
          send(200, vars);
          return;
        }
        if (req.method === 'GET' && req.url === base + '/components') {
          send(200, fixture('components.json'));
          return;
        }
        if (req.method === 'POST' && req.url === base + '/variables') {
          posted.push(JSON.parse(raw));
          send(200, {
            status: 200,
            error: false,
            meta: { tempIdToRealId: { 'tmp:radius.md': 'VariableID:3:30' } },
          });
          return;
        }
        send(404, { status: 404, err: 'Not found' });
      });
    });
    await listenFetchable(figma); // [PCODE-365 | S15 | v0.1.0]
    figmaUrl = 'http://127.0.0.1:' + String((figma.address() as AddressInfo).port);

    t = await startTestApp();
    ada = await t.signup('Ada');
    mia = await t.signup('Mia');
    await t.call(ada, 'POST', W('/members'), { email: mia.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'FIG', name: 'Figma' })
    ).body.id;
    await token('color.primary', 'color', '#4f46e5', '#818cf8');
    await token('color.text', 'color', '#111827', '#e5e7eb');
    await token('space.4', 'dimension', '1rem');
    await token('radius.md', 'dimension', '8px');
    for (const name of ['Button', 'Card', 'Map pin'])
      await t.call(ada, 'POST', P('/components'), { name });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    figma.close();
  });

  type Change = { name: string; kind: string; to: { light: string } | null };
  type Plan = { pull: Change[]; push: Change[]; conflicts: { name: string }[]; inSync: number };
  const names = (l: { name: string }[]): string[] => l.map((x) => x.name);

  it('links a file, compares the first time, links components and keeps the token sealed', async () => {
    const link = {
      file: 'https://www.figma.com/design/' + FILE + '/NWL-Design-system?node-id=0-1',
      token: TOKEN,
      apiUrl: figmaUrl,
    };
    expect((await t.call(mia, 'PUT', P('/figma'), link)).status).toBe(403); // admins link
    expect(
      (await t.call(ada, 'PUT', P('/figma'), { ...link, file: 'not a figma link' })).status,
    ).toBe(400);
    expect(
      (await t.call(ada, 'PUT', P('/figma'), { ...link, apiUrl: 'http://figma.example.com' }))
        .status,
    ).toBe(400);
    const put = await t.call(ada, 'PUT', P('/figma'), link);
    expect(put.body).toMatchObject({ fileKey: FILE, hasToken: true });
    expect(JSON.stringify(put.body)).not.toContain(TOKEN);
    const stored = await inSystem(t.db.pool, (c) =>
      c.query<{ api_token: string }>('SELECT api_token FROM figma_links WHERE project_id = $1', [
        project,
      ]),
    );
    expect(stored.rows[0]?.api_token).not.toContain(TOKEN);

    const r = await t.call<{
      plan: Plan;
      skipped: { name: string; reason: string }[];
      link: { componentsLinked: number };
    }>(mia, 'POST', P('/figma/check'), {});
    expect(r.status).toBe(200);
    // no sync before: one-sided tokens are additions, different ones conflicts
    expect(names(r.body.plan.pull)).toEqual([
      'color.brand',
      'font.family.body',
      'font.weight.bold',
    ]);
    expect(names(r.body.plan.push)).toEqual(['radius.md']);
    expect(names(r.body.plan.conflicts)).toEqual(['color.primary', 'color.text']); // the high-contrast mode, the dark text
    expect(r.body.plan.inSync).toBe(1); // space.4: 1rem is 16 px
    expect(r.body.plan.pull[0]?.to?.light).toBe('{color.primary}');
    expect(r.body.skipped).toEqual([
      { name: 'Flags/Beta banner', reason: 'true/false values have no token type' },
    ]);
    expect(r.body.link.componentsLinked).toBe(2);
    const comps = (
      await t.call<{ name: string; designUrl: string }[]>(mia, 'GET', P('/components'))
    ).body;
    expect(comps.find((x) => x.name === 'Button')?.designUrl).toBe(
      'https://www.figma.com/design/' + FILE + '/?node-id=12-340',
    );
    expect(comps.find((x) => x.name === 'Map pin')?.designUrl).toBe('');
  });

  it('takes and sends in one go, and is in sync after', async () => {
    const r = await t.call<{ taken: number; sent: number; notSent: unknown[]; plan: Plan }>(
      mia,
      'POST',
      P('/figma/apply'),
      {
        take: ['color.brand', 'font.family.body', 'font.weight.bold', 'color.primary'],
        send: ['radius.md', 'color.text'],
      },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ taken: 4, sent: 2, notSent: [] });
    expect(r.body.plan).toMatchObject({ pull: [], push: [], conflicts: [], inSync: 7 });
    // one request to Figma: radius.md created in the first collection with its modes, the text updated
    expect(posted).toHaveLength(1);
    const body = posted[0] as {
      variables: {
        action: string;
        name?: string;
        id: string;
        variableCollectionId?: string;
        resolvedType?: string;
      }[];
      variableModeValues: { variableId: string; modeId: string; value: unknown }[];
    };
    expect(body.variables).toEqual([
      {
        action: 'CREATE',
        id: 'tmp:radius.md',
        name: 'radius/md',
        variableCollectionId: 'VariableCollectionId:1:2',
        resolvedType: 'FLOAT',
      },
    ]);
    expect(
      body.variableModeValues
        .filter((v) => v.variableId === 'tmp:radius.md')
        .map((v) => [v.modeId, v.value]),
    ).toEqual([
      ['1:0', 8],
      ['1:1', 8],
      ['1:2', 8],
    ]);
    expect(
      body.variableModeValues.find((v) => v.variableId === 'VariableID:1:11' && v.modeId === '1:1')
        ?.value,
    ).toEqual({
      r: 0.898,
      g: 0.9059,
      b: 0.9216,
      a: 1,
    });
    // in Orqiva: the alias, the weight, the family, and a theme for the high-contrast mode
    const tokens = (
      await t.call<{
        tokens: {
          name: string;
          type: string;
          valueLight: string;
          themeValues: Record<string, string>;
        }[];
        themes: { name: string }[];
      }>(mia, 'GET', P('/tokens'))
    ).body;
    const by = (n: string) => tokens.tokens.find((x) => x.name === n);
    expect(by('color.brand')).toMatchObject({ type: 'color', valueLight: '{color.primary}' });
    expect(by('font.weight.bold')).toMatchObject({ type: 'fontWeight', valueLight: '700' });
    expect(by('font.family.body')).toMatchObject({ type: 'fontFamily', valueLight: 'Inter' });
    expect(by('color.primary')?.themeValues).toEqual({ 'high-contrast': '#3730a3' });
    expect(tokens.themes.map((x) => x.name)).toContain('high-contrast');
  });

  it('after a sync, tells a change on one side from changes on both', async () => {
    // Figma: the designer darkens the primary and makes bold 800; Orqiva: space.4 grows, bold becomes 600
    const v = vars.meta.variables;
    (v['VariableID:1:10'] as { valuesByMode: Record<string, unknown> }).valuesByMode['1:0'] = {
      r: 0.2627,
      g: 0.2196,
      b: 0.7922,
      a: 1,
    };
    (v['VariableID:2:21'] as { valuesByMode: Record<string, unknown> }).valuesByMode['2:0'] = 800;
    // Figma now also holds what was sent
    v['VariableID:3:30'] = {
      id: 'VariableID:3:30',
      name: 'radius/md',
      variableCollectionId: 'VariableCollectionId:1:2',
      resolvedType: 'FLOAT',
      valuesByMode: { '1:0': 8, '1:1': 8, '1:2': 8 },
    } as unknown as Vars['meta']['variables'][string];
    (v['VariableID:1:11'] as { valuesByMode: Record<string, unknown> }).valuesByMode['1:1'] = {
      r: 0.898,
      g: 0.9059,
      b: 0.9216,
      a: 1,
    };
    // and for the high-contrast mode the light value, as sent
    (v['VariableID:1:11'] as { valuesByMode: Record<string, unknown> }).valuesByMode['1:2'] = {
      r: 0.0667,
      g: 0.0941,
      b: 0.1529,
      a: 1,
    };
    await token('space.4', 'dimension', '20px');
    await t.call(ada, 'PUT', P('/tokens/font.weight.bold'), {
      type: 'fontWeight',
      valueLight: '600',
    });
    const r = await t.call<{ plan: Plan }>(mia, 'POST', P('/figma/check'), {});
    expect(names(r.body.plan.pull)).toEqual(['color.primary']);
    expect(r.body.plan.pull[0]?.to?.light).toBe('#4338ca');
    expect(names(r.body.plan.push)).toEqual(['space.4']);
    expect(names(r.body.plan.conflicts)).toEqual(['font.weight.bold']);
    // a name that waits for nothing is refused rather than guessed
    expect(
      (await t.call(mia, 'POST', P('/figma/apply'), { take: ['color.text'], send: [] })).status,
    ).toBe(409);
    expect(
      (await t.call(mia, 'POST', P('/figma/apply'), { take: ['space.4'], send: ['space.4'] }))
        .status,
    ).toBe(400);
    // Orqiva's bold wins the conflict; the primary is taken
    const done = await t.call<{ plan: Plan }>(mia, 'POST', P('/figma/apply'), {
      take: ['color.primary'],
      send: ['font.weight.bold', 'space.4'],
    });
    expect(done.body.plan).toMatchObject({ pull: [], push: [], conflicts: [] });
    const last = posted.at(-1) as { variableModeValues: { variableId: string; value: unknown }[] };
    expect(last.variableModeValues).toEqual(
      expect.arrayContaining([
        { variableId: 'VariableID:2:21', modeId: '2:0', value: 600 },
        { variableId: 'VariableID:2:20', modeId: '2:0', value: 20 },
      ]),
    );
  });

  it('says plainly when Figma refuses', async () => {
    refuse = 403;
    const r = await t.call<{ error: { message: string } }>(mia, 'POST', P('/figma/check'), {});
    refuse = 0;
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('Variables need a Figma Enterprise plan');
    // a wrong token
    await t.call(ada, 'PUT', P('/figma'), {
      file: FILE,
      token: 'figd_another-token',
      apiUrl: figmaUrl,
    });
    expect((await t.call(mia, 'POST', P('/figma/check'), {})).status).toBe(409);
    // leaving the token out keeps the one set
    await t.call(ada, 'PUT', P('/figma'), { file: FILE, token: TOKEN, apiUrl: figmaUrl });
    await t.call(ada, 'PUT', P('/figma'), { file: FILE, apiUrl: figmaUrl });
    expect((await t.call(mia, 'POST', P('/figma/check'), {})).status).toBe(200);
    vars = fixture('variables-local.json') as Vars;
  });
});
