'use strict';

// Suppress Node.js experimental SQLite warning in production
if (process.env.NODE_ENV === 'production') {
  const originalEmit = process.emit.bind(process);
  process.emit = function (event, warning, ...args) {
    if (event === 'warning' && warning?.name === 'ExperimentalWarning'
        && warning?.message?.includes('SQLite')) return false;
    return originalEmit(event, warning, ...args);
  };
}

// Uses Node.js built-in 'node:sqlite' (available since Node.js v22.5.0)
// No native build tools required — works on all platforms out of the box.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DB_PATH     = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, 'urban_hairplaza.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure DB directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Performance + safety pragmas
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA cache_size = -20000;'); // 20MB page cache
db.exec('PRAGMA temp_store = MEMORY;');

// Initialize schema (IF NOT EXISTS guards make this idempotent)
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

module.exports = db;
