// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-87 | S15 | v0.1.0] Create the PostgreSQL schema v1 with our own migration runner and row-level security ──
//    Why:  migrations are numbered SQL files (0001_name.sql) applied once, in order, each in its own
//          transaction, and recorded with a checksum. A file changed after it ran is an error, not a silent
//          drift. An advisory lock lets several server instances start at once without running twice.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

/** The folder of SQL files shipped with the server (packages/server/migrations). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Arbitrary constant: the advisory lock key every Orqiva migrator agrees on. */
const LOCK_KEY = 4_771_001;

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const migrations = files.map((file) => {
    const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!m) throw new Error('Migration file name must be NNNN_name.sql: ' + file);
    const sql = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    return {
      version: Number(m[1]),
      name: m[2] ?? '',
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  });
  migrations.forEach((mig, i) => {
    if (mig.version !== i + 1)
      throw new Error(
        'Migrations must be numbered 0001, 0002, … without gaps; found ' +
          String(mig.version) +
          ' at position ' +
          String(i + 1),
      );
  });
  return migrations;
}

export interface MigrateResult {
  applied: number[];
  current: number;
}

export async function migrate(pool: Pool, migrations = loadMigrations()): Promise<MigrateResult> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version     integer PRIMARY KEY,
      name        text NOT NULL,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Map<number, string>();
    for (const row of (
      await client.query<{ version: number; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations',
      )
    ).rows) {
      done.set(row.version, row.checksum);
    }
    const applied: number[] = [];
    for (const mig of migrations) {
      const known = done.get(mig.version);
      if (known !== undefined) {
        if (known !== mig.checksum) {
          throw new Error(
            'Migration ' +
              String(mig.version).padStart(4, '0') +
              '_' +
              mig.name +
              ' was changed after it was applied; add a new migration instead',
          );
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(mig.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [mig.version, mig.name, mig.checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          'Migration ' +
            String(mig.version).padStart(4, '0') +
            '_' +
            mig.name +
            ' failed: ' +
            (err instanceof Error ? err.message : String(err)),
          { cause: err },
        );
      }
      applied.push(mig.version);
    }
    for (const unknown of [...done.keys()].filter((v) => v > migrations.length)) {
      throw new Error(
        'The database has migration ' +
          String(unknown) +
          ', which this server does not know; it is older than the database',
      );
    }
    return { applied, current: migrations.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
