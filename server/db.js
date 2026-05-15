const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'scr.db');
const raw = new DatabaseSync(DB_PATH);

raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');

// Periodic WAL checkpoint — merges the -wal sidecar into the main scr.db
// file every 30s. Without this the server holds the connection open
// indefinitely, the -wal grows unbounded, and external tools (DB Browser,
// TOAD) that read scr.db directly see stale, pre-checkpoint data.
const checkpointTimer = setInterval(() => {
  try { raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
  catch (e) { console.error('WAL checkpoint failed:', e.message); }
}, 30000);
checkpointTimer.unref();  // don't keep the process alive on the timer alone

// ── Automated daily backup ─────────────────────────────────
// Copies scr.db to data/backups/scr-YYYY-MM-DD.db; keeps last 30 days.
// Runs once at boot (if today's backup is missing) and then every 24h.
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP_DAYS = 30;

function runBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    // Checkpoint first so the file we copy reflects the latest writes
    try { raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    const ts = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const target = path.join(BACKUP_DIR, `scr-${ts}.db`);
    fs.copyFileSync(DB_PATH, target);

    // Retention — keep only the most recent N day-stamped backups
    const all = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^scr-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort();
    while (all.length > BACKUP_KEEP_DAYS) {
      const old = all.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch {}
    }
    console.log(`[backup] ${target}  (${all.length} kept)`);
  } catch (e) {
    console.error('[backup] failed:', e.message);
  }
}

// Initial backup at boot if today's file doesn't already exist
try {
  const todayBackup = path.join(BACKUP_DIR, `scr-${new Date().toISOString().split('T')[0]}.db`);
  if (!fs.existsSync(todayBackup)) runBackup();
} catch {}

const backupTimer = setInterval(runBackup, 24 * 60 * 60 * 1000);
backupTimer.unref();

const db = {
  _raw: raw,
  exec: (sql) => raw.exec(sql),
  prepare: (sql) => raw.prepare(sql),
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN');
    try {
      const out = fn(...args);
      raw.exec('COMMIT');
      return out;
    } catch (e) {
      try { raw.exec('ROLLBACK'); } catch {}
      throw e;
    }
  },
  pragma: (stmt) => raw.exec(`PRAGMA ${stmt}`)
};

const COLLECTIONS = [
  'users',
  'departments',
  'scr_requests',
  'workflow_stages',
  'approvals',
  'feedback',
  'notifications',
  'development_updates',
  'audit_log',
  'sla_config'
];

for (const coll of COLLECTIONS) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${coll} (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT
  );
`);

// Server-issued session tokens — used by /api/auth/* + the requireAuth
// middleware to authenticate every API request.
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_role TEXT NOT NULL,
    user_name TEXT,
    created_at TEXT,
    expires_at TEXT
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions (expires_at);`);

for (const coll of ['workflow_stages', 'approvals', 'feedback', 'notifications', 'development_updates', 'audit_log']) {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${coll}_scr ON ${coll} (json_extract(data, '$.scrId'));`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (json_extract(data, '$.userId'));`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_username ON users (json_extract(data, '$.username'));`);

module.exports = { db, COLLECTIONS, DB_PATH };
