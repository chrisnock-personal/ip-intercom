// src/db/migrate.ts
import fs from 'fs';
import path from 'path';
import { pool } from './pool';

// NB: path depth is container-layout-specific. The image places dist/ and
// migrations/ both directly under /app (see Containerfile), so from
// dist/db/migrate.js it's two levels up to /app, then into migrations/.
const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const { rows: applied } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename');
    const appliedSet = new Set(applied.map(r => r.filename));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

    let ran = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] Applying ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
        console.log(`[migrate] ✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    console.log(ran === 0 ? '[migrate] All migrations already applied' : `[migrate] ${ran} migration(s) applied`);
  } finally {
    client.release();
  }
}
