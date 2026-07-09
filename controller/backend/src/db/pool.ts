// src/db/pool.ts
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import config from '../config';

export const pool = new Pool({
  host:     config.pgHost,
  port:     config.pgPort,
  database: config.pgDatabase,
  user:     config.pgUser,
  password: config.pgPassword,
  max:      config.pgPoolMax,
  ssl:      config.pgSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => console.error('[db] Unexpected pool error:', err.message));

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  sql: string, params?: unknown[]
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try { return await client.query<T>(sql, params); }
  finally { client.release(); }
}

export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  sql: string, params?: unknown[]
): Promise<T | null> {
  const result = await query<T>(sql, params);
  return result.rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
