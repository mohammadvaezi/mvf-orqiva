// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
//    Why:  visual checks against the real database and file store: a first screenshot waits for approval,
//          an approved one is the baseline, a small change passes within the allowed share and a larger one
//          fails with a diff image, a new size fails with its reason; screenshots skip the reading queue.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { decodePng, encodePng, type Rgba } from '../../src/files/png.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const screen = (w: number, h: number, dots: [number, number][] = []): Buffer => {
  const data = new Uint8Array(w * h * 4).fill(255);
  for (const [x, y] of dots) data.set([0, 0, 0, 255], (y * w + x) * 4);
  const img: Rgba = { width: w, height: h, data };
  return encodePng(img);
};

describe.skipIf(!hasDatabase)('visual regression (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let aud: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const upload = async (data: Buffer, read = false): Promise<string> =>
    (
      (await (
        await fetch(
          t.base + W('/files?name=shot.png&projectId=' + project + (read ? '' : '&read=0')),
          {
            method: 'POST',
            headers: { cookie: ada.cookie, 'content-type': 'image/png' },
            body: data,
          },
        )
      ).json()) as { id: string }
    ).id;
  type Run = {
    id: string;
    status: string;
    reason: string;
    changed: number;
    diffUrl: string | null;
    box: unknown;
  };
  const check = async (name: string, data: Buffer, commit?: string) =>
    t.call<Run>(ada, 'POST', P('/visual/checks'), {
      name,
      fileId: await upload(data),
      ...(commit ? { commit } : {}),
    });

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    aud = await t.signup('Aud');
    await t.call(ada, 'POST', W('/members'), { email: aud.email, role: 'auditor' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'VIS', name: 'Visual' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('waits for a baseline, then passes, fails with a diff, and fails on a new size', async () => {
    const first = await check('Sign in / desktop', screen(100, 100), 'abc1234');
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'new', diffUrl: null });
    expect(
      (await t.call(aud, 'POST', W('/visual-runs/' + first.body.id + '/approve'), {})).status,
    ).toBe(403);
    const base = await t.call<{ id: string; maxDiff: number }>(
      ada,
      'POST',
      W('/visual-runs/' + first.body.id + '/approve'),
      {},
    );
    expect(base.body.maxDiff).toBeCloseTo(0.001);

    // 5 of 10 000 pixels: 0.05 %, within the 0.1 % allowed
    const small = await check(
      'Sign in / desktop',
      screen(100, 100, [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
      ]),
    );
    expect(small.body).toMatchObject({ status: 'pass', changed: 5 });
    expect(small.body.reason).toContain('within the 0.10 % allowed');

    const dots: [number, number][] = [];
    for (let i = 0; i < 40; i += 1) dots.push([10 + i, 20]);
    const big = await check('Sign in / desktop', screen(100, 100, dots));
    expect(big.body).toMatchObject({
      status: 'fail',
      changed: 40,
      box: { x: 10, y: 20, w: 40, h: 1 },
    });
    // the diff image is a real PNG of the screen's size, red where it changed
    const diff = decodePng(
      Buffer.from(
        await (
          await fetch(t.base + (big.body.diffUrl ?? ''), { headers: { cookie: aud.cookie } })
        ).arrayBuffer(),
      ),
    );
    expect([
      diff.width,
      ...diff.data.subarray((20 * 100 + 10) * 4, (20 * 100 + 10) * 4 + 3),
    ]).toEqual([100, 230, 30, 60]);

    const wider = await check('Sign in / desktop', screen(120, 100));
    expect(wider.body).toMatchObject({
      status: 'fail',
      reason: 'The size changed: 100 × 100 to 120 × 100',
    });

    // the screen is listed failing, with its baseline and how many checks it had
    const list = (
      await t.call<
        { name: string; baseline: { id: string } | null; latest: Run; checks: number }[]
      >(aud, 'GET', P('/visual'))
    ).body;
    expect(list.map((x) => [x.name, x.checks, x.latest.status, Boolean(x.baseline)])).toEqual([
      ['Sign in / desktop', 4, 'fail', true],
    ]);
    // allowing more lets the same change pass next time; approving makes it the baseline
    await t.call(ada, 'PATCH', W('/visual-baselines/' + base.body.id), { maxDiff: 0.01 });
    expect((await check('Sign in / desktop', screen(100, 100, dots))).body.status).toBe('pass');
    await t.call(ada, 'POST', W('/visual-runs/' + wider.body.id + '/approve'), {});
    expect((await check('Sign in / desktop', screen(120, 100))).body).toMatchObject({
      status: 'pass',
      reason: 'No pixel changed',
    });
    const runs = (
      await t.call<Run[]>(
        aud,
        'GET',
        P('/visual/runs?name=' + encodeURIComponent('Sign in / desktop')),
      )
    ).body;
    // latest first: the check at the new size, the one under the raised share, the wider one approved
    expect(runs.map((r) => r.status)).toEqual([
      'pass',
      'pass',
      'approved',
      'fail',
      'pass',
      'approved',
    ]);
  });

  it('refuses what is no screenshot of the project and skips reading screenshots', async () => {
    expect((await check('../escape', screen(4, 4))).status).toBe(400);
    expect((await check('Bad commit', screen(4, 4), 'not a hash!')).status).toBe(400);
    const text = (
      (await (
        await fetch(t.base + W('/files?name=a.txt&projectId=' + project), {
          method: 'POST',
          headers: { cookie: ada.cookie, 'content-type': 'text/plain' },
          body: 'hello',
        })
      ).json()) as { id: string }
    ).id;
    const notPng = await t.call<{ error: { details: { message: string }[] } }>(
      ada,
      'POST',
      P('/visual/checks'),
      {
        name: 'Text',
        fileId: text,
      },
    );
    expect(notPng.status).toBe(400);
    expect(notPng.body.error.details[0]?.message).toBe('Not a PNG');
    // the screenshots of this test were never queued for reading; a plain image upload is
    const queued = async (id: string) =>
      (
        await inSystem(t.db.pool, (c) =>
          c.query('SELECT 1 FROM file_reads WHERE file_id = $1', [id]),
        )
      ).rowCount;
    expect(await queued(await upload(screen(4, 4)))).toBe(0);
    expect(await queued(await upload(screen(4, 4), true))).toBe(1);
  });
});
