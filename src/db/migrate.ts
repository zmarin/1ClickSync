/**
 * Simple SQL migration runner.
 * Migrations live in src/db/migrations/ as numbered SQL files: 001_initial.sql, 002_add_foo.sql, etc.
 * Tracks applied migrations in a `schema_migrations` table.
 *
 * Usage: npx tsx src/db/migrate.ts
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { pool } from './index';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(result.rows.map((r: any) => r.version));
}

async function getPendingMigrations(): Promise<{ version: string; file: string }[]> {
  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files
    .filter(f => f.endsWith('.sql'))
    .sort(); // lexicographic = chronological with zero-padded names

  const applied = await getAppliedMigrations();
  return sqlFiles
    .filter(f => !applied.has(f))
    .map(f => ({ version: f, file: path.join(MIGRATIONS_DIR, f) }));
}

async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const pending = await getPendingMigrations();

  if (pending.length === 0) {
    console.log('[Migrate] Database is up to date');
    return;
  }

  console.log(`[Migrate] ${pending.length} pending migration(s)`);

  for (const migration of pending) {
    const sql = await readFile(migration.file, 'utf-8');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [migration.version]
      );
      await client.query('COMMIT');
      console.log(`[Migrate] Applied: ${migration.version}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Migrate] FAILED: ${migration.version}`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('[Migrate] All migrations applied');
}

// Run if called directly
runMigrations()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
