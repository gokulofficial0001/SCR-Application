// Express middleware for the SCR backend:
//   requireAuth   — verifies a Bearer token and attaches req.user
//   requireAdmin  — must run AFTER requireAuth; rejects non-admin roles
//   loginLimiter  — IP-based rate limit on /api/auth/login to slow brute force

const rateLimit = require('express-rate-limit');
const { db } = require('./db');

const nowISO = () => new Date().toISOString();

// ── requireAuth ────────────────────────────────────────────
// Reads Authorization: Bearer <token>, looks up the session in SQLite,
// checks expiry, and attaches { id, role, name } to req.user.
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let session;
  try { session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token); }
  catch { return res.status(500).json({ error: 'Session lookup failed' }); }

  if (!session) return res.status(401).json({ error: 'Invalid token' });
  if (session.expires_at < nowISO()) {
    try { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); } catch {}
    return res.status(401).json({ error: 'Session expired' });
  }

  req.user = { id: session.user_id, role: session.user_role, name: session.user_name };
  req.token = token;
  next();
}

// ── requireAdmin ───────────────────────────────────────────
// Must be chained AFTER requireAuth. Rejects anyone whose session role
// is not 'admin'. Used to lock /api/admin/* (reset, import, etc.).
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  next();
}

// ── loginLimiter ───────────────────────────────────────────
// Gentle rate limit on the login endpoint. Per-IP cap.
// Allows up to 50 attempts per 15-minute window per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 50,                    // 50 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes before trying again.' }
});

// ── apiLimiter ─────────────────────────────────────────────
// General API abuse prevention. Apply to all API routes in server.js:
// app.use('/api', apiLimiter)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 500,                   // 500 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

module.exports = { requireAuth, requireAdmin, loginLimiter, apiLimiter };
