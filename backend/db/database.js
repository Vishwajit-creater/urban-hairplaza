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

// Build connection config — strip conflicting SSL params from URL
// then let the pool's ssl:{rejectUnauthorized:false} handle it.
let connectionString = process.env.DATABASE_URL;

if (connectionString) {
  // Remove sslmode from URL — we set ssl via pool config below
  connectionString = connectionString
    .replace(/[?&]sslmode=[^&]*/g, '')
    .replace(/\?&/, '?')
    .replace(/&&/g, '&')
    .replace(/[?&]$/, '');

  // Add pgbouncer=true for transaction pooler (port 6543)
  if (connectionString.includes(':6543') && !connectionString.includes('pgbouncer=')) {
    const sep = connectionString.includes('?') ? '&' : '?';
    connectionString += `${sep}pgbouncer=true`;
  }
}

const poolConfig = {
  ...(connectionString ? { connectionString } : {}),
  ssl: { rejectUnauthorized: false },   // trust Supabase self-signed cert
  max: IS_LAMBDA ? 1 : 5,
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
