const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { router: apiRouter, metaRoutes, adminRoutes, healthHandler } = require('./routes');
const authRoutes = require('./auth-routes');
const { requireAuth, requireAdmin, loginLimiter } = require('./middleware');
const { DB_PATH } = require('./db');

const PORT = parseInt(process.env.PORT || '3500', 10);
const STATIC_ROOT = path.resolve(__dirname, '..');

const app = express();
app.set('trust proxy', 'loopback');

// ── Detect LAN IPs (used for CORS whitelist + startup banner) ──
const lanAddrs = [];
const ifaces = os.networkInterfaces();
for (const name of Object.keys(ifaces)) {
  for (const iface of ifaces[name]) {
    if (iface.family === 'IPv4' && !iface.internal) lanAddrs.push(iface.address);
  }
}

// ── CORS lockdown: only LAN origins, no longer a wildcard ──
const allowedOrigins = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`
]);
for (const a of lanAddrs) allowedOrigins.add(`http://${a}:${PORT}`);

app.use(cors({
  origin: (origin, cb) => {
    // no Origin header (same-origin XHR, curl, server-to-server) → allow
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    cb(new Error(`CORS: origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// strict:false so primitive meta values (true, numbers) parse
app.use(express.json({ limit: '20mb', strict: false }));

// Cache + light security headers
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer'
  });
  next();
});

// ── Block source-code / config paths from being served as static files ──
// Without this, GET /server/db.js, /server/routes.js etc. would leak the
// entire backend source because express.static is rooted at SCR FILES.
const BLOCKED_PATHS = ['/server', '/node_modules', '/.git', '/.env', '/.claude'];
app.use((req, res, next) => {
  for (const b of BLOCKED_PATHS) {
    if (req.path === b || req.path.startsWith(b + '/')) {
      return res.status(404).send('Not Found');
    }
  }
  next();
});

// Tiny access log
app.use((req, _res, next) => {
  console.log(`  ${req.method.padEnd(6)} ${req.url}`);
  next();
});

// ═══════════════════════════════════════════════════════════
//  PUBLIC ROUTES — no auth required
// ═══════════════════════════════════════════════════════════

// Health probe — must stay reachable so the watchdog / uptime monitors can check
app.get('/api/admin/health', healthHandler);

// Login (rate-limited) + logout + me — under /api/auth
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);

// ═══════════════════════════════════════════════════════════
//  AUTH GATE — everything below requires a valid Bearer token
// ═══════════════════════════════════════════════════════════
app.use('/api', requireAuth);

// ── Admin-only mutations ──
app.post('/api/admin/reset',  requireAdmin);
app.post('/api/admin/import', requireAdmin);
app.put('/api/meta/:key',     requireAdmin);
app.delete('/api/meta/:key',  requireAdmin);
// User/department/sla writes require admin too (privilege-escalation guard)
app.use(['/api/users', '/api/departments', '/api/sla_config'], (req, res, next) => {
  if (req.method === 'GET') return next();
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: `Admin role required to modify this collection` });
});

// Now mount the actual route handlers (their admin-only middleware
// already ran above for the methods that need it).
app.use('/api/admin', adminRoutes);
app.use('/api/meta',  metaRoutes);
app.use('/api',       apiRouter);

// ── Static files (server/ folder already blocked above) ──
app.use(express.static(STATIC_ROOT, { etag: false, lastModified: false }));

// SPA fallback — anything that isn't /api and isn't a real file → index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

// Error handler (must be last)
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  const line = '═'.repeat(54);
  console.log('');
  console.log(`╔${line}╗`);
  console.log('║   SCR Management System — Backend Started           ║');
  console.log(`╚${line}╝`);
  console.log('');
  console.log(`   Local:    http://localhost:${PORT}/`);
  for (const a of lanAddrs) console.log(`   LAN:      http://${a}:${PORT}/`);
  console.log('');
  console.log(`   API:      http://localhost:${PORT}/api/`);
  console.log(`   Health:   http://localhost:${PORT}/api/admin/health   (public)`);
  console.log(`   Login:    POST /api/auth/login                       (rate-limited)`);
  console.log(`   Database: ${DB_PATH}`);
  console.log('');
  console.log(`   Auth:     ENABLED   (Bearer token required on /api/*)`);
  console.log(`   Backup:   data/backups/scr-YYYY-MM-DD.db (30-day rolling)`);
  console.log('');
  console.log('   Press Ctrl+C to stop');
  console.log('');
});
