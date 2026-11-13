// ── [PCODE-267 | S15 | v0.1.0] Push keys survive a changed server key: Notifications settings answered 500 ──
//    Why:  push keys sealed under an earlier server key cannot be opened; the server makes new ones and drops
//          the subscriptions made for the old ones instead of failing every push and the settings page.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seal } from '../../src/agents/secrets.js';
import { inSystem } from '../../src/db/pool.js';
import { vapidKeys } from '../../src/push/dispatch.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '3e'.repeat(32);

describe.skipIf(!hasDatabase)('push keys after a changed server key (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('makes new keys, drops old subscriptions, and the settings answer', async () => {
    const first = await vapidKeys(t.db.pool);
    await inSystem(t.db.pool, async (c) => {
      // sealed with another key, as after the server key changed
      await c.query("UPDATE instance_keys SET secret_ciphertext = $1 WHERE name = 'vapid'", [
        seal('not the key', Buffer.alloc(32, 7)),
      ]);
      await c.query(
        "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, 'https://fcm.googleapis.com/x', 'p', 'a')",
        [ada.id],
      );
    });
    const next = await vapidKeys(t.db.pool);
    expect(next.publicKey).not.toBe(first.publicKey);
    expect(next.privatePem).toContain('PRIVATE KEY');
    expect(await vapidKeys(t.db.pool)).toEqual(next);
    const left = await inSystem(t.db.pool, async (c) =>
      Number(
        (await c.query<{ n: string }>('SELECT count(*) AS n FROM push_subscriptions')).rows[0]?.n,
      ),
    );
    expect(left).toBe(0);
    expect((await t.call(ada, 'GET', '/api/push')).status).toBe(200);
  });
});
