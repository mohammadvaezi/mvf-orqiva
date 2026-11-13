// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-161 | S15 | v0.1.0] B0 data model v2: model for all approved screens and the foundation migrations ──
// ── [PCODE-87 | S15 | v0.1.0] Create the PostgreSQL schema v1 with our own migration runner and row-level security ──
//    Why:  the only two ways the server touches the database. inWorkspace() is for tenant data: it switches
//          to the restricted role and pins the workspace for the transaction, so row-level security decides
//          what is visible. inSystem() is for the few global operations (sign-up, login lookup) and is kept
//          deliberately rare and visible in code review.
import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

export function createPool(connectionString: string, max = 10): Pool {
  return new pg.Pool({ connectionString, max, application_name: 'orqiva-server' });
}

async function transaction<T>(
  pool: Pool,
  setup: (c: PoolClient) => Promise<void>,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setup(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs fn in a transaction that sees exactly one workspace's rows, as the role orqiva_app (a member of the older prodengine_app, whose grants it inherits). */
export function inWorkspace<T>(
  pool: Pool,
  workspaceId: string,
  fn: (c: PoolClient) => Promise<T>,
  // [PCODE-161 | S15 | v0.1.0] a client contact's transaction: row-level security then hides every row
  // of other clients and everything the team keeps to itself (see 0032_clients.sql)
  opts: { clientId?: string } = {},
): Promise<T> {
  if (!UUID.test(workspaceId))
    return Promise.reject(
      new Error('inWorkspace needs a workspace id, got ' + JSON.stringify(workspaceId)),
    );
  if (opts.clientId !== undefined && !UUID.test(opts.clientId))
    return Promise.reject(
      new Error('inWorkspace needs a client id, got ' + JSON.stringify(opts.clientId)),
    );
  return transaction(
    pool,
    async (c) => {
      await c.query('SET LOCAL ROLE orqiva_app');
      await c.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      if (opts.clientId)
        await c.query("SELECT set_config('app.client_id', $1, true)", [opts.clientId]);
    },
    fn,
  );
}

/**
 * Runs fn in a transaction as the owner in system mode, across workspaces: global operations only.
 * The server must connect as a non-superuser owner (see 0001_core_schema.sql); a superuser would
 * bypass row-level security everywhere, so startup refuses one (assertNotSuperuser).
 */
export function inSystem<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return transaction(
    pool,
    async (c) => {
      await c.query("SELECT set_config('app.system', 'on', true)");
    },
    fn,
  );
}

/** Row-level security means nothing to a superuser; the server refuses to run as one. */
export async function assertNotSuperuser(pool: Pool): Promise<void> {
  const row = (
    await pool.query<{ su: boolean; bypass: boolean }>(
      'SELECT rolsuper AS su, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user',
    )
  ).rows[0];
  if (row?.su || row?.bypass) {
    throw new Error(
      'The database user is a superuser or bypasses row-level security; connect Orqiva as a normal owner role',
    );
  }
}
