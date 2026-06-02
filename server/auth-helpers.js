// Server-side auth utilities — password hashing + opaque session tokens.
// bcryptjs is pure JS (no native compilation needed, matches our node:sqlite setup).
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

const BCRYPT_COST = 10;       // ~100ms per hash — fine for low-volume internal app
const TOKEN_BYTES = 32;       // 256-bit, base64url ~= 43 chars

// Hash a plaintext password for storage.
function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

// Verify a plaintext attempt against a stored value. Accepts both bcrypt
// hashes and LEGACY plaintext (so existing seed/demo accounts keep working
// during the lazy migration). Returns { ok, needsUpgrade }.
function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string' || !stored) {
    return { ok: false, needsUpgrade: false };
  }
  // bcrypt hashes always start with $2a$ / $2b$ / $2y$
  if (/^\$2[aby]\$/.test(stored)) {
    let ok = false;
    try { ok = bcrypt.compareSync(plain, stored); } catch { ok = false; }
    return { ok, needsUpgrade: false };
  }
  // Legacy plaintext path — use timingSafeEqual to prevent timing attacks.
  // Buffers must be the same length; a length mismatch is itself a safe false.
  const inputBuf = Buffer.from(plain, 'utf8');
  const storedBuf = Buffer.from(stored, 'utf8');
  const safeEqual = inputBuf.length === storedBuf.length &&
    crypto.timingSafeEqual(inputBuf, storedBuf);
  // needsUpgrade=true signals the caller to re-hash and persist the bcrypt hash.
  return { ok: safeEqual, needsUpgrade: safeEqual };
}

// Cryptographically strong, URL-safe session token.
function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

// Days-from-now → ISO timestamp (for sessions.expires_at).
function expiresInDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

module.exports = { hashPassword, verifyPassword, newToken, expiresInDays };
