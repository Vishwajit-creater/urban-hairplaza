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
  // ── Auto-convert direct Supabase URL → pooler URL ──────────────────────
  // Direct:  postgresql://postgres:PWD@db.REF.supabase.co:5432/postgres
  // Pooler:  postgresql://postgres.REF:PWD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
  //
  // Render free tier is IPv4-only; direct host resolves to IPv6 → fails.
  // Pooler host is IPv4. We auto-convert if we detect the direct host.
  const directMatch = connectionString.match(
    /^(postgresql|postgres):\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co:5432\/(.+)$/
  );
  if (directMatch) {
    const [, scheme, user, pass, ref, db] = directMatch;
    // Use project ref in username only if not already there
    const poolUser = user.includes('.') ? user : `${user}.${ref}`;
    connectionString =
      `${scheme}://${poolUser}:${pass}@aws-0-ap-south-1.pooler.supabase.com:6543/${db}`;
    console.log('[DB] Auto-converted to Supabase pooler URL (IPv4)');
  }

  // Remove sslmode from URL — handled by pool ssl config below
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
