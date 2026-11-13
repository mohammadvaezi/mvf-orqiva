// ── [PCODE-353 | S15 | v0.1.0] T35.4a System health page with backup, restore and upgrade wizards ──
//    Why:  against the real database: the health report is for the owner only, counts what is stuck, and
//          reads the backups folder when one is mounted.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupFolder } from '../../src/api/system.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('system health (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'admin' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('reports to the owner only, with what is stuck', async () => {
    expect((await t.call(bob, 'GET', W('/system/health'))).status).toBe(403);
    await inSystem(t.db.pool, (c) =>
      c.query(
        "INSERT INTO mail_outbox (to_address, subject, text_body, kind, created_at) VALUES ('x@example.test', 'Hi', 'x', 'notice', now() - interval '1 hour')",
      ),
    );
    type R = {
      version: string;
      database: { bytes: number; migration: string };
      queues: { mailStuck: number };
      backups: unknown;
      problems: string[];
    };
    const r = (await t.call<R>(ada, 'GET', W('/system/health'))).body;
    expect(r.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.database.bytes).toBeGreaterThan(0);
    expect(r.database.migration).not.toBe('');
    expect(r.queues.mailStuck).toBeGreaterThanOrEqual(1);
    expect(r.backups).toBeNull();
    expect(r.problems[0]).toContain('mails wait longer than 15 minutes');
  });

  it('reads the backups folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orq-backups-'));
    writeFileSync(join(dir, 'orqiva-20261015-0200.dump'), 'dump');
    writeFileSync(join(dir, 'orqiva-20261015-0200.dump.sha256'), 'abc');
    mkdirSync(join(dir, 'orqiva-20261015-0200-files'));
    const list = await backupFolder(dir);
    expect(list).toEqual([
      expect.objectContaining({
        name: 'orqiva-20261015-0200.dump',
        bytes: 4,
        checked: true,
        withFiles: true,
      }),
    ]);
    expect(await backupFolder(join(dir, 'missing'))).toBeNull();
    expect(await backupFolder(undefined)).toBeNull();
  });
});
