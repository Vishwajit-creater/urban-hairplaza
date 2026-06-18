'use strict';
/**
 * setup-db.js — One-time Supabase database initialiser.
 * Runs the PostgreSQL schema (CREATE TABLE IF NOT EXISTS) then seeds demo data.
 *
 *   node setup-db.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🔌 Connecting to Supabase...');

    // Test connection
    const { rows: [ver] } = await client.query('SELECT version()');
    console.log('✅ Connected!');
    console.log('   PostgreSQL:', ver.version.split(' ').slice(0, 2).join(' '));

    // Apply schema
    console.log('\n📐 Applying schema...');
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'backend', 'db', 'schema.sql'), 'utf8'
    );
    await client.query(schemaSQL);
    console.log('✅ Schema applied (all tables created)');
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }

  // Run seed (uses its own pool)
  console.log('\n🌱 Running seed script...');
  require('./backend/db/seed.js');
}

run();
