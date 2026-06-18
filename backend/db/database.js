'use strict';
/**
 * Database module — Supabase PostgreSQL via node-postgres (pg).
 */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL && !process.env.PGHOST) {
  throw new Error(
    'No database configuration found.\n' +
    'Set DATABASE_URL  OR  the PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD env vars.'
  );
}

const IS_LAMBDA = !!process.env.LAMBDA_TASK_ROOT;

// Build connection config
let connectionString = process.env.DATABASE_URL;

// Supabase pooler (port 6543) requires pgbouncer=true
// Supabase direct (port 5432) requires sslmode=require
if (connectionString) {
  if (!connectionString.includes('sslmode=')) {
    const sep = connectionString.includes('?') ? '&' : '?';
    connectionString += `${sep}sslmode=require`;
  }
  // Add pgbouncer flag for transaction pooler (port 6543)
  if (connectionString.includes(':6543') && !connectionString.includes('pgbouncer=')) {
    connectionString += '&pgbouncer=true';
  }
}

const poolConfig = {
  ...(connectionString ? { connectionString } : {}),
  ssl: { rejectUnauthorized: false },
  max: IS_LAMBDA ? 1 : 10,
  idleTimeoutMillis: IS_LAMBDA ? 0 : 30_000,
  connectionTimeoutMillis: 15_000,
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Test connection on startup
pool.query('SELECT 1')
  .then(() => console.log('[DB] ✅ Connected to Supabase PostgreSQL'))
  .catch(err => console.error('[DB] ❌ Connection failed:', err.message));

// Convenience query helper
pool.db = (text, params) => pool.query(text, params);

module.exports = pool;
