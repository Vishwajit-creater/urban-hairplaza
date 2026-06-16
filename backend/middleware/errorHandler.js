'use strict';

/**
 * Global Express error handler.
 * - Development: returns full stack trace for debugging.
 * - Production:  returns only a sanitized message (no internals exposed).
 */
module.exports = function errorHandler(err, req, res, _next) {
  const isProd = process.env.NODE_ENV === 'production';
  const status  = err.status || err.statusCode || 500;

  // Log server errors (5xx) always; client errors (4xx) only in dev
  if (status >= 500) {
    console.error(`[ERROR] ${req.method} ${req.originalUrl} → ${status}`);
    console.error(err);
  } else if (!isProd) {
    console.warn(`[WARN] ${req.method} ${req.originalUrl} → ${status}: ${err.message}`);
  }

  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(isProd ? {} : { stack: err.stack }),
  });
};
