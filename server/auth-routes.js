// Authentication endpoints: login issues a token, logout invalidates it,
// /me lets the frontend validate a token on boot.
//
//   POST /api/auth/login   { username, password }  -> { token, user }
//   POST /api/auth/logout  (Authorization: Bearer ...) -> { ok: true }
//   GET  /api/auth/me      (Authorization: Bearer ...) -> { user }
//
// Tokens live for SESSION_DAYS days. Expired tokens are rejected by the
// requireAuth middleware AND cleaned up here on each login attempt.

const express = require('express');
const { db } = require('./db');
const { hashPassword, verifyPassword, newToken, expiresInDays } = require('./auth-helpers');

const router = express.Router();
const SESSION_DAYS = 14;            // re-login required after 2 weeks idle
const nowISO = () => new Date().toISOString();

// Find a user by username (case-insensitive). Returns the parsed user
// record + the underlying row id so we can re-save (e.g. password upgrade).
function findUserByUsername(username) {
  const want = String(username || '').toLowerCase().trim();
  if (!want) return null;
  const rows = db.prepare('SELECT id, data FROM users').all();
  for (const r of rows) {
    let u;
    try { u = JSON.parse(r.data); } catch { continue; }
    if (String(u.username || '').toLowerCase() === want) return { row: r, user: u };
  }
  return null;
}

function publicUser(u) {
  // Never echo the password back over the wire.
  return {
    id: u.id, name: u.name, username: u.username,
    role: u.role, email: u.email, department: u.department
  };
}

function clearExpiredSessions() {
  try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowISO()); } catch {}
}

// ── POST /api/auth/login ───────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const found = findUserByUsername(username);
  if (!found) return res.status(401).json({ error: 'Invalid username or password' });

  const { row, user } = found;
  const result = verifyPassword(password, user.password);
  if (!result.ok) return res.status(401).json({ error: 'Invalid username or password' });

  // Auto-upgrade to bcrypt is intentionally disabled.
  // Passwords are stored in plaintext so admins can read them in Master Data.

  clearExpiredSessions();

  const token = newToken();
  const expiresAt = expiresInDays(SESSION_DAYS);
  db.prepare(`INSERT INTO sessions (token, user_id, user_role, user_name, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(token, user.id, user.role, user.name || '', nowISO(), expiresAt);

  res.json({ token, expiresAt, user: publicUser(user) });
});

// ── POST /api/auth/logout ──────────────────────────────────
// Idempotent — never reveal whether the token existed.
router.post('/logout', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); } catch {}
  }
  res.json({ ok: true });
});

// ── GET /api/auth/me ───────────────────────────────────────
// Used by the frontend on boot to validate a stored token + fetch the
// up-to-date user record (role may have changed since the token issued).
router.get('/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });

  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  if (session.expires_at < nowISO()) {
    try { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); } catch {}
    return res.status(401).json({ error: 'Session expired' });
  }

  const row = db.prepare('SELECT data FROM users WHERE id = ?').get(session.user_id);
  if (!row) {
    // Stale session pointing at a deleted user — kill the token.
    try { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); } catch {}
    return res.status(401).json({ error: 'User no longer exists' });
  }
  res.json({ user: publicUser(JSON.parse(row.data)), expiresAt: session.expires_at });
});

module.exports = router;
