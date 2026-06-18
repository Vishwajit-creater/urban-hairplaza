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

// Supabase requires SSL — ensure sslmode is in the URL
if (connectionString && !connectionString.includes('sslmode=')) {
  const sep = connectionString.includes('?') ? '&' : '?';
  connectionString = `${connectionString}${sep}sslmode=require`;
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
