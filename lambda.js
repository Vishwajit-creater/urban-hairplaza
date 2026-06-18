'use strict';
/**
 * AWS Lambda entry point.
 *
 * Wraps the Express app with serverless-http for API Gateway invocation.
 * Database is Supabase (PostgreSQL) — persistent and always-on, so no
 * auto-seeding needed here. Run `npm run seed` once during setup.
 */

require('dotenv').config();
const serverlessHttp = require('serverless-http');
const app            = require('./backend/server');

exports.handler = serverlessHttp(app, {
  binary: ['image/*', 'font/*', 'application/octet-stream'],
  request(request) {
    if (!request.path.startsWith('/')) request.path = '/' + request.path;
  },
});
