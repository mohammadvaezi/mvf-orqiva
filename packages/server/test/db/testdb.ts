// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-87 | S15 | v0.1.0] Create the PostgreSQL schema v1 with our own migration runner and row-level security ──
//    Why:  database tests run against a real PostgreSQL, never a mock: row-level security is the claim
//          under test. Each run creates its own database and drops it afterwards. Without
//          ORQIVA_TEST_DATABASE_URL the suites are skipped and say so; CI on Ubuntu always sets it.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Pool } from 'pg';
import { migrate } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';

export const ADMIN_URL = process.env['ORQIVA_TEST_DATABASE_URL'];
export const hasDatabase = Boolean(ADMIN_URL);

const OWNER = 'pe_test_owner';
const ROLE_LOCK = 4_771_002;
const OWNER_PASSWORD = 'pe_test_owner';

export interface TestDb {
  url: string;
  pool: Pool;
  drop(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  if (!ADMIN_URL) throw new Error('ORQIVA_TEST_DATABASE_URL is not set');
  const name = 'pe_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query('SELECT pg_advisory_lock($1)', [ROLE_LOCK]);
  // the server connects as a normal owner role, never a superuser: the tests do the same
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${OWNER}') THEN
      CREATE ROLE ${OWNER} LOGIN PASSWORD '${OWNER_PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEROLE;
    END IF; END $$`);
  await admin.query('CREATE DATABASE ' + name + ' OWNER ' + OWNER);
  const url = new URL(ADMIN_URL);
  url.pathname = '/' + name;
  url.username = OWNER;
  url.password = OWNER_PASSWORD;
  const pool = createPool(url.toString(), 4);
  // [PCODE-93 | S15 | v0.1.0] roles are cluster-wide: suites running in parallel would race to create and
  //    grant prodengine_app and orqiva_app. The first migration of every test database runs under one cluster lock.
  try {
    await migrate(pool);
  } finally {
    await admin.query('SELECT pg_advisory_unlock($1)', [ROLE_LOCK]).catch(() => undefined);
    await admin.end();
  }
  return {
    url: url.toString(),
    pool,
    async drop() {
      await pool.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)');
      await a.end();
    },
  };
}
