'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const compression = require('compression');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Security Headers (Helmet) ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      fontSrc:    ["'self'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'https://images.unsplash.com', 'https://*.unsplash.com'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: isProd
    ? (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      }
    : true,
  credentials: true,
}));

// ── Request Logging ────────────────────────────────────────────────────────
app.use(morgan(isProd ? 'combined' : 'dev'));

// ── Compression ────────────────────────────────────────────────────────────
app.use(compression());

// ── Body Parsers ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Global API Rate Limiter ────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests — please try again later.' },
});
app.use('/api/', globalLimiter);

// ── Stricter Rate Limiter for Auth Endpoints ───────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts — please try again in 15 minutes.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ── Static Frontend Portals ────────────────────────────────────────────────
const staticOpts = { maxAge: isProd ? '1h' : 0 };
app.use('/customer', express.static(path.join(__dirname, '../frontend/customer'), staticOpts));
app.use('/owner',    express.static(path.join(__dirname, '../frontend/owner'),    staticOpts));
app.use('/admin',    express.static(path.join(__dirname, '../frontend/admin'),    staticOpts));

// Root redirect → Customer portal
app.get('/', (_req, res) => res.redirect('/customer'));

// ── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/salons',   require('./routes/salons'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/owner',    require('./routes/owner'));
app.use('/api/admin',    require('./routes/admin'));

// ── API 404 Handler ────────────────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found.` });
});

// ── SPA Fallback for each portal ──────────────────────────────────────────
app.get('/customer/*', (_req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/customer/index.html')));
app.get('/owner/*',    (_req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/owner/index.html')));
app.get('/admin/*',    (_req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/admin/index.html')));

// ── Global Error Handler ───────────────────────────────────────────────────
app.use(require('./middleware/errorHandler'));

// ── Graceful Shutdown (only relevant for persistent server) ───────────────
process.on('SIGTERM', () => {
  console.log('SIGTERM received — closing server gracefully...');
  if (global._uhpServer) global._uhpServer.close(() => process.exit(0));
  else process.exit(0);
});
process.on('uncaughtException',  err => { console.error('Uncaught:', err);  process.exit(1); });
process.on('unhandledRejection', err => { console.error('Unhandled:', err); process.exit(1); });

// ── Start (skipped when running inside AWS Lambda) ─────────────────────────
const IS_LAMBDA = !!process.env.LAMBDA_TASK_ROOT;
if (!IS_LAMBDA) {
  const serverInstance = app.listen(PORT, () => {
    const env = process.env.NODE_ENV || 'development';
    console.log(`
\x1b[33m
 ██╗   ██╗██╗  ██╗██████╗ 
 ██║   ██║██║  ██║██╔══██╗
 ██║   ██║███████║██████╔╝
 ██║   ██║██╔══██║██╔═══╝ 
 ╚██████╔╝██║  ██║██║     
  ╚═════╝ ╚═╝  ╚═╝╚═╝     
\x1b[0m
\x1b[1mUrban HairPlaza\x1b[0m — Multi-Vendor Salon Platform  [\x1b[36m${env}\x1b[0m]
─────────────────────────────────────────────
  Server:    \x1b[32mhttp://localhost:${PORT}\x1b[0m
  Customer:  \x1b[36mhttp://localhost:${PORT}/customer\x1b[0m
  Owner:     \x1b[36mhttp://localhost:${PORT}/owner\x1b[0m
  Admin:     \x1b[36mhttp://localhost:${PORT}/admin\x1b[0m
  API:       \x1b[36mhttp://localhost:${PORT}/api\x1b[0m
─────────────────────────────────────────────
`);
  });
  global._uhpServer = serverInstance;
}

module.exports = app;

