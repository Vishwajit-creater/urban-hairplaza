'use strict';
/**
 * Database module — Supabase PostgreSQL via node-postgres (pg).
 *
 * Connection is configured through the DATABASE_URL environment variable.
 * Supabase provides two connection strings per project:
 *   • Direct connection   : postgres://postgres:[pwd]@db.[ref].supabase.co:5432/postgres
 *   • Transaction pooler  : postgres://postgres.[ref]:[pwd]@aws-0-[region].pooler.supabase.com:6543/postgres
 *
 * For AWS Lambda (serverless) use the TRANSACTION POOLER URL and add
 * ?pgbouncer=true to the connection string.  For local development the
 * direct connection string works fine.
 */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is not set.\n' +
    'Copy .env.example to .env and add your Supabase connection string.'
  );
}

const IS_LAMBDA = !!process.env.LAMBDA_TASK_ROOT;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL; rejectUnauthorized=false accepts self-signed certs
  ssl: { rejectUnauthorized: false },
  // In Lambda each container handles one request at a time —
  // a pool of 1 avoids "too many connections" across concurrent invocations.
  max: IS_LAMBDA ? 1 : 10,
  idleTimeoutMillis: IS_LAMBDA ? 0 : 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// ── Convenience query helper ───────────────────────────────────────────────
/**
 * Execute a SQL query and return the full pg Result object.
 * Usage:  const { rows } = await db.query('SELECT ...', [params]);
 */
pool.db = (text, params) => pool.query(text, params);

module.exports = pool;
